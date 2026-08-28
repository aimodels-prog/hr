import { SYSTEM_CONTEXT } from "../src/lib/data/types.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { AssetService } from "../src/lib/data/asset-service.ts";
import { AuditService } from "../src/lib/data/audit-service.ts";
import { configureApplicationDataServices } from "../src/lib/data/application-data.ts";
import { DocumentService } from "../src/lib/data/document-service.ts";
import { EmployeeService } from "../src/lib/data/employee-service.ts";
import type { FileRepository, SaveFileInput } from "../src/lib/data/file-repository.ts";
import { NotificationService } from "../src/lib/data/notification-service.ts";
import { initializeSeedData } from "../src/lib/data/seed-service.ts";
import { MemoryStorageDriver } from "../src/lib/data/storage-driver.ts";
import { VersionedStorageService } from "../src/lib/data/storage.ts";
import { TrainingService } from "../src/lib/data/training-service.ts";
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

const manager: ActorContext = {
  actor: {
    userId: "user-layla",
    employeeId: "employee-layla",
    displayName: "Layla Haddad",
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
    userId: "user-aisha",
    employeeId: "employee-aisha",
    displayName: "Aisha Al Habsi",
    activeRole: "Accounts",
    roles: ["Employee", "Accounts"],
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

function setup() {
  const storage = new VersionedStorageService(new MemoryStorageDriver());
  initializeSeedData(storage);
  const audit = new AuditService(storage);
  const notifications = new NotificationService(storage, audit);
  configureApplicationDataServices({
    storage,
    audit,
    notifications,
    files: fakeFileRepository(),
  });
  return { audit, notifications };
}

test("profile requests are self-only and cannot contain employment fields", () => {
  const { audit } = setup();
  const service = new EmployeeService();

  const request = service.requestProfileChange(
    "employee-omar",
    { phone: "+971 50 555 0101" },
    employee,
  );
  assert.equal(request.status, "Pending");

  assert.throws(
    () => service.requestProfileChange("employee-rana", { phone: "000" }, employee),
    /only request changes to your own profile/i,
  );
  assert.equal(audit.list().at(-1)?.action, "access-denied");

  setup();
  const freshService = new EmployeeService();
  assert.throws(
    () => freshService.requestProfileChange("employee-omar", { status: "Archived" }, employee),
    /personal and contact details only/i,
  );
});

test("only active HR or Super Admin can decide personal-profile requests", () => {
  const { notifications } = setup();
  const service = new EmployeeService();
  const request = service.requestProfileChange(
    "employee-omar",
    { preferredName: "Omar R." },
    employee,
  );
  assert.ok(
    notifications
      .listForUser("user-rana")
      .some((notification) => notification.link?.entityId === request.id),
  );

  assert.throws(
    () => service.approveProfileChange(request.id, "Looks correct", manager),
    /Only HR or a Super Admin/i,
  );
  service.approveProfileChange(request.id, "Identity checked", hr);
  assert.equal(service.getById("employee-omar", SYSTEM_CONTEXT)?.preferredName, "Omar R.");
  assert.ok(
    notifications
      .listForUser("user-omar")
      .some((notification) => notification.title === "Profile update approved"),
  );
});

test("HR cannot approve or reject their own profile change request", () => {
  setup();
  const service = new EmployeeService();

  const secondHr: ActorContext = {
    actor: {
      userId: "user-aisha",
      employeeId: "employee-aisha",
      displayName: "Aisha Al Habsi",
      activeRole: "HR",
      roles: ["Employee", "HR"],
    },
  };

  const request = service.requestProfileChange("employee-rana", { preferredName: "Rana N." }, hr);

  assert.throws(
    () => service.approveProfileChange(request.id, "Self-approved", hr),
    /cannot approve your own profile change request/i,
  );
  assert.throws(
    () => service.rejectProfileChange(request.id, "Self-rejected", hr),
    /cannot reject your own profile change request/i,
  );

  // A different HR reviewer is unaffected by the self-approval block.
  service.approveProfileChange(request.id, "Verified by a second reviewer", secondHr);
  assert.equal(service.getById("employee-rana", SYSTEM_CONTEXT)?.preferredName, "Rana N.");
});

test("employment and compensation changes enforce separate active roles", () => {
  setup();
  const service = new EmployeeService();

  service.updateEmploymentRecord(
    "employee-omar",
    { position: "Senior Operations Coordinator" },
    "2026-08-24",
    "Promotion approved",
    hr,
  );
  assert.throws(
    () =>
      service.updateEmploymentRecord(
        "employee-omar",
        { salary: { baseMonthly: 2000, currency: "AED" } },
        "2026-08-24",
        "Salary correction",
        hr,
      ),
    /Only Accounts or a Super Admin/i,
  );
  service.updateEmploymentRecord(
    "employee-omar",
    { salary: { baseMonthly: 2000, currency: "AED" } },
    "2026-08-24",
    "Approved payroll change",
    accounts,
  );
  assert.equal(service.getById("employee-omar", SYSTEM_CONTEXT)?.salary?.baseMonthly, 2000);
  assert.throws(
    () =>
      service.updateEmploymentRecord(
        "employee-omar",
        { status: "Archived" },
        "2026-08-24",
        "Direct archive attempt",
        hr,
      ),
    /controlled workflows/i,
  );
  assert.throws(
    () => service.changeEmployeeStatus("employee-omar", "Archived", "Employee leaving", hr),
    /Complete the offboarding clearance/i,
  );
});

test("training and equipment services reject cross-employee employee actions", () => {
  const { audit } = setup();
  const training = new TrainingService();
  const assets = new AssetService();

  assert.throws(
    () =>
      training.addRecord(
        {
          employeeId: "employee-rana",
          title: "Safety Induction",
          provider: "VIA Academy",
          completionDate: "2026-08-20",
        },
        manager,
      ),
    /add training only for yourself/i,
  );
  assert.throws(
    () =>
      assets.assignAsset(
        {
          employeeId: "employee-omar",
          assetType: "Laptop",
          description: "Dell Latitude",
          assignedDate: "2026-08-24",
          conditionAtAssignment: "New",
        },
        employee,
      ),
    /Only HR or a Super Admin/i,
  );
  assert.equal(audit.list().at(-1)?.action, "access-denied");
});

test("document service blocks cross-employee uploads before file storage", async () => {
  const { audit } = setup();
  const documents = new DocumentService();

  await assert.rejects(
    documents.uploadDocument(
      "employee-rana",
      new Blob(["test"], { type: "application/pdf" }),
      "passport.pdf",
      { type: "passport", visibility: "Restricted" },
      employee,
    ),
    /upload or replace documents only for yourself/i,
  );
  assert.equal(audit.list().at(-1)?.action, "access-denied");
});

test("HR cannot verify or reject their own uploaded document", async () => {
  const { audit } = setup();
  const documents = new DocumentService();

  const hrAsEmployee: ActorContext = {
    actor: {
      userId: "user-rana",
      employeeId: "employee-rana",
      displayName: "Rana Nair",
      activeRole: "Employee",
      roles: ["Employee", "HR"],
    },
  };

  const doc = await documents.uploadDocument(
    "employee-rana",
    new Blob(["test"], { type: "application/pdf" }),
    "id-card.pdf",
    { type: "national_id", documentNumber: "NID-778812", visibility: "Restricted" },
    hrAsEmployee,
  );
  assert.equal(doc.status, "Pending Verification");

  assert.throws(() => documents.verifyDocument(doc.id, hr), /cannot verify your own document/i);
  assert.throws(
    () => documents.rejectDocument(doc.id, "Not valid", hr),
    /cannot reject your own document/i,
  );
  assert.equal(audit.list().at(-1)?.action, "access-denied");

  // A different HR reviewer is unaffected by the self-verification block.
  const secondHr: ActorContext = {
    actor: {
      userId: "user-aisha",
      employeeId: "employee-aisha",
      displayName: "Aisha Al Habsi",
      activeRole: "HR",
      roles: ["Employee", "HR"],
    },
  };
  documents.verifyDocument(doc.id, secondHr);
  assert.equal(documents.getDocumentRepository(SYSTEM_CONTEXT).getById(doc.id)?.status, "Valid");
});

test("Core HR raw repositories reject page-level actors and scoped reads respect the active role", () => {
  const { audit } = setup();
  const service = new EmployeeService();

  assert.throws(
    () => service.getEmployeeRepository(employee),
    /trusted system workflows|reserved/i,
  );
  assert.throws(() => service.getUserRepository(employee), /trusted system workflows|reserved/i);
  assert.throws(() => service.getHistoryRepository(employee), /trusted system workflows|reserved/i);
  assert.throws(
    () => service.getChangeRequestRepository(employee),
    /trusted system workflows|reserved/i,
  );

  assert.deepEqual(
    service.getEmployees(employee).map((item) => item.id),
    ["employee-omar"],
  );
  assert.deepEqual(
    service.getEmployees(accounts).map((item) => item.id),
    ["employee-aisha"],
    "Accounts uses the sanitised directory for lookups and must not receive full HR records",
  );

  const multiRoleEmployee: ActorContext = {
    actor: {
      ...employee.actor,
      roles: ["Employee", "Super Admin"],
      activeRole: "Employee",
    },
  };
  assert.deepEqual(
    service.getEmployees(multiRoleEmployee).map((item) => item.id),
    ["employee-omar"],
    "assigned elevated access must not leak into the Employee role preview",
  );

  const directory = service.getDirectoryEmployees(employee);
  assert.ok(directory.length > 1, "the work directory remains available to employees");
  assert.ok(
    directory.every(
      (item) =>
        item.salary === undefined &&
        item.bankDetails === undefined &&
        item.passportNumber === undefined &&
        item.personalEmail === undefined &&
        item.address === undefined,
    ),
    "directory lookups must never carry private HR or payroll fields",
  );

  assert.ok(
    audit.list().filter((event) => event.action === "access-denied").length >= 4,
    "every raw-repository denial should be audited",
  );
});

test("document metadata reads are scoped and raw document storage is system-only", () => {
  setup();
  const documents = new DocumentService();
  documents.getDocumentRepository(SYSTEM_CONTEXT).create(
    {
      employeeId: "employee-omar",
      fileId: "file-omar-public",
      type: "contract",
      title: "Employment Contract",
      status: "Valid",
      visibility: "Public",
    },
    SYSTEM_CONTEXT,
  );
  documents.getDocumentRepository(SYSTEM_CONTEXT).create(
    {
      employeeId: "employee-rana",
      fileId: "file-rana-private",
      type: "passport",
      title: "Passport",
      documentNumber: "P-001",
      status: "Valid",
      visibility: "Restricted",
    },
    SYSTEM_CONTEXT,
  );

  const employeeDocuments = documents.getDocuments(employee);
  assert.ok(employeeDocuments.length > 0);
  assert.ok(employeeDocuments.every((document) => document.employeeId === "employee-omar"));
  assert.ok(documents.getDocuments(hr).length > employeeDocuments.length);
  assert.throws(
    () => documents.getDocumentRepository(employee),
    /trusted system workflows|reserved/i,
  );
});

test.after(() => configureApplicationDataServices(undefined));
