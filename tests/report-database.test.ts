import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import postgres from "postgres";

import {
  archiveReportViewInDatabase,
  exportReportCsvInDatabase,
  generateReportInDatabase,
  listAvailableReportsForActor,
  listSavedReportViewsInDatabase,
  saveReportViewInDatabase,
} from "../src/lib/db/repositories/report.repository.server.ts";

const testDatabaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (testDatabaseUrl) process.env["DATABASE_URL"] = testDatabaseUrl;

const noFilters = {
  search: "",
  dateFrom: "",
  dateTo: "",
  department: "all",
  status: "all",
};

test(
  "reports are PostgreSQL-backed, permission filtered, saved and export audited",
  { skip: !testDatabaseUrl },
  async () => {
    assert.match(new URL(testDatabaseUrl!).pathname.slice(1).toLowerCase(), /(test|scratch)/);
    const query = postgres(testDatabaseUrl!, { max: 2, prepare: false });
    try {
      const [organisation] = await query<{ id: string }[]>`select id from organisations limit 1`;
      assert.ok(organisation);
      const people = await query<
        { userId: string; employeeId: string; displayName: string; email: string; role: string }[]
      >`select distinct on (r.code) u.id as "userId",u.employee_id as "employeeId",u.display_name as "displayName",u.workspace_email as email,r.code::text as role from users u join user_roles ur on ur.user_id=u.id join roles r on r.id=ur.role_id where u.organisation_id=${organisation.id} and r.code in ('HR','Accounts','Super Admin') order by r.code,u.created_at`;
      const actorFor = (role: string) => {
        const person = people.find((item) => item.role === role);
        assert.ok(person, `${role} seed user is required`);
        return {
          userId: person.userId,
          employeeId: person.employeeId,
          displayName: person.displayName,
          activeRole: role as "HR" | "Accounts" | "Super Admin",
          roles: [role as "HR" | "Accounts" | "Super Admin"],
        };
      };
      const hr = actorFor("HR");
      const accounts = actorFor("Accounts");
      const admin = actorFor("Super Admin");

      for (const report of listAvailableReportsForActor(admin)) {
        const data = await generateReportInDatabase(organisation.id, report.id, noFilters, admin);
        assert.equal(data.id, report.id);
        assert.ok(data.columns.length > 0);
      }

      const headcount = await generateReportInDatabase(organisation.id, "headcount", noFilters, hr);
      const [sourceCount] = await query<
        { count: number }[]
      >`select count(*)::integer as count from employees where organisation_id=${organisation.id} and archived_at is null`;
      assert.equal(headcount.rows.length, sourceCount!.count);
      assert.equal(
        headcount.columns.some((column) => /salary|bank|passport/i.test(column.key)),
        false,
      );

      const department = String(headcount.rows[0]?.["department"] ?? "");
      const filtered = await generateReportInDatabase(
        organisation.id,
        "headcount",
        { ...noFilters, department },
        hr,
      );
      assert.ok(filtered.rows.every((row) => row["department"] === department));

      await assert.rejects(
        () => generateReportInDatabase(organisation.id, "headcount", noFilters, accounts),
        /permission/i,
      );
      const [denial] = await query<
        { count: number }[]
      >`select count(*)::integer as count from audit_events where organisation_id=${organisation.id} and actor_user_id=${accounts.userId} and action='access-denied' and module='reports'`;
      assert.ok(denial!.count >= 1);

      const payroll = await generateReportInDatabase(
        organisation.id,
        "payroll",
        noFilters,
        accounts,
      );
      assert.equal(
        payroll.columns.some((column) => /salary|bank|passport/i.test(column.key)),
        false,
      );

      const viewName = `Monthly exceptions ${randomUUID().slice(0, 8)}`;
      const view = await saveReportViewInDatabase(
        organisation.id,
        "headcount",
        viewName,
        { ...noFilters, department },
        hr,
      );
      const views = await listSavedReportViewsInDatabase(organisation.id, hr.userId, "headcount");
      assert.ok(views.some((item) => item.id === view.id));
      assert.equal(
        (await listSavedReportViewsInDatabase(organisation.id, admin.userId, "headcount")).some(
          (item) => item.id === view.id,
        ),
        false,
      );
      await archiveReportViewInDatabase(organisation.id, view.id, hr);

      const exported = await exportReportCsvInDatabase(organisation.id, "headcount", noFilters, hr);
      assert.equal(exported.rowCount, sourceCount!.count);
      assert.doesNotMatch(exported.csv, /Base Salary|Bank|Passport/i);
      const [exportAudit] = await query<
        { count: number }[]
      >`select count(*)::integer as count from audit_events where organisation_id=${organisation.id} and actor_user_id=${hr.userId} and action='export' and module='reports'`;
      assert.ok(exportAudit!.count >= 1);
    } finally {
      await query.end();
    }
  },
);
