export const WORK_ELIGIBILITY_OPTIONS = [
  "Omani citizen",
  "Valid Oman work visa",
  "Need employer sponsorship",
  "Not sure",
] as const;

export const EXISTING_VISA_OPTIONS = [
  "Own Visa",
  "Company Visa",
  "Freelance Visa",
  "Other",
] as const;

export function isValidWorkEligibility(value: unknown): boolean {
  return typeof value === "string" && WORK_ELIGIBILITY_OPTIONS.some((option) => option === value);
}

export function isValidExistingVisa(value: unknown): boolean {
  return typeof value === "string" && EXISTING_VISA_OPTIONS.some((option) => option === value);
}
