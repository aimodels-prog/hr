import "@tanstack/react-start/server-only";

import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";

import type { AuditEvent, AuditRiskLevel } from "../../data/types.ts";
import { getDatabaseClient } from "../client.ts";
import { employees } from "../schema/employee.ts";
import { auditEvents } from "../schema/system.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

export interface DatabaseAuditFilters {
  global: boolean;
  entityId?: string | undefined;
  entityType?: string | undefined;
  search?: string | undefined;
  actorId?: string | undefined;
  role?: string | undefined;
  module?: string | undefined;
  action?: string | undefined;
  risk?: AuditRiskLevel | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type SerializableAuditEvent = Omit<AuditEvent, "before" | "after"> & {
  before?: JsonValue;
  after?: JsonValue;
};

export interface DatabaseAuditIntegrityIssue {
  eventId: string;
  entityType: string;
  entityId: string;
  message: string;
}

const ENTITY_TABLES: Record<string, string> = {
  employee: "employees",
  candidate: "candidates",
  vacancy: "vacancies",
  application: "candidate_applications",
  "candidate-application": "candidate_applications",
  interview: "interviews",
  offer: "job_offers",
  "job-offer": "job_offers",
  job_offer: "job_offers",
  "leave-request": "leave_requests",
  leave_request: "leave_requests",
  "leave-policy": "leave_policies",
  leave_policy: "leave_policies",
  leave_transaction: "leave_transactions",
  timesheet: "timesheets",
  "timesheet-period": "timesheet_periods",
  payrollperiod: "payroll_periods",
  "payroll-period": "payroll_periods",
  "travel-request": "travel_requests",
  "overtime-claim": "overtime_claims",
  claim: "overtime_claims",
  "attendance-record": "attendance_records",
  "attendance-correction": "attendance_corrections",
  "attendance-exception": "attendance_exception_cases",
  "site-visit": "site_visit_requests",
  "onboarding-case": "onboarding_cases",
  "onboarding-task": "onboarding_tasks",
  "offboarding-case": "offboarding_cases",
  "offboarding-task": "offboarding_tasks",
  "performance-review": "performance_reviews",
  "performance-cycle": "performance_cycles",
  "performance-template": "review_templates",
  "training-record": "training_records",
  "training-assignment": "training_assignments",
  "training-enrollment": "training_assignments",
  "training-course": "training_courses",
  user: "users",
  notification: "notifications",
  file: "file_metadata",
};

const EMPLOYEE_LINKED_TABLES: Record<string, string> = {
  "leave-request": "leave_requests",
  leave_request: "leave_requests",
  leave_transaction: "leave_transactions",
  timesheet: "timesheets",
  "travel-request": "travel_requests",
  "overtime-claim": "overtime_claims",
  claim: "overtime_claims",
  "attendance-record": "attendance_records",
  "attendance-correction": "attendance_corrections",
  "attendance-exception": "attendance_exception_cases",
  "site-visit": "site_visit_requests",
  "onboarding-case": "onboarding_cases",
  "offboarding-case": "offboarding_cases",
  "performance-review": "performance_reviews",
  "training-record": "training_records",
  "training-assignment": "training_assignments",
  "training-enrollment": "training_assignments",
};

const RESTRICTED_KEYS = [
  "salary",
  "compensation",
  "payroll",
  "bank",
  "account",
  "iban",
  "swift",
  "passport",
  "visa",
  "nationalid",
  "national_id",
  "confidential",
  "performancenotes",
  "managercomment",
  "moderationcomment",
  "discussionnotes",
];

const ALWAYS_RESTRICTED_KEYS = [
  "password",
  "secret",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "apikey",
  "encryptionkey",
  "credential",
  "authorization",
  "cookie",
];

function isRestrictedKey(key: string, actor: AuditActorContext) {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (ALWAYS_RESTRICTED_KEYS.some((part) => normalized.includes(part))) return true;
  if (actor.activeRole === "Super Admin") return false;
  if (actor.activeRole === "Accounts")
    return /passport|visa|nationalid|confidential|performance|moderation|discussion/.test(
      normalized,
    );
  return RESTRICTED_KEYS.some((part) => normalized.includes(part.replace(/[^a-z0-9]/g, "")));
}

export function redactAuditSummary(value: unknown, actor: AuditActorContext): JsonValue {
  if (Array.isArray(value)) return value.map((item) => redactAuditSummary(item, actor));
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  if (!value || typeof value !== "object") return String(value ?? "");
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      isRestrictedKey(key, actor) ? "Restricted" : redactAuditSummary(item, actor),
    ]),
  );
}

