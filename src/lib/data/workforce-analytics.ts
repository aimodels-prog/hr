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

export function employedOn(employee: AnalyticsEmployee, date: string): boolean {
  if (employee.startDate > date || (employee.terminationDate && employee.terminationDate < date))
    return false;
  return (
    ["Active", "Probation", "Notice", "Onboarding"].includes(employee.status) ||
    !!employee.terminationDate
  );
}

export function calculateAttendanceAnalytics(input: {
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
      const scheduled =
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
      const pendingVisit = pendingVisits.has(`${employee.id}:${date}`);
      const hours = Number(record?.calculatedHours ?? 0);
      const closed =
        !!record?.clockInAt &&
        !!record.clockOutAt &&
        !["Correction Pending", "Absent"].includes(record.status) &&
        Number.isFinite(hours) &&
        hours >= 0 &&
        hours <= 24;
      if (closed && !pendingVisit) day.worked += hours;
      if (expected > 0) {
        if (pendingVisit || (record && !closed)) day.review += 1;
        else if (closed) day.recorded += 1;
        else day.missing += 1;
      }
    }
    day.worked = Math.round(day.worked * 100) / 100;
    day.expected = Math.round(day.expected * 100) / 100;
    return day;
  });
}
