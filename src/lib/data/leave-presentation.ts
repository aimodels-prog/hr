/** Prefer the recorded name: historical policies may no longer be available for requests. */
export function leaveDisplayType(
  request: { policySnapshot?: { name?: string } | null },
  policy?: { name: string },
): string {
  return (request.policySnapshot?.name?.trim() || policy?.name?.trim() || "Leave").replace(
    /\s+[—–-]\s+imported history$/i,
    "",
  );
}

/** Keep spreadsheet provenance in storage, not in the employee-facing reason. */
export function leaveDisplayReason(reason: string): string {
  return reason
    .replace(
      /^Previously approved spreadsheet record \([^)]*\)\. Original approval date\/approver not supplied\. Balance reconciliation pending\./,
      "",
    )
    .trim();
}

/** Order by leave dates, never by the date a historical batch was imported. */
export function newestLeaveFirst(
  a: { startDate: string; endDate: string; id: string },
  b: { startDate: string; endDate: string; id: string },
): number {
  return (
    b.startDate.localeCompare(a.startDate) ||
    b.endDate.localeCompare(a.endDate) ||
    a.id.localeCompare(b.id)
  );
}
