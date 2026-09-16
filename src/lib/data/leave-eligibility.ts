import type { LeaveEligibility } from "./leave-types.ts";

type EligibilityPolicy = { type: string; isStatutory?: boolean; eligibility?: unknown };

// Oman Labour Law, Article 84(6), (7), (9): Hajj is not nationality-restricted.
// Company-benefit policies retain their configured eligibility.
export function statutoryOmaniOnly(policy: EligibilityPolicy): boolean | undefined {
  if (!policy.isStatutory) return undefined;
  if (policy.type === "Exam" || policy.type === "AccompanyPatient") return true;
  if (policy.type === "Hajj") return false;
  return undefined;
}

export function getLeaveEligibility(policy: EligibilityPolicy): LeaveEligibility {
  const configured = (policy.eligibility ?? {}) as LeaveEligibility;
  const restriction = statutoryOmaniOnly(policy);
  return { ...configured, ...(restriction === undefined ? {} : { omaniOnly: restriction }) };
}

export function isOmaniNationality(nationality: string | null | undefined): boolean {
  const value = (nationality ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "");
  return ["omani", "oman", "om", "omn", "عماني", "عمانية", "عمان"].includes(value);
}
