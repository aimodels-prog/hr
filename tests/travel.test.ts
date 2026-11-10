import assert from "node:assert/strict";
import test from "node:test";

import { configureApplicationDataServices } from "../src/lib/data/application-data.ts";
import { AuditService } from "../src/lib/data/audit-service.ts";
import { getMasterDataRepository, getProjectRepository } from "../src/lib/data/master-data.ts";
import { NotificationService } from "../src/lib/data/notification-service.ts";
import { initializeSeedData } from "../src/lib/data/seed-service.ts";
import { MemoryStorageDriver } from "../src/lib/data/storage-driver.ts";
import { VersionedStorageService } from "../src/lib/data/storage.ts";
import { calculateTravelVariancePercent, TravelService } from "../src/lib/data/travel-service.ts";
import { PayrollService } from "../src/lib/data/payroll-service.ts";
import { SettingsService } from "../src/lib/data/settings-service.ts";
import type { Employee } from "../src/lib/data/types.ts";
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
    userId: "user-layla",
    employeeId: "employee-layla",
    displayName: "Layla Al Harthy",
    activeRole: "Employee",
    roles: ["Employee", "Line Manager"],
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
    userId: "user-mariam",
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
  return { travel: new TravelService(), storage, audit, files };
}

function submitBasicRequest(
  travel: TravelService,
  overrides: Partial<Parameters<TravelService["submitRequest"]>[0]> = {},
) {
  return travel.submitRequest(
    {
      employeeId: "employee-omar",
      purpose: "Client workshop",
      destination: "Dubai, UAE",
      startDate: "2020-01-10",
      endDate: "2020-01-12",
      currency: "OMR",
      estTransport: 100,
      estAccommodation: 200,
      estPerDiem: 50,
      estOther: 0,
      ...overrides,
    },
    employee,
  );
}

test("an employee cannot submit a travel request for another employee", async () => {
  const { travel } = harness();
  await assert.rejects(
    () =>
      travel.submitRequest(
        {
          employeeId: "employee-layla",
          purpose: "x",
          destination: "x",
          startDate: "2020-01-10",
          endDate: "2020-01-12",
          currency: "OMR",
        },
        employee,
      ),
    /not authorised/,
  );
});

test("negative estimates are rejected", async () => {
  const { travel } = harness();
  await assert.rejects(
    () => submitBasicRequest(travel, { estTransport: -50 }),
    /cannot be negative/,
  );
});

test("invalid calendar dates and unsupported currencies are rejected by the service", async () => {
  const { travel } = harness();
  await assert.rejects(
    () => submitBasicRequest(travel, { startDate: "2026-02-31" }),
    /valid calendar date/,
  );
  await assert.rejects(() => submitBasicRequest(travel, { currency: "XYZ" }), /active currency/);
});

test("an invalid/archived project is rejected", async () => {
  const { travel } = harness();
  const archived = getProjectRepository().create(
    { name: "Old Project", code: "OLD", isActive: false, description: "", orderIndex: 0 } as never,
    hr,
  );
  await assert.rejects(
    () => submitBasicRequest(travel, { projectId: archived.id }),
    /invalid or archived/,
  );
});

test("an invalid/inactive cost centre is rejected", async () => {
  const { travel } = harness();
  const inactiveCc = getMasterDataRepository("costCentres").create(
    { name: "Old CC", code: "OLDCC", isActive: false, description: "", orderIndex: 0 } as never,
    hr,
  );
  await assert.rejects(
    () => submitBasicRequest(travel, { costCentreId: inactiveCc.id }),
    /cost centre is invalid/,
  );
});

test("no one can read another employee's travel request by ID", async () => {
  const { travel } = harness();
  const req = await submitBasicRequest(travel);
  assert.throws(() => travel.getRequestById(req.id, otherEmployee), /not authorised/);
  // The owner, and privileged reviewers, can read it.
  assert.ok(travel.getRequestById(req.id, employee));
  assert.ok(travel.getRequestById(req.id, hr));
  assert.ok(travel.getRequestById(req.id, accounts));
});

