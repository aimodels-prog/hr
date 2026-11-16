import { requirementApplies, type DocumentRequirement } from "./document-requirements.ts";

type DocumentForChecklist = {
  type: string;
  requirementSnapshot: { id: string } | null;
  status: "Pending Verification" | "Valid" | "Rejected" | "Replaced";
  expiryDate: string | null;
  dependantId: string | null;
  waiverReason: string | null;
};

export function missingRequiredDocuments(
  requirements: DocumentRequirement[],
  employee: { id: string; departmentId: string; positionId: string; locationId: string },
  documents: DocumentForChecklist[],
  today: string,
): DocumentRequirement[] {
  return requirements.filter((requirement) => {
    if (!requirement.required || !requirementApplies(requirement, employee)) return false;
    return !documents.some((document) => {
      if (document.dependantId) return false;
      const matches = document.requirementSnapshot
        ? document.requirementSnapshot.id === requirement.id
        : requirement.id === requirement.type && document.type === requirement.type;
      if (!matches) return false;
      if (document.waiverReason) return true;
      return (
        ["Pending Verification", "Valid"].includes(document.status) &&
        (!document.expiryDate || document.expiryDate >= today)
      );
    });
  });
}
