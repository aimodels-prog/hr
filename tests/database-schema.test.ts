import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";

import { getTableName } from "drizzle-orm";
import postgres from "postgres";

import {
  decryptSensitiveJson,
  encryptSensitiveJson,
  FieldEncryptionConfigurationError,
  isEncryptedFieldEnvelope,
} from "../src/lib/db/encryption.server.ts";
import {
  activityCodes,
  appSettings,
  costCentres,
  currencies,
  departments,
  employeeBankDetails,
  employeeCompensation,
  employeeReportingLines,
  employees,
  employeeSensitiveIdentifiers,
  employmentTypes,
  grades,
  locations,
  organisations,
  positions,
  projects,
  publicHolidays,
  roles,
  systemRoleCode,
  userRoles,
  users,
  workingTimes,
} from "../src/lib/db/schema/index.ts";

const originalKeyring = process.env["VIA_HR_FIELD_ENCRYPTION_KEYS"];
const originalActiveKey = process.env["VIA_HR_ACTIVE_FIELD_ENCRYPTION_KEY_ID"];

function restoreEncryptionEnvironment(): void {
  if (originalKeyring === undefined) delete process.env["VIA_HR_FIELD_ENCRYPTION_KEYS"];
  else process.env["VIA_HR_FIELD_ENCRYPTION_KEYS"] = originalKeyring;
  if (originalActiveKey === undefined) {
    delete process.env["VIA_HR_ACTIVE_FIELD_ENCRYPTION_KEY_ID"];
  } else {
    process.env["VIA_HR_ACTIVE_FIELD_ENCRYPTION_KEY_ID"] = originalActiveKey;
  }
}

function configureTestEncryption(): void {
  process.env["VIA_HR_ACTIVE_FIELD_ENCRYPTION_KEY_ID"] = "test-v1";
  process.env["VIA_HR_FIELD_ENCRYPTION_KEYS"] = JSON.stringify({
    "test-v1": randomBytes(32).toString("base64"),
  });
}

afterEach(restoreEncryptionEnvironment);

test("H3.2 exports every foundational database table", () => {
  const tableNames = [
    organisations,
    appSettings,
    departments,
    locations,
    costCentres,
    positions,
    grades,
    employmentTypes,
    workingTimes,
    publicHolidays,
    currencies,
    activityCodes,
    projects,
    employees,
    employeeReportingLines,
    users,
    roles,
    userRoles,
    employeeSensitiveIdentifiers,
    employeeCompensation,
    employeeBankDetails,
  ].map(getTableName);

  assert.equal(tableNames.length, 21);
  assert.equal(new Set(tableNames).size, tableNames.length);
  assert.deepEqual(systemRoleCode.enumValues, [
    "Employee",
    "Line Manager",
    "HR",
    "Accounts",
    "Super Admin",
    "IT",
  ]);
});

test("sensitive employee values use authenticated, non-plaintext envelopes", () => {
  configureTestEncryption();
  const value = {
    passportNumber: "P12345678",
    nationalId: "NID-987654",
    baseMonthly: 2_450,
    iban: "OM0000000000000000000000",
  };
  const encrypted = encryptSensitiveJson(value);

  assert.equal(isEncryptedFieldEnvelope(encrypted), true);
  assert.equal(encrypted.includes(value.passportNumber), false);
  assert.equal(encrypted.includes(value.iban), false);
  assert.deepEqual(decryptSensitiveJson<typeof value>(encrypted), value);

  const envelopeParts = encrypted.split(".");
  const ciphertext = Buffer.from(envelopeParts[4]!, "base64url");
  ciphertext[0] = ciphertext[0]! ^ 1;
  envelopeParts[4] = ciphertext.toString("base64url");
  assert.throws(
    () => decryptSensitiveJson(envelopeParts.join(".")),
    /could not be authenticated or decrypted/,
  );
});

test("field encryption refuses missing or malformed server keys", () => {
  delete process.env["VIA_HR_ACTIVE_FIELD_ENCRYPTION_KEY_ID"];
  delete process.env["VIA_HR_FIELD_ENCRYPTION_KEYS"];
  assert.throws(() => encryptSensitiveJson({ salary: 1 }), FieldEncryptionConfigurationError);

  process.env["VIA_HR_ACTIVE_FIELD_ENCRYPTION_KEY_ID"] = "v1";
  process.env["VIA_HR_FIELD_ENCRYPTION_KEYS"] = JSON.stringify({ v1: "too-short" });
  assert.throws(() => encryptSensitiveJson({ salary: 1 }), /exactly 32 bytes/);
});

