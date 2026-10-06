import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateAttendanceAnalytics,
  attendanceToday,
  completedDateRange,
  attendanceChartDateRange,
  type AnalyticsEmployee,
} from "../src/lib/data/workforce-analytics.ts";

const employee: AnalyticsEmployee = {
  id: "a",
  startDate: "2026-01-01",
  terminationDate: null,
  status: "Active",
  locationId: "office",
  department: "Operations",
};
const base = {
  dates: ["2026-09-14"],
  employees: [employee],
  workingDays: [1, 2, 3, 4, 5],
  dailyHours: 8,
  holidays: [],
  leave: [],
  records: [],
  pendingVisits: [],
};

test("chart includes today with a fixed 7/30-day range across year boundaries", () => {
  assert.equal(attendanceChartDateRange("2026-10-06", 30).at(-1), "2026-10-06");
  assert.equal(attendanceChartDateRange("2026-10-06", 30).length, 30);
  assert.deepEqual(attendanceChartDateRange("2026-01-01", 2), ["2025-12-31", "2026-01-01"]);
});

test("today includes live presence with breaks without missing-punch or shortfall findings", () => {
  const date = "2026-10-06";
  const record = {
    employeeId: "a",
    date,
    clockInAt: `${date}T03:30:00Z`,
    clockOutAt: null,
    calculatedHours: 0,
    status: "Present",
  };
  const input = {
    ...base,
    dates: [date],
    today: date,
    now: new Date(`${date}T12:29:00Z`),
    records: [record],
  };
  const [live] = calculateAttendanceAnalytics(input);
  assert.equal(live!.worked, 8.98);
  assert.equal(live!.recorded, 1);
  assert.equal(live!.review, 0);
  assert.equal(live!.missing, 0);
  assert.equal(live!.expected, 0);
  const [empty] = calculateAttendanceAnalytics({ ...input, records: [] });
  assert.equal(empty!.missing, 0);
  const [closed] = calculateAttendanceAnalytics({
    ...input,
    records: [{ ...record, clockOutAt: `${date}T11:30:00Z` }],
  });
  assert.equal(closed!.worked, 8);
  const [future] = calculateAttendanceAnalytics({
    ...input,
    records: [{ ...record, clockInAt: `${date}T13:00:00Z` }],
  });
  assert.equal(future!.worked, 0);
  assert.equal(future!.recorded, 0);
  const [pending] = calculateAttendanceAnalytics({
    ...input,
    pendingVisits: [{ employeeId: "a", date }],
  });
  assert.equal(pending!.worked, 0);
});

test("saved attendance counts without tracking while missing days have no expected hours or absence", () => {
  const date = "2026-09-14";
  const record = {
    employeeId: employee.id,
    date,
    clockInAt: `${date}T04:24:27Z`,
    clockOutAt: `${date}T13:00:40Z`,
    calculatedHours: "7.60",
    status: "Present",
  };
  const days = calculateAttendanceAnalytics({
    ...base,
    tracking: null,
    records: [record],
    dates: [date, "2026-09-15"],
  });
  assert.equal(days[0]?.worked, 7.6);
  assert.equal(days[0]?.recorded, 1);
  assert.equal(days[0]?.expected, 0);
  assert.equal(days[1]?.missing, 0);
  assert.equal(days[1]?.review, 0);
  const today = attendanceToday({
    tracking: null,
    date,
    now: new Date(`${date}T14:00Z`),
    people: [employee, { ...employee, id: "no-punch" }],
    records: [record],
    leave: [],
    pendingVisits: [],
  });
  assert.equal(today.recorded, 1);
  assert.equal(today.headcount, 1);
});

test("attendance evidence remains visible without tracking, on holidays and before eligibility starts", () => {
  const date = base.dates[0]!;
  const record = {
    employeeId: employee.id,
    date,
    clockInAt: `${date}T04:30:00Z`,
    clockOutAt: `${date}T13:30:00Z`,
    calculatedHours: "8",
    status: "Present",
  };
  for (const overrides of [
    { tracking: null },
    { workingDays: [] },
    { holidays: [{ date, locationId: null }] },
    { leave: [{ employeeId: employee.id, startDate: date, endDate: date, isHalfDay: false }] },
    {
      tracking: {
        headOfficeLocationId: "office",
        effectiveFrom: "2026-09-15",
        revision: 1,
        assignments: [],
      },
    },
  ]) {
    const input = { ...base, ...overrides };
    const complete = calculateAttendanceAnalytics({ ...input, records: [record] })[0]!;
    assert.equal(complete.recorded, 1);
    assert.equal(complete.worked, 8);
    assert.equal(complete.expected, 0);
    assert.equal(complete.missing, 0);
    const open = calculateAttendanceAnalytics({
      ...input,
      records: [{ ...record, clockOutAt: null }],
    })[0]!;
    assert.equal(open.review, 1);
    assert.equal(open.recorded, 0);
    assert.equal(open.worked, 0);
    assert.equal(calculateAttendanceAnalytics(input)[0]!.missing, 0);
  }
});

