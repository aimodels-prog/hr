import "@tanstack/react-start/server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDatabaseClient } from "../client.ts";
import { employeeDocuments } from "../schema/documents.ts";
import { employees, roles, userRoles, users } from "../schema/employee.ts";
import { appSettings, organisations } from "../schema/organisation.ts";
import { onboardingCases } from "../schema/onboarding-offboarding.ts";
import { auditEvents, notifications } from "../schema/system.ts";

const ANNIVERSARY_THRESHOLDS = [30, 14, 7, 1, 0] as const;
const OVERDUE_DOCUMENT_THRESHOLDS = [0, -1, -7, -14, -30, -60, -90] as const;

function calendarDate(timezone: string, date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dayDifference(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function anniversaryForYear(startDate: string, year: number): string {
  return `${year}-${startDate.slice(5, 10)}`;
}

async function createNotification(
  organisationId: string,
  recipientUserId: string,
  createdBy: string,
  values: {
    type: string;
    title: string;
    message: string;
    priority: "Normal" | "High" | "Critical";
    key: string;
    entityType: string;
    entityId: string;
    path: string;
  },
): Promise<boolean> {
  const rows = await getDatabaseClient()
    .insert(notifications)
    .values({
      organisationId,
      recipientUserId,
      type: values.type,
      title: values.title,
      message: values.message,
      priority: values.priority,
      status: "Unread",
      deduplicationKey: values.key,
      link: { entityType: values.entityType, entityId: values.entityId, path: values.path },
      createdBy,
      updatedBy: createdBy,
    } as typeof notifications.$inferInsert)
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  return rows.length > 0;
}

export async function processCoreHrScheduledReminders(now = new Date()): Promise<{
  organisations: number;
  documentNotifications: number;
  anniversaryNotifications: number;
  employeesActivated: number;
}> {
  const db = getDatabaseClient();
  const orgRows = await db
    .select({ organisation: organisations, settings: appSettings })
    .from(organisations)
    .innerJoin(appSettings, eq(appSettings.organisationId, organisations.id))
    .where(eq(organisations.isActive, true));
  let documentNotifications = 0;
  let anniversaryNotifications = 0;
  let employeesActivated = 0;

  for (const { organisation, settings } of orgRows) {
    let organisationDocumentNotifications = 0;
    let organisationAnniversaryNotifications = 0;
    let organisationEmployeesActivated = 0;
    const today = calendarDate(settings.timezone, now);
    const [employeeRows, userRows, hrRows, documentRows] = await Promise.all([
      db
        .select()
        .from(employees)
        .where(
          and(
            eq(employees.organisationId, organisation.id),
            isNull(employees.archivedAt),
            inArray(employees.status, ["Onboarding", "Active", "Probation", "Notice"]),
          ),
        ),
      db
        .select()
        .from(users)
        .where(and(eq(users.organisationId, organisation.id), eq(users.status, "Active"))),
      db
        .select({ userId: users.id })
        .from(users)
        .innerJoin(userRoles, eq(userRoles.userId, users.id))
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(
          and(
            eq(users.organisationId, organisation.id),
            eq(users.status, "Active"),
            eq(roles.code, "HR"),
          ),
        ),
      db
        .select()
        .from(employeeDocuments)
        .where(
          and(
            eq(employeeDocuments.organisationId, organisation.id),
            isNull(employeeDocuments.archivedAt),
            inArray(employeeDocuments.status, ["Pending Verification", "Valid"]),
          ),
        ),
    ]);
    const userByEmployee = new Map(userRows.map((user) => [user.employeeId, user]));
    const employeeById = new Map(employeeRows.map((employee) => [employee.id, employee]));
    const hrUserIds = [...new Set(hrRows.map((row) => row.userId))];

    const readyEmployees = await db
      .select({ employeeId: employees.id, preferredName: employees.preferredName })
      .from(employees)
      .innerJoin(onboardingCases, eq(onboardingCases.employeeId, employees.id))
      .where(
        and(
          eq(employees.organisationId, organisation.id),
          eq(employees.status, "Onboarding"),
          sql`${employees.startDate} <= ${today}`,
          eq(onboardingCases.status, "Completed"),
          isNull(onboardingCases.archivedAt),
        ),
      );
    for (const employee of readyEmployees) {
      const updated = await db
        .update(employees)
        .set({
          status: "Active",
          updatedAt: new Date(),
          updatedBy: organisation.createdBy,
          recordVersion: sql`${employees.recordVersion} + 1`,
        })
        .where(and(eq(employees.id, employee.employeeId), eq(employees.status, "Onboarding")))
        .returning({ id: employees.id });
      if (!updated.length) continue;
      employeesActivated++;
      organisationEmployeesActivated++;
      const employeeUser = userByEmployee.get(employee.employeeId);
      if (employeeUser) {
        await createNotification(organisation.id, employeeUser.id, organisation.createdBy, {
          type: "onboarding_complete",
          title: "Welcome to VIA",
          message: "Your onboarding checklist is complete and your employee record is now active.",
          priority: "High",
          key: `employee-activated-${employee.employeeId}`,
          entityType: "employee",
          entityId: employee.employeeId,
          path: "/staff",
        });
      }
    }

    const documentThresholds = [
      ...new Set([
        ...settings.documentReminderDays.filter((day) => Number.isInteger(day) && day > 0),
        ...OVERDUE_DOCUMENT_THRESHOLDS,
      ]),
    ];
    for (const document of documentRows) {
      if (
        !document.expiryDate ||
        document.waiverReason ||
        (document.snoozedUntil && document.snoozedUntil > today)
      )
        continue;
      const employee = employeeById.get(document.employeeId);
      if (!employee) continue;
      const daysRemaining = dayDifference(today, document.expiryDate);
      const reached = documentThresholds.filter((threshold) => daysRemaining <= threshold);
      const recipients = new Set(hrUserIds);
      const employeeUser = userByEmployee.get(employee.id);
      if (employeeUser) recipients.add(employeeUser.id);
      if (employee.lineManagerId && daysRemaining <= 30) {
        const managerUser = userByEmployee.get(employee.lineManagerId);
        if (managerUser) recipients.add(managerUser.id);
      }
      for (const threshold of reached) {
        for (const recipientUserId of recipients) {
          const created = await createNotification(
            organisation.id,
            recipientUserId,
            organisation.createdBy,
            {
              type: "document_expiry",
              title:
                daysRemaining <= 0
                  ? "Employee document has expired"
                  : "Employee document expiry reminder",
              message: `${employee.preferredName}'s ${document.type.replaceAll("_", " ")} expires on ${document.expiryDate}. ${daysRemaining <= 0 ? `${Math.abs(daysRemaining)} day(s) overdue.` : `${daysRemaining} day(s) remaining.`}`,
              priority: daysRemaining <= 0 ? "Critical" : daysRemaining <= 30 ? "High" : "Normal",
              key: `document-expiry-${document.id}-${threshold}-${recipientUserId}`,
              entityType: "employee-document",
              entityId: document.id,
              path: "/staff/document-expiry",
            },
          );
          if (created) {
            documentNotifications++;
            organisationDocumentNotifications++;
          }
        }
      }
    }

    const year = Number(today.slice(0, 4));
    for (const employee of employeeRows) {
      let anniversaryDate = anniversaryForYear(employee.startDate, year);
      let years = year - Number(employee.startDate.slice(0, 4));
      if (dayDifference(today, anniversaryDate) < -14) {
        anniversaryDate = anniversaryForYear(employee.startDate, year + 1);
        years++;
      }
      if (years < 1) continue;
      const daysRemaining = dayDifference(today, anniversaryDate);
      const reached = ANNIVERSARY_THRESHOLDS.filter(
        (threshold) => daysRemaining <= threshold && daysRemaining >= -14,
      );
      if (!reached.length) continue;
      const recipients = new Set(hrUserIds);
      const employeeUser = userByEmployee.get(employee.id);
      if (employeeUser) recipients.add(employeeUser.id);
      const managerUser = employee.lineManagerId
        ? userByEmployee.get(employee.lineManagerId)
        : undefined;
      if (managerUser) recipients.add(managerUser.id);
      for (const threshold of reached) {
        for (const recipientUserId of recipients) {
          const created = await createNotification(
            organisation.id,
            recipientUserId,
            organisation.createdBy,
            {
              type: "work_anniversary",
              title: `${employee.preferredName}'s ${years}-year VIA anniversary`,
              message: `${employee.preferredName} reaches ${years} year(s) with VIA on ${anniversaryDate}.`,
              priority: "Normal",
              key: `anniversary-${employee.id}-${years}-${threshold}-${recipientUserId}`,
              entityType: "employee",
              entityId: employee.id,
              path: "/staff/anniversaries",
            },
          );
          if (created) {
            anniversaryNotifications++;
            organisationAnniversaryNotifications++;
          }
        }
      }
    }

    if (
      organisationDocumentNotifications ||
      organisationAnniversaryNotifications ||
      organisationEmployeesActivated
    ) {
      await db.insert(auditEvents).values({
        organisationId: organisation.id,
        actorUserId: organisation.createdBy,
        actorDisplayName: "VIA background worker",
        activeRole: "Super Admin",
        actorRoles: ["Super Admin"],
        action: "process-reminders",
        module: "core-hr",
        entityType: "organisation",
        entityId: organisation.id,
        afterSummary: {
          documentNotifications: organisationDocumentNotifications,
          anniversaryNotifications: organisationAnniversaryNotifications,
          employeesActivated: organisationEmployeesActivated,
          date: today,
        },
        reason: "Processed scheduled document and work-anniversary reminders",
        riskLevel: "Low",
      } as typeof auditEvents.$inferInsert);
    }
  }
  return {
    organisations: orgRows.length,
    documentNotifications,
    anniversaryNotifications,
    employeesActivated,
  };
}
