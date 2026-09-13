import type { TravelRequest } from "./travel-types.ts";

export function travelStatusLabel(
  request: Pick<
    TravelRequest,
    "status" | "managerApprovalStatus" | "hrApprovalStatus" | "accountsApprovalStatus"
  >,
): string {
  if (request.status === "Pending Super Admin Closure")
    return "Awaiting Finance reimbursement closure";
  if (request.status !== "Pending HR and Accounts") return request.status;
  const outstanding = [
    request.managerApprovalStatus === "Pending" ? "Manager" : "",
    request.hrApprovalStatus === "Pending" ? "HR" : "",
    request.accountsApprovalStatus === "Pending" ? "Finance" : "",
  ].filter(Boolean);
  return outstanding.length
    ? `Awaiting ${outstanding.join(" / ")} approval`
    : "Awaiting approval reconciliation";
}
