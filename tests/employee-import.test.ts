import { SYSTEM_CONTEXT } from "../src/lib/data/types.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { AuditService } from "../src/lib/data/audit-service.ts";
import { configureApplicationDataServices } from "../src/lib/data/application-data.ts";
import {
  EmployeeImportService,
  type NormalizedEmployeeRow,
} from "../src/lib/data/employee-import-service.ts";
import { EmployeeService } from "../src/lib/data/employee-service.ts";
import { NotificationService } from "../src/lib/data/notification-service.ts";
import { OnboardingService } from "../src/lib/data/onboarding-service.ts";
import { initializeSeedData } from "../src/lib/data/seed-service.ts";
import { MemoryStorageDriver } from "../src/lib/data/storage-driver.ts";
import { VersionedStorageService } from "../src/lib/data/storage.ts";
import type { ActorContext } from "../src/lib/data/types.ts";

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

function setup() {
  const storage = new VersionedStorageService(new MemoryStorageDriver());
  initializeSeedData(storage);
  const audit = new AuditService(storage);
  const notifications = new NotificationService(storage, audit);
  configureApplicationDataServices({ storage, audit, notifications, files: {} as never });
  return { audit };
}

function row(overrides: Partial<NormalizedEmployeeRow> = {}): NormalizedEmployeeRow {
  return {
    _sourceRowIndex: 2,
    _sourceSheet: "Sheet1",
    employeeNumber: "VIA-1001",
    legalName: "New Hire",
    preferredName: "New Hire",
    workEmail: "new.hire@via.example",
    department: "Operations",
    position: "Coordinator",
    location: "Muscat, Oman",
    employmentType: "Full-time",
    startDate: "2026-09-01",
    status: "Active",
    errors: [],
    ...overrides,
  };
}

test("normalizeData flags missing required fields and unrecognized values instead of guessing", () => {
  const service = new EmployeeImportService();

  const rows = service.normalizeData(
    [
      {
        "Employee #": "VIA-2001",
        Name: "Sara Al Balushi",
        Email: "sara@via.example",
        Department: "Finance",
        Position: "Analyst",
        Location: "Muscat",
        "Start Date": "2026-09-01",
        Status: "Active",
      },
      {
        "Employee #": "",
        Name: "",
        Email: "not-an-email",
        Department: "",
        Position: "",
        Location: "",
        "Start Date": "",
        Status: "Terminated",
      },
    ],
    "Sheet1",
    {
      employeeNumber: "Employee #",
      legalName: "Name",
      workEmail: "Email",
      department: "Department",
      position: "Position",
      location: "Location",
      startDate: "Start Date",
      status: "Status",
    },
    1,
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.errors.length, 0);
  assert.equal(rows[0]?.startDate, "2026-09-01");

  const bad = rows[1]!;
  assert.ok(bad.errors.some((e) => /Employee number is required/.test(e)));
  assert.ok(bad.errors.some((e) => /Legal name is required/.test(e)));
  assert.ok(bad.errors.some((e) => /not a valid address/.test(e)));
  assert.ok(bad.errors.some((e) => /Department is required/.test(e)));
  assert.ok(bad.errors.some((e) => /Start date is required/.test(e)));
  assert.ok(bad.errors.some((e) => /Status "Terminated" is not allowed/.test(e)));
});

test("resolveBatch blocks collisions with existing records and duplicates within the same file", () => {
  setup();
  const importService = new EmployeeImportService();
  const employeeService = new EmployeeService();

  const rows = [
    row({
      employeeNumber: "VIA-0001", // collides with seeded Rana Nair
      workEmail: "clean.one@via.example",
      managerEmployeeNumber: "VIA-0001",
      _sourceRowIndex: 2,
    }),
    row({
      workEmail: "rana.nair@via-int.com", // collides with seeded user email
      employeeNumber: "VIA-3001",
      managerEmployeeNumber: "VIA-0001",
      _sourceRowIndex: 3,
    }),
    row({
      employeeNumber: "VIA-4001",
      workEmail: "clean.two@via.example",
      managerEmployeeNumber: "VIA-0001",
      _sourceRowIndex: 4,
    }),
    row({
      employeeNumber: "VIA-4001", // duplicate within file
      workEmail: "clean.three@via.example",
      managerEmployeeNumber: "VIA-0001",
      _sourceRowIndex: 5,
    }),
  ];

  const resolved = importService.resolveBatch(rows, employeeService);

  assert.ok(resolved[0]!.blockingErrors.some((e) => /already exists/.test(e)));
  assert.ok(resolved[1]!.blockingErrors.some((e) => /already assigned to a user/.test(e)));
  assert.equal(resolved[2]!.blockingErrors.length, 0);
  assert.ok(resolved[3]!.blockingErrors.some((e) => /duplicated within this file/.test(e)));
});

