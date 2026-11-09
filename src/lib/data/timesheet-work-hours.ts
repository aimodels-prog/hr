/** A complete, corrected attendance day can supply work hours when no manual allocation exists. */
export function effectiveDailyWorkHours(
  manualHours: number,
  attendanceHours: number,
  attendanceComplete: boolean,
  fullAbsence: boolean,
): number {
  if (manualHours > 0) return manualHours;
  return attendanceComplete && !fullAbsence ? attendanceHours : 0;
}