test("getAllRequests and getRequestsForEmployee are restricted to reviewers or the employee themselves", async () => {
  const { travel } = harness();
  await submitBasicRequest(travel);

  assert.throws(() => travel.getAllRequests(employee), /not authorised/);
  assert.ok(travel.getAllRequests(hr));
  assert.ok(travel.getAllRequests(accounts));

  assert.throws(
    () => travel.getRequestsForEmployee("employee-omar", otherEmployee),
    /not authorised/,
  );
  assert.ok(travel.getRequestsForEmployee("employee-omar", employee));
  assert.ok(travel.getRequestsForEmployee("employee-omar", hr));
});

test("a line manager can view travel history only for their direct reports", async () => {
  const { travel } = harness();
  const request = await submitBasicRequest(travel);
  assert.equal(travel.getRequestsForEmployee("employee-omar", manager)[0]?.id, request.id);
  assert.throws(() => travel.getRequestsForEmployee("employee-mariam", manager), /not authorised/);
});

test("travel variance remains finite when the authorised estimate is zero", () => {
  assert.equal(calculateTravelVariancePercent(0, 0), 0);
  assert.equal(calculateTravelVariancePercent(0, 25), 100);
  assert.equal(calculateTravelVariancePercent(100, 125), 25);
  assert.ok(Number.isFinite(calculateTravelVariancePercent(0, 25)));
});

test("a traveller cannot approve their own request for HR or Accounts", async () => {
  const { travel } = harness();
  const travellerWithAdminRole: ActorContext = {
    actor: { ...superAdmin.actor, employeeId: "employee-omar" },
  };
  const req = await travel.submitRequest(
    {
      employeeId: "employee-omar",
      purpose: "Conference",
      destination: "London, UK",
      startDate: "2020-01-10",
      endDate: "2020-01-12",
      currency: "OMR",
    },
    travellerWithAdminRole,
  );
  assert.throws(
    () => travel.hrApprove(req.id, true, "", travellerWithAdminRole),
    /cannot review your own/,
  );
  assert.throws(
    () => travel.accountsApprove(req.id, true, "", travellerWithAdminRole),
    /cannot review your own/,
  );
});

test("rejecting requires a reason from both HR and Accounts", async () => {
  const { travel } = harness();
  const req = await submitBasicRequest(travel);
  travel.managerApprove(req.id, true, "Business need confirmed", manager);
  assert.throws(() => travel.hrApprove(req.id, false, "", hr), /detailed reason/);
  travel.hrApprove(req.id, true, "Policy checked", hr);
  assert.throws(() => travel.accountsApprove(req.id, false, "  ", accounts), /detailed reason/);
});

test("a request only reaches Pre-authorised once the supervisor, HR and Accounts approve", async () => {
  const { travel } = harness();
  const req = await submitBasicRequest(travel);
  const afterManager = travel.managerApprove(req.id, true, "Work travel is required", manager);
  assert.equal(afterManager.status, "Pending HR and Accounts");
  const afterHr = travel.hrApprove(req.id, true, "Dates look fine", hr);
  assert.equal(afterHr.status, "Pending HR and Accounts");
  const afterAccounts = travel.accountsApprove(req.id, true, "Within budget", accounts);
  assert.equal(afterAccounts.status, "Pre-authorised");
  assert.equal(afterAccounts.hrApprovedBy, hr.actor.userId);
  assert.equal(afterAccounts.accountsApprovedBy, accounts.actor.userId);
  assert.ok(afterAccounts.hrApprovedAt);
  assert.ok(afterAccounts.accountsApprovedAt);
  assert.ok(afterAccounts.preAuthorisedAt);
  assert.deepEqual(afterAccounts.authorisedBudget, {
    estTransport: 100,
    estAccommodation: 200,
    estPerDiem: 50,
    estOther: 0,
    totalEstimate: 350,
    currency: "OMR",
    capturedAt: afterAccounts.preAuthorisedAt,
  });
});

