import { SYSTEM_CONTEXT } from "../src/lib/data/types.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { AuditService } from "../src/lib/data/audit-service.ts";
import { configureApplicationDataServices } from "../src/lib/data/application-data.ts";
import { EmployeeService } from "../src/lib/data/employee-service.ts";
import { IndexedDbFileRepository } from "../src/lib/data/file-repository.ts";
import { NotificationService } from "../src/lib/data/notification-service.ts";
import { initializeSeedData } from "../src/lib/data/seed-service.ts";
import { MemoryStorageDriver } from "../src/lib/data/storage-driver.ts";
import { VersionedStorageService } from "../src/lib/data/storage.ts";
import type { ActorContext } from "../src/lib/data/types.ts";

function setup() {
  const storage = new VersionedStorageService(new MemoryStorageDriver());
  initializeSeedData(storage);
  const audit = new AuditService(storage);
  configureApplicationDataServices({
    storage,
    audit,
    notifications: new NotificationService(storage, audit),
    files: new IndexedDbFileRepository({ audit }),
  });
  return { service: new EmployeeService(), audit };
}

const hr: ActorContext = {
  actor: {
    userId: "user-rana",
    employeeId: "employee-rana",
    displayName: "Rana Nair",
    activeRole: "HR",
    roles: ["Employee", "HR"],
  },
};

test("HR can add access while Employee access always remains", () => {
  const { service, audit } = setup();
  const target = service
    .getUserRepository(SYSTEM_CONTEXT)
    .list()
    .find((user) => user.roles.length === 1);
  assert.ok(target);

  const updated = service.updateUserAccess(
    target.id,
    ["Line Manager"],
    "Active",
    "Promoted to team lead",
    hr,
  );

  assert.deepEqual(updated.roles, ["Employee", "Line Manager"]);
  assert.equal(audit.list().at(-1)?.reason, "Promoted to team lead");
});

test("HR cannot change a Super Admin account and the denial is audited", () => {
  const { service, audit } = setup();
  const target = service
    .getUserRepository(SYSTEM_CONTEXT)
    .list()
    .find((user) => user.roles.includes("Super Admin"));
  assert.ok(target);

  assert.throws(
    () => service.updateUserAccess(target.id, target.roles, "Suspended", "Access review", hr),
    /Only a Super Admin/,
  );
  assert.equal(audit.list().at(-1)?.action, "access-denied");
  assert.equal(audit.list().at(-1)?.riskLevel, "Critical");
});

test.after(() => configureApplicationDataServices(undefined));
