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
  test(role + " has unique destinations and an appropriately scoped workspace", () => {
    const groups = navigation(role);
    const urls = groups.flatMap((group) => group.items.map((item) => item.url));
    assert.equal(new Set(urls).size, urls.length);
    if (["HR", "Super Admin"].includes(role)) {
      assert.ok(!groups.some((group) => group.label.startsWith("My ")));
      assert.ok(urls.includes("/staff/employees"));
    } else {
      const personal = groups.find((group) => group.label === "My Details")!;
      assert.ok(personal.items.some((item) => item.url === "/staff/me/profile"));
      assert.ok(personal.items.some((item) => item.url === "/staff/payslips"));
      assert.ok(urls.includes("/staff/me/timesheets"));
      assert.ok(urls.includes("/staff/interviews"), "Assigned interview work remains accessible");
    }
    assert.equal(urls.filter((url) => url === "/staff/requests").length, 1);
  });
}

test("HR pages have clear functional homes and no finance or system-settings escalation", () => {
  const groups = navigation("HR");
  const home = (url: string) =>
    groups.find((group) => group.items.some((item) => item.url === url))?.label;
  assert.equal(home("/staff/employees"), "Employees");
  assert.equal(home("/staff/leave-admin"), "Time & Leave");
  assert.equal(home("/staff/requests"), "Home");
  assert.equal(activeNavigationUrl(groups, "/staff/leave-approvals"), "/staff/requests");
  assert.equal(home("/staff/offers"), "Recruitment");
  assert.equal(home("/staff/files"), "Documents");
  assert.equal(home("/staff/leave-policies"), "Settings");
  assert.equal(home("/staff/reports"), "Reports");
  assert.equal(home("/staff/settings"), "Settings");
  assert.equal(home("/staff/payroll/periods"), undefined);
  assert.equal(home("/staff/time-away"), "Time & Leave");
  assert.ok(!groups.some((group) => group.label === "Administration"));
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
      .some((item) => item.url === "/staff/settings?section=departments"),
  );
  assert.equal(searchNavigation(navigation("Employee"), "payroll").length, 0);
  assert.equal(searchNavigation(navigation("Employee"), "audit").length, 0);
  assert.equal(searchNavigation(navigation("HR"), "unrecognisedxyz").length, 0);
});

test("active destination is unique for nested paths and approval shortcuts", () => {
  const groups = navigation("HR");
  assert.equal(activeNavigationUrl(groups, "/staff/candidates/intake"), "/staff/candidates/intake");
  assert.equal(activeNavigationUrl(groups, "/staff/candidates/123"), "/staff/candidates");
  assert.equal(
    activeNavigationUrl(navigation("Employee"), "/staff/me/attendance?action=site-visit"),
    "/staff/me/attendance",
  );
  assert.equal(
    activeNavigationUrl(navigation("Employee"), "/staff/me/attendance"),
    "/staff/me/attendance",
  );
  assert.equal(activeNavigationUrl(groups, "/staff/attendance/corrections"), "/staff/requests");
  assert.equal(
    activeNavigationUrl(groups, "/staff/settings?section=departments"),
    "/staff/settings",
  );
  assert.equal(activeNavigationUrl(groups, "/staff"), "/staff");
  assert.equal(
    activeNavigationUrl(navigation("Employee"), "/staff/timesheets"),
    "/staff/me/timesheets",
  );
});

test("familiar employee searches go directly to the right action", () => {
  const searches = [
    ["upload passport", "/staff/me/profile#section=documents"],
    ["insurance card", "/staff/me/profile#section=documents"],
    ["family", "/staff/me/profile#section=dependants"],
    ["equipment", "/staff/me/profile#section=equipment"],
    ["apply leave", "/staff/me/leave-balances"],
    ["my requests", "/staff/requests"],
    ["quick visit", "/staff/me/attendance?action=site-visit"],
  ];
  for (const [query, url] of searches)
    assert.ok(
      searchNavigation(navigation("Employee"), query!)
        .flatMap((group) => group.items)
        .some((item) => item.url === url),
      query,
    );
});

test("HR searches include setup, recruiting and approval actions without protected administration", () => {
  for (const [query, url] of [
    ["add department", "/staff/settings?section=departments"],
    ["add position", "/staff/settings?section=positions"],
    ["add project", "/staff/settings?section=projects"],
    ["work location", "/staff/settings?section=locations"],
    ["calendar", "/staff/settings?section=connections"],
    ["add job", "/staff/vacancies/new"],
    ["approve timesheet", "/staff/requests?view=approvals"],
    ["equipment", "/staff/employees"],
  ])
    assert.ok(
      searchNavigation(navigation("HR"), query!)
        .flatMap((group) => group.items)
        .some((item) => item.url === url),
      query,
    );
  for (const query of ["backup", "recovery", "cost centres", "currencies", "employee numbering"]) {
    assert.equal(searchNavigation(navigation("HR"), query).length, 0, query);
  }
  for (const query of [
    "add department",
    "add project",
    "approve timesheet",
    "calendar connection",
  ]) {
    assert.equal(searchNavigation(navigation("Employee"), query).length, 0, query);
  }
});
