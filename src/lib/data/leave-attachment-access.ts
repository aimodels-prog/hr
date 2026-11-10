/** A retained leave attachment is available only to its owner or an authorised reviewer. */
export function canReadLeaveAttachment(input: {
  requesterEmployeeId: string;
  actorEmployeeId: string | null | undefined;
  actorRole: string | null | undefined;
  assignedReviewerEmployeeId?: string | null | undefined;
  currentLineManagerEmployeeId?: string | null | undefined;
  specialReviewerEmployeeId?: string | null | undefined;
  pendingHrReview: boolean;
  actorMadeDecision: boolean;
}): boolean {
  return (
    input.requesterEmployeeId === input.actorEmployeeId ||
    input.actorMadeDecision ||
    (input.actorRole !== "Super Admin" &&
      Boolean(input.actorEmployeeId) &&
      input.assignedReviewerEmployeeId === input.actorEmployeeId) ||
    (input.actorRole === "Line Manager" &&
      Boolean(input.actorEmployeeId) &&
      input.currentLineManagerEmployeeId === input.actorEmployeeId) ||
    (input.pendingHrReview &&
      Boolean(input.actorEmployeeId) &&
      input.specialReviewerEmployeeId === input.actorEmployeeId) ||
    input.actorRole === "HR" ||
    input.actorRole === "Super Admin"
  );
}
