import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";
import { resolveOrganisationIdForActor, verifyServerActorRole } from "../db/utils.server.ts";
import {
  decideTimesheetInDatabase,
  generateTimesheetPeriodsInDatabase,
  getOrCreateTimesheetInDatabase,
  listTimesheetSnapshotForActor,
  lockTimesheetForPayrollInDatabase,
  reopenTimesheetInDatabase,
  saveTimesheetEntryInDatabase,
  saveTimesheetDraftInDatabase,
  submitTimesheetInDatabase,
  setTimesheetPeriodStatusInDatabase,
  updateTimesheetSettingsInDatabase,
} from "../db/repositories/timesheet.repository.server.ts";
import { ROLE_VALUES } from "../data/types.ts";

const Actor = z.object({
  actorId: z.string().min(1),
  actorEmail: z.string().email().optional(),
  activeRole: z.enum(ROLE_VALUES),
});
async function verify(actor: z.infer<typeof Actor>) {
  const organisationId = await resolveOrganisationIdForActor(actor.actorId, actor.actorEmail);
  const result = await verifyServerActorRole(
    organisationId,
    actor.actorId,
    undefined,
    actor.actorEmail,
  );
  if (!result.verified || !result.actor?.roles.includes(actor.activeRole))
    throw new Error("Your VIA access could not be verified.");
  return { organisationId, actor: { ...result.actor, activeRole: actor.activeRole } };
}

const Entry = z
  .object({
    actor: Actor,
    timesheetId: z.string().uuid(),
    workDate: z.string().date(),
    projectId: z.string().uuid(),
    costCentreId: z.string().uuid(),
    activityCodeId: z.string().uuid(),
    locationId: z.string().uuid(),
    hours: z.number().positive().max(24),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();
export const saveTimesheetEntryFn = createServerFn({ method: "POST" })
  .validator((input) => Entry.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return saveTimesheetEntryInDatabase(
      v.organisationId,
      {
        timesheetId: data.timesheetId,
        workDate: data.workDate,
        projectId: data.projectId,
        costCentreId: data.costCentreId,
        activityCodeId: data.activityCodeId,
        locationId: data.locationId,
        hours: data.hours,
        ...(data.notes ? { notes: data.notes } : {}),
      },
      v.actor,
    );
  });

const Submit = z.object({ actor: Actor, timesheetId: z.string().uuid() }).strict();
export const submitTimesheetFn = createServerFn({ method: "POST" })
  .validator((input) => Submit.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return submitTimesheetInDatabase(v.organisationId, data.timesheetId, v.actor);
  });

const Decide = z
  .object({
    actor: Actor,
    timesheetId: z.string().uuid(),
    decision: z.enum(["approve", "return"]),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();
export const decideTimesheetFn = createServerFn({ method: "POST" })
  .validator((input) => Decide.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return decideTimesheetInDatabase(
      v.organisationId,
      data.timesheetId,
      data.decision,
      data.notes,
      v.actor,
    );
  });

export const getTimesheetSnapshotFn = createServerFn({ method: "GET" })
  .validator((input) => z.object({ actor: Actor }).strict().parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return listTimesheetSnapshotForActor(v.organisationId, v.actor);
  });

const Settings = z
  .object({
    actor: Actor,
    settings: z
      .object({
        weeklyPeriodStartDay: z.number().int().min(0).max(6),
        standardDailyHours: z.number().positive().max(24),
        submissionDeadlineDays: z.number().int().min(0).max(30),
        overtimeThresholdWeekly: z.number().positive().max(168),
        allowCopyPreviousWeek: z.boolean(),
        payrollLockBehaviour: z.enum(["Manual by HR", "Automatic on Approval"]),
        requireHrOvertimeVerification: z.boolean(),
        overtimePreauthorisationRequired: z.boolean(),
        overtimeMaxDailyHours: z.number().positive().max(24),
        overtimeMaxWeeklyHours: z.number().positive().max(168),
        overtimeMaxMonthlyHours: z.number().positive().max(744),
        attendanceVarianceToleranceHours: z.number().min(0).max(2),
      })
      .strict(),
  })
  .strict();
export const updateTimesheetSettingsFn = createServerFn({ method: "POST" })
  .validator((input) => Settings.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return updateTimesheetSettingsInDatabase(v.organisationId, data.settings, v.actor);
  });

const Generate = z
  .object({ actor: Actor, startDate: z.string().date(), endDate: z.string().date() })
  .strict();
export const generateTimesheetPeriodsFn = createServerFn({ method: "POST" })
  .validator((input) => Generate.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return generateTimesheetPeriodsInDatabase(
      v.organisationId,
      data.startDate,
      data.endDate,
      v.actor,
    );
  });

const Start = z
  .object({ actor: Actor, employeeId: z.string().uuid(), periodId: z.string().uuid() })
  .strict();
export const getOrCreateTimesheetFn = createServerFn({ method: "POST" })
  .validator((input) => Start.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return getOrCreateTimesheetInDatabase(
      v.organisationId,
      data.employeeId,
      data.periodId,
      v.actor,
    );
  });

const DraftEntry = z
  .object({
    id: z.string().min(1).max(100),
    projectId: z.string().uuid().optional(),
    costCentreId: z.string().uuid().optional(),
    activityCodeId: z.string().uuid().optional(),
    locationId: z.string().uuid().optional(),
    hours: z.record(z.string().date(), z.number().min(0).max(24)),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();
const Draft = z
  .object({
    actor: Actor,
    timesheetId: z.string().uuid(),
    entries: z.array(DraftEntry).max(500),
    explanations: z.record(z.string(), z.string().trim().max(2000)),
  })
  .strict();
export const saveTimesheetDraftFn = createServerFn({ method: "POST" })
  .validator((input) => Draft.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return saveTimesheetDraftInDatabase(
      v.organisationId,
      data.timesheetId,
      data.entries.map((entry) => ({
        id: entry.id,
        ...(entry.projectId ? { projectId: entry.projectId } : {}),
        ...(entry.costCentreId ? { costCentreId: entry.costCentreId } : {}),
        ...(entry.activityCodeId ? { activityCodeId: entry.activityCodeId } : {}),
        ...(entry.locationId ? { locationId: entry.locationId } : {}),
        hours: entry.hours,
        ...(entry.notes ? { notes: entry.notes } : {}),
      })),
      data.explanations,
      v.actor,
    );
  });

const PeriodStatus = z
  .object({
    actor: Actor,
    periodId: z.string().uuid(),
    status: z.enum(["Open", "Closed"]),
    reason: z.string().trim().max(2000).optional(),
  })
  .strict();
export const setTimesheetPeriodStatusFn = createServerFn({ method: "POST" })
  .validator((input) => PeriodStatus.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return setTimesheetPeriodStatusInDatabase(
      v.organisationId,
      data.periodId,
      data.status,
      data.reason ?? undefined,
      v.actor,
    );
  });

const SheetAction = z
  .object({
    actor: Actor,
    timesheetId: z.string().uuid(),
    reason: z.string().trim().max(2000).optional(),
  })
  .strict();
export const lockTimesheetForPayrollFn = createServerFn({ method: "POST" })
  .validator((input) => SheetAction.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return lockTimesheetForPayrollInDatabase(v.organisationId, data.timesheetId, v.actor);
  });
export const reopenTimesheetFn = createServerFn({ method: "POST" })
  .validator((input) =>
    SheetAction.extend({ reason: z.string().trim().min(5).max(2000) }).parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return reopenTimesheetInDatabase(v.organisationId, data.timesheetId, data.reason, v.actor);
  });
