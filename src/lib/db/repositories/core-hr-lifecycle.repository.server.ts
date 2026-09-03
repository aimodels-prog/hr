import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";

import type {
  OnboardingCase,
  OnboardingTemplate,
  OnboardingTemplateTask,
  OnboardingTask,
  OnboardingTaskStatus,
} from "../../data/onboarding-types.ts";
import type {
  OffboardingCase,
  OffboardingConfidentialityLevel,
  OffboardingReasonCategory,
  OffboardingTemplate,
  OffboardingTemplateTask,
  OffboardingTask,
  OffboardingTaskStatus,
} from "../../data/offboarding-types.ts";
import type { Employee, Role } from "../../data/types.ts";
import { getDatabaseClient } from "../client.ts";
import { decryptSensitiveJson, encryptSensitiveJson } from "../encryption.server.ts";
import { readObjectFile } from "../object-storage.server.ts";
import { employeeBankDetails, employees, users } from "../schema/employee.ts";
import { employeeDocuments, fileMetadata } from "../schema/documents.ts";
import {
  offboardingCases,
  offboardingTasks,
  offboardingTemplates,
  onboardingCases,
  onboardingTasks,
  onboardingTemplates,
  workflowTasks,
} from "../schema/onboarding-offboarding.ts";
import { auditEvents, notifications } from "../schema/system.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";
import {
  listEmployeesForOrganisation,
  listUsersForOrganisation,
} from "./employee.repository.server.ts";

type Database = ReturnType<typeof getDatabaseClient>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const MANAGER_ROLES: Role[] = ["HR", "Super Admin"];

function requiredIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function dateWithOffset(value: string, offset: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function recordFields(row: {
  id: string;
  createdAt: Date | string;
  createdBy: string;
  updatedAt: Date | string;
  updatedBy: string;
  archivedAt: Date | string | null;
  recordVersion: number;
}) {
  return {
    id: row.id,
    createdAt: requiredIso(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: requiredIso(row.updatedAt),
    updatedBy: row.updatedBy,
    ...(row.archivedAt ? { archivedAt: requiredIso(row.archivedAt) } : {}),
    recordVersion: row.recordVersion,
  };
}

function auditValues(
  organisationId: string,
  actor: AuditActorContext,
  action: string,
  entityType: string,
  entityId: string,
  reason: string,
  afterSummary?: Record<string, unknown>,
) {
  return {
    organisationId,
    actorUserId: actor.userId,
    actorEmployeeId: actor.employeeId,
    actorDisplayName: actor.displayName,
    activeRole: actor.activeRole ?? null,
    actorRoles: actor.roles ?? [actor.activeRole],
    action,
    module: entityType.startsWith("offboarding") ? "offboarding" : "onboarding",
    entityType,
    entityId,
    afterSummary: afterSummary ?? {},
    reason,
    riskLevel: "High" as const,
  };
}

const defaultOnboardingTasks: OnboardingTemplateTask[] = [
  {
    id: "personal-details",
    title: "Complete personal and emergency details",
    group: "Personal & Legal Documents",
    checkpoint: "Pre-Arrival",
    ownerRole: "Employee",
    offsetDaysFromStart: -7,
    isMandatory: true,
    requiresEvidence: false,
    selfServiceFormKey: "personal_details",
  },
  {
    id: "signed-contract",
    title: "Upload signed contract",
    group: "Contract & Payroll",
    checkpoint: "Pre-Arrival",
    ownerRole: "Employee",
    offsetDaysFromStart: -7,
    isMandatory: true,
    requiresEvidence: true,
    selfServiceFormKey: "document_upload",
    documentType: "contract",
  },
  {
    id: "passport-copy",
    title: "Upload passport copy",
    group: "Personal & Legal Documents",
    checkpoint: "Pre-Arrival",
    ownerRole: "Employee",
    offsetDaysFromStart: -7,
    isMandatory: true,
    requiresEvidence: true,
    selfServiceFormKey: "document_upload",
    documentType: "passport",
  },
  {
    id: "bank-details",
    title: "Provide salary bank details",
    group: "Contract & Payroll",
    checkpoint: "Pre-Arrival",
    ownerRole: "Employee",
    offsetDaysFromStart: -7,
    isMandatory: true,
    requiresEvidence: false,
    selfServiceFormKey: "bank_details",
    requiresBankDetails: true,
  },
  {
    id: "verify-contract",
    title: "Verify signed contract",
    group: "Contract & Payroll",
    checkpoint: "Pre-Arrival",
    ownerRole: "HR",
    offsetDaysFromStart: -5,
    isMandatory: true,
    requiresEvidence: false,
    verificationDocumentType: "contract",
    dependsOnTaskIds: ["signed-contract"],
  },
  {
    id: "manager-plan",
    title: "Prepare first-week plan",
    group: "Manager Plan",
    checkpoint: "Pre-Arrival",
    ownerRole: "Line Manager",
    offsetDaysFromStart: -3,
    isMandatory: true,
    requiresEvidence: false,
  },
];

const defaultOffboardingTasks: OffboardingTemplateTask[] = [
  {
    id: "handover",
    title: "Submit handover notes",
    group: "Manager Handover",
    ownerRole: "Employee",
    offsetDaysFromLastWorkingDate: -5,
    isMandatory: true,
    requiresEvidence: true,
  },
  {
    id: "projects",
    title: "Reassign active projects",
    group: "Project Reassignment",
    ownerRole: "Line Manager",
    offsetDaysFromLastWorkingDate: -3,
    isMandatory: true,
    requiresEvidence: false,
  },
  {
    id: "assets",
    title: "Return company equipment",
    group: "IT & Assets",
    ownerRole: "IT",
    offsetDaysFromLastWorkingDate: 0,
    isMandatory: true,
    requiresEvidence: false,
  },
  {
    id: "access",
    title: "Revoke system and building access",
    group: "Access & Security",
    ownerRole: "IT",
    offsetDaysFromLastWorkingDate: 0,
    isMandatory: true,
    requiresEvidence: false,
    dependsOnTaskIds: ["assets"],
  },
  {
    id: "reconcile",
    title: "Reconcile leave and attendance",
    group: "Leave & Attendance Reconciliation",
    ownerRole: "HR",
    offsetDaysFromLastWorkingDate: 0,
    isMandatory: true,
    requiresEvidence: false,
  },
  {
    id: "expenses",
    title: "Settle expenses and advances",
    group: "Expenses & Advances",
    ownerRole: "Accounts",
    offsetDaysFromLastWorkingDate: 3,
    isMandatory: true,
    requiresEvidence: false,
  },
  {
    id: "payroll",
    title: "Prepare final payroll input",
    group: "Final Payroll Input",
    ownerRole: "Accounts",
    offsetDaysFromLastWorkingDate: 5,
    isMandatory: true,
    requiresEvidence: false,
    dependsOnTaskIds: ["reconcile", "expenses"],
  },
  {
    id: "exit-interview",
    title: "Complete exit interview",
    group: "Exit Interview",
    ownerRole: "HR",
    offsetDaysFromLastWorkingDate: 0,
    isMandatory: false,
    requiresEvidence: false,
  },
  {
    id: "service-letter",
    title: "Issue service letter",
    group: "Service Documents",
    ownerRole: "HR",
    offsetDaysFromLastWorkingDate: 5,
    isMandatory: true,
    requiresEvidence: false,
  },
];

export async function ensureCoreHrLifecycleTemplates(
  organisationId: string,
  actor: AuditActorContext,
): Promise<{ onboardingTemplateId: string; offboardingTemplateId: string }> {
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    let [onboarding] = await tx
      .select({ id: onboardingTemplates.id })
      .from(onboardingTemplates)
      .where(
        and(
          eq(onboardingTemplates.organisationId, organisationId),
          isNull(onboardingTemplates.archivedAt),
          eq(onboardingTemplates.isActive, true),
        ),
      )
      .orderBy(asc(onboardingTemplates.createdAt))
      .limit(1);
    if (!onboarding) {
      [onboarding] = await tx
        .insert(onboardingTemplates)
        .values({
          organisationId,
          name: "Standard employee onboarding",
          description: "VIA's standard new-employee checklist",
          isActive: true,
          templateTasks: defaultOnboardingTasks,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        } as typeof onboardingTemplates.$inferInsert)
        .returning({ id: onboardingTemplates.id });
      await tx
        .insert(auditEvents)
        .values(
          auditValues(
            organisationId,
            actor,
            "create",
            "onboarding-template",
            onboarding!.id,
            "Created the standard onboarding checklist",
          ),
        );
    }
    let [offboarding] = await tx
      .select({ id: offboardingTemplates.id })
      .from(offboardingTemplates)
      .where(
        and(
          eq(offboardingTemplates.organisationId, organisationId),
          isNull(offboardingTemplates.archivedAt),
          eq(offboardingTemplates.isActive, true),
        ),
      )
      .orderBy(asc(offboardingTemplates.createdAt))
      .limit(1);
    if (!offboarding) {
      [offboarding] = await tx
        .insert(offboardingTemplates)
        .values({
          organisationId,
          name: "Standard employee offboarding",
          description: "VIA's standard departure and clearance checklist",
          isActive: true,
          templateTasks: defaultOffboardingTasks,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        } as typeof offboardingTemplates.$inferInsert)
        .returning({ id: offboardingTemplates.id });
      await tx
        .insert(auditEvents)
        .values(
          auditValues(
            organisationId,
            actor,
            "create",
            "offboarding-template",
            offboarding!.id,
            "Created the standard offboarding checklist",
          ),
        );
    }
    return { onboardingTemplateId: onboarding!.id, offboardingTemplateId: offboarding!.id };
  });
}

