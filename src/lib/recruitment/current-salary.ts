/** New candidate submissions use a monthly OMR amount; zero is valid when not earning. */
export function isValidCurrentSalaryOmr(value: unknown): boolean {
  return typeof value === "string" && /^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(value.trim());
}
