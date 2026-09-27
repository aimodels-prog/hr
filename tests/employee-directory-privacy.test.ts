import assert from "node:assert/strict";
import test from "node:test";

import { getRolePermissions, type CurrentUserContext } from "../src/lib/auth/permissions.ts";
import { redactEmployee } from "../src/lib/auth/redaction.ts";
import { createSeedCollections } from "../src/lib/data/seeds.ts";
import { ROLE_VALUES, type Employee, type Role } from "../src/lib/data/types.ts";

const employee: Employee = {
  ...createSeedCollections().employees[0]!,
  id: "private-employee",
  lineManagerId: "manager",
  phone: "+000000000",
  employmentReviewNote: "PRIVATE_HR_REVIEW",
  terminationReason: "PRIVATE_EXIT_REASON",
  proposedLineManagerEmail: "proposed.manager@via.example",
  employmentConfirmedBy: "private-reviewer",
  visaRequired: true,
  candidateId: "private-candidate",
  offerId: "private-offer",
  proposedEmploymentDetails: {
    legalName: "Proposed Employee",
    preferredName: "Proposed",
    staffEntryType: "New Employee",
    startDate: "2026-01-01",
    departmentId: "private-department",
    positionId: "private-position",
    locationId: "private-location",
    employmentTypeId: "private-type",
    lineManagerId: "manager",
    lineManagerEmail: "proposed.manager@via.example",
    visaRequired: true,
  },
  performanceNotes: "PRIVATE_PERFORMANCE",
  salary: { baseMonthly: 1000, currency: "OMR" },
  bankDetails: { bankName: "Example", accountNumber: "PRIVATE_ACCOUNT", iban: "PRIVATE_IBAN" },
  socialInsuranceNumber: "PRIVATE_INSURANCE",
};

function viewer(role: Role, employeeId = "colleague"): CurrentUserContext {
  return {
    userId: `user-${employeeId}`,
    employeeId,
    displayName: "Privacy test",
    workspaceEmail: "privacy@via.example",
    assignedRoles: [role],
    activeRole: role,
    permissions: getRolePermissions(role),
  };
}

const privatePersonnelFields = [
  "employmentReviewNote",
  "terminationReason",
  "proposedEmploymentDetails",
  "proposedLineManagerEmail",
  "employmentConfirmedBy",
  "visaRequired",
  "candidateId",
  "offerId",
] as const;

test("colleague responses omit confidential HR fields for Employee, IT, Finance and managers", () => {
  for (const role of ["Employee", "IT", "Accounts", "Line Manager"] as const) {
    for (const viewerId of ["colleague", "manager"]) {
      const result = redactEmployee(employee, viewer(role, viewerId));
      const wire = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
      for (const key of privatePersonnelFields) {
        assert.equal(
          Object.hasOwn(wire, key),
          false,
          `${role}/${viewerId} must not receive ${key}`,
        );
      }
      for (const key of [
        "legalName",
        "preferredName",
        "workEmail",
        "phone",
        "position",
        "department",
        "location",
      ] as const) {
        assert.equal(
          result[key],
          employee[key],
          `Directory contact field ${key} must remain usable`,
        );
      }
    }
  }
});

test("every role retains its own personnel file and HR retains its authorised employee view", () => {
  const contexts = [
    ...ROLE_VALUES.map((role) => viewer(role, employee.id)),
    viewer("HR"),
    viewer("Super Admin"),
  ];
  for (const context of contexts) {
    const result = redactEmployee(employee, context);
    for (const key of privatePersonnelFields) {
      assert.deepEqual(result[key], employee[key], `${context.activeRole} lost authorised ${key}`);
    }
  }
});

test("Finance and manager projections preserve only their specialist confidential fields", () => {
  const finance = redactEmployee(employee, viewer("Accounts"));
  assert.deepEqual(finance.salary, employee.salary);
  assert.deepEqual(finance.bankDetails, employee.bankDetails);
  assert.equal(finance.socialInsuranceNumber, employee.socialInsuranceNumber);
  assert.equal(finance.performanceNotes, undefined);

  const hr = redactEmployee(employee, viewer("HR"));
  assert.equal(hr.salary, undefined);
  assert.equal(hr.bankDetails, undefined);
  assert.equal(hr.socialInsuranceNumber, undefined);

  const manager = redactEmployee(employee, viewer("Line Manager", "manager"));
  assert.equal(manager.performanceNotes, employee.performanceNotes);
  assert.equal(manager.salary, undefined);
  assert.equal(manager.bankDetails, undefined);
  assert.equal(redactEmployee(employee, viewer("Line Manager")).performanceNotes, undefined);
});

test("assigned elevated roles do not leak personnel data while Employee is the active role", () => {
  const context = viewer("Employee");
  context.assignedRoles = [...ROLE_VALUES];
  const result = redactEmployee(employee, context);
  for (const key of privatePersonnelFields) assert.equal(result[key], undefined);
  assert.equal(result.salary, undefined);
  assert.equal(result.performanceNotes, undefined);
});

test("unknown runtime fields fail closed, and projection does not mutate the source record", () => {
  const source = { ...employee, futureConfidentialField: "DO_NOT_DISCLOSE" };
  const before = structuredClone(source);
  for (const role of ROLE_VALUES) {
    const result = redactEmployee(source, viewer(role));
    assert.equal(Object.hasOwn(result, "futureConfidentialField"), false);
    assert.deepEqual(source, before);
  }
  const anonymous = redactEmployee(source, null);
  for (const key of privatePersonnelFields) assert.equal(anonymous[key], undefined);
  assert.equal(Object.hasOwn(anonymous, "futureConfidentialField"), false);
  assert.equal(anonymous.phone, undefined);
  assert.deepEqual(anonymous.emergencyContacts, []);
  assert.deepEqual(anonymous.dependants, []);
  assert.deepEqual(source, before);
});
