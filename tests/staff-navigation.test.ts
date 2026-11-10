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
      assert.ok(urls.includes("/staff/interviews"), "Assigned interview work remains visible");
    }
    assert.equal(
      urls.filter(
        (url) =>
          url ===
          (role === "HR"
            ? "/staff/requests?view=approvals"
            : role === "Super Admin"
              ? "/staff/requests?view=organisation"
              : "/staff/requests"),
      ).length,
      1,
    );
  });
}

test("HR pages have clear functional homes and no finance or system-settings escalation", () => {
  const groups = navigation("HR");
  const home = (url: string) =>
    groups.find((group) => group.items.some((item) => item.url === url))?.label;
  assert.equal(home("/staff/employees"), "Employees");
  assert.equal(home("/staff/leave-admin"), "Time & Leave");
  assert.equal(home("/staff/attendance#section=site-visits"), "Time & Leave");
  assert.equal(home("/staff/requests?view=approvals"), "HR");
  assert.equal(home("/staff/requests?view=organisation"), "HR");
  assert.equal(home("/staff/requests?view=my"), "HR");
  assert.equal(activeNavigationUrl(groups, "/staff/requests?view=my"), "/staff/requests?view=my");
  assert.equal(
    activeNavigationUrl(groups, "/staff/leave-approvals"),
    "/staff/requests?view=approvals",
  );
  assert.equal(home("/staff/offers"), "Recruitment");
  assert.equal(home("/staff/files"), "Documents");
  assert.equal(home("/staff/leave-policies"), "Settings");
  assert.equal(home("/staff/reports"), "Reports");
  assert.equal(home("/staff/settings"), "Settings");
  assert.equal(home("/staff/payroll/periods"), undefined);
  assert.ok(
    !navigation("Super Admin")
      .flatMap((group) => group.items)
      .some((item) => item.url === "/staff/attendance#section=site-visits"),
  );
  assert.equal(home("/staff/time-away"), "Time & Leave");
  assert.ok(!groups.some((group) => group.label === "Administration"));
});

test("personal menus show Time Away and other original items directly", () => {
  for (const role of ["Employee", "IT", "Travel Admin", "Line Manager", "Accounts"] as const) {
    const groups = navigation(role);
    const items = groups.flatMap((group) => group.items);
    for (const url of [
      "/staff/me/leave-balances",
      "/staff/me/timesheets",
      "/staff/me/attendance",
      "/staff/me/profile",
      "/staff/payslips",
      "/staff/time-away",
      "/staff/me/overtime",
      "/staff/me/onboarding",
      "/staff/interviews",
      "/staff/org-chart",
    ])
      assert.ok(
        items.some((item) => item.url === url),
        `${role}: ${url} should be visible in the sidebar`,
      );
    assert.equal(items.find((item) => item.url === "/staff/time-away")?.title, "Time Away");
    assert.equal(activeNavigationUrl(groups, "/staff/time-away"), "/staff/time-away");
    assert.equal(
      items.find((item) => item.url === "/staff/me/attendance")?.shortcuts?.[0]?.url,
      "/staff/me/attendance?action=site-visit",
      `${role}: Quick visit was already an attendance shortcut`,
    );
  }
});

test("non-HR roles keep the original Approvals entry in Home", () => {
  for (const role of ["Line Manager", "Accounts", "IT", "Travel Admin"] as const) {
    const groups = navigation(role);
    const home = groups.find((group) => group.label === "Home")!;
    assert.equal(home.items.find((item) => item.url === "/staff/requests")?.title, "Approvals");
    assert.ok(!home.items.some((item) => item.url === "/staff/requests?view=my"));
  }
});

test("Travel Admin keeps the original travel link in My Work", () => {
  const groups = navigation("Travel Admin");
  const myWork = groups.find((group) => group.label === "My Work")!;
  assert.equal(
    myWork.items.find((item) => item.url === "/staff/travel")?.title,
    "Travel & bookings",
  );
  assert.ok(
    !groups
      .find((group) => group.label === "Home")
      ?.items.some((item) => item.url === "/staff/travel"),
  );
});

test("HR keeps original visible sections and labels", () => {
  const groups = navigation("HR");
  const mainGroups = groups.filter((group) => group.label !== "Support");
  assert.deepEqual(
    mainGroups.map((group) => group.label),
    [
      "Home",
      "HR",
      "Employees",
      "Time & Leave",
      "Recruitment",
      "Performance & Training",
      "Documents",
      "Reports",
      "Settings",
    ],
  );
  const items = groups.flatMap((group) => group.items);
  for (const url of [
    "/staff/org-chart",
    "/staff/anniversaries",
    "/staff/offboarding",
    "/staff/time-away",
    "/staff/candidates/contacts",
    "/staff/recommendations",
    "/staff/offers",
    "/staff/performance/cycles",
    "/staff/settings?section=documentRequirements",
    "/staff/settings?section=reminders",
    "/staff/timesheet-settings",
    "/staff/attendance#section=site-visits",
  ]) {
    assert.ok(
      items.some((item) => item.url === url),
      `${url} should be visible in HR sidebar`,
    );
  }
  assert.equal(items.find((item) => item.url === "/staff/time-away")?.title, "Time Away");
  assert.equal(activeNavigationUrl(groups, "/staff/time-away"), "/staff/time-away");
});

