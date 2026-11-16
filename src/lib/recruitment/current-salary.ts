import { isValidStoredMonthlySalary } from "./salary-currency.ts";

/** Accept legacy bare OMR amounts and new currency-qualified monthly amounts. */
export function isValidCurrentSalaryOmr(value: unknown): boolean {
  return isValidStoredMonthlySalary(value);
}
