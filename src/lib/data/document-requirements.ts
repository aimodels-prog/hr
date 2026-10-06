import { z } from "zod";
import type { DocumentType } from "./types.ts";

export const documentFieldSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,59}$/),
  label: z.string().trim().min(1).max(100),
  kind: z.enum(["text", "date", "year"]),
  required: z.boolean(),
  owner: z.enum(["Employee", "HR"]),
});
export const documentRequirementSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().trim().min(1).max(100),
    type: z.enum([
      "contract",
      "passport",
      "visa",
      "national_id",
      "work_permit",
      "driving_licence",
      "medical",
      "education_certificate",
      "professional_certificate",
      "bank_evidence",
      "insurance_card",
      "insurance_benefits",
      "other",
    ]),
    enabled: z.boolean(),
    required: z.boolean(),
    multiple: z.boolean(),
    uploadBy: z.enum(["Employee", "HR"]),
    audience: z.enum(["All", "Department", "Position", "Location", "Employee"]),
    audienceIds: z.array(z.string().min(1).max(100)).max(5000),
    fields: z.array(documentFieldSchema).max(30),
  })
  .superRefine((v, ctx) => {
    if (new Set(v.fields.map((f) => f.key)).size !== v.fields.length)
      ctx.addIssue({ code: "custom", message: "Each field must have a unique key." });
    if (v.audience !== "All" && !v.audienceIds.length)
      ctx.addIssue({ code: "custom", message: "Select who needs this document." });
    if (["visa", "work_permit"].includes(v.type) && v.fields.some((f) => f.owner !== "HR"))
      ctx.addIssue({
        code: "custom",
        message: "Visa and work-permit details must be completed by HR.",
      });
    if (["work_permit", "insurance_benefits"].includes(v.type) && v.uploadBy !== "HR")
      ctx.addIssue({
        code: "custom",
        message: "Work permits and benefit tables must be uploaded by HR.",
      });
    if (v.fields.some((f) => ["issueDate", "expiryDate"].includes(f.key) && f.kind !== "date"))
      ctx.addIssue({
        code: "custom",
        message: "Issue and expiry dates must use the Date answer type.",
      });
  });
export type DocumentRequirement = z.infer<typeof documentRequirementSchema>;
export const documentAnswersSchema = z.record(z.string().max(60), z.string().max(2000));
export const standardDocumentKeys = [
  "documentNumber",
  "issuingAuthority",
  "issuingCountry",
  "issueDate",
  "expiryDate",
  "notes",
] as const;
const field = (
  key: string,
  label: string,
  kind: "text" | "date" | "year" = "text",
  required = false,
  owner: "Employee" | "HR" = "Employee",
) => ({ key, label, kind, required, owner });
export function defaultDocumentRequirements(): DocumentRequirement[] {
  const identity = [
    field("documentNumber", "Document number", "text", true),
    field("issuingAuthority", "Issuing authority", "text", true),
    field("issuingCountry", "Issuing country"),
    field("issueDate", "Issue date", "date", true),
    field("expiryDate", "Expiry date", "date", true),
  ];
  const specs: Array<[string, string, DocumentType, ReturnType<typeof field>[]]> = [
    [
      "contract",
      "Employment Contract",
      "contract",
      [
        field("issueDate", "Start date", "date"),
        field("expiryDate", "End date (if applicable)", "date"),
      ],
    ],
    ["passport", "Passport", "passport", identity],
    ["visa", "Visa", "visa", identity.map((f) => ({ ...f, owner: "HR" as const }))],
    ["national_id", "Resident Card / National ID", "national_id", identity],
    [
      "work_permit",
      "Work Permit",
      "work_permit",
      identity.map((f) => ({ ...f, owner: "HR" as const })),
    ],
    ["driving_licence", "Driving Licence", "driving_licence", identity],
    ["medical", "Medical Document", "medical", [field("notes", "Notes (optional)")]],
    [
      "education_certificate",
      "Education Degree",
      "education_certificate",
      [
        field("qualification", "Degree / qualification", "text", true),
        field("institution", "Institution", "text", true),
        field("graduationYear", "Graduation year", "year", true),
      ],
    ],
    ["professional_certificate", "Professional Certificate", "professional_certificate", identity],
    ["oman_engineering", "Oman Engineering Certificate", "professional_certificate", identity],
    ["bank_evidence", "Bank Evidence", "bank_evidence", []],
    [
      "insurance_card",
      "Health Insurance Card",
      "insurance_card",
      [
        field("documentNumber", "Member / card number"),
        field("issuingAuthority", "Insurance provider"),
        field("expiryDate", "Expiry date", "date"),
      ],
    ],
    [
      "insurance_benefits",
      "Insurance Table of Benefits",
      "insurance_benefits",
      [field("expiryDate", "Expiry date", "date")],
    ],
    ["cv", "Updated CV", "other", []],
    [
      "other",
      "Other Document",
      "other",
      [field("documentName", "Document name", "text", true), field("notes", "Notes (optional)")],
    ],
  ];
  return specs.map(([id, name, type, fields]) => ({
    id,
    name,
    type,
    fields,
    enabled: true,
    required: ["contract", "national_id"].includes(id),
    multiple: ["education_certificate", "professional_certificate", "other"].includes(id),
    uploadBy: ["work_permit", "insurance_benefits"].includes(id) ? "HR" : "Employee",
    audience: "All",
    audienceIds: [],
  }));
}
export function requirementApplies(
  r: DocumentRequirement,
  e: { id: string; departmentId: string; positionId: string; locationId: string },
): boolean {
  const value =
    r.audience === "Department"
      ? e.departmentId
      : r.audience === "Position"
        ? e.positionId
        : r.audience === "Location"
          ? e.locationId
          : e.id;
  return r.enabled && (r.audience === "All" || r.audienceIds.includes(value));
}
export function validateDocumentAnswers(
  r: DocumentRequirement,
  answers: Record<string, string>,
  isHr: boolean,
  approving = false,
): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const key of Object.keys(answers)) {
    const f = r.fields.find((f) => f.key === key);
    if (!f || (!isHr && f.owner === "HR"))
      throw new Error("This document includes a field you cannot edit.");
  }
  for (const f of r.fields) {
    const value = answers[f.key]?.trim() ?? "";
    if (f.required && (approving || isHr || f.owner === "Employee") && !value)
      throw new Error(`${f.label} is required.`);
    if (!value) continue;
    if (
      f.kind === "date" &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value)
    )
      throw new Error(`${f.label} must be a valid date.`);
    if (
      f.kind === "year" &&
      (!/^\d{4}$/.test(value) || Number(value) < 1900 || Number(value) > 2200)
    )
      throw new Error(`${f.label} must be a valid year.`);
    clean[f.key] = value;
  }
  if (clean["issueDate"] && clean["expiryDate"] && clean["expiryDate"] < clean["issueDate"])
    throw new Error("Expiry date cannot be before issue date.");
  return clean;
}
