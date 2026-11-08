/** A title never grants HR access or approval permissions. */
export function isCeoPosition(position: string): boolean {
  const title = position.trim().replace(/\s+/g, " ").toLowerCase();
  return title === "ceo" || title === "chief executive officer";
}

/** These leadership positions may have no direct line manager. */
export function isSupervisorOptionalPosition(position: string): boolean {
  const title = position.trim().replace(/\s+/g, " ").toLowerCase();
  return isCeoPosition(title) || title === "country manager" || title === "country manager oman";
}

export function validateCeoSupervisor(position: string, supervisor?: string | null): void {
  if (isCeoPosition(position) && supervisor)
    throw new Error("The CEO has no supervisor. Clear the supervisor before saving.");
}
