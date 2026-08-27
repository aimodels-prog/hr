import assert from "node:assert/strict";
import test from "node:test";

import {
  getAuditActivity,
  getAuditArea,
  getAuditChanges,
  getAuditOutcome,
  getAuditRecordLabel,
  getAuditSummary,
  isAutomatedAuditEvent,
} from "../src/lib/data/audit-presentation.ts";
import type { AuditEvent } from "../src/lib/data/types.ts";

function event(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: "audit-1",
    occurredAt: "2026-08-25T10:00:00.000Z",
    actor: {
      userId: "user-rana",
      displayName: "Rana Nair",
      activeRole: "HR",
      roles: ["Employee", "HR"],
    },
    action: "update",
    module: "leave",
    entityType: "leave_request",
    entityId: "leave-1",
    riskLevel: "Low",
    ...overrides,
  };
}

test("audit presentation converts technical records into plain HR language", () => {
  const item = event({
    action: "approve",
    after: { employeeId: "employee-omar", status: "Approved" },
  });

  assert.equal(getAuditActivity(item), "Approved leave request");
  assert.equal(getAuditArea(item), "Leave");
  assert.equal(getAuditOutcome(item), "Approved");
  assert.equal(
    getAuditRecordLabel(item, { employees: { "employee-omar": "Omar Hassan" } }),
    "Omar Hassan",
  );
});

test("system activity is separated from activity performed by people", () => {
  assert.equal(isAutomatedAuditEvent(event()), false);
  assert.equal(
    isAutomatedAuditEvent(
      event({ actor: { userId: "system", displayName: "VIA HR System", roles: ["Super Admin"] } }),
    ),
    true,
  );
  assert.equal(
    isAutomatedAuditEvent(
      event({
        entityType: "notification",
        reason: "Background reminder check",
      }),
    ),
    true,
  );
});

test("new records do not display null-to-value noise or technical record fields", () => {
  const changes = getAuditChanges(
    event({
      action: "create",
      entityType: "performance-template",
      before: undefined,
      after: {
        id: "template-1",
        name: "Annual Performance Review",
        isActive: true,
        createdAt: "2026-08-25T10:00:00.000Z",
        recordVersion: 1,
      },
    }),
    false,
  );

  assert.deepEqual(changes, [
    { field: "Name", after: "Annual Performance Review", kind: "added" },
    { field: "Is active", after: "Yes", kind: "added" },
  ]);
});

test("financial fields are restricted for audit viewers without payroll access", () => {
  const salaryChange = event({ before: { salary: 1_000 }, after: { salary: 1_200 } });
  assert.deepEqual(getAuditChanges(salaryChange, false), [
    { field: "Salary", before: "Restricted", after: "Restricted", kind: "changed" },
  ]);
  assert.deepEqual(getAuditChanges(salaryChange, true), [
    { field: "Salary", before: "1000", after: "1200", kind: "changed" },
  ]);
});

test("leave balance entries produce a useful employee-facing summary", () => {
  const balanceEvent = event({
    action: "create",
    entityType: "leave_transaction",
    after: { employeeId: "employee-omar", policyId: "annual", days: 30 },
  });
  assert.equal(
    getAuditSummary(balanceEvent, {
      employees: { "employee-omar": "Omar Hassan" },
      policies: { annual: "Annual Leave" },
    }),
    "Added 30 days to Omar Hassan’s Annual Leave balance",
  );
});
