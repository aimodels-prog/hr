import { isAttendanceTracked, type AttendanceTrackingPolicy } from "./attendance-tracking.ts";
export interface AnalyticsEmployee {
  id: string;
  startDate: string;
  terminationDate: string | null;
  status: string;
  locationId: string;
  department: string;
}
export interface AnalyticsDay {
  date: string;
  worked: number;
  expected: number;
  recorded: number;
  review: number;
  missing: number;
  leaveDays: number;
}
export interface WorkforceAnalytics {
  workforceHeadcount?: number;
  attendanceTracked?: boolean;
  today: { date: string; headcount: number; recorded: number; onLeave: number };
  priorities: {
    leaveYear: number;
    leaveYearStart: string;
    leaveYearEnd: string;
    annualLeave: import("./dashboard-priorities.ts").LeaveChartRow[];
    approvals: { name: string; count: number }[];
    expiries: { name: string; count: number }[];
  };
  scope: "self" | "hr";
  timezone: string;
  startDate: string;
  endDate: string;
  dailyHours: number;
  days: AnalyticsDay[];
  totals: { worked: number; expected: number; review: number; missing: number; leaveDays: number };
  departments: { name: string; count: number }[];
  recruitment: { name: string; count: number }[];
  offices: { name: string; count: number }[];
  employmentStatuses: { name: string; count: number }[];
  leaveQueue: { name: string; count: number }[];
  visits: { name: string; count: number }[];
}

export function completedDateRange(today: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - count + index);
    return date.toISOString().slice(0, 10);
  });
}

/** Last N calendar days, including the current local day. */
export function attendanceChartDateRange(today: string, count: number): string[] {
  return [...completedDateRange(today, count - 1), today];
}

/** Today's snapshot is separate from completed-day trends; a missing punch is not absence. */
export function attendanceToday(input: {
  tracking?: AttendanceTrackingPolicy | null;
  date: string;
  now: Date;
  people: AnalyticsEmployee[];
  records: {
    employeeId: string;
    date: string;
    clockInAt: string | null;
    status: string;
    creditedHours?: number;
  }[];
  leave: { employeeId: string; startDate: string; endDate: string }[];
  pendingVisits: { employeeId: string; date: string }[];
}) {
  const recordedPeople = new Set(
    input.records
      .filter(
        (record) =>
          record.date === input.date &&
          (record.creditedHours !== undefined ||
            (!!record.clockInAt && Date.parse(record.clockInAt) <= input.now.getTime())) &&
          !["Absent", "Correction Pending"].includes(record.status) &&
          (record.creditedHours !== undefined ||
            !input.pendingVisits.some(
              (visit) => visit.employeeId === record.employeeId && visit.date === input.date,
            )),
      )
      .map((record) => record.employeeId),
  );
  const current = new Set(
    input.people
      .filter(
        (person) =>
          employedOn(person, input.date) &&
          (input.tracking === undefined ||
            isAttendanceTracked(input.tracking, person.id, input.date) ||
            recordedPeople.has(person.id)),
      )
      .map((person) => person.id),
  );
  const pending = new Set(
    input.pendingVisits
      .filter((visit) => visit.date === input.date)
      .map((visit) => visit.employeeId),
  );
  return {
    date: input.date,
    headcount: current.size,
    recorded: new Set(
      input.records
        .filter(
          (record) =>
            record.date === input.date &&
            current.has(record.employeeId) &&
            recordedPeople.has(record.employeeId) &&
            (record.creditedHours !== undefined || !pending.has(record.employeeId)),
        )
        .map((record) => record.employeeId),
    ).size,
    onLeave: new Set(
      input.leave
        .filter(
          (request) =>
            input.people.some(
              (person) => person.id === request.employeeId && employedOn(person, input.date),
            ) &&
            request.startDate <= input.date &&
            request.endDate >= input.date,
        )
        .map((request) => request.employeeId),
    ).size,
  };
}

export function employedOn(employee: AnalyticsEmployee, date: string): boolean {
  if (employee.startDate > date || (employee.terminationDate && employee.terminationDate < date))
    return false;
  return (
    ["Active", "Probation", "Notice", "Onboarding"].includes(employee.status) ||
    !!employee.terminationDate
  );
}

