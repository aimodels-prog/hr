import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDatabaseClient } from "../client.ts";
import { employees, users } from "../schema/employee.ts";
import { locations, publicHolidays } from "../schema/master-data.ts";
import { appSettings } from "../schema/organisation.ts";
import {
  attendancePolicies,
  attendanceRecords,
  officeExceptions,
  siteVisitRequests,
} from "../schema/time.ts";
import { leaveRequests } from "../schema/leave.ts";
import { timeAway } from "../schema/time-away.ts";
import { travelRequests } from "../schema/travel-payroll.ts";
import { googleCalendarConnections } from "../schema/google-calendar.ts";
import { notifications, auditEvents } from "../schema/system.ts";
import { workflowNotificationEmails } from "../schema/workflow-email.ts";
import { getAttendanceTrackingPolicy } from "./attendance-tracking.repository.server.ts";
import { isAttendanceTracked } from "../../data/attendance-tracking.ts";
import { attendanceDayCredit } from "../../data/attendance-day-credit.ts";
import { siteVisitEffectiveEndTime } from "../../data/site-visit.ts";
import { recordedWorkingHours } from "../../data/recorded-hours.ts";
import {
  approvedLeaveFraction,
  approvedLeaveCoversDate,
  isAbsenceLeave,
  isApprovedRemoteWork,
  isEffectiveLeave,
  organisationDate,
} from "../../data/approved-leave.ts";
import type { ApprovedLeaveDates } from "../../data/approved-leave.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";
import {
  ATTENDANCE_FOLLOW_UP_MESSAGE,
  attendanceMorningFollowUpEligible,
} from "../../data/attendance-follow-up.ts";
import { calendarAccessToken } from "../../integrations/google-calendar.server.ts";
import { decryptSensitiveJson } from "../encryption.server.ts";
import { sendWorkflowEmail, WorkflowEmailError } from "../../integrations/workflow-email.server.ts";

function localTime(now: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
}

