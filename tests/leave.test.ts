import assert from "node:assert/strict";
import test from "node:test";

import { configureApplicationDataServices } from "../src/lib/data/application-data.ts";
import { AuditService } from "../src/lib/data/audit-service.ts";
import { LeaveService } from "../src/lib/data/leave-service.ts";
import type { LeavePolicy, LeaveTransaction } from "../src/lib/data/leave-types.ts";
import { NotificationService } from "../src/lib/data/notification-service.ts";
import { initializeSeedData } from "../src/lib/data/seed-service.ts";
import { MemoryStorageDriver } from "../src/lib/data/storage-driver.ts";
import { VersionedStorageService } from "../src/lib/data/storage.ts";
import type { ActorContext, Employee } from "../src/lib/data/types.ts";
import { getMasterDataRepository } from "../src/lib/data/master-data.ts";
import type { FileRepository, SaveFileInput } from "../src/lib/data/file-repository.ts";
import type { FileMetadata } from "../src/lib/data/types.ts";

const hr: ActorContext = {
  actor: {
    userId: "user-rana",
    employeeId: "employee-rana",
    displayName: "Rana Nair",
    activeRole: "HR",
    roles: ["Employee", "HR"],
  },
};

const employee: ActorContext = {
  actor: {
    userId: "user-omar",
    employeeId: "employee-omar",
    displayName: "Omar Rahman",
    activeRole: "Employee",
    roles: ["Employee"],
  },
};

const manager: ActorContext = {
  actor: {
    userId: "user-layla",
    employeeId: "employee-layla",
    displayName: "Layla Haddad",
    activeRole: "Line Manager",
    roles: ["Employee", "Line Manager"],
  },
};

const superAdmin: ActorContext = {
  actor: {
    userId: "user-super-admin",
    employeeId: "employee-yusuf",
    displayName: "Yusuf Al Balushi",
    activeRole: "Super Admin",
    roles: ["Employee", "Super Admin"],
  },
};

function fakeFileRepository(): FileRepository {
  const files = new Map<string, { metadata: FileMetadata; blob: Blob }>();
  let counter = 0;
  return {
    async save(input: SaveFileInput, context) {
      const id = `file-${++counter}`;
      const metadata: FileMetadata = {
        id,
        name: input.name,
        mimeType: input.mimeType ?? "application/octet-stream",
        size: input.blob.size,
        owner: input.owner,
        createdAt: new Date().toISOString(),
        createdBy: context.actor.userId,
      } as FileMetadata;
      files.set(id, { metadata, blob: input.blob });
      return metadata;
    },
    async getMetadata(id: string) {
      return files.get(id)?.metadata ?? null;
    },
    async getBlob(id: string) {
      return files.get(id)?.blob ?? null;
    },
    async listByOwner(owner) {
      return [...files.values()]
        .filter(
          (f) =>
            f.metadata.owner.entityType === owner.entityType &&
            f.metadata.owner.entityId === owner.entityId,
        )
        .map((f) => f.metadata);
    },
    async delete(id: string) {
      files.delete(id);
    },
    async clear() {
      files.clear();
    },
  };
}

function harness() {
  const storage = new VersionedStorageService(new MemoryStorageDriver());
  initializeSeedData(storage);
  const audit = new AuditService(storage);
  const notifications = new NotificationService(storage, audit);
  const files = fakeFileRepository();
  configureApplicationDataServices({ storage, audit, notifications, files });
  return { service: new LeaveService(), audit, storage, files };
}

test("active public holidays are excluded from requested working days", () => {
  const { service } = harness();
  const holiday = {
    name: "VIA Foundation Day",
    code: "FOUNDATION_DAY",
    description: "Company public holiday",
    date: "2026-08-24",
    isActive: true,
    orderIndex: 1,
  };
  getMasterDataRepository("publicHolidays").create(holiday, hr);

  assert.equal(service.calculateWorkingDays("2026-08-24", "2026-08-25", false), 1);
  assert.equal(service.calculateWorkingDays("2026-08-24", "2026-08-24", true), 0);
});

test("leave types requiring evidence cannot be submitted without a stored file reference", async () => {
  const { service } = harness();
  const sickPolicy = service.getPolicies().find((policy) => policy.requiresAttachment);
  assert.ok(sickPolicy);

  await assert.rejects(
    () =>
      service.submitLeaveRequest(
        {
          employeeId: "employee-omar",
          policyId: sickPolicy.id,
          startDate: "2026-09-01",
          endDate: "2026-09-01",
          reason: "Medical appointment",
          handoverContactId: "employee-layla",
        },
        employee,
      ),
    /Supporting evidence is required/,
  );
});