function validateTemplateTasks(
  tasks: Array<{
    id: string;
    title: string;
    ownerRole: Role;
    assignedUserId?: string | undefined;
    dependsOnTaskIds?: string[] | undefined;
  }>,
): void {
  if (!tasks.length) throw new Error("Add at least one checklist item.");
  const ids = new Set<string>();
  for (const task of tasks) {
    if (!task.id || ids.has(task.id))
      throw new Error("Every checklist item must have a unique ID.");
    if (task.title.trim().length < 3) throw new Error("Every checklist item needs a clear title.");
    ids.add(task.id);
  }
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error("Checklist dependencies cannot form a loop.");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOnTaskIds ?? []) {
      if (dependency === id || !ids.has(dependency))
        throw new Error("A checklist item has an invalid dependency.");
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of tasks) visit(task.id);
}

async function validateAssignedTemplateUsers(
  organisationId: string,
  tasks: Array<{ title: string; ownerRole: Role; assignedUserId?: string | undefined }>,
) {
  const userRows = await listUsersForOrganisation(organisationId);
  for (const task of tasks) {
    if (!task.assignedUserId) continue;
    const user = userRows.find(
      (item) =>
        item.id === task.assignedUserId &&
        item.status === "Active" &&
        item.roles.includes(task.ownerRole),
    );
    if (!user) throw new Error(`Select an active ${task.ownerRole} owner for “${task.title}”.`);
  }
}

export async function saveOnboardingTemplateInDatabase(
  organisationId: string,
  template: Pick<
    OnboardingTemplate,
    | "id"
    | "recordVersion"
    | "name"
    | "description"
    | "isActive"
    | "countries"
    | "legalEntities"
    | "departments"
    | "roles"
    | "employmentTypes"
    | "tasks"
  >,
  actor: AuditActorContext,
): Promise<string> {
  if (!MANAGER_ROLES.includes(actor.activeRole))
    throw new Error("Only HR or a Super Admin can manage onboarding checklists.");
  if (template.name.trim().length < 3 || template.description.trim().length < 5)
    throw new Error("Add a clear checklist name and description.");
  validateTemplateTasks(template.tasks);
  await validateAssignedTemplateUsers(organisationId, template.tasks);
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(onboardingTemplates)
      .where(
        and(
          eq(onboardingTemplates.organisationId, organisationId),
          eq(onboardingTemplates.id, template.id),
        ),
      )
      .for("update")
      .limit(1);
    const [duplicate] = await tx
      .select({ id: onboardingTemplates.id })
      .from(onboardingTemplates)
      .where(
        and(
          eq(onboardingTemplates.organisationId, organisationId),
          isNull(onboardingTemplates.archivedAt),
          sql`lower(${onboardingTemplates.name}) = ${template.name.trim().toLowerCase()}`,
          existing ? sql`${onboardingTemplates.id} <> ${existing.id}` : sql`true`,
        ),
      )
      .limit(1);
    if (duplicate) throw new Error("Another onboarding checklist already uses this name.");
    const values = {
      name: template.name.trim(),
      description: template.description.trim(),
      isActive: template.isActive,
      countries: [...new Set(template.countries)],
      legalEntities: [...new Set(template.legalEntities)],
      departments: [...new Set(template.departments)],
      roles: [...new Set(template.roles)],
      employmentTypes: [...new Set(template.employmentTypes)],
      templateTasks: template.tasks,
      updatedAt: new Date(),
      updatedBy: actor.userId,
    };
    let id = template.id;
    if (existing) {
      if (existing.recordVersion !== template.recordVersion)
        throw new Error("This checklist changed after you opened it. Reload and try again.");
      await tx
        .update(onboardingTemplates)
        .set({ ...values, recordVersion: sql`${onboardingTemplates.recordVersion} + 1` })
        .where(eq(onboardingTemplates.id, existing.id));
    } else {
      id = randomUUID();
      await tx.insert(onboardingTemplates).values({
        id,
        organisationId,
        ...values,
        createdBy: actor.userId,
      } as typeof onboardingTemplates.$inferInsert);
    }
    await tx
      .insert(auditEvents)
      .values(
        auditValues(
          organisationId,
          actor,
          existing ? "update" : "create",
          "onboarding-template",
          id,
          "Saved onboarding checklist",
          { name: template.name.trim(), taskCount: template.tasks.length },
        ),
      );
    return id;
  });
}

export async function saveOffboardingTemplateInDatabase(
  organisationId: string,
  template: Pick<
    OffboardingTemplate,
    | "id"
    | "recordVersion"
    | "name"
    | "description"
    | "isActive"
    | "departments"
    | "employmentTypes"
    | "tasks"
  >,
  actor: AuditActorContext,
): Promise<string> {
  if (!MANAGER_ROLES.includes(actor.activeRole))
    throw new Error("Only HR or a Super Admin can manage offboarding checklists.");
  if (template.name.trim().length < 3 || template.description.trim().length < 5)
    throw new Error("Add a clear checklist name and description.");
  validateTemplateTasks(template.tasks);
  await validateAssignedTemplateUsers(organisationId, template.tasks);
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(offboardingTemplates)
      .where(
        and(
          eq(offboardingTemplates.organisationId, organisationId),
          eq(offboardingTemplates.id, template.id),
        ),
      )
      .for("update")
      .limit(1);
    const [duplicate] = await tx
      .select({ id: offboardingTemplates.id })
      .from(offboardingTemplates)
      .where(
        and(
          eq(offboardingTemplates.organisationId, organisationId),
          isNull(offboardingTemplates.archivedAt),
          sql`lower(${offboardingTemplates.name}) = ${template.name.trim().toLowerCase()}`,
          existing ? sql`${offboardingTemplates.id} <> ${existing.id}` : sql`true`,
        ),
      )
      .limit(1);
    if (duplicate) throw new Error("Another offboarding checklist already uses this name.");
    const values = {
      name: template.name.trim(),
      description: template.description.trim(),
      isActive: template.isActive,
      departments: [...new Set(template.departments)],
      employmentTypes: [...new Set(template.employmentTypes)],
      templateTasks: template.tasks,
      updatedAt: new Date(),
      updatedBy: actor.userId,
    };
    let id = template.id;
    if (existing) {
      if (existing.recordVersion !== template.recordVersion)
        throw new Error("This checklist changed after you opened it. Reload and try again.");
      await tx
        .update(offboardingTemplates)
        .set({ ...values, recordVersion: sql`${offboardingTemplates.recordVersion} + 1` })
        .where(eq(offboardingTemplates.id, existing.id));
    } else {
      id = randomUUID();
      await tx.insert(offboardingTemplates).values({
        id,
        organisationId,
        ...values,
        createdBy: actor.userId,
      } as typeof offboardingTemplates.$inferInsert);
    }
    await tx
      .insert(auditEvents)
      .values(
        auditValues(
          organisationId,
          actor,
          existing ? "update" : "create",
          "offboarding-template",
          id,
          "Saved offboarding checklist",
          { name: template.name.trim(), taskCount: template.tasks.length },
        ),
      );
    return id;
  });
}

