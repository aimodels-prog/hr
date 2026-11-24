import type { LeaveRequest } from "./leave-types";

type ApprovalStep = LeaveRequest["chainApprovals"][number];

/** Internal workflow statuses are not reviewer identities. */
export function leaveStatusLabel(status: LeaveRequest["status"]): string {
  if (status === "Pending Line Manager" || status === "Amendment Pending Line Manager")
    return "Awaiting reviewer";
  if (status === "Pending HR" || status === "Amendment Pending HR") return "Awaiting HR";
  return status;
}

/** The request itself, rather than its stored status, identifies the current reviewer. */
export function leaveRequestStatusLabel(request: LeaveRequest): string {
  if (!request.status.startsWith("Pending") && !request.status.startsWith("Amendment Pending"))
    return leaveStatusLabel(request.status);
  const pending = allSteps(request).find((step) => step.status === "Pending");
  if (!pending) return leaveStatusLabel(request.status);
  const name = ["Line Manager", "Supervisor", "Manager"].includes(pending.role)
    ? request.lineManagerName
    : pending.role === "Country Manager"
      ? request.countryManagerName
      : pending.role === "HR"
        ? request.independentReviewerName
        : undefined;
  return name ? `Awaiting ${name}` : leaveStatusLabel(request.status);
}

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

function pendingPerson(request: LeaveRequest, staffView: boolean): string | null {
  const pending = allSteps(request).find((step) => step.status === "Pending");
  if (!pending) return null;
  if (["Line Manager", "Supervisor", "Manager"].includes(pending.role)) {
    return request.lineManagerName || (staffView ? "reviewer assignment" : "reviewer not assigned");
  }
  if (pending.role === "HR") return request.independentReviewerName || "HR team";
  if (pending.role === "Country Manager") return request.countryManagerName || "Country Manager";
  if (pending.role === "Super Admin") return staffView ? "HR review" : pending.role;
  return pending.role;
}

/** Short, honest decision text for HR and employee leave lists. */
export function leaveDecisionSummary(
  request: LeaveRequest,
  { staffView = false }: { staffView?: boolean } = {},
): string | null {
  if (request.status === "Automatically Refused")
    return staffView ? null : "Automatically refused by the system";

  const steps = allSteps(request);
  const declined = lastDecision(steps, "Declined");
  if (request.status === "Declined") {
    return declined?.approverName
      ? `Declined by ${declined.approverName}`
      : staffView
        ? null
        : "Decision-maker not recorded";
  }

  const approved = lastDecision(steps, "Approved");
  const waitingFor =
    pendingPerson(request, staffView) ||
    (request.status.includes("Line Manager")
      ? request.lineManagerName || (staffView ? "reviewer assignment" : "reviewer not assigned")
      : request.status.includes("HR")
        ? request.independentReviewerName || "HR team"
        : request.status.includes("Super Admin")
          ? staffView
            ? "HR review"
            : "Super Admin"
          : null);
  if (request.status.startsWith("Pending") || request.status.startsWith("Amendment Pending")) {
    const managerNameMissing =
      staffView &&
      !request.lineManagerName &&
      (request.status.includes("Line Manager") ||
        steps.some(
          (step) =>
            step.status === "Pending" &&
            ["Line Manager", "Supervisor", "Manager"].includes(step.role),
        ));
    if (managerNameMissing) {
      const prefix = approved?.approverName ? `${approved.approverName} approved · ` : "";
      return `${prefix}Reviewer not named · Ask HR to confirm who will decide`;
    }
    if (approved?.approverName && waitingFor)
      return `${approved.approverName} approved · Waiting for ${waitingFor}`;
    return waitingFor ? `Waiting for ${waitingFor}` : "Waiting for the assigned reviewer";
  }

  if (["Approved", "Taken"].includes(request.status)) {
    return approved?.approverName
      ? `Approved by ${approved.approverName}`
      : staffView
        ? null
        : "Decision-maker not recorded";
  }
  return null;
}