test("a covering colleague is required only for leave types marked as needing a handover", async () => {
  const { service } = harness();
  // Emergency Leave is short-notice by design and must never block submission on naming a
  // colleague; Annual Leave is a planned absence where a handover genuinely matters.
  const emergencyPolicy = service.getPolicies().find((policy) => policy.type === "Emergency");
  const annualPolicy = service.getPolicies().find((policy) => policy.type === "Annual");
  assert.ok(emergencyPolicy);
  assert.ok(annualPolicy);
  assert.equal(emergencyPolicy.requiresHandoverContact, false);
  assert.equal(annualPolicy.requiresHandoverContact, true);

  const request = await service.submitLeaveRequest(
    {
      employeeId: "employee-omar",
      policyId: emergencyPolicy.id,
      startDate: "2027-06-01",
      endDate: "2027-06-01",
      reason: "Family emergency",
    },
    employee,
  );
  assert.equal(request.handoverContactId, undefined);

  await assert.rejects(
    () =>
      service.submitLeaveRequest(
        {
          employeeId: "employee-omar",
          policyId: annualPolicy.id,
          startDate: "2027-06-02",
          endDate: "2027-06-02",
          reason: "Trip",
        },
        employee,
      ),
    /A covering colleague is required/,
  );
});

test("employees cannot submit leave for another employee", async () => {
  const { service, audit } = harness();
  const annualPolicy = service.getPolicies().find((policy) => policy.type === "Annual");
  assert.ok(annualPolicy);

  await assert.rejects(
    () =>
      service.submitLeaveRequest(
        {
          employeeId: "employee-tariq",
          policyId: annualPolicy.id,
          startDate: "2027-03-01",
          endDate: "2027-03-01",
          reason: "Personal appointment",
          handoverContactId: "employee-layla",
        },
        employee,
      ),
    /only submit a leave request for yourself/,
  );
  assert.equal(audit.list().at(-1)?.action, "access-denied");
});

test("leave reads are enforced by employee relationship and active role", () => {
  const { service, audit } = harness();
  const annualPolicy = service.getPolicies().find((policy) => policy.type === "Annual")!;

  assert.ok(service.getAllBalancesForEmployee("employee-omar", employee).length > 0);
  assert.throws(
    () => service.getAllBalancesForEmployee("employee-mariam", employee),
    /not authorised/,
  );
  assert.ok(service.getLeaveRequestsForEmployee("employee-omar", manager));
  assert.throws(() => service.getAllRequests(employee), /not authorised/);
  assert.throws(
    () => service.getTransactionsForEmployee("employee-mariam", annualPolicy.id, employee),
    /not authorised/,
  );

  assert.ok(
    audit.list().some((event) => event.module === "leave" && event.action === "access-denied"),
  );
});

test("Accounts receives only payroll-safe approved leave inputs", () => {
  const { service } = harness();
  const accounts: ActorContext = {
    actor: {
      userId: "user-mariam",
      employeeId: "employee-mariam",
      displayName: "Mariam Said",
      activeRole: "Accounts",
      roles: ["Employee", "Accounts"],
    },
  };

  assert.throws(() => service.getAllRequests(accounts), /not authorised/);
  for (const request of service.getPayrollLeaveRequests(accounts)) {
    assert.equal(request.reason, "Not included in payroll");
    assert.equal(request.attachmentFileId, undefined);
    assert.equal(request.handoverContactId, undefined);
    assert.ok(request.status === "Approved" || request.status === "Taken");
  }
});

