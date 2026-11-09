import type { LeaveRequest } from "./leave-types";

type ApprovalStep = LeaveRequest["chainApprovals"][number];

function allSteps(request: LeaveRequest): ApprovalStep[] {
  return [...request.chainApprovals, ...(request.pendingAmendment?.chainApprovals ?? [])];
}

function lastDecision(steps: ApprovalStep[], status: ApprovalStep["status"]): ApprovalStep | null {
  return (
    [...steps]
      .reverse()
      .filter((step) => step.status === status)
      .sort((left, right) => (right.date ?? "").localeCompare(left.date ?? ""))[0] ?? null
  );
}

function pendingPerson(request: LeaveRequest): string | null {
  const pending = allSteps(request).find((step) => step.status === "Pending");
  if (!pending) return null;
  if (["Line Manager", "Supervisor", "Manager"].includes(pending.role)) {
    return request.lineManagerName || "assigned manager (name not recorded)";
  }
  if (pending.role === "HR") return "HR team";
  return pending.role;
}

/** Short, honest decision text for HR and employee leave lists. */
export function leaveDecisionSummary(request: LeaveRequest): string | null {
  if (request.status === "Automatically Refused") return "Automatically refused by the system";

  const steps = allSteps(request);
  const declined = lastDecision(steps, "Declined");
  if (request.status === "Declined") {
    return declined?.approverName
      ? `Declined by ${declined.approverName}`
      : "Decision-maker not recorded";
  }

  const approved = lastDecision(steps, "Approved");
  const waitingFor =
    pendingPerson(request) ||
    (request.status.includes("Line Manager")
      ? request.lineManagerName || "assigned manager (name not recorded)"
      : request.status.includes("HR")
        ? "HR team"
        : null);
  if (request.status.startsWith("Pending") || request.status.startsWith("Amendment Pending")) {
    if (approved?.approverName && waitingFor)
      return `${approved.approverName} approved · Waiting for ${waitingFor}`;
    return waitingFor ? `Waiting for ${waitingFor}` : "Waiting for the assigned reviewer";
  }

  if (["Approved", "Taken"].includes(request.status)) {
    return approved?.approverName
      ? `Approved by ${approved.approverName}`
      : "Decision-maker not recorded";
  }
  return null;
}
