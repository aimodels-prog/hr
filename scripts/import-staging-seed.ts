/* eslint-disable @typescript-eslint/no-explicit-any -- Drizzle client and transaction share a runtime API but not one public executor type. */
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { eq } from "drizzle-orm";

import type { AttendancePolicy } from "../src/lib/data/attendance-types.ts";
import { createSeedCollections, SEED_SYSTEM_USER_ID } from "../src/lib/data/seeds.ts";
import type {
  TrainingCourse,
  TrainingEnrollment,
  TrainingRequest,
  TrainingSession,
} from "../src/lib/data/training-types.ts";
import type {
  AppSettings,
  AuditEvent,
  BaseRecord,
  Employee,
  EmployeeDocument,
  MasterRecord,
  Notification,
  Project,
  Role,
  User,
  Vacancy,
} from "../src/lib/data/types.ts";
import { closeDatabaseConnection, getDatabaseClient } from "../src/lib/db/client.ts";
import { decryptSensitiveJson, encryptSensitiveJson } from "../src/lib/db/encryption.server.ts";
import * as schema from "../src/lib/db/schema/index.ts";

export const IMPORT_SEED_VERSION = "1.0.0";
export const IMPORT_NAMESPACE = "1b671a64-40d5-491e-99b0-da01ff1f3341";

type ImportMode = "preview" | "apply" | "verify";
type ImportStatus = "OK" | "WOULD INSERT" | "MISSING" | "CONFLICT";

export interface ImportReportRow {
  sourceCollection: string;
  targetTable: string;
  sourceCount: number;
  insertedCount: number;
  unchangedCount: number;
  conflictCount: number;
  status: ImportStatus;
  countsTowardSource: boolean;
}

interface ImportSummary {
  mode: ImportMode;
  seedVersion: string;
  datasetChecksum: string;
  reports: ImportReportRow[];
  batchId?: string;
  durationMs: number;
}

interface ReconcileOptions<TDesired extends { id: string }, TExisting extends { id: string }> {
  sourceCollection: string;
  targetTable: string;
  desired: TDesired[];
  loadExisting: () => Promise<TExisting[]>;
  insertRows: (rows: TDesired[]) => Promise<void>;
  naturalKeys?: (row: TDesired | TExisting) => string[];
  prepareExisting?: (row: TExisting) => Record<string, unknown>;
  ignoredComparisonKeys?: string[];
  apply: boolean;
  verify: boolean;
  countsTowardSource?: boolean;
}

class ImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportValidationError";
  }
}

function uuidBytes(uuid: string): Buffer {
  const compact = uuid.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/i.test(compact)) throw new Error("Invalid importer namespace UUID.");
  return Buffer.from(compact, "hex");
}

/** RFC 4122 UUIDv5, stable for the same collection and browser record ID. */
export function generateDeterministicUuid(collection: string, browserId: string): string {
  const digest = createHash("sha1")
    .update(uuidBytes(IMPORT_NAMESPACE))
    .update(Buffer.from(`${collection}:${browserId}`, "utf8"))
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, canonical(nested)]),
    );
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonical(value));
}

