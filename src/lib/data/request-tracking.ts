import type { AppTask } from "./task-service.ts";

export const REQUEST_MODULES = [
  "Leave",
  "Timesheets",
  "Overtime",
  "Attendance corrections",
  "Visits",
  "Travel",
  "Training",
  "Profile updates",
  "Documents",
  "Objectives",
  "Performance",
  "Applications",
  "Referrals",
  "Offers",
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
}
export interface TrackedRequest {
  id: string;
  module: string;
  title: string;
  employeeId: string | null;
  employeeName: string;
  status: string;
  group: Exclude<RequestGroup, "All">;
  waitingFor: string;
  nextStep: string;
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
  manager_name: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  action_url: string;
  metadata: Record<string, unknown>;
}
const text = (value: unknown) => (typeof value === "string" ? value : undefined);

export function toTrackedRequest(row: RequestRow): TrackedRequest {
  const group = requestGroup(row.status);
  const meta = row.metadata ?? {};
  const manager = row.manager_name
    ? `${row.manager_name} — Line Manager`
    : "Line Manager not assigned — HR must check";
  let waitingFor = "No approval pending";
  let nextStep = "Open the record for details.";
  if (group === "Draft" || group === "Returned") {
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

  const events: RequestEvent[] = [{ label: "Record created", at: row.created_at }];
  const event = (key: string, label: string, commentKey?: string) => {
    const at = text(meta[key]);
    if (at && Number.isFinite(Date.parse(at)))
      events.push({
        label,
        at,
        ...(commentKey && text(meta[commentKey]) ? { comment: text(meta[commentKey]) } : {}),
      });
  };
  event("submittedAt", "Submitted");
  event("managerAt", "Manager decision recorded", "managerComment");
  event("hrAt", "HR decision recorded", "hrComment");
  event("financeAt", "Finance decision recorded");
  event("approvedAt", "Approval recorded");
  event("closedAt", "Completed");
  const chain = meta["chain"];
  if (Array.isArray(chain))
    for (const step of chain) {
      if (!step || typeof step !== "object") continue;
      const at = text(step.date);
      if (at && Number.isFinite(Date.parse(at)) && ["Approved", "Declined"].includes(step.status))
        events.push({ label: `${text(step.role) ?? "Reviewer"}: ${step.status}`, at });
    }
  events.sort((a, b) => a.at.localeCompare(b.at));
  return {
    id: row.id,
    module: row.module,
    title: row.title,
    employeeId: row.employee_id,
    employeeName: row.employee_name || "External applicant",
    status: row.status === "Pending Super Admin Closure" ? "Awaiting Finance closure" : row.status,
    group,
    waitingFor,
    nextStep,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    actionUrl: row.action_url,
    events,
  };
}

/** Only decision work, not reminders to attend a course, prepare payroll or submit a form. */
export function isApprovalTask(task: AppTask): boolean {
  return (
    /^(leave-(manager|hr)-|timesheet-(manager|hr)-|attendance-(manager|hr)-|overtime-(manager|hr)-|training-(manager|hr|verify)-|site-visit-hr-|travel-(manager|hr|accounts|close)-|performance-(manager|hr)-|profile-review-|document-verify-|offer-approval-|goal-manager-|referral-hr-)/.test(
      task.id,
    ) ||
    (task.sourceType === "payroll-period" && task.title === "Approve payroll period")
  );
}
