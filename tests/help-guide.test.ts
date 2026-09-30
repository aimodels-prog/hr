import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { helpArticles, helpRouteCoverage } from "../src/lib/help/catalog.ts";
import { canReadHrGuide, searchHelp, visibleArticles } from "../src/lib/help/guide.ts";
import { getRolePermissions, ROLE_PERMISSIONS } from "../src/lib/auth/permissions.ts";
import { staffNavigation } from "../src/lib/navigation/staff-navigation.ts";
import { staffPageModules } from "../src/lib/data/staff-module-plan.ts";
import type { Role } from "../src/lib/data/types.ts";

test("help articles have unique shareable identities and complete instructions", () => {
  assert.equal(new Set(helpArticles.map((item) => item.id)).size, helpArticles.length);
  for (const item of helpArticles) {
    assert.match(item.id, /^[a-z0-9-]+$/);
    assert.ok(item.title && item.summary && item.category && item.keywords, item.id);
    assert.ok(item.steps.length >= 3 && item.steps.every((step) => step.length > 25), item.id);
    assert.ok(item.after.length > 25 && item.checks.length > 0, item.id);
    const path = item.path.split("?")[0]!;
    assert.ok(path.startsWith("/staff"), item.id);
    assert.ok(
      existsSync(`src/routes${path}.tsx`) || existsSync(`src/routes${path}/index.tsx`),
      `${item.id}: ${path}`,
    );
    assert.doesNotMatch(
      JSON.stringify(item),
      /postgres|oauth|api key|endpoint|database schema|localhost|127\.0\.0\.1/i,
      item.id,
    );
  }
});

for (const role of Object.keys(ROLE_PERMISSIONS) as Role[]) {
  test(`${role}: guide access, navigation coverage and no unrelated data loading`, () => {
    const permissions = getRolePermissions(role);
    const navigation = staffNavigation(role, (permission) => permissions.has(permission));
    assert.ok(navigation.some((group) => group.items.some((item) => item.url === "/staff/help")));
    const visible = visibleArticles(helpArticles, "hr", role);
    if (!canReadHrGuide(role)) assert.ok(visible.every((item) => item.guide === "employee"));
    assert.ok(visible.some((item) => item.id === "timesheets"));
    assert.deepEqual(staffPageModules("/staff/help", "", "", role), []);
    for (const item of navigation.flatMap((group) => group.items)) {
      if (item.url === "/staff/help") continue;
      assert.ok(
        helpArticles.some((article) => article.path.split("?")[0] === item.url.split("?")[0]) ||
          helpRouteCoverage[item.url],
        `${role}: no guide for ${item.url}`,
      );
    }
  });
}

test("HR includes employee help; Super Admin includes every company setup section", () => {
  const full = visibleArticles(helpArticles, "hr", "HR");
  for (const item of visibleArticles(helpArticles, "employee", "Employee"))
    assert.ok(full.includes(item));
  const settings = readFileSync("src/routes/staff/settings.tsx", "utf8").split(
    "type SettingsSection",
  )[0]!;
  for (const match of settings.matchAll(/key: "([^"]+)"/g)) {
    assert.ok(
      visibleArticles(helpArticles, "hr", "Super Admin").some(
        (item) => item.path === `/staff/settings?section=${match[1]}`,
      ),
      match[1],
    );
  }
});

test("Finance duties stay out of employee and HR guides, search and direct-link selections", () => {
  const financeIds = [
    "hr-finance",
    "hr-payslip",
    "finance-travel",
    "finance-settlement",
    "finance-overtime-ledger",
  ];
  for (const role of Object.keys(ROLE_PERMISSIONS) as Role[]) {
    for (const guide of ["employee", "hr"]) {
      const articles = visibleArticles(helpArticles, guide, role);
      for (const id of financeIds) {
        assert.equal(
          articles.some((item) => item.id === id),
          role === "Accounts" || role === "Super Admin",
          `${role}/${guide}: ${id}`,
        );
      }
      assert.ok(
        articles.some((item) => item.id === "payslips"),
        "Everyone keeps their own payslip help",
      );
      if (role !== "Accounts" && role !== "Super Admin") {
        assert.ok(searchHelp(articles, "payroll").every((item) => !financeIds.includes(item.id)));
        assert.ok(!articles.some((item) => item.category === "Finance handover"));
        assert.ok(
          !articles.some((item) =>
            ["setup-costcentres", "setup-activitycodes", "setup-currencies"].includes(item.id),
          ),
        );
      }
      if (role === "Accounts") assert.ok(articles.every((item) => item.guide !== "hr"));
    }
  }
});

test("search matches plain questions, common alternatives and spelling variants", () => {
  for (const [query, expected] of [
    ["forgot clock out", "missing-clockout"],
    ["organogram", "hr-org-chart"],
    ["calender", "hr-interview"],
    ["How do I apply for leave", "leave"],
    ["top 20", "hr-screening"],
    ["customisation departments", "setup-departments"],
    ["fingerprint", "hr-machine"],
  ]) {
    assert.ok(
      searchHelp(helpArticles, query!)
        .slice(0, 5)
        .some((item) => item.id === expected),
      query,
    );
  }
  assert.equal(searchHelp(helpArticles, "unfindablezzzz").length, 0);
  assert.equal(searchHelp(helpArticles, "  ").length, helpArticles.length);
});

test("search cannot surface HR articles from an employee or tampered guide URL", () => {
  for (const guide of ["employee", "hr"]) {
    const employee = visibleArticles(helpArticles, guide, "Employee");
    assert.ok(searchHelp(employee, "company setup").every((item) => item.guide === "employee"));
    assert.ok(!employee.some((item) => item.id === "hr-finance"));
  }
  assert.ok(
    visibleArticles(helpArticles, "employee", "Accounts").some((item) => item.id === "hr-finance"),
  );
  assert.ok(
    !visibleArticles(helpArticles, "employee", "Accounts").some(
      (item) => item.id === "manager-timesheets",
    ),
  );
});
