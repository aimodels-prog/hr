import assert from "node:assert/strict";
import test from "node:test";

import { configureApplicationDataServices } from "../src/lib/data/application-data.ts";
import { AttendanceService } from "../src/lib/data/attendance-service.ts";
import { AuditService } from "../src/lib/data/audit-service.ts";
import { LeaveService } from "../src/lib/data/leave-service.ts";
import { getProjectRepository } from "../src/lib/data/master-data.ts";
import { NotificationService } from "../src/lib/data/notification-service.ts";
import { OvertimeService } from "../src/lib/data/overtime-service.ts";
import { initializeSeedData } from "../src/lib/data/seed-service.ts";
import { MemoryStorageDriver } from "../src/lib/data/storage-driver.ts";
import { VersionedStorageService } from "../src/lib/data/storage.ts";
import { TimesheetService } from "../src/lib/data/timesheet-service.ts";
import type { FileRepository, SaveFileInput } from "../src/lib/data/file-repository.ts";
import type { ActorContext, FileMetadata } from "../src/lib/data/types.ts";

const employee: ActorContext = {
  actor: {
    userId: "user-omar",
    employeeId: "employee-omar",
    displayName: "Omar Rahman",
    activeRole: "Employee",
    roles: ["Employee"],
  },
};

const otherEmployee: ActorContext = {
  actor: {
    userId: "user-mariam",
    employeeId: "employee-mariam",
    displayName: "Mariam Said",
    activeRole: "Employee",
    roles: ["Employee", "Accounts"],
  },
};

const manager: ActorContext = {
  actor: {
    userId: "user-layla",
    employeeId: "employee-layla",
    displayName: "Layla Al Harthy",
    activeRole: "Line Manager",
    roles: ["Employee", "Line Manager"],
  },
};

const hr: ActorContext = {
  actor: {
    userId: "user-rana",
    employeeId: "employee-rana",
    displayName: "Rana Nair",
    activeRole: "HR",
    roles: ["Employee", "HR"],
  },
};