test("a managerless CEO trip waits for Finance, with supervisor and HR marked not required", async () => {
  const { travel, storage } = harness();
  const employees = storage.readCollection<Employee>("employees");
  storage.writeCollection(
    "employees",
    employees.map((person) =>
      person.id === "employee-yusuf"
        ? { ...person, position: "CEO", lineManagerId: undefined }
        : person,
    ),
  );
  const request = await travel.submitRequest(
    {
      employeeId: "employee-yusuf",
      purpose: "Client conference",
      destination: "Dubai, UAE",
      startDate: "2020-02-10",
      endDate: "2020-02-12",
      currency: "OMR",
    },
    superAdmin,
  );
  assert.deepEqual(request.approvalRoute, {
    kind: "Managerless Executive",
    reviewerRole: "Accounts",
    notifyHr: true,
  });
  assert.equal(request.managerApprovalStatus, "Not Required");
  assert.equal(request.hrApprovalStatus, "Not Required");
  assert.equal(request.accountsApprovalStatus, "Pending");
  assert.throws(() => travel.hrApprove(request.id, true, "", hr), /Invalid state/);
  const approved = travel.accountsApprove(request.id, true, "Within budget", accounts);
  assert.equal(approved.status, "Pre-authorised");
  assert.equal(approved.accountsApprovedBy, accounts.actor.userId);
  assert.equal(approved.hrApprovedBy, undefined);
  assert.equal(approved.managerApprovedBy, undefined);
});

test("HR staff travel uses the configured independent reviewer in Employee mode before Finance", async () => {
  const { travel } = harness();
  const settingsService = new SettingsService();
  const previous = settingsService.getAppSettingsSync();
  await settingsService.saveAppSettings(
    {
      ...previous,
      approvalRouting: {
        ...previous.approvalRouting!,
        hrOwnRequestReviewerEmployeeId: "employee-yusuf",
      },
    },
    superAdmin,
  );
  try {
    const request = await travel.submitRequest(
      {
        employeeId: "employee-rana",
        purpose: "HR conference",
        destination: "Salalah, Oman",
        startDate: "2020-03-10",
        endDate: "2020-03-12",
        currency: "OMR",
      },
      hr,
    );
    assert.equal(request.approvalRoute?.kind, "HR Own Travel");
    assert.equal(request.hrApprovalStatus, "Not Required");
    assert.equal(request.managerApprovalStatus, "Pending");
    assert.throws(() => travel.hrApprove(request.id, true, "", hr), /cannot review your own/);
    assert.throws(
      () => travel.managerApprove(request.id, true, "", superAdmin),
      /assigned trip reviewer/,
    );
    const reviewerInEmployeeMode: ActorContext = {
      actor: { ...superAdmin.actor, activeRole: "Employee" },
    };
    const afterReviewer = travel.managerApprove(
      request.id,
      true,
      "Conference justified",
      reviewerInEmployeeMode,
    );
    assert.equal(afterReviewer.status, "Pending HR and Accounts");
    assert.equal(afterReviewer.managerApprovedBy, superAdmin.actor.userId);
    const afterFinance = travel.accountsApprove(request.id, true, "Costs approved", accounts);
    assert.equal(afterFinance.status, "Pre-authorised");
    assert.equal(afterFinance.hrApprovedBy, undefined);
  } finally {
    await settingsService.saveAppSettings(previous, superAdmin);
  }
});

test("an assigned HR supervisor completes the supervisor and HR travel reviews once", async () => {
  const { travel } = harness();
  const req = await submitBasicRequest(travel);
  const hrStandIn: ActorContext = {
    actor: {
      ...manager.actor,
      activeRole: "HR",
      roles: ["Employee", "HR"],
    },
  };
  const reviewed = travel.managerApprove(req.id, true, "Business trip confirmed", hrStandIn);
  assert.equal(reviewed.managerApprovalStatus, "Approved");
  assert.equal(reviewed.hrApprovalStatus, "Approved");
  assert.equal(reviewed.hrApprovedBy, hrStandIn.actor.userId);
  assert.equal(reviewed.status, "Pending HR and Accounts");
  assert.equal(
    travel.accountsApprove(req.id, true, "Budget confirmed", accounts).status,
    "Pre-authorised",
  );
});

