import { employeeGuide } from "./employee-guide.ts";
import { hrGuide, setupGuide } from "./hr-guide.ts";
import { responsibilitiesGuide } from "./responsibilities-guide.ts";
import { detailedGuide } from "./detailed-guide.ts";
import type { Role } from "../data/types.ts";
import { basicsGuide } from "./basics-guide.ts";

export const helpArticles = [
  ...employeeGuide,
  ...basicsGuide,
  ...hrGuide.map((item) =>
    ["hr-finance", "hr-payslip"].includes(item.id)
      ? {
          ...item,
          guide: "employee" as const,
          roles: ["Accounts", "Super Admin"] as Role[],
        }
      : item,
  ),
  ...setupGuide.map((item) =>
    ["setup-costcentres", "setup-activitycodes", "setup-currencies"].includes(item.id)
      ? { ...item, roles: ["Super Admin"] as Role[] }
      : item,
  ),
  ...responsibilitiesGuide,
  ...detailedGuide,
];

/** Extra destinations explained within a guide, checked against the sidebar in tests. */
export const helpRouteCoverage: Record<string, string> = {
  "/staff/timesheets": "timesheets",
  "/staff/anniversaries": "directory",
  "/staff/org-chart": "directory",
  "/staff/candidates/contacts": "hr-candidate-pool",
  "/staff/document-expiry": "hr-documents",
};