export function computeDatasetChecksum(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function collection<T>(state: Record<string, unknown[]>, name: string): T[] {
  const records = state[name];
  if (!Array.isArray(records))
    throw new ImportValidationError(`Seed collection ${name} is missing.`);
  return records as T[];
}

function actorId(id: string): string {
  return generateDeterministicUuid("users", id === "system" ? SEED_SYSTEM_USER_ID : id);
}

function mutable(record: BaseRecord) {
  return {
    createdAt: new Date(record.createdAt),
    createdBy: actorId(record.createdBy),
    updatedAt: new Date(record.updatedAt),
    updatedBy: actorId(record.updatedBy),
    archivedAt: record.archivedAt ? new Date(record.archivedAt) : null,
    recordVersion: record.recordVersion,
  };
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase("en");
}

const metadataKeys = new Set(["createdAt", "createdBy", "updatedAt", "updatedBy"]);

function comparable(
  desired: Record<string, unknown>,
  existing: Record<string, unknown>,
  ignored: string[],
): [unknown, unknown] {
  const ignoredKeys = new Set([...metadataKeys, "id", ...ignored]);
  const keys = Object.keys(desired).filter(
    (key) => !ignoredKeys.has(key) && Object.hasOwn(existing, key),
  );
  return [
    Object.fromEntries(keys.map((key) => [key, desired[key] ?? null])),
    Object.fromEntries(keys.map((key) => [key, existing[key] ?? null])),
  ];
}

async function reconcile<TDesired extends { id: string }, TExisting extends { id: string }>(
  options: ReconcileOptions<TDesired, TExisting>,
): Promise<ImportReportRow> {
  if (new Set(options.desired.map((row) => row.id)).size !== options.desired.length) {
    throw new ImportValidationError(`${options.sourceCollection} contains duplicate IDs.`);
  }
  const existing = await options.loadExisting();
  const byId = new Map(existing.map((row) => [row.id, row]));
  const natural = new Map<string, string>();
  if (options.naturalKeys) {
    for (const row of existing) {
      for (const key of options.naturalKeys(row)) natural.set(key, row.id);
    }
  }
  const missing: TDesired[] = [];
  const conflicts: string[] = [];
  let unchangedCount = 0;
  for (const desired of options.desired) {
    const found = byId.get(desired.id);
    if (found) {
      const prepared = options.prepareExisting
        ? options.prepareExisting(found)
        : (found as Record<string, unknown>);
      const [left, right] = comparable(
        desired as Record<string, unknown>,
        prepared,
        options.ignoredComparisonKeys ?? [],
      );
      if (stableStringify(left) === stableStringify(right)) unchangedCount += 1;
      else conflicts.push(desired.id);
      continue;
    }
    const collision = options
      .naturalKeys?.(desired)
      .map((key) => natural.get(key))
      .find(Boolean);
    if (collision) conflicts.push(`${desired.id} collides with ${collision}`);
    else missing.push(desired);
  }
  const status: ImportStatus =
    conflicts.length > 0
      ? "CONFLICT"
      : options.verify && missing.length > 0
        ? "MISSING"
        : missing.length > 0
          ? "WOULD INSERT"
          : "OK";
  const report: ImportReportRow = {
    sourceCollection: options.sourceCollection,
    targetTable: options.targetTable,
    sourceCount: options.desired.length,
    insertedCount: options.apply ? missing.length : 0,
    unchangedCount,
    conflictCount: conflicts.length,
    status: options.apply && conflicts.length === 0 ? "OK" : status,
    countsTowardSource: options.countsTowardSource ?? true,
  };
  if (conflicts.length > 0) {
    throw new ImportValidationError(
      `${options.sourceCollection} conflicts with existing records (${conflicts.join(", ")}). Existing data was not overwritten.`,
    );
  }
  if (options.apply && missing.length > 0) await options.insertRows(missing);
  return report;
}

function emptyReport(
  state: Record<string, unknown[]>,
  sourceCollection: string,
  targetTable: string,
): ImportReportRow {
  const records = collection<unknown>(state, sourceCollection);
  if (records.length > 0) {
    throw new ImportValidationError(
      `${sourceCollection} contains ${records.length} unsupported record(s). Import stopped rather than dropping them.`,
    );
  }
  return {
    sourceCollection,
    targetTable,
    sourceCount: 0,
    insertedCount: 0,
    unchangedCount: 0,
    conflictCount: 0,
    status: "OK",
    countsTowardSource: true,
  };
}

function databaseUrl(): URL {
  const raw = process.env["DATABASE_URL"]?.trim();
  if (!raw) throw new ImportValidationError("DATABASE_URL must be configured.");
  let value: URL;
  try {
    value = new URL(raw);
  } catch {
    throw new ImportValidationError("DATABASE_URL is invalid.");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(value.protocol)) {
    throw new ImportValidationError("DATABASE_URL must use PostgreSQL.");
  }
  return value;
}

function modeFromArgs(args: string[]): ImportMode {
  const modes = ["--preview", "--apply", "--verify"].filter((flag) => args.includes(flag));
  if (modes.length > 1) throw new ImportValidationError("Choose only one import mode.");
  return args.includes("--apply") ? "apply" : args.includes("--verify") ? "verify" : "preview";
}

async function execute(mode: ImportMode): Promise<{
  reports: ImportReportRow[];
  checksum: string;
  batchId?: string;
}> {
  const apply = mode === "apply";
  const verify = mode === "verify";
  const state = createSeedCollections();
  const checksum = computeDatasetChecksum(state);
  const settings = collection<AppSettings>(state, "appSettings");
  if (settings.length !== 1)
    throw new ImportValidationError("Exactly one appSettings row is required.");
  const app = settings[0]!;
  const organisationId = generateDeterministicUuid("organisations", "via-international");
  const systemUserId = actorId(SEED_SYSTEM_USER_ID);
  const reports: ImportReportRow[] = [];
  const db = getDatabaseClient();

  const run = async (executor: any) => {
    const add = async <D extends { id: string }, E extends { id: string }>(
      options: Omit<ReconcileOptions<D, E>, "apply" | "verify">,
    ) => reports.push(await reconcile({ ...options, apply, verify }));

    const organisationRows = [
      {
        id: organisationId,
        name: app.organisationName,
        slug: "via-international",
        isActive: true,
        ...mutable(app),
      },
    ];
    await add({
      sourceCollection: "organisations (derived)",
      targetTable: "organisations",
      desired: organisationRows,
      loadExisting: () => executor.select().from(schema.organisations),
      insertRows: async (rows) => void (await executor.insert(schema.organisations).values(rows)),
      naturalKeys: (row) => [`slug:${normalized((row as { slug: string }).slug)}`],
      countsTowardSource: false,
    });

    const settingRows = settings.map((item) => ({
      id: generateDeterministicUuid("appSettings", item.id),
      organisationId,
      timezone: item.timezone,
      baseCurrency: item.baseCurrency,
      workingDays: item.workingDays,
      standardDailyHours: item.standardDailyHours.toFixed(2),
      standardWeeklyHours: item.standardWeeklyHours.toFixed(2),
      leaveYearStart: item.leaveYearStart,
      leaveYearEnd: item.leaveYearEnd,
      documentReminderDays: item.documentReminderDays,
      employeeNumberFormat: item.employeeNumberFormat,
      candidateReferenceFormat: item.candidateReferenceFormat,
      schemaVersion: item.schemaVersion,
      requireOnboardingCompletionBeforeDashboard: item.requireOnboardingCompletionBeforeDashboard,
      additionalSettings: { organisationName: item.organisationName },
      ...mutable(item),
    }));
    await add({
      sourceCollection: "appSettings",
      targetTable: "app_settings",
      desired: settingRows,
      loadExisting: () =>
        executor
          .select()
          .from(schema.appSettings)
          .where(eq(schema.appSettings.organisationId, organisationId)),
      insertRows: async (rows) => void (await executor.insert(schema.appSettings).values(rows)),
      naturalKeys: () => [`org:${organisationId}`],
    });

    const policies = collection<AttendancePolicy>(state, "attendancePolicies");
    const policyRows = policies.map((item) => ({
      id: generateDeterministicUuid("attendancePolicies", item.id),
      organisationId,
      standardDailyHours: item.standardDailyHours.toFixed(2),
      expectedClockIn: item.expectedClockIn,
      expectedClockOut: item.expectedClockOut,
      defaultBreakMinutes: item.defaultBreakMinutes,
      lateGraceMinutes: item.lateGraceMinutes,
      maximumLocationAccuracyMeters: item.maximumLocationAccuracyMeters,
      signOutReminderOffsetsMinutes: [...item.signOutReminderOffsetsMinutes],
      ...mutable(item),
    }));
    await add({
      sourceCollection: "attendancePolicies",
      targetTable: "attendance_policies",
      desired: policyRows,
      loadExisting: () =>
        executor
          .select()
          .from(schema.attendancePolicies)
          .where(eq(schema.attendancePolicies.organisationId, organisationId)),
      insertRows: async (rows) =>
        void (await executor.insert(schema.attendancePolicies).values(rows)),
      naturalKeys: () => [`org:${organisationId}`],
    });

    const masterTables = [
      ["departments", "departments", schema.departments],
      ["locations", "locations", schema.locations],
      ["costCentres", "cost_centres", schema.costCentres],
      ["positions", "positions", schema.positions],
      ["grades", "grades", schema.grades],
      ["employmentTypes", "employment_types", schema.employmentTypes],
      ["activityCodes", "activity_codes", schema.activityCodes],
    ] as const;
    const masterMaps = new Map<string, Map<string, string>>();
    for (const [sourceName, tableName, table] of masterTables) {
      const source = collection<MasterRecord>(state, sourceName);
      const rows = source.map((item) => ({
        id: generateDeterministicUuid(sourceName, item.id),
        organisationId,
        name: item.name,
        code: item.code?.trim() || null,
        description: item.description ?? null,
        isActive: item.isActive,
        orderIndex: item.orderIndex,
        ...mutable(item),
      }));
      const map = new Map<string, string>();
      for (const row of rows) {
        const key = normalized(row.name);
        if (map.has(key))
          throw new ImportValidationError(`${sourceName} has duplicate name ${row.name}.`);
        map.set(key, row.id);
      }
      masterMaps.set(sourceName, map);
      await add({
        sourceCollection: sourceName,
        targetTable: tableName,
        desired: rows,
        loadExisting: () =>
          executor.select().from(table).where(eq(table.organisationId, organisationId)),
        insertRows: async (missing) => void (await executor.insert(table).values(missing)),
        naturalKeys: (row) => {
          const value = row as { name: string; code: string | null };
          return [
            `name:${normalized(value.name)}`,
            ...(value.code ? [`code:${normalized(value.code)}`] : []),
          ];
        },
      });
    }
    const masterId = (name: string, value: string): string => {
      const map = masterMaps.get(name)!;
      const key = normalized(value);
      const exact = map.get(key);
      if (exact) return exact;
      const partial = [...map].filter(([candidate]) => candidate.startsWith(`${key},`));
      if (partial.length === 1) return partial[0]![1];
      throw new ImportValidationError(`${name} has no unique match for ${value}.`);
    };

    const projects = collection<Project>(state, "projects");
    const projectRows = projects.map((item) => ({
      id: generateDeterministicUuid("projects", item.id),
      organisationId,
      name: item.name,
      code: item.code?.trim() || null,
      description: item.description ?? null,
      isActive: item.isActive,
      orderIndex: item.orderIndex,
      client: item.client ?? null,
      type: item.type ?? null,
      locationId: item.location ? masterId("locations", item.location) : null,
      startDate: item.startDate ?? null,
      endDate: item.endDate ?? null,
      costCentreId: item.costCentreId
        ? generateDeterministicUuid("costCentres", item.costCentreId)
        : null,
      managerId: null,
      additionalAttributes: {},
      ...mutable(item),
    }));
    await add({
      sourceCollection: "projects",
      targetTable: "projects",
      desired: projectRows,
      loadExisting: () =>
        executor
          .select()
          .from(schema.projects)
          .where(eq(schema.projects.organisationId, organisationId)),
      insertRows: async (rows) => void (await executor.insert(schema.projects).values(rows)),
      naturalKeys: (row) => [`name:${normalized((row as { name: string }).name)}`],
      ignoredComparisonKeys: ["managerId"],
    });

    const employees = collection<Employee>(state, "employees");
    const employeeRows = employees.map((item) => ({
      id: generateDeterministicUuid("employees", item.id),
      organisationId,
      employeeNumber: item.employeeNumber,
      legalName: item.legalName,
      preferredName: item.preferredName,
      workEmail: normalized(item.workEmail),
      personalEmail: item.personalEmail ? normalized(item.personalEmail) : null,
      phone: item.phone ?? null,
      departmentId: masterId("departments", item.department),
      positionId: masterId("positions", item.position),
      gradeId: item.grade ? masterId("grades", item.grade) : null,
      locationId: masterId("locations", item.location),
      employmentTypeId: masterId("employmentTypes", item.employmentType),
      workingTimeId: null,
      lineManagerId: null,
      projectId: item.projectId ? generateDeterministicUuid("projects", item.projectId) : null,
      costCentreId: item.costCentreId
        ? generateDeterministicUuid("costCentres", item.costCentreId)
        : null,
      country: item.country ?? null,
      legalEntity: item.legalEntity ?? null,
      startDate: item.startDate,
      probationEndDate: item.probationEndDate ?? null,
      workspaceEmail: item.workspaceEmail ? normalized(item.workspaceEmail) : null,
      candidateId: null,
      offerId: null,
      status: item.status,
      address: item.address ?? null,
      emergencyContacts: item.emergencyContacts ?? [],
      dependants: item.dependants ?? [],
      dateOfBirth: item.dateOfBirth ?? null,
      gender: item.gender ?? null,
      nationality: item.nationality ?? null,
      maritalStatus: item.maritalStatus ?? null,
      terminationDate: item.terminationDate ?? null,
      terminationReason: item.terminationReason ?? null,
      weeklyHours: item.weeklyHours == null ? null : item.weeklyHours.toFixed(2),
      performanceRating: item.performanceRating == null ? null : item.performanceRating.toFixed(2),
      performanceNotes: item.performanceNotes ?? null,
      ...mutable(item),
    }));
    await add({
      sourceCollection: "employees",
      targetTable: "employees",
      desired: employeeRows,
      loadExisting: () =>
        executor
          .select()
          .from(schema.employees)
          .where(eq(schema.employees.organisationId, organisationId)),
      insertRows: async (rows) => void (await executor.insert(schema.employees).values(rows)),
      naturalKeys: (row) => {
        const value = row as { employeeNumber: string; workEmail: string };
        return [
          `number:${normalized(value.employeeNumber)}`,
          `email:${normalized(value.workEmail)}`,
        ];
      },
      ignoredComparisonKeys: ["lineManagerId"],
    });

    const reportingRows = employees
      .filter((item) => item.lineManagerId)
      .map((item) => ({
        id: generateDeterministicUuid("employeeReportingLines", item.id),
        organisationId,
        employeeId: generateDeterministicUuid("employees", item.id),
        supervisorId: generateDeterministicUuid("employees", item.lineManagerId!),
        effectiveFrom: item.startDate,
        effectiveTo: null,
        isPrimary: true,
        reason: "Initial reporting line from the VIA staging dataset",
        ...mutable(item),
      }));
    await add({
      sourceCollection: "employees.reportingLines (derived)",
      targetTable: "employee_reporting_lines",
      desired: reportingRows,
      loadExisting: () =>
        executor
          .select()
          .from(schema.employeeReportingLines)
          .where(eq(schema.employeeReportingLines.organisationId, organisationId)),
      insertRows: async (rows) => {
        await executor.insert(schema.employeeReportingLines).values(rows);
        for (const row of rows) {
          await executor
            .update(schema.employees)
            .set({ lineManagerId: row.supervisorId })
            .where(eq(schema.employees.id, row.employeeId));
        }
      },
      naturalKeys: (row) => [`employee:${(row as { employeeId: string }).employeeId}`],
      countsTowardSource: false,
    });

    const derivedEncrypted = async (
      sourceName: string,
      tableName: string,
      table: any,
      rows: Array<Record<string, unknown> & { id: string; plaintext: unknown }>,
      encryptedColumn: string,
    ) =>
      add({
        sourceCollection: sourceName,
        targetTable: tableName,
        desired: rows,
        loadExisting: async () => {
          const found = await executor
            .select()
            .from(table)
            .where(eq(table.organisationId, organisationId));
          return found.map((row: Record<string, unknown> & { id: string }) => ({
            ...row,
            plaintext: decryptSensitiveJson(String(row[encryptedColumn])),
          }));
        },
        insertRows: async (missing) =>
          void (await executor
            .insert(table)
            .values(missing.map(({ plaintext: _plaintext, ...row }) => row))),
        naturalKeys: (row) => [`employee:${String(row.employeeId)}`],
        ignoredComparisonKeys: [encryptedColumn],
        countsTowardSource: false,
      });
    await derivedEncrypted(
      "employees.compensation (derived)",
      "employee_compensation",
      schema.employeeCompensation,
      employees
        .filter((item) => item.salary)
        .map((item) => ({
          id: generateDeterministicUuid("employeeCompensation", item.id),
          organisationId,
          employeeId: generateDeterministicUuid("employees", item.id),
          encryptedPayload: encryptSensitiveJson(item.salary),
          plaintext: item.salary,
          ...mutable(item),
        })),
      "encryptedPayload",
    );
    await derivedEncrypted(
      "employees.bankDetails (derived)",
      "employee_bank_details",
      schema.employeeBankDetails,
      employees
        .filter((item) => item.bankDetails)
        .map((item) => ({
          id: generateDeterministicUuid("employeeBankDetails", item.id),
          organisationId,
          employeeId: generateDeterministicUuid("employees", item.id),
          encryptedPayload: encryptSensitiveJson(item.bankDetails),
          plaintext: item.bankDetails,
          ...mutable(item),
        })),
      "encryptedPayload",
    );
    const identifierRows = employees
      .filter((item) => item.passportNumber || item.nationalId || item.socialInsuranceNumber)
      .map((item) => ({
        id: generateDeterministicUuid("employeeSensitiveIdentifiers", item.id),
        organisationId,
        employeeId: generateDeterministicUuid("employees", item.id),
        passportNumberEncrypted: item.passportNumber
          ? encryptSensitiveJson(item.passportNumber)
          : null,
        nationalIdEncrypted: item.nationalId ? encryptSensitiveJson(item.nationalId) : null,
        socialInsuranceNumberEncrypted: item.socialInsuranceNumber
          ? encryptSensitiveJson(item.socialInsuranceNumber)
          : null,
        passport: item.passportNumber ?? null,
        nationalId: item.nationalId ?? null,
        socialInsurance: item.socialInsuranceNumber ?? null,
        ...mutable(item),
      }));
    await add({
      sourceCollection: "employees.sensitiveIdentifiers (derived)",
      targetTable: "employee_sensitive_identifiers",
      desired: identifierRows,
      loadExisting: async () => {
        const found = await executor
          .select()
          .from(schema.employeeSensitiveIdentifiers)
          .where(eq(schema.employeeSensitiveIdentifiers.organisationId, organisationId));
        return found.map((row: any) => ({
          ...row,
          passport: row.passportNumberEncrypted
            ? decryptSensitiveJson(row.passportNumberEncrypted)
            : null,
          nationalId: row.nationalIdEncrypted
            ? decryptSensitiveJson(row.nationalIdEncrypted)
            : null,
          socialInsurance: row.socialInsuranceNumberEncrypted
            ? decryptSensitiveJson(row.socialInsuranceNumberEncrypted)
            : null,
        }));
      },
      insertRows: async (rows) =>
        void (await executor
          .insert(schema.employeeSensitiveIdentifiers)
          .values(
            rows.map(({ passport: _p, nationalId: _n, socialInsurance: _s, ...row }) => row),
          )),
      naturalKeys: (row) => [`employee:${String(row.employeeId)}`],
      ignoredComparisonKeys: [
        "passportNumberEncrypted",
        "nationalIdEncrypted",
        "socialInsuranceNumberEncrypted",
      ],
      countsTowardSource: false,
    });

    const users = collection<User>(state, "users");
    const usedRoles = [...new Set(users.flatMap((user) => user.roles))];
    const descriptions: Record<Role, string> = {
      Employee: "Standard employee self-service access",
      "Line Manager": "Direct-report supervision and first-stage approvals",
      HR: "People operations administration and approvals",
      Accounts: "Payroll and financial workflow access",
      "Super Admin": "Organisation-wide configuration and final authority",
      IT: "Technology and equipment onboarding responsibilities",
    };
    const existingRoles = await executor.select().from(schema.roles);
    const existingRoleIds = new Map<Role, string>(
      existingRoles.map((row: { code: Role; id: string }) => [row.code, row.id]),
    );
    const roleId = (role: Role) =>
      existingRoleIds.get(role) ?? generateDeterministicUuid("roles", role);
    const roleRows = usedRoles.map((role) => ({
      id: roleId(role),
      code: role,
      description: descriptions[role],
      isAssignable: true,
      isProtected: true,
      createdAt: new Date(app.createdAt),
      createdBy: systemUserId,
      updatedAt: new Date(app.updatedAt),
      updatedBy: systemUserId,
      archivedAt: null,
      recordVersion: 1,
    }));
    await add({
      sourceCollection: "roles (derived)",
      targetTable: "roles",
      desired: roleRows,
      loadExisting: async () => existingRoles,
      insertRows: async (rows) => void (await executor.insert(schema.roles).values(rows)),
      naturalKeys: (row) => [`code:${String((row as { code: Role }).code)}`],
      countsTowardSource: false,
    });
    const userRows = users.map((item) => {
      if (!item.employeeId) throw new ImportValidationError(`User ${item.id} has no employee.`);
      return {
        id: generateDeterministicUuid("users", item.id),
        organisationId,
        employeeId: generateDeterministicUuid("employees", item.employeeId),
        displayName: item.displayName,
        workspaceEmail: normalized(item.workspaceEmail),
        workspaceSubject: item.workspaceSubject ?? null,
        status: item.status,
        ...mutable(item),
      };
    });
    await add({
      sourceCollection: "users",
      targetTable: "users",
      desired: userRows,
      loadExisting: () =>
        executor.select().from(schema.users).where(eq(schema.users.organisationId, organisationId)),
      insertRows: async (rows) => void (await executor.insert(schema.users).values(rows)),
      naturalKeys: (row) => {
        const value = row as { employeeId: string; workspaceEmail: string };
        return [`employee:${value.employeeId}`, `email:${normalized(value.workspaceEmail)}`];
      },
    });
    const assignmentRows = users.flatMap((user) =>
      user.roles.map((role) => ({
        id: `${generateDeterministicUuid("users", user.id)}:${roleId(role)}`,
        organisationId,
        userId: generateDeterministicUuid("users", user.id),
        roleId: roleId(role),
        assignedAt: new Date(user.createdAt),
        assignedBy: systemUserId,
        reason: "Initial role assignment from the VIA staging dataset",
      })),
    );
    await add({
      sourceCollection: "users.roles (derived)",
      targetTable: "user_roles",
      desired: assignmentRows,
      loadExisting: async () => {
        const found = await executor
          .select()
          .from(schema.userRoles)
          .where(eq(schema.userRoles.organisationId, organisationId));
        return found.map((row: any) => ({ ...row, id: `${row.userId}:${row.roleId}` }));
      },
      insertRows: async (rows) =>
        void (await executor
          .insert(schema.userRoles)
          .values(rows.map(({ id: _id, ...row }) => row))),
      naturalKeys: (row) => [`assignment:${row.id}`],
      ignoredComparisonKeys: ["assignedAt", "assignedBy", "reason"],
      countsTowardSource: false,
    });

    if (apply) {
      for (const project of projects.filter((item) => item.managerId)) {
        await executor
          .update(schema.projects)
          .set({ managerId: generateDeterministicUuid("employees", project.managerId!) })
          .where(eq(schema.projects.id, generateDeterministicUuid("projects", project.id)));
      }
    }

    const vacancies = collection<Vacancy>(state, "vacancies");
    const vacancyRows = vacancies.map((item) => ({
      id: generateDeterministicUuid("vacancies", item.id),
      organisationId,
      title: item.title,
      departmentId: masterId("departments", item.department),
      locationId: masterId("locations", item.location),
      positionId: masterId("positions", item.position),
      gradeId: masterId("grades", item.grade),
      employmentTypeId: masterId("employmentTypes", item.employmentType),
      hiringManagerId: item.hiringManagerId
        ? generateDeterministicUuid("employees", item.hiringManagerId)
        : null,
      projectId: item.projectId ? generateDeterministicUuid("projects", item.projectId) : null,
      targetStartDate: item.targetStartDate ?? null,
      assignedOwnerId: item.assignedOwnerId
        ? generateDeterministicUuid("employees", item.assignedOwnerId)
        : null,
      status: item.status,
      summary: item.summary,
      responsibilities: item.responsibilities,
      requirements: item.requirements,
      applicantCount: item.applicantCount,
      headcount: item.headcount,
      salaryRangeEncrypted: item.salaryRange ? encryptSensitiveJson(item.salaryRange) : null,
      salaryPlaintext: item.salaryRange ?? null,
      salaryVisibleToPublic: item.salaryRange?.visibleToPublic ?? false,
      hiringReason: item.hiringReason,
      education: item.education,
      minimumExperience: item.minimumExperience,
      skills: item.skills,
      certifications: item.certifications,
      languages: item.languages,
      mandatoryCriteria: item.mandatoryCriteria ?? null,
      notes: item.notes,
      screeningQuestions: item.screeningQuestions,
      ...mutable(item),
    }));
    await add({
      sourceCollection: "vacancies",
      targetTable: "vacancies",
      desired: vacancyRows,
      loadExisting: async () => {
        const found = await executor
          .select()
          .from(schema.vacancies)
          .where(eq(schema.vacancies.organisationId, organisationId));
        return found.map((row: any) => ({
          ...row,
          salaryPlaintext: row.salaryRangeEncrypted
            ? decryptSensitiveJson(row.salaryRangeEncrypted)
            : null,
        }));
      },
      insertRows: async (rows) =>
        void (await executor
          .insert(schema.vacancies)
          .values(rows.map(({ salaryPlaintext: _plain, ...row }) => row))),
      naturalKeys: (row) => [`title:${normalized(String(row.title))}`],
      ignoredComparisonKeys: ["salaryRangeEncrypted"],
    });

    const documents = collection<EmployeeDocument>(state, "employee_documents");
    const fileRows = documents.map((item) => ({
      id: generateDeterministicUuid("fileMetadata", item.fileId),
      organisationId,
      name: `${item.type.replaceAll("_", " ")}-${item.employeeId}.pdf`,
      mimeType: "application/pdf",
      size: 1,
      checksum: createHash("sha256").update(item.fileId).digest("hex"),
      storageKey: `seed/${item.fileId}`,
      storageStatus: "Pending Upload" as const,
      ownerEntityType: "EmployeeDocument",
      ownerEntityId: generateDeterministicUuid("employee_documents", item.id),
      ...mutable(item),
    }));
    await add({
      sourceCollection: "employee_documents.files (derived)",
      targetTable: "file_metadata",
      desired: fileRows,
      loadExisting: () =>
        executor
          .select()
          .from(schema.fileMetadata)
          .where(eq(schema.fileMetadata.organisationId, organisationId)),
      insertRows: async (rows) => void (await executor.insert(schema.fileMetadata).values(rows)),
      naturalKeys: (row) => [`storage:${String(row.storageKey)}`],
      countsTowardSource: false,
    });
    const documentRows = documents.map((item) => ({
      id: generateDeterministicUuid("employee_documents", item.id),
      organisationId,
      employeeId: generateDeterministicUuid("employees", item.employeeId),
      type: item.type,
      fileId: generateDeterministicUuid("fileMetadata", item.fileId),
      documentNumberEncrypted: item.documentNumber
        ? encryptSensitiveJson(item.documentNumber)
        : null,
      documentNumberPlaintext: item.documentNumber ?? null,
      issueDate: item.issueDate ?? null,
      expiryDate: item.expiryDate ?? null,
      issuingAuthority: item.issuingAuthority ?? null,
      issuingCountry: item.issuingCountry ?? null,
      notes: item.notes ?? null,
      visibility: item.visibility,
      status: item.status,
      rejectionReason: item.rejectionReason ?? null,
      replacedById: item.replacedById
        ? generateDeterministicUuid("employee_documents", item.replacedById)
        : null,
      assignedOwnerId: item.assignedOwnerId
        ? generateDeterministicUuid("employees", item.assignedOwnerId)
        : null,
      snoozedUntil: item.snoozedUntil ?? null,
      snoozeReason: item.snoozeReason ?? null,
      waiverReason: item.waiverReason ?? null,
      ...mutable(item),
    }));
    await add({
      sourceCollection: "employee_documents",
      targetTable: "employee_documents",
      desired: documentRows,
      loadExisting: async () => {
        const found = await executor
          .select()
          .from(schema.employeeDocuments)
          .where(eq(schema.employeeDocuments.organisationId, organisationId));
        return found.map((row: any) => ({
          ...row,
          documentNumberPlaintext: row.documentNumberEncrypted
            ? decryptSensitiveJson(row.documentNumberEncrypted)
            : null,
        }));
      },
      insertRows: async (rows) =>
        void (await executor
          .insert(schema.employeeDocuments)
          .values(rows.map(({ documentNumberPlaintext: _plain, ...row }) => row))),
      naturalKeys: (row) => [`file:${String(row.fileId)}`],
      ignoredComparisonKeys: ["documentNumberEncrypted"],
    });

    const courses = collection<TrainingCourse>(state, "training_courses");
    const courseRows = courses.map((item) => ({
      id: generateDeterministicUuid("training_courses", item.id),
      organisationId,
      code: item.code,
      title: item.title,
      description: item.description,
      provider: item.provider,
      category: item.category,
      deliveryType: item.deliveryType,
      durationHours: item.durationHours.toFixed(2),
      cost: item.cost.toFixed(2),
      currency: item.currency,
      validityMonths: item.validityMonths ?? null,
      renewalIntervalMonths: item.renewalIntervalMonths ?? null,
      requiredRoles: item.requiredRoles,
      requiredLocations: item.requiredLocations.map((name) => masterId("locations", name)),
      requiredProjects: item.requiredProjects.map((id) =>
        generateDeterministicUuid("projects", id),
      ),
      isMandatory: item.isMandatory,
      isActive: item.isActive,
      ...mutable(item),
    }));
    await add({
      sourceCollection: "training_courses",
      targetTable: "training_courses",
      desired: courseRows,
      loadExisting: () =>
        executor
          .select()
          .from(schema.trainingCourses)
          .where(eq(schema.trainingCourses.organisationId, organisationId)),
      insertRows: async (rows) => void (await executor.insert(schema.trainingCourses).values(rows)),
      naturalKeys: (row) => [`code:${normalized(String(row.code))}`],
    });

    const requests = collection<TrainingRequest>(state, "training_requests");
    const requestRows = requests.map((item) => ({
      id: generateDeterministicUuid("training_requests", item.id),
      organisationId,
      employeeId: generateDeterministicUuid("employees", item.employeeId),
      courseId: generateDeterministicUuid("training_courses", item.courseId),
      origin: item.origin,
      reason: item.reason,
      status: item.status,
      supervisorDecisionAt: item.supervisorDecisionAt ?? null,
      supervisorDecisionBy: item.supervisorDecisionBy
        ? generateDeterministicUuid("users", item.supervisorDecisionBy)
        : null,
      supervisorComment: item.supervisorComment ?? null,
      hrDecisionAt: item.hrDecisionAt ?? null,
      hrDecisionBy: item.hrDecisionBy
        ? generateDeterministicUuid("users", item.hrDecisionBy)
        : null,
      hrComment: item.hrComment ?? null,
      rejectionReason: item.rejectionReason ?? null,
      ...mutable(item),
    }));
    await add({
      sourceCollection: "training_requests",
      targetTable: "training_requests",
      desired: requestRows,
      loadExisting: () =>
        executor
          .select()
          .from(schema.trainingRequests)
          .where(eq(schema.trainingRequests.organisationId, organisationId)),
      insertRows: async (rows) =>
        void (await executor.insert(schema.trainingRequests).values(rows)),
    });

    const sessions = collection<TrainingSession>(state, "training_sessions");
    const sessionRows = sessions.map((item) => ({
      id: generateDeterministicUuid("training_sessions", item.id),
      organisationId,
      courseId: generateDeterministicUuid("training_courses", item.courseId),
      title: item.title,
      startAt: item.startAt,
      endAt: item.endAt,
      location: item.location,
      facilitator: item.facilitator,
      capacity: item.capacity,
      status: item.status,
      ...mutable(item),
    }));
    await add({
      sourceCollection: "training_sessions",
      targetTable: "training_sessions",
      desired: sessionRows,
      loadExisting: () =>
        executor
          .select()
          .from(schema.trainingSessions)
          .where(eq(schema.trainingSessions.organisationId, organisationId)),
      insertRows: async (rows) =>
        void (await executor.insert(schema.trainingSessions).values(rows)),
    });

    const enrollments = collection<TrainingEnrollment>(state, "training_enrollments");
    const enrollmentRows = enrollments.map((item) => ({
      id: generateDeterministicUuid("training_enrollments", item.id),
      organisationId,
      employeeId: generateDeterministicUuid("employees", item.employeeId),
      courseId: generateDeterministicUuid("training_courses", item.courseId),
      requestId: item.requestId
        ? generateDeterministicUuid("training_requests", item.requestId)
        : null,
      sessionId: item.sessionId
        ? generateDeterministicUuid("training_sessions", item.sessionId)
        : null,
      status: item.status,
      assignedBy: generateDeterministicUuid("users", item.assignedBy),
      assignedAt: item.assignedAt,
      attendanceRecordedAt: item.attendanceRecordedAt ?? null,
      attendanceRecordedBy: item.attendanceRecordedBy
        ? generateDeterministicUuid("users", item.attendanceRecordedBy)
        : null,
      completionDate: item.completionDate ?? null,
      result: item.result ?? null,
      actualCost: item.actualCost == null ? null : item.actualCost.toFixed(2),
      cancellationReason: item.cancellationReason ?? null,
      ...mutable(item),
    }));
    await add({
      sourceCollection: "training_enrollments",
      targetTable: "training_assignments",
      desired: enrollmentRows,
      loadExisting: () =>
        executor
          .select()
          .from(schema.trainingAssignments)
          .where(eq(schema.trainingAssignments.organisationId, organisationId)),
      insertRows: async (rows) =>
        void (await executor.insert(schema.trainingAssignments).values(rows)),
      naturalKeys: (row) => [
        `assignment:${String(row.employeeId)}:${String(row.courseId)}:${String(row.sessionId)}`,
      ],
    });

    const notifications = collection<Notification>(state, "notifications");
    const notificationRows = notifications.map((item) => ({
      id: generateDeterministicUuid("notifications", item.id),
      organisationId,
      recipientUserId: generateDeterministicUuid("users", item.recipientUserId),
      type: item.type,
      title: item.title,
      message: item.message,
      priority: item.priority,
      status: item.status,
      dueAt: item.dueAt ?? null,
      readAt: item.readAt ?? null,
      dismissedAt: item.dismissedAt ?? null,
      deduplicationKey: item.deduplicationKey ?? null,
      link: item.link
        ? {
            ...item.link,
            entityId: generateDeterministicUuid(item.link.entityType, item.link.entityId),
          }
        : null,
      ...mutable(item),
    }));
    await add({
      sourceCollection: "notifications",
      targetTable: "notifications",
      desired: notificationRows,
      loadExisting: () =>
        executor
          .select()
          .from(schema.notifications)
          .where(eq(schema.notifications.organisationId, organisationId)),
      insertRows: async (rows) => void (await executor.insert(schema.notifications).values(rows)),
      naturalKeys: (row) =>
        row.deduplicationKey
          ? [`dedupe:${String(row.recipientUserId)}:${String(row.deduplicationKey)}`]
          : [],
    });

    const audits = collection<AuditEvent>(state, "auditEvents");
    const auditRows = audits.map((item) => ({
      id: generateDeterministicUuid("auditEvents", item.id),
      organisationId,
      occurredAt: item.occurredAt,
      actorUserId: actorId(item.actor.userId),
      actorEmployeeId: item.actor.employeeId
        ? generateDeterministicUuid("employees", item.actor.employeeId)
        : null,
      actorDisplayName: item.actor.displayName,
      activeRole: item.actor.activeRole ?? null,
      actorRoles: item.actor.roles,
      sessionId: item.actor.sessionId
        ? generateDeterministicUuid("sessions", item.actor.sessionId)
        : null,
      action: item.action,
      module: item.module,
      entityType: item.entityType,
      entityId: generateDeterministicUuid(item.entityType, item.entityId),
      beforeSummary: item.before ?? null,
      afterSummary: item.after ?? null,
      reason: item.reason ?? null,
      riskLevel: item.riskLevel,
      ipAddress: null,
      userAgent: null,
    }));
    await add({
      sourceCollection: "auditEvents",
      targetTable: "audit_events",
      desired: auditRows,
      loadExisting: () =>
        executor
          .select()
          .from(schema.auditEvents)
          .where(eq(schema.auditEvents.organisationId, organisationId)),
      insertRows: async (rows) => void (await executor.insert(schema.auditEvents).values(rows)),
    });

    for (const [sourceName, tableName] of [
      ["attendanceRecords", "attendance_records"],
      ["attendanceCorrections", "attendance_corrections"],
      ["attendanceSiteVisits", "site_visit_requests"],
      ["candidates", "candidates"],
      ["applications", "candidate_applications"],
      ["training_records", "training_records"],
      ["reportSavedViews", "app_settings.additional_settings"],
    ] as const) {
      reports.push(emptyReport(state, sourceName, tableName));
    }
  };

  if (!apply) {
    await run(db);
    if (verify && reports.some((report) => report.status !== "OK")) {
      throw new ImportValidationError("Verification failed because seed records are missing.");
    }
    return { reports, checksum };
  }

  const batchId = randomUUID();
  const startedAt = new Date();
  try {
    await db.transaction(async (transaction) => {
      await run(transaction);
      const counted = reports.filter((report) => report.countsTowardSource);
      const totalRows = counted.reduce((sum, report) => sum + report.sourceCount, 0);
      const inserted = counted.reduce((sum, report) => sum + report.insertedCount, 0);
      const unchanged = counted.reduce((sum, report) => sum + report.unchangedCount, 0);
      const completedAt = new Date();
      await transaction.insert(schema.importBatches).values({
        id: batchId,
        organisationId,
        module: "Staging Seed",
        status: "Completed",
        source: "src/lib/data/seeds.ts",
        seedVersion: IMPORT_SEED_VERSION,
        datasetChecksum: checksum,
        totalRows,
        validRows: inserted,
        unchangedRows: unchanged,
        rejectedRows: 0,
        warnings: [],
        errors: [],
        completedAt: completedAt.toISOString(),
        createdAt: startedAt,
        createdBy: systemUserId,
        updatedAt: completedAt,
        updatedBy: systemUserId,
        recordVersion: 1,
      });
      await transaction.insert(schema.auditEvents).values([
        {
          id: randomUUID(),
          organisationId,
          occurredAt: startedAt.toISOString(),
          actorUserId: systemUserId,
          actorDisplayName: "VIA staging importer",
          activeRole: "Super Admin",
          actorRoles: ["Super Admin"],
          action: "import.started",
          module: "System",
          entityType: "ImportBatch",
          entityId: batchId,
          afterSummary: { seedVersion: IMPORT_SEED_VERSION, checksum, totalRows },
          reason: "Started deterministic staging-data import",
          riskLevel: "High",
        },
        {
          id: randomUUID(),
          organisationId,
          occurredAt: completedAt.toISOString(),
          actorUserId: systemUserId,
          actorDisplayName: "VIA staging importer",
          activeRole: "Super Admin",
          actorRoles: ["Super Admin"],
          action: "import.completed",
          module: "System",
          entityType: "ImportBatch",
          entityId: batchId,
          afterSummary: { totalRows, inserted, unchanged, rejected: 0 },
          reason: "Completed deterministic staging-data import",
          riskLevel: "High",
        },
      ]);
      if (
        process.env["NODE_ENV"] === "test" &&
        process.env["VIA_HR_IMPORT_TEST_FAIL_AT_END"] === "1"
      ) {
        throw new Error("Injected end-of-import failure for atomicity verification.");
      }
    });
  } catch (error) {
    const existingOrg = await db
      .select({ id: schema.organisations.id })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, organisationId));
    if (existingOrg.length > 0) {
      const failedAt = new Date();
      const message = error instanceof Error ? error.message : "Unknown failure";
      await db.transaction(async (transaction) => {
        await transaction.insert(schema.importBatches).values({
          id: batchId,
          organisationId,
          module: "Staging Seed",
          status: "Failed",
          source: "src/lib/data/seeds.ts",
          seedVersion: IMPORT_SEED_VERSION,
          datasetChecksum: checksum,
          totalRows: Object.values(state).reduce((sum, records) => sum + records.length, 0),
          validRows: 0,
          unchangedRows: 0,
          rejectedRows: 0,
          warnings: [],
          errors: [{ message }],
          completedAt: failedAt.toISOString(),
          createdAt: startedAt,
          createdBy: systemUserId,
          updatedAt: failedAt,
          updatedBy: systemUserId,
          recordVersion: 1,
        });
        await transaction.insert(schema.auditEvents).values({
          id: randomUUID(),
          organisationId,
          occurredAt: failedAt.toISOString(),
          actorUserId: systemUserId,
          actorDisplayName: "VIA staging importer",
          activeRole: "Super Admin",
          actorRoles: ["Super Admin"],
          action: "import.failed",
          module: "System",
          entityType: "ImportBatch",
          entityId: batchId,
          afterSummary: { seedVersion: IMPORT_SEED_VERSION, checksum },
          reason: message.slice(0, 500),
          riskLevel: "Critical",
        });
      });
    }
    throw error;
  }
  return { reports, checksum, batchId };
}

