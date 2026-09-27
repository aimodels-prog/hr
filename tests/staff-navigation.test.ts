import assert from "node:assert/strict";
import test from "node:test";
import { getRolePermissions, ROLE_PERMISSIONS } from "../src/lib/auth/permissions.ts";
import {
  activeNavigationUrl,
  searchNavigation,
  staffNavigation,
} from "../src/lib/navigation/staff-navigation.ts";
import type { Role } from "../src/lib/data/types.ts";

function navigation(role: Role) {
  const permissions = getRolePermissions(role);
  return staffNavigation(role, (permission) => permissions.has(permission));
}

for (const role of Object.keys(ROLE_PERMISSIONS) as Role[]) {
  test(role + " has unique destinations and a personal workspace", () => {
    const groups = navigation(role);
    const urls = groups.flatMap((group) => group.items.map((item) => item.url));
    assert.equal(new Set(urls).size, urls.length);
    const personal = groups.find((group) => group.label === "My Workspace")!;
    assert.ok(personal.items.some((item) => item.url === "/staff/me/profile"));
    assert.ok(personal.items.some((item) => item.url === "/staff/payslips"));
    assert.equal(urls.filter((url) => url === "/staff/offers").length, 1);
  });
}

test("HR pages have clear functional homes and no finance or system-settings escalation", () => {
  const groups = navigation("HR");
  const home = (url: string) =>
    groups.find((group) => group.items.some((item) => item.url === url))?.label;
  assert.equal(home("/staff/employees"), "Employees");
  assert.equal(home("/staff/leave-admin"), "Time & Leave");
  assert.equal(home("/staff/leave-approvals"), "Approvals");
  assert.equal(home("/staff/offers"), "Recruitment");
  assert.equal(home("/staff/files"), "Documents");
  assert.equal(home("/staff/leave-policies"), "HR Settings");
  assert.equal(home("/staff/reports"), "Reports");
  assert.equal(home("/staff/settings"), undefined);
  assert.equal(home("/staff/payroll/periods"), undefined);
});

test("menu search finds familiar words but never reveals an inaccessible page", () => {
  assert.ok(
    searchNavigation(navigation("HR"), "visa")
      .flatMap((group) => group.items)
      .some((item) => item.url === "/staff/document-expiry"),
  );
  assert.ok(
    searchNavigation(navigation("HR"), "leave balance")
      .flatMap((group) => group.items)
      .some((item) => item.url === "/staff/leave-admin"),
  );
  assert.ok(
    searchNavigation(navigation("Super Admin"), "department")
      .flatMap((group) => group.items)
      .some((item) => item.url === "/staff/settings"),
  );
  assert.equal(searchNavigation(navigation("Employee"), "payroll").length, 0);
  assert.equal(searchNavigation(navigation("Employee"), "audit").length, 0);
  assert.equal(searchNavigation(navigation("HR"), "unrecognisedxyz").length, 0);
});

test("active destination is unique for nested paths and quick-visit actions", () => {
  const groups = navigation("Super Admin");
  assert.equal(activeNavigationUrl(groups, "/staff/candidates/intake"), "/staff/candidates/intake");
  assert.equal(activeNavigationUrl(groups, "/staff/candidates/123"), "/staff/candidates");
  assert.equal(
    activeNavigationUrl(groups, "/staff/me/attendance?action=site-visit"),
    "/staff/me/attendance?action=site-visit",
  );
  assert.equal(activeNavigationUrl(groups, "/staff/me/attendance"), "/staff/me/attendance");
  assert.equal(
    activeNavigationUrl(groups, "/staff/attendance/corrections"),
    "/staff/attendance/corrections",
  );
  assert.equal(
    activeNavigationUrl(groups, "/staff/settings?section=departments"),
    "/staff/settings",
  );
  assert.equal(activeNavigationUrl(groups, "/staff"), "/staff");
});
