import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";
import { canChangeCompanySettings } from "../auth/company-setup-policy.ts";
import { and, asc, eq, isNull } from "drizzle-orm";

import { getDatabaseClient } from "../db/client.ts";
import { getAppSettings, saveAppSettings } from "../db/repositories/settings.repository.server.ts";
import { getApprovalRoutingSettingsInDatabase } from "../db/repositories/approval-routing.repository.server.ts";
import { assignExistingHrOwnRequestsToConfiguredReviewerInDatabase } from "../db/repositories/independent-hr-review.repository.server.ts";
import {
  listPendingIndependentHrReviewsInDatabase,
  reassignPendingIndependentHrReviewInDatabase,
} from "../db/repositories/independent-hr-reassignment.repository.server.ts";
import { reconcileAnnualCarryExpiryInDatabase } from "../db/repositories/leave.repository.server.ts";
import { auditEvents } from "../db/schema/system.ts";
import { employees, users } from "../db/schema/employee.ts";
import {
  resolveDefaultOrganisationId,
  resolveOrganisationIdForActor,
  verifyServerActorRole,
} from "../db/utils.server.ts";
import type { AppSettings } from "../data/types.ts";

const AppSettingsInputSchema = z.object({
  organisationName: z.string().trim().min(1, "Organisation name is required").max(100),
  timezone: z.string().trim().min(1, "Timezone is required"),
  baseCurrency: z.string().trim().length(3, "Currency code must be 3 characters").toUpperCase(),
  workingDays: z.array(z.number().int().min(0).max(6)).min(1, "Select at least one working day"),
  standardDailyHours: z.number().positive().max(24, "Daily hours cannot exceed 24"),
  standardWeeklyHours: z.number().positive().max(168, "Weekly hours cannot exceed 168"),
  probationDurationMonths: z.number().int().min(0).max(36),
  leaveYearStart: z.string().regex(/^\d{2}-\d{2}$/, "Format must be MM-DD"),
  leaveIncludesWeekends: z.boolean().optional(),
  annualCarryExpiryDates: z
    .record(
      z.string().regex(/^\d{4}$/),
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable(),
    )
    .optional(),
  annualCarryExpiryMonthDay: z
    .string()
    .regex(/^\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  approvalRouting: z
    .object({
      hrOwnRequestReviewerEmployeeId: z.string().uuid().nullable(),
      managerlessExecutiveTravelReviewerRole: z.enum(["Accounts", "HR"]),
      managerlessExecutiveTravelNotifyHr: z.boolean(),
      managerlessExecutiveAttendanceReviewerEmployeeId: z.string().uuid().nullable(),
    })
    .optional(),
  leaveYearEnd: z.string().regex(/^\d{2}-\d{2}$/, "Format must be MM-DD"),
  documentReminderDays: z.array(z.number().int().min(1).max(3650)),
  employeeNumberFormat: z.string().min(1).includes("{0000}", { message: "Must include {0000}" }),
  candidateReferenceFormat: z
    .string()
    .min(1)
    .includes("{00000}", { message: "Must include {00000}" }),
  requireOnboardingCompletionBeforeDashboard: z.boolean().optional().default(true),
  id: z.string().optional(),
  createdAt: z.string().optional(),
  createdBy: z.string().optional(),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
  archivedAt: z.string().optional(),
  recordVersion: z.number().int().optional(),
  schemaVersion: z.number().int().optional(),
});

export const getAppSettingsFn = createServerFn({ method: "GET" })
  .validator((input: Record<string, never> = {}) => input)
  .handler(async (): Promise<AppSettings> => {
    const orgId = await resolveDefaultOrganisationId();
    return getAppSettings(orgId);
  });

/** Lightweight, authorised choices for an independently assigned reviewer. */
export const getApprovalRoutingOptionsFn = createServerFn({ method: "POST" })
  .validator((input: { actorId: string; actorEmail?: string }) =>
    z
      .object({ actorId: z.string().min(1), actorEmail: z.string().email().optional() })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const orgId = await resolveOrganisationIdForActor(data.actorId, data.actorEmail);
    const { verified, actor } = await verifyServerActorRole(
      orgId,
      data.actorId,
      undefined,
      data.actorEmail,
    );
    if (!verified || !actor || !actor.roles.some((role) => role === "HR" || role === "Super Admin"))
      throw new Error("Only HR or Super Admin can view approval routing choices.");
    return getDatabaseClient()
      .select({
        employeeId: employees.id,
        name: employees.preferredName,
        legalName: employees.legalName,
        workEmail: employees.workEmail,
      })
      .from(employees)
      .innerJoin(
        users,
        and(
          eq(users.organisationId, orgId),
          eq(users.employeeId, employees.id),
          eq(users.status, "Active"),
          isNull(users.archivedAt),
        ),
      )
      .where(
        and(
          eq(employees.organisationId, orgId),
          eq(employees.status, "Active"),
          isNull(employees.archivedAt),
        ),
      )
      .orderBy(asc(employees.preferredName), asc(employees.legalName));
  });

