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
    const destinations = groups.flatMap((group) =>
      group.items.flatMap((item) => [
        item.url,
        ...(item.shortcuts ?? []).map((entry) => entry.url),
      ]),
    );
    assert.equal(new Set(urls).size, urls.length);
    if (["HR", "Super Admin"].includes(role)) {
      assert.ok(!groups.some((group) => group.label.startsWith("My ")));
      assert.ok(urls.includes("/staff/employees"));
    } else {
      const personal = groups.find((group) => group.label === "My Details")!;
      assert.ok(personal.items.some((item) => item.url === "/staff/me/profile"));
      assert.ok(personal.items.some((item) => item.url === "/staff/payslips"));
      assert.ok(urls.includes("/staff/me/timesheets"));
      assert.ok(
        destinations.includes("/staff/interviews"),
        "Assigned interview work remains accessible",
      );
    }
    assert.equal(
      urls.filter(
        (url) =>
          url ===
          (role === "HR"
            ? "/staff/requests?view=approvals"
            : role === "Super Admin"
              ? "/staff/requests?view=organisation"
              : role === "Travel Admin"
                ? "/staff/travel"
                : role === "IT"
                  ? "/staff/requests?view=my"
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
  assert.equal(home("/staff/attendance#section=site-visits"), undefined);
  assert.equal(home("/staff/requests?view=approvals"), "HR");
  assert.equal(home("/staff/requests?view=organisation"), undefined);
  assert.equal(home("/staff/requests?view=my"), undefined);
  assert.equal(
    activeNavigationUrl(groups, "/staff/requests?view=my"),
    "/staff/requests?view=approvals",
  );
  assert.equal(
    activeNavigationUrl(groups, "/staff/leave-approvals"),
    "/staff/requests?view=approvals",
  );
  assert.equal(home("/staff/offers"), undefined);
  assert.equal(home("/staff/files"), "Documents");
  assert.equal(home("/staff/leave-policies"), "Settings");
  assert.equal(home("/staff/reports"), "Home");
  assert.equal(home("/staff/settings"), "Settings");
  assert.equal(home("/staff/payroll/periods"), undefined);
  assert.ok(
    !navigation("Super Admin")
      .flatMap((group) => group.items)
      .some((item) => item.url === "/staff/attendance#section=site-visits"),
  );
  assert.equal(home("/staff/time-away"), undefined);
  assert.ok(!groups.some((group) => group.label === "Administration"));
});

test("personal menus keep daily work visible and nest occasional actions under familiar pages", () => {
  const expectedCounts: Partial<Record<Role, number>> = {
    Employee: 15,
    IT: 14,
    "Travel Admin": 13,
    "Line Manager": 17,
    Accounts: 20,
  };
  for (const [role, count] of Object.entries(expectedCounts) as Array<[Role, number]>) {
    const groups = navigation(role);
    const items = groups.flatMap((group) => group.items);
    assert.equal(items.length, count, role);
    for (const url of [
      "/staff/me/leave-balances",
      "/staff/me/timesheets",
      "/staff/me/attendance",
      "/staff/me/profile",
      "/staff/payslips",
    ])
      assert.ok(
        items.some((item) => item.url === url),
        `${role}: ${url}`,
      );
    for (const [childUrl, parentUrl, term] of [
      ["/staff/me/attendance?action=site-visit", "/staff/me/attendance", "quick visit"],
      ["/staff/time-away", "/staff/me/attendance", "time away"],
      ["/staff/me/overtime", "/staff/me/timesheets", "overtime"],
      ["/staff/me/onboarding", "/staff/me/profile", "my setup"],
      ["/staff/interviews", "/staff/my-tasks", "interviews"],
      ["/staff/org-chart", "/staff/employees", "organisation chart"],
    ]) {
      const parent = items.find((item) => item.url === parentUrl);
      assert.ok(
        parent?.shortcuts?.some((entry) => entry.url === childUrl),
        `${role}: ${childUrl}`,
      );
      assert.equal(activeNavigationUrl(groups, childUrl!), parentUrl, `${role}: ${childUrl}`);
      assert.ok(
        searchNavigation(groups, term!)
          .flatMap((group) => group.items)
          .some((item) => item.url === childUrl),
        `${role}: ${term}`,
      );
    }
  }
});

test("manager and finance decision menus distinguish my requests from approvals", () => {
  for (const role of ["Line Manager", "Accounts"] as const) {
    const groups = navigation(role);
    const home = groups.find((group) => group.label === "Home")!;
    assert.equal(home.items.find((item) => item.url === "/staff/requests")?.title, "Approvals");
    assert.equal(
      home.items.find((item) => item.url === "/staff/requests?view=my")?.title,
      "My Requests",
    );
    assert.equal(activeNavigationUrl(groups, "/staff/requests?view=my"), "/staff/requests?view=my");
  }
  const itHome = navigation("IT").find((group) => group.label === "Home")!;
  assert.ok(!itHome.items.some((item) => item.title === "Approvals"));
  assert.ok(itHome.items.some((item) => item.url === "/staff/requests?view=my"));
});

test("employee decision history and approval routes are easy to find", () => {
  const employeeRequests = navigation("Employee")
    .flatMap((group) => group.items)
    .find((item) => item.url === "/staff/requests");
  assert.ok(
    employeeRequests?.shortcuts?.some((item) => item.url === "/staff/requests?view=reviewed"),
  );
  for (const role of ["HR", "Super Admin"] as const) {
    const setup = navigation(role)
      .flatMap((group) => group.items)
      .find((item) => item.url === "/staff/settings");
    assert.ok(
      setup?.shortcuts?.some((item) => item.url === "/staff/settings?section=approvalRouting"),
      role,
    );
  }
});

test("HR has eight focused main groups and every secondary page has a logical parent", () => {
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
      "Settings",
    ],
  );
  assert.equal(
    groups.reduce((total, group) => total + group.items.length, 0),
    22,
  );
  const items = groups.flatMap((group) => group.items);
  for (const [childUrl, parentUrl] of [
    ["/staff/org-chart", "/staff/employees"],
    ["/staff/anniversaries", "/staff/employees"],
    ["/staff/offboarding", "/staff/employees"],
    ["/staff/time-away", "/staff/attendance"],
    ["/staff/candidates/contacts", "/staff/candidates"],
    ["/staff/recommendations", "/staff/candidates"],
    ["/staff/offers", "/staff/candidates"],
    ["/staff/performance/cycles", "/staff/performance/team"],
    ["/staff/settings?section=documentRequirements", "/staff/settings"],
    ["/staff/settings?section=reminders", "/staff/settings"],
    ["/staff/timesheet-settings", "/staff/settings"],
  ]) {
    const parent = items.find((item) => item.url === parentUrl);
    assert.ok(parent, parentUrl);
    assert.ok(
      parent.shortcuts?.some((shortcut) => shortcut.url === childUrl),
      childUrl,
    );
    assert.equal(activeNavigationUrl(groups, childUrl!), parentUrl);
    assert.ok(
      searchNavigation(
        groups,
        parent.shortcuts!.find((shortcut) => shortcut.url === childUrl)!.title,
      )
        .flatMap((group) => group.items)
        .some((item) => item.url === childUrl),
      childUrl,
    );
  }
});

