/** Actual work is retained even when it exceeds the standard-day target.
 * Project allocation is compared separately; it does not erase measured work.
 */
export function effectiveDailyWorkHours(
  manualHours: number,
  attendanceHours: number,
  attendanceComplete: boolean,
  _fullAbsence: boolean,
): number {
  // A leave/holiday overlap needs review, but must not erase hours actually worked.
  if (attendanceComplete) return Math.max(manualHours, attendanceHours);
  return manualHours > 0 ? manualHours : 0;
}