export async function archiveLifecycleTemplateInDatabase(
  organisationId: string,
  workflow: "onboarding" | "offboarding",
  templateId: string,
  reason: string,
  actor: AuditActorContext,
): Promise<void> {
  if (!MANAGER_ROLES.includes(actor.activeRole))
    throw new Error("Only HR or a Super Admin can archive checklists.");
  if (reason.trim().length < 5) throw new Error("Explain why this checklist is being archived.");
  const table = workflow === "onboarding" ? onboardingTemplates : offboardingTemplates;
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [template] = await tx
      .select()
      .from(table)
      .where(
        and(
          eq(table.organisationId, organisationId),
          eq(table.id, templateId),
          isNull(table.archivedAt),
        ),
      )
      .for("update")
      .limit(1);
    if (!template) throw new Error("Checklist not found.");
    if (template.isActive) {
      const [remaining] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(table)
        .where(
          and(
            eq(table.organisationId, organisationId),
            eq(table.isActive, true),
            isNull(table.archivedAt),
            sql`${table.id} <> ${templateId}`,
          ),
        );
      if (Number(remaining?.count ?? 0) < 1)
        throw new Error("At least one active checklist must remain.");
    }
    await tx
      .update(table)
      .set({
        archivedAt: new Date(),
        isActive: false,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${table.recordVersion} + 1`,
      })
      .where(eq(table.id, templateId));
    await tx
      .insert(auditEvents)
      .values(
        auditValues(
          organisationId,
          actor,
          "archive",
          `${workflow}-template`,
          templateId,
          reason.trim(),
        ),
      );
  });
}

function mapOnboardingTemplate(row: typeof onboardingTemplates.$inferSelect): OnboardingTemplate {
  return {
    ...recordFields(row),
    name: row.name,
    description: row.description,
    isActive: row.isActive,
    countries: row.countries,
    legalEntities: row.legalEntities,
    departments: row.departments,
    roles: row.roles,
    employmentTypes: row.employmentTypes,
    tasks: row.templateTasks as OnboardingTemplateTask[],
  };
}

function mapOnboardingTask(row: typeof onboardingTasks.$inferSelect): OnboardingTask {
  return {
    id: row.id,
    ...(row.templateTaskId ? { templateTaskId: row.templateTaskId } : {}),
    title: row.title,
    group: row.taskGroup as OnboardingTask["group"],
    checkpoint: row.checkpoint as OnboardingTask["checkpoint"],
    ownerRole: row.ownerRole as Role,
    ...(row.assignedUserId ? { assignedUserId: row.assignedUserId } : {}),
    ...(row.offsetDaysFromStart === null ? {} : { offsetDaysFromStart: row.offsetDaysFromStart }),
    dueDate: row.dueDate,
    isMandatory: row.isMandatory,
    requiresEvidence: row.requiresEvidence,
    ...(row.instructions ? { instructions: row.instructions } : {}),
    dependsOnTaskIds: row.dependsOnTaskIds,
    ...(row.selfServiceFormKey
      ? {
          selfServiceFormKey: row.selfServiceFormKey as
            "personal_details" | "bank_details" | "document_upload",
        }
      : {}),
    ...(row.documentType
      ? { documentType: row.documentType as NonNullable<OnboardingTask["documentType"]> }
      : {}),
    ...(row.verificationDocumentType
      ? {
          verificationDocumentType: row.verificationDocumentType as NonNullable<
            OnboardingTask["verificationDocumentType"]
          >,
        }
      : {}),
    ...(row.requiresBankDetails ? { requiresBankDetails: true } : {}),
    status: row.status,
    ...(row.completedAt ? { completedAt: requiredIso(row.completedAt) } : {}),
    ...(row.completedBy ? { completedBy: row.completedBy } : {}),
    ...(row.evidenceFileId ? { evidenceFileId: row.evidenceFileId } : {}),
    ...(row.waiverReason ? { waiverReason: row.waiverReason } : {}),
  } as OnboardingTask;
}

function mapOffboardingTemplate(
  row: typeof offboardingTemplates.$inferSelect,
): OffboardingTemplate {
  return {
    ...recordFields(row),
    name: row.name,
    description: row.description,
    isActive: row.isActive,
    departments: row.departments,
    employmentTypes: row.employmentTypes,
    tasks: row.templateTasks as OffboardingTemplateTask[],
  };
}

function mapOffboardingTask(row: typeof offboardingTasks.$inferSelect): OffboardingTask {
  return {
    id: row.id,
    ...(row.templateTaskId ? { templateTaskId: row.templateTaskId } : {}),
    title: row.title,
    group: row.taskGroup as OffboardingTask["group"],
    ownerRole: row.ownerRole as Role,
    ...(row.assignedUserId ? { assignedUserId: row.assignedUserId } : {}),
    dueDate: row.dueDate,
    isMandatory: row.isMandatory,
    requiresEvidence: row.requiresEvidence,
    ...(row.instructions ? { instructions: row.instructions } : {}),
    dependsOnTaskIds: row.dependsOnTaskIds,
    status: row.status,
    ...(row.completedAt ? { completedAt: requiredIso(row.completedAt) } : {}),
    ...(row.completedBy ? { completedBy: row.completedBy } : {}),
    ...(row.evidenceFileId ? { evidenceFileId: row.evidenceFileId } : {}),
    ...(row.waiverReason ? { waiverReason: row.waiverReason } : {}),
  };
}

export interface CoreHrLifecycleSnapshot {
  onboardingTemplates: OnboardingTemplate[];
  onboardingCases: OnboardingCase[];
  offboardingTemplates: OffboardingTemplate[];
  offboardingCases: OffboardingCase[];
}

function canSeeEmployeeLifecycle(
  employee: Employee | undefined,
  actor: AuditActorContext,
): boolean {
  if (!employee) return false;
  if (MANAGER_ROLES.includes(actor.activeRole)) return true;
  if (employee.id === actor.employeeId) return true;
  return actor.activeRole === "Line Manager" && employee.lineManagerId === actor.employeeId;
}

export async function listCoreHrLifecycleForActor(
  organisationId: string,
  actor: AuditActorContext,
): Promise<CoreHrLifecycleSnapshot> {
  const db = getDatabaseClient();
  const [
    onTemplateRows,
    onCaseRows,
    onTaskRows,
    offTemplateRows,
    offCaseRows,
    offTaskRows,
    employeeRows,
  ] = await Promise.all([
    db
      .select()
      .from(onboardingTemplates)
      .where(
        and(
          eq(onboardingTemplates.organisationId, organisationId),
          isNull(onboardingTemplates.archivedAt),
        ),
      )
      .orderBy(asc(onboardingTemplates.name)),
    db
      .select()
      .from(onboardingCases)
      .where(
        and(eq(onboardingCases.organisationId, organisationId), isNull(onboardingCases.archivedAt)),
      ),
    db
      .select()
      .from(onboardingTasks)
      .where(
        and(eq(onboardingTasks.organisationId, organisationId), isNull(onboardingTasks.archivedAt)),
      ),
    db
      .select()
      .from(offboardingTemplates)
      .where(
        and(
          eq(offboardingTemplates.organisationId, organisationId),
          isNull(offboardingTemplates.archivedAt),
        ),
      )
      .orderBy(asc(offboardingTemplates.name)),
    db
      .select()
      .from(offboardingCases)
      .where(
        and(
          eq(offboardingCases.organisationId, organisationId),
          isNull(offboardingCases.archivedAt),
        ),
      ),
    db
      .select()
      .from(offboardingTasks)
      .where(
        and(
          eq(offboardingTasks.organisationId, organisationId),
          isNull(offboardingTasks.archivedAt),
        ),
      ),
    listEmployeesForOrganisation(organisationId),
  ]);
  const employeeById = new Map(employeeRows.map((employee) => [employee.id, employee]));
  const onTasksByCase = new Map<string, OnboardingTask[]>();
  for (const row of onTaskRows)
    onTasksByCase.set(row.caseId, [
      ...(onTasksByCase.get(row.caseId) ?? []),
      mapOnboardingTask(row),
    ]);
  const offTasksByCase = new Map<string, OffboardingTask[]>();
  for (const row of offTaskRows)
    offTasksByCase.set(row.caseId, [
      ...(offTasksByCase.get(row.caseId) ?? []),
      mapOffboardingTask(row),
    ]);
  const canManageTemplates = MANAGER_ROLES.includes(actor.activeRole);
  return {
    onboardingTemplates: canManageTemplates ? onTemplateRows.map(mapOnboardingTemplate) : [],
    onboardingCases: onCaseRows
      .filter((row) => canSeeEmployeeLifecycle(employeeById.get(row.employeeId), actor))
      .map((row) => ({
        ...recordFields(row),
        employeeId: row.employeeId,
        ...(row.templateId ? { templateId: row.templateId } : {}),
        status: row.status,
        tasks: onTasksByCase.get(row.id) ?? [],
        progressPercentage: row.progressPercentage,
        isReadyForStartDate: row.isReadyForStartDate,
        ...(row.assignedHRId ? { assignedHRId: row.assignedHRId } : {}),
      })),
    offboardingTemplates: canManageTemplates ? offTemplateRows.map(mapOffboardingTemplate) : [],
    offboardingCases: offCaseRows
      .filter(
        (row) =>
          canSeeEmployeeLifecycle(employeeById.get(row.employeeId), actor) ||
          actor.activeRole === "Accounts" ||
          actor.activeRole === "IT",
      )
      .map((row) => ({
        ...recordFields(row),
        employeeId: row.employeeId,
        ...(row.templateId ? { templateId: row.templateId } : {}),
        reasonCategory: row.reasonCategory as OffboardingReasonCategory,
        noticeDate: row.noticeDate,
        lastWorkingDate: row.lastWorkingDate,
        confidentialityLevel: row.confidentialityLevel,
        ...(row.confidentialNotesEncrypted &&
        (actor.activeRole === "Super Admin" ||
          (actor.activeRole === "HR" && row.confidentialityLevel === "Standard"))
          ? { confidentialNotes: decryptSensitiveJson<string>(row.confidentialNotesEncrypted) }
          : {}),
        rehireEligible: row.rehireEligible,
        status: row.status,
        tasks: offTasksByCase.get(row.id) ?? [],
        progressPercentage: row.progressPercentage,
        ...(row.financialClearanceAt
          ? { financialClearanceAt: requiredIso(row.financialClearanceAt) }
          : {}),
        ...(row.financialClearanceBy ? { financialClearanceBy: row.financialClearanceBy } : {}),
        ...(row.legalClearanceAt ? { legalClearanceAt: requiredIso(row.legalClearanceAt) } : {}),
        ...(row.legalClearanceBy ? { legalClearanceBy: row.legalClearanceBy } : {}),
        ...(row.finalizedAt ? { finalizedAt: requiredIso(row.finalizedAt) } : {}),
        ...(row.finalizedBy ? { finalizedBy: row.finalizedBy } : {}),
        ...(row.assignedHRId ? { assignedHRId: row.assignedHRId } : {}),
      })),
  };
}

async function findEmployee(tx: Transaction, organisationId: string, employeeId: string) {
  const [employee] = await tx
    .select()
    .from(employees)
    .where(
      and(
        eq(employees.organisationId, organisationId),
        eq(employees.id, employeeId),
        isNull(employees.archivedAt),
      ),
    )
    .limit(1);
  if (!employee) throw new Error("Employee not found.");
  return employee;
}

export async function createOnboardingCaseInDatabase(
  organisationId: string,
  input: { employeeId: string; templateId: string; assignedHRId?: string },
  actor: AuditActorContext,
): Promise<string> {
  if (!MANAGER_ROLES.includes(actor.activeRole))
    throw new Error("Only HR or a Super Admin can start onboarding.");
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const employee = await findEmployee(tx, organisationId, input.employeeId);
    const [existing] = await tx
      .select({ id: onboardingCases.id })
      .from(onboardingCases)
      .where(
        and(
          eq(onboardingCases.organisationId, organisationId),
          eq(onboardingCases.employeeId, input.employeeId),
          eq(onboardingCases.status, "In Progress"),
          isNull(onboardingCases.archivedAt),
        ),
      )
      .limit(1);
    if (existing) throw new Error("This employee already has active onboarding.");
    const [template] = await tx
      .select()
      .from(onboardingTemplates)
      .where(
        and(
          eq(onboardingTemplates.organisationId, organisationId),
          eq(onboardingTemplates.id, input.templateId),
          eq(onboardingTemplates.isActive, true),
          isNull(onboardingTemplates.archivedAt),
        ),
      )
      .limit(1);
    if (!template) throw new Error("Select an active onboarding checklist.");
    if (input.assignedHRId) {
      const userRows = await listUsersForOrganisation(organisationId);
      const owner = userRows.find(
        (user) =>
          user.employeeId === input.assignedHRId &&
          user.status === "Active" &&
          user.roles.includes("HR"),
      );
      if (!owner) throw new Error("The HR owner must be an active HR employee.");
    }
    const caseId = randomUUID();
    const tasks = template.templateTasks as OnboardingTemplateTask[];
    const taskIds = new Map(tasks.map((task) => [task.id, randomUUID()]));
    await tx.insert(onboardingCases).values({
      id: caseId,
      organisationId,
      employeeId: employee.id,
      templateId: template.id,
      ...(input.assignedHRId ? { assignedHRId: input.assignedHRId } : {}),
      status: "In Progress",
      createdBy: actor.userId,
      updatedBy: actor.userId,
    } as typeof onboardingCases.$inferInsert);
    if (tasks.length)
      await tx.insert(onboardingTasks).values(
        tasks.map((task) => ({
          id: taskIds.get(task.id)!,
          organisationId,
          caseId,
          templateTaskId: task.id,
          title: task.title,
          taskGroup: task.group,
          checkpoint: task.checkpoint,
          ownerRole: task.ownerRole,
          assignedUserId: task.assignedUserId,
          offsetDaysFromStart: task.offsetDaysFromStart,
          dueDate: dateWithOffset(employee.startDate, task.offsetDaysFromStart),
          isMandatory: task.isMandatory,
          requiresEvidence: task.requiresEvidence,
          instructions: task.instructions,
          dependsOnTaskIds: (task.dependsOnTaskIds ?? [])
            .map((id) => taskIds.get(id)!)
            .filter(Boolean),
          selfServiceFormKey: task.selfServiceFormKey,
          documentType: task.documentType,
          verificationDocumentType: task.verificationDocumentType,
          requiresBankDetails: task.requiresBankDetails ?? false,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })) as (typeof onboardingTasks.$inferInsert)[],
      );
    await tx
      .insert(auditEvents)
      .values(
        auditValues(
          organisationId,
          actor,
          "create",
          "onboarding-case",
          caseId,
          "Started employee onboarding",
          { employeeId: employee.id, templateId: template.id, taskCount: tasks.length },
        ),
      );
    await tx.insert(notifications).values({
      organisationId,
      recipientUserId:
        (
          await tx
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.organisationId, organisationId), eq(users.employeeId, employee.id)))
            .limit(1)
        )[0]?.id ?? actor.userId,
      type: "onboarding_started",
      title: "Your onboarding checklist is ready",
      message: "Complete the requested information and documents before your start date.",
      priority: "High",
      status: "Unread",
      deduplicationKey: `onboarding-started-${caseId}`,
      link: { entityType: "onboarding-case", entityId: caseId, path: "/staff/me/onboarding" },
      createdBy: actor.userId,
      updatedBy: actor.userId,
    } as typeof notifications.$inferInsert);
    return caseId;
  });
}

function taskProgress(tasks: Array<{ isMandatory: boolean; status: string; checkpoint?: string }>) {
  const mandatory = tasks.filter((task) => task.isMandatory);
  const done = mandatory.filter((task) => task.status === "Completed" || task.status === "Waived");
  const progressPercentage = mandatory.length
    ? Math.round((done.length / mandatory.length) * 100)
    : 100;
  const preArrival = mandatory.filter((task) => task.checkpoint === "Pre-Arrival");
  const isReadyForStartDate = preArrival.every(
    (task) => task.status === "Completed" || task.status === "Waived",
  );
  return { progressPercentage, isReadyForStartDate };
}

export async function updateOnboardingTaskInDatabase(
  organisationId: string,
  input: {
    caseId: string;
    taskId: string;
    status: OnboardingTaskStatus;
    evidenceFileId?: string;
    waiverReason?: string;
  },
  actor: AuditActorContext,
): Promise<void> {
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ task: onboardingTasks, lifecycle: onboardingCases, employee: employees })
      .from(onboardingTasks)
      .innerJoin(onboardingCases, eq(onboardingTasks.caseId, onboardingCases.id))
      .innerJoin(employees, eq(onboardingCases.employeeId, employees.id))
      .where(
        and(
          eq(onboardingTasks.organisationId, organisationId),
          eq(onboardingTasks.id, input.taskId),
          eq(onboardingCases.id, input.caseId),
        ),
      )
      .for("update")
      .limit(1);
    if (!row) throw new Error("Onboarding task not found.");
    if (row.lifecycle.status !== "In Progress")
      throw new Error("This onboarding case is not active.");
    const explicitlyAssigned = row.task.assignedUserId === actor.userId;
    const owns =
      explicitlyAssigned ||
      (row.task.ownerRole === "Employee" && row.employee.id === actor.employeeId) ||
      (row.task.ownerRole === "Line Manager" &&
        actor.activeRole === "Line Manager" &&
        row.employee.lineManagerId === actor.employeeId) ||
      (row.task.ownerRole === actor.activeRole &&
        !["Employee", "Line Manager"].includes(row.task.ownerRole)) ||
      actor.activeRole === "Super Admin";
    if (input.status === "Waived" && !MANAGER_ROLES.includes(actor.activeRole))
      throw new Error("Only HR or a Super Admin can waive a task.");
    if (input.status !== "Waived" && !owns)
      throw new Error("This task is assigned to another person or responsibility.");
    if (input.status === "Waived" && (input.waiverReason?.trim().length ?? 0) < 5)
      throw new Error("Explain why this task is being waived.");
    if (
      input.status === "Completed" &&
      row.task.selfServiceFormKey &&
      row.task.selfServiceFormKey !== "document_upload"
    ) {
      throw new Error("Complete this task through its assigned onboarding form.");
    }
    if (input.status === "Completed" && row.task.requiresEvidence && !input.evidenceFileId)
      throw new Error("Upload the required evidence before completing this task.");
    if (input.evidenceFileId) {
      const [file] = await tx
        .select({
          id: fileMetadata.id,
          ownerEntityType: fileMetadata.ownerEntityType,
          ownerEntityId: fileMetadata.ownerEntityId,
        })
        .from(fileMetadata)
        .where(
          and(
            eq(fileMetadata.organisationId, organisationId),
            eq(fileMetadata.id, input.evidenceFileId),
            eq(fileMetadata.storageStatus, "Available"),
          ),
        )
        .limit(1);
      let belongsToCase =
        file?.ownerEntityType === "onboarding-case" && file.ownerEntityId === input.caseId;
      if (file?.ownerEntityType === "employee-document") {
        const [document] = await tx
          .select({ employeeId: employeeDocuments.employeeId })
          .from(employeeDocuments)
          .where(
            and(
              eq(employeeDocuments.organisationId, organisationId),
              eq(employeeDocuments.id, file.ownerEntityId),
              eq(employeeDocuments.fileId, input.evidenceFileId),
              eq(employeeDocuments.employeeId, row.lifecycle.employeeId),
            ),
          )
          .limit(1);
        belongsToCase = Boolean(document);
      }
      if (!file || !belongsToCase)
        throw new Error("The evidence file is unavailable or belongs to another case.");
      if (file.ownerEntityType === "employee-document" && row.task.documentType) {
        const [matchingType] = await tx
          .select({ id: employeeDocuments.id })
          .from(employeeDocuments)
          .where(
            and(
              eq(employeeDocuments.id, file.ownerEntityId),
              eq(
                employeeDocuments.type,
                row.task.documentType as (typeof employeeDocuments.$inferSelect)["type"],
              ),
            ),
          )
          .limit(1);
        if (!matchingType) throw new Error("Upload the document type requested by this task.");
      }
    }
    if (input.status === "Completed" && row.task.requiresBankDetails) {
      const [bank] = await tx
        .select({ id: employeeBankDetails.id })
        .from(employeeBankDetails)
        .where(eq(employeeBankDetails.employeeId, row.employee.id))
        .limit(1);
      if (!bank)
        throw new Error("The employee must submit bank details before this task can close.");
    }
    if (input.status === "Completed" && row.task.verificationDocumentType) {
      const [verifiedDocument] = await tx
        .select({ id: employeeDocuments.id })
        .from(employeeDocuments)
        .where(
          and(
            eq(employeeDocuments.organisationId, organisationId),
            eq(employeeDocuments.employeeId, row.employee.id),
            eq(
              employeeDocuments.type,
              row.task.verificationDocumentType as (typeof employeeDocuments.$inferSelect)["type"],
            ),
            eq(employeeDocuments.status, "Valid"),
            isNull(employeeDocuments.archivedAt),
          ),
        )
        .limit(1);
      if (!verifiedDocument) throw new Error("Verify the required employee document first.");
    }
    for (const dependencyId of row.task.dependsOnTaskIds) {
      const [dependency] = await tx
        .select({ status: onboardingTasks.status })
        .from(onboardingTasks)
        .where(and(eq(onboardingTasks.id, dependencyId), eq(onboardingTasks.caseId, input.caseId)))
        .limit(1);
      if (!dependency || !["Completed", "Waived"].includes(dependency.status))
        throw new Error("Complete this task's dependencies first.");
    }
    await tx
      .update(onboardingTasks)
      .set({
        status: input.status,
        completedAt: input.status === "Completed" ? new Date().toISOString() : null,
        completedBy: input.status === "Completed" ? actor.userId : null,
        evidenceFileId: input.evidenceFileId ?? null,
        waiverReason: input.status === "Waived" ? input.waiverReason!.trim() : null,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${onboardingTasks.recordVersion} + 1`,
      })
      .where(eq(onboardingTasks.id, input.taskId));
    const taskRows = await tx
      .select({
        isMandatory: onboardingTasks.isMandatory,
        status: onboardingTasks.status,
        checkpoint: onboardingTasks.checkpoint,
      })
      .from(onboardingTasks)
      .where(and(eq(onboardingTasks.caseId, input.caseId), isNull(onboardingTasks.archivedAt)));
    const progress = taskProgress(taskRows);
    await tx
      .update(onboardingCases)
      .set({
        ...progress,
        status: progress.progressPercentage === 100 ? "Completed" : "In Progress",
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${onboardingCases.recordVersion} + 1`,
      })
      .where(eq(onboardingCases.id, input.caseId));
    if (
      progress.progressPercentage === 100 &&
      row.employee.startDate <= new Date().toISOString().slice(0, 10) &&
      row.employee.status === "Onboarding"
    ) {
      await tx
        .update(employees)
        .set({
          status: "Active",
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${employees.recordVersion} + 1`,
        })
        .where(eq(employees.id, row.employee.id));
    }
    await tx
      .insert(auditEvents)
      .values(
        auditValues(
          organisationId,
          actor,
          input.status === "Waived" ? "waive" : "complete",
          "onboarding-task",
          input.taskId,
          input.waiverReason?.trim() || "Updated onboarding task",
          { caseId: input.caseId, status: input.status },
        ),
      );
  });
}