export async function getTodayAttendanceOverview(
  org: string,
  actor: AuditActorContext,
  now = new Date(),
) {
  if (!["HR", "Super Admin"].includes(actor.activeRole))
    throw new Error("Choose the HR role to view the office attendance overview.");
  const db = getDatabaseClient();
  const [settings] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.organisationId, org))
    .limit(1);
  if (!settings) throw new Error("Organisation work settings are missing.");
  const [attendancePolicy] = await db
    .select({
      breakStart: attendancePolicies.breakStart,
      breakMinutes: attendancePolicies.defaultBreakMinutes,
    })
    .from(attendancePolicies)
    .where(eq(attendancePolicies.organisationId, org))
    .limit(1);
  const date = organisationDate(now, settings.timezone);
  const configuredTime = settings.additionalSettings?.["attendanceFollowUpTime"];
  const followUpTime =
    typeof configuredTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(configuredTime)
      ? configuredTime
      : "09:30";
  const tracking = await getAttendanceTrackingPolicy(org);
  const [people, records, leaves, visits, away, travel, holidays, exceptions, sender, followUps] =
    await Promise.all([
      db
        .select({
          id: employees.id,
          name: employees.preferredName,
          legalName: employees.legalName,
          locationId: employees.locationId,
          locationName: locations.name,
          status: employees.status,
          startDate: employees.startDate,
          terminationDate: employees.terminationDate,
          userId: users.id,
          userStatus: users.status,
        })
        .from(employees)
        .innerJoin(locations, eq(locations.id, employees.locationId))
        .leftJoin(
          users,
          and(
            eq(users.employeeId, employees.id),
            eq(users.organisationId, org),
            isNull(users.archivedAt),
          ),
        )
        .where(and(eq(employees.organisationId, org), isNull(employees.archivedAt))),
      db
        .select()
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.organisationId, org),
            eq(attendanceRecords.date, date),
            isNull(attendanceRecords.archivedAt),
          ),
        ),
      db
        .select()
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.organisationId, org),
            sql`${leaveRequests.startDate} <= ${date}::date AND ${leaveRequests.endDate} >= ${date}::date`,
            isNull(leaveRequests.archivedAt),
          ),
        ),
      db
        .select()
        .from(siteVisitRequests)
        .where(
          and(
            eq(siteVisitRequests.organisationId, org),
            eq(siteVisitRequests.date, date),
            isNull(siteVisitRequests.archivedAt),
          ),
        ),
      db
        .select()
        .from(timeAway)
        .where(
          and(
            eq(timeAway.organisationId, org),
            eq(timeAway.date, date),
            isNull(timeAway.archivedAt),
          ),
        ),
      db
        .select()
        .from(travelRequests)
        .where(
          and(
            eq(travelRequests.organisationId, org),
            sql`${travelRequests.startDate} <= ${date}::date AND ${travelRequests.endDate} >= ${date}::date`,
            isNull(travelRequests.archivedAt),
          ),
        ),
      db
        .select()
        .from(publicHolidays)
        .where(
          and(
            eq(publicHolidays.organisationId, org),
            eq(publicHolidays.holidayDate, date),
            eq(publicHolidays.isActive, true),
          ),
        ),
      db
        .select()
        .from(officeExceptions)
        .where(
          and(
            eq(officeExceptions.organisationId, org),
            sql`${officeExceptions.startDate} <= ${date}::date AND ${officeExceptions.endDate} >= ${date}::date`,
            isNull(officeExceptions.archivedAt),
          ),
        ),
      db
        .select({ emailEnabledAt: googleCalendarConnections.emailEnabledAt })
        .from(googleCalendarConnections)
        .where(eq(googleCalendarConnections.organisationId, org))
        .limit(1),
      db
        .select({
          deduplicationKey: notifications.deduplicationKey,
          deliveryStatus: workflowNotificationEmails.status,
        })
        .from(notifications)
        .leftJoin(
          workflowNotificationEmails,
          eq(workflowNotificationEmails.notificationId, notifications.id),
        )
        .where(
          and(
            eq(notifications.organisationId, org),
            eq(notifications.type, "attendance.morning_follow_up"),
            sql`${notifications.deduplicationKey} LIKE ${`attendance-follow-up:${date}:%`}`,
          ),
        ),
    ]);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const workday = settings.workingDays.includes(weekday);
  const afterCutoff = localTime(now, settings.timezone) >= followUpTime;
  const rows = people
    .filter(
      (person) =>
        !["Inactive", "Archived"].includes(person.status) &&
        person.startDate <= date &&
        (!person.terminationDate || person.terminationDate >= date),
    )
    .filter((person) =>
      tracking
        ? person.locationId === tracking.headOfficeLocationId
        : person.locationName.trim().toLowerCase() === "head office",
    )
    .map((person) => {
      const record = records.find((item) => item.employeeId === person.id);
      const personLeave = leaves
        .filter((item) => item.employeeId === person.id && isEffectiveLeave(item))
        .map((item) => ({
          ...item,
          policySnapshot: (item.policySnapshot ?? null) as NonNullable<
            ApprovedLeaveDates["policySnapshot"]
          > | null,
        }));
      const pendingLeave = leaves.some(
        (item) => item.employeeId === person.id && item.status.startsWith("Pending"),
      );
      const fraction = approvedLeaveFraction(personLeave, date);
      const remote =
        personLeave.some((item) => isApprovedRemoteWork(item, date)) ||
        record?.workMode === "Remote";
      const personVisits = visits.filter((item) => item.employeeId === person.id);
      const approvedVisits = personVisits.filter((item) =>
        ["Approved", "Completed"].includes(item.status),
      );
      const personAway = away.filter((item) => item.employeeId === person.id);
      const approvedAway = personAway.filter((item) => item.status === "Approved");
      const personTravel = travel.filter(
        (item) =>
          (item.employeeId === person.id ||
            item.participants.some(
              (participant) =>
                participant.employeeId === person.id && participant.status !== "Rejected",
            )) &&
          !["Draft", "Rejected", "Withdrawn"].includes(item.status),
      );
      const approvedTravel = personTravel.filter(
        (item) =>
          ["Pre-authorised", "Pending Super Admin Closure", "Closed"].includes(item.status) &&
          (item.employeeId === person.id ||
            item.participants.some(
              (participant) =>
                participant.employeeId === person.id && participant.status === "Approved",
            )),
      );
      const specialDay =
        exceptions.some((item) => item.employeeIds.includes(person.id)) ||
        ["Holiday", "Rest Day"].includes(record?.status ?? "");
      const holiday = holidays.some(
        (item) => !item.locationId || item.locationId === person.locationId,
      );
      const tracked = isAttendanceTracked(tracking, person.id, date);
      const hasPunch =
        record?.source !== "Site Visit Auto" && Boolean(record?.clockInAt || record?.clockOutAt);
      const completePunch =
        record?.source !== "Site Visit Auto" && Boolean(record?.clockInAt && record?.clockOutAt);
      const approvedActivity =
        approvedVisits.length > 0 ||
        approvedAway.length > 0 ||
        approvedTravel.length > 0 ||
        record?.workMode === "Approved Site Visit";
      const pendingActivity =
        pendingLeave ||
        personTravel.some((item) => item.status === "Pending HR and Accounts") ||
        personVisits.some((item) => item.status === "Pending HR") ||
        personAway.some((item) => item.status === "Pending HR");
      const status = completePunch
        ? "Clocked out"
        : fraction >= 1
          ? "On leave"
          : fraction > 0
            ? "Half-day leave"
            : remote
              ? "Working remotely"
              : approvedVisits.length || record?.workMode === "Approved Site Visit"
                ? "Official visit"
                : approvedAway.length
                  ? "Time away"
                  : approvedTravel.length
                    ? "Official travel"
                    : !workday
                      ? "Rest day"
                      : holiday
                        ? "Holiday"
                        : specialDay
                          ? "Office exception"
                          : !tracked
                            ? "Not required"
                            : pendingActivity
                              ? "Request awaiting review"
                              : hasPunch
                                ? "Clocked in"
                                : "Not clocked in";
      const paidLeaveFraction = Math.min(
        1,
        personLeave
          .filter((item) => isAbsenceLeave(item) && approvedLeaveCoversDate(item, date))
          .reduce((total, leave) => {
            const fraction = leave.isHalfDay ? 0.5 : 1;
            const snapshot = leave.policySnapshot;
            const specialUnpaid = snapshot?.specialRequest?.unpaidByDate?.find(
              (item) => item.date === date,
            )?.days;
            const unpaid = snapshot?.specialRequest
              ? Math.min(fraction, Math.max(0, specialUnpaid ?? 0))
              : snapshot?.isPaid === false
                ? fraction
                : 0;
            return total + Math.max(0, fraction - unpaid);
          }, 0),
      );
      const dayCredit = attendanceDayCredit({
        actualWorkHours: recordedWorkingHours(record),
        standardDailyHours: Number(settings.standardDailyHours),
        clockIn: record?.clockInAt
          ? localTime(new Date(record.clockInAt), settings.timezone)
          : null,
        clockOut: record?.clockOutAt
          ? localTime(new Date(record.clockOutAt), settings.timezone)
          : null,
        breakStart: attendancePolicy?.breakStart,
        breakMinutes: record?.breakMinutes ?? attendancePolicy?.breakMinutes ?? 0,
        approvedIntervals: [
          ...approvedVisits.map((item) => ({
            startTime: item.startTime,
            endTime: siteVisitEffectiveEndTime({
              date: item.date,
              startTime: item.startTime,
              endTime: item.endTime,
              details: item.details,
              timeZone: settings.timezone,
            }),
          })),
          ...approvedAway
            .filter((item) => item.treatment === "Paid time")
            .map((item) => ({ startTime: item.startTime, endTime: item.endTime })),
        ],
        unpaidIntervals: approvedAway
          .filter((item) => item.treatment !== "Paid time")
          .map((item) => ({ startTime: item.startTime, endTime: item.endTime })),
        paidLeaveFraction,
        approvedRemoteWork: remote || (workday && approvedTravel.length > 0),
      });
      const needsFollowUp = attendanceMorningFollowUpEligible({
        afterCutoff,
        workday,
        tracked,
        hasPunch,
        leaveFraction: fraction,
        remote,
        approvedActivity,
        pendingActivity,
        specialDay,
        holiday,
        activeAccount: person.userStatus === "Active" && Boolean(person.userId),
      });
      const followUpState =
        followUps.find(
          (item) => item.deduplicationKey === `attendance-follow-up:${date}:${person.id}`,
        )?.deliveryStatus ?? null;
      const asTime = (value: string | null) =>
        value ? localTime(new Date(value), settings.timezone) : null;
      const homeVisitOfficeArrival = approvedVisits.find(
        (item) => item.origin === "Home" && item.details?.returnedAt,
      )?.details?.returnedAt;
      return {
        employeeId: person.id,
        name: person.name || person.legalName,
        clockIn: hasPunch ? asTime(homeVisitOfficeArrival ?? record?.clockInAt ?? null) : null,
        clockOut: hasPunch ? asTime(record?.clockOutAt ?? null) : null,
        status,
        dayCredit,
        needsFollowUp,
        followUpState,
        activities: [
          ...personLeave
            .filter((item) => approvedLeaveCoversDate(item, date))
            .map((item) => ({
              label: item.policySnapshot?.name ?? "Approved leave",
              path: `/staff/leave-admin#request=${item.id}`,
            })),
          ...approvedVisits.map((item) => ({
            label: `Official visit ${item.startTime}–${item.endTime}`,
            path: `/staff/attendance#section=site-visits&visit=${item.id}`,
          })),
          ...approvedAway.map((item) => ({
            label: `Time away ${item.startTime}–${item.endTime}`,
            path: `/staff/time-away?date=${date}&review=${item.id}`,
          })),
          ...approvedTravel.map((item) => ({
            label: "Official travel",
            path: "/staff/travel-hr-approvals",
          })),
        ],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    date,
    followUpTime,
    afterCutoff,
    emailConnected: Boolean(sender[0]?.emailEnabledAt),
    rows,
  };
}

export async function getAttendanceFollowUpTime(org: string, actor: AuditActorContext) {
  if (!["HR", "Super Admin"].includes(actor.activeRole))
    throw new Error("Only HR may view this setting.");
  const [row] = await getDatabaseClient()
    .select({ additionalSettings: appSettings.additionalSettings })
    .from(appSettings)
    .where(eq(appSettings.organisationId, org))
    .limit(1);
  const value = row?.additionalSettings?.["attendanceFollowUpTime"];
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : "09:30";
}

export async function saveAttendanceFollowUpTime(
  org: string,
  time: string,
  actor: AuditActorContext,
) {
  if (!["HR", "Super Admin"].includes(actor.activeRole) || !actor.userId)
    throw new Error("Only HR may change the attendance follow-up time.");
  if (!/^(0[8-9]|1[0-2]):[0-5]\d$/.test(time))
    throw new Error("Choose a morning time between 08:00 and 12:59.");
  await getDatabaseClient().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(appSettings)
      .where(eq(appSettings.organisationId, org))
      .for("update")
      .limit(1);
    if (!row) throw new Error("Organisation work settings are missing.");
    await tx
      .update(appSettings)
      .set({
        additionalSettings: { ...row.additionalSettings, attendanceFollowUpTime: time },
        recordVersion: row.recordVersion + 1,
        updatedAt: new Date(),
        updatedBy: actor.userId!,
      })
      .where(eq(appSettings.id, row.id));
    await tx.insert(auditEvents).values({
      organisationId: org,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: "attendance-follow-up-time-updated",
      module: "attendance",
      entityType: "app-settings",
      entityId: row.id,
      reason: `Morning follow-up time changed to ${time}`,
      riskLevel: "Low",
    });
  });
  return { time };
}

