import "@tanstack/react-start/server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import { getDatabaseClient } from "../client.ts";
import { appSettings, organisations } from "../schema/organisation.ts";
import { employees, users } from "../schema/employee.ts";
import { auditEvents } from "../schema/system.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";
import type { AppSettings } from "../../data/types.ts";
import { syncWorkingHours } from "./working-hours.repository.server.ts";
import { parseApprovalRoutingSettings } from "../../data/approval-routing-settings.ts";

function mapAppSettings(
  settingsRow: typeof appSettings.$inferSelect,
  orgRow: typeof organisations.$inferSelect,
): AppSettings {
  return {
    id: settingsRow.id,
    createdAt: settingsRow.createdAt?.toISOString() ?? new Date().toISOString(),
    createdBy: settingsRow.createdBy,
    updatedAt: settingsRow.updatedAt?.toISOString() ?? new Date().toISOString(),
    updatedBy: settingsRow.updatedBy,
    archivedAt: settingsRow.archivedAt?.toISOString() ?? undefined,
    recordVersion: settingsRow.recordVersion ?? 1,
    organisationName: orgRow.name,
    timezone: settingsRow.timezone,
    baseCurrency: settingsRow.baseCurrency,
    workingDays: settingsRow.workingDays ?? [],
    standardDailyHours: Number(settingsRow.standardDailyHours),
    standardWeeklyHours: Number(settingsRow.standardWeeklyHours),
    probationDurationMonths: settingsRow.probationDurationMonths ?? 3,
    leaveYearStart: settingsRow.leaveYearStart,
    leaveIncludesWeekends: settingsRow.additionalSettings["leaveIncludesWeekends"] !== false,
    annualCarryExpiryDates: (settingsRow.additionalSettings["annualCarryExpiryDates"] ??
      {}) as Record<string, string | null>,
    annualCarryExpiryMonthDay: (settingsRow.additionalSettings["annualCarryExpiryMonthDay"] ??
      null) as string | null,
    approvalRouting: parseApprovalRoutingSettings(
      settingsRow.additionalSettings["approvalRouting"],
    ),
    leaveYearEnd: settingsRow.leaveYearEnd,
    documentReminderDays: settingsRow.documentReminderDays ?? [],
    employeeNumberFormat: settingsRow.employeeNumberFormat,
    candidateReferenceFormat: settingsRow.candidateReferenceFormat,
    schemaVersion: settingsRow.schemaVersion ?? 1,
    requireOnboardingCompletionBeforeDashboard:
      settingsRow.requireOnboardingCompletionBeforeDashboard ?? true,
  };
}

export async function getAppSettings(orgId: string): Promise<AppSettings> {
  const db = getDatabaseClient();
  const [settingsRow] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.organisationId, orgId));

  const [orgRow] = await db.select().from(organisations).where(eq(organisations.id, orgId));

  if (!settingsRow || !orgRow) {
    throw new Error("Application settings have not been initialised.");
  }

  return mapAppSettings(settingsRow, orgRow);
}

