export interface LiveAttendanceRecord {
  creditedHours?: number | undefined;
  clockInAt: string | null;
  clockOutAt: string | null;
  breakMinutes: number;
  breakStartAt?: string | undefined;
  breakEndAt?: string | undefined;
}

/** Display only: never writes attendance or approves overtime. */
export function workedMinutes(record: LiveAttendanceRecord | null, now: number): number {
  if (record?.creditedHours !== undefined) return Math.round(record.creditedHours * 60);
  if (!record?.clockInAt) return 0;
  const start = Date.parse(record.clockInAt);
  const end = record.clockOutAt ? Math.min(now, Date.parse(record.clockOutAt)) : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 60_000));
}

export function formatWorkedMinutes(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes));
  if (total < 60) return `${total} min`;
  return `${Math.floor(total / 60)} hr ${total % 60} min`;
}
