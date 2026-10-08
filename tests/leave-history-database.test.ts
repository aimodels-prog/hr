import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import postgres from "postgres";
const url = process.env["VIA_HR_TEST_DATABASE_URL"];
test(
  "approved history is atomic, repeatable and silent, and never rewrites changed records",
  { skip: !url },
  async () => {
    assert.match(new URL(url!).pathname, /test|scratch/);
    const sql = postgres(url!, { max: 1 });
    const org = randomUUID(),
      actor = randomUUID(),
      employee = randomUUID(),
      department = randomUUID(),
      position = randomUUID(),
      location = randomUUID(),
      employmentType = randomUUID();
    const file = join(tmpdir(), `via-leave-history-test-${org}.json`);
    const matchingFile = join(tmpdir(), `via-leave-matching-test-${org}.json`);
    try {
      await sql`INSERT INTO organisations(id,name,slug,is_active,created_by,updated_by) VALUES (${org},'Leave history test',${org},true,${actor},${actor})`;
      for (const [table, id] of [
        ["departments", department],
        ["positions", position],
        ["employment_types", employmentType],
      ])
        await sql.unsafe(
          `INSERT INTO ${table}(id,organisation_id,name,code,is_active,order_index,created_by,updated_by) VALUES ($1,$2,'Test','TEST',true,1,$3,$3)`,
          [id!, org, actor],
        );
      await sql`INSERT INTO locations(id,organisation_id,name,code,is_active,order_index,created_by,updated_by) VALUES (${location},${org},'Test','TEST',true,1,${actor},${actor})`;
      await sql`INSERT INTO employees(id,organisation_id,employee_number,legal_name,preferred_name,work_email,department_id,position_id,location_id,employment_type_id,status,start_date,created_by,updated_by) VALUES (${employee},${org},'TEST','History Employee','History',${org + "@test.invalid"},${department},${position},${location},${employmentType},'Active','2025-01-01',${actor},${actor})`;
      await sql`INSERT INTO users(id,organisation_id,employee_id,display_name,workspace_email,status,created_by,updated_by) VALUES (${actor},${org},${employee},'History',${org + "@test.invalid"},'Active',${actor},${actor})`;
      const day = {
        name: "Spreadsheet Employee",
        code: "A/L",
        days: 1,
        year: 2026,
        source: { file: "test.xlsx", sha256: "test" },
      };
      const payload = {
        version: 1,
        workbooks: [
          {
            file: "test.xlsx",
            sha256: "test",
            names: ["Spreadsheet Employee", "Missing Person", "Former Employee"],
            issues: [],
            days: [
              { ...day, date: "2026-01-01" },
              { ...day, date: "2026-01-02" },
              { ...day, date: "2026-01-03", code: "HFD", days: 0.5 },
            ],
          },
        ],
      };
      await writeFile(
        matchingFile,
        JSON.stringify({
          aliases: { "Spreadsheet Employee": "History Employee" },
          formerEmployees: ["Former Employee"],
          expectedWorkspaceEmails: { "Spreadsheet Employee": org + "@test.invalid" },
        }),
      );
      await writeFile(file, JSON.stringify(payload));
      const run = (mode: string) =>
        spawnSync(process.execPath, ["scripts/import-leave-history.mjs", file, mode], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            DATABASE_URL: url!,
            VIA_HR_IMPORT_ORGANISATION_ID: org,
            VIA_HR_LEAVE_HISTORY_MATCHING_FILE: matchingFile,
          },
          encoding: "utf8",
        });
      const dry = run("--dry-run");
      assert.equal(dry.status, 0, dry.stderr);
      const summary = JSON.parse(dry.stdout);
      assert.deepEqual(summary.unmatched, ["Missing Person"]);
      assert.deepEqual(summary.former, ["Former Employee"]);
      assert.equal(
        (await sql`SELECT count(*)::int n FROM leave_requests WHERE organisation_id=${org}`)[0]!.n,
        0,
      );
      const first = run("--apply");
      assert.equal(first.status, 0, first.stderr);
      assert.match(first.stdout, /COMMITTED 2/);
      assert.equal(
        (await sql`SELECT count(*)::int n FROM notifications WHERE organisation_id=${org}`)[0]!.n,
        0,
      );
      assert.equal(
        (await sql`SELECT count(*)::int n FROM leave_transactions WHERE organisation_id=${org}`)[0]!
          .n,
        0,
      );
      const repeat = run("--apply");
      assert.equal(repeat.status, 0, repeat.stderr);
      assert.match(repeat.stdout, /COMMITTED 0/);
      assert.equal(
        (
          await sql`SELECT sum(working_days_requested)::float n FROM leave_requests WHERE organisation_id=${org}`
        )[0]!.n,
        2.5,
      );
      payload.workbooks[0]!.days[0]!.code = "SICK";
      await writeFile(file, JSON.stringify(payload));
      const conflict = run("--apply");
      assert.notEqual(conflict.status, 0);
      assert.match(conflict.stderr, /requires review/);
      assert.equal(
        (await sql`SELECT count(*)::int n FROM leave_requests WHERE organisation_id=${org}`)[0]!.n,
        2,
      );
    } finally {
      await unlink(file).catch(() => {});
      await unlink(matchingFile).catch(() => {});
      await sql.end({ timeout: 5 });
    }
  },
);
