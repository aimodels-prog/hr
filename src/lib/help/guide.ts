import type { Role } from "../data/types.ts";
import type { Permission } from "../auth/permissions.ts";
import { helpWalkthroughs } from "./walkthroughs.ts";

export interface HelpArticle {
  id: string;
  guide: "employee" | "hr";
  category: string;
  title: string;
  summary: string;
  keywords: string;
  steps: string[];
  after: string;
  checks: string[];
  path: string;
  permission?: Permission;
  roles?: Role[];
}

export function article(
  id: string,
  guide: HelpArticle["guide"],
  category: string,
  title: string,
  summary: string,
  path: string,
  keywords: string,
  steps: string[],
  after: string,
  checks: string[],
  permission?: Permission,
): HelpArticle {
  return {
    id,
    guide,
    category,
    title,
    summary,
    path,
    keywords,
    steps,
    after,
    checks,
    ...(permission ? { permission } : {}),
  };
}

export function canReadHrGuide(role: Role) {
  return role === "HR" || role === "Super Admin";
}

export function visibleArticles(articles: HelpArticle[], guide: string, role: Role) {
  return articles.filter(
    (item) =>
      (item.guide === "employee" || (guide === "hr" && canReadHrGuide(role))) &&
      (!item.roles || item.roles.includes(role)),
  );
}

const aliases: Record<string, string> = {
  holiday: "leave",
  vacation: "leave",
  holidays: "leave",
  sick: "sick sickness",
  organogram: "organisation chart",
  organigram: "organisation chart",
  fingerprint: "attendance machine",
  biometric: "attendance machine",
  payslip: "payslip salary",
  payroll: "payroll salary",
  signin: "sign in",
  logout: "sign out",
  cv: "cv resume",
  resume: "cv resume",
  customize: "setup",
  customization: "setup",
  customise: "setup",
  customisation: "setup",
  calender: "calendar",
  knowlegde: "knowledge",
  overtime: "overtime extra hours",
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Search only the caller's already-filtered guide. No employee records are searched. */
export function searchHelp(articles: HelpArticle[], query: string) {
  const words = normalize(query)
    .split(" ")
    .filter(
      (word) =>
        word &&
        !["how", "do", "i", "the", "a", "to", "my", "can", "is", "for", "and"].includes(word),
    );
  if (!words.length) return articles;
  return articles
    .map((item, index) => {
      const title = normalize(item.title);
      const keywords = normalize(item.keywords + " " + item.category + " " + item.summary);
      const walkthrough = helpWalkthroughs[item.id];
      const body = normalize(
        [
          ...item.steps,
          item.after,
          ...item.checks,
          ...(walkthrough?.before ?? []),
          ...(walkthrough?.flow ?? []),
          ...(walkthrough?.fields?.flatMap((field) => [field.label, field.meaning]) ?? []),
        ].join(" "),
      );
      let score = 0;
      for (const word of words) {
        const alternatives = [word, ...(aliases[word]?.split(" ") ?? [])];
        const weight = Math.max(
          ...alternatives.map((term) =>
            title.includes(term) ? 12 : keywords.includes(term) ? 6 : body.includes(term) ? 1 : 0,
          ),
        );
        if (!weight) return { item, score: 0, index };
        score += weight;
      }
      if (title.includes(normalize(query))) score += 20;
      return { item, score, index };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item }) => item);
}
