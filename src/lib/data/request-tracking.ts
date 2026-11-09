import type { AppTask } from "./task-service.ts";

export const REQUEST_MODULES = [
  "Leave",
  "Timesheets",
  "Overtime",
  "Attendance corrections",
  "Time Away",
  "Visits",
  "Travel",
  "Training",
  "Training certificates",
  "Profile updates",
  "Documents",
  "Objectives",
  "Performance",
  "Applications",
  "Referrals",
  "Offers",
  "Payroll",
] as const;
export const REQUEST_GROUPS = [
  "All",
  "Waiting",
  "Returned",
  "Draft",
  "Approved",
  "Closed",
  "Rejected",
  "In progress",
] as const;
export type RequestGroup = (typeof REQUEST_GROUPS)[number];
export const STATUS_GROUPS: Record<string, string[]> = {
  Returned: ["Returned", "Changes Requested", "Returned for Changes"],
  Draft: ["Draft"],
  Approved: [
    "Approved",
    "Pre-authorised",
    "Pre-authorised - Awaiting Actual",
    "Valid",
    "Verified",
    "Accepted",
    "Approved for Interview",
  ],
  Closed: [
    "Completed",
    "Closed",
    "Taken",
    "Cancelled",
    "Withdrawn",
    "Expired",
    "Hired",
    "Payroll Locked",
    "Locked",
    "Replaced",
  ],
  Rejected: ["Rejected", "Declined", "Automatically Refused"],
};
export function requestGroup(status: string): Exclude<RequestGroup, "All"> {
  for (const [group, values] of Object.entries(STATUS_GROUPS))
    if (values.includes(status)) return group as Exclude<RequestGroup, "All">;
  return /pending|awaiting/i.test(status) || status === "New" ? "Waiting" : "In progress";
}
export interface RequestEvent {
  label: string;
  at: string;
  comment?: string | undefined;
  statusAfter?: string | undefined;
}
export interface RequestDecision {
  actorId?: string | undefined;
  actorName: string;
  role: string;
  outcome: "Approved" | "Rejected" | "Returned" | "Reopened" | "Moderated" | "Locked" | "Closed";
  at: string;
  comment?: string | undefined;
  statusAfter?: string | undefined;
}
export interface RequestSubmission {
  actorName: string;
  at: string;
}
export interface TrackedRequest {
  id: string;
  module: string;
  title: string;
  employeeId: string | null;
  employeeName: string;
  createdByName: string | null;
  submittedByName: string | null;
  details: Record<string, string | null>;
  archivedAt: string | null;
  status: string;
  group: Exclude<RequestGroup, "All">;
  waitingFor: string;
  nextStep: string;
  approvedBy: string[];
  createdAt: string;
  updatedAt: string;
  actionUrl: string;
  events: RequestEvent[];
}
export interface RequestRow {
  id: string;
  module: string;
  title: string;
  employee_id: string | null;
  employee_name: string | null;
  created_by_name?: string | null;
  details?: Record<string, string | null>;
  archived_at?: string | null;
  manager_name: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  action_url: string;
  metadata: Record<string, unknown>;
}
const text = (value: unknown) => (typeof value === "string" ? value : undefined);