export async function saveOnboardingSelfServiceInDatabase(
  organisationId: string,
  input:
    | {
        caseId: string;
        taskId: string;
        kind: "personal_details";
        details: {
          dateOfBirth: string;
          gender: "Male" | "Female";
          nationality: string;
          maritalStatus: "Single" | "Married" | "Divorced" | "Widowed";
          phone: string;
          personalEmail?: string;
          address: string;
          emergencyContacts: Array<{ name: string; relationship: string; phone: string }>;
          dependants?: Array<{ name: string; relationship: string; dateOfBirth: string }>;
        };
      }
    | {
        caseId: string;
        taskId: string;
        kind: "bank_details";
        details: {
          bankName: string;
          accountNumber: string;
          iban: string;
          swiftCode?: string;
          branch?: string;
        };
      },
  actor: AuditActorContext,
): Promise<void> {
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ lifecycle: onboardingCases, task: onboardingTasks, employee: employees })
      .from(onboardingCases)
      .innerJoin(onboardingTasks, eq(onboardingTasks.caseId, onboardingCases.id))
      .innerJoin(employees, eq(onboardingCases.employeeId, employees.id))
      .where(
        and(
          eq(onboardingCases.organisationId, organisationId),
          eq(onboardingCases.id, input.caseId),
          eq(onboardingTasks.id, input.taskId),
        ),
      )
      .for("update")
      .limit(1);
    if (!row || row.lifecycle.status !== "In Progress")
      throw new Error("Active onboarding could not be found.");
    if (row.employee.id !== actor.employeeId)
      throw new Error("You can submit onboarding information only for your own record.");
    if (row.task.ownerRole !== "Employee" || row.task.selfServiceFormKey !== input.kind)
      throw new Error("This onboarding form is not assigned to the current task.");
    if (row.task.status === "Completed" || row.task.status === "Waived")
      throw new Error("This onboarding task has already been completed.");

    if (input.kind === "personal_details") {
      const details = input.details;
      if (
        !details.dateOfBirth ||
        !details.nationality.trim() ||
        !details.phone.trim() ||
        !details.address.trim() ||
        !details.emergencyContacts.length ||
        details.emergencyContacts.some(
          (contact) =>
            !contact.name.trim() || !contact.relationship.trim() || !contact.phone.trim(),
        )
      ) {
        throw new Error("Complete all required personal and emergency-contact information.");
      }
      await tx
        .update(employees)
        .set({
          dateOfBirth: details.dateOfBirth,
          gender: details.gender,
          nationality: details.nationality.trim(),
          maritalStatus: details.maritalStatus,
          phone: details.phone.trim(),
          personalEmail: details.personalEmail?.trim().toLowerCase() || null,
          address: details.address.trim(),
          emergencyContacts: details.emergencyContacts,
          dependants: details.dependants ?? [],
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${employees.recordVersion} + 1`,
        })
        .where(eq(employees.id, row.employee.id));
    } else {
      const details = input.details;
      if (!details.bankName.trim() || !details.accountNumber.trim() || !details.iban.trim())
        throw new Error("Bank name, account number and IBAN are required.");
      const encryptedPayload = encryptSensitiveJson({
        bankName: details.bankName.trim(),
        accountNumber: details.accountNumber.trim(),
        iban: details.iban.trim().replace(/\s+/g, "").toUpperCase(),
        ...(details.swiftCode?.trim() ? { swiftCode: details.swiftCode.trim().toUpperCase() } : {}),
        ...(details.branch?.trim() ? { branch: details.branch.trim() } : {}),
      });
      await tx
        .insert(employeeBankDetails)
        .values({
          organisationId,
          employeeId: row.employee.id,
          encryptedPayload,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        } as typeof employeeBankDetails.$inferInsert)
        .onConflictDoUpdate({
          target: employeeBankDetails.employeeId,
          set: {
            encryptedPayload,
            updatedAt: new Date(),
            updatedBy: actor.userId,
            recordVersion: sql`${employeeBankDetails.recordVersion} + 1`,
          },
        });
    }

    const completedAt = new Date().toISOString();
    await tx
      .update(onboardingTasks)
      .set({
        status: "Completed",
        completedAt,
        completedBy: actor.userId,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${onboardingTasks.recordVersion} + 1`,
      })
      .where(eq(onboardingTasks.id, input.taskId));
    const taskRows = await tx
      .select({
        isMandatory: onboardingTasks.isMandatory,
        status: onboardingTasks.status,
        checkpoint: onboardingTasks.checkpoint,
      })
      .from(onboardingTasks)
      .where(and(eq(onboardingTasks.caseId, input.caseId), isNull(onboardingTasks.archivedAt)));
    const progress = taskProgress(taskRows);
    await tx
      .update(onboardingCases)
      .set({
        ...progress,
        status: progress.progressPercentage === 100 ? "Completed" : "In Progress",
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${onboardingCases.recordVersion} + 1`,
      })
      .where(eq(onboardingCases.id, input.caseId));
    if (
      progress.progressPercentage === 100 &&
      row.employee.startDate <= new Date().toISOString().slice(0, 10) &&
      row.employee.status === "Onboarding"
    ) {
      await tx
        .update(employees)
        .set({
          status: "Active",
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${employees.recordVersion} + 1`,
        })
        .where(eq(employees.id, row.employee.id));
    }
    await tx
      .insert(auditEvents)
      .values(
        auditValues(
          organisationId,
          actor,
          "submit",
          "onboarding-task",
          input.taskId,
          input.kind === "bank_details"
            ? "Submitted encrypted onboarding bank details"
            : "Submitted onboarding personal details",
          { caseId: input.caseId, form: input.kind },
        ),
      );
  });
}

