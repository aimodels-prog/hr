/** A title never grants HR access or approval permissions. */
export function isCeoPosition(position: string): boolean {
  const title = position.trim().replace(/\s+/g, " ").toLowerCase();
  return title === "ceo" || title === "chief executive officer";
}
export function validateCeoSupervisor(position: string, supervisor?: string | null): void {
  if (isCeoPosition(position) && supervisor)
    throw new Error("The CEO has no supervisor. Clear the supervisor before saving.");
}
