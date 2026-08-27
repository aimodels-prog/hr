import assert from "node:assert/strict";
import test from "node:test";

import {
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  can,
  canAccessPayroll,
  canManageCandidate,
  canViewEmployee,
  getEffectivePermissions,
  getRolePermissions,
  type CurrentUserContext,
  type Permission,
} from "../src/lib/auth/permissions.ts";
import {
  getScopedCandidates,
  getScopedDirectReports,
  getScopedDocuments,
  getScopedEmployees,
  getScopedEmployeesWithAncestors,
  isEmployeeInScope,
} from "../src/lib/auth/record-scope.ts";
import {
  maskValue,
  redactCandidate,
  redactEmployee,
  redactSensitiveExportField,
} from "../src/lib/auth/redaction.ts";
import { createSeedCollections } from "../src/lib/data/seeds.ts";
import { AuditService } from "../src/lib/data/audit-service.ts";
import { MemoryStorageDriver } from "../src/lib/data/storage-driver.ts";
import { VersionedStorageService } from "../src/lib/data/storage.ts";
import type { Employee, EmployeeDocument, Role } from "../src/lib/data/types.ts";
import type { Candidate } from "../src/lib/hr-data.ts";

const seeds = createSeedCollections();
const employees: Employee[] = seeds.employees;

function createTestUserContext(
  role: Role,
  userId: string,
  employeeId?: string,
): CurrentUserContext {
  const permissions = getRolePermissions(role);
  return {
    userId,
    employeeId,
    displayName: `Test ${role}`,
    workspaceEmail: `test.${role.toLowerCase().replace(/\s+/g, "")}@via.example`,
    assignedRoles: [role],
    activeRole: role,
    permissions,
    isDevelopmentPreview: true,
  };
}

const employeeCtx = createTestUserContext("Employee", "user-omar", "employee-omar");
const managerCtx = createTestUserContext("Line Manager", "user-layla", "employee-layla");
const hrCtx = createTestUserContext("HR", "user-rana", "employee-rana");
const accountsCtx = createTestUserContext("Accounts", "user-mariam", "employee-mariam");
const adminCtx = createTestUserContext("Super Admin", "user-super-admin", "employee-yusuf");

test("role permissions enforce strict boundaries for all 5 roles", () => {
  // 1. Super Admin has all permissions
  const adminPermissions = getRolePermissions("Super Admin");
  assert.equal(adminPermissions.size, ALL_PERMISSIONS.length);
  for (const p of ALL_PERMISSIONS) {
    assert.equal(can(p, adminCtx), true, `Super Admin must have permission: ${p}`);
  }

  // 2. HR cannot access payroll preparation
  assert.equal(can("payroll:view", hrCtx), false);
  assert.equal(can("payroll:prepare", hrCtx), false);
  assert.equal(canAccessPayroll(hrCtx), false);
  assert.equal(can("system:users_manage", hrCtx), true);
  assert.equal(can("system:users_manage", employeeCtx), false);

  // 3. Accounts cannot view private recruitment notes or manage candidates
  assert.equal(can("recruitment:view_notes_private", accountsCtx), false);
  assert.equal(can("recruitment:manage_candidates", accountsCtx), false);
  assert.equal(canManageCandidate(undefined, accountsCtx), false);
  assert.equal(can("attendance:manage_all", accountsCtx), false);
  assert.equal(can("attendance:site_visit_approve", accountsCtx), false);

  // 4. Accounts can access payroll
  assert.equal(can("payroll:view", accountsCtx), true);
  assert.equal(can("payroll:prepare", accountsCtx), true);
  assert.equal(canAccessPayroll(accountsCtx), true);

  // 5. Line Manager has direct report permissions and interview view
  assert.equal(can("employee:view_direct_reports", managerCtx), true);
  assert.equal(can("recruitment:view_interviews", managerCtx), true);
  assert.equal(can("payroll:view", managerCtx), false);
  assert.equal(can("recruitment:manage_candidates", managerCtx), false);
  assert.equal(can("attendance:approve_direct_reports", managerCtx), true);
  assert.equal(can("attendance:manage_all", managerCtx), false);

  // 6. Regular Employee can only view self and directory
  assert.equal(can("employee:view_self", employeeCtx), true);
  assert.equal(can("employee:view_directory", employeeCtx), true);
  assert.equal(can("employee:view_direct_reports", employeeCtx), false);
  assert.equal(can("recruitment:view_candidates", employeeCtx), false);
  assert.equal(can("payroll:view", employeeCtx), false);
  assert.equal(can("attendance:clock_self", employeeCtx), true);
  assert.equal(can("attendance:approve_direct_reports", employeeCtx), false);
  assert.equal(can("attendance:site_visit_approve", employeeCtx), false);
});