export async function rescheduleOnboardingCaseInDatabase(
  organisationId: string,
  caseId: string,
  actor: AuditActorContext,
): Promise<void> {
  if (!MANAGER_ROLES.includes(actor.activeRole))
    throw new Error("Only HR or a Super Admin can update onboarding dates.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ lifecycle: onboardingCases, employee: employees })
      .from(onboardingCases)
      .innerJoin(employees, eq(onboardingCases.employeeId, employees.id))
      .where(
        and(eq(onboardingCases.organisationId, organisationId), eq(onboardingCases.id, caseId)),
      )
      .for("update")
      .limit(1);
    if (!row || row.lifecycle.status !== "In Progress")
      throw new Error("Only active onboarding can be rescheduled.");
    const tasks = await tx
      .select()
      .from(onboardingTasks)
      .where(and(eq(onboardingTasks.caseId, caseId), isNull(onboardingTasks.archivedAt)));
    for (const task of tasks) {
      if (
        task.status === "Completed" ||
        task.status === "Waived" ||
        task.offsetDaysFromStart === null
      )
        continue;
      await tx
        .update(onboardingTasks)
        .set({
          dueDate: dateWithOffset(row.employee.startDate, task.offsetDaysFromStart),
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${onboardingTasks.recordVersion} + 1`,
        })
        .where(eq(onboardingTasks.id, task.id));
    }
    await tx
      .update(onboardingCases)
      .set({
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${onboardingCases.recordVersion} + 1`,
      })
      .where(eq(onboardingCases.id, caseId));
    await tx
      .insert(auditEvents)
      .values(
        auditValues(
          organisationId,
          actor,
          "reschedule",
          "onboarding-case",
          caseId,
          "Updated onboarding task dates after a start-date change",
          { startDate: row.employee.startDate },
        ),
      );
  });
}