export function toTrackedRequest(
  row: RequestRow,
  decisions: RequestDecision[] = [],
  reviewerNames: Record<string, string> = {},
  submissions: RequestSubmission[] = [],
): TrackedRequest {
  const archivedAt = row.archived_at ?? null;
  const group = archivedAt ? "Closed" : requestGroup(row.status);
  const meta = row.metadata ?? {};
  const manager = row.manager_name
    ? `${row.manager_name} — Line Manager`
    : "Line Manager not assigned — HR must check";
  let waitingFor = "No approval pending";
  let nextStep = "Open the record for details.";
  if (archivedAt) {
    nextStep = "Archived record. Its previous decisions remain available below.";
  } else if (group === "Draft" || group === "Returned") {
    waitingFor = "Requester";
    nextStep = "Complete or correct the request, then submit it.";
  } else if (group === "Waiting") {
    waitingFor = /Manager|Supervisor/.test(row.status) ? manager : "HR";
    if (row.module === "Offers")
      waitingFor =
        text(meta["approver"]) ?? "Assigned offer approver not available — HR must check";
    if (row.module === "Objectives") waitingFor = manager;
    if (row.status === "Pending Super Admin")
      waitingFor = "HR — legacy approval stage needs review";
    if (row.status === "Pending Super Admin Closure") waitingFor = "Finance";
    if (row.module === "Travel" && row.status === "Pending HR and Accounts") {
      const pending = [
        meta["manager"] === "Pending" ? manager : null,
        meta["hr"] === "Pending" ? "HR" : null,
        meta["finance"] === "Pending" ? "Finance" : null,
      ].filter(Boolean);
      waitingFor = pending.join("; ") || "HR — check outstanding travel stage";
    }
    if (
      ["Self Assessment Pending", "Acknowledgement Pending", "Objectives Pending"].includes(
        row.status,
      )
    )
      waitingFor = "Employee";
    if (row.status === "Awaiting Delivery") waitingFor = "HR / delivery service";
    nextStep = `Waiting for ${waitingFor}. A notification does not itself count as approval.`;
  } else if (
    row.module === "Applications" &&
    ["Shortlisted", "Interviewing", "On Hold", "Offered"].includes(row.status)
  ) {
    waitingFor = row.status === "Offered" ? "Candidate response / HR" : "HR recruitment team";
    nextStep = "Recruitment is in progress. HR will communicate the next step.";
  } else if (row.module === "Offers" && row.status === "Sent") {
    waitingFor = "Candidate";
    nextStep = "Await the candidate’s response.";
  } else if (row.module === "Offers" && group === "Approved") {
    waitingFor = "HR";
    nextStep = "HR can arrange delivery of the approved offer.";
  } else if (row.module === "Travel" && row.status === "Pre-authorised") {
    waitingFor = "Employee after travel";
    nextStep = "Submit expenses after the trip for Finance closure.";
  } else if (row.status === "Pre-authorised - Awaiting Actual") {
    waitingFor = "Employee";
    nextStep = "Confirm the actual overtime worked.";
  }
  if (row.module === "Visits" && meta["extensionPending"] === true) {
    waitingFor = "HR — visit extension";
    nextStep = "The original visit is approved; the extension still needs HR review.";
  }

  if (group === "Approved" && waitingFor === "No approval pending") {
    nextStep = "Approved. No further decision is waiting.";
  }

  const events: RequestEvent[] = [
    {
      label: row.created_by_name ? `Record created by ${row.created_by_name}` : "Record created",
      at: row.created_at,
    },
  ];
  const nameFor = (key: string) => {
    const id = text(meta[key]);
    return id ? reviewerNames[id] : undefined;
  };
  const event = (key: string, label: string, commentKey?: string, actorKey?: string) => {
    const at = text(meta[key]);
    if (at && Number.isFinite(Date.parse(at)))
      events.push({
        label: actorKey && nameFor(actorKey) ? `${label} by ${nameFor(actorKey)}` : label,
        at,
        ...(commentKey && text(meta[commentKey]) ? { comment: text(meta[commentKey]) } : {}),
      });
  };
  if (submissions.length)
    for (const submission of submissions)
      if (Number.isFinite(Date.parse(submission.at)))
        events.push({ label: `Submitted by ${submission.actorName}`, at: submission.at });
  if (!submissions.length) event("submittedAt", "Submitted");
  if (decisions.length) {
    for (const decision of decisions) {
      if (!Number.isFinite(Date.parse(decision.at))) continue;
      events.push({
        label: `${decision.actorName} (${decision.role}) ${decision.outcome.toLowerCase()}`,
        at: decision.at,
        ...(decision.comment ? { comment: decision.comment } : {}),
        ...(decision.statusAfter ? { statusAfter: decision.statusAfter } : {}),
      });
    }
  }
  const hasDecisionNear = (at: string | undefined, role?: string) =>
    Boolean(
      at &&
      decisions.some(
        (decision) =>
          (!role || decision.role === role) &&
          Math.abs(Date.parse(decision.at) - Date.parse(at)) < 60_000,
      ),
    );
  if (!hasDecisionNear(text(meta["managerAt"]), "Line Manager"))
    event("managerAt", "Line Manager decision recorded", "managerComment", "managerBy");
  if (!hasDecisionNear(text(meta["hrAt"]), "HR"))
    event("hrAt", "HR decision recorded", "hrComment", "hrBy");
  if (!hasDecisionNear(text(meta["financeAt"]), "Accounts"))
    event("financeAt", "Finance decision recorded", undefined, "financeBy");
  if (!hasDecisionNear(text(meta["approvedAt"])))
    event("approvedAt", "Approval recorded", undefined, "approvedBy");
  if (!decisions.some((decision) => decision.outcome === "Closed"))
    event("closedAt", "Completed", undefined, "closedBy");
  const chains = [meta["chain"], meta["amendmentChain"]].filter(Array.isArray);
  for (const step of chains.flat()) {
    if (!step || typeof step !== "object") continue;
    const at = text(step.date);
    const by = text(step.approvedBy);
    const name = by ? reviewerNames[by] : undefined;
    if (
      at &&
      Number.isFinite(Date.parse(at)) &&
      ["Approved", "Declined"].includes(step.status) &&
      !decisions.some(
        (decision) =>
          (decision.actorId && by
            ? decision.actorId === by
            : Boolean(name) && decision.actorName === name) &&
          Math.abs(Date.parse(decision.at) - Date.parse(at)) < 60_000,
      )
    )
      events.push({
        label: `${text(step.role) ?? "Reviewer"}: ${step.status}${name ? ` by ${name}` : ""}`,
        at,
      });
  }
  const latestDecisionByActor = new Map<string, RequestDecision>();
  for (const decision of [...decisions].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)))
    latestDecisionByActor.set(decision.actorId ?? decision.actorName, decision);
  const approvedBy = [...latestDecisionByActor.values()]
    .filter((decision) => decision.outcome === "Approved")
    .map((decision) => decision.actorName);
  for (const chain of chains)
    for (const step of chain)
      if (step && typeof step === "object" && step.status === "Approved") {
        const name = reviewerNames[text(step.approvedBy) ?? ""];
        if (name) approvedBy.push(name);
      }
  const approvedStage = (actorKey: string, atKey: string, statusKey?: string) => {
    const name = nameFor(actorKey);
    if (!name) return;
    if ([...latestDecisionByActor.values()].some((decision) => decision.actorName === name)) return;
    if (statusKey && meta[statusKey] === "Approved") {
      approvedBy.push(name);
      return;
    }
    if (
      !statusKey &&
      (group === "Approved" ||
        (group === "Waiting" && /Pending (HR|Accounts|Finance)/.test(row.status))) &&
      (text(meta[atKey]) || (row.module === "Time Away" && group === "Approved"))
    )
      approvedBy.push(name);
  };
  approvedStage("managerBy", "managerAt", row.module === "Travel" ? "manager" : undefined);
  approvedStage("hrBy", "hrAt", row.module === "Travel" ? "hr" : undefined);
  approvedStage("financeBy", "financeAt", row.module === "Travel" ? "finance" : undefined);
  if (group === "Approved") approvedStage("approvedBy", "approvedAt");
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return {
    id: row.id,
    module: row.module,
    title: row.title,
    employeeId: row.employee_id,
    employeeName:
      row.employee_name || (row.module === "Payroll" ? "Organisation" : "External applicant"),
    createdByName: row.created_by_name ?? null,
    submittedByName: submissions.at(-1)?.actorName ?? null,
    details: row.details ?? {},
    archivedAt,
    status: archivedAt
      ? `Archived (last status: ${row.status})`
      : row.status === "Pending Super Admin Closure"
        ? "Awaiting Finance closure"
        : row.status,
    group,
    waitingFor,
    nextStep,
    approvedBy: [...new Set(approvedBy)],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    actionUrl: row.action_url,
    events,
  };
}

/** Only decision work, not reminders to attend a course, prepare payroll or submit a form. */
export function isApprovalTask(task: AppTask): boolean {
  return (
    /^(leave-(manager|hr|country-manager)-|timesheet-(manager|hr)-|attendance-(manager|hr)-|time-away-hr-|overtime-(manager|hr)-|training-(manager|hr|verify)-|site-visit-hr-|travel-(manager|hr|accounts|close)-|performance-(manager|hr)-|document-verify-|offer-approval-|goal-manager-|referral-hr-)/.test(
      task.id,
    ) ||
    (task.sourceType === "payroll-period" && task.title === "Approve payroll period")
  );
}