test("union of assigned roles combines permissions correctly", () => {
  const hybrid = getEffectivePermissions(["Employee", "Line Manager"]);
  assert.equal(hybrid.has("employee:view_self"), true);
  assert.equal(hybrid.has("employee:view_direct_reports"), true);
  assert.equal(hybrid.has("recruitment:view_interviews"), true);
  assert.equal(hybrid.has("payroll:view"), false);
});

test("record-scope selector getScopedEmployees restricts employee access by role", () => {
  // Super Admin sees all 7 employees
  const adminEmployees = getScopedEmployees(employees, adminCtx);
  assert.equal(adminEmployees.length, 7);

  // HR sees all 7 employees
  const hrEmployees = getScopedEmployees(employees, hrCtx);
  assert.equal(hrEmployees.length, 7);

  // Line Manager (Layla) sees self + direct reports (Omar, Tariq) = 3 employees
  const managerEmployees = getScopedEmployees(employees, managerCtx);
  assert.equal(managerEmployees.length, 3);
  const managerIds = managerEmployees.map((e) => e.id);
  assert.deepEqual(managerIds.sort(), ["employee-layla", "employee-omar", "employee-tariq"].sort());

  // Employee (Omar) sees only self = 1 employee
  const employeeScoped = getScopedEmployees(employees, employeeCtx);
  assert.equal(employeeScoped.length, 1);
  assert.equal(employeeScoped[0]?.id, "employee-omar");

  // Accounts (Mariam) sees only self in employee scope
  const accountsEmployees = getScopedEmployees(employees, accountsCtx);
  assert.equal(accountsEmployees.length, 1);
  assert.equal(accountsEmployees[0]?.id, "employee-mariam");
});

function fakeDocument(employeeId: string, id: string): EmployeeDocument {
  return {
    id,
    employeeId,
    type: "national_id",
    fileId: `file-${id}`,
    visibility: "Restricted",
    status: "Pending Verification",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "seed",
    updatedAt: "2026-01-01T00:00:00.000Z",
    updatedBy: "seed",
    recordVersion: 1,
  };
}

test("record-scope selector getScopedDocuments restricts document access to the same employees getScopedEmployees would allow", () => {
  const documents: EmployeeDocument[] = [
    fakeDocument("employee-rana", "doc-rana"),
    fakeDocument("employee-layla", "doc-layla"),
    fakeDocument("employee-omar", "doc-omar"),
    fakeDocument("employee-tariq", "doc-tariq"),
    fakeDocument("employee-mariam", "doc-mariam"),
  ];

  // Super Admin and HR see every document.
  assert.equal(getScopedDocuments(documents, employees, adminCtx).length, 5);
  assert.equal(getScopedDocuments(documents, employees, hrCtx).length, 5);

  // Line Manager (Layla) sees self + direct reports' documents (Omar, Tariq) = 3.
  const managerDocs = getScopedDocuments(documents, employees, managerCtx);
  assert.deepEqual(
    managerDocs.map((d) => d.id).sort(),
    ["doc-layla", "doc-omar", "doc-tariq"].sort(),
  );

  // Employee (Omar) sees only their own document.
  const employeeDocs = getScopedDocuments(documents, employees, employeeCtx);
  assert.deepEqual(employeeDocs.map((d) => d.id), ["doc-omar"]);

  // A document belonging to an employee outside scope never leaks through, even if it
  // exists in the underlying collection passed in.
  assert.equal(
    getScopedDocuments(documents, employees, employeeCtx).some((d) => d.employeeId !== "employee-omar"),
    false,
  );
});

test("getScopedEmployeesWithAncestors extends the scoped set with the management chain above it", () => {
  // Real hierarchy: yusuf (top) <- rana, layla, mariam <- omar, tariq (under layla), aisha (under rana)

  // HR/Super Admin already see everyone - ancestors add nothing new.
  assert.equal(getScopedEmployeesWithAncestors(employees, hrCtx).length, 7);
  assert.equal(getScopedEmployeesWithAncestors(employees, adminCtx).length, 7);

  // Line Manager (Layla): self + direct reports (Omar, Tariq), plus Layla's own manager (Yusuf).
  const managerResult = getScopedEmployeesWithAncestors(employees, managerCtx);
  assert.deepEqual(
    managerResult.map((e) => e.id).sort(),
    ["employee-layla", "employee-omar", "employee-tariq", "employee-yusuf"].sort(),
  );

  // Employee (Omar): self, plus the full chain above (Layla, then Yusuf) - never a sibling like Tariq.
  const employeeResult = getScopedEmployeesWithAncestors(employees, employeeCtx);
  assert.deepEqual(
    employeeResult.map((e) => e.id).sort(),
    ["employee-omar", "employee-layla", "employee-yusuf"].sort(),
  );
  assert.equal(
    employeeResult.some((e) => e.id === "employee-tariq"),
    false,
  );
});

