import { helpArticles } from "./catalog.ts";
import { canReadHrGuide, visibleArticles } from "./guide.ts";
import type { Role } from "../data/types.ts";
import type { Permission } from "../auth/permissions.ts";

/** Select only from the role's permitted guide; never fall back to another role. */
export function contextualArticle(
  href: string,
  role: Role,
  can: (permission: Permission) => boolean,
) {
  const current = new URL(href, "https://help.local");
  if (current.pathname === "/staff/help") return undefined;
  return visibleArticles(helpArticles, canReadHrGuide(role) ? "hr" : "employee", role)
    .filter((article) => !article.permission || can(article.permission))
    .map((article) => {
      const target = new URL(article.path, current.origin);
      const base = target.pathname.split("/$")[0]!;
      const matches =
        (current.pathname === base ||
          (base !== "/staff" && current.pathname.startsWith(base + "/"))) &&
        [...target.searchParams].every(([key, value]) => current.searchParams.get(key) === value);
      return {
        article,
        score: matches
          ? base.length * 10 +
            [...target.searchParams].length * 100 +
            (article.guide === "hr" ? 1 : 0)
          : -1,
      };
    })
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score)[0]?.article;
}