function toAuditEvent(
  row: typeof auditEvents.$inferSelect,
  actor: AuditActorContext,
): SerializableAuditEvent {
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    actor: {
      userId: row.actorUserId ?? "system",
      displayName: row.actorDisplayName,
      roles: row.actorRoles as AuditEvent["actor"]["roles"],
      ...(row.activeRole
        ? { activeRole: row.activeRole as AuditEvent["actor"]["activeRole"] }
        : {}),
      ...(row.actorEmployeeId ? { employeeId: row.actorEmployeeId } : {}),
    },
    action: row.action,
    module: row.module,
    entityType: row.entityType,
    entityId: row.entityId,
    riskLevel: row.riskLevel,
    ...(row.beforeSummary === null ? {} : { before: redactAuditSummary(row.beforeSummary, actor) }),
    ...(row.afterSummary === null ? {} : { after: redactAuditSummary(row.afterSummary, actor) }),
    ...(row.reason ? { reason: row.reason } : {}),
  };
}

async function recordAccessDenied(
  organisationId: string,
  actor: AuditActorContext,
  entityId: string,
  reason: string,
) {
  await getDatabaseClient()
    .insert(auditEvents)
    .values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole ?? null,
      actorRoles: actor.roles ?? [],
      action: "access-denied",
      module: "audit",
      entityType: "audit-history",
      entityId: actor.userId!,
      afterSummary: { requestedEntityId: entityId },
      reason,
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
}

async function resolveLinkedEmployee(
  organisationId: string,
  entityType: string,
  entityId: string,
): Promise<string | undefined> {
  const normalized = entityType.toLowerCase();
  if (normalized === "employee") return entityId;
  const table = EMPLOYEE_LINKED_TABLES[normalized];
  if (!table) return undefined;
  const result = await getDatabaseClient().execute(
    sql`select employee_id as id from ${sql.identifier(table)} where organisation_id=${organisationId} and id=${entityId} limit 1`,
  );
  return (Array.from(result as Iterable<{ id: string }>)[0] ?? {}).id;
}

async function assertReadAccess(
  organisationId: string,
  filters: DatabaseAuditFilters,
  actor: AuditActorContext,
) {
  if (!actor.userId || !actor.employeeId) throw new Error("A verified VIA user is required.");
  if (filters.global) {
    if (actor.activeRole === "Super Admin") return;
    const reason = "Only a Super Admin can view the complete audit history.";
    await recordAccessDenied(organisationId, actor, "global-audit", reason);
    throw new Error(reason);
  }
  if (!filters.entityId || !filters.entityType)
    throw new Error("A record is required for this activity history.");
  if (actor.activeRole === "Super Admin") return;
  const moduleRows = await getDatabaseClient()
    .selectDistinct({ module: auditEvents.module })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organisationId, organisationId),
        eq(auditEvents.entityId, filters.entityId),
        eq(auditEvents.entityType, filters.entityType),
      ),
    );
  const modules = moduleRows.map((row) => row.module.toLowerCase());
  if (actor.activeRole === "HR" && !modules.some((module) => module === "payroll")) return;
  if (
    actor.activeRole === "Accounts" &&
    modules.length > 0 &&
    modules.every((module) =>
      ["payroll", "travel", "overtime", "timesheet", "timesheets"].includes(module),
    )
  )
    return;
  const normalizedType = filters.entityType.toLowerCase();
  if (
    [
      "candidate",
      "application",
      "candidate-application",
      "interview",
      "offer",
      "job-offer",
    ].includes(normalizedType)
  ) {
    const reason = "Recruitment activity is restricted to People Operations and Super Admin.";
    await recordAccessDenied(organisationId, actor, filters.entityId, reason);
    throw new Error(reason);
  }
  if (normalizedType === "vacancy" && actor.activeRole === "Line Manager") {
    const result = await getDatabaseClient().execute(
      sql`select 1 from vacancies where organisation_id=${organisationId} and id=${filters.entityId} and hiring_manager_id=${actor.employeeId} limit 1`,
    );
    if (Array.from(result as Iterable<unknown>).length) return;
  }
  const employeeId = await resolveLinkedEmployee(
    organisationId,
    filters.entityType,
    filters.entityId,
  );
  if (employeeId === actor.employeeId) return;
  if (actor.activeRole === "Line Manager" && employeeId) {
    const [report] = await getDatabaseClient()
      .select({ id: employees.id })
      .from(employees)
      .where(
        and(
          eq(employees.organisationId, organisationId),
          eq(employees.id, employeeId),
          eq(employees.lineManagerId, actor.employeeId),
        ),
      )
      .limit(1);
    if (report) return;
  }
  const reason =
    actor.activeRole === "HR"
      ? "Payroll activity is restricted to Accounts and Super Admin."
      : "You cannot view this record's activity history.";
  await recordAccessDenied(organisationId, actor, filters.entityId, reason);
  throw new Error(reason);
}

