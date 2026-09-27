import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { closeDatabaseConnection } from "../src/lib/db/client.ts";
import { saveObjectFile } from "../src/lib/db/object-storage.server.ts";
import type { AuditActorContext } from "../src/lib/db/repositories/master-data.repository.server.ts";
import {
  listPayslips,
  listPayslipHistory,
  payslipForReplacement,
  publishPayslip,
  readPayslip,
  replacePayslip,
  removeUnassignedPayslipFile,
} from "../src/lib/db/repositories/payslip.repository.server.ts";

const databaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (databaseUrl) process.env["DATABASE_URL"] = databaseUrl;

test(
  "payslip corrections retain private version history and replace atomically",
  { skip: !databaseUrl },
  async (t) => {
    assert.match(new URL(databaseUrl!).pathname.toLowerCase(), /(test|scratch)/);
    const query = postgres(databaseUrl!, { max: 4, prepare: false });
    const org = randomUUID(),
      author = randomUUID();
    const department = randomUUID(),
      position = randomUUID(),
      location = randomUUID(),
      employmentType = randomUUID();
    try {
      await query`INSERT INTO organisations (id,name,slug,is_active,created_by,updated_by)
      VALUES (${org},'Payslip test',${`payslip-${org}`},false,${author},${author})`;
      for (const [table, id] of [
        ["departments", department],
        ["positions", position],
        ["locations", location],
        ["employment_types", employmentType],
      ] as const) {
        await query.unsafe(
          `INSERT INTO ${table} (id,organisation_id,name,code,is_active,order_index,created_by,updated_by)
        VALUES ($1,$2,'Test','TEST',true,1,$3,$3)`,
          [id, org, author],
        );
      }
      const person = async (role: AuditActorContext["activeRole"]): Promise<AuditActorContext> => {
        const employeeId = randomUUID(),
          userId = randomUUID();
        await query`INSERT INTO employees (id,organisation_id,employee_number,legal_name,preferred_name,work_email,
        department_id,position_id,location_id,employment_type_id,status,start_date,created_by,updated_by)
        VALUES (${employeeId},${org},${employeeId},${role},${role},${`${employeeId}@viahr.test`},
          ${department},${position},${location},${employmentType},'Active','2019-01-01',${author},${author})`;
        await query`INSERT INTO users (id,organisation_id,employee_id,display_name,workspace_email,status,created_by,updated_by)
        VALUES (${userId},${org},${employeeId},${role},${`${employeeId}@viahr.test`},'Active',${author},${author})`;
        return {
          userId,
          employeeId,
          displayName: role,
          activeRole: role,
          roles: ["Employee", role],
        };
      };
      const finance = await person("Accounts"),
        secondFinance = await person("Accounts"),
        employee = await person("Employee");
      const hr = await person("HR"),
        admin = await person("Super Admin"),
        manager = await person("Line Manager");
      const file = async (owner = employee.employeeId!, mime = "application/pdf") => {
        const id = randomUUID();
        await query`INSERT INTO file_metadata (id,organisation_id,name,mime_type,size,checksum,storage_key,storage_status,owner_entity_type,owner_entity_id,created_by,updated_by)
        VALUES (${id},${org},'payslip.pdf',${mime},4,'test-checksum',${`tests/payslip/${id}`},'Available','employee-payslip',${owner},${finance.userId!},${finance.userId!})`;
        return id;
      };
      let month = 0;
      const fixture = async (owner = employee.employeeId!) => {
        const fileId = await file(owner),
          payMonth = `2026-${String(++month).padStart(2, "0")}`;
        const id = await publishPayslip(org, { employeeId: owner, payMonth, fileId }, finance);
        return { id, payMonth, fileId, expectedVersion: 1 };
      };
      const row = async (id: string) =>
        (await query`SELECT * FROM employee_payslips WHERE id=${id}`)[0]!;

      await t.test(
        "only Finance can replace or inspect history; organisation and version are checked",
        async () => {
          const slip = await fixture(),
            fileId = await file();
          for (const actor of [
            employee,
            hr,
            admin,
            manager,
            { ...finance, activeRole: "Employee" as const },
          ]) {
            await assert.rejects(
              replacePayslip(org, { ...slip, fileId, reason: "Correct amount" }, actor),
              /Finance role/,
            );
            await assert.rejects(listPayslipHistory(org, slip.id, actor), /Finance role/);
            await assert.rejects(payslipForReplacement(org, slip.id, 1, actor), /Finance role/);
          }
          await assert.rejects(
            replacePayslip(randomUUID(), { ...slip, fileId, reason: "Correct amount" }, finance),
            /not found/,
          );
          await assert.rejects(listPayslipHistory(randomUUID(), slip.id, finance), /not found/);
          await assert.rejects(payslipForReplacement(org, slip.id, 9, finance), /changed/);
          await assert.rejects(
            replacePayslip(
              org,
              { ...slip, expectedVersion: 9, fileId, reason: "Correct amount" },
              finance,
            ),
            /changed/,
          );
          await assert.rejects(
            replacePayslip(org, { ...slip, fileId, reason: "  " }, finance),
            /reason/,
          );
          for (const invalid of [
            await file(finance.employeeId!),
            await file(employee.employeeId!, "image/png"),
            randomUUID(),
          ]) {
            await assert.rejects(
              replacePayslip(org, { ...slip, fileId: invalid, reason: "Correct amount" }, finance),
              /unavailable/,
            );
          }
          await assert.rejects(
            replacePayslip(org, { ...slip, reason: "Reuse original" }, finance),
            /new PDF/,
          );
          const archived = await file();
          await query`UPDATE file_metadata SET archived_at=now(),record_version=record_version+1 WHERE id=${archived}`;
          await assert.rejects(
            replacePayslip(org, { ...slip, fileId: archived, reason: "Correct amount" }, finance),
            /unavailable/,
          );
          assert.equal((await row(slip.id)).archived_at, null);
          assert.equal((await row(slip.id)).record_version, 1);
        },
      );

      await t.test(
        "simultaneous replacements have one winner, one audit and one employee notice",
        async () => {
          const slip = await fixture(),
            first = await file(),
            second = await file();
          const results = await Promise.allSettled([
            replacePayslip(
              org,
              { ...slip, fileId: first, reason: "Correct tax calculation" },
              finance,
            ),
            replacePayslip(
              org,
              { ...slip, fileId: second, reason: "Correct allowance" },
              secondFinance,
            ),
          ]);
          const winners = results.filter(
            (r): r is PromiseFulfilledResult<string> => r.status === "fulfilled",
          );
          assert.equal(winners.length, 1);
          const loser = results.find((r): r is PromiseRejectedResult => r.status === "rejected")!;
          assert.match(loser.reason.message, /changed/);
          const current = await row(winners[0]!.value),
            original = await row(slip.id);
          assert.equal(original.file_id, slip.fileId);
          assert.ok(original.archived_at);
          assert.equal(original.record_version, 2);
          assert.equal(current.replaces_payslip_id, slip.id);
          assert.equal(current.revision, 2);
          assert.equal(current.employee_id, employee.employeeId);
          assert.equal(current.pay_month, slip.payMonth);
          assert.equal(current.archived_at, null);
          assert.equal(
            (await listPayslips(org, employee, "self")).slips.filter(
              (s) => s.payMonth === slip.payMonth,
            ).length,
            1,
          );
          assert.equal(
            (await listPayslips(org, employee, "self")).slips.find(
              (s) => s.payMonth === slip.payMonth,
            )!.id,
            current.id,
          );
          assert.equal(
            (await listPayslips(org, employee, "self")).slips.some(
              (s) => "reason" in s || "replacementReason" in s,
            ),
            false,
          );
          const events =
            await query`SELECT * FROM audit_events WHERE organisation_id=${org} AND action='payslip-replaced' AND entity_id=${current.id}`;
          assert.equal(events.length, 1);
          assert.equal(events[0]!.before_summary.fileId, slip.fileId);
          assert.equal(events[0]!.after_summary.fileId, current.file_id);
          assert.equal(events[0]!.reason, current.replacement_reason);
          const notices =
            await query`SELECT * FROM notifications WHERE organisation_id=${org} AND type='payslip_replaced' AND link->>'entityId'=${current.id}`;
          assert.equal(notices.length, 1);
          assert.equal(notices[0]!.recipient_user_id, employee.userId);
          assert.equal(notices[0]!.link.path, "/staff/payslips");
          const history = await listPayslipHistory(org, current.id, finance);
          assert.deepEqual(
            history.map((s) => [s.revision, s.current]),
            [
              [2, true],
              [1, false],
            ],
          );
          await assert.rejects(readPayslip(org, slip.id, employee), /cannot access/);
          await assert.rejects(readPayslip(org, current.id, manager), /cannot access/);
          await assert.rejects(readPayslip(randomUUID(), current.id, finance), /cannot access/);
          await assert.rejects(
            replacePayslip(org, { ...slip, fileId: await file(), reason: "Stale screen" }, finance),
            /changed/,
          );
          await assert.rejects(
            publishPayslip(
              org,
              { employeeId: employee.employeeId!, payMonth: slip.payMonth, fileId: await file() },
              finance,
            ),
            /already exists/,
          );
          const third = await replacePayslip(
            org,
            {
              id: current.id,
              expectedVersion: 1,
              fileId: await file(),
              reason: "Final corrected allowance",
            },
            finance,
          );
          assert.equal((await row(third)).revision, 3);
          assert.deepEqual(
            (await listPayslipHistory(org, slip.id, finance)).map((s) => s.revision),
            [3, 2, 1],
          );
        },
      );

      await t.test("a database failure rolls back superseding the original", async () => {
        const slip = await fixture(),
          newFile = await file();
        // Fail the insert after the old row is archived, scoped to this fixture only.
        const constraint = `test_payslip_failure_${randomUUID().replaceAll("-", "")}`;
        await query.unsafe(
          `ALTER TABLE employee_payslips ADD CONSTRAINT ${constraint} CHECK (file_id <> '${newFile}')`,
        );
        try {
          await assert.rejects(
            replacePayslip(org, { ...slip, fileId: newFile, reason: "Correct pay" }, finance),
          );
          assert.equal((await row(slip.id)).archived_at, null);
          assert.equal((await row(slip.id)).record_version, 1);
          assert.equal((await listPayslipHistory(org, slip.id, finance)).length, 1);
          assert.equal(
            (
              await query`SELECT * FROM audit_events WHERE organisation_id=${org} AND action='payslip-replaced' AND before_summary->>'id'=${slip.id}`
            ).length,
            0,
          );
        } finally {
          await query.unsafe(`ALTER TABLE employee_payslips DROP CONSTRAINT ${constraint}`);
        }
      });

      await t.test("Finance still sees its own current payslip in self-service", async () => {
        const slip = await fixture(finance.employeeId!);
        const id = await replacePayslip(
          org,
          { ...slip, fileId: await file(finance.employeeId!), reason: "Correct personal payslip" },
          secondFinance,
        );
        assert.deepEqual(
          (await listPayslips(org, finance, "self")).slips.map((s) => s.id),
          [id],
        );
        assert.deepEqual(
          (await listPayslips(org, { ...finance, activeRole: "Employee" }, "self")).slips.map(
            (s) => s.id,
          ),
          [id],
        );
      });

      await t.test(
        "encrypted originals remain downloadable only by Finance and employees receive the new PDF",
        {
          skip: !process.env["VIA_HR_OBJECT_STORAGE_ENDPOINT"],
        },
        async () => {
          process.env["VIA_HR_ACTIVE_FIELD_ENCRYPTION_KEY_ID"] = "payslip-test";
          process.env["VIA_HR_FIELD_ENCRYPTION_KEYS"] = JSON.stringify({
            "payslip-test": Buffer.alloc(32, 7).toString("base64"),
          });
          const bytes = Buffer.from("%PDF-1.4\nOriginal payslip\n%%EOF"),
            corrected = Buffer.from("%PDF-1.4\nCorrected payslip\n%%EOF");
          const store = (name: string, content: Buffer) =>
            saveObjectFile({
              organisationId: org,
              name,
              bytes: content,
              mimeType: "application/pdf",
              owner: { entityType: "employee-payslip", entityId: employee.employeeId! },
              actor: finance,
            });
          const original = await store("original.pdf", bytes),
            replacement = await store("corrected.pdf", corrected);
          const oldId = await publishPayslip(
            org,
            { employeeId: employee.employeeId!, payMonth: "2027-01", fileId: original.id },
            finance,
          );
          const newId = await replacePayslip(
            org,
            {
              id: oldId,
              expectedVersion: 1,
              fileId: replacement.id,
              reason: "Corrected salary total",
            },
            finance,
          );
          await removeUnassignedPayslipFile(org, original.id, finance);
          await removeUnassignedPayslipFile(org, replacement.id, finance);
          assert.deepEqual(Buffer.from((await readPayslip(org, oldId, finance)).bytes), bytes);
          assert.deepEqual(Buffer.from((await readPayslip(org, newId, employee)).bytes), corrected);
          await assert.rejects(readPayslip(org, oldId, employee), /cannot access/);
          await assert.rejects(readPayslip(org, newId, hr), /cannot access/);
          const unused = await store("unused.pdf", corrected);
          await removeUnassignedPayslipFile(org, unused.id, finance);
          assert.equal(
            (await query`SELECT storage_status FROM file_metadata WHERE id=${unused.id}`)[0]!
              .storage_status,
            "Deleted",
          );
        },
      );
    } finally {
      await query.end({ timeout: 5 });
      await closeDatabaseConnection();
    }
  },
);