export function calculateAttendanceAnalytics(input: {
  today?: string;
  now?: Date;
  tracking?: AttendanceTrackingPolicy | null;
  dates: string[];
  employees: AnalyticsEmployee[];
  workingDays: number[];
  dailyHours: number;
  holidays: { date: string; locationId: string | null }[];
  leave: { employeeId: string; startDate: string; endDate: string; isHalfDay: boolean }[];
  records: {
    employeeId: string;
    date: string;
    clockInAt: string | null;
    clockOutAt: string | null;
    calculatedHours: string | number;
    creditedHours?: number;
    status: string;
  }[];
  pendingVisits: { employeeId: string; date: string }[];
}): AnalyticsDay[] {
  const records = new Map(
    input.records.map((record) => [`${record.employeeId}:${record.date}`, record]),
  );
  const pendingVisits = new Set(
    input.pendingVisits.map((visit) => `${visit.employeeId}:${visit.date}`),
  );
  const leaveByEmployee = new Map<string, typeof input.leave>();
  for (const leave of input.leave)
    leaveByEmployee.set(leave.employeeId, [
      ...(leaveByEmployee.get(leave.employeeId) ?? []),
      leave,
    ]);
  const holidays = new Set(
    input.holidays.map((holiday) => `${holiday.locationId ?? "all"}:${holiday.date}`),
  );
  return input.dates.map((date) => {
    const day: AnalyticsDay = {
      date,
      worked: 0,
      expected: 0,
      recorded: 0,
      review: 0,
      missing: 0,
      leaveDays: 0,
    };
    const workingDay = input.workingDays.includes(new Date(`${date}T12:00:00Z`).getUTCDay());
    for (const employee of input.employees) {
      if (!employedOn(employee, date)) continue;
      const tracked =
        input.tracking === undefined || isAttendanceTracked(input.tracking, employee.id, date);
      const scheduled =
        tracked &&
        workingDay &&
        !holidays.has(`all:${date}`) &&
        !holidays.has(`${employee.locationId}:${date}`);
      const leaveFraction = Math.min(
        1,
        (leaveByEmployee.get(employee.id) ?? [])
          .filter((leave) => leave.startDate <= date && leave.endDate >= date)
          .reduce((sum, leave) => sum + (leave.isHalfDay ? 0.5 : 1), 0),
      );
      const expected = scheduled ? input.dailyHours * (1 - leaveFraction) : 0;
      day.expected += expected;
      if (scheduled) day.leaveDays += leaveFraction;
      const record = records.get(`${employee.id}:${date}`);
      const pendingVisit =
        record?.creditedHours === undefined && pendingVisits.has(`${employee.id}:${date}`);
      if (date === input.today && input.now) {
        // Today's unfinished shift is live evidence, never a missing-punch/absence finding.
        day.expected -= expected;
        if (record && !pendingVisit && !["Correction Pending", "Absent"].includes(record.status)) {
          const start = record.clockInAt ? Date.parse(record.clockInAt) : NaN;
          const end = Math.min(
            input.now.getTime(),
            record.clockOutAt ? Date.parse(record.clockOutAt) : input.now.getTime(),
          );
          const liveHours = record.creditedHours ?? (end - start) / 3_600_000;
          if (Number.isFinite(liveHours) && liveHours >= 0 && liveHours <= 24) {
            day.worked += liveHours;
            day.recorded += 1;
          }
        }
        continue;
      }
      const hours = Number(record?.calculatedHours ?? 0);
      const closed =
        !!record &&
        (record.creditedHours !== undefined || (!!record.clockInAt && !!record.clockOutAt)) &&
        !["Correction Pending", "Absent"].includes(record.status) &&
        Number.isFinite(hours) &&
        hours >= 0 &&
        hours <= 24;
      if (closed && !pendingVisit) day.worked += hours;
      // Actual evidence remains visible even before tracking is configured or on
      // non-working days. Only infer a missing record when work was expected.
      if (pendingVisit || (record && !closed)) day.review += 1;
      else if (closed) day.recorded += 1;
      else if (expected > 0) day.missing += 1;
    }
    day.worked = Math.round(day.worked * 100) / 100;
    day.expected = Math.round(day.expected * 100) / 100;
    return day;
  });
}