test("only the assigned supervisor and HR can complete their approval stages", async () => {
  const { service, audit, storage } = harness();
  const annualPolicy = service.getPolicies().find((policy) => policy.type === "Annual");
  assert.ok(annualPolicy);
  const request = await service.submitLeaveRequest(
    {
      employeeId: "employee-omar",
      policyId: annualPolicy.id,
      startDate: "2027-03-01",
      endDate: "2027-03-01",
      reason: "Personal appointment",
      handoverContactId: "employee-tariq",
    },
    employee,
  );

  assert.throws(
    () => service.approveRequest(request.id, hr),
    /reason for completing the unavailable supervisor's review/,
  );
  assert.equal(
    service.getRequests(hr).find((item) => item.id === request.id)?.status,
    "Pending Line Manager",
  );

  const managerApproved = service.approveRequest(request.id, manager);
  assert.equal(managerApproved.status, "Pending HR");
  const hrHandoffNotifications = storage.readCollection<{ recipientUserId: string; title: string }>(
    "notifications",
  );
  assert.ok(
    hrHandoffNotifications.some(
      (item) =>
        item.recipientUserId === "user-rana" && item.title === "Leave request awaiting HR approval",
    ),
    "HR must be notified once the manager advances a request to the HR stage",
  );
  assert.throws(() => service.approveRequest(request.id, manager), /Only HR/);
  assert.equal(audit.list().at(-1)?.action, "access-denied");

  const approved = service.approveRequest(request.id, hr);
  assert.equal(approved.status, "Approved");
  const notifications = storage.readCollection<{
    recipientUserId: string;
    title: string;
  }>("notifications");
  assert.ok(
    notifications.some(
      (item) => item.recipientUserId === "user-omar" && item.title === "Leave approved",
    ),
  );
  assert.ok(notifications.some((item) => item.title === "Team availability update"));
});

test("HR annual-entitlement changes update every eligible employee's current balance", () => {
  const { service } = harness();
  const annualPolicy = service.getPolicies().find((policy) => policy.type === "Annual");
  assert.ok(annualPolicy);

  const employeeId = "employee-omar";
  const before = service.calculateBalance(employeeId, annualPolicy.id, hr);
  service.updatePolicy(
    annualPolicy.id,
    { baseEntitlementDays: annualPolicy.baseEntitlementDays + 5 },
    hr,
  );
  const after = service.calculateBalance(employeeId, annualPolicy.id, hr);

  assert.equal(after.available, before.available + 5);
  assert.equal(
    service.getPolicies().find((policy) => policy.id === annualPolicy.id)?.baseEntitlementDays,
    35,
  );
  assert.ok(
    service
      .getTransactionsForEmployee(employeeId, annualPolicy.id, hr)
      .some(
        (transaction) =>
          transaction.transactionType === "Manual Adjustment" && transaction.days === 5,
      ),
  );
});

test("invalid policy entitlements are rejected without changing the policy", () => {
  const { service } = harness();
  const annualPolicy = service.getPolicies().find((policy) => policy.type === "Annual");
  assert.ok(annualPolicy);

  assert.throws(
    () => service.updatePolicy(annualPolicy.id, { baseEntitlementDays: -1 }, hr),
    /zero or greater/,
  );
  assert.equal(
    service.getPolicies().find((policy) => policy.id === annualPolicy.id)?.baseEntitlementDays,
    annualPolicy.baseEntitlementDays,
  );
});

test("employees cannot change organisation leave policy and the denial is audited", () => {
  const { service, audit } = harness();
  const annualPolicy = service.getPolicies().find((policy) => policy.type === "Annual");
  assert.ok(annualPolicy);

  assert.throws(
    () => service.updatePolicy(annualPolicy.id, { baseEntitlementDays: 60 }, employee),
    /not authorised/,
  );
  assert.equal(
    service.getPolicies().find((policy) => policy.id === annualPolicy.id)?.baseEntitlementDays,
    annualPolicy.baseEntitlementDays,
  );
  assert.equal(
    audit.list().some((event) => event.action === "leave_policy_access_denied"),
    true,
  );
});

