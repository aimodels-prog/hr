import * as XLSX from "xlsx";
import type { CandidateService } from "./candidate-service.ts";
import type { NewRecord } from "./repository.ts";
import {
  type ActorContext,
  type Candidate,
  type CandidateStage,
  type VisaStatus,
  type MaritalStatus,
} from "./types.ts";
import { getApplicationDataServices } from "./application-data.ts";

// Real recruitment-tracker spreadsheets use inconsistent free text for these fields
// (e.g. "Own"/"own"/"Own visa" all meaning the same thing) - normalize to the canonical set.
function normalizeVisaStatus(raw: string): VisaStatus | undefined {
  const v = raw.trim().toLowerCase();
  if (!v || v === "nil" || v === "n/a") return "Not Applicable";
  if (v === "omani") return "Omani (No Visa Required)";
  if (v.includes("freelance")) return "Freelance Visa";
  if (v.includes("visit")) return "Visit Visa";
  if (v.includes("require")) return "Requires Sponsorship";
  if (v.includes("company")) return "Company Visa";
  if (v.includes("own") || v === "personal") return "Own Visa";
  if (v === "visa" || v === "via") return "Other";
  return "Other";
}

function normalizeMaritalStatus(raw: string): MaritalStatus | undefined {
  const v = raw.trim().toLowerCase();
  if (!v || v === "nil" || v === "available") return "Not Specified";
  if (v.includes("family")) return "Married (With Family)";
  if (v.includes("married")) return "Married";
  if (v.includes("single")) return "Single";
  return "Not Specified";
}

export interface SheetPreview {
  name: string;
  headers: string[];
  rows: Record<string, unknown>[];
  headerRowNumber: number;
}

export type CandidateStandardField =
  | "firstName"
  | "lastName"
  | "email"
  | "phone"
  | "nationality"
  | "location"
  | "currentCompany"
  | "currentTitle"
  | "yearsOfExperience"
  | "stage"
  | "shortlistStatus"
  | "trackerStatus"
  | "projectName"
  | "projectType"
  | "visaStatus"
  | "maritalStatus"
  | "noticePeriod"
  | "lastContactAt"
  | "interviewDate"
  | "currentSalary"
  | "expectedSalary"
  | "acceptedSalary"
  | "remarks"
  | "source";

export const STANDARD_FIELDS: { id: CandidateStandardField; label: string }[] = [
  { id: "firstName", label: "First Name" },
  { id: "lastName", label: "Last Name" },
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone" },
  { id: "nationality", label: "Nationality" },
  { id: "location", label: "Location" },
  { id: "currentCompany", label: "Company" },
  { id: "currentTitle", label: "Position" },
  { id: "yearsOfExperience", label: "Experience (Years)" },
  { id: "stage", label: "Workflow Stage" },
  { id: "shortlistStatus", label: "Shortlisted" },
  { id: "trackerStatus", label: "HR Tracker Status" },
  { id: "projectName", label: "Project" },
  { id: "projectType", label: "Project Type" },
  { id: "visaStatus", label: "Visa" },
  { id: "maritalStatus", label: "Marital Status" },
  { id: "noticePeriod", label: "Notice Period" },
  { id: "lastContactAt", label: "Last Contacted" },
  { id: "interviewDate", label: "Interview Date" },
  { id: "currentSalary", label: "Current Salary" },
  { id: "expectedSalary", label: "Expected Salary" },
  { id: "acceptedSalary", label: "Accepted Salary" },
  { id: "remarks", label: "Remarks" },
  { id: "source", label: "Source" },
];

export interface ImportMapping {
  [key: string]: string; // standardField -> sourceColumn
}

export interface NormalizedCandidateRow extends Partial<Candidate> {
  _sourceRowIndex: number;
  _sourceSheet: string;
}

export type ConflictResolution = "merge" | "skip" | "create_separate";

export interface DuplicateConflict {
  type: "exact_email" | "exact_phone" | "possible_name_company";
  existingCandidate: Candidate;
  importedCandidate: NormalizedCandidateRow;
  resolution?: ConflictResolution;
}

