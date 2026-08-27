import type { AuditEvent } from "./types.ts";

const WORD_OVERRIDES: Record<string, string> = {
  hr: "HR",
  id: "ID",
  ids: "IDs",
  ai: "AI",
  csv: "CSV",
  toil: "Time off in lieu",
};

const AREA_LABELS: Record<string, string> = {
  attendance: "Attendance",
  audit: "Audit history",
  candidates: "Recruitment",
  recruitment: "Recruitment",
  vacancy: "Recruitment",
  interview: "Recruitment",
  offers: "Recruitment",
  onboarding: "Onboarding",
  offboarding: "Offboarding",
  employees: "Employee records",
  employee: "Employee records",
  hr: "People operations",
  leave: "Leave",
  payroll: "Payroll",
  performance: "Performance",
  reports: "Reports",
  settings: "Settings",
  system: "System administration",
  "data-management": "System administration",
  timesheets: "Timesheets",
  timesheet: "Timesheets",
  training: "Training",
  travel: "Travel",
  overtime: "Overtime",
  notifications: "Notifications",
};

const ENTITY_LABELS: Record<string, string> = {
  candidate: "candidate",
  notification: "notification",
  employee: "employee record",
  "employee-document": "employee document",
  "leave-request": "leave request",
  leave_request: "leave request",
  leave_transaction: "leave balance",
  "leave-policy": "leave policy",
  leave_policy: "leave policy",
  timesheet: "timesheet",
  "timesheet-period": "timesheet period",
  "attendance-record": "attendance record",
  "attendance-correction": "attendance correction",
  "attendance-exception": "attendance exception",
  "site-visit": "site visit",
  "travel-request": "travel request",
  "overtime-claim": "overtime claim",
  claim: "overtime claim",
  vacancy: "vacancy",
  application: "job application",
  interview: "interview",
  offer: "offer",
  job_offer: "offer",
  template: "interview template",
  "performance-template": "performance review template",
  "performance-review": "performance review",
  "performance-cycle": "performance cycle",
  "onboarding-case": "onboarding case",
  "offboarding-case": "offboarding case",
  user: "user account",
  role: "user access",
  file: "file",
  system: "audit history",
  "demo-data": "demo data",
};

const TECHNICAL_FIELDS = new Set([
  "id",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
  "archivedAt",
  "recordVersion",
  "actorUserId",
  "deduplicationKey",
]);
const SENSITIVE_PARTS = [
  "salary",
  "compensation",
  "payroll",
  "bank",
  "accountnumber",
  "iban",
  "swift",
  "nationalid",
  "passportnumber",
  "visanumber",
  "performancenotes",
  "performancerating",
  "overallscore",
  "categoryscores",
];