test("HR request views and Visit Approvals stay visible separately", () => {
  const groups = navigation("HR");
  const hrGroup = groups.find((group) => group.label === "HR")!;
  assert.deepEqual(
    hrGroup.items.map((item) => item.url),
    [
      "/staff/requests?view=approvals",
      "/staff/requests?view=organisation",
      "/staff/requests?view=reviewed",
      "/staff/requests?view=my",
    ],
  );
  assert.equal(hrGroup.items[1]?.title, "Employee Requests");
  assert.equal(hrGroup.items[2]?.title, "My decisions");
  assert.equal(hrGroup.items[3]?.title, "My Requests");
  assert.equal(
    activeNavigationUrl(groups, "/staff/attendance#section=site-visits&visit=123"),
    "/staff/attendance#section=site-visits",
  );
});

test("Super Admin has a read-only request tracker, not approval shortcuts", () => {
  const groups = navigation("Super Admin");
  const destinations = groups.flatMap((group) =>
    group.items.flatMap((item) => [
      item.url,
      ...(item.shortcuts ?? []).map((shortcut) => shortcut.url),
    ]),
  );
  const request = groups
    .flatMap((group) => group.items)
    .find((item) => item.url === "/staff/requests?view=organisation");
  assert.equal(request?.title, "Employee requests");
  assert.deepEqual(request?.shortcuts, []);
  const forbidden = [
    "/staff/requests?view=approvals",
    "/staff/leave-approvals",
    "/staff/timesheet-approvals",
    "/staff/attendance/corrections",
    "/staff/overtime-approvals",
    "/staff/travel-approvals",
    "/staff/travel-hr-approvals",
    "/staff/travel-accounts-approvals",
  ];
  for (const url of forbidden) assert.ok(!destinations.includes(url), url);
  assert.ok(
    searchNavigation(groups, "approve leave")
      .flatMap((group) => group.items)
      .every((item) => !forbidden.includes(item.url)),
  );
});

test("Super Admin keeps original oversight and settings pages visible", () => {
  const groups = navigation("Super Admin");
  const items = groups.flatMap((group) => group.items);
  assert.ok(items.some((item) => item.url === "/staff/reports"));
  assert.ok(groups.some((group) => group.label === "Reports"));
  for (const url of [
    "/staff/employees",
    "/staff/leave-admin",
    "/staff/attendance",
    "/staff/timesheet-monitoring",
    "/staff/vacancies",
    "/staff/candidates",
    "/staff/interviews",
    "/staff/offers",
    "/staff/files",
    "/staff/document-expiry",
    "/staff/payroll/periods",
    "/staff/settings",
    "/staff/users",
    "/staff/audit",
    "/staff/org-chart",
    "/staff/anniversaries",
    "/staff/offboarding",
    "/staff/time-away",
    "/staff/candidates/intake",
    "/staff/candidates/contacts",
    "/staff/recommendations",
    "/staff/performance/cycles",
    "/staff/payroll/overtime",
    "/staff/settings?section=documentRequirements",
    "/staff/settings?section=reminders",
    "/staff/timesheet-settings",
  ])
    assert.ok(
      items.some((item) => item.url === url),
      `${url} should be visible in Super Admin sidebar`,
    );
  assert.equal(items.find((item) => item.url === "/staff/time-away")?.title, "Time Away");
  assert.equal(activeNavigationUrl(groups, "/staff/time-away"), "/staff/time-away");
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
  assert.equal(
    activeNavigationUrl(groups, "/staff/attendance/corrections"),
    "/staff/requests?view=approvals",
  );
  assert.equal(activeNavigationUrl(groups, "/staff/attendance"), "/staff/attendance");
  assert.equal(
    activeNavigationUrl(groups, "/staff/attendance#section=site-visits&visit=123"),
    "/staff/attendance#section=site-visits",
  );
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

test("employees can find internal applications and referrals under Company and through menu search", () => {
  const groups = navigation("Employee");
  const opportunities = groups
    .find((group) => group.label === "Company")
    ?.items.find((item) => item.url === "/staff/opportunities");
  assert.equal(opportunities?.title, "Job Opportunities");
  for (const term of ["apply", "recommend", "referral", "career"])
    assert.ok(
      searchNavigation(groups, term)
        .flatMap((group) => group.items)
        .some((item) => item.url === "/staff/opportunities"),
      term,
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