test("expense lines cannot change the currency of the pre-authorised trip", async () => {
  const { travel, files } = harness();
  const req = await submitBasicRequest(travel);
  travel.managerApprove(req.id, true, "Work travel is required", manager);
  travel.hrApprove(req.id, true, "Fine", hr);
  travel.accountsApprove(req.id, true, "Fine", accounts);
  const receipt = await files.save(
    {
      blob: new Blob(["receipt"]),
      name: "receipt.pdf",
      mimeType: "application/pdf",
      owner: { entityType: "travel-expense-line", entityId: "line-currency" },
    },
    employee,
  );
  await assert.rejects(
    () =>
      travel.submitExpenses(
        req.id,
        [
          {
            id: "line-currency",
            category: "Transport",
            amount: 100,
            currency: "GBP",
            exchangeRate: 0.5,
            reference: "GBP-1",
            date: "2020-01-11",
            receiptFileId: receipt.id,
          },
        ],
        "",
        employee,
      ),
    /pre-authorised trip currency/,
  );
});

test("either reviewer rejecting sends the whole request to Rejected", async () => {
  const { travel } = harness();
  const req = await submitBasicRequest(travel);
  travel.managerApprove(req.id, true, "Work travel is required", manager);
  travel.hrApprove(req.id, true, "Fine", hr);
  const afterAccounts = travel.accountsApprove(
    req.id,
    false,
    "Over budget for this quarter",
    accounts,
  );
  assert.equal(afterAccounts.status, "Rejected");
});

test("expense lines require a positive amount, a bill reference, and a date inside the trip window", async () => {
  const { travel } = harness();
  const req = await submitBasicRequest(travel);
  travel.managerApprove(req.id, true, "Work travel is required", manager);
  travel.hrApprove(req.id, true, "Fine", hr);
  const approved = travel.accountsApprove(req.id, true, "Fine", accounts);
  assert.equal(approved.status, "Pre-authorised");

  const base = {
    id: "line-1",
    category: "Transport" as const,
    currency: "OMR",
    date: "2020-01-11",
  };

  await assert.rejects(
    () =>
      travel.submitExpenses(req.id, [{ ...base, amount: -10, reference: "INV-1" }], "", employee),
    /positive amount/,
  );
  await assert.rejects(
    () => travel.submitExpenses(req.id, [{ ...base, amount: 10, reference: "" }], "", employee),
    /bill\/receipt reference/,
  );
  await assert.rejects(
    () =>
      travel.submitExpenses(
        req.id,
        [{ ...base, amount: 10, reference: "INV-1", date: "2019-01-01" }],
        "",
        employee,
      ),
    /outside the trip's travel period/,
  );
});

test("expense receipt files are verified for existence and ownership before being accepted", async () => {
  const { travel, files } = harness();
  const req = await submitBasicRequest(travel);
  travel.managerApprove(req.id, true, "Work travel is required", manager);
  travel.hrApprove(req.id, true, "Fine", hr);
  travel.accountsApprove(req.id, true, "Fine", accounts);

  await assert.rejects(
    () =>
      travel.submitExpenses(
        req.id,
        [
          {
            id: "line-1",
            category: "Transport",
            currency: "OMR",
            date: "2020-01-11",
            amount: 50,
            reference: "INV-1",
            receiptFileId: "does-not-exist",
          },
        ],
        "",
        employee,
      ),
    /could not be verified/,
  );

  // A receipt belonging to a different expense line must also be rejected.
  const wrongOwnerReceipt = await files.save(
    {
      blob: new Blob(["receipt"]),
      name: "receipt.pdf",
      mimeType: "application/pdf",
      owner: { entityType: "travel-expense-line", entityId: "some-other-line" },
    },
    employee,
  );
  await assert.rejects(
    () =>
      travel.submitExpenses(
        req.id,
        [
          {
            id: "line-1",
            category: "Transport",
            currency: "OMR",
            date: "2020-01-11",
            amount: 50,
            reference: "INV-1",
            receiptFileId: wrongOwnerReceipt.id,
          },
        ],
        "",
        employee,
      ),
    /could not be verified/,
  );

  // A receipt correctly owned by this exact line is accepted.
  const validReceipt = await files.save(
    {
      blob: new Blob(["receipt"]),
      name: "receipt.pdf",
      mimeType: "application/pdf",
      owner: { entityType: "travel-expense-line", entityId: "line-1" },
    },
    employee,
  );
  const updated = await travel.submitExpenses(
    req.id,
    [
      {
        id: "line-1",
        category: "Transport",
        currency: "OMR",
        date: "2020-01-11",
        amount: 50,
        reference: "INV-1",
        receiptFileId: validReceipt.id,
      },
    ],
    "",
    employee,
  );
  assert.equal(updated.status, "Pending Super Admin Closure");
});