export class ImportService {
  async parseWorkbook(file: File): Promise<SheetPreview[]> {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });

    const previews: SheetPreview[] = [];
    workbook.SheetNames.forEach((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) return;
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
        header: 1,
        defval: "",
        raw: false,
      });
      const headerTerms = [
        "name",
        "email",
        "contact",
        "phone",
        "position",
        "company",
        "experience",
        "nationality",
        "project",
        "status",
      ];
      const headerIndex =
        matrix
          .slice(0, 12)
          .map((row, index) => ({
            index,
            score: row.filter((cell) => {
              const normalized = String(cell)
                .toLowerCase()
                .replace(/[^a-z0-9]/g, "");
              return headerTerms.some((term) => normalized.includes(term));
            }).length,
          }))
          .sort((a, b) => b.score - a.score)[0]?.index ?? 0;
      const headers = (matrix[headerIndex] || []).map((cell, index) => {
        const value = String(cell).trim();
        return value || `Unlabelled Column ${index + 1}`;
      });
      const json = matrix
        .slice(headerIndex + 1)
        .filter((row) => row.some((cell) => String(cell).trim()))
        .map((row) =>
          Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])),
        );

      previews.push({
        name: sheetName,
        headers,
        rows: json,
        headerRowNumber: headerIndex + 1,
      });
    });
    return previews;
  }

  autoMapHeaders(headers: string[]): ImportMapping {
    const mapping: ImportMapping = {};
    const normalizedHeaders = headers.map((h) => ({
      original: h,
      clean: h.toLowerCase().replace(/[^a-z0-9]/g, ""),
    }));

    const tryMatch = (field: CandidateStandardField, keywords: string[]) => {
      for (const kw of keywords) {
        const exactMatch = normalizedHeaders.find((h) => h.clean === kw);
        if (exactMatch && !Object.values(mapping).includes(exactMatch.original)) {
          mapping[field] = exactMatch.original;
          return;
        }
      }
      for (const kw of keywords) {
        const match = normalizedHeaders.find((h) => h.clean.includes(kw));
        if (match && !Object.values(mapping).includes(match.original)) {
          mapping[field] = match.original;
          return;
        }
      }
    };

    tryMatch("email", ["email"]);
    tryMatch("phone", [
      "phonenumber",
      "contactnumber",
      "mobilenumber",
      "phone",
      "mobile",
      "contact",
    ]);
    tryMatch("firstName", ["first", "name", "candidate"]);
    tryMatch("lastName", ["lastname", "surname", "familyname"]);
    tryMatch("currentTitle", ["position", "title", "role"]);
    tryMatch("currentCompany", ["company", "employer"]);
    tryMatch("yearsOfExperience", ["experience", "exp", "years"]);
    tryMatch("nationality", ["nationality", "citizen"]);
    tryMatch("location", ["location", "city", "country"]);
    tryMatch("shortlistStatus", ["shortlisted", "shortlist"]);
    tryMatch("trackerStatus", ["status"]);
    tryMatch("stage", ["workflowstage", "stage"]);
    tryMatch("projectName", ["project"]);
    tryMatch("projectType", ["projecttype", "type"]);
    tryMatch("visaStatus", ["visastatus", "visa", "permit"]);
    tryMatch("maritalStatus", ["maritalstatus", "martialstatus", "marital", "married"]);
    tryMatch("noticePeriod", ["noticeperiod", "notice"]);
    tryMatch("currentSalary", ["currentsalaryomr", "currentsalary", "cursal", "current"]);
    tryMatch("expectedSalary", ["expectedsalary", "expsal", "expected"]);
    tryMatch("acceptedSalary", ["acceptedsalary", "accepted"]);
    tryMatch("lastContactAt", ["lastcontact", "contacted"]);
    tryMatch("interviewDate", ["interviewdate", "interview"]);
    tryMatch("remarks", ["remark", "note", "comment"]);
    tryMatch("source", ["source"]);

    return mapping;
  }

  normalizeData(
    rows: Record<string, unknown>[],
    sheetName: string,
    mapping: ImportMapping,
    headerRowNumber = 1,
  ): NormalizedCandidateRow[] {
    return rows
      .map((row, idx) => {
        const getVal = (field: CandidateStandardField): string => {
          const col = mapping[field];
          if (!col) return "";
          const val = row[col];
          return val != null ? String(val).trim() : "";
        };

        let firstName = getVal("firstName");
        let lastName = getVal("lastName");

        if (firstName && !lastName && firstName.includes(" ")) {
          const parts = firstName.split(" ");
          lastName = parts.pop() || "";
          firstName = parts.join(" ");
        }

        // Normalize experience to number
        const expStr = getVal("yearsOfExperience").replace(/[^0-9.]/g, "");
        const exp = expStr ? parseFloat(expStr) : 0;

        // Normalize stage safely
        const shortlistStatus = getVal("shortlistStatus");
        const trackerStatus = getVal("trackerStatus");
        const stageRaw = (getVal("stage") || trackerStatus || shortlistStatus).toLowerCase();
        let stage: CandidateStage = "Sourced";
        if (stageRaw.includes("shortlisted") || stageRaw === "yes") stage = "Shortlisted";
        else if (stageRaw.includes("interview")) stage = "Interview";
        else if (stageRaw.includes("offer")) stage = "Offer";
        else if (stageRaw.includes("hire") || stageRaw.includes("accept")) stage = "Hired";
        else if (stageRaw.includes("reject") || stageRaw.includes("not")) stage = "Not Selected";

        return {
          _sourceRowIndex: idx + headerRowNumber + 1,
          _sourceSheet: sheetName,
          firstName: firstName || "Unknown",
          lastName: lastName || "Candidate",
          email: getVal("email"),
          phone: getVal("phone"),
          nationality: getVal("nationality") || undefined,
          location: getVal("location") || "Unknown",
          currentCompany: getVal("currentCompany") || undefined,
          currentTitle: getVal("currentTitle") || undefined,
          yearsOfExperience: isNaN(exp) ? 0 : exp,
          stage,
          shortlistStatus: shortlistStatus || undefined,
          trackerStatus: trackerStatus || undefined,
          projectName: getVal("projectName") || undefined,
          projectType: getVal("projectType") || undefined,
          visaStatus: getVal("visaStatus") ? normalizeVisaStatus(getVal("visaStatus")) : undefined,
          maritalStatus: getVal("maritalStatus")
            ? normalizeMaritalStatus(getVal("maritalStatus"))
            : undefined,
          lastContactAt: getVal("lastContactAt") || undefined,
          interviewDate: getVal("interviewDate") || undefined,
          noticePeriod: getVal("noticePeriod") || undefined,
          currentSalary: getVal("currentSalary") || undefined,
          expectedSalary: getVal("expectedSalary") || undefined,
          acceptedSalary: getVal("acceptedSalary") || undefined,
          remarks: getVal("remarks") || undefined,
          source: getVal("source") || undefined,
          importProvenance: `${sheetName} - Row ${idx + headerRowNumber + 1}`,
          originalImportValues: Object.fromEntries(
            Object.entries(row).map(([key, value]) => [key, value == null ? "" : String(value)]),
          ),
          doNotContact: false,
        };
      })
      .filter((c) => c.firstName !== "Unknown" || c.email || c.phone);
  }

  detectDuplicates(
    importedRows: NormalizedCandidateRow[],
    candidateService: CandidateService,
  ): {
    newCandidates: NormalizedCandidateRow[];
    conflicts: DuplicateConflict[];
  } {
    const existingCandidates: Candidate[] = candidateService.getCandidateRepository().list();

    const conflicts: DuplicateConflict[] = [];
    const newCandidates: NormalizedCandidateRow[] = [];

    for (const row of importedRows) {
      let matched = false;

      // Exact email
      if (row.email) {
        const match = existingCandidates.find(
          (c) => c.email.toLowerCase() === row.email!.toLowerCase(),
        );
        if (match) {
          conflicts.push({ type: "exact_email", existingCandidate: match, importedCandidate: row });
          matched = true;
          continue;
        }
      }

      // Exact phone
      if (row.phone) {
        const match = existingCandidates.find((c) => {
          const p1 = c.phone.replace(/[^0-9]/g, "");
          const p2 = row.phone!.replace(/[^0-9]/g, "");
          return p1 && p1 === p2;
        });
        if (match) {
          conflicts.push({ type: "exact_phone", existingCandidate: match, importedCandidate: row });
          matched = true;
          continue;
        }
      }

      // Possible Name + Company
      if (row.firstName && row.lastName && row.currentCompany) {
        const match = existingCandidates.find(
          (c) =>
            c.firstName.toLowerCase() === row.firstName!.toLowerCase() &&
            c.lastName.toLowerCase() === row.lastName!.toLowerCase() &&
            c.currentCompany?.toLowerCase() === row.currentCompany?.toLowerCase(),
        );
        if (match) {
          conflicts.push({
            type: "possible_name_company",
            existingCandidate: match,
            importedCandidate: row,
          });
          matched = true;
          continue;
        }
      }

      if (!matched) {
        newCandidates.push(row);
      }
    }

    return { newCandidates, conflicts };
  }

  commitImportBatch(
    newCandidates: NormalizedCandidateRow[],
    resolvedConflicts: DuplicateConflict[],
    candidateService: CandidateService,
    context: ActorContext,
  ): { inserted: number; updated: number; skipped: number } {
    if (!context.actor.roles.some((role) => role === "HR" || role === "Super Admin")) {
      throw new Error("Only HR or Super Admin can import candidates.");
    }
    const candidateRepo = candidateService.getCandidateRepository();

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    // Insert new
    for (const row of newCandidates) {
      candidateRepo.create(this.toCandidateRecord(row), context);
      inserted++;
    }

    // Process conflicts
    for (const conflict of resolvedConflicts) {
      if (conflict.resolution === "skip" || !conflict.resolution) {
        skipped++;
      } else if (conflict.resolution === "create_separate") {
        candidateRepo.create(this.toCandidateRecord(conflict.importedCandidate), context);
        inserted++;
      } else if (conflict.resolution === "merge") {
        const existing = conflict.existingCandidate;
        const imported = conflict.importedCandidate;

        // Merge strategy: imported data overwrites if present, except stage unless it's a "higher" stage (simplification: just overwrite if present)
        const updates: Partial<Candidate> = {};
        if (imported.phone && !existing.phone) updates.phone = imported.phone;
        if (imported.email && !existing.email) updates.email = imported.email;
        if (imported.currentTitle) updates.currentTitle = imported.currentTitle;
        if (imported.currentCompany) updates.currentCompany = imported.currentCompany;
        if (imported.location) updates.location = imported.location;
        if (imported.yearsOfExperience) updates.yearsOfExperience = imported.yearsOfExperience;
        if (imported.visaStatus) updates.visaStatus = imported.visaStatus;
        if (imported.maritalStatus) updates.maritalStatus = imported.maritalStatus;
        if (imported.shortlistStatus) updates.shortlistStatus = imported.shortlistStatus;
        if (imported.trackerStatus) updates.trackerStatus = imported.trackerStatus;
        if (imported.projectName) updates.projectName = imported.projectName;
        if (imported.projectType) updates.projectType = imported.projectType;
        if (imported.noticePeriod) updates.noticePeriod = imported.noticePeriod;
        if (imported.lastContactAt) updates.lastContactAt = imported.lastContactAt;
        if (imported.interviewDate) updates.interviewDate = imported.interviewDate;
        if (imported.currentSalary) updates.currentSalary = imported.currentSalary;
        if (imported.expectedSalary) updates.expectedSalary = imported.expectedSalary;
        if (imported.acceptedSalary) updates.acceptedSalary = imported.acceptedSalary;
        if (imported.originalImportValues)
          updates.originalImportValues = {
            ...existing.originalImportValues,
            ...imported.originalImportValues,
          };
        if (imported.remarks)
          updates.remarks = (existing.remarks ? existing.remarks + "\n" : "") + imported.remarks;
        if (imported.importProvenance)
          updates.importProvenance =
            (existing.importProvenance ? existing.importProvenance + ", " : "") +
            imported.importProvenance;

        candidateRepo.update(existing.id, updates, context);
        updated++;
      }
    }

    const result = { inserted, updated, skipped };
    getApplicationDataServices().audit.record({
      context,
      action: "import",
      module: "recruitment",
      entityType: "candidate-import-batch",
      entityId: crypto.randomUUID(),
      after: result,
      reason: context.reason || "Candidate spreadsheet import committed",
      riskLevel: "Medium",
    });
    return result;
  }

  private toCandidateRecord(row: NormalizedCandidateRow): NewRecord<Candidate> {
    return {
      firstName: row.firstName || "Unknown",
      lastName: row.lastName || "Candidate",
      email: row.email || "",
      phone: row.phone || "",
      location: row.location || "Unknown",
      yearsOfExperience: row.yearsOfExperience || 0,
      stage: row.stage || "Sourced",
      doNotContact: row.doNotContact ?? false,
      ...(row.nationality ? { nationality: row.nationality } : {}),
      ...(row.currentCompany ? { currentCompany: row.currentCompany } : {}),
      ...(row.currentTitle ? { currentTitle: row.currentTitle } : {}),
      ...(row.visaStatus ? { visaStatus: row.visaStatus } : {}),
      ...(row.maritalStatus ? { maritalStatus: row.maritalStatus } : {}),
      ...(row.shortlistStatus ? { shortlistStatus: row.shortlistStatus } : {}),
      ...(row.trackerStatus ? { trackerStatus: row.trackerStatus } : {}),
      ...(row.projectName ? { projectName: row.projectName } : {}),
      ...(row.projectType ? { projectType: row.projectType } : {}),
      ...(row.noticePeriod ? { noticePeriod: row.noticePeriod } : {}),
      ...(row.lastContactAt ? { lastContactAt: row.lastContactAt } : {}),
      ...(row.interviewDate ? { interviewDate: row.interviewDate } : {}),
      ...(row.currentSalary ? { currentSalary: row.currentSalary } : {}),
      ...(row.expectedSalary ? { expectedSalary: row.expectedSalary } : {}),
      ...(row.acceptedSalary ? { acceptedSalary: row.acceptedSalary } : {}),
      ...(row.remarks ? { remarks: row.remarks } : {}),
      ...(row.source ? { source: row.source } : {}),
      ...(row.originalImportValues ? { originalImportValues: row.originalImportValues } : {}),
      importProvenance: row.importProvenance || `${row._sourceSheet} - Row ${row._sourceRowIndex}`,
    };
  }
}
