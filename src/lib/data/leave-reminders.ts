import { DEFAULT_REMINDER_RULES, type ReminderRules } from "./reminder-rules.ts";
/** Reminder estimates use oldest leave first; this never changes the balance ledger. */
export function remainingCarryForReminder(
  balance: number,
  transactions: Array<{ transactionType: string; days: number }>,
): number {
  const carry = transactions
    .filter((row) => row.transactionType === "Carry-Forward")
    .reduce((sum, row) => sum + row.days, 0);
  const movements = transactions
    .filter((row) => !["Entitlement", "Carry-Forward", "Accrual"].includes(row.transactionType))
    .reduce((sum, row) => sum + row.days, 0);
  return Math.max(0, Math.min(balance, carry, carry + movements));
}

export function leaveReminderStage(
  today: string,
  leaveYear: number,
  carry: number,
  rules: ReminderRules = DEFAULT_REMINDER_RULES,
  leaveYearStart = "01-01",
) {
  const deadlineYear = leaveYear + (rules.carryDeadline < leaveYearStart ? 1 : 0);
  const deadline = `${deadlineYear}-${rules.carryDeadline}`;
  if (carry > 0 && today >= `${leaveYear}-${leaveYearStart}` && today <= deadline) {
    let stageDate = `${today.slice(0, 7)}-01`;
    for (const days of rules.carryExtraDays) {
      const reached = new Date(Date.parse(`${deadline}T00:00:00Z`) - days * 86400000)
        .toISOString()
        .slice(0, 10);
      if (reached <= today && reached > stageDate) stageDate = reached;
    }
    return {
      kind: "carry" as const,
      key: `${stageDate.slice(0, 7)}-${Number(stageDate.slice(8))}`,
      deadline,
    };
  }
  const month =
    Math.floor((Number(today.slice(5, 7)) - 1) / rules.annualEveryMonths) *
      rules.annualEveryMonths +
    1;
  return {
    kind: "annual" as const,
    key: `${today.slice(0, 4)}-${String(month).padStart(2, "0")}`,
    deadline,
  };
}
