import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attendanceListSearch,
  dailyAttendanceStatus,
  defaultAttendanceLocation,
  matchesAttendanceListFilter,
} from "../src/lib/data/attendance-list.ts";

test("attendance defaults to Head Office without selecting the first location when policy is missing", () => {
  const locations = [
    { id: "salalah", name: "Salalah", isActive: true },
    { id: "head-office", name: "Head Office", isActive: true },
  ];
  assert.equal(defaultAttendanceLocation(locations), "Head Office");
  assert.equal(defaultAttendanceLocation([...locations].reverse()), "Head Office");
  assert.equal(defaultAttendanceLocation(locations, "missing-location"), "Head Office");
  assert.equal(defaultAttendanceLocation([locations[0]!]), undefined);
  assert.equal(defaultAttendanceLocation([]), undefined);
  assert.equal(
    defaultAttendanceLocation([locations[0]!, { ...locations[1]!, isActive: false }]),
    undefined,
  );
});

test("attendance respects a configured Head Office ID including compatibility IDs and renamed offices", () => {
  const locations = [
    { id: "salalah", name: "Salalah", isActive: true },
    { id: "hq", databaseId: "hq-postgres", name: "Muscat Headquarters", isActive: true },
  ];
  assert.equal(defaultAttendanceLocation(locations, "hq"), "Muscat Headquarters");
  assert.equal(defaultAttendanceLocation(locations, "hq-postgres"), "Muscat Headquarters");
});

test("daily attendance accepts real dates and known filters only", () => {
  assert.deepEqual(attendanceListSearch({ date: "2026-10-11", status: "Clocked in" }), {
    date: "2026-10-11",
    status: "Clocked in",
  });
  for (const date of ["2026-02-30", "2026-13-01", "2026-2-01", "today", [], null])
    assert.equal(attendanceListSearch({ date, status: "Unknown" }).date, undefined);
  assert.equal(attendanceListSearch({ status: "Unknown" }).status, undefined);
});

test("clocked-in list includes open, late, corrected and incomplete saved punches, not virtual absences", () => {
  for (const status of ["Present", "Late", "Corrected", "Correction Pending", "Missing Punch"])
    assert.equal(matchesAttendanceListFilter({ status, clockIn: "08:30" }, "Clocked in"), true);
  assert.equal(
    matchesAttendanceListFilter(
      { status: "Present", clockInAt: "2026-10-11T04:30Z" },
      "Clocked in",
    ),
    true,
  );
  for (const status of ["Absent", "Not tracked", "On Leave", "Holiday", "Present"])
    assert.equal(matchesAttendanceListFilter({ status }, "Clocked in"), false);
  assert.equal(
    matchesAttendanceListFilter({ status: "Present", clockIn: "00:00" }, "Clocked in"),
    true,
  );
  assert.equal(matchesAttendanceListFilter({ status: "Late" }, "Exceptions"), true);
  assert.equal(matchesAttendanceListFilter({ status: "Present" }, "Exceptions"), false);
  assert.equal(matchesAttendanceListFilter({ status: "Late" }, "Present"), false);
  assert.equal(matchesAttendanceListFilter({ status: "Absent" }, "All"), true);
});

test("HR daily roster separates unrecorded clock-ins, approved leave and remote duty", () => {
  const today = "2026-10-19";
  assert.equal(dailyAttendanceStatus({ status: "Absent" }, today, today), "Not clocked in");
  assert.equal(dailyAttendanceStatus({ status: "Absent" }, "2026-10-18", today), "Absent");
  assert.equal(dailyAttendanceStatus({ status: "Absent" }, "2026-10-20", today), "Scheduled");
  assert.equal(
    dailyAttendanceStatus({ status: "Absent", clockIn: "08:30" }, today, today),
    "Absent",
  );
  assert.equal(
    dailyAttendanceStatus({ status: "Not tracked" }, today, today, true),
    "Working remotely",
  );
  assert.equal(
    dailyAttendanceStatus(
      { status: "Present", officeExceptionLabel: "Approved remote work" },
      today,
      today,
    ),
    "Working remotely",
  );
  assert.equal(dailyAttendanceStatus({ status: "On Leave" }, today, today, true), "On Leave");
  assert.equal(
    dailyAttendanceStatus({ status: "Present", workMode: "Approved Site Visit" }, today, today),
    "Site visit",
  );
  assert.equal(matchesAttendanceListFilter({ status: "Half-day Leave" }, "On Leave"), true);
  assert.equal(matchesAttendanceListFilter({ status: "Not clocked in" }, "Not clocked in"), true);
  assert.equal(
    matchesAttendanceListFilter({ status: "Working remotely" }, "Working remotely"),
    true,
  );
});
