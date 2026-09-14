import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { configureApplicationDataServices } from "../src/lib/data/application-data.ts";
import { AuditService } from "../src/lib/data/audit-service.ts";
import { IndexedDbFileRepository } from "../src/lib/data/file-repository.ts";
import { NotificationService } from "../src/lib/data/notification-service.ts";
import { PayrollService } from "../src/lib/data/payroll-service.ts";
import { initializeSeedData } from "../src/lib/data/seed-service.ts";
import { MemoryStorageDriver } from "../src/lib/data/storage-driver.ts";
import { VersionedStorageService } from "../src/lib/data/storage.ts";
import type { ActorContext } from "../src/lib/data/types.ts";

test("the admin dashboard shows operational tasks rather than an audit risk feed", () => {
  const source = readFileSync(
    new URL("../src/components/dashboards/admin-dashboard.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /auditService|audit-alerts|High-risk Audit|recentAlerts/);
  for (const task of ["document-expiries", "leave-approvals", "payroll-approvals"])
    assert.ok(source.includes(task), `Keep the actionable ${task} queue`);
  assert.match(source, /Workforce Distribution/);
  assert.match(source, /Executive Operations/);
});

test("authorised payroll views remain audited without being classified as high-risk", () => {
  const storage = new VersionedStorageService(new MemoryStorageDriver());
  initializeSeedData(storage);
  const audit = new AuditService(storage);
  configureApplicationDataServices({
    storage,
    audit,
    notifications: new NotificationService(storage, audit),
    files: new IndexedDbFileRepository({ audit }),
  });
  try {
    const payroll = new PayrollService();
    for (const role of ["Accounts", "Super Admin"] as const) {
      const context: ActorContext = {
        actor: {
          userId: `test-${role}`,
          displayName: role,
          activeRole: role,
          roles: ["Employee", role],
        },
      };
      payroll.getAllPeriods(context);
      const view = audit.list().findLast((event) => event.action === "payroll_viewed");
      assert.ok(view);
      assert.equal(view.riskLevel, "Medium");
      assert.equal(view.actor.userId, context.actor.userId);
      assert.equal(view.reason, "Viewed the payroll-period register.");
    }
    assert.throws(
      () =>
        payroll.getAllPeriods({
          actor: {
            userId: "test-employee",
            displayName: "Employee",
            activeRole: "Employee",
            roles: ["Employee"],
          },
        }),
      /not authorised/,
    );
    const denial = audit
      .list()
      .findLast((event) => event.reason?.includes("denied") || event.action.includes("denied"));
    assert.ok(denial, "Denied payroll access is still audited");
    assert.equal(denial.riskLevel, "High", "Do not downgrade access violations");
  } finally {
    configureApplicationDataServices(undefined);
  }
});