test("evidence and receipt downloads are restricted to the traveller and reviewers, and are audited", async () => {
  const { travel, files, audit } = harness();
  const evidence = await files.save(
    {
      blob: new Blob(["evidence"]),
      name: "evidence.pdf",
      mimeType: "application/pdf",
      owner: { entityType: "travel-request", entityId: "employee-omar" },
    },
    employee,
  );
  const req = await submitBasicRequest(travel, { evidenceFileId: evidence.id });

  const ownerResult = await travel.getEvidenceBlob(req.id, employee);
  assert.equal(ownerResult.fileName, "evidence.pdf");
  const hrResult = await travel.getEvidenceBlob(req.id, hr);
  assert.ok(hrResult.blob);

  await assert.rejects(() => travel.getEvidenceBlob(req.id, otherEmployee), /not authorised/);

  const accessEvents = audit.list().filter((e) => e.action === "travel_evidence_accessed");
  assert.equal(accessEvents.length, 2);
});

test("closing the reimbursement produces Closed, and rejecting expenses clears stale totals", async () => {
  const { travel, files } = harness();
  const req = await submitBasicRequest(travel);
  travel.managerApprove(req.id, true, "Work travel is required", manager);
  travel.hrApprove(req.id, true, "Fine", hr);
  travel.accountsApprove(req.id, true, "Fine", accounts);

  const firstReceipt = await files.save(
    {
      blob: new Blob(["receipt"]),
      name: "receipt-1.pdf",
      mimeType: "application/pdf",
      owner: { entityType: "travel-expense-line", entityId: "line-1" },
    },
    employee,
  );

  const withExpenses = await travel.submitExpenses(
    req.id,
    [
      {
        id: "line-1",
        category: "Transport",
        currency: "OMR",
        date: "2020-01-11",
        amount: 120,
        reference: "INV-1",
        receiptFileId: firstReceipt.id,
      },
    ],
    "",
    employee,
  );
  assert.equal(withExpenses.status, "Pending Super Admin Closure");
  assert.equal(withExpenses.actualTotal, 120);

  const rejected = travel.superAdminClose(req.id, false, "Missing itemised receipt", superAdmin);
  assert.equal(rejected.status, "Pre-authorised");
  assert.equal(
    rejected.actualTotal,
    undefined,
    "actualTotal must be cleared after expense rejection",
  );
  assert.equal(rejected.expenses?.length, 0);

  const secondReceipt = await files.save(
    {
      blob: new Blob(["receipt"]),
      name: "receipt-2.pdf",
      mimeType: "application/pdf",
      owner: { entityType: "travel-expense-line", entityId: "line-2" },
    },
    employee,
  );

  const resubmitted = await travel.submitExpenses(
    req.id,
    [
      {
        id: "line-2",
        category: "Transport",
        currency: "OMR",
        date: "2020-01-11",
        amount: 90,
        reference: "INV-2",
        receiptFileId: secondReceipt.id,
      },
    ],
    "",
    employee,
  );
  const closed = travel.superAdminClose(resubmitted.id, true, "Looks correct", superAdmin);
  assert.equal(closed.status, "Closed");
  assert.ok(closed.closedAt);
  assert.equal(closed.closedBy, superAdmin.actor.userId);
});

