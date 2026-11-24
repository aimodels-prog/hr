/** Prefer the recorded name: historical policies may no longer be available for requests. */
export function leaveDisplayType(
  request: { policySnapshot?: { name?: string } | null },
  policy?: { name: string },
): string {
  const name = request.policySnapshot?.name?.trim() || policy?.name?.trim() || "Leave";
  return name.replace(/\s+[—–-]\s+imported history$/i, "").trim();
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

/** Imported history has no original submission timestamp; its creation time is only the import time. */
export function leaveSubmittedAt(
  request: {
    createdAt?: string;
    policySnapshot?: { name?: string; spreadsheetImport?: unknown } | null;
  },
  timeZone: string,
): string | null {
  if (
    request.policySnapshot?.spreadsheetImport ||
    /imported history$/i.test(request.policySnapshot?.name?.trim() ?? "")
  )
    return null;
  if (!request.createdAt) return null;
  const date = new Date(request.createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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