export async function cancelOnboardingCaseInDatabase(
  organisationId: string,
  caseId: string,
  reason: string,
  actor: AuditActorContext,
): Promise<void> {
  if (!MANAGER_ROLES.includes(actor.activeRole))
    throw new Error("Only HR or a Super Admin can cancel onboarding.");
  if (reason.trim().length < 5) throw new Error("Explain why onboarding is being cancelled.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [lifecycle] = await tx
      .select()
      .from(onboardingCases)
      .where(
        and(eq(onboardingCases.organisationId, organisationId), eq(onboardingCases.id, caseId)),
      )
      .for("update")
      .limit(1);
    if (!lifecycle || lifecycle.status !== "In Progress")
      throw new Error("Only active onboarding can be cancelled.");
    const now = new Date();
    await tx
      .update(onboardingCases)
      .set({
        status: "Cancelled",
        updatedAt: now,
        updatedBy: actor.userId,
        recordVersion: sql`${onboardingCases.recordVersion} + 1`,
      })
      .where(eq(onboardingCases.id, caseId));
    await tx
      .update(employees)
      .set({
        status: "Inactive",
        updatedAt: now,
        updatedBy: actor.userId,
        recordVersion: sql`${employees.recordVersion} + 1`,
      })
      .where(eq(employees.id, lifecycle.employeeId));
    await tx
      .update(users)
      .set({
        status: "Suspended",
        updatedAt: now,
        updatedBy: actor.userId,
        recordVersion: sql`${users.recordVersion} + 1`,
      })
      .where(
        and(eq(users.organisationId, organisationId), eq(users.employeeId, lifecycle.employeeId)),
      );
    await tx.insert(auditEvents).values(
      auditValues(organisationId, actor, "cancel", "onboarding-case", caseId, reason.trim(), {
        employeeId: lifecycle.employeeId,
        accessSuspended: true,
      }),
    );
  });
}

