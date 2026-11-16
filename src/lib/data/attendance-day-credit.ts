export type ApprovedDayInterval = { startTime: string; endTime: string };

function minute(value: string): number | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

function mergedIntervals(intervals: readonly ApprovedDayInterval[]) {
  const sorted = intervals
    .map(({ startTime, endTime }) => ({ start: minute(startTime), end: minute(endTime) }))
    .filter(
      (item): item is { start: number; end: number } =>
        item.start !== null && item.end !== null && item.end > item.start,
    )
    .sort((a, b) => a.start - b.start);
  const result: Array<{ start: number; end: number }> = [];
  for (const item of sorted) {
    const last = result.at(-1);
    if (last && item.start <= last.end) last.end = Math.max(last.end, item.end);
    else result.push({ ...item });
  }
  return result;
}

function overlap(start: number, end: number, otherStart: number, otherEnd: number) {
  return Math.max(0, Math.min(end, otherEnd) - Math.max(start, otherStart));
}

/** Approved time remains visible separately and clocked minutes are never counted twice.
 * A short approved day fills to the standard target; time above it remains visible,
 * but does not create an overtime claim.
 */
export function attendanceDayCredit(input: {
  actualWorkHours: number;
  standardDailyHours: number;
  clockIn?: string | null | undefined;
  clockOut?: string | null | undefined;
  breakStart?: string | undefined;
  breakMinutes?: number | undefined;
  approvedIntervals?: readonly ApprovedDayInterval[];
  unpaidIntervals?: readonly ApprovedDayInterval[];
  paidLeaveFraction?: number;
  approvedRemoteWork?: boolean;
}) {
  const target = Math.max(0, input.standardDailyHours);
  const recorded = Math.max(0, input.actualWorkHours);
  const approved = mergedIntervals(input.approvedIntervals ?? []);
  const allAway = mergedIntervals([
    ...(input.approvedIntervals ?? []),
    ...(input.unpaidIntervals ?? []),
  ]);
  const approvedMinutes = approved.reduce((sum, item) => sum + item.end - item.start, 0);
  let awayInsideRecordedWork = 0;
  const clockIn = minute(input.clockIn ?? "");
  const clockOut = minute(input.clockOut ?? "");
  const breakStart = minute(input.breakStart ?? "");
  const clockOutMinute =
    clockIn !== null && clockOut !== null && clockOut < clockIn ? clockOut + 1440 : clockOut;
  if (clockIn !== null && clockOutMinute !== null && clockOutMinute > clockIn) {
    // Stored net work already excludes the break, so subtract only away
    // minutes that are actually included in those net work hours.
    const breakEnd = breakStart === null ? null : breakStart + (input.breakMinutes ?? 0);
    awayInsideRecordedWork = allAway.reduce((sum, item) => {
      const withinPunches = overlap(item.start, item.end, clockIn, clockOutMinute);
      const withinBreak =
        breakStart === null || breakEnd === null
          ? 0
          : overlap(
              item.start,
              item.end,
              Math.max(clockIn, breakStart),
              Math.min(clockOutMinute, breakEnd),
            );
      return sum + Math.max(0, withinPunches - withinBreak);
    }, 0);
  }
  const officeWork = Math.max(0, recorded - awayInsideRecordedWork / 60);
  const activityHours = approvedMinutes / 60;
  const combined = officeWork + activityHours;
  const paidLeaveHours = target * Math.max(0, Math.min(1, input.paidLeaveFraction ?? 0));
  const completedByPolicy = approvedMinutes > 0 || Boolean(input.approvedRemoteWork);
  const workCredit = completedByPolicy ? Math.max(target - paidLeaveHours, combined) : combined;
  const credited = Math.max(workCredit, Math.min(target, workCredit + paidLeaveHours));
  return {
    recordedHours: Number(recorded.toFixed(2)),
    officeWorkHours: Number(officeWork.toFixed(2)),
    approvedActivityHours: Number(activityHours.toFixed(2)),
    policyTopupHours: Number(Math.max(0, workCredit - combined).toFixed(2)),
    creditedHours: Number(credited.toFixed(2)),
    complete: credited >= target && target > 0,
  };
}
