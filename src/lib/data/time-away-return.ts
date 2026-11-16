function minutes(value: string): number {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

/** A first office scan after time away proves arrival even without an earlier
 * thumb (the employee may have started from home). With an earlier office
 * clock-in, only a marked IN close to the expected return is unambiguous.
 */
export function isTimeAwayMachineReturn(input: {
  deviceStatus: number | null | undefined;
  localTime: string;
  startTime: string;
  endTime: string;
  hasOriginalClockIn: boolean;
  alreadyReturned: boolean;
}): boolean {
  if (input.alreadyReturned) return false;
  const start = minutes(input.startTime);
  const end = minutes(input.endTime);
  const at = minutes(input.localTime);
  if (!input.hasOriginalClockIn) return at > start;
  if (input.deviceStatus !== 0) return false;
  return at > start && at >= Math.max(start + 1, end - 15) && at <= end + 60;
}
