import "@tanstack/react-start/server-only";
import { and, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { getDatabaseClient } from "../client.ts";
import { leaveBalances, leavePolicies, leaveRequests, leaveTransactions } from "../schema/leave.ts";
import { publicHolidays } from "../schema/master-data.ts";
import { employeeDocuments } from "../schema/documents.ts";
import { companyLibrary } from "../schema/company-library.ts";
import { leaveYearForDate } from "../../data/leave-year.ts";
import { remainingCarryForReminder } from "../../data/leave-reminders.ts";
import {
  expiryBuckets,
  splitLeaveDays,
  type LeaveChartRow,
} from "../../data/dashboard-priorities.ts";

/** Called only after workforce analytics verifies scope. No names, documents or money are returned. */
export async function dashboardPriorities(input: {
  organisationId: string;
  scope: "hr" | "self";
  employeeId?: string | undefined;
  today: string;
  yearStart: string;
  workingDays: number[];
  people: { id: string; locationId: string }[];
}) {
  const { organisationId, scope, today, people } = input;
  const db = getDatabaseClient();
  const year = leaveYearForDate(today, input.yearStart);
  const yearStart = `${year}-${input.yearStart}`;
  const nextYearStart = `${year + 1}-${input.yearStart}`;
  const ids = people.map((row) => row.id);
  const employeeFilter = input.employeeId ? sql`and employee_id = ${input.employeeId}` : sql``;
  const [balances, requests, movements, holidays, approvals, employeeExpiry, companyExpiry] =
    await Promise.all([
      ids.length
        ? db
            .select({
              employeeId: leaveBalances.employeeId,
              policyId: leaveBalances.policyId,
              balance: leaveBalances.balanceDays,
              name: leavePolicies.name,
            })
            .from(leaveBalances)
            .innerJoin(
              leavePolicies,
              and(
                eq(leavePolicies.id, leaveBalances.policyId),
                eq(leavePolicies.organisationId, organisationId),
              ),
            )
            .where(
              and(
                eq(leaveBalances.organisationId, organisationId),
                inArray(leaveBalances.employeeId, ids),
                eq(leaveBalances.leaveYear, year),
                isNull(leaveBalances.archivedAt),
                isNull(leavePolicies.archivedAt),
                eq(leavePolicies.isEnabled, true),
                eq(leavePolicies.type, "Annual"),
              ),
            )
        : [],
      ids.length
        ? db
            .select({
              employeeId: leaveRequests.employeeId,
              policyId: leaveRequests.policyId,
              startDate: leaveRequests.startDate,
              endDate: leaveRequests.endDate,
              halfDay: leaveRequests.isHalfDay,
            })
            .from(leaveRequests)
            .where(
              and(
                eq(leaveRequests.organisationId, organisationId),
                inArray(leaveRequests.employeeId, ids),
                isNull(leaveRequests.archivedAt),
                lt(leaveRequests.startDate, nextYearStart),
                gte(leaveRequests.endDate, yearStart),
                inArray(leaveRequests.status, [
                  "Approved",
                  "Taken",
                  "Cancellation Pending",
                  "Amendment Pending Line Manager",
                  "Amendment Pending HR",
                ]),
              ),
            )
        : [],
      ids.length
        ? db
            .select({
              employeeId: leaveTransactions.employeeId,
              policyId: leaveTransactions.policyId,
              transactionType: leaveTransactions.transactionType,
              days: leaveTransactions.days,
            })
            .from(leaveTransactions)
            .where(
              and(
                eq(leaveTransactions.organisationId, organisationId),
                inArray(leaveTransactions.employeeId, ids),
                isNull(leaveTransactions.archivedAt),
                gte(leaveTransactions.date, yearStart),
                lt(leaveTransactions.date, nextYearStart),
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
            gte(publicHolidays.holidayDate, yearStart),
            lt(publicHolidays.holidayDate, nextYearStart),
          ),
        ),
      scope === "hr"
        ? db.execute<{ name: string; count: number }>(sql`
      select name, count(*)::int as count from (
        select case when status in ('Pending Line Manager', 'Amendment Pending Line Manager') then 'Leave · Manager' when status = 'Pending Super Admin' then 'Leave · Legacy stage (review)' else 'Leave · HR' end as name
        from leave_requests where organisation_id = ${organisationId} ${employeeFilter} and archived_at is null and status in ('Pending Line Manager','Pending HR','Pending Super Admin','Cancellation Pending','Amendment Pending Line Manager','Amendment Pending HR')
        union all select case when status = 'Pending HR' then 'Overtime · HR' else 'Overtime · Manager' end from overtime_claims where organisation_id = ${organisationId} ${employeeFilter} and archived_at is null and status in ('Pending Pre-authorisation','Pending Manager','Pending HR')
        union all select 'Travel · Manager' from travel_requests where organisation_id = ${organisationId} ${employeeFilter} and archived_at is null and status = 'Pending HR and Accounts' and manager_approval_status = 'Pending'
        union all select 'Travel · HR' from travel_requests where organisation_id = ${organisationId} ${employeeFilter} and archived_at is null and status = 'Pending HR and Accounts' and hr_approval_status = 'Pending'
        union all select 'Travel · Finance' from travel_requests where organisation_id = ${organisationId} ${employeeFilter} and archived_at is null and status = 'Pending HR and Accounts' and accounts_approval_status = 'Pending'
        union all select 'Travel closure · Finance' from travel_requests where organisation_id = ${organisationId} ${employeeFilter} and archived_at is null and status = 'Pending Super Admin Closure'
        union all select case when status = 'Pending HR' then 'Training · HR' else 'Training · Supervisor' end from training_requests where organisation_id = ${organisationId} ${employeeFilter} and archived_at is null and status in ('Pending Supervisor','Pending HR')
        union all select 'Visits · HR' from site_visit_requests where organisation_id = ${organisationId} ${employeeFilter} and archived_at is null and status = 'Pending HR'
      ) pending group by name order by name`)
        : [],
      scope === "hr" && ids.length
        ? db
            .select({ date: employeeDocuments.expiryDate })
            .from(employeeDocuments)
            .where(
              and(
                eq(employeeDocuments.organisationId, organisationId),
                inArray(employeeDocuments.employeeId, ids),
                isNull(employeeDocuments.archivedAt),
                isNull(employeeDocuments.replacedById),
                eq(employeeDocuments.status, "Valid"),
                lte(employeeDocuments.expiryDate, sql`(${today}::date + 90)`),
              ),
            )
        : [],
      scope === "hr" && !input.employeeId
        ? db
            .select({ date: companyLibrary.expiryDate })
            .from(companyLibrary)
            .where(
              and(
                eq(companyLibrary.organisationId, organisationId),
                isNull(companyLibrary.archivedAt),
                eq(companyLibrary.kind, "Company"),
                eq(companyLibrary.status, "Published"),
                lte(companyLibrary.expiryDate, sql`(${today}::date + 90)`),
              ),
            )
        : [],
    ]);
  const rows = new Map<string, LeaveChartRow>();
  const requestsByKey = new Map<string, typeof requests>();
  const movementsByKey = new Map<string, { transactionType: string; days: number }[]>();
  for (const row of requests) {
    const key = `${row.employeeId}:${row.policyId}`;
    requestsByKey.set(key, [...(requestsByKey.get(key) ?? []), row]);
  }
  for (const row of movements) {
    const key = `${row.employeeId}:${row.policyId}`;
    movementsByKey.set(key, [
      ...(movementsByKey.get(key) ?? []),
      { transactionType: row.transactionType, days: Number(row.days) },
    ]);
  }
  const personById = new Map(people.map((row) => [row.id, row]));
  for (const balance of balances) {
    const row = rows.get(balance.policyId) ?? {
      name: balance.name,
      used: 0,
      booked: 0,
      remaining: 0,
      carry: 0,
    };
    const key = `${balance.employeeId}:${balance.policyId}`;
    const location = personById.get(balance.employeeId)?.locationId;
    const holidayDates = new Set(
      holidays.filter((h) => !h.locationId || h.locationId === location).map((h) => h.date),
    );
    for (const request of requestsByKey.get(key) ?? []) {
      const split = splitLeaveDays({
        ...request,
        yearStart,
        nextYearStart,
        today,
        workingDays: input.workingDays,
        holidays: holidayDates,
      });
      row.used += split.used;
      row.booked += split.booked;
    }
    row.remaining += Number(balance.balance);
    row.carry += remainingCarryForReminder(Number(balance.balance), movementsByKey.get(key) ?? []);
    rows.set(balance.policyId, row);
  }
  return {
    leaveYear: year,
    leaveYearStart: yearStart,
    leaveYearEnd: nextYearStart,
    annualLeave: [...rows.values()],
    approvals: [...approvals],
    expiries:
      scope === "hr"
        ? expiryBuckets(
            today,
            [...employeeExpiry, ...companyExpiry].flatMap((row) => (row.date ? [row.date] : [])),
          )
        : [],
  };
}