test("historical expectations survive a later change to not-required attendance", () => {
  const result = calculateAttendanceAnalytics({
    ...base,
    dates: ["2026-09-14", "2026-09-15"],
    tracking: {
      headOfficeLocationId: "office",
      effectiveFrom: "2026-09-14",
      revision: 2,
      assignments: [
        {
          employeeId: "a",
          effectiveFrom: "2026-09-14",
          mode: "Head Office biometric",
          source: "override",
        },
        { employeeId: "a", effectiveFrom: "2026-09-15", mode: "Not required", source: "override" },
      ],
    },
  });
  assert.deepEqual(
    result.map((day) => day.expected),
    [8, 0],
  );
  assert.deepEqual(
    result.map((day) => day.missing),
    [1, 0],
  );
});

test("untracked pending or incomplete punches are not counted as completed hours", () => {
  const record = {
    employeeId: employee.id,
    date: base.dates[0]!,
    clockInAt: "2026-09-14T04:00Z",
    clockOutAt: "2026-09-14T13:00Z",
    calculatedHours: "8",
    status: "Correction Pending",
  };
  assert.equal(
    calculateAttendanceAnalytics({ ...base, tracking: null, records: [record] })[0]?.worked,
    0,
  );
  assert.equal(
    calculateAttendanceAnalytics({
      ...base,
      tracking: null,
      records: [{ ...record, status: "Present", clockOutAt: null }],
    })[0]?.worked,
    0,
  );
});

test("today counts unique recorded people, not everyone who is off leave", () => {
  const date = "2026-09-14";
  const people = [
    employee,
    { ...employee, id: "b" },
    { ...employee, id: "future", startDate: "2026-10-01" },
  ];
  const records = [
    { employeeId: "a", date, clockInAt: `${date}T06:00:00Z`, status: "Present" },
    { employeeId: "a", date, clockInAt: `${date}T06:00:00Z`, status: "Present" },
    { employeeId: "b", date, clockInAt: `${date}T16:00:00Z`, status: "Present" },
    { employeeId: "future", date, clockInAt: `${date}T06:00:00Z`, status: "Present" },
  ];
  const input = {
    date,
    now: new Date(`${date}T12:00:00Z`),
    people,
    records,
    leave: [{ employeeId: "b", startDate: date, endDate: date }],
    pendingVisits: [],
  };
  assert.deepEqual(attendanceToday(input), { date, headcount: 2, recorded: 1, onLeave: 1 });
  assert.equal(
    attendanceToday({ ...input, pendingVisits: [{ employeeId: "a", date }] }).recorded,
    0,
  );
});
test("analytics excludes today and handles year boundaries", () => {
  assert.deepEqual(completedDateRange("2026-01-02", 3), ["2025-12-30", "2025-12-31", "2026-01-01"]);
});
test("expected hours honour holidays, leave and employment dates", () => {
  assert.equal(calculateAttendanceAnalytics(base)[0]?.expected, 8);
  for (const locationId of [null, "office"])
    assert.equal(
      calculateAttendanceAnalytics({ ...base, holidays: [{ date: base.dates[0]!, locationId }] })[0]
        ?.expected,
      0,
    );
  assert.equal(
    calculateAttendanceAnalytics({
      ...base,
      holidays: [{ date: base.dates[0]!, locationId: "other" }],
    })[0]?.expected,
    8,
  );
  assert.equal(calculateAttendanceAnalytics({ ...base, dates: ["2026-09-13"] })[0]?.expected, 0);
  const leave = {
    employeeId: "a",
    startDate: base.dates[0]!,
    endDate: base.dates[0]!,
    isHalfDay: true,
  };
  assert.equal(calculateAttendanceAnalytics({ ...base, leave: [leave] })[0]?.expected, 4);
  assert.equal(
    calculateAttendanceAnalytics({ ...base, leave: [{ ...leave, isHalfDay: false }] })[0]?.expected,
    0,
  );
  for (const person of [
    { ...employee, startDate: "2026-09-15" },
    { ...employee, terminationDate: "2026-09-13" },
  ])
    assert.equal(calculateAttendanceAnalytics({ ...base, employees: [person] })[0]?.expected, 0);
});
test("only closed valid attendance counts; missing and provisional records remain distinct", () => {
  const record = {
    employeeId: "a",
    date: base.dates[0]!,
    clockInAt: "2026-09-14T08:00:00Z",
    clockOutAt: "2026-09-14T16:00:00Z",
    calculatedHours: "8",
    status: "Present",
  };
  assert.equal(calculateAttendanceAnalytics({ ...base, records: [record] })[0]?.worked, 8);
  assert.equal(calculateAttendanceAnalytics(base)[0]?.missing, 1);
  for (const invalid of [
    { ...record, clockOutAt: null },
    { ...record, status: "Correction Pending" },
    { ...record, calculatedHours: "NaN" },
    { ...record, calculatedHours: "-1" },
    { ...record, calculatedHours: "25" },
  ]) {
    const day = calculateAttendanceAnalytics({ ...base, records: [invalid] })[0]!;
    assert.equal(day.worked, 0);
    assert.equal(day.review, 1);
    assert.equal(day.missing, 0);
  }
  const pending = calculateAttendanceAnalytics({
    ...base,
    records: [record],
    pendingVisits: [{ employeeId: "a", date: base.dates[0]! }],
  })[0]!;
  assert.equal(pending.worked, 0);
  assert.equal(pending.review, 1);
});