test("HR has one approval menu entry while every former request view remains searchable", () => {
  const groups = navigation("HR");
  const hrGroup = groups.find((group) => group.label === "HR")!;
  assert.deepEqual(
    hrGroup.items.map((item) => item.url),
    ["/staff/requests?view=approvals"],
  );
  const shortcuts = hrGroup.items[0]!.shortcuts ?? [];
  for (const url of [
    "/staff/requests?view=organisation",
    "/staff/requests?view=reviewed",
    "/staff/requests?view=my",
    "/staff/leave-approvals",
    "/staff/attendance#section=site-visits",
  ]) {
    assert.ok(
      shortcuts.some((shortcut) => shortcut.url === url),
      url,
    );
    assert.equal(activeNavigationUrl(groups, url), "/staff/requests?view=approvals");
  }
  for (const [term, url] of [
    ["all employee requests", "/staff/requests?view=organisation"],
    ["my decisions", "/staff/requests?view=reviewed"],
    ["my requests", "/staff/requests?view=my"],
    ["visit approvals", "/staff/attendance#section=site-visits"],
  ])
    assert.ok(
      searchNavigation(groups, term!)
        .flatMap((group) => group.items)
        .some((item) => item.url === url),
      term,
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
  assert.equal(request?.title, "Request status");
  assert.deepEqual(request?.shortcuts, []);
  for (const url of [
    "/staff/requests?view=approvals",
    "/staff/leave-approvals",
    "/staff/timesheet-approvals",
    "/staff/attendance/corrections",
    "/staff/overtime-approvals",
    "/staff/travel-approvals",
    "/staff/travel-hr-approvals",
    "/staff/travel-accounts-approvals",
  ])
    assert.ok(!destinations.includes(url), url);
  assert.equal(searchNavigation(groups, "approve leave").length, 0);
});

test("Super Admin keeps oversight visible and nests infrequent pages without losing access", () => {
  const groups = navigation("Super Admin");
  const items = groups.flatMap((group) => group.items);
  assert.equal(items.length, 24);
  assert.ok(items.some((item) => item.url === "/staff/reports"));
  assert.ok(!groups.some((group) => group.label === "Reports"));
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
  ])
    assert.ok(
      items.some((item) => item.url === url),
      url,
    );
  for (const [childUrl, parentUrl] of [
    ["/staff/org-chart", "/staff/employees"],
    ["/staff/anniversaries", "/staff/employees"],
    ["/staff/offboarding", "/staff/employees"],
    ["/staff/time-away", "/staff/attendance"],
    ["/staff/candidates/intake", "/staff/candidates"],
    ["/staff/candidates/contacts", "/staff/candidates"],
    ["/staff/recommendations", "/staff/candidates"],
    ["/staff/performance/cycles", "/staff/performance/team"],
    ["/staff/payroll/overtime", "/staff/payroll/periods"],
    ["/staff/settings?section=documentRequirements", "/staff/settings"],
    ["/staff/settings?section=reminders", "/staff/settings"],
    ["/staff/timesheet-settings", "/staff/settings"],
  ]) {
    const parent = items.find((item) => item.url === parentUrl);
    const shortcut = parent?.shortcuts?.find((item) => item.url === childUrl);
    assert.ok(shortcut, childUrl);
    assert.equal(activeNavigationUrl(groups, childUrl!), parentUrl);
    assert.ok(
      searchNavigation(groups, shortcut.title)
        .flatMap((group) => group.items)
        .some((item) => item.url === childUrl),
      childUrl,
    );
  }
});

test("Travel Admin starts at the booking desk, not an empty approvals inbox", () => {
  const groups = navigation("Travel Admin");
  const home = groups.find((group) => group.label === "Home")!;
  const booking = home.items.find((item) => item.url === "/staff/travel");
  assert.equal(booking?.title, "Travel bookings & requests");
  assert.ok(booking?.shortcuts?.some((item) => item.url === "/staff/requests?view=my"));
  assert.ok(!home.items.some((item) => item.title === "Approvals"));
  assert.ok(!home.items.some((item) => item.url === "/staff/requests?view=approvals"));
  assert.equal(activeNavigationUrl(groups, "/staff/requests?view=my"), "/staff/travel");
  assert.ok(
    searchNavigation(groups, "travel bookings")
      .flatMap((group) => group.items)
      .some((item) => item.url === "/staff/travel"),
  );
  assert.ok(
    groups.flatMap((group) => group.items).some((item) => item.url === "/staff/me/profile"),
  );
  assert.ok(
    groups.flatMap((group) => group.items).some((item) => item.url === "/staff/me/leave-balances"),
  );
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
    "/staff/requests?view=approvals",
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