/** Existing waiting requests are changed only after a separate Super Admin confirmation. */
export const assignExistingHrOwnRequestsFn = createServerFn({ method: "POST" })
  .validator((input: { actorId: string; actorEmail?: string }) =>
    z
      .object({ actorId: z.string().min(1), actorEmail: z.string().email().optional() })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const orgId = await resolveOrganisationIdForActor(data.actorId, data.actorEmail);
    const { verified, actor } = await verifyServerActorRole(
      orgId,
      data.actorId,
      undefined,
      data.actorEmail,
    );
    if (!verified || !actor || !actor.roles.includes("Super Admin") || actor.roles.includes("HR"))
      throw new Error("An independent Super Admin must assign existing HR requests.");
    const routing = await getApprovalRoutingSettingsInDatabase(orgId);
    if (!routing.hrOwnRequestReviewerEmployeeId)
      throw new Error("Save an independent HR reviewer before assigning existing requests.");
    return assignExistingHrOwnRequestsToConfiguredReviewerInDatabase(orgId, {
      ...actor,
      activeRole: "Super Admin",
    });
  });

/** A named reviewer is changed only by a separate, explicit Super Admin action. */
export const getPendingIndependentHrReviewsFn = createServerFn({ method: "POST" })
  .validator((input: { actorId: string; actorEmail?: string }) =>
    z
      .object({ actorId: z.string().min(1), actorEmail: z.string().email().optional() })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const orgId = await resolveOrganisationIdForActor(data.actorId, data.actorEmail);
    const { verified, actor } = await verifyServerActorRole(
      orgId,
      data.actorId,
      undefined,
      data.actorEmail,
    );
    if (!verified || !actor || !actor.roles.includes("Super Admin") || actor.roles.includes("HR"))
      throw new Error("An independent Super Admin must manage HR review assignments.");
    return listPendingIndependentHrReviewsInDatabase(orgId);
  });

export const reassignPendingIndependentHrReviewFn = createServerFn({ method: "POST" })
  .validator(
    (input: {
      actorId: string;
      actorEmail?: string;
      module:
        | "Leave"
        | "Timesheet"
        | "Attendance Correction"
        | "Overtime"
        | "Training"
        | "Visit"
        | "Time Away"
        | "Document"
        | "Training Certificate"
        | "Employment Confirmation";
      requestId: string;
      newReviewerEmployeeId: string;
    }) =>
      z
        .object({
          actorId: z.string().min(1),
          actorEmail: z.string().email().optional(),
          module: z.enum([
            "Leave",
            "Timesheet",
            "Attendance Correction",
            "Overtime",
            "Training",
            "Visit",
            "Time Away",
            "Document",
            "Training Certificate",
            "Employment Confirmation",
          ]),
          requestId: z.string().uuid(),
          newReviewerEmployeeId: z.string().uuid(),
        })
        .parse(input),
  )
  .handler(async ({ data }) => {
    const orgId = await resolveOrganisationIdForActor(data.actorId, data.actorEmail);
    const { verified, actor } = await verifyServerActorRole(
      orgId,
      data.actorId,
      undefined,
      data.actorEmail,
    );
    if (!verified || !actor || !actor.roles.includes("Super Admin") || actor.roles.includes("HR"))
      throw new Error("An independent Super Admin must reassign HR requests.");
    await reassignPendingIndependentHrReviewInDatabase(
      orgId,
      data.module,
      data.requestId,
      data.newReviewerEmployeeId,
      { ...actor, activeRole: "Super Admin" },
    );
    return { reassigned: true };
  });