function whereConditions(organisationId: string, filters: DatabaseAuditFilters): SQL[] {
  const conditions: SQL[] = [eq(auditEvents.organisationId, organisationId)];
  if (!filters.global) {
    conditions.push(eq(auditEvents.entityId, filters.entityId!));
    conditions.push(eq(auditEvents.entityType, filters.entityType!));
  }
  if (filters.actorId) conditions.push(eq(auditEvents.actorUserId, filters.actorId));
  if (filters.role) conditions.push(eq(auditEvents.activeRole, filters.role));
  if (filters.module) conditions.push(eq(auditEvents.module, filters.module));
  if (filters.action) conditions.push(eq(auditEvents.action, filters.action));
  if (filters.entityType && filters.global)
    conditions.push(eq(auditEvents.entityType, filters.entityType));
  if (filters.risk) conditions.push(eq(auditEvents.riskLevel, filters.risk));
  if (filters.dateFrom)
    conditions.push(gte(auditEvents.occurredAt, `${filters.dateFrom}T00:00:00.000Z`));
  if (filters.dateTo)
    conditions.push(lte(auditEvents.occurredAt, `${filters.dateTo}T23:59:59.999Z`));
  if (filters.search) {
    const value = `%${filters.search.trim()}%`;
    conditions.push(
      or(
        ilike(auditEvents.actorDisplayName, value),
        ilike(auditEvents.action, value),
        ilike(auditEvents.module, value),
        ilike(auditEvents.entityType, value),
        ilike(auditEvents.reason, value),
      )!,
    );
  }
  return conditions;
}

export async function listAuditEventsInDatabase(
  organisationId: string,
  filters: DatabaseAuditFilters,
  actor: AuditActorContext,
): Promise<SerializableAuditEvent[]> {
  await assertReadAccess(organisationId, filters, actor);
  const rows = await getDatabaseClient()
    .select()
    .from(auditEvents)
    .where(and(...whereConditions(organisationId, filters)))
    .orderBy(desc(auditEvents.occurredAt))
    .limit(5000);
  return rows.map((row) => toAuditEvent(row, actor));
}

export async function checkAuditIntegrityInDatabase(
  organisationId: string,
  actor: AuditActorContext,
): Promise<DatabaseAuditIntegrityIssue[]> {
  await assertReadAccess(organisationId, { global: true }, actor);
  const rows = await getDatabaseClient()
    .select({
      id: auditEvents.id,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      action: auditEvents.action,
    })
    .from(auditEvents)
    .where(eq(auditEvents.organisationId, organisationId))
    .orderBy(desc(auditEvents.occurredAt))
    .limit(10000);
  const issues: DatabaseAuditIntegrityIssue[] = [];
  const grouped = new Map<string, Set<string>>();
  for (const row of rows) {
    if (/denied/i.test(row.action)) continue;
    const table = ENTITY_TABLES[row.entityType.toLowerCase()];
    if (!table) continue;
    const ids = grouped.get(table) ?? new Set<string>();
    ids.add(row.entityId);
    grouped.set(table, ids);
  }
  const existing = new Set<string>();
  for (const [table, idSet] of grouped) {
    const ids = [...idSet];
    if (!ids.length) continue;
    const result = await getDatabaseClient().execute(
      sql`select id from ${sql.identifier(table)} where organisation_id=${organisationId} and id in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`,`,
      )})`,
    );
    for (const row of Array.from(result as Iterable<{ id: string }>))
      existing.add(`${table}:${row.id}`);
  }
  for (const row of rows) {
    if (/denied/i.test(row.action)) continue;
    const table = ENTITY_TABLES[row.entityType.toLowerCase()];
    if (table && !existing.has(`${table}:${row.entityId}`))
      issues.push({
        eventId: row.id,
        entityType: row.entityType,
        entityId: row.entityId,
        message: "The linked record cannot be resolved.",
      });
  }
  return issues;
}

function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function exportAuditCsvInDatabase(
  organisationId: string,
  filters: DatabaseAuditFilters,
  actor: AuditActorContext,
) {
  const events = await listAuditEventsInDatabase(organisationId, filters, actor);
  const headers = [
    "Reference",
    "Timestamp",
    "Person",
    "Active role",
    "Area",
    "Record type",
    "Record reference",
    "Activity",
    "Attention level",
    "Reason",
  ];
  const csv = [
    headers.map(csvCell).join(","),
    ...events.map((event) =>
      [
        event.id,
        event.occurredAt,
        event.actor.displayName,
        event.actor.activeRole ?? event.actor.roles[0] ?? "Employee",
        event.module,
        event.entityType,
        event.entityId,
        event.action,
        event.riskLevel,
        event.reason ?? "",
      ]
        .map(csvCell)
        .join(","),
    ),
  ].join("\r\n");
  await getDatabaseClient()
    .insert(auditEvents)
    .values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole ?? null,
      actorRoles: actor.roles ?? [],
      action: "export",
      module: "audit",
      entityType: "audit-history",
      entityId: actor.userId!,
      afterSummary: { rowCount: events.length, filters },
      reason: "Downloaded permission-filtered audit history",
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
  return {
    csv,
    fileName: `via-audit-${new Date().toISOString().slice(0, 10)}.csv`,
    rowCount: events.length,
  };
}