test("legacy 25-day demo data is reconciled to VIA's 30-day annual policy once", () => {
  const { service, storage } = harness();
  const annualPolicy = service.getPolicies().find((policy) => policy.type === "Annual");
  assert.ok(annualPolicy);

  const policies = storage.readCollection<LeavePolicy>("leave_policies");
  storage.writeCollection(
    "leave_policies",
    policies.map((policy) =>
      policy.id === annualPolicy.id
        ? { ...policy, baseEntitlementDays: 25, updatedBy: "system" }
        : policy,
    ),
  );
  const transactions = storage.readCollection<LeaveTransaction>("leave_transactions");
  storage.writeCollection(
    "leave_transactions",
    transactions.map((transaction) =>
      transaction.policyId === annualPolicy.id && transaction.transactionType === "Entitlement"
        ? { ...transaction, days: 25, reason: "System initialization for current year" }
        : transaction,
    ),
  );

  const migrated = new LeaveService();
  const migratedPolicy = migrated.getPolicies().find((policy) => policy.id === annualPolicy.id);
  const balance = migrated.calculateBalance("employee-omar", annualPolicy.id, employee);
  assert.equal(migratedPolicy?.baseEntitlementDays, 30);
  assert.equal(migratedPolicy?.noticeRules?.shortLeaveNoticeDays, 14);
  assert.equal(migratedPolicy?.noticeRules?.longLeaveNoticeDays, 60);
  assert.equal(balance.entitlement + balance.adjustments, 30);

  const afterFirstMigration = migrated.getTransactionsForEmployee(
    "employee-omar",
    annualPolicy.id,
    employee,
  );
  new LeaveService();
  const afterSecondMigration = migrated.getTransactionsForEmployee(
    "employee-omar",
    annualPolicy.id,
    employee,
  );
  assert.equal(afterSecondMigration.length, afterFirstMigration.length);
});

test("a genuine HR-edited 25-day policy is preserved instead of treated as legacy data", () => {
  const { service } = harness();
  const annualPolicy = service.getPolicies().find((policy) => policy.type === "Annual");
  assert.ok(annualPolicy);

  service.updatePolicy(annualPolicy.id, { baseEntitlementDays: 25 }, hr);
  const reloaded = new LeaveService();
  assert.equal(
    reloaded.getPolicies().find((policy) => policy.id === annualPolicy.id)?.baseEntitlementDays,
    25,
  );
});

test("older saved policies without visibility fields remain available after migration", () => {
  const { service, storage } = harness();
  const policies = service.getPolicies();
  const annualPolicy = policies.find((policy) => policy.type === "Annual");
  assert.ok(annualPolicy);

  storage.writeCollection(
    "leave_policies",
    policies.map((policy) => {
      const legacy = { ...policy } as Partial<LeavePolicy>;
      delete legacy.isEnabled;
      delete legacy.isStatutory;
      delete legacy.consumesBalance;
      return legacy as LeavePolicy;
    }),
  );

  const migrated = new LeaveService();
  const visible = migrated.getEligiblePolicies("employee-aisha", hr);
  assert.ok(visible.length > 0);
  assert.equal(visible.find((policy) => policy.id === annualPolicy.id)?.isEnabled, true);
  assert.equal(
    visible.find((policy) => policy.id === annualPolicy.id)?.baseEntitlementDays,
    annualPolicy.baseEntitlementDays,
  );
});

