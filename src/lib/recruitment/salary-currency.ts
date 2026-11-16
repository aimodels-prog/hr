const fallbackCurrencies = ["AED", "EUR", "GBP", "INR", "OMR", "PKR", "USD", "UGX"];

const codes =
  typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("currency")
    : fallbackCurrencies;
const names = new Intl.DisplayNames(["en"], { type: "currency" });

export const SALARY_CURRENCY_OPTIONS = codes
  .map((code) => ({
    value: code,
    label: `${code} — ${names.of(code) ?? code}`,
    keywords: [code, names.of(code) ?? code],
  }))
  .sort((a, b) => a.value.localeCompare(b.value));

const supportedCodes = new Set(SALARY_CURRENCY_OPTIONS.map((option) => option.value));

export function isSupportedSalaryCurrency(value: string): boolean {
  return supportedCodes.has(value);
}

const monthlyAmount = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
const monthlyAmountOrRange =
  /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?(?:\s*[-–]\s*(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?)?$/;

export function isValidMonthlySalaryAmount(value: unknown): boolean {
  return typeof value === "string" && monthlyAmount.test(value.trim());
}

export function isValidMonthlySalaryExpectation(value: unknown): boolean {
  return typeof value === "string" && monthlyAmountOrRange.test(value.trim());
}

/** Existing bare amounts remain readable; all new forms save an explicit ISO currency code. */
export function isValidStoredMonthlySalary(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const clean = value.trim();
  if (isValidMonthlySalaryAmount(clean)) return true;
  return isValidCurrencyQualifiedSalary(clean);
}

export function isValidCurrencyQualifiedSalary(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const clean = value.trim();
  const match = /^([A-Z]{3})\s+(.+)$/.exec(clean);
  return Boolean(
    match && isSupportedSalaryCurrency(match[1]!) && isValidMonthlySalaryAmount(match[2]!),
  );
}

export function isValidCurrencyQualifiedExpectation(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = /^([A-Z]{3})\s+(.+)$/.exec(value.trim());
  return Boolean(
    match && isSupportedSalaryCurrency(match[1]!) && isValidMonthlySalaryExpectation(match[2]!),
  );
}

/** Zero means the applicant is not currently earning, so there is no current currency. */
export function isValidApplicantCurrentSalary(value: unknown): boolean {
  return value === "0" || isValidCurrencyQualifiedSalary(value);
}

export function salaryWithCurrency(amount: string, currency: string): string {
  if (!isSupportedSalaryCurrency(currency) || !isValidMonthlySalaryAmount(amount))
    throw new Error("Select a currency and enter a valid monthly salary amount.");
  return `${currency} ${amount.trim()}`;
}

export function salaryExpectationWithCurrency(amount: string, currency: string): string {
  if (!isSupportedSalaryCurrency(currency) || !isValidMonthlySalaryExpectation(amount))
    throw new Error("Select a currency and enter a valid expected monthly salary.");
  return `${currency} ${amount.trim()}`;
}
