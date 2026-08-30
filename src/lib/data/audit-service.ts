import type { ActorContext, AuditEvent, AuditRiskLevel, Employee } from "./types.ts";
import { SYSTEM_ACTOR } from "./types.ts";
import type { VersionedStorageService } from "./storage.ts";

export const AUDIT_COLLECTION = "auditEvents";

export interface AuditInput {
  context?: ActorContext;
  action: string;
  module: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  riskLevel?: AuditRiskLevel;
}

export interface AuditWriter {
  record(input: AuditInput): AuditEvent;
}

export interface AuditServiceOptions {
  now?: () => string;
  createId?: () => string;
}

export interface AuditReadOptions {
  global?: boolean;
  entityId?: string;
  entityType?: string;
}

export interface AuditIntegrityIssue {
  eventId: string;
  message: string;
}

const ENTITY_COLLECTIONS: Record<string, string> = {
  employee: "employees",
  candidate: "candidates",
  vacancy: "vacancies",
  application: "applications",
  "candidate-application": "applications",
  interview: "interview_events",
  offer: "job_offers",
  job_offer: "job_offers",
  "leave-request": "leave_requests",
  leave_request: "leave_requests",
  timesheet: "timesheets",
  "timesheet-period": "timesheetPeriods",
  payrollPeriod: "payrollPeriods",
  "payroll-period": "payrollPeriods",
  "travel-request": "travelRequests",
  "overtime-claim": "overtimeClaims",
  claim: "overtimeClaims",
  "onboarding-case": "onboardingCases",
  "offboarding-case": "offboardingCases",
  "performance-review": "performanceReviews",
  "performance-cycle": "performanceCycles",
  "training-record": "training_records",
  "training-enrollment": "training_enrollments",
  user: "users",
};

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function defaultId(): string {
  return crypto.randomUUID();
}

export class AuditService implements AuditWriter {
  private readonly now: () => string;
  private readonly createId: () => string;

  constructor(
    private readonly storage: VersionedStorageService,
    options: AuditServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? defaultId;
  }

  list(): AuditEvent[] {
    return this.storage.readCollection<AuditEvent>(AUDIT_COLLECTION);
  }

  /** Permission-controlled read path for every user-facing audit screen. */
  listForContext(context: ActorContext, options: AuditReadOptions): AuditEvent[] {
    const activeRole = context.actor.activeRole ?? context.actor.roles[0] ?? "Employee";
    if (options.global) {
      if (activeRole !== "Super Admin") {
        this.denyRead(context, "global-audit", "Only a Super Admin can view global audit history.");
      }
      return this.list();
    }
    if (!options.entityId || !options.entityType) {
      this.denyRead(context, "audit-query", "A record is required for this activity history.");
    }
    const entityId = options.entityId;
    const entityType = options.entityType;
    const events = this.list().filter(
      (event) => event.entityId === entityId && event.entityType === entityType,
    );
    if (activeRole === "Super Admin") return events;
    if (activeRole === "HR") {
      if (events.some((event) => event.module.toLowerCase() === "payroll")) {
        this.denyRead(
          context,
          entityId,
          "Payroll activity is restricted to Accounts and Super Admin.",
        );
      }
      return events;
    }
    if (activeRole === "Accounts") {
      const allowed = new Set(["payroll", "travel", "overtime", "timesheet", "timesheets"]);
      if (events.every((event) => allowed.has(event.module.toLowerCase()))) return events;
      this.denyRead(context, entityId, "This activity history is outside Accounts access.");
    }

    const employeeId = this.resolveEmployeeId(entityType, entityId, events);
    if (employeeId && employeeId === context.actor.employeeId) return events;
    if (activeRole === "Line Manager" && context.actor.employeeId && employeeId) {
      const employee = this.storage
        .readCollection<Employee>("employees")
        .find((record) => record.id === employeeId);
      if (employee?.lineManagerId === context.actor.employeeId) return events;
    }
    this.denyRead(context, entityId, "You cannot view this record's activity history.");
  }