test("an employee added after the leave ledger exists receives current entitlements", () => {
  const { service, storage } = harness();
  const template = storage.readCollection<Employee>("employees")[0];
  assert.ok(template);

  const laterEmployee: Employee = {
    ...template,
    id: "employee-later",
    employeeNumber: "VIA-0099",
    legalName: "Noura Al Lawati",
    preferredName: "Noura",
    workEmail: "noura.lawati@via.example",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  storage.writeCollection("employees", [
    ...storage.readCollection<Employee>("employees"),
    laterEmployee,
  ]);

  const reconciled = new LeaveService();
  const annualPolicy = reconciled.getPolicies().find((policy) => policy.type === "Annual");
  assert.ok(annualPolicy);
  assert.equal(
    reconciled.calculateBalance(laterEmployee.id, annualPolicy.id, hr).entitlement,
    annualPolicy.baseEntitlementDays,
  );

  const transactionCount = reconciled.getTransactionsForEmployee(
    laterEmployee.id,
    annualPolicy.id,
    hr,
  ).length;
  new LeaveService();
  assert.equal(
    reconciled.getTransactionsForEmployee(laterEmployee.id, annualPolicy.id, hr).length,
    transactionCount,
  );
});

test("HR can set a corrected available balance without rewriting leave history", () => {
  const { service } = harness();
  const annualPolicy = service.getPolicies().find((policy) => policy.type === "Annual");
  assert.ok(annualPolicy);
  const employeeId = "employee-aisha";
  const before = service.calculateBalance(employeeId, annualPolicy.id, hr);
  const transactionsBefore = service.getTransactionsForEmployee(employeeId, annualPolicy.id, hr);

  service.setEmployeeAvailableBalance(
    employeeId,
    annualPolicy.id,
    before.available + 2.5,
    "HR verified unused leave from the signed opening balance record.",
    hr,
  );

  const after = service.calculateBalance(employeeId, annualPolicy.id, hr);
  const transactionsAfter = service.getTransactionsForEmployee(employeeId, annualPolicy.id, hr);
  assert.equal(after.available, before.available + 2.5);
  assert.equal(transactionsAfter.length, transactionsBefore.length + 1);
  assert.equal(transactionsAfter.at(-1)?.transactionType, "Manual Adjustment");
  assert.equal(transactionsAfter.at(-1)?.days, 2.5);
});

test("employees cannot edit leave balances and the denial is audited", () => {
  const { service, audit } = harness();
  const annualPolicy = service.getPolicies().find((policy) => policy.type === "Annual");
  assert.ok(annualPolicy);
  const current = service.calculateBalance("employee-omar", annualPolicy.id, employee);

  assert.throws(
    () =>
      service.setEmployeeAvailableBalance(
        "employee-omar",
        annualPolicy.id,
        current.available + 1,
        "Attempted unauthorised correction.",
        employee,
      ),
    /not authorised/,
  );
  assert.equal(
    audit.list().some((event) => event.action === "leave_balance_adjustment_access_denied"),
    true,
  );
});

test("working days are computed from the configured working week, not a hardcoded Sat/Sun weekend", () => {
  const { service } = harness();
  // Oman's seeded working week is Sun-Thu (days 0-4); Fri (5) and Sat (6) are rest days.
  // 2026-08-23 is a Sunday and 2026-08-27 is a Thursday - a full Sun-Thu working week with
  // no weekend day in between, so the old date-fns isWeekend() (Sat/Sun only) would have
  // incorrectly counted Sunday as a working day.
  assert.equal(service.calculateWorkingDays("2026-08-23", "2026-08-27", false), 5);
  // 2026-08-28 (Fri) and 2026-08-29 (Sat) are both rest days under the configured week.
  assert.equal(service.calculateWorkingDays("2026-08-28", "2026-08-29", false), 0);
});

test("submitting a leave request notifies the assigned line manager for a manager-first policy", async () => {
  const { service, storage } = harness();
  const annualPolicy = service.getPolicies().find((policy) => policy.type === "Annual");
  assert.ok(annualPolicy);

  await service.submitLeaveRequest(
    {
      employeeId: "employee-omar",
      policyId: annualPolicy.id,
      startDate: "2027-04-01",
      endDate: "2027-04-01",
      reason: "Personal appointment",
      handoverContactId: "employee-tariq",
    },
    employee,
  );

  const notifications = storage.readCollection<{ recipientUserId: string; title: string }>(
    "notifications",
  );
  assert.ok(
    notifications.some(
      (item) => item.recipientUserId === "user-layla" && item.title.includes("awaiting"),
    ),
  );
});

test("leave attachment access is restricted to the owner, their line manager, and HR - and is audited", async () => {
  const { service, files, audit } = harness();
  const sickPolicy = service.getPolicies().find((policy) => policy.requiresAttachment);
  assert.ok(sickPolicy);

  const uploaded = await files.save(
    {
      blob: new Blob(["medical note"]),
      name: "medical-note.pdf",
      mimeType: "application/pdf",
      owner: { entityType: "leave-request-evidence", entityId: "employee-omar" },
    },
    employee,
  );

  const request = await service.submitLeaveRequest(
    {
      employeeId: "employee-omar",
      policyId: sickPolicy.id,
      startDate: "2027-05-02",
      endDate: "2027-05-02",
      reason: "Medical appointment",
      handoverContactId: "employee-tariq",
      attachmentFileId: uploaded.id,
    },
    employee,
  );

  const ownerResult = await service.getAttachmentBlob(request.id, employee);
  assert.equal(ownerResult.fileName, "medical-note.pdf");

  const managerResult = await service.getAttachmentBlob(request.id, manager);
  assert.ok(managerResult.blob);

  const hrResult = await service.getAttachmentBlob(request.id, hr);
  assert.ok(hrResult.blob);

  const unrelated: ActorContext = {
    actor: {
      userId: "user-tariq",
      employeeId: "employee-tariq",
      displayName: "Tariq Al Balushi",
      activeRole: "Employee",
      roles: ["Employee"],
    },
  };
  await assert.rejects(() => service.getAttachmentBlob(request.id, unrelated), /not authorised/);
  assert.equal(audit.list().at(-1)?.action, "access-denied");

  const accessEvents = audit.list().filter((event) => event.action === "leave_attachment_accessed");
  assert.equal(accessEvents.length, 3);
});

test("autoRunAnnualRollover grants the current year's entitlement without needing an HR-privileged caller, and is idempotent", () => {
  const { service } = harness();
  const annualPolicy = service.getPolicies().find((policy) => policy.type === "Annual");
  assert.ok(annualPolicy);
  const currentYear = new Date().getFullYear();

  // No context is passed in at all - this must work purely triggered by the app being open,
  // exactly like the other background reconciliation jobs it runs alongside.
  service.autoRunAnnualRollover();

  const after = service.getTransactionsForEmployee("employee-omar", annualPolicy.id, employee);
  const granted = after.filter(
    (t) => t.transactionType === "Entitlement" && new Date(t.date).getFullYear() === currentYear,
  );
  assert.equal(granted.length, 1, "expected exactly one current-year entitlement grant");

  // Calling it again (e.g. the next 60-second reconciliation tick) must not double-grant.
  service.autoRunAnnualRollover();
  const afterSecondRun = service.getTransactionsForEmployee(
    "employee-omar",
    annualPolicy.id,
    employee,
  );
  assert.equal(
    afterSecondRun.filter(
      (t) => t.transactionType === "Entitlement" && new Date(t.date).getFullYear() === currentYear,
    ).length,
    1,
    "a second automatic run must not create a duplicate grant",
  );
});

test("negative leave is limited by the policy cap", async () => {
  const { service } = harness();
  const annualPolicy = service.getPolicies().find((policy) => policy.type === "Annual");
  assert.ok(annualPolicy);
  service.setEmployeeAvailableBalance(
    "employee-omar",
    annualPolicy.id,
    0,
    "Set a zero starting balance for the cap check",
    hr,
  );

  await assert.rejects(
    () =>
      service.submitLeaveRequest(
        {
          employeeId: "employee-omar",
          policyId: annualPolicy.id,
          startDate: "2027-03-01",
          endDate: "2027-03-08",
          reason: "Family travel",
          handoverContactId: "employee-tariq",
        },
        employee,
      ),
    /lowest permitted balance is -5 days/,
  );
});

test("HR can set an employee-specific statutory leave allowance", () => {
  const { service } = harness();
  const iddahPolicy = service.getPolicies().find((policy) => policy.type === "Iddah");
  assert.ok(iddahPolicy);

  const override = service.setEmployeeAvailableBalance(
    "employee-mariam",
    iddahPolicy.id,
    14,
    "Non-Muslim statutory allowance",
    hr,
  );
  assert.equal("days" in override ? override.days : undefined, 14);
  assert.equal(service.getEmployeeEntitlementLimit("employee-mariam", iddahPolicy.id, hr), 14);
});

test("HR can recover a manager-stage leave request only with a recorded explanation", async () => {
  const { service, audit } = harness();
  const annualPolicy = service.getPolicies().find((policy) => policy.type === "Annual");
  assert.ok(annualPolicy);
  const request = await service.submitLeaveRequest(
    {
      employeeId: "employee-omar",
      policyId: annualPolicy.id,
      startDate: "2027-04-04",
      endDate: "2027-04-04",
      reason: "Family appointment",
      handoverContactId: "employee-tariq",
    },
    employee,
  );

  const recovered = service.approveRequest(request.id, {
    ...hr,
    reason: "Assigned supervisor is unavailable",
  });
  assert.equal(recovered.status, "Pending HR");
  assert.ok(
    audit
      .list()
      .some(
        (event) =>
          event.entityId === request.id && event.reason?.includes("supervisor is unavailable"),
      ),
  );
});

test("employees cannot run the annual rollover directly, but the automatic system-attributed path still works", () => {
  const { service, audit } = harness();
  assert.throws(
    () => service.runAnnualRollover(new Date().getFullYear(), employee),
    /Only HR or Super Admin/,
  );
  assert.equal(audit.list().at(-1)?.action, "access-denied");

  // The automatic path is attributed to the system, not a manually-elevated employee context.
  service.autoRunAnnualRollover();
  const rolloverEvents = audit
    .list()
    .filter((event) => event.action === "create" && event.entityType === "leave_transaction");
  assert.ok(rolloverEvents.some((event) => event.actor.userId === "system"));
});