export async function createOffboardingCaseInDatabase(
  organisationId: string,
  input: {
    employeeId: string;
    templateId: string;
    assignedHRId: string;
    reasonCategory: OffboardingReasonCategory;
    noticeDate: string;
    lastWorkingDate: string;
    confidentialityLevel: OffboardingConfidentialityLevel;
    confidentialNotes?: string;
    rehireEligible: boolean;
  },
  actor: AuditActorContext,
): Promise<string> {
  if (!MANAGER_ROLES.includes(actor.activeRole))
    throw new Error("Only HR or a Super Admin can start offboarding.");
  if (input.lastWorkingDate < input.noticeDate)
    throw new Error("Last working date cannot be before notice date.");
  if (
    input.confidentialityLevel === "Restricted" &&
    (input.confidentialNotes?.trim().length ?? 0) < 5
  )
    throw new Error("Restricted cases require a confidential note.");
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const employee = await findEmployee(tx, organisationId, input.employeeId);
    const [existing] = await tx
      .select({ id: offboardingCases.id })
      .from(offboardingCases)
      .where(
        and(
          eq(offboardingCases.organisationId, organisationId),
          eq(offboardingCases.employeeId, input.employeeId),
          or(
            eq(offboardingCases.status, "In Progress"),
            eq(offboardingCases.status, "Pending Clearance"),
          ),
          isNull(offboardingCases.archivedAt),
        ),
      )
      .limit(1);
    if (existing) throw new Error("This employee already has active offboarding.");
    const [template] = await tx
      .select()
      .from(offboardingTemplates)
      .where(
        and(
          eq(offboardingTemplates.organisationId, organisationId),
          eq(offboardingTemplates.id, input.templateId),
          eq(offboardingTemplates.isActive, true),
          isNull(offboardingTemplates.archivedAt),
        ),
      )
      .limit(1);
    if (!template) throw new Error("Select an active offboarding checklist.");
    const hrUsers = await listUsersForOrganisation(organisationId);
    if (
      !hrUsers.some(
        (user) =>
          user.employeeId === input.assignedHRId &&
          user.status === "Active" &&
          user.roles.includes("HR"),
      )
    )
      throw new Error("Select an active HR case owner.");
    const caseId = randomUUID();
    const tasks = template.templateTasks as OffboardingTemplateTask[];
    const taskIds = new Map(tasks.map((task) => [task.id, randomUUID()]));
    await tx.insert(offboardingCases).values({
      id: caseId,
      organisationId,
      employeeId: employee.id,
      templateId: template.id,
      assignedHRId: input.assignedHRId,
      reasonCategory: input.reasonCategory,
      noticeDate: input.noticeDate,
      lastWorkingDate: input.lastWorkingDate,
      confidentialityLevel: input.confidentialityLevel,
      confidentialNotesEncrypted: input.confidentialNotes?.trim()
        ? encryptSensitiveJson(input.confidentialNotes.trim())
        : null,
      rehireEligible: input.rehireEligible,
      status: "In Progress",
      createdBy: actor.userId,
      updatedBy: actor.userId,
    } as typeof offboardingCases.$inferInsert);
    if (tasks.length)
      await tx.insert(offboardingTasks).values(
        tasks.map((task) => ({
          id: taskIds.get(task.id)!,
          organisationId,
          caseId,
          templateTaskId: task.id,
          title: task.title,
          taskGroup: task.group,
          ownerRole: task.ownerRole,
          assignedUserId: task.assignedUserId,
          dueDate: dateWithOffset(input.lastWorkingDate, task.offsetDaysFromLastWorkingDate),
          isMandatory: task.isMandatory,
          requiresEvidence: task.requiresEvidence,
          instructions: task.instructions,
          dependsOnTaskIds: (task.dependsOnTaskIds ?? [])
            .map((id) => taskIds.get(id)!)
            .filter(Boolean),
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })) as (typeof offboardingTasks.$inferInsert)[],
      );
    await tx
      .update(employees)
      .set({
        status: "Notice",
        terminationDate: input.lastWorkingDate,
        terminationReason: input.reasonCategory,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${employees.recordVersion} + 1`,
      })
      .where(eq(employees.id, employee.id));
    // The user's login deliberately remains active until final clearance.
    await tx.insert(auditEvents).values(
      auditValues(
        organisationId,
        actor,
        "create",
        "offboarding-case",
        caseId,
        "Started employee offboarding",
        {
          employeeId: employee.id,
          templateId: template.id,
          lastWorkingDate: input.lastWorkingDate,
          taskCount: tasks.length,
        },
      ),
    );
    return caseId;
  });
}

export async function updateOffboardingTaskInDatabase(
  organisationId: string,
  input: {
    caseId: string;
    taskId: string;
    status: OffboardingTaskStatus;
    evidenceFileId?: string;
    waiverReason?: string;
  },
  actor: AuditActorContext,
): Promise<void> {
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ task: offboardingTasks, lifecycle: offboardingCases, employee: employees })
      .from(offboardingTasks)
      .innerJoin(offboardingCases, eq(offboardingTasks.caseId, offboardingCases.id))
      .innerJoin(employees, eq(offboardingCases.employeeId, employees.id))
      .where(
        and(
          eq(offboardingTasks.organisationId, organisationId),
          eq(offboardingTasks.id, input.taskId),
          eq(offboardingCases.id, input.caseId),
        ),
      )
      .for("update")
      .limit(1);
    if (!row) throw new Error("Offboarding task not found.");
    if (!["In Progress", "Pending Clearance"].includes(row.lifecycle.status))
      throw new Error("This offboarding case is not active.");
    if (
      actor.employeeId === row.employee.id &&
      ["HR", "Accounts", "Super Admin"].includes(actor.activeRole) &&
      row.task.ownerRole !== "Employee"
    )
      throw new Error("A departing employee cannot approve their own clearance work.");
    const explicitlyAssigned = row.task.assignedUserId === actor.userId;
    const owns =
      explicitlyAssigned ||
      (row.task.ownerRole === "Employee" && row.employee.id === actor.employeeId) ||
      (row.task.ownerRole === "Line Manager" &&
        actor.activeRole === "Line Manager" &&
        row.employee.lineManagerId === actor.employeeId) ||
      (row.task.ownerRole === actor.activeRole &&
        !["Employee", "Line Manager"].includes(row.task.ownerRole)) ||
      actor.activeRole === "Super Admin";
    if (input.status === "Waived" && !MANAGER_ROLES.includes(actor.activeRole))
      throw new Error("Only HR or a Super Admin can waive a task.");
    if (input.status !== "Waived" && !owns)
      throw new Error("This task is assigned to another person or responsibility.");
    if (input.status === "Waived" && (input.waiverReason?.trim().length ?? 0) < 5)
      throw new Error("Explain why this task is being waived.");
    if (input.status === "Completed" && row.task.requiresEvidence && !input.evidenceFileId)
      throw new Error("Upload the required evidence before completing this task.");
    if (input.evidenceFileId) {
      const [file] = await tx
        .select({ id: fileMetadata.id })
        .from(fileMetadata)
        .where(
          and(
            eq(fileMetadata.organisationId, organisationId),
            eq(fileMetadata.id, input.evidenceFileId),
            eq(fileMetadata.storageStatus, "Available"),
            eq(fileMetadata.ownerEntityType, "offboarding-case"),
            eq(fileMetadata.ownerEntityId, input.caseId),
          ),
        )
        .limit(1);
      if (!file) throw new Error("The evidence file is unavailable or belongs to another case.");
    }
    for (const dependencyId of row.task.dependsOnTaskIds) {
      const [dependency] = await tx
        .select({ status: offboardingTasks.status })
        .from(offboardingTasks)
        .where(
          and(eq(offboardingTasks.id, dependencyId), eq(offboardingTasks.caseId, input.caseId)),
        )
        .limit(1);
      if (!dependency || !["Completed", "Waived"].includes(dependency.status))
        throw new Error("Complete this task's dependencies first.");
    }
    await tx
      .update(offboardingTasks)
      .set({
        status: input.status,
        completedAt: input.status === "Completed" ? new Date().toISOString() : null,
        completedBy: input.status === "Completed" ? actor.userId : null,
        evidenceFileId: input.evidenceFileId ?? null,
        waiverReason: input.status === "Waived" ? input.waiverReason!.trim() : null,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${offboardingTasks.recordVersion} + 1`,
      })
      .where(eq(offboardingTasks.id, input.taskId));
    const taskRows = await tx
      .select({ isMandatory: offboardingTasks.isMandatory, status: offboardingTasks.status })
      .from(offboardingTasks)
      .where(and(eq(offboardingTasks.caseId, input.caseId), isNull(offboardingTasks.archivedAt)));
    const mandatory = taskRows.filter((task) => task.isMandatory);
    const done = mandatory.filter(
      (task) => task.status === "Completed" || task.status === "Waived",
    );
    const progressPercentage = mandatory.length
      ? Math.round((done.length / mandatory.length) * 100)
      : 100;
    await tx
      .update(offboardingCases)
      .set({
        progressPercentage,
        status: progressPercentage === 100 ? "Pending Clearance" : "In Progress",
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${offboardingCases.recordVersion} + 1`,
      })
      .where(eq(offboardingCases.id, input.caseId));
    await tx
      .insert(auditEvents)
      .values(
        auditValues(
          organisationId,
          actor,
          input.status === "Waived" ? "waive" : "complete",
          "offboarding-task",
          input.taskId,
          input.waiverReason?.trim() || "Updated offboarding task",
          { caseId: input.caseId, status: input.status },
        ),
      );
  });
}

export async function assignOffboardingTaskOwnerInDatabase(
  organisationId: string,
  caseId: string,
  taskId: string,
  assignedUserId: string | undefined,
  actor: AuditActorContext,
): Promise<void> {
  if (!MANAGER_ROLES.includes(actor.activeRole))
    throw new Error("Only HR or a Super Admin can assign offboarding work.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(offboardingTasks)
      .where(
        and(
          eq(offboardingTasks.organisationId, organisationId),
          eq(offboardingTasks.caseId, caseId),
          eq(offboardingTasks.id, taskId),
        ),
      )
      .for("update")
      .limit(1);
    if (!task) throw new Error("Offboarding task not found.");
    if (assignedUserId) {
      const userRows = await listUsersForOrganisation(organisationId);
      const owner = userRows.find(
        (user) =>
          user.id === assignedUserId &&
          user.status === "Active" &&
          user.roles.includes(task.ownerRole as Role),
      );
      if (!owner)
        throw new Error(`Select an active user with the ${task.ownerRole} responsibility.`);
    }
    await tx
      .update(offboardingTasks)
      .set({
        assignedUserId: assignedUserId ?? null,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${offboardingTasks.recordVersion} + 1`,
      })
      .where(eq(offboardingTasks.id, taskId));
    await tx
      .insert(auditEvents)
      .values(
        auditValues(
          organisationId,
          actor,
          "assign",
          "offboarding-task",
          taskId,
          "Updated the task owner",
          { caseId, assignedUserId: assignedUserId ?? null },
        ),
      );
  });
}