function printSummary(summary: ImportSummary, url: URL): void {
  console.log("=== VIA HR deterministic staging-data importer ===");
  console.log(`Mode: ${summary.mode.toUpperCase()}`);
  console.log(`Database: ${url.hostname}/${url.pathname.slice(1)}`);
  console.log(`Seed version: ${summary.seedVersion}`);
  console.log(`Dataset checksum: ${summary.datasetChecksum}`);
  console.table(summary.reports.map(({ countsTowardSource: _counted, ...report }) => report));
  const counted = summary.reports.filter((report) => report.countsTowardSource);
  console.log(
    `Source records: ${counted.reduce((sum, report) => sum + report.sourceCount, 0)} | Inserted: ${counted.reduce((sum, report) => sum + report.insertedCount, 0)} | Unchanged: ${counted.reduce((sum, report) => sum + report.unchangedCount, 0)} | Conflicts: ${counted.reduce((sum, report) => sum + report.conflictCount, 0)}`,
  );
  if (summary.batchId) console.log(`Import batch: ${summary.batchId}`);
  console.log(`Duration: ${summary.durationMs} ms`);
}

export async function runImporter(mode: ImportMode): Promise<ImportSummary> {
  const url = databaseUrl();
  const started = Date.now();
  try {
    const result = await execute(mode);
    const summary = {
      mode,
      seedVersion: IMPORT_SEED_VERSION,
      datasetChecksum: result.checksum,
      reports: result.reports,
      batchId: result.batchId,
      durationMs: Date.now() - started,
    };
    printSummary(summary, url);
    return summary;
  } finally {
    await closeDatabaseConnection();
  }
}

async function main(): Promise<void> {
  const mode = modeFromArgs(process.argv.slice(2));
  try {
    await runImporter(mode);
    console.log(
      mode === "apply"
        ? "[IMPORT COMPLETE] All mapped seed records committed atomically."
        : mode === "verify"
          ? "[VERIFY COMPLETE] Every mapped seed record matches PostgreSQL."
          : "[PREVIEW COMPLETE] Read-only preview finished; no data was written.",
    );
  } catch (error) {
    console.error(
      `[${mode.toUpperCase()} FAILED] ${error instanceof Error ? error.message : "Unknown error"}`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