const accounts: ActorContext = {
  actor: {
    userId: "user-mariam-2",
    employeeId: "employee-mariam",
    displayName: "Mariam Said",
    activeRole: "Accounts",
    roles: ["Employee", "Accounts"],
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
        .filter((f) => f.metadata.owner.entityType === owner.entityType && f.metadata.owner.entityId === owner.entityId)
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
  const driver = new MemoryStorageDriver();
  const storage = new VersionedStorageService(driver);
  initializeSeedData(storage);
  const audit = new AuditService(storage);
  const notifications = new NotificationService(storage, audit);
  const files = fakeFileRepository();
  configureApplicationDataServices({ storage, audit, notifications, files });
  return { overtime: new OvertimeService(), storage, audit, files, driver };
}

test("an employee cannot submit an overtime claim for another employee", async () => {
  const { overtime } = harness();
  await assert.rejects(
    () =>
      overtime.submitClaim(
        { employeeId: "employee-mariam", date: "2026-08-10", hours: 2, reason: "Late release" },
        employee,
      ),
    /not authorised/,
  );
});

test("HR can submit an overtime claim on behalf of another employee", async () => {
  const { overtime } = harness();
  const claim = await overtime.submitClaim(
    { employeeId: "employee-omar", date: "2026-08-10", hours: 2, reason: "Month-end close" },
    hr,
  );
  assert.equal(claim.employeeId, "employee-omar");
  assert.equal(claim.status, "Pending Manager");
});

test("a future-dated overtime claim is rejected", async () => {
  const { overtime } = harness();
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await assert.rejects(
    () => overtime.submitClaim({ employeeId: "employee-omar", date: future, hours: 2, reason: "x" }, employee),
    /future date/,
  );
});

test("a claim exceeding the maximum daily hours is rejected", async () => {
  const { overtime } = harness();
  await assert.rejects(
    () =>
      overtime.submitClaim(
        { employeeId: "employee-omar", date: "2026-08-10", hours: 20, reason: "Way too many hours" },
        employee,
      ),
    /cannot exceed/,
  );
});

test("a claim against a nonexistent employee is rejected", async () => {
  const { overtime } = harness();
  await assert.rejects(
    () =>
      overtime.submitClaim(
        { employeeId: "employee-does-not-exist", date: "2026-08-10", hours: 2, reason: "x" },
        hr,
      ),
    /could not be found/,
  );
});

test("a claim against an archived project is rejected", async () => {
  const { overtime } = harness();
  const archived = getProjectRepository().create(
    {
      name: "Legacy Project",
      code: "LEGACY",
      isActive: false,
      description: "",
    } as never,
    hr,
  );
  await assert.rejects(
    () =>
      overtime.submitClaim(
        {
          employeeId: "employee-omar",
          date: "2026-08-10",
          hours: 2,
          reason: "x",
          projectId: archived.id,
        },
        employee,
      ),
    /invalid or archived/,
  );
});

test("an evidence file that does not exist or belongs to another employee is rejected", async () => {
  const { overtime, files } = harness();
  await assert.rejects(
    () =>
      overtime.submitClaim(
        { employeeId: "employee-omar", date: "2026-08-10", hours: 2, reason: "x", evidenceFileId: "does-not-exist" },
        employee,
      ),
    /could not be verified/,
  );

  const wrongOwnerFile = await files.save(
    { blob: new Blob(["evidence"]), name: "note.pdf", mimeType: "application/pdf", owner: { entityType: "overtime-claim", entityId: "employee-mariam" } },
    employee,
  );
  await assert.rejects(
    () =>
      overtime.submitClaim(
        { employeeId: "employee-omar", date: "2026-08-10", hours: 2, reason: "x", evidenceFileId: wrongOwnerFile.id },
        employee,
      ),
    /could not be verified/,
  );
});

test("a line manager cannot approve their own overtime claim", async () => {
  const { overtime } = harness();
  // Layla has no line manager scoped for this claim, but is submitting for herself.
  const claim = await overtime.submitClaim(
    { employeeId: "employee-layla", date: "2026-08-10", hours: 2, reason: "Self claim" },
    manager,
  );
  assert.throws(() => overtime.managerApprove(claim.id, manager), /own overtime claim/);
});

test("Super Admin cannot approve their own overtime claim even though they hold admin permission", async () => {
  const { overtime } = harness();
  const claim = await overtime.submitClaim(
    { employeeId: "employee-yusuf", date: "2026-08-10", hours: 2, reason: "Self claim" },
    superAdmin,
  );
  assert.throws(() => overtime.managerApprove(claim.id, superAdmin), /own overtime claim/);
});

test("a manager approving a direct report's claim moves it straight to Approved when HR verification is not required", async () => {
  const { overtime } = harness();
  const claim = await overtime.submitClaim(
    { employeeId: "employee-omar", date: "2026-08-10", hours: 2, reason: "Client escalation" },
    employee,
  );
  const approved = overtime.managerApprove(claim.id, manager);
  assert.equal(approved.status, "Approved");
});

test("HR verification stage is honoured when required, and Accounts cannot verify", async () => {
  const { overtime } = harness();
  const tsService = new TimesheetService(new AttendanceService());
  tsService.saveSettings({ ...tsService.getSettings(), requireHrOvertimeVerification: true }, hr);

  const claim = await overtime.submitClaim(
    { employeeId: "employee-omar", date: "2026-08-10", hours: 2, reason: "Client escalation" },
    employee,
  );
  const managerApproved = overtime.managerApprove(claim.id, manager);
  assert.equal(managerApproved.status, "Pending HR");

  assert.throws(() => overtime.hrVerify(claim.id, true, "", otherEmployee), /not authorised/);

  const finalised = overtime.hrVerify(claim.id, true, "Verified", hr);
  assert.equal(finalised.status, "Approved");
});

test("a TOIL claim credits Compensation Leave exactly once when approved", async () => {
  const { overtime } = harness();
  const claim = await overtime.submitClaim(
    {
      employeeId: "employee-omar",
      date: "2026-08-10",
      hours: 8,
      reason: "Weekend deployment",
      compensationType: "TOIL",
    },
    employee,
  );
  const approved = overtime.managerApprove(claim.id, manager);
  assert.equal(approved.status, "Approved");
  assert.ok(approved.toilCreditedAt, "expected toilCreditedAt to be set after crediting");

  const leaveService = new LeaveService();
  const balances = leaveService.getAllBalancesForEmployee("employee-omar");
  const compOff = leaveService.getPolicies().find((p) => p.code === "C/OFF");
  const balance = balances.find((b) => b.policyId === compOff!.id);
  assert.ok(balance, "expected a Compensation Leave balance for the employee");
  assert.ok(balance!.available > 0, "expected a positive Compensation Leave balance after TOIL credit");
});

test("correcting an approved claim only archives the original once the replacement is accepted", async () => {
  const { overtime } = harness();
  const claim = await overtime.submitClaim(
    { employeeId: "employee-omar", date: "2026-08-10", hours: 2, reason: "Client escalation" },
    employee,
  );
  const approved = overtime.managerApprove(claim.id, manager);
  assert.equal(approved.status, "Approved");

  // An invalid correction (exceeds the max hours) must fail validation without touching the
  // original claim's status.
  await assert.rejects(
    () => overtime.createCorrection(approved.id, 40, "Too many hours", employee),
    /cannot exceed/,
  );
  const stillApproved = overtime.getClaimsForEmployee("employee-omar", employee).find((c) => c.id === approved.id);
  assert.equal(stillApproved?.status, "Approved", "original claim must not be archived when the correction is invalid");

  const corrected = await overtime.createCorrection(approved.id, 3, "Corrected hours", employee);
  assert.equal(corrected.status, "Pending Manager");
  const original = overtime.getClaimsForEmployee("employee-omar", employee).find((c) => c.id === approved.id);
  assert.equal(original?.status, "Corrected");
});

test("a valid correction commits the replacement and the original's Corrected status in a single atomic write", async () => {
  const { overtime, driver } = harness();
  const claim = await overtime.submitClaim(
    { employeeId: "employee-omar", date: "2026-08-11", hours: 2, reason: "Client escalation" },
    employee,
  );
  const approved = overtime.managerApprove(claim.id, manager);
  assert.equal(approved.status, "Approved");

  let overtimeClaimsWrites = 0;
  const originalSetItem = driver.setItem.bind(driver);
  driver.setItem = (key: string, value: string) => {
    if (key.includes("overtimeClaims")) overtimeClaimsWrites += 1;
    originalSetItem(key, value);
  };

  const corrected = await overtime.createCorrection(approved.id, 3, "Corrected hours", employee);

  // Audit log entries and notifications are separate collections with their own writes, so they
  // are excluded here - the atomicity claim is specifically about the "overtimeClaims" collection
  // itself: the new replacement claim and the original's "Corrected" status must land in exactly
  // one writeCollection() call against that collection, not two. Two separate create()+update()
  // commits - the old, non-atomic approach - would have produced two writes here instead of one.
  assert.equal(overtimeClaimsWrites, 1, "expected the replacement and the original's status change to land in a single writeCollection commit against overtimeClaims");

  const original = overtime.getClaimsForEmployee("employee-omar", employee).find((c) => c.id === approved.id);
  assert.equal(original?.status, "Corrected");
  assert.equal(corrected.status, "Pending Manager");
});

test("two concurrent corrections against the same approved claim cannot both succeed", async () => {
  const { overtime } = harness();
  const claim = await overtime.submitClaim(
    { employeeId: "employee-omar", date: "2026-08-12", hours: 2, reason: "Client escalation" },
    employee,
  );
  const approved = overtime.managerApprove(claim.id, manager);
  assert.equal(approved.status, "Approved");

  // Both calls start synchronously and reach their internal `await` (buildClaimPayload) before
  // either one commits, exactly like a double-click or two open tabs racing each other.
  const [first, second] = await Promise.allSettled([
    overtime.createCorrection(approved.id, 3, "Correction A", employee),
    overtime.createCorrection(approved.id, 4, "Correction B", employee),
  ]);

  const fulfilled = [first, second].filter((o) => o.status === "fulfilled");
  const rejected = [first, second].filter((o) => o.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactly one of the two concurrent corrections must succeed");
  assert.equal(rejected.length, 1, "the other must be rejected outright, not silently create a second replacement");
  assert.match((rejected[0] as PromiseRejectedResult).reason.message, /already corrected/);

  const replacements = overtime
    .getClaimsForEmployee("employee-omar", employee)
    .filter((c) => c.originalClaimId === approved.id);
  assert.equal(replacements.length, 1, "only one replacement claim must exist for the original, not two");
});

test("getAllClaims requires overtime:admin_all or payroll:view, getClaimsForEmployee is self-or-privileged", async () => {
  const { overtime } = harness();
  await overtime.submitClaim(
    { employeeId: "employee-omar", date: "2026-08-10", hours: 2, reason: "x" },
    employee,
  );

  assert.throws(() => overtime.getAllClaims(employee), /not authorised/);
  assert.ok(overtime.getAllClaims(hr));
  assert.ok(overtime.getAllClaims(accounts));

  assert.throws(() => overtime.getClaimsForEmployee("employee-omar", otherEmployee), /not authorised/);
  assert.ok(overtime.getClaimsForEmployee("employee-omar", employee));
  assert.ok(overtime.getClaimsForEmployee("employee-omar", manager));
});

test("evidence downloads are restricted to the employee, their manager, and HR/Accounts, and are audited", async () => {
  const { overtime, files, audit } = harness();
  const evidence = await files.save(
    { blob: new Blob(["evidence"]), name: "note.pdf", mimeType: "application/pdf", owner: { entityType: "overtime-claim", entityId: "employee-omar" } },
    employee,
  );
  const claim = await overtime.submitClaim(
    { employeeId: "employee-omar", date: "2026-08-10", hours: 2, reason: "x", evidenceFileId: evidence.id },
    employee,
  );

  const ownerResult = await overtime.getEvidenceBlob(claim.id, employee);
  assert.equal(ownerResult.fileName, "note.pdf");
  assert.ok(await overtime.getEvidenceBlob(claim.id, manager));
  assert.ok(await overtime.getEvidenceBlob(claim.id, hr));

  await assert.rejects(() => overtime.getEvidenceBlob(claim.id, otherEmployee), /not authorised/);

  const accessEvents = audit.list().filter((e) => e.action === "overtime_evidence_accessed");
  assert.equal(accessEvents.length, 3);
});
