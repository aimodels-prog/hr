import type { CandidateCvSource } from "../data/types.ts";
export const cvSourceFilters = ["all", "portal", "email", "manual", "referral"] as const;
export type CvSourceFilter = (typeof cvSourceFilters)[number];
export function sourcesForCvFilter(filter: CvSourceFilter): CandidateCvSource[] | undefined {
  switch (filter) {
    case "all":
      return undefined;
    case "portal":
      return ["Careers Portal", "Internal Application"];
    case "email":
      return ["Direct Email"];
    case "referral":
      return ["Employee Referral"];
    case "manual":
      return ["HR Upload", "WhatsApp", "Agency", "Walk-in", "Other"];
  }
}
