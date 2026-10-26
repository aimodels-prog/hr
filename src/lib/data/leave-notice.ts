import type { LeavePolicy } from "./leave-types.ts";

/** Compare date-only values in the organisation's timezone, not server/browser clock hours. */
export function leaveNoticeAssessment(
  rules: LeavePolicy["noticeRules"],
  workingDays: number,
  startDate: string,
  today: string,
): { requiredDays: number; actualDays: number } | null {
  if (!rules?.enabled || workingDays <= 0 || !startDate || !today) return null;
  const requiredDays =
    workingDays > (rules.shortLeaveMaxDays ?? 5)
      ? (rules.longLeaveNoticeDays ?? 60)
      : (rules.shortLeaveNoticeDays ?? 14);
  const actualDays = Math.round(
    (Date.parse(`${startDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  return Number.isFinite(actualDays) && actualDays < requiredDays
    ? { requiredDays, actualDays }
    : null;
}

export function validateLeaveNoticeException(reason: string | undefined): string {
  const trimmed = reason?.trim() ?? "";
  if (trimmed.length < 10)
    throw new Error("Explain the special request in at least 10 characters before submitting.");
  return trimmed;
}