test("late-closed reimbursement carries into the next payroll and keeps OMR separate from salary currency", async (t) => {
  // The reimbursement must close within the payroll period below, regardless
  // of the date on which this regression test runs.
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-26T10:00:00Z") });
  const { travel, files, storage } = harness();
  const employees = storage.readCollection<Employee>("employees");
  storage.writeCollection(
    "employees",
    employees.map((item) =>
      item.id === "employee-omar"
        ? { ...item, salary: { ...(item.salary ?? { baseMonthly: 0 }), currency: "GBP" } }
        : item,
    ),
  );
  const req = await submitBasicRequest(travel);
  travel.managerApprove(req.id, true, "Work travel is required", manager);
  travel.hrApprove(req.id, true, "Fine", hr);
  travel.accountsApprove(req.id, true, "Fine", accounts);
  const receipt = await files.save(
    {
      blob: new Blob(["receipt"]),
      name: "receipt.pdf",
      mimeType: "application/pdf",
      owner: { entityType: "travel-expense-line", entityId: "late-line" },
    },
    employee,
  );
  await travel.submitExpenses(
    req.id,
    [
      {
        id: "late-line",
        category: "Transport",
        amount: 90,
        currency: "OMR",
        reference: "LATE-90",
        date: "2020-01-11",
        receiptFileId: receipt.id,
      },
    ],
    "",
    employee,
  );
  travel.superAdminClose(req.id, true, "Receipt checked", superAdmin);

  const payroll = new PayrollService();
  assert.throws(() => payroll.getAllPeriods(employee), /not authorised/);
  const period = payroll.createPeriod(
    {
      name: "September 2026",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      cutoffDate: "2026-09-25",
      paymentDate: "2026-09-30",
      notes: "Carry-forward regression",
    },
    accounts,
  );
  const collected = payroll.collectInputs(period.id, accounts);
  const row = collected.compiledInputs?.find((item) => item.employeeId === "employee-omar");
  assert.equal(row?.reimbursementsTotal, 90);
  assert.equal(row?.reimbursementsCurrency, "OMR");
  assert.equal(row?.currency, "GBP");
  assert.equal(travel.getRequestById(req.id, accounts)?.payrollPeriodId, period.id);
  assert.ok(
    collected.exceptions.some(
      (item) =>
        item.type === "Unmatched Reimbursement" &&
        item.description.includes("automatically carried"),
    ),
  );
});

test("every payroll operation is protected inside the service and denials are audited", () => {
  const { audit } = harness();
  const payroll = new PayrollService();
  const period = payroll.createPeriod(
    {
      name: "October 2026",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      cutoffDate: "2026-10-25",
      paymentDate: "2026-10-31",
    },
    accounts,
  );

  assert.throws(() => payroll.getAllPeriods(employee), /not authorised/);
  assert.throws(() => payroll.getPeriodById(period.id, employee), /not authorised/);
  assert.throws(
    () =>
      payroll.createPeriod(
        {
          name: "Employee-created period",
          startDate: "2026-11-01",
          endDate: "2026-11-30",
          cutoffDate: "2026-11-25",
          paymentDate: "2026-11-30",
        },
        employee,
      ),
    /not authorised/,
  );
  assert.throws(() => payroll.collectInputs(period.id, employee), /not authorised/);
  assert.throws(
    () => payroll.acknowledgeException(period.id, "missing", "Resolved correctly", employee),
    /not authorised/,
  );
  assert.throws(() => payroll.lockPeriod(period.id, employee), /not authorised/);
  assert.throws(() => payroll.exportCsv(period.id, employee), /not authorised/);

  const denials = audit
    .list()
    .filter((event) => event.module === "payroll" && event.action.toLowerCase().includes("denied"));
  assert.equal(denials.length, 7);
});
