/** Assignment authorises this one offer only; a global HR role cannot bypass it. */
export function assertIndependentOfferApprover(
  offer: {
    approverUserId: string | null;
    createdBy: string;
    approvalRequestedBy: string | null;
    history: unknown;
  },
  userId: string,
) {
  const authors = Array.isArray(offer.history) ? offer.history : [];
  if (
    offer.approverUserId !== userId ||
    offer.createdBy === userId ||
    offer.approvalRequestedBy === userId ||
    authors.some(
      (entry) =>
        entry && typeof entry === "object" && "preparedBy" in entry && entry.preparedBy === userId,
    )
  ) {
    throw new Error("Only the assigned independent manager can approve or return this offer.");
  }
}
