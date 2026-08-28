import { SYSTEM_CONTEXT } from "./types.ts";
import * as XLSX from "xlsx";
import type { EmployeeService } from "./employee-service.ts";
import { getMasterDataRepository } from "./master-data.ts";
import type { OnboardingService } from "./onboarding-service.ts";
import { getApplicationDataServices } from "./application-data.ts";
import type {
  ActorContext,
  Employee,
  EmployeeMaritalStatus,
  EmployeeStatus,
  Gender,
} from "./types.ts";

export interface SheetPreview {
  name: string;
  headers: string[];
  rows: Record<string, unknown>[];
  headerRowNumber: number;
}

export type EmployeeStandardField =
  | "employeeNumber"
  | "legalName"
  | "preferredName"
  | "workEmail"
  | "personalEmail"
  | "phone"
  | "department"
  | "position"
  | "grade"
  | "location"
  | "employmentType"
  | "startDate"
  | "probationEndDate"
  | "status"
  | "managerEmployeeNumber"
  | "nationality"
  | "dateOfBirth"
  | "gender"
  | "maritalStatus"
  | "baseMonthly"
  | "currency";

export const STANDARD_FIELDS: { id: EmployeeStandardField; label: string; required?: boolean }[] = [
  { id: "employeeNumber", label: "Employee Number", required: true },
  { id: "legalName", label: "Legal Name", required: true },
  { id: "preferredName", label: "Preferred Name" },
  { id: "workEmail", label: "Work Email", required: true },
  { id: "department", label: "Department", required: true },
  { id: "position", label: "Position", required: true },
  { id: "location", label: "Location", required: true },
  { id: "employmentType", label: "Employment Type", required: true },
  { id: "startDate", label: "Start Date", required: true },
  { id: "managerEmployeeNumber", label: "Manager's Employee Number" },
  { id: "status", label: "Initial Status (Onboarding / Active / Probation)" },
  { id: "personalEmail", label: "Personal Email" },
  { id: "phone", label: "Phone" },
  { id: "grade", label: "Grade" },
  { id: "probationEndDate", label: "Probation End Date" },
  { id: "nationality", label: "Nationality" },
  { id: "dateOfBirth", label: "Date of Birth" },
  { id: "gender", label: "Gender" },
  { id: "maritalStatus", label: "Marital Status" },
  { id: "baseMonthly", label: "Base Monthly Salary" },
  { id: "currency", label: "Currency" },
];

export interface ImportMapping {
  [key: string]: string;
}

export interface NormalizedEmployeeRow {
  _sourceRowIndex: number;
  _sourceSheet: string;
  employeeNumber: string;
  legalName: string;
  preferredName: string;
  workEmail: string;
  personalEmail?: string | undefined;
  phone?: string | undefined;
  department: string;
  position: string;
  grade?: string | undefined;
  location: string;
  employmentType: string;
  startDate: string;
  probationEndDate?: string | undefined;
  status: EmployeeStatus;
  managerEmployeeNumber?: string | undefined;
  nationality?: string | undefined;
  dateOfBirth?: string | undefined;
  gender?: Gender | undefined;
  maritalStatus?: EmployeeMaritalStatus | undefined;
  baseMonthly?: number | undefined;
  currency?: string | undefined;
  /** Problems found while normalizing this row that will block it from being imported. */
  errors: string[];
}

export interface ResolvedImportRow {
  row: NormalizedEmployeeRow;
  lineManagerId?: string | undefined;
  blockingErrors: string[];
}

export interface EmployeeImportResult {
  created: number;
  skipped: { row: NormalizedEmployeeRow; reason: string }[];
}

const BATCH_MANAGER_PREFIX = "__batch__:";

function toIsoDate(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10);
}

/** Returns undefined for a status word this app does not allow entering via bulk import. */
function normalizeStatus(raw: string): EmployeeStatus | undefined {
  const v = raw.trim().toLowerCase();
  if (!v) return "Active";
  if (v.includes("onboard")) return "Onboarding";
  if (v.includes("probation")) return "Probation";
  if (v === "active") return "Active";
  return undefined;
}