test("isEmployeeInScope verifies single employee record access rules", () => {
  const omar = employees.find((e) => e.id === "employee-omar")!;
  const layla = employees.find((e) => e.id === "employee-layla")!;
  const rana = employees.find((e) => e.id === "employee-rana")!;

  // Employee (Omar) can access self, but cannot access Layla or Rana
  assert.equal(isEmployeeInScope(omar, employeeCtx), true);
  assert.equal(isEmployeeInScope(layla, employeeCtx), false);
  assert.equal(isEmployeeInScope(rana, employeeCtx), false);

  // Line Manager (Layla) can access direct report Omar and self Layla, but not peer Rana
  assert.equal(isEmployeeInScope(omar, managerCtx), true);
  assert.equal(isEmployeeInScope(layla, managerCtx), true);
  assert.equal(isEmployeeInScope(rana, managerCtx), false);

  // Super Admin can access all
  assert.equal(isEmployeeInScope(omar, adminCtx), true);
  assert.equal(isEmployeeInScope(layla, adminCtx), true);
  assert.equal(isEmployeeInScope(rana, adminCtx), true);
});

test("getScopedDirectReports returns exact manager direct reports", () => {
  const laylaReports = getScopedDirectReports(employees, "employee-layla");
  assert.equal(laylaReports.length, 2);
  assert.deepEqual(
    laylaReports.map((e) => e.id).sort(),
    ["employee-omar", "employee-tariq"].sort(),
  );

  const ranaReports = getScopedDirectReports(employees, "employee-rana");
  assert.equal(ranaReports.length, 1);
  assert.equal(ranaReports[0]?.id, "employee-aisha");
});

test("field-level redaction redacts employee sensitive fields by permission", () => {
  const omar = employees.find((e) => e.id === "employee-omar")!;

  // 1. Employee Omar viewing own record -> all personal fields visible
  const omarViewingSelf = redactEmployee(omar, employeeCtx);
  assert.notEqual(omarViewingSelf.salary, undefined);
  assert.notEqual(omarViewingSelf.bankDetails, undefined);
  assert.notEqual(omarViewingSelf.nationalId, undefined);
  assert.notEqual(omarViewingSelf.passportNumber, undefined);

  // 2. Layla (Line Manager) viewing Omar -> sees performance notes, but NOT salary, bank, or passport
  const laylaViewingOmar = redactEmployee(omar, managerCtx);
  assert.equal(laylaViewingOmar.salary, undefined);
  assert.equal(laylaViewingOmar.bankDetails, undefined);
  assert.equal(laylaViewingOmar.passportNumber, undefined);
  assert.equal(laylaViewingOmar.nationalId, undefined);
  assert.equal(laylaViewingOmar.performanceNotes, omar.performanceNotes);

  // 3. Accounts (Mariam) viewing Omar -> sees salary and bank details for payroll, but NOT performance notes or passport
  const mariamViewingOmar = redactEmployee(omar, accountsCtx);
  assert.notEqual(mariamViewingOmar.salary, undefined);
  assert.notEqual(mariamViewingOmar.bankDetails, undefined);
  assert.equal(mariamViewingOmar.performanceNotes, undefined);
  assert.equal(mariamViewingOmar.passportNumber, undefined);
  assert.equal(mariamViewingOmar.nationalId, undefined);

  // 4. HR (Rana) viewing Omar -> sees performance notes, national ID, passport, but NOT raw bank details or unapproved salary
  const ranaViewingOmar = redactEmployee(omar, hrCtx);
  assert.equal(ranaViewingOmar.bankDetails, undefined);
  assert.equal(ranaViewingOmar.salary, undefined);
  assert.equal(ranaViewingOmar.performanceNotes, omar.performanceNotes);
  assert.equal(ranaViewingOmar.nationalId, omar.nationalId);
  assert.equal(ranaViewingOmar.passportNumber, omar.passportNumber);

  // 5. Super Admin viewing Omar -> all fields preserved
  const adminViewingOmar = redactEmployee(omar, adminCtx);
  assert.deepEqual(adminViewingOmar, omar);
});

