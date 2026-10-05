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

test("authorised access changes including Super Admin save without a reason and remain audited", () => {
  const { service, audit } = setup();
  const target = service.getUserRepository(SYSTEM_CONTEXT).getById("user-omar");
  assert.ok(target);
  service.updateUserAccess(target.id, ["Employee", "Accounts"], "Active", "", hr);
  assert.equal(audit.list().at(-1)?.reason, "User access updated by administrator");
  const admin = service
    .getUserRepository(SYSTEM_CONTEXT)
    .list()
    .find((user) => user.roles.includes("Super Admin"));
  assert.ok(admin);
  assert.doesNotThrow(() =>
    service.updateUserAccess(target.id, ["Employee", "Super Admin"], "Active", "", {
      actor: {
        userId: admin.id,
        employeeId: admin.employeeId,
        displayName: admin.displayName,
        activeRole: "Super Admin",
        roles: admin.roles,
      },
    }),
  );
  assert.ok(
    service.getUserRepository(SYSTEM_CONTEXT).getById(target.id)?.roles.includes("Super Admin"),
  );
  assert.equal(audit.list().at(-1)?.reason, "User access updated by administrator");
});

test("removing user access preserves the employee record and supports restoration", () => {
  const { service } = setup();
  const target = service.getUserRepository(SYSTEM_CONTEXT).getById("user-omar");
  assert.ok(target);
  const before = service.getById(target.employeeId, hr);
  assert.ok(before);
  const removed = service.updateUserAccess(
    target.id,
    target.roles,
    "Archived",
    "User removal confirmed",
    hr,
  );
  assert.equal(removed.status, "Archived");
  assert.ok(removed.archivedAt);
  assert.deepEqual(service.getById(target.employeeId, hr), before);
  assert.equal(
    service.getUsers(hr).some((user) => user.id === target.id),
    false,
  );
  const restored = service.updateUserAccess(
    target.id,
    target.roles,
    "Active",
    "Restore user access",
    hr,
  );
  assert.equal(restored.status, "Active");
  assert.equal(Boolean(restored.archivedAt), false);
});

test("employees cannot remove another user's access", () => {
  const { service } = setup();
  const target = service.getUserRepository(SYSTEM_CONTEXT).getById("user-omar");
  assert.ok(target);
  assert.throws(
    () =>
      service.updateUserAccess(target.id, target.roles, "Archived", "Remove this account", {
        actor: { ...hr.actor, activeRole: "Employee", roles: ["Employee"] },
      }),
    /Only HR or a Super Admin/,
  );
  assert.equal(service.getUserRepository(SYSTEM_CONTEXT).getById(target.id)?.status, "Active");
});