export const saveAppSettingsFn = createServerFn({ method: "POST" })
  .validator(
    (input: {
      settings: z.infer<typeof AppSettingsInputSchema>;
      actorId: string;
      actorEmail?: string;
    }) => {
      return z
        .object({
          settings: AppSettingsInputSchema,
          actorId: z.string().min(1),
          actorEmail: z.string().email().optional(),
        })
        .parse(input);
    },
  )
  .handler(async ({ data }): Promise<AppSettings> => {
    const orgId = await resolveOrganisationIdForActor(data.actorId, data.actorEmail);
    const previous = await getAppSettings(orgId);

    // Verify actor in database
    const { verified, actor, error } = await verifyServerActorRole(
      orgId,
      data.actorId,
      undefined,
      data.actorEmail,
    );
    if (!verified || !actor) {
      const db = getDatabaseClient();
      await db.insert(auditEvents).values({
        organisationId: orgId,
        actorUserId: data.actorId,
        actorDisplayName: "Unverified Actor",
        activeRole: "Employee",
        action: "access-denied",
        module: "settings",
        entityType: "app_settings",
        entityId: previous.id,
        reason: error ?? "Unverified actor attempting to save settings.",
        riskLevel: "High",
      });
      throw new Error(`Unauthorized: ${error ?? "Actor is not authorized."}`);
    }

    const ignored = new Set([
      "updatedAt",
      "updatedBy",
      "recordVersion",
      "createdAt",
      "createdBy",
      "id",
      "organisationId",
    ]);

    const changedKeys = Object.keys(data.settings).filter(
      (key) =>
        !ignored.has(key) &&
        JSON.stringify(data.settings[key as keyof AppSettings]) !==
          JSON.stringify(previous[key as keyof AppSettings]),
    );

    if (!canChangeCompanySettings(actor.roles, changedKeys)) {
      const db = getDatabaseClient();
      await db.insert(auditEvents).values({
        organisationId: orgId,
        actorUserId: actor.userId,
        actorDisplayName: actor.displayName,
        activeRole: actor.activeRole,
        action: "access-denied",
        module: "settings",
        entityType: "app_settings",
        entityId: previous.id,
        reason: "This setting is outside your company setup responsibilities.",
        riskLevel: "High",
      });
      throw new Error("This setting is outside your company setup responsibilities.");
    }

    const { settings } = data;
    try {
      new Intl.DateTimeFormat("en", { timeZone: settings.timezone }).format();
    } catch {
      throw new Error("Enter a valid IANA timezone, such as Asia/Muscat.");
    }

    if (
      settings.workingDays.length === 0 ||
      settings.workingDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
      new Set(settings.workingDays).size !== settings.workingDays.length
    ) {
      throw new Error("Select at least one valid working day without duplicates.");
    }

    if (settings.standardWeeklyHours < settings.standardDailyHours) {
      throw new Error("Standard weekly hours must be between the daily hours and 168.");
    }

    const validMonthDay = (value: string) => {
      const match = /^(\d{2})-(\d{2})$/.exec(value);
      if (!match) return false;
      const month = Number(match[1]);
      const day = Number(match[2]);
      const parsed = new Date(Date.UTC(2024, month - 1, day));
      return parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
    };

    if (!validMonthDay(settings.leaveYearStart) || !validMonthDay(settings.leaveYearEnd)) {
      throw new Error("Leave year dates must use valid MM-DD values.");
    }
    if (
      settings.annualCarryExpiryMonthDay &&
      (!validMonthDay(settings.annualCarryExpiryMonthDay) ||
        settings.annualCarryExpiryMonthDay === "02-29")
    )
      throw new Error("Enter a valid annual carry expiry month and day.");
    for (const [year, expiry] of Object.entries(settings.annualCarryExpiryDates ?? {})) {
      if (!expiry) continue;
      const parsed = new Date(`${expiry}T00:00:00Z`);
      if (
        Number(year) < 2000 ||
        Number(year) > 2200 ||
        !Number.isFinite(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== expiry ||
        expiry < `${Number(year) + 1}-${settings.leaveYearStart}` ||
        expiry >= `${Number(year) + 2}-${settings.leaveYearStart}`
      )
        throw new Error("Carry expiry dates must fall within the following leave year.");
    }

    if (settings.leaveYearStart === settings.leaveYearEnd) {
      throw new Error("Leave year start and end dates must be different.");
    }

    if (new Set(settings.documentReminderDays).size !== settings.documentReminderDays.length) {
      throw new Error("Document reminder days must be unique whole numbers between 1 and 3650.");
    }

    const completeSettings: AppSettings = {
      ...previous,
      ...settings,
      approvalRouting: settings.approvalRouting ?? previous.approvalRouting,
      id: previous.id,
      createdAt: settings.createdAt ?? previous.createdAt ?? new Date().toISOString(),
      createdBy: settings.createdBy ?? previous.createdBy ?? actor.userId,
      updatedAt: new Date().toISOString(),
      updatedBy: actor.userId,
      recordVersion: (settings.recordVersion ?? previous.recordVersion ?? 1) + 1,
      baseCurrency: settings.baseCurrency.toUpperCase(),
      schemaVersion: settings.schemaVersion ?? previous.schemaVersion ?? 1,
    };

    const saved = await saveAppSettings(orgId, completeSettings, {
      ...actor,
      activeRole: actor.roles.includes("Super Admin") ? "Super Admin" : "HR",
    });
    if (
      changedKeys.includes("annualCarryExpiryDates") ||
      changedKeys.includes("annualCarryExpiryMonthDay")
    )
      await reconcileAnnualCarryExpiryInDatabase(orgId, actor);
    return saved;
  });
