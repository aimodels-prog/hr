import { z } from "zod";

export const dependantSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(150),
    relationship: z.string().trim().min(1).max(100),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    phone: z.string().trim().max(50).optional(),
    email: z.union([z.string().email().max(254), z.literal("")]).optional(),
    nationality: z.string().trim().max(100).optional(),
    visaRequired: z.enum(["Yes", "No", "Not confirmed"]).optional(),
  })
  .strict();
export type Dependant = z.infer<typeof dependantSchema>;
export type DependantDocumentKind = "passport" | "national_id" | "visa";

export function missingDependantInformation(
  dependant: Dependant,
  documents: {
    dependantId?: string | null | undefined;
    dependantDocumentKind?: string | null | undefined;
    status: string;
    expiryDate?: string | null | undefined;
  }[],
  today = new Date().toISOString().slice(0, 10),
): string[] {
  const missing: string[] = [];
  if (!dependant.phone?.trim()) missing.push("contact phone (or parent/guardian's phone)");
  if (!dependant.nationality?.trim()) missing.push("nationality");
  if (!dependant.visaRequired || dependant.visaRequired === "Not confirmed")
    missing.push("whether a visa is required");
  const valid = documents.filter(
    (d) =>
      !!dependant.id &&
      d.dependantId === dependant.id &&
      ["Valid", "Pending Verification"].includes(d.status) &&
      (!d.expiryDate || d.expiryDate >= today),
  );
  if (
    !valid.some(
      (d) => d.dependantDocumentKind === "passport" || d.dependantDocumentKind === "national_id",
    )
  )
    missing.push("passport or ID document");
  if (dependant.visaRequired === "Yes" && !valid.some((d) => d.dependantDocumentKind === "visa"))
    missing.push("visa document");
  return missing;
}
