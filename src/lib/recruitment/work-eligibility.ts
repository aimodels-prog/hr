export const WORK_ELIGIBILITY_OPTIONS = [
  "Yes, I am authorised to work there",
  "Need employer sponsorship",
  "Not sure",
] as const;

export function isValidWorkEligibility(value: unknown): boolean {
  return typeof value === "string" && WORK_ELIGIBILITY_OPTIONS.some((option) => option === value);
}
