export interface LiveAttendanceRecord {
  clockInAt: string | null;
  clockOutAt: string | null;
  breakMinutes: number;
  breakStartAt?: string | undefined;
  breakEndAt?: string | undefined;
}

/** Display only: never writes attendance or approves overtime. */
export function workedMinutes(record: LiveAttendanceRecord | null, now: number): number {
  if (!record?.clockInAt) return 0;
  const start = Date.parse(record.clockInAt);
  const end = record.clockOutAt ? Math.min(now, Date.parse(record.clockOutAt)) : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const lunchStart = Date.parse(record.breakStartAt ?? "");
  const lunchEnd = Date.parse(record.breakEndAt ?? "");
  const deduction =
    Number.isFinite(lunchStart) && Number.isFinite(lunchEnd)
      ? Math.max(0, Math.min(end, lunchEnd) - Math.max(start, lunchStart)) / 60_000
      : Math.max(0, record.breakMinutes);
  return Math.max(0, Math.floor((end - start) / 60_000 - deduction));
}

export function formatWorkedMinutes(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes));
  if (total < 60) return `${total} min`;
  return `${Math.floor(total / 60)} hr ${total % 60} min`;
}