test("resolveBatch resolves a manager by existing employee number and requires one when the org is non-empty", () => {
  setup();
  const importService = new EmployeeImportService();
  const employeeService = new EmployeeService();

  const withExistingManager = row({
    employeeNumber: "VIA-5001",
    managerEmployeeNumber: "VIA-0001",
  });
  const withNoManager = row({ employeeNumber: "VIA-5002", managerEmployeeNumber: undefined });
  const withUnknownManager = row({
    employeeNumber: "VIA-5003",
    managerEmployeeNumber: "VIA-9999",
  });

  const resolved = importService.resolveBatch(
    [withExistingManager, withNoManager, withUnknownManager],
    employeeService,
  );

  const rana = employeeService.getEmployeeRepository(SYSTEM_CONTEXT).getById("employee-rana")!;
  assert.equal(resolved[0]!.lineManagerId, rana.id);
  assert.equal(resolved[0]!.blockingErrors.length, 0);

  assert.ok(
    resolved[1]!.blockingErrors.some((e) => /manager's employee number is required/i.test(e)),
  );
  assert.ok(
    resolved[2]!.blockingErrors.some((e) => /was not found among existing employees/.test(e)),
  );
});

test("resolveBatch validates department/position/location/employment type against active master data, correcting case rather than rejecting a cosmetic mismatch", () => {
  setup();
  const importService = new EmployeeImportService();
  const employeeService = new EmployeeService();

  // "operations"/"coordinator"/"full-time" differ only in case from the real active master-data
  // records ("Operations"/"Coordinator"/"Full-time") - these should be corrected, not rejected,
  // since createEmployee's own check is an exact match and HR should not have to fix a
  // spreadsheet over pure capitalization.
  const caseMismatch = row({
    employeeNumber: "VIA-8001",
    managerEmployeeNumber: "VIA-0001",
    department: "operations",
    position: "coordinator",
    employmentType: "full-time",
  });
  // A department that genuinely does not exist in master data at all must still block the row.
  const genuinelyInvalid = row({
    employeeNumber: "VIA-8002",
    managerEmployeeNumber: "VIA-0001",
    department: "Department That Does Not Exist",
  });

  const resolved = importService.resolveBatch([caseMismatch, genuinelyInvalid], employeeService);

  assert.equal(resolved[0]!.blockingErrors.length, 0);
  assert.equal(resolved[0]!.row.department, "Operations");
  assert.equal(resolved[0]!.row.position, "Coordinator");
  assert.equal(resolved[0]!.row.employmentType, "Full-time");

  assert.ok(
    resolved[1]!.blockingErrors.some((e) => /is not an active department/.test(e)),
    "expected a department with no matching master-data record at all to be rejected",
  );
});

test("commitImportBatch creates a forward-referenced manager before their report, in one pass", async () => {
  setup();
  const importService = new EmployeeImportService();
  const employeeService = new EmployeeService();
  const onboardingService = new OnboardingService();

  // The report is listed BEFORE their manager in the file - the service must still resolve it.
  const reportRow = row({
    employeeNumber: "VIA-6002",
    legalName: "Junior Report",
    workEmail: "junior.report@via.example",
    managerEmployeeNumber: "VIA-6001",
    status: "Onboarding",
  });
  const managerRow = row({
    employeeNumber: "VIA-6001",
    legalName: "New Manager",
    workEmail: "new.manager@via.example",
    managerEmployeeNumber: "VIA-0001",
  });

  const resolved = importService.resolveBatch([reportRow, managerRow], employeeService);
  const result = await importService.commitImportBatch(
    resolved,
    employeeService,
    onboardingService,
    { ...hr, reason: "test import" },
  );

  assert.equal(result.created, 2);
  assert.equal(result.skipped.length, 0);

  const created = employeeService.getEmployeeRepository(SYSTEM_CONTEXT).list();
  const report = created.find((e) => e.employeeNumber === "VIA-6002")!;
  const manager = created.find((e) => e.employeeNumber === "VIA-6001")!;
  assert.equal(report.lineManagerId, manager.id);
  assert.equal(report.status, "Onboarding");

  const cases = onboardingService
    .getCasesForContext(SYSTEM_CONTEXT)
    .filter((c) => c.employeeId === report.id);
  assert.equal(cases.length, 1);
  assert.equal(cases[0]?.status, "In Progress");
});

test("commitImportBatch skips rows with blocking errors and reports a circular manager reference", async () => {
  const { audit } = setup();
  const importService = new EmployeeImportService();
  const employeeService = new EmployeeService();
  const onboardingService = new OnboardingService();

  const duplicateNumber = row({ employeeNumber: "VIA-0001", managerEmployeeNumber: "VIA-0001" });
  const cycleA = row({
    employeeNumber: "VIA-7001",
    workEmail: "cycle.a@via.example",
    managerEmployeeNumber: "VIA-7002",
  });
  const cycleB = row({
    employeeNumber: "VIA-7002",
    workEmail: "cycle.b@via.example",
    managerEmployeeNumber: "VIA-7001",
  });

  const resolved = importService.resolveBatch([duplicateNumber, cycleA, cycleB], employeeService);
  const result = await importService.commitImportBatch(
    resolved,
    employeeService,
    onboardingService,
    { ...hr, reason: "test import" },
  );

  assert.equal(result.created, 0);
  assert.equal(result.skipped.length, 3);
  assert.ok(result.skipped.some((s) => /already exists/.test(s.reason)));
  assert.ok(result.skipped.some((s) => /circular manager reference/.test(s.reason)));

  const lastAudit = audit.list().at(-1);
  assert.equal(lastAudit?.action, "import");
  assert.equal((lastAudit?.after as { created: number })?.created, 0);
});

test("commitImportBatch rejects a non-HR actor", async () => {
  setup();
  const importService = new EmployeeImportService();
  const employeeService = new EmployeeService();
  const onboardingService = new OnboardingService();

  const resolved = importService.resolveBatch(
    [row({ managerEmployeeNumber: "VIA-0001" })],
    employeeService,
  );

  await assert.rejects(
    importService.commitImportBatch(resolved, employeeService, onboardingService, employee),
    /Only HR or a Super Admin can import employees/,
  );
});

test.after(() => configureApplicationDataServices(undefined));
