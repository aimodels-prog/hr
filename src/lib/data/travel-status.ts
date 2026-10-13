import type { TravelRequest } from "./travel-types.ts";

export function travelStatusLabel(
  request: Pick<
    TravelRequest,
    "status" | "managerApprovalStatus" | "hrApprovalStatus" | "accountsApprovalStatus"
  >,
): string {
  if (request.status === "Pending Super Admin Closure")
    return "Awaiting Finance reimbursement closure";
  if (request.status === "Withdrawn") return "Cancelled";
  if (request.status !== "Pending HR and Accounts") return request.status;
  if (request.managerApprovalStatus === "Pending") return "Awaiting supervisor approval";
  if (request.hrApprovalStatus === "Pending") return "Awaiting HR approval";
  if (request.accountsApprovalStatus === "Pending") return "Awaiting Finance approval";
  return "Awaiting approval reconciliation";
}