function normalizeGender(raw: string): Gender | undefined {
  const v = raw.trim().toLowerCase();
  if (v === "m" || v === "male") return "Male";
  if (v === "f" || v === "female") return "Female";
  return undefined;
}

function normalizeMaritalStatus(raw: string): EmployeeMaritalStatus | undefined {
  const v = raw.trim().toLowerCase();
  if (!v) return undefined;
  if (v.includes("married")) return "Married";
  if (v.includes("divorc")) return "Divorced";
  if (v.includes("widow")) return "Widowed";
  if (v.includes("single")) return "Single";
  return undefined;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class EmployeeImportService {
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
        "employee",
        "name",
        "email",
        "department",
        "position",
        "location",
        "manager",
        "start",
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

    const tryMatch = (field: EmployeeStandardField, keywords: string[]) => {
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

    tryMatch("employeeNumber", ["employeenumber", "empno", "employeeid", "staffid", "empid"]);
    tryMatch("workEmail", ["workemail", "companyemail", "email"]);
    tryMatch("personalEmail", ["personalemail"]);
    tryMatch("legalName", ["legalname", "fullname", "name"]);
    tryMatch("preferredName", ["preferredname", "displayname", "knownas", "nickname"]);
    tryMatch("phone", ["phonenumber", "mobilenumber", "phone", "mobile", "contact"]);
    tryMatch("department", ["department", "dept"]);
    tryMatch("position", ["position", "jobtitle", "title", "role"]);
    tryMatch("grade", ["grade", "jobgrade"]);
    tryMatch("location", ["location", "office", "site", "branch"]);
    tryMatch("employmentType", ["employmenttype", "contracttype"]);
    tryMatch("startDate", ["startdate", "hiredate", "joiningdate", "dateofjoining"]);
    tryMatch("probationEndDate", ["probationend", "probationenddate"]);
    tryMatch("status", ["initialstatus", "employeestatus", "status"]);
    tryMatch("managerEmployeeNumber", [
      "managerempno",
      "manageremployeenumber",
      "manageremployeeid",
      "reportsto",
      "supervisorid",
      "managerid",
    ]);
    tryMatch("nationality", ["nationality", "citizenship"]);
    tryMatch("dateOfBirth", ["dateofbirth", "dob", "birthdate"]);
    tryMatch("gender", ["gender", "sex"]);
    tryMatch("maritalStatus", ["maritalstatus", "marital"]);
    tryMatch("baseMonthly", ["basemonthlysalary", "basemonthly", "basesalary", "monthlysalary"]);
    tryMatch("currency", ["currency"]);

    return mapping;
  }

  normalizeData(
    rows: Record<string, unknown>[],
    sheetName: string,
    mapping: ImportMapping,
    headerRowNumber = 1,
  ): NormalizedEmployeeRow[] {
    return rows
      .map((row, idx) => {
        const getVal = (field: EmployeeStandardField): string => {
          const col = mapping[field];
          if (!col) return "";
          const val = row[col];
          return val != null ? String(val).trim() : "";
        };

        const errors: string[] = [];

        const employeeNumber = getVal("employeeNumber");
        const legalName = getVal("legalName");
        const preferredName = getVal("preferredName") || legalName;
        const workEmail = getVal("workEmail");
        const department = getVal("department");
        const position = getVal("position");
        const location = getVal("location");
        const employmentType = getVal("employmentType") || "Full-time";
        const startDateRaw = getVal("startDate");
        const startDate = toIsoDate(startDateRaw);
        const probationEndDateRaw = getVal("probationEndDate");
        const probationEndDate = toIsoDate(probationEndDateRaw);
        const dateOfBirth = toIsoDate(getVal("dateOfBirth"));
        const statusRaw = getVal("status");
        const status = normalizeStatus(statusRaw);
        const genderRaw = getVal("gender");
        const gender = genderRaw ? normalizeGender(genderRaw) : undefined;
        const maritalStatus = normalizeMaritalStatus(getVal("maritalStatus"));
        const baseMonthlyRaw = getVal("baseMonthly").replace(/[^0-9.]/g, "");
        const baseMonthly = baseMonthlyRaw ? parseFloat(baseMonthlyRaw) : undefined;

        if (!employeeNumber) errors.push("Employee number is required.");
        if (!legalName) errors.push("Legal name is required.");
        if (!workEmail) errors.push("Work email is required.");
        else if (!EMAIL_PATTERN.test(workEmail)) errors.push("Work email is not a valid address.");
        if (!department) errors.push("Department is required.");
        if (!position) errors.push("Position is required.");
        if (!location) errors.push("Location is required.");
        if (!startDateRaw) errors.push("Start date is required.");
        else if (!startDate) errors.push(`Start date "${startDateRaw}" could not be recognized.`);
        if (probationEndDateRaw && !probationEndDate) {
          errors.push(`Probation end date "${probationEndDateRaw}" could not be recognized.`);
        }
        if (statusRaw && !status) {
          errors.push(
            `Status "${statusRaw}" is not allowed for bulk import - only Onboarding, Active or ` +
              "Probation. Use the offboarding workflow after import for any other status.",
          );
        }
        if (genderRaw && !gender) {
          errors.push(`Gender "${genderRaw}" was not recognized (expected Male or Female).`);
        }

        return {
          _sourceRowIndex: idx + headerRowNumber + 1,
          _sourceSheet: sheetName,
          employeeNumber,
          legalName,
          preferredName: preferredName || legalName,
          workEmail,
          personalEmail: getVal("personalEmail") || undefined,
          phone: getVal("phone") || undefined,
          department,
          position,
          grade: getVal("grade") || undefined,
          location,
          employmentType,
          startDate: startDate || startDateRaw,
          probationEndDate,
          status: status ?? "Active",
          managerEmployeeNumber: getVal("managerEmployeeNumber") || undefined,
          nationality: getVal("nationality") || undefined,
          dateOfBirth,
          gender,
          maritalStatus,
          baseMonthly:
            baseMonthly !== undefined && !Number.isNaN(baseMonthly) ? baseMonthly : undefined,
          currency: getVal("currency") || undefined,
          errors,
        };
      })
      .filter((row) => row.employeeNumber || row.legalName || row.workEmail);
  }

  /**
   * Checks every row against existing employees/users and against the rest of the file, and
   * resolves each row's manager reference. A manager may be an existing employee (matched by
   * employee number) or another row in the same file (resolved to a real id at commit time,
   * once that row has actually been created).
   */
  resolveBatch(
    rows: NormalizedEmployeeRow[],
    employeeService: EmployeeService,
  ): ResolvedImportRow[] {
    const existingEmployees = employeeService
      .getEmployeeRepository(SYSTEM_CONTEXT)
      .list({ includeArchived: true });
    const existingByNumber = new Map(
      existingEmployees.map((e) => [e.employeeNumber.toLowerCase(), e]),
    );
    const existingEmailsLower = new Set(
      employeeService
        .getUserRepository(SYSTEM_CONTEXT)
        .list({ includeArchived: true })
        .map((u) => u.workspaceEmail.toLowerCase()),
    );
    const batchHasExistingOrgAlready = existingEmployees.length > 0;

    const numberFirstSeenAt = new Map<string, number>();
    const emailFirstSeenAt = new Map<string, number>();
    const numbersInFile = new Set(
      rows.filter((r) => r.employeeNumber).map((r) => r.employeeNumber.toLowerCase()),
    );

    const resolved: ResolvedImportRow[] = rows.map((row, index) => {
      const blockingErrors = [...row.errors];
      const numberKey = row.employeeNumber.toLowerCase();
      const emailKey = row.workEmail.toLowerCase();

      if (numberKey) {
        if (existingByNumber.has(numberKey)) {
          blockingErrors.push(`Employee number ${row.employeeNumber} already exists.`);
        } else if (numberFirstSeenAt.has(numberKey)) {
          const firstRow = rows[numberFirstSeenAt.get(numberKey)!]!;
          blockingErrors.push(
            `Employee number ${row.employeeNumber} is duplicated within this file (also row ${firstRow._sourceRowIndex}).`,
          );
        } else {
          numberFirstSeenAt.set(numberKey, index);
        }
      }

      if (emailKey) {
        if (existingEmailsLower.has(emailKey)) {
          blockingErrors.push(`Work email ${row.workEmail} is already assigned to a user.`);
        } else if (emailFirstSeenAt.has(emailKey)) {
          const firstRow = rows[emailFirstSeenAt.get(emailKey)!]!;
          blockingErrors.push(
            `Work email ${row.workEmail} is duplicated within this file (also row ${firstRow._sourceRowIndex}).`,
          );
        } else {
          emailFirstSeenAt.set(emailKey, index);
        }
      }

      return { row, blockingErrors };
    });

    // Independently verify department/position/location/employment type against active master
    // data here too - the same rule createEmployee() itself enforces (an exact, case-sensitive
    // name match) - so a row that would fail is caught during Review, with a clear per-row
    // reason, instead of silently failing at commit time after HR has already been told the
    // batch was ready to import. A case-insensitive spreadsheet value ("operations" vs the
    // master-data record's "Operations") is corrected to the record's exact casing rather than
    // rejected outright, since createEmployee's check is exact-match and a purely cosmetic case
    // difference is not a real data problem worth blocking an otherwise-valid row over.
    const activeByLowerName = (collection: Parameters<typeof getMasterDataRepository>[0]) => {
      const map = new Map<string, string>();
      for (const item of getMasterDataRepository(collection).list()) {
        if (item.isActive) map.set(item.name.toLowerCase(), item.name);
      }
      return map;
    };
    const departmentsByLowerName = activeByLowerName("departments");
    const positionsByLowerName = activeByLowerName("positions");
    const locationsByLowerName = activeByLowerName("locations");
    const employmentTypesByLowerName = activeByLowerName("employmentTypes");
    const reconcileMasterDataField = (
      value: string,
      byLowerName: Map<string, string>,
      label: string,
      blockingErrors: string[],
    ): string => {
      const canonical = byLowerName.get(value.toLowerCase());
      if (!canonical) {
        blockingErrors.push(`"${value}" is not an active ${label}.`);
        return value;
      }
      return canonical;
    };
    for (const entry of resolved) {
      if (entry.row.department) {
        entry.row.department = reconcileMasterDataField(
          entry.row.department,
          departmentsByLowerName,
          "department",
          entry.blockingErrors,
        );
      }
      if (entry.row.position) {
        entry.row.position = reconcileMasterDataField(
          entry.row.position,
          positionsByLowerName,
          "position",
          entry.blockingErrors,
        );
      }
      if (entry.row.location) {
        entry.row.location = reconcileMasterDataField(
          entry.row.location,
          locationsByLowerName,
          "location",
          entry.blockingErrors,
        );
      }
      if (entry.row.employmentType) {
        entry.row.employmentType = reconcileMasterDataField(
          entry.row.employmentType,
          employmentTypesByLowerName,
          "employment type",
          entry.blockingErrors,
        );
      }
    }

    for (const entry of resolved) {
      const managerNumber = entry.row.managerEmployeeNumber?.toLowerCase();
      if (!managerNumber) {
        if (batchHasExistingOrgAlready) {
          entry.blockingErrors.push(
            "A manager's employee number is required (this organisation already has employees).",
          );
        }
        continue;
      }
      const existingManager = existingByNumber.get(managerNumber);
      if (existingManager) {
        if (existingManager.status === "Archived") {
          entry.blockingErrors.push(
            `Manager ${entry.row.managerEmployeeNumber} is archived and cannot be assigned.`,
          );
        } else {
          entry.lineManagerId = existingManager.id;
        }
      } else if (numbersInFile.has(managerNumber)) {
        entry.lineManagerId = `${BATCH_MANAGER_PREFIX}${managerNumber}`;
      } else {
        entry.blockingErrors.push(
          `Manager employee number "${entry.row.managerEmployeeNumber}" was not found among existing employees or this file.`,
        );
      }
    }

    return resolved;
  }

  async commitImportBatch(
    resolvedRows: ResolvedImportRow[],
    employeeService: EmployeeService,
    onboardingService: OnboardingService,
    context: ActorContext,
  ): Promise<EmployeeImportResult> {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      throw new Error("Only HR or a Super Admin can import employees.");
    }

    const skipped: { row: NormalizedEmployeeRow; reason: string }[] = [];
    let created = 0;

    const createdIdByNumber = new Map<string, string>();
    const remaining = new Set(resolvedRows.filter((entry) => entry.blockingErrors.length === 0));
    for (const entry of resolvedRows) {
      if (entry.blockingErrors.length > 0) {
        skipped.push({ row: entry.row, reason: entry.blockingErrors.join(" ") });
      }
    }

    let progressed = true;
    while (remaining.size > 0 && progressed) {
      progressed = false;
      for (const entry of [...remaining]) {
        let lineManagerId = entry.lineManagerId;
        if (lineManagerId?.startsWith(BATCH_MANAGER_PREFIX)) {
          const managerNumber = lineManagerId.slice(BATCH_MANAGER_PREFIX.length);
          const resolvedId = createdIdByNumber.get(managerNumber);
          if (!resolvedId) continue;
          lineManagerId = resolvedId;
        }

        try {
          const employeeInput: Omit<
            Employee,
            | "id"
            | "createdAt"
            | "createdBy"
            | "updatedAt"
            | "updatedBy"
            | "recordVersion"
            | "archivedAt"
          > = {
            employeeNumber: entry.row.employeeNumber,
            legalName: entry.row.legalName,
            preferredName: entry.row.preferredName,
            workEmail: entry.row.workEmail,
            personalEmail: entry.row.personalEmail,
            phone: entry.row.phone,
            department: entry.row.department,
            position: entry.row.position,
            grade: entry.row.grade,
            location: entry.row.location,
            employmentType: entry.row.employmentType,
            startDate: entry.row.startDate,
            probationEndDate: entry.row.probationEndDate,
            status: entry.row.status,
            lineManagerId,
            nationality: entry.row.nationality,
            dateOfBirth: entry.row.dateOfBirth,
            gender: entry.row.gender,
            maritalStatus: entry.row.maritalStatus,
            salary: entry.row.baseMonthly
              ? { baseMonthly: entry.row.baseMonthly, currency: entry.row.currency || "OMR" }
              : undefined,
          };

          const { employee } = await employeeService.createEmployee(
            employeeInput,
            ["Employee"],
            context,
          );
          createdIdByNumber.set(entry.row.employeeNumber.toLowerCase(), employee.id);
          if (entry.row.status === "Onboarding") {
            onboardingService.createCaseForEmployee(employee.id, context);
          }
          created += 1;
        } catch (error) {
          skipped.push({
            row: entry.row,
            reason: error instanceof Error ? error.message : "Failed to create employee.",
          });
        }
        remaining.delete(entry);
        progressed = true;
      }
    }

    for (const entry of remaining) {
      skipped.push({
        row: entry.row,
        reason:
          "Could not resolve this row's manager chain - check for a circular manager reference within the file.",
      });
    }

    const result: EmployeeImportResult = { created, skipped };
    getApplicationDataServices().audit.record({
      context,
      action: "import",
      module: "core-hr",
      entityType: "employee-import-batch",
      entityId: crypto.randomUUID(),
      after: { created, skipped: skipped.length },
      reason: context.reason || "Employee spreadsheet import committed",
      riskLevel: "High",
    });

    return result;
  }
}
