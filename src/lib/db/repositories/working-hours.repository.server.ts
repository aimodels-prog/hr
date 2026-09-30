import "@tanstack/react-start/server-only";
import { eq, sql } from "drizzle-orm";
import type { getDatabaseClient } from "../client.ts";
import { appSettings } from "../schema/organisation.ts";
import { attendancePolicies, timesheetSettings } from "../schema/time.ts";
import { auditEvents } from "../schema/system.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";
import { VIA_OFFICE_SCHEDULE } from "../../data/office-schedule.ts";

type Transaction = Parameters<
  Parameters<ReturnType<typeof getDatabaseClient>["transaction"]>[0]
>[0];

/** All three settings entry points share this transaction and lock order. */
export async function syncWorkingHours(
  tx: Transaction,
  organisationId: string,
  hours: number,
  actor: AuditActorContext,
  source: "company" | "attendance" | "timesheets",
  weeklyHours?: number,
) {
  if (!actor.userId || !["HR", "Super Admin"].includes(actor.activeRole ?? ""))
    throw new Error("Only HR or a Super Admin can change working hours.");
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24)
    throw new Error("Enter working hours greater than zero and no more than 24.");
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`working-hours:${organisationId}`}, 0))`,
  );
  const [company] = await tx
    .select()
    .from(appSettings)
    .where(eq(appSettings.organisationId, organisationId))
    .for("update");
  if (company && hours > Number(weeklyHours ?? company.standardWeeklyHours))
    throw new Error(
      "Daily working hours cannot exceed company weekly hours. Update Company Setup first.",
    );
  const [attendance] = await tx
    .select()
    .from(attendancePolicies)
    .where(eq(attendancePolicies.organisationId, organisationId));
  const [timesheet] = await tx
    .select()
    .from(timesheetSettings)
    .where(eq(timesheetSettings.organisationId, organisationId));
  const before = {
    company: company?.standardDailyHours,
    attendance: attendance?.standardDailyHours,
    timesheets: timesheet?.standardDailyHours,
  };
  const value = String(hours);
  if (company && source !== "company")
    await tx
      .update(appSettings)
      .set({
        standardDailyHours: value,
        updatedBy: actor.userId,
        updatedAt: new Date(),
        recordVersion: sql`${appSettings.recordVersion} + 1`,
      })
      .where(eq(appSettings.organisationId, organisationId));
  if (source !== "attendance")
    await tx
      .insert(attendancePolicies)
      .values({
        organisationId,
        standardDailyHours: value,
        expectedClockIn: VIA_OFFICE_SCHEDULE.start,
        expectedClockOut: VIA_OFFICE_SCHEDULE.end,
        defaultBreakMinutes: VIA_OFFICE_SCHEDULE.breakMinutes,
        breakStart: VIA_OFFICE_SCHEDULE.breakStart,
        lateGraceMinutes: 5,
        maximumLocationAccuracyMeters: 100,
        signOutReminderOffsetsMinutes: [0, 15, 30],
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .onConflictDoUpdate({
        target: attendancePolicies.organisationId,
        set: {
          standardDailyHours: value,
          updatedBy: actor.userId,
          updatedAt: new Date(),
          recordVersion: sql`${attendancePolicies.recordVersion} + 1`,
        },
      });
  if (source !== "timesheets")
    await tx
      .insert(timesheetSettings)
      .values({
        organisationId,
        standardDailyHours: value,
        weeklyPeriodStartDay: company?.workingDays[0] ?? 1,
        submissionDeadlineDays: 2,
        overtimeThresholdWeekly: company?.standardWeeklyHours ?? "40",
        payrollLockBehaviour: "Manual by HR",
        attendanceVarianceToleranceHours: "0.25",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .onConflictDoUpdate({
        target: timesheetSettings.organisationId,
        set: {
          standardDailyHours: value,
          updatedBy: actor.userId,
          updatedAt: new Date(),
          recordVersion: sql`${timesheetSettings.recordVersion} + 1`,
        },
      });
  if (Object.values(before).some((previous) => Number(previous) !== hours))
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      action: "update",
      module: "settings",
      entityType: "working-hours",
      entityId: organisationId,
      beforeSummary: before,
      afterSummary: { standardDailyHours: hours },
      reason: "Synchronised company, attendance and timesheet working hours",
      riskLevel: "High",
    });
}
