import "@tanstack/react-start/server-only";
import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { getDatabaseClient } from "../client.ts";
import { employees } from "../schema/employee.ts";
import { departments, locations, publicHolidays } from "../schema/master-data.ts";
import { appSettings } from "../schema/organisation.ts";
import { attendancePolicies, attendanceRecords, siteVisitRequests } from "../schema/time.ts";
import { leaveRequests } from "../schema/leave.ts";
import { candidateApplications, vacancies } from "../schema/recruitment.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";
import {
  calculateAttendanceAnalytics,
  completedDateRange,
  employedOn,
  type WorkforceAnalytics,
} from "../../data/workforce-analytics.ts";
import { siteVisitLocalNow } from "../../data/site-visit.ts";
import { dashboardPriorities } from "./dashboard-priorities.repository.server.ts";

export async function getWorkforceAnalytics(
  organisationId: string,
  actor: AuditActorContext,
  scope: "self" | "hr",
  days: 7 | 30,
  at = new Date(),
  employeeId?: string,
): Promise<WorkforceAnalytics> {
  if (![7, 30].includes(days)) throw new Error("Choose 7 or 30 completed days.");
  if (scope !== "self" && scope !== "hr") throw new Error("Unknown dashboard scope.");
  if (scope === "hr" && !["HR", "Super Admin"].includes(actor.activeRole ?? ""))
    throw new Error("Only HR can view organisation charts.");
  if (scope === "self" && !actor.employeeId) throw new Error("An employee profile is required.");
  if (employeeId && scope !== "hr") throw new Error("Only HR can select another employee.");
  const individualId = employeeId ?? (scope === "self" ? actor.employeeId : undefined);
  const db = getDatabaseClient();
  const [settingsRows, policyRows, people] = await Promise.all([
    db
      .select({
        timezone: appSettings.timezone,
        workingDays: appSettings.workingDays,
        dailyHours: appSettings.standardDailyHours,
        yearStart: appSettings.leaveYearStart,
      })
      .from(appSettings)
      .where(eq(appSettings.organisationId, organisationId))
      .limit(1),
    db
      .select({ dailyHours: attendancePolicies.standardDailyHours })
      .from(attendancePolicies)
      .where(eq(attendancePolicies.organisationId, organisationId))
      .limit(1),
    db
      .select({
        id: employees.id,
        startDate: employees.startDate,
        terminationDate: employees.terminationDate,
        status: employees.status,
        locationId: employees.locationId,
        department: departments.name,
        office: locations.name,
        timezone: locations.timezone,
      })
      .from(employees)
      .innerJoin(
        departments,
        and(
          eq(departments.id, employees.departmentId),
          eq(departments.organisationId, organisationId),
        ),
      )
      .innerJoin(
        locations,
        and(eq(locations.id, employees.locationId), eq(locations.organisationId, organisationId)),
      )
      .where(
        and(
          eq(employees.organisationId, organisationId),
          isNull(employees.archivedAt),
          ...(individualId ? [eq(employees.id, individualId)] : []),
        ),
      ),
  ]);
  const settings = settingsRows[0];
  if (!settings)
    throw new Error("HR must configure the working calendar before charts are available.");
  if (individualId && !people.length) throw new Error("Your employee profile was not found.");
  const timezone = (individualId ? people[0]?.timezone : null) || settings.timezone;
  const today = siteVisitLocalNow(timezone, at).date;
  const dates = completedDateRange(today, days);
  const startDate = dates[0]!;
  const endDate = dates[dates.length - 1]!;
  const ids = people.map((employee) => employee.id);
  const dailyHours = Number(policyRows[0]?.dailyHours ?? settings.dailyHours);
  const [records, leave, holidays, pendingVisits, recruitment, leaveQueue, visits] =
    await Promise.all([
      ids.length
        ? db
            .select({
              employeeId: attendanceRecords.employeeId,
              date: attendanceRecords.date,
              clockInAt: attendanceRecords.clockInAt,
              clockOutAt: attendanceRecords.clockOutAt,
              calculatedHours: attendanceRecords.calculatedHours,
              status: attendanceRecords.status,
            })
            .from(attendanceRecords)
            .where(
              and(
                eq(attendanceRecords.organisationId, organisationId),
                inArray(attendanceRecords.employeeId, ids),
                gte(attendanceRecords.date, startDate),
                lte(attendanceRecords.date, endDate),
                isNull(attendanceRecords.archivedAt),
              ),
            )
        : [],
      ids.length
        ? db
            .select({
              employeeId: leaveRequests.employeeId,
              startDate: leaveRequests.startDate,
              endDate: leaveRequests.endDate,
              isHalfDay: leaveRequests.isHalfDay,
            })
            .from(leaveRequests)
            .where(
              and(
                eq(leaveRequests.organisationId, organisationId),
                inArray(leaveRequests.employeeId, ids),
                inArray(leaveRequests.status, [
                  "Approved",
                  "Taken",
                  "Cancellation Pending",
                  "Amendment Pending Line Manager",
                  "Amendment Pending HR",
                ]),
                lte(leaveRequests.startDate, endDate),
                gte(leaveRequests.endDate, startDate),
                isNull(leaveRequests.archivedAt),
              ),
            )
        : [],
      db
        .select({ date: publicHolidays.holidayDate, locationId: publicHolidays.locationId })
        .from(publicHolidays)
        .where(
          and(
            eq(publicHolidays.organisationId, organisationId),
            eq(publicHolidays.isActive, true),
            isNull(publicHolidays.archivedAt),
            gte(publicHolidays.holidayDate, startDate),
            lte(publicHolidays.holidayDate, endDate),
          ),
        ),
      ids.length
        ? db
            .select({ employeeId: siteVisitRequests.employeeId, date: siteVisitRequests.date })
            .from(siteVisitRequests)
            .where(
              and(
                eq(siteVisitRequests.organisationId, organisationId),
                inArray(siteVisitRequests.employeeId, ids),
                eq(siteVisitRequests.status, "Pending HR"),
                gte(siteVisitRequests.date, startDate),
                lte(siteVisitRequests.date, endDate),
                isNull(siteVisitRequests.archivedAt),
              ),
            )
        : [],
      scope === "hr" && !employeeId
        ? db
            .select({ name: candidateApplications.status, count: sql<number>`count(*)::int` })
            .from(candidateApplications)
            .innerJoin(
              vacancies,
              and(
                eq(vacancies.id, candidateApplications.vacancyId),
                eq(vacancies.organisationId, organisationId),
                eq(vacancies.status, "Open"),
                isNull(vacancies.archivedAt),
              ),
            )
            .where(
              and(
                eq(candidateApplications.organisationId, organisationId),
                isNull(candidateApplications.archivedAt),
              ),
            )
            .groupBy(candidateApplications.status)
        : [],
      scope === "hr"
        ? db
            .select({ name: leaveRequests.status, count: sql<number>`count(*)::int` })
            .from(leaveRequests)
            .where(
              and(
                eq(leaveRequests.organisationId, organisationId),
                isNull(leaveRequests.archivedAt),
                ...(employeeId ? [eq(leaveRequests.employeeId, employeeId)] : []),
                inArray(leaveRequests.status, [
                  "Pending Line Manager",
                  "Pending HR",
                  "Cancellation Pending",
                  "Amendment Pending Line Manager",
                  "Amendment Pending HR",
                ]),
              ),
            )
            .groupBy(leaveRequests.status)
        : [],
      scope === "hr"
        ? db
            .select({ name: siteVisitRequests.status, count: sql<number>`count(*)::int` })
            .from(siteVisitRequests)
            .where(
              and(
                eq(siteVisitRequests.organisationId, organisationId),
                isNull(siteVisitRequests.archivedAt),
                ...(employeeId ? [eq(siteVisitRequests.employeeId, employeeId)] : []),
                gte(siteVisitRequests.date, startDate),
                lte(siteVisitRequests.date, endDate),
              ),
            )
            .groupBy(siteVisitRequests.status)
        : [],
    ]);
  const daily = calculateAttendanceAnalytics({
    dates,
    employees: people,
    workingDays: settings.workingDays,
    dailyHours,
    records,
    leave,
    holidays,
    pendingVisits,
  });
  const departmentCounts = new Map<string, number>();
  const officeCounts = new Map<string, number>();
  const statusCounts = new Map<string, number>();
  if (scope === "hr" && !employeeId)
    for (const employee of people.filter((person) => employedOn(person, today))) {
      departmentCounts.set(
        employee.department,
        (departmentCounts.get(employee.department) ?? 0) + 1,
      );
      officeCounts.set(employee.office, (officeCounts.get(employee.office) ?? 0) + 1);
      statusCounts.set(employee.status, (statusCounts.get(employee.status) ?? 0) + 1);
    }
  const counts = (values: Map<string, number>) =>
    [...values]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    priorities: await dashboardPriorities({
      organisationId,
      scope,
      employeeId,
      today,
      yearStart: settings.yearStart,
      workingDays: settings.workingDays,
      people:
        scope === "hr" && !employeeId
          ? people.filter((person) => employedOn(person, today))
          : people,
    }),
    scope,
    timezone,
    startDate,
    endDate,
    dailyHours,
    offices: counts(officeCounts),
    employmentStatuses: counts(statusCounts),
    leaveQueue: leaveQueue.sort((a, b) => a.name.localeCompare(b.name)),
    visits: visits.sort((a, b) => a.name.localeCompare(b.name)),
    days: daily,
    totals: daily.reduce(
      (totals, day) => ({
        worked: totals.worked + day.worked,
        expected: totals.expected + day.expected,
        review: totals.review + day.review,
        missing: totals.missing + day.missing,
        leaveDays: totals.leaveDays + day.leaveDays,
      }),
      { worked: 0, expected: 0, review: 0, missing: 0, leaveDays: 0 },
    ),
    departments: [...departmentCounts]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    recruitment: [
      "New",
      "Shortlisted",
      "On Hold",
      "Interviewing",
      "Offered",
      "Hired",
      "Rejected",
      "Withdrawn",
    ]
      .map((name) => ({ name, count: recruitment.find((row) => row.name === name)?.count ?? 0 }))
      .filter((row) => row.count > 0),
  };
}
