export interface IndependentReviewIdentity {
  employeeId?: string;
  userId?: string;
  activeRole?: string | null;
}

/** Identity-scoped permission, never a general HR-role grant. */
export function isAssignedIndependentReviewer(
  actor: IndependentReviewIdentity,
  requesterEmployeeId: string,
  reviewer: { employeeId: string; userId: string } | null,
): boolean {
  return Boolean(
    reviewer &&
    actor.activeRole !== "Super Admin" &&
    reviewer.employeeId !== requesterEmployeeId &&
    actor.employeeId === reviewer.employeeId &&
    actor.userId === reviewer.userId,
  );
}

/** Existing special leave must never lose its Country Manager approval stage in bulk routing. */
export function mustPreserveSpecialLeaveChain(
  policySnapshot: unknown,
  chainApprovals: unknown,
): boolean {
  const policy =
    policySnapshot && typeof policySnapshot === "object" && !Array.isArray(policySnapshot)
      ? (policySnapshot as Record<string, unknown>)
      : {};
  const chain = Array.isArray(chainApprovals) ? chainApprovals : [];
  return Boolean(
    policy["specialRequest"] ||
    policy["noticeException"] ||
    chain.some(
      (step) =>
        step &&
        typeof step === "object" &&
        step.role === "Country Manager" &&
        step.status === "Pending",
    ),
  );
}

/** A correction to a returned proposal is still the same review cycle. */
export function isNewEmploymentReviewCycle(previousStatus: string): boolean {
  return previousStatus === "Confirmed";
}
