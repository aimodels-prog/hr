import assert from "node:assert/strict";
import test from "node:test";

import {
  assertReportAccess,
  listAvailableReportsForActor,
  REPORT_CATALOGUE,
} from "../src/lib/db/repositories/report.repository.server.ts";
import type { AuditActorContext } from "../src/lib/db/repositories/master-data.repository.server.ts";
import { ROLE_VALUES } from "../src/lib/data/types.ts";

test("server report access matches the visible catalogue for every role and report", () => {
  for (const activeRole of ROLE_VALUES) {
    const actor: AuditActorContext = {
      userId: "test-user",
      employeeId: "test-employee",
      displayName: "Report test",
      activeRole,
      roles: [...ROLE_VALUES],
    };
    const available = listAvailableReportsForActor(actor);
    for (const report of REPORT_CATALOGUE) {
      if (available.some((item) => item.id === report.id)) {
        assert.doesNotThrow(() => assertReportAccess(report.id, actor));
      } else {
        assert.throws(() => assertReportAccess(report.id, actor), /permission/i);
      }
    }
    if (activeRole === "HR")
      assert.throws(() => assertReportAccess("payroll", actor), /permission/i);
    if (["Accounts", "Super Admin"].includes(activeRole))
      assert.doesNotThrow(() => assertReportAccess("payroll", actor));
    assert.throws(() => assertReportAccess("unknown-report", actor), /does not exist/i);
  }
});