export async function grantOffboardingClearanceInDatabase(
  organisationId: string,
  caseId: string,
  clearance: "financial" | "legal",
  actor: AuditActorContext,
): Promise<void> {
  const allowed = clearance === "financial" ? ["Accounts", "Super Admin"] : ["HR", "Super Admin"];
  if (!allowed.includes(actor.activeRole))
    throw new Error(`Only ${allowed.join(" or ")} can grant this clearance.`);
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [lifecycle] = await tx
      .select()
      .from(offboardingCases)
      .where(
        and(eq(offboardingCases.organisationId, organisationId), eq(offboardingCases.id, caseId)),
      )
      .for("update")
      .limit(1);
    if (!lifecycle) throw new Error("Offboarding case not found.");
    if (actor.employeeId === lifecycle.employeeId)
      throw new Error("A departing employee cannot approve their own clearance.");
    if (lifecycle.progressPercentage < 100)
      throw new Error("Complete or waive all mandatory tasks before clearance.");
    const alreadyGranted =
      clearance === "financial" ? lifecycle.financialClearanceAt : lifecycle.legalClearanceAt;
    if (alreadyGranted) throw new Error("This clearance has already been granted.");
    await tx
      .update(offboardingCases)
      .set(
        clearance === "financial"
          ? {
              financialClearanceAt: new Date().toISOString(),
              financialClearanceBy: actor.userId,
              updatedAt: new Date(),
              updatedBy: actor.userId,
              recordVersion: sql`${offboardingCases.recordVersion} + 1`,
            }
          : {
              legalClearanceAt: new Date().toISOString(),
              legalClearanceBy: actor.userId,
              updatedAt: new Date(),
              updatedBy: actor.userId,
              recordVersion: sql`${offboardingCases.recordVersion} + 1`,
            },
      )
      .where(eq(offboardingCases.id, caseId));
    await tx
      .insert(auditEvents)
      .values(
        auditValues(
          organisationId,
          actor,
          "approve",
          "offboarding-case",
          caseId,
          `Granted ${clearance} clearance`,
          { clearance },
        ),
      );
  });
}

export async function cancelOffboardingCaseInDatabase(
  organisationId: string,
  caseId: string,
  reason: string,
  actor: AuditActorContext,
): Promise<void> {
  if (!MANAGER_ROLES.includes(actor.activeRole))
    throw new Error("Only HR or a Super Admin can cancel offboarding.");
  if (reason.trim().length < 5) throw new Error("Explain why offboarding is being cancelled.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [lifecycle] = await tx
      .select()
      .from(offboardingCases)
      .where(
        and(eq(offboardingCases.organisationId, organisationId), eq(offboardingCases.id, caseId)),
      )
      .for("update")
      .limit(1);
    if (!lifecycle || lifecycle.status === "Completed")
      throw new Error("This offboarding case cannot be cancelled.");
    await tx
      .update(offboardingCases)
      .set({
        status: "Cancelled",
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${offboardingCases.recordVersion} + 1`,
      })
      .where(eq(offboardingCases.id, caseId));
    await tx
      .update(employees)
      .set({
        status: "Active",
        terminationDate: null,
        terminationReason: null,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${employees.recordVersion} + 1`,
      })
      .where(eq(employees.id, lifecycle.employeeId));
    await tx.insert(auditEvents).values(
      auditValues(organisationId, actor, "cancel", "offboarding-case", caseId, reason.trim(), {
        employeeId: lifecycle.employeeId,
      }),
    );
  });
}

export async function finaliseOffboardingCaseInDatabase(
  organisationId: string,
  caseId: string,
  actor: AuditActorContext,
  today = new Date().toISOString().slice(0, 10),
): Promise<void> {
  if (actor.activeRole !== "Super Admin")
    throw new Error("Only a Super Admin can complete offboarding.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [lifecycle] = await tx
      .select()
      .from(offboardingCases)
      .where(
        and(eq(offboardingCases.organisationId, organisationId), eq(offboardingCases.id, caseId)),
      )
      .for("update")
      .limit(1);
    if (!lifecycle) throw new Error("Offboarding case not found.");
    if (actor.employeeId === lifecycle.employeeId)
      throw new Error("A departing employee cannot complete their own offboarding.");
    if (today < lifecycle.lastWorkingDate)
      throw new Error("Offboarding cannot be completed before the last working date.");
    if (
      lifecycle.progressPercentage < 100 ||
      !lifecycle.financialClearanceAt ||
      !lifecycle.legalClearanceAt
    )
      throw new Error("All mandatory work and both clearances are required.");
    const now = new Date();
    await tx
      .update(offboardingCases)
      .set({
        status: "Completed",
        finalizedAt: now.toISOString(),
        finalizedBy: actor.userId,
        updatedAt: now,
        updatedBy: actor.userId,
        recordVersion: sql`${offboardingCases.recordVersion} + 1`,
      })
      .where(eq(offboardingCases.id, caseId));
    await tx
      .update(employees)
      .set({
        status: "Inactive",
        terminationDate: lifecycle.lastWorkingDate,
        updatedAt: now,
        updatedBy: actor.userId,
        recordVersion: sql`${employees.recordVersion} + 1`,
      })
      .where(eq(employees.id, lifecycle.employeeId));
    await tx
      .update(users)
      .set({
        status: "Suspended",
        updatedAt: now,
        updatedBy: actor.userId,
        recordVersion: sql`${users.recordVersion} + 1`,
      })
      .where(
        and(eq(users.organisationId, organisationId), eq(users.employeeId, lifecycle.employeeId)),
      );
    await tx
      .insert(auditEvents)
      .values(
        auditValues(
          organisationId,
          actor,
          "complete",
          "offboarding-case",
          caseId,
          "Completed offboarding and suspended access",
          { employeeId: lifecycle.employeeId, lastWorkingDate: lifecycle.lastWorkingDate },
        ),
      );
  });
}

export async function readLifecycleTaskEvidenceInDatabase(
  organisationId: string,
  workflow: "onboarding" | "offboarding",
  caseId: string,
  taskId: string,
  actor: AuditActorContext,
) {
  const db = getDatabaseClient();
  if (workflow === "onboarding") {
    const [row] = await db
      .select({ task: onboardingTasks, lifecycle: onboardingCases, employee: employees })
      .from(onboardingTasks)
      .innerJoin(onboardingCases, eq(onboardingTasks.caseId, onboardingCases.id))
      .innerJoin(employees, eq(onboardingCases.employeeId, employees.id))
      .where(
        and(
          eq(onboardingTasks.organisationId, organisationId),
          eq(onboardingTasks.caseId, caseId),
          eq(onboardingTasks.id, taskId),
        ),
      )
      .limit(1);
    if (!row?.task.evidenceFileId) throw new Error("Task evidence is unavailable.");
    const allowed =
      MANAGER_ROLES.includes(actor.activeRole) ||
      actor.employeeId === row.employee.id ||
      (actor.activeRole === "Line Manager" && row.employee.lineManagerId === actor.employeeId) ||
      row.task.assignedUserId === actor.userId ||
      row.task.ownerRole === actor.activeRole;
    if (!allowed) throw new Error("You do not have permission to open this onboarding evidence.");
    return readObjectFile(
      organisationId,
      row.task.evidenceFileId,
      actor,
      "Viewed onboarding task evidence",
    );
  }
  const [row] = await db
    .select({ task: offboardingTasks, lifecycle: offboardingCases, employee: employees })
    .from(offboardingTasks)
    .innerJoin(offboardingCases, eq(offboardingTasks.caseId, offboardingCases.id))
    .innerJoin(employees, eq(offboardingCases.employeeId, employees.id))
    .where(
      and(
        eq(offboardingTasks.organisationId, organisationId),
        eq(offboardingTasks.caseId, caseId),
        eq(offboardingTasks.id, taskId),
      ),
    )
    .limit(1);
  if (!row?.task.evidenceFileId) throw new Error("Task evidence is unavailable.");
  const allowed =
    MANAGER_ROLES.includes(actor.activeRole) ||
    actor.employeeId === row.employee.id ||
    (actor.activeRole === "Line Manager" && row.employee.lineManagerId === actor.employeeId) ||
    row.task.assignedUserId === actor.userId ||
    row.task.ownerRole === actor.activeRole;
  if (!allowed) throw new Error("You do not have permission to open this offboarding evidence.");
  return readObjectFile(
    organisationId,
    row.task.evidenceFileId,
    actor,
    "Viewed offboarding task evidence",
  );
}