test(
  "fresh H3.2 database round-trips an employee while raw SQL sees only ciphertext",
  { skip: !process.env["VIA_HR_TEST_DATABASE_URL"] },
  async () => {
    configureTestEncryption();
    const client = postgres(process.env["VIA_HR_TEST_DATABASE_URL"]!, { max: 1, prepare: false });
    const actorId = randomUUID();
    const organisationId = randomUUID();
    const departmentId = randomUUID();
    const locationId = randomUUID();
    const positionId = randomUUID();
    const employmentTypeId = randomUUID();
    const managerId = randomUUID();
    const employeeId = randomUUID();
    const userId = randomUUID();
    const salary = { baseMonthly: 2450, currency: "OMR", payFrequency: "Monthly" };
    const bank = {
      bankName: "Bank Muscat",
      accountNumber: "001122334455",
      iban: "OM0000000011223344550000",
    };
    const identifiers = { passportNumber: "P12345678", nationalId: "NID-987654" };

    try {
      await client.begin(async (transaction) => {
        await transaction`INSERT INTO organisations (id, created_by, updated_by, name, slug) VALUES (${organisationId}, ${actorId}, ${actorId}, 'VIA Schema Test', ${`via-schema-${organisationId}`})`;
        await transaction`INSERT INTO departments (id, created_by, updated_by, organisation_id, name, code) VALUES (${departmentId}, ${actorId}, ${actorId}, ${organisationId}, 'People Operations', 'HR')`;
        await transaction`INSERT INTO locations (id, created_by, updated_by, organisation_id, name, code) VALUES (${locationId}, ${actorId}, ${actorId}, ${organisationId}, 'Muscat Office', 'MCT')`;
        await transaction`INSERT INTO positions (id, created_by, updated_by, organisation_id, name, code, department_id) VALUES (${positionId}, ${actorId}, ${actorId}, ${organisationId}, 'HR Specialist', 'HRS', ${departmentId})`;
        await transaction`INSERT INTO employment_types (id, created_by, updated_by, organisation_id, name, code) VALUES (${employmentTypeId}, ${actorId}, ${actorId}, ${organisationId}, 'Full-time', 'FT')`;
        await transaction`INSERT INTO employees (id, created_by, updated_by, organisation_id, employee_number, legal_name, preferred_name, work_email, department_id, position_id, location_id, employment_type_id, start_date, status) VALUES (${managerId}, ${actorId}, ${actorId}, ${organisationId}, 'VIA-T001', 'Schema Manager', 'Schema Manager', 'schema.manager@via.test', ${departmentId}, ${positionId}, ${locationId}, ${employmentTypeId}, '2026-01-01', 'Active')`;
        await transaction`INSERT INTO employees (id, created_by, updated_by, organisation_id, employee_number, legal_name, preferred_name, work_email, department_id, position_id, location_id, employment_type_id, line_manager_id, start_date, status) VALUES (${employeeId}, ${actorId}, ${actorId}, ${organisationId}, 'VIA-T002', 'Schema Employee', 'Schema Employee', 'schema.employee@via.test', ${departmentId}, ${positionId}, ${locationId}, ${employmentTypeId}, ${managerId}, '2026-02-01', 'Active')`;
        await transaction`INSERT INTO employee_reporting_lines (created_by, updated_by, organisation_id, employee_id, supervisor_id, effective_from, reason) VALUES (${actorId}, ${actorId}, ${organisationId}, ${employeeId}, ${managerId}, '2026-02-01', 'Initial supervisor assignment')`;
        await transaction`INSERT INTO users (id, created_by, updated_by, organisation_id, employee_id, display_name, workspace_email) VALUES (${userId}, ${actorId}, ${actorId}, ${organisationId}, ${employeeId}, 'Schema Employee', 'schema.employee@via.test')`;

        const encryptedSalary = encryptSensitiveJson(salary);
        const encryptedBank = encryptSensitiveJson(bank);
        const encryptedIdentifiers = encryptSensitiveJson(identifiers);
        await transaction`INSERT INTO employee_compensation (created_by, updated_by, organisation_id, employee_id, encrypted_payload) VALUES (${actorId}, ${actorId}, ${organisationId}, ${employeeId}, ${encryptedSalary})`;
        await transaction`INSERT INTO employee_bank_details (created_by, updated_by, organisation_id, employee_id, encrypted_payload) VALUES (${actorId}, ${actorId}, ${organisationId}, ${employeeId}, ${encryptedBank})`;
        await transaction`INSERT INTO employee_sensitive_identifiers (created_by, updated_by, organisation_id, employee_id, passport_number_encrypted, national_id_encrypted) VALUES (${actorId}, ${actorId}, ${organisationId}, ${employeeId}, ${encryptSensitiveJson(identifiers.passportNumber)}, ${encryptSensitiveJson(identifiers.nationalId)})`;

        const [raw] = await transaction<
          {
            encrypted_payload: string;
          }[]
        >`SELECT encrypted_payload FROM employee_compensation WHERE employee_id = ${employeeId}`;
        assert.ok(raw);
        assert.equal(raw.encrypted_payload.includes(String(salary.baseMonthly)), false);
        assert.deepEqual(decryptSensitiveJson<typeof salary>(raw.encrypted_payload), salary);

        const [defaultRole] = await transaction<
          {
            code: string;
          }[]
        >`SELECT roles.code FROM user_roles JOIN roles ON roles.id = user_roles.role_id WHERE user_roles.user_id = ${userId}`;
        assert.equal(defaultRole?.code, "Employee");

        await transaction`INSERT INTO user_roles (organisation_id, user_id, role_id, assigned_by, reason)
          SELECT ${organisationId}, ${userId}, roles.id, ${actorId}, 'Role assignment verification'
          FROM roles WHERE roles.code <> 'Employee'`;
        const assignedRoles = await transaction<{ code: string }[]>`
          SELECT roles.code FROM user_roles
          JOIN roles ON roles.id = user_roles.role_id
          WHERE user_roles.user_id = ${userId}
          ORDER BY roles.code`;
        assert.deepEqual(
          assignedRoles.map((role) => role.code),
          ["Employee", "Line Manager", "HR", "Accounts", "Super Admin", "IT"],
        );

        await assert.rejects(
          transaction`UPDATE employees SET line_manager_id = ${employeeId} WHERE id = ${managerId}`,
          /management cycle/,
        );
        throw new Error("ROLLBACK_H3_2_SCHEMA_TEST");
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "ROLLBACK_H3_2_SCHEMA_TEST") throw error;
    } finally {
      await client.end({ timeout: 5 });
    }
  },
);
