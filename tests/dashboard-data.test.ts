import assert from "node:assert/strict";
import test from "node:test";

import {
  isCurrentWorkforceMember,
  isDateRangeActiveOn,
  isDateWithinPeriod,
  sortByStartDate,
} from "../src/components/dashboards/dashboard-data.ts";
import type { Employee } from "../src/lib/data/types.ts";

function employee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: "employee-1",
    employeeNumber: "VIA-0001",
    legalName: "Test Employee",
    preferredName: "Test",
    workEmail: "test@via.example",
    department: "Operations",
    position: "Coordinator",
    location: "Dubai",
    employmentType: "Full Time",
    startDate: "2026-01-01",
    status: "Active",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "system",
    updatedAt: "2026-01-01T00:00:00.000Z",
    updatedBy: "system",
    recordVersion: 1,
    ...overrides,
  };
}

test("current headcount includes employed statuses but excludes future and former staff", () => {
  const asOf = new Date("2026-08-24T12:00:00");

  assert.equal(isCurrentWorkforceMember(employee({ status: "Probation" }), asOf), true);
  assert.equal(isCurrentWorkforceMember(employee({ status: "Notice" }), asOf), true);
  assert.equal(isCurrentWorkforceMember(employee({ status: "Onboarding" }), asOf), true);
  assert.equal(
    isCurrentWorkforceMember(employee({ status: "Onboarding", startDate: "2026-09-01" }), asOf),
    false,
  );
  assert.equal(isCurrentWorkforceMember(employee({ status: "Inactive" }), asOf), false);
  assert.equal(isCurrentWorkforceMember(employee({ status: "Archived" }), asOf), false);
  assert.equal(isCurrentWorkforceMember(employee({ terminationDate: "2026-08-20" }), asOf), false);
});

test("on-leave-now requires today to fall inside the full leave range", () => {
  const asOf = new Date("2026-08-24T18:00:00");

  assert.equal(isDateRangeActiveOn("2026-08-24", "2026-08-24", asOf), true);
  assert.equal(isDateRangeActiveOn("2026-08-25", "2026-08-28", asOf), false);
  assert.equal(isDateRangeActiveOn("2026-08-20", "2026-08-23", asOf), false);
});

test("payroll dashboard includes overtime only inside the selected payroll period", () => {
  assert.equal(isDateWithinPeriod("2026-08-01", "2026-08-01", "2026-08-31"), true);
  assert.equal(isDateWithinPeriod("2026-08-31", "2026-08-01", "2026-08-31"), true);
  assert.equal(isDateWithinPeriod("2026-07-31", "2026-08-01", "2026-08-31"), false);
});

test("upcoming leave is displayed in chronological order", () => {
  const items = sortByStartDate([
    { id: "later", startDate: "2026-09-10" },
    { id: "next", startDate: "2026-08-30" },
  ]);

  assert.deepEqual(
    items.map((item) => item.id),
    ["next", "later"],
  );
});