export type AuditActivityGroup = "Approval" | "Change" | "Export" | "Access" | "Other";
export type AuditOutcome = "Completed" | "Approved" | "Rejected" | "Blocked" | "Archived";
export interface AuditNameLookup {
  employees?: Record<string, string>;
  candidates?: Record<string, string>;
  policies?: Record<string, string>;
  users?: Record<string, string>;
}
export interface AuditChange {
  field: string;
  before?: string;
  after?: string;
  kind: "added" | "removed" | "changed";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function humanizeAuditText(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words
    .map((word, index) => {
      const override = WORD_OVERRIDES[word.toLowerCase()];
      if (override) return override;
      const lower = word.toLowerCase();
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

export function getAuditArea(event: AuditEvent): string {
  return AREA_LABELS[event.module.toLowerCase()] ?? humanizeAuditText(event.module);
}

export function getAuditEntityLabel(event: AuditEvent): string {
  return (
    ENTITY_LABELS[event.entityType.toLowerCase()] ??
    humanizeAuditText(event.entityType).toLowerCase()
  );
}

export function isAutomatedAuditEvent(event: AuditEvent): boolean {
  const actorId = event.actor.userId.toLowerCase();
  const reason = event.reason?.toLowerCase() ?? "";
  return (
    actorId === "system" ||
    actorId === "system-initialization" ||
    event.actor.displayName.toLowerCase().includes("system") ||
    reason.includes("background") ||
    reason.includes("scheduled") ||
    reason.includes("automatic reminder")
  );
}

export function getAuditActivityGroup(event: AuditEvent): AuditActivityGroup {
  const action = event.action.toLowerCase();
  if (/approv|reject|declin|verify|decision|shortlist/.test(action)) return "Approval";
  if (/export|download/.test(action)) return "Export";
  if (/access|view|read|denied|login|sign.in/.test(action)) return "Access";
  if (
    /create|update|edit|change|archive|delete|restore|reset|submit|assign|upload|correct/.test(
      action,
    )
  )
    return "Change";
  return "Other";
}

export function getAuditOutcome(event: AuditEvent): AuditOutcome {
  const action = event.action.toLowerCase();
  if (/denied|blocked|refused/.test(action)) return "Blocked";
  if (/reject|declin/.test(action)) return "Rejected";
  if (/approv|verify|accept/.test(action)) return "Approved";
  if (/archive|delete|withdraw|cancel/.test(action)) return "Archived";
  return "Completed";
}

export function getAuditActivity(event: AuditEvent): string {
  const action = event.action.toLowerCase();
  const entity = getAuditEntityLabel(event);
  if (/access.*denied|denied.*access|not.author/.test(action)) return `Blocked access to ${entity}`;
  if (/approv/.test(action)) return `Approved ${entity}`;
  if (/reject|declin|refus/.test(action)) return `Rejected ${entity}`;
  if (/submit/.test(action)) return `Submitted ${entity}`;
  if (/archive/.test(action)) return `Archived ${entity}`;
  if (/restore/.test(action)) return `Restored ${entity}`;
  if (/export/.test(action)) return `Exported ${entity}`;
  if (/download/.test(action)) return `Downloaded ${entity}`;
  if (/view|read|accessed/.test(action)) return `Viewed ${entity}`;
  if (/assign/.test(action)) return `Assigned ${entity}`;
  if (/upload/.test(action)) return `Uploaded ${entity}`;
  if (/correct/.test(action)) return `Corrected ${entity}`;
  if (/update|edit|change/.test(action)) return `Updated ${entity}`;
  if (/create/.test(action))
    return event.entityType === "notification" ? "Sent notification" : `Created ${entity}`;
  if (/initialize/.test(action)) return `Prepared ${entity}`;
  return `${humanizeAuditText(event.action)} · ${entity}`;
}

function firstString(
  record: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function getAuditRecordLabel(event: AuditEvent, lookup: AuditNameLookup = {}): string {
  const record = asRecord(event.after) ?? asRecord(event.before);
  const directName = firstString(record, [
    "title",
    "name",
    "legalName",
    "displayName",
    "referenceNumber",
    "candidateReference",
    "employeeNumber",
    "destination",
  ]);
  if (directName) return directName;
  const employeeId = firstString(record, ["employeeId"]);
  if (employeeId && lookup.employees?.[employeeId]) return lookup.employees[employeeId];
  const candidateId = firstString(record, ["candidateId"]);
  if (candidateId && lookup.candidates?.[candidateId]) return lookup.candidates[candidateId];
  const policyId = firstString(record, ["policyId"]);
  if (policyId && lookup.policies?.[policyId]) return lookup.policies[policyId];
  const recipientId = firstString(record, ["recipientUserId"]);
  if (recipientId && lookup.users?.[recipientId]) return lookup.users[recipientId];
  return (
    lookup.employees?.[event.entityId] ??
    lookup.candidates?.[event.entityId] ??
    lookup.users?.[event.entityId] ??
    humanizeAuditText(getAuditEntityLabel(event))
  );
}

export function getAuditSummary(event: AuditEvent, lookup: AuditNameLookup = {}): string {
  const record = asRecord(event.after) ?? asRecord(event.before);
  const activity = getAuditActivity(event);
  if (event.entityType === "notification") {
    const title = firstString(record, ["title"]);
    return title
      ? `${activity}: ${title}`
      : `${activity} for ${getAuditRecordLabel(event, lookup)}`;
  }
  if (event.entityType === "leave_transaction") {
    const days = record?.["days"];
    const employeeId = firstString(record, ["employeeId"]);
    const employee = employeeId ? lookup.employees?.[employeeId] : undefined;
    const policyId = firstString(record, ["policyId"]);
    const policy = policyId ? lookup.policies?.[policyId] : undefined;
    if (typeof days === "number" && employee) {
      return `${days >= 0 ? "Added" : "Deducted"} ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ${days >= 0 ? "to" : "from"} ${employee}’s ${policy ?? "leave"} balance`;
    }
  }
  return `${activity}: ${getAuditRecordLabel(event, lookup)}`;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return SENSITIVE_PARTS.some((part) => normalized.includes(part));
}

export function formatAuditValue(value: unknown, key: string, canSeeFinancial: boolean): string {
  if (!canSeeFinancial && isSensitiveKey(key)) return "Restricted";
  if (value === undefined || value === null || value === "") return "Not provided";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") return "Updated details";
  return String(value);
}

export function getAuditChanges(event: AuditEvent, canSeeFinancial: boolean): AuditChange[] {
  const before = asRecord(event.before) ?? {};
  const after = asRecord(event.after) ?? {};
  return Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
    .filter((key) => !TECHNICAL_FIELDS.has(key))
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => {
      const beforeExists = before[key] !== undefined && before[key] !== null && before[key] !== "";
      const afterExists = after[key] !== undefined && after[key] !== null && after[key] !== "";
      return {
        field: humanizeAuditText(key),
        ...(beforeExists ? { before: formatAuditValue(before[key], key, canSeeFinancial) } : {}),
        ...(afterExists ? { after: formatAuditValue(after[key], key, canSeeFinancial) } : {}),
        kind: !beforeExists
          ? ("added" as const)
          : !afterExists
            ? ("removed" as const)
            : ("changed" as const),
      };
    });
}