export async function saveAppSettings(
  orgId: string,
  settings: AppSettings,
  actor: AuditActorContext,
): Promise<AppSettings> {
  const db = getDatabaseClient();

  return db.transaction(async (tx) => {
    await syncWorkingHours(
      tx,
      orgId,
      settings.standardDailyHours,
      actor,
      "company",
      settings.standardWeeklyHours,
    );
    const now = new Date();

    const [existing] = await tx
      .select()
      .from(appSettings)
      .where(eq(appSettings.organisationId, orgId));
    const [existingOrg] = await tx.select().from(organisations).where(eq(organisations.id, orgId));
    if (!existing || !existingOrg) {
      throw new Error("Application settings have not been initialised.");
    }
    const previous = mapAppSettings(existing, existingOrg);
    const approvalRouting = parseApprovalRoutingSettings(settings.approvalRouting);
    const reviewerChanged =
      approvalRouting.hrOwnRequestReviewerEmployeeId !==
      parseApprovalRoutingSettings(previous.approvalRouting).hrOwnRequestReviewerEmployeeId;
    if (reviewerChanged && !actor.roles?.includes("Super Admin"))
      throw new Error("Only Super Admin can assign the independent reviewer for HR requests.");
    if (reviewerChanged && actor.roles?.includes("HR"))
      throw new Error("An HR team member cannot assign the reviewer for their own requests.");
    if (reviewerChanged && approvalRouting.hrOwnRequestReviewerEmployeeId) {
      if (approvalRouting.hrOwnRequestReviewerEmployeeId === actor.employeeId)
        throw new Error("Choose a colleague other than yourself to review your own HR requests.");
      const [reviewer] = await tx
        .select({ id: employees.id })
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
            eq(employees.id, approvalRouting.hrOwnRequestReviewerEmployeeId),
            eq(employees.status, "Active"),
            isNull(employees.archivedAt),
          ),
        )
        .limit(1);
      if (!reviewer)
        throw new Error("Choose an active colleague with VIA HR access for independent review.");
    }
    if (approvalRouting.managerlessExecutiveAttendanceReviewerEmployeeId) {
      const [attendanceReviewer] = await tx
        .select({ id: employees.id })
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
            eq(employees.id, approvalRouting.managerlessExecutiveAttendanceReviewerEmployeeId),
            eq(employees.status, "Active"),
            isNull(employees.archivedAt),
          ),
        )
        .limit(1);
      if (!attendanceReviewer)
        throw new Error("Choose an active colleague for executive attendance review.");
    }

    // Update organisation name
    await tx
      .update(organisations)
      .set({
        name: settings.organisationName,
        updatedAt: now,
        updatedBy: actor.userId ?? orgId,
      })
      .where(eq(organisations.id, orgId));

    // Update or insert app settings
    await tx
      .update(appSettings)
      .set({
        timezone: settings.timezone,
        baseCurrency: settings.baseCurrency,
        workingDays: settings.workingDays,
        standardDailyHours: String(settings.standardDailyHours),
        standardWeeklyHours: String(settings.standardWeeklyHours),
        probationDurationMonths: settings.probationDurationMonths,
        leaveYearStart: settings.leaveYearStart,
        additionalSettings: sql`${appSettings.additionalSettings} || ${JSON.stringify({
          leaveIncludesWeekends: settings.leaveIncludesWeekends !== false,
          annualCarryExpiryDates: settings.annualCarryExpiryDates ?? {},
          annualCarryExpiryMonthDay: settings.annualCarryExpiryMonthDay ?? null,
          approvalRouting,
        })}::jsonb`,
        leaveYearEnd: settings.leaveYearEnd,
        documentReminderDays: settings.documentReminderDays,
        employeeNumberFormat: settings.employeeNumberFormat,
        candidateReferenceFormat: settings.candidateReferenceFormat,
        requireOnboardingCompletionBeforeDashboard:
          settings.requireOnboardingCompletionBeforeDashboard,
        updatedAt: now,
        updatedBy: actor.userId ?? orgId,
        recordVersion: sql`${appSettings.recordVersion} + 1`,
      })
      .where(eq(appSettings.organisationId, orgId));

    const [updatedSettingsRow] = await tx
      .select()
      .from(appSettings)
      .where(eq(appSettings.organisationId, orgId));

    const [updatedOrgRow] = await tx
      .select()
      .from(organisations)
      .where(eq(organisations.id, orgId));

    if (!updatedSettingsRow || !updatedOrgRow) {
      throw new Error("Failed to retrieve updated organisation settings.");
    }

    const dto = mapAppSettings(updatedSettingsRow, updatedOrgRow);

    await tx.insert(auditEvents).values({
      organisationId: orgId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "update",
      module: "settings",
      entityType: "app_settings",
      entityId: updatedSettingsRow.id,
      beforeSummary: previous,
      afterSummary: dto,
      riskLevel: "High",
    });

    return dto;
  });
}

export async function getOrganisation(orgId: string) {
  const db = getDatabaseClient();
  const [orgRow] = await db.select().from(organisations).where(eq(organisations.id, orgId));
  return orgRow;
}
