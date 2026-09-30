import assert from "node:assert/strict";
import { test } from "node:test";
import { contextualArticle } from "../src/lib/help/contextual.ts";
import { getRolePermissions, ROLE_PERMISSIONS } from "../src/lib/auth/permissions.ts";
import { helpArticles } from "../src/lib/help/catalog.ts";
import { visibleArticles, canReadHrGuide } from "../src/lib/help/guide.ts";
import { staffNavigation } from "../src/lib/navigation/staff-navigation.ts";
import type { Role } from "../src/lib/data/types.ts";

for (const role of Object.keys(ROLE_PERMISSIONS) as Role[]) {
  test(`${role}: contextual tips stay within the permitted guide and Help is last`, () => {
    const can = (permission: Parameters<ReturnType<typeof getRolePermissions>["has"]>[0]) =>
      getRolePermissions(role).has(permission);
    const allowed = visibleArticles(helpArticles, canReadHrGuide(role) ? "hr" : "employee", role);
    for (const candidate of helpArticles) {
      const result = contextualArticle(candidate.path, role, can);
      if (result) {
        assert.ok(allowed.some((article) => article.id === result.id));
        assert.ok(!result.permission || can(result.permission));
      }
    }
    const groups = staffNavigation(role, can);
    assert.equal(groups.at(-1)?.label, "Support");
    assert.equal(
      groups[0]!.items.some((item) => item.url === "/staff/help"),
      false,
    );
    assert.equal(contextualArticle("/staff/help", role, can), undefined);
    assert.equal(contextualArticle("/staff/nonexistent-page", role, can), undefined);
  });
}
test("HR and employees cannot receive Finance tips even through a bookmarked URL", () => {
  for (const role of ["HR", "Employee"] as const)
    assert.equal(
      contextualArticle("/staff/payroll/periods", role, (permission) =>
        getRolePermissions(role).has(permission),
      ),
      undefined,
    );
  const finance = contextualArticle("/staff/payroll/periods", "Accounts", (permission) =>
    getRolePermissions("Accounts").has(permission),
  );
  assert.ok(finance);
});
