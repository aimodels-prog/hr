import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { closeDatabaseConnection } from "../src/lib/db/client.ts";
import {
  exportReportCsvInDatabase,
  generateReportInDatabase,
  listSavedReportViewsInDatabase,
  saveReportViewInDatabase,
} from "../src/lib/db/repositories/report.repository.server.ts";
import type { AuditActorContext } from "../src/lib/db/repositories/master-data.repository.server.ts";
import type { ReportFilters } from "../src/lib/data/report-service.ts";
import { listTrackedRequests } from "../src/lib/db/repositories/request-tracking.repository.server.ts";

const databaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (databaseUrl) process.env["DATABASE_URL"] = databaseUrl;
const defaults: ReportFilters = {
  search: "",
  dateFrom: "",
  dateTo: "",
  department: "all",
  status: "all",
};

test(
  "leave reports keep entitlement years separate in screens, saved views and exports",
  { skip: !databaseUrl },
  async (t) => {
    assert.match(new URL(databaseUrl!).pathname.slice(1).toLowerCase(), /(test|scratch)/);
    const query = postgres(databaseUrl!, { max: 2, prepare: false });
    const org = randomUUID(),
      otherOrg = randomUUID(),
      author = randomUUID();
    const employee = randomUUID(),
      user = randomUUID(),
      policy = randomUUID();
    const department = randomUUID(),
      position = randomUUID(),
      location = randomUUID(),
      employmentType = randomUUID();
    const actor: AuditActorContext = {
      userId: user,
      employeeId: employee,
      displayName: "Report reviewer",
      activeRole: "HR",
      roles: ["Employee", "HR"],
    };
    try {
      for (const id of [org, otherOrg]) {
        // Keep report fixtures out of unrelated scheduled-worker tests sharing this test database.
        await query`insert into organisations (id,name,slug,is_active,created_by,updated_by)
        values (${id},'Leave report test',${`leave-report-${id}`},false,${author},${author})`;
      }
      for (const [table, id] of [
        ["departments", department],
        ["positions", position],
        ["locations", location],
        ["employment_types", employmentType],
      ] as const) {
        await query.unsafe(
          `insert into ${table} (id,organisation_id,name,code,is_active,order_index,created_by,updated_by)
        values ($1,$2,'Operations','REPORT',true,1,$3,$3)`,
          [id, org, author],
        );
      }
      await query`insert into employees (id,organisation_id,employee_number,legal_name,preferred_name,work_email,
      department_id,position_id,location_id,employment_type_id,status,start_date,created_by,updated_by)
      values (${employee},${org},'YEAR-1','Year Test Employee','Year Test',${`${employee}@viahr.test`},
      ${department},${position},${location},${employmentType},'Active','2020-01-01',${author},${author})`;
      await query`insert into users (id,organisation_id,employee_id,display_name,workspace_email,status,created_by,updated_by)
      values (${user},${org},${employee},'Report reviewer',${`${employee}@viahr.test`},'Active',${author},${author})`;
      await query`insert into app_settings (organisation_id,timezone,base_currency,working_days,standard_daily_hours,
      standard_weekly_hours,leave_year_start,leave_year_end,document_reminder_days,employee_number_format,candidate_reference_format,created_by,updated_by)
      values (${org},'Asia/Muscat','OMR',${[1, 2, 3, 4, 5]},8,40,'04-01','03-31',${[30, 7]},'VIA-{SEQ}','CAN-{SEQ}',${author},${author})`;
      await query`insert into leave_policies (id,organisation_id,code,name,type,category,description,is_paid,scope,accrual_mode,created_by,updated_by)
      values (${policy},${org},'ANNUAL','Annual Leave','Annual','Standard','Report test',true,'Annual','Upfront',${author},${author})`;
      const balances = new Map<number, string>();
      for (const [year, days] of [
        [2025, 16],
        [2026, 20],
        [2027, 55],
      ]) {
        const id = randomUUID();
        balances.set(year!, id);
        await query`insert into leave_balances (id,organisation_id,employee_id,policy_id,leave_year,balance_days,created_by,updated_by)
        values (${id},${org},${employee},${policy},${year!},${days!},${author},${author})`;
      }
      const transaction = async (
        date: string,
        type: string,
        days: number,
        reference: string | null = null,
        archived = false,
        organisation = org,
      ) => {
        await query`insert into leave_transactions (organisation_id,employee_id,policy_id,date,transaction_type,days,reason,reference_id,actor_user_id,created_by,updated_by,archived_at)
        values (${organisation},${employee},${policy},${date},${type},${days},'Test ledger entry',${reference},${user},${author},${author},${archived ? new Date() : null})`;
      };
      const request = async (
        date: string,
        status: string,
        days: number,
        proposedDays?: number,
        archived = false,
        organisation = org,
      ) => {
        const id = randomUUID();
        await query`insert into leave_requests (id,organisation_id,employee_id,policy_id,start_date,end_date,working_days_requested,reason,status,policy_snapshot,pending_amendment,created_by,updated_by,archived_at)
        values (${id},${organisation},${employee},${policy},${date},${date},${days},'Test leave',${status},'{}',
          ${proposedDays === undefined ? null : query.json({ proposedWorkingDays: proposedDays })},${author},${author},${archived ? new Date() : null})`;
        return id;
      };
      // A late posting and a UTC date near rollover must use their referenced entitlement year.
      await transaction("2026-04-05", "Entitlement", 20, balances.get(2025)!);
      const old = await request("2025-05-01", "Approved", 4);
      await transaction("2026-04-05", "Approved Leave", -4, old);
      await request("2026-03-31", "Pending HR", 7);
      await transaction("2026-03-31", "Entitlement", 30, balances.get(2026)!);
      await transaction("2026-04-01", "Carry-Forward", 5, balances.get(2026)!);
      await transaction("2026-05-01", "Accrual", 2);
      await transaction("2026-05-01", "Manual Adjustment", 1, balances.get(2026)!);
      await transaction("2026-05-01", "Expiry", -2);
      const amended = await request("2026-04-01", "Approved", 5);
      await transaction("2026-04-01", "Approved Leave", -6, amended);
      await transaction("2026-04-01", "Leave Amendment", 1, amended);
      const cancelled = await request("2026-06-01", "Cancellation Approved", 2);
      await transaction("2026-06-01", "Approved Leave", -2, cancelled);
      await transaction("2026-06-01", "Cancellation Restoration", 2, cancelled);
      for (const [status, days, proposed] of [
        ["Approved", 3, undefined],
        ["Cancellation Pending", 4, undefined],
        ["Amendment Pending HR", 2, 5],
        ["Amendment Pending Line Manager", 2, 1],
      ] as const) {
        const id = await request("2026-07-01", status, days, proposed);
        await transaction("2026-07-01", "Approved Leave", -days, id);
      }
      await request("2026-04-01", "Pending Line Manager", 3);
      await request("2026-08-01", "Pending HR", 2);
      await request("2027-03-31", "Pending Super Admin", 1);
      await request("2027-04-01", "Pending HR", 100);
      await transaction("2027-04-01", "Entitlement", 55, balances.get(2027)!);
      await transaction("2026-05-01", "Accrual", 999, null, true);
      await request("2026-05-01", "Pending HR", 999, undefined, true);
      // The database must reject cross-organisation references before they reach a report.
      await assert.rejects(
        transaction("2026-05-01", "Accrual", 888, null, false, otherOrg),
        /Cross-organisation/,
      );
      await assert.rejects(
        request("2026-05-01", "Pending HR", 888, undefined, false, otherOrg),
        /Cross-organisation/,
      );

      const report = (id = "leave_balances", filters: Partial<ReportFilters> = {}) =>
        generateReportInDatabase(org, id, { ...defaults, ...filters }, actor);
      await t.test(
        "each balance uses only its own year, including restored leave and amendment deltas",
        async () => {
          const data = await report("leave_balances", { leaveYear: "all" });
          assert.deepEqual(
            data.rows.map((row) => row.leaveYear),
            [2027, 2026, 2025],
          );
          const current = data.rows.find((row) => row.leaveYear === 2026)!;
          assert.deepEqual(current, {
            employee: "Year Test Employee",
            department: "Operations",
            workLocation: "Operations",
            leaveType: "Annual Leave",
            leaveYear: 2026,
            periodStart: "2026-04-01",
            periodEnd: "2027-03-31",
            entitlement: 37,
            used: 16,
            adjustments: -1,
            pending: 9,
            available: 20,
          });
          const previous = data.rows.find((row) => row.leaveYear === 2025)!;
          assert.equal(previous.entitlement, 20);
          assert.equal(previous.used, 4);
          assert.equal(previous.pending, 7);
          const future = data.rows.find((row) => row.leaveYear === 2027)!;
          assert.equal(future.entitlement, 55);
          assert.equal(future.pending, 100);
          assert.equal(future.used, 0);
        },
      );
      await t.test(
        "explicit years, empty years and legacy date filters select periods without mixing totals",
        async () => {
          const data = await report("leave_balances", { leaveYear: 2026 });
          assert.equal(data.rows.length, 1);
          assert.equal(data.rows[0]!.leaveYear, 2026);
          assert.equal((await report("leave_balances", { leaveYear: 2024 })).rows.length, 0);
          const march = await report("leave_balances", {
            leaveYear: "all",
            dateFrom: "2026-03-31",
            dateTo: "2026-03-31",
          });
          assert.deepEqual(
            march.rows.map((row) => row.leaveYear),
            [2025],
          );
          const april = await report("leave_balances", {
            leaveYear: "all",
            dateFrom: "2026-04-01",
            dateTo: "2026-04-01",
          });
          assert.deepEqual(
            april.rows.map((row) => row.leaveYear),
            [2026],
          );
          assert.equal(
            (await report("leave_balances", { leaveYear: 2026, department: "Other" })).rows.length,
            0,
          );
        },
      );
      await t.test(
        "usage assigns start dates to the same non-calendar year and retains request date filtering",
        async () => {
          const old = await report("leave_usage", { leaveYear: 2025 });
          assert.equal(old.rows.length, 2);
          assert.ok(old.rows.every((row) => row.leaveYear === 2025));
          const data = await report("leave_usage", { leaveYear: 2026 });
          assert.equal(data.rows.length, 9);
          assert.ok(data.rows.every((row) => row.leaveYear === 2026));
          const last = await report("leave_usage", {
            leaveYear: 2026,
            dateFrom: "2027-03-31",
            dateTo: "2027-03-31",
          });
          assert.equal(last.rows.length, 1);
          assert.equal(last.rows[0]!.days, 1);
          const pending = await report("leave_usage", {
            leaveYear: 2026,
            status: "Pending HR",
            search: "Year Test",
          });
          assert.equal(pending.rows.length, 1);
          assert.equal(pending.rows[0]!.days, 2);
        },
      );
      await t.test(
        "default year uses the organisation timezone at rollover, not the UTC or calendar year",
        async () => {
          t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 2, 31, 19, 59) });
          try {
            assert.equal((await report()).leaveYears?.selectedYear, 2025);
            t.mock.timers.setTime(Date.UTC(2026, 2, 31, 20, 0));
            const after = await report();
            assert.equal(after.leaveYears?.currentYear, 2026);
            assert.deepEqual(
              after.rows.map((row) => row.leaveYear),
              [2026],
            );
            assert.deepEqual(
              (await report("leave_usage")).rows.map((row) => row.leaveYear),
              Array(9).fill(2026),
            );
          } finally {
            t.mock.timers.reset();
          }
        },
      );
      await t.test(
        "saved views and CSV preserve the selected year with labelled periods and audited filters",
        async () => {
          const filters = { ...defaults, leaveYear: 2025 };
          const saved = await saveReportViewInDatabase(
            org,
            "leave_balances",
            "Historical leave",
            filters,
            actor,
          );
          const views = await listSavedReportViewsInDatabase(org, user, "leave_balances");
          assert.equal(views.find((view) => view.id === saved.id)?.filters.leaveYear, 2025);
          assert.deepEqual(
            (await report("leave_balances", saved.filters)).rows.map((row) => row.leaveYear),
            [2025],
          );
          const exported = await exportReportCsvInDatabase(org, "leave_balances", filters, actor);
          assert.equal(exported.rowCount, 1);
          assert.match(exported.csv, /"Leave Year"/);
          assert.match(exported.csv, /"2025-04-01","2026-03-31"/);
          assert.doesNotMatch(exported.csv, /"2027-03-31"/);
          const [event] =
            await query`select after_summary from audit_events where organisation_id=${org} and module='reports' and action='export' limit 1`;
          assert.equal(event!.after_summary.filters.leaveYear, 2025);
          const all = await exportReportCsvInDatabase(
            org,
            "leave_balances",
            { ...defaults, leaveYear: "all" },
            actor,
          );
          assert.equal(all.rowCount, 3);
        },
      );
      await t.test(
        "invalid years fail and employees/finance cannot bypass report permissions",
        async () => {
          for (const year of [1999, 2201, 2026.5, NaN])
            await assert.rejects(report("leave_balances", { leaveYear: year }), /valid leave year/);
          for (const role of ["Employee", "Accounts"] as const) {
            await assert.rejects(
              generateReportInDatabase(
                org,
                "leave_balances",
                { ...defaults, leaveYear: "all" },
                { ...actor, activeRole: role, roles: [role] },
              ),
              /permission/i,
            );
          }
        },
      );
      await t.test("calendar years and leap-day boundaries remain supported", async () => {
        await query`update app_settings set leave_year_start='01-01',leave_year_end='12-31' where organisation_id=${org}`;
        const january = await report("leave_balances", { leaveYear: 2026 });
        assert.equal(january.rows[0]!.periodStart, "2026-01-01");
        assert.equal(january.rows[0]!.periodEnd, "2026-12-31");
        await query`update app_settings set leave_year_start='02-29',leave_year_end='02-28' where organisation_id=${org}`;
        const leap = await report("leave_balances", { leaveYear: 2025 });
        assert.equal(leap.rows[0]!.periodStart, "2025-03-01");
        assert.equal(leap.rows[0]!.periodEnd, "2026-02-28");
      });
      await t.test(
        "records and exports show normal leave labels while preserving the original source",
        async () => {
          const storedName = "Annual Leave — imported history";
          const recordedName = "Annual Leave (2025 entitlement) – IMPORTED HISTORY  ";
          await query`update leave_policies set name=${storedName} where id=${policy}`;
          await query`update leave_requests set policy_snapshot=${query.json({ name: recordedName })} where id=${old}`;

          const balancesBefore =
            await query`select id,balance_days from leave_balances where organisation_id=${org} order by id`;
          const usage = await report("leave_usage", { leaveYear: "all" });
          assert.ok(usage.rows.every((row) => !/imported history/i.test(String(row.leaveType))));
          assert.equal(
            usage.rows.find((row) => row.startDate === "2025-05-01")!.leaveType,
            "Annual Leave (2025 entitlement)",
          );
          const balancesReport = await report("leave_balances", { leaveYear: "all" });
          assert.ok(balancesReport.rows.every((row) => row.leaveType === "Annual Leave"));
          for (const reportId of ["leave_usage", "leave_balances"]) {
            const exported = await exportReportCsvInDatabase(
              org,
              reportId,
              { ...defaults, leaveYear: "all" },
              actor,
            );
            assert.doesNotMatch(exported.csv, /imported history/i);
            assert.match(exported.csv, /Annual Leave/);
          }
          const tracked = await listTrackedRequests(org, actor, {
            scope: "organisation",
            page: 1,
            module: "Leave",
          });
          assert.ok(tracked.rows.every((row) => !/imported history/i.test(row.title)));
          assert.equal(
            tracked.rows.find((row) => row.id === old)!.title,
            "Annual Leave (2025 entitlement) · 2025-05-01 to 2025-05-01",
          );
          const [unchanged] =
            await query`select p.name, r.policy_snapshot from leave_policies p join leave_requests r on r.policy_id=p.id where r.id=${old}`;
          assert.equal(unchanged!.name, storedName);
          assert.equal(unchanged!.policy_snapshot.name, recordedName);
          assert.deepEqual(
            await query`select id,balance_days from leave_balances where organisation_id=${org} order by id`,
            balancesBefore,
          );
        },
      );
    } finally {
      t.mock.timers.reset();
      await query.end({ timeout: 5 });
      await closeDatabaseConnection();
    }
  },
);