test("candidate field-level redaction hides private notes from Accounts and Employee", () => {
  const sampleCandidate: Candidate = {
    id: "c-test",
    name: "Test Candidate",
    title: "Engineer",
    location: "Muscat",
    years: 5,
    source: "Database",
    score: 90,
    stage: "Interview",
    email: "test@candidate.example",
    skills: ["Logistics"],
    reasons: ["Top fit"],
    risks: [],
    salaryExpectation: 2500,
    privateNotes: "Highly sensitive internal salary negotiation notes.",
  };

  // Accounts sees no private recruitment notes
  const accountsRedacted = redactCandidate(sampleCandidate, accountsCtx);
  assert.equal(accountsRedacted.privateNotes, undefined);

  // Employee sees no private recruitment notes
  const employeeRedacted = redactCandidate(sampleCandidate, employeeCtx);
  assert.equal(employeeRedacted.privateNotes, undefined);
  assert.equal(employeeRedacted.salaryExpectation, undefined);

  // HR sees private recruitment notes
  const hrRedacted = redactCandidate(sampleCandidate, hrCtx);
  assert.equal(hrRedacted.privateNotes, "Highly sensitive internal salary negotiation notes.");
  assert.equal(hrRedacted.salaryExpectation, 2500);

  // Super Admin sees private recruitment notes
  const adminRedacted = redactCandidate(sampleCandidate, adminCtx);
  assert.equal(adminRedacted.privateNotes, "Highly sensitive internal salary negotiation notes.");
});

test("maskValue helper produces clean masked placeholders", () => {
  assert.equal(maskValue("12345678"), "••••••••");
  assert.equal(maskValue(undefined), "••••••••");
  assert.equal(maskValue("1234567890"), "••••••••••");
});

test("redactSensitiveExportField gates bulk/export field values by the same passport permission rule as redactEmployee", () => {
  const omar = employees.find((e) => e.id === "employee-omar")!;

  // Omar viewing his own row in an export -> real passport/national ID pass through
  assert.equal(
    redactSensitiveExportField(omar.passportNumber, "passport", omar, employeeCtx),
    omar.passportNumber,
  );

  // Layla (Line Manager) exporting a row that isn't her own -> masked, not blank and not raw
  const laylaExport = redactSensitiveExportField(omar.passportNumber, "passport", omar, managerCtx);
  assert.notEqual(laylaExport, omar.passportNumber);
  assert.equal(laylaExport, maskValue(omar.passportNumber));

  // HR exporting any row -> real value (matches redactEmployee's existing HR bypass)
  assert.equal(
    redactSensitiveExportField(omar.nationalId, "passport", omar, hrCtx),
    omar.nationalId,
  );

  // Super Admin exporting any row -> real value
  assert.equal(
    redactSensitiveExportField(omar.passportNumber, "passport", omar, adminCtx),
    omar.passportNumber,
  );

  // Accounts exporting someone else's row -> masked (Accounts has no passport visibility)
  assert.equal(
    redactSensitiveExportField(omar.passportNumber, "passport", omar, accountsCtx),
    maskValue(omar.passportNumber),
  );

  // A field with no value in the first place stays an empty string regardless of permission
  assert.equal(redactSensitiveExportField(undefined, "passport", omar, hrCtx), "");
  assert.equal(redactSensitiveExportField("", "passport", omar, adminCtx), "");
});

test("audit service records identity change and access denied events with actor context", () => {
  const driver = new MemoryStorageDriver();
  const storage = new VersionedStorageService(driver, { now: () => "2026-08-16T12:00:00.000Z" });
  storage.initialize();
  const audit = new AuditService(storage, {
    now: () => "2026-08-16T12:00:00.000Z",
    createId: (() => {
      let i = 0;
      return () => `audit-test-${++i}`;
    })(),
  });

  // Record identity switch
  audit.record({
    context: {
      actor: {
        userId: "user-omar",
        displayName: "Omar Rahman",
        activeRole: "Employee",
        roles: ["Employee"],
      },
    },
    action: "preview_identity_change",
    module: "development-preview",
    entityType: "dev-preview-identity",
    entityId: "user-omar",
    reason: "Development role preview switched to Omar Rahman (Employee)",
    riskLevel: "Low",
  });

  // Record access denied
  audit.record({
    context: {
      actor: {
        userId: "user-omar",
        displayName: "Omar Rahman",
        activeRole: "Employee",
        roles: ["Employee"],
      },
    },
    action: "access_denied",
    module: "security",
    entityType: "route_guard",
    entityId: "/staff/candidates",
    reason:
      "Access denied to Candidate Database & Scoring. Required: recruitment:view_candidates. Active role: Employee",
    riskLevel: "Medium",
  });

  const events = audit.list();
  assert.equal(events.length, 2);
  assert.equal(events[0]?.action, "preview_identity_change");
  assert.equal(events[0]?.module, "development-preview");
  assert.equal(events[0]?.actor.activeRole, "Employee");
  assert.equal(events[1]?.action, "access_denied");
  assert.equal(events[1]?.module, "security");
  assert.equal(events[1]?.riskLevel, "Medium");
});
