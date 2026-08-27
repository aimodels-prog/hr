import type { CandidateCvExtractedFields } from "../data/types.ts";

export interface CvExtractionResult {
  fields: CandidateCvExtractedFields;
  confidence: Partial<Record<keyof CandidateCvExtractedFields, number>>;
  warnings: string[];
  method: "Local Preview" | "Python Service";
}

export interface CvExtractionProvider {
  extract(input: { file: Blob; fileName: string }): Promise<CvExtractionResult>;
}

const KNOWN_SKILLS = [
  "accounting",
  "autocad",
  "business development",
  "customs clearance",
  "data analysis",
  "excel",
  "finance",
  "freight forwarding",
  "google workspace",
  "health and safety",
  "human resources",
  "inventory management",
  "leadership",
  "logistics",
  "operations",
  "payroll",
  "power bi",
  "procurement",
  "project management",
  "python",
  "quality assurance",
  "sales",
  "sap",
  "supply chain",
] as const;

function cleanNameFromFile(fileName: string): { firstName?: string; lastName?: string } {
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  const cleaned = withoutExtension
    .replace(/\b(cv|resume|curriculum vitae|profile|updated|final|copy)\b/gi, " ")
    .replace(/[_\-().]+/g, " ")
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = cleaned.split(" ").filter((part) => part.length > 1);
  if (parts.length < 2) return {};
  return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
}

function readableText(buffer: ArrayBuffer, mimeType: string): string {
  const bytes = new Uint8Array(buffer);
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (mimeType.startsWith("text/")) return decoded;
  // This is deliberately only a browser preview. It can recover uncompressed text fragments and
  // contact details from some PDFs/DOCX files, but never claims to be the production Python/OCR
  // parser. The warning returned below keeps that limitation visible to HR.
  return decoded.replace(/[^\x20-\x7E\n\r\t]+/g, " ").replace(/\s+/g, " ");
}

export class LocalCvExtractionProvider implements CvExtractionProvider {
  async extract({ file, fileName }: { file: Blob; fileName: string }): Promise<CvExtractionResult> {
    const text = readableText(await file.arrayBuffer(), file.type).slice(0, 1_000_000);
    const fields: CandidateCvExtractedFields = {};
    const confidence: CvExtractionResult["confidence"] = {};
    const warnings: string[] = [];

    const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
    const phone = text.match(/(?:\+|00)?\d[\d\s()-]{7,}\d/)?.[0]?.trim();
    const experience = text.match(/\b(\d{1,2})\+?\s+years?\s+(?:of\s+)?experience\b/i)?.[1];
    const fileNamePerson = cleanNameFromFile(fileName);

    if (email) {
      fields.email = email.toLowerCase();
      confidence.email = 0.96;
    }
    if (phone) {
      fields.phone = phone;
      confidence.phone = 0.82;
    }
    if (experience) {
      fields.yearsOfExperience = Number(experience);
      confidence.yearsOfExperience = 0.7;
    }
    if (fileNamePerson.firstName && fileNamePerson.lastName) {
      fields.firstName = fileNamePerson.firstName;
      fields.lastName = fileNamePerson.lastName;
      confidence.firstName = 0.45;
      confidence.lastName = 0.45;
    }

    const normalizedText = text.toLowerCase();
    const skills = KNOWN_SKILLS.filter((skill) => normalizedText.includes(skill));
    if (skills.length > 0) {
      fields.skills = [...skills];
      confidence.skills = 0.72;
    }

    if (!email && !phone && skills.length === 0) {
      warnings.push(
        "This CV could not be read reliably in the browser. The original file is saved; confirm the candidate details manually.",
      );
    }
    if (!file.type.startsWith("text/")) {
      warnings.push(
        "This is a browser preview. The production Python parser and OCR connection will provide deeper CV extraction later.",
      );
    }

    return { fields, confidence, warnings, method: "Local Preview" };
  }
}
