/** Preserve raw terminal punches, but use one effective time for close repeat thumbs. */
export function effectiveTerminalPunchTimes(events: Date[], repeatWindowMinutes: number): Date[] {
  const effective: Date[] = [];
  const windowMs = repeatWindowMinutes * 60_000;
  for (const event of events) {
    const previous = effective[effective.length - 1];
    if (!previous || event.getTime() - previous.getTime() > windowMs) effective.push(event);
  }
  return effective;
}

export interface TerminalOfficePunchEvidence {
  source: string;
  deviceStatus?: number | null;
}

/** A projected office in/out is evidence of work; only an explicit terminal OUT
 * can automatically reverse leave. Inferred parity still needs HR review.
 */
export function officeLeaveReturnEvidence(input: {
  clockInAt?: string | null | undefined;
  clockOutAt?: string | null | undefined;
  workMode?: string | null | undefined;
  activeSiteVisit: boolean;
  effectiveEvents: readonly TerminalOfficePunchEvidence[];
}): { completeOfficeDay: boolean; explicitOut: boolean } {
  const completeOfficeDay = Boolean(
    input.clockInAt && input.clockOutAt && input.workMode === "Office",
  );
  const first = input.effectiveEvents[0];
  const last = input.effectiveEvents.at(-1);
  return {
    completeOfficeDay,
    explicitOut: Boolean(
      completeOfficeDay &&
      !input.activeSiteVisit &&
      input.effectiveEvents.length >= 2 &&
      first?.source === "Hardware Terminal" &&
      first.deviceStatus === 0 &&
      last?.source === "Hardware Terminal" &&
      last.deviceStatus === 1,
    ),
  };
}
