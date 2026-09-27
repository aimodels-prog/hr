/** Closed cases remain readable, but must never change employment or access again. */
export function isOffboardingCaseActive(status: string): boolean {
  return status === "In Progress" || status === "Pending Clearance";
}

export function assertOffboardingCaseActive(status: string): void {
  if (!isOffboardingCaseActive(status)) {
    throw new Error(`This offboarding case is ${status} and can no longer be changed.`);
  }
}
