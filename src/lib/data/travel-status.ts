import type { TravelRequest } from "./travel-types.ts";

export function travelStatusLabel(
  request: Pick<
    TravelRequest,
    | "status"
    | "managerApprovalStatus"
    | "hrApprovalStatus"
    | "accountsApprovalStatus"
    | "approvalRoute"
    | "managerApprovedBy"
    | "participants"
  >,
): string {
  if (request.status === "Pending Super Admin Closure")
    return "Awaiting Finance reimbursement closure";
  if (request.status === "Withdrawn") return "Cancelled";
  if (request.status !== "Pending HR and Accounts") return request.status;
  if (request.managerApprovalStatus === "Pending")
    return request.approvalRoute?.kind === "HR Own Travel"
      ? request.managerApprovedBy
        ? "Awaiting travelling colleagues’ supervisors"
        : request.participants?.some((participant) => participant.status === "Pending")
          ? `Awaiting ${request.approvalRoute.reviewerName ?? "independent reviewer"} and colleagues’ supervisors`
          : `Awaiting ${request.approvalRoute.reviewerName ?? "independent reviewer"}`
      : "Awaiting supervisor approval";
  if (request.hrApprovalStatus === "Pending") return "Awaiting HR approval";
  if (request.accountsApprovalStatus === "Pending") return "Awaiting Finance approval";
  return "Awaiting approval reconciliation";
}
