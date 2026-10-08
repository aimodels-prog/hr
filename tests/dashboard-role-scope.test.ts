import assert from "node:assert/strict";
import test from "node:test";
import { getWorkforceAnalytics } from "../src/lib/db/repositories/workforce-analytics.repository.server.ts";

test("HR membership does not grant organisation charts while Employee is the active role", async () => {
  const actor = {
    userId: "hr-user",
    employeeId: "hr-employee",
    displayName: "HR employee",
    roles: ["Employee", "HR", "Super Admin"],
    activeRole: "Employee" as const,
  };
  await assert.rejects(() => getWorkforceAnalytics("org", actor, "hr", 30), /Only HR/);
  await assert.rejects(
    () => getWorkforceAnalytics("org", actor, "self", 30, new Date(), "another-employee"),
    /Only HR can select another employee/,
  );
});