  checkIntegrity(context: ActorContext): AuditIntegrityIssue[] {
    const events = this.listForContext(context, { global: true });
    const issues: AuditIntegrityIssue[] = [];
    for (const event of events) {
      if (!event.id || !event.occurredAt || Number.isNaN(Date.parse(event.occurredAt))) {
        issues.push({
          eventId: event.id || "missing-id",
          message: "Event identity or date is invalid.",
        });
        continue;
      }
      if (
        !event.actor?.userId ||
        !event.action ||
        !event.module ||
        !event.entityType ||
        !event.entityId
      ) {
        issues.push({ eventId: event.id, message: "Required audit information is missing." });
        continue;
      }
      const collection = ENTITY_COLLECTIONS[event.entityType];
      if (!collection || event.action.toLowerCase().includes("denied")) continue;
      const exists = this.storage
        .readCollection<{ id: string }>(collection)
        .some((record) => record.id === event.entityId);
      if (!exists && !event.before && !event.after) {
        issues.push({ eventId: event.id, message: "The linked record cannot be resolved." });
      }
    }
    return issues;
  }

  exportCsv(context: ActorContext): string {
    const events = this.listForContext(context, { global: true });
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
    const rows = events.map((event) =>
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
    );
    this.record({
      context,
      action: "export",
      module: "audit",
      entityType: "system",
      entityId: "global-audit",
      reason: "Downloaded the complete audit history",
      riskLevel: "High",
      after: { rowCount: events.length },
    });
    return [headers.map(csvCell).join(","), ...rows].join("\n");
  }

  record(input: AuditInput): AuditEvent {
    const reason = input.reason ?? input.context?.reason;
    const event: AuditEvent = {
      id: this.createId(),
      occurredAt: this.now(),
      actor: structuredClone(input.context?.actor ?? SYSTEM_ACTOR),
      action: input.action,
      module: input.module,
      entityType: input.entityType,
      entityId: input.entityId,
      riskLevel: input.riskLevel ?? "Low",
      ...(input.before === undefined ? {} : { before: structuredClone(input.before) }),
      ...(input.after === undefined ? {} : { after: structuredClone(input.after) }),
      ...(reason ? { reason } : {}),
    };

    const events = this.list();
    this.storage.writeCollection(AUDIT_COLLECTION, [...events, event]);
    return structuredClone(event);
  }

  private resolveEmployeeId(
    entityType: string,
    entityId: string,
    events: AuditEvent[],
  ): string | undefined {
    if (entityType === "employee") return entityId;
    for (const event of events) {
      for (const value of [event.after, event.before]) {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          const employeeId = (value as Record<string, unknown>)["employeeId"];
          if (typeof employeeId === "string") return employeeId;
        }
      }
    }
    const collection = ENTITY_COLLECTIONS[entityType];
    if (!collection) return undefined;
    const record = this.storage
      .readCollection<{ id: string; employeeId?: string }>(collection)
      .find((item) => item.id === entityId);
    return record?.employeeId;
  }

  private denyRead(context: ActorContext, entityId: string, reason: string): never {
    this.record({
      context,
      action: "access-denied",
      module: "audit",
      entityType: "audit-history",
      entityId,
      reason,
      riskLevel: "High",
    });
    throw new Error(reason);
  }
}

// Shared helper so every service records access-denied attempts the same way, instead of each
// one growing its own ad hoc version of this call.
export function recordAccessDenied(
  audit: AuditWriter,
  params: {
    module: string;
    entityType: string;
    entityId: string;
    action: string;
    context: ActorContext;
  },
): void {
  audit.record({
    context: params.context,
    action: params.action,
    module: params.module,
    entityType: params.entityType,
    entityId: params.entityId,
    riskLevel: "High",
  });
}
