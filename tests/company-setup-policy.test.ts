import assert from "node:assert/strict";
import test from "node:test";
import { getRolePermissions } from "../src/lib/auth/permissions.ts";
import {
  HR_MASTER_COLLECTIONS,
  HR_COMPANY_SETTINGS_KEYS,
  HR_SETUP_SECTIONS,
  canManageMasterCollection,
  canManageProjects,
  canChangeCompanySettings,
  canViewCompanySetupSection,
} from "../src/lib/auth/company-setup-policy.ts";

test("HR can maintain business setup without system administration privileges", () => {
  assert.equal(getRolePermissions("HR").has("system:settings_manage"), false);
  for (const collection of HR_MASTER_COLLECTIONS)
    assert.equal(canManageMasterCollection(["Employee", "HR"], collection), true, collection);
  for (const section of HR_SETUP_SECTIONS)
    assert.equal(canViewCompanySetupSection("HR", section), true, section);
  assert.equal(canManageProjects(["HR"]), true);
  assert.equal(canChangeCompanySettings(["HR"], HR_COMPANY_SETTINGS_KEYS), true);
  assert.equal(canChangeCompanySettings(["HR"], []), true);
});

test("HR cannot alter finance references, numbering or recovery", () => {
  for (const collection of ["costCentres", "activityCodes", "currencies"] as const)
    assert.equal(canManageMasterCollection(["HR"], collection), false, collection);
  for (const section of ["costCentres", "activityCodes", "currencies", "numbering", "data"])
    assert.equal(canViewCompanySetupSection("HR", section), false, section);
  for (const key of [
    "baseCurrency",
    "employeeNumberFormat",
    "candidateReferenceFormat",
    "unknownField",
  ]) {
    assert.equal(canChangeCompanySettings(["HR"], [key]), false, key);
    assert.equal(canChangeCompanySettings(["HR"], ["organisationName", key]), false, key);
  }
});

test("employee, manager, Finance, IT and travel administration cannot edit company setup", () => {
  for (const role of ["Employee", "Line Manager", "Accounts", "IT", "Travel Admin"] as const) {
    assert.equal(canManageProjects([role]), false, role);
    for (const collection of HR_MASTER_COLLECTIONS)
      assert.equal(canManageMasterCollection([role], collection), false);
    for (const section of HR_SETUP_SECTIONS)
      assert.equal(canViewCompanySetupSection(role, section), false);
    assert.equal(canChangeCompanySettings([role], ["organisationName"]), false);
    assert.equal(canChangeCompanySettings([role], []), false);
  }
});

test("Super Admin retains protected setup access", () => {
  assert.equal(canManageMasterCollection(["Super Admin"], "currencies"), true);
  assert.equal(canManageProjects(["Super Admin"]), true);
  assert.equal(
    canChangeCompanySettings(["Super Admin"], ["employeeNumberFormat", "baseCurrency"]),
    true,
  );
  assert.equal(canViewCompanySetupSection("Super Admin", "data"), true);
});
