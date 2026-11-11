import "@tanstack/react-start/server-only";

import * as z from "zod";
import { isValidCurrentSalaryOmr } from "./current-salary.ts";
import { EXISTING_VISA_OPTIONS, WORK_ELIGIBILITY_OPTIONS } from "./work-eligibility.ts";

export const PublicApplicationSchema = z
  .object({
    vacancyId: z.string().uuid(),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(320),
    phone: z.string().trim().min(5).max(40),
    nationality: z.string().trim().max(100).optional(),
    location: z.string().trim().min(1).max(200),
    currentCompany: z.string().trim().min(1).max(200),
    currentTitle: z.string().trim().min(1).max(200),
    yearsOfExperience: z.number().int().min(0).max(80),
    noticePeriod: z.string().trim().min(1).max(200),
    workEligibility: z.enum(WORK_ELIGIBILITY_OPTIONS),
    visaStatus: z.enum(EXISTING_VISA_OPTIONS).optional(),
    currentSalary: z.string().trim().refine(isValidCurrentSalaryOmr),
    salaryExpectation: z.string().trim().min(1).max(200),
    screeningAnswers: z
      .array(z.object({ question: z.string().trim().min(1), answer: z.string().trim().min(1) }))
      .max(30),
    coverNote: z.string().trim().max(10_000).optional(),
    consent: z.literal(true),
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().max(150),
    fileBase64: z.string().min(1).max(14_000_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.workEligibility === "Valid Oman work visa" && !value.visaStatus) {
      context.addIssue({
        code: "custom",
        path: ["visaStatus"],
        message: "Select the type of Oman work visa you hold.",
      });
    }
    if (value.workEligibility !== "Valid Oman work visa" && value.visaStatus) {
      context.addIssue({
        code: "custom",
        path: ["visaStatus"],
        message: "Visa details are only needed if you already hold a work visa.",
      });
    }
  });

export type PublicApplicationPayload = z.infer<typeof PublicApplicationSchema>;

export function validatePublicCv(name: string, declaredMimeType: string, bytes: Buffer): string {
  const extension = name.toLowerCase().match(/\.(pdf|doc|docx)$/)?.[1];
  if (!extension) throw new Error("Upload a PDF, DOC or DOCX CV.");
  const isPdf = bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isCompoundDocument = bytes.subarray(0, 8).toString("hex") === "d0cf11e0a1b11ae1";
  if (
    (extension === "pdf" && !isPdf) ||
    (extension === "docx" && !isZip) ||
    (extension === "doc" && !isCompoundDocument)
  ) {
    throw new Error("The CV content does not match its file extension.");
  }
  const expected =
    extension === "pdf"
      ? "application/pdf"
      : extension === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/msword";
  if (![expected, "application/octet-stream", ""].includes(declaredMimeType.toLowerCase())) {
    throw new Error("The CV content does not match its declared file type.");
  }
  return expected;
}
