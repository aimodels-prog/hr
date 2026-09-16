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

export function leaveReminderStage(today: string, leaveYear: number, carry: number) {
  const deadline = `${leaveYear}-04-30`;
  if (carry > 0 && today >= `${leaveYear}-01-01` && today <= deadline) {
    const day = Number(today.slice(8));
    const aprilStage =
      today.slice(5, 7) === "04" ? (day >= 29 ? 29 : day >= 23 ? 23 : day >= 15 ? 15 : 1) : 1;
    return { kind: "carry" as const, key: `${today.slice(0, 7)}-${aprilStage}`, deadline };
  }
  return { kind: "annual" as const, key: today.slice(0, 7), deadline };
}
