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