export async function sendAttendanceFollowUp(
  org: string,
  employeeId: string,
  actor: AuditActorContext,
) {
  if (actor.activeRole !== "HR" || !actor.userId)
    throw new Error("Only an HR account can ask for an attendance update.");
  const db = getDatabaseClient();
  // Re-check live records at click time. A newly arrived punch or approved
  // activity must stop the email even if the dashboard was stale.
  const overview = await getTodayAttendanceOverview(org, actor);
  const target = overview.rows.find((row) => row.employeeId === employeeId);
  if (!target?.needsFollowUp)
    throw new Error("This person no longer needs a follow-up. Refresh the attendance list.");
  const [recipient] = await db
    .select({ id: users.id, email: users.workspaceEmail })
    .from(users)
    .where(
      and(
        eq(users.organisationId, org),
        eq(users.employeeId, employeeId),
        eq(users.status, "Active"),
        isNull(users.archivedAt),
      ),
    )
    .limit(1);
  const [sender] = await db
    .select()
    .from(googleCalendarConnections)
    .where(eq(googleCalendarConnections.organisationId, org))
    .limit(1);
  if (!recipient || !sender?.emailEnabledAt)
    throw new Error("Connect the HR email sender before sending this follow-up.");
  const notificationId = randomUUID();
  const key = `attendance-follow-up:${overview.date}:${employeeId}`;
  const claimed = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(notifications)
      .values({
        id: notificationId,
        organisationId: org,
        recipientUserId: recipient.id,
        type: "attendance.morning_follow_up",
        title: "Please confirm your attendance today",
        message: ATTENDANCE_FOLLOW_UP_MESSAGE,
        deduplicationKey: key,
        link: { entityType: "attendance", entityId: employeeId, path: "/staff/me/attendance" },
        createdBy: actor.userId!,
        updatedBy: actor.userId!,
      })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    if (!created) return false;
    await tx
      .insert(workflowNotificationEmails)
      .values({ notificationId, organisationId: org, status: "Sending", attempts: 1 });
    await tx.insert(auditEvents).values({
      organisationId: org,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: "attendance-follow-up-requested",
      module: "attendance",
      entityType: "employee",
      entityId: employeeId,
      reason: `HR requested attendance confirmation for ${overview.date}`,
      riskLevel: "Low",
    });
    return true;
  });
  if (!claimed)
    throw new Error(
      "A follow-up was already requested for this employee today. Check Sent mail before trying again.",
    );
  const latest = await getTodayAttendanceOverview(org, actor);
  if (!latest.rows.find((row) => row.employeeId === employeeId)?.needsFollowUp) {
    await db
      .update(workflowNotificationEmails)
      .set({
        status: "Skipped",
        lastError: "Attendance or request changed before sending.",
        updatedAt: new Date(),
      })
      .where(eq(workflowNotificationEmails.notificationId, notificationId));
    await db
      .update(notifications)
      .set({ status: "Dismissed", dismissedAt: new Date().toISOString(), updatedAt: new Date() })
      .where(eq(notifications.id, notificationId));
    return { sent: false };
  }
  try {
    const token = await calendarAccessToken(
      decryptSensitiveJson<string>(sender.refreshTokenEncrypted),
    );
    const reference = await sendWorkflowEmail(
      token,
      recipient.email,
      notificationId,
      sender.accountEmail,
      undefined,
      {
        title: "Please confirm your attendance today",
        message: ATTENDANCE_FOLLOW_UP_MESSAGE,
        path: "/staff/me/attendance",
        type: "attendance.morning_follow_up",
      },
    );
    await db
      .update(workflowNotificationEmails)
      .set({
        status: "Sent",
        providerMessageId: reference,
        sentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(workflowNotificationEmails.notificationId, notificationId));
    return { sent: true };
  } catch (error) {
    const outcome = error instanceof WorkflowEmailError ? error.outcome : "Uncertain";
    const message =
      error instanceof Error ? error.message : "The send result is unknown. Check Sent mail.";
    await db
      .update(workflowNotificationEmails)
      .set({
        status: outcome === "Queued" ? "Uncertain" : outcome,
        lastError: message,
        updatedAt: new Date(),
      })
      .where(eq(workflowNotificationEmails.notificationId, notificationId));
    throw new Error(message);
  }
}
