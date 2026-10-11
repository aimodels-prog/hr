import { z } from "zod";
import type { Employee } from "./types.ts";

/** Contact/family information is self-service; official identity is verified with a document. */
export const SELF_SERVICE_PROFILE_FIELDS = new Set<keyof Employee>([
  "preferredName",
  "phone",
  "whatsappNumber",
  "personalEmail",
  "address",
  "homeCountryPhone",
  "homeCountryAddress",
  "gender",
  "maritalStatus",
  "emergencyContacts",
  "dependants",
]);

export const PROFILE_APPROVAL_RETIRED =
  "Save contact details directly in your profile. For identity corrections, upload a passport or ID for HR to verify.";

export function assertDirectProfileChanges(changes: Partial<Employee>): void {
  const fields = Object.keys(changes) as Array<keyof Employee>;
  if (!fields.length) throw new Error("No personal details were changed.");
  if (fields.some((field) => !SELF_SERVICE_PROFILE_FIELDS.has(field))) {
    throw new Error(
      "Identity details must be verified with a passport or ID. Employment and financial details cannot be changed here.",
    );
  }
}

export const verifiedProfileIdentitySchema = z
  .object({
    legalName: z.string().trim().min(2).max(200).optional(),
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => {
        const parsed = new Date(`${value}T00:00:00Z`);
        return (
          !Number.isNaN(parsed.getTime()) &&
          parsed.toISOString().slice(0, 10) === value &&
          parsed <= new Date()
        );
      }, "Enter a valid birth date that is not in the future.")
      .optional(),
    nationality: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Enter the identity details to confirm.");

export type VerifiedProfileIdentity = z.infer<typeof verifiedProfileIdentitySchema>;

export function validateVerifiedProfileIdentity(
  identity: VerifiedProfileIdentity | undefined,
  document: { type: string; dependantId?: string | null },
  decision: "verify" | "reject",
): VerifiedProfileIdentity | undefined {
  if (!identity) return undefined;
  if (
    decision !== "verify" ||
    document.dependantId ||
    !["passport", "national_id"].includes(document.type)
  ) {
    throw new Error(
      "Employee identity can be updated only while verifying the employee's passport or ID.",
    );
  }
  return verifiedProfileIdentitySchema.parse(identity);
}
