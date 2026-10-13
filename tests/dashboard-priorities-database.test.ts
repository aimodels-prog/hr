import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import postgres from "postgres";
import { closeDatabaseConnection } from "../src/lib/db/client.ts";
import { getWorkforceAnalytics } from "../src/lib/db/repositories/workforce-analytics.repository.server.ts";
import { listTasksForActorInDatabase } from "../src/lib/db/repositories/task.repository.server.ts";

const databaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (databaseUrl) process.env["DATABASE_URL"] = databaseUrl;

test(
  "HR dashboard reconciles current approvals, leave years, recruitment and family/company expiries",
  {
    skip: !databaseUrl,
  },
  async () => {
    assert.match(new URL(databaseUrl!).pathname, /test|scratch/i);
    const query = postgres(databaseUrl!, { max: 2, prepare: false });
    const org = randomUUID(),
      author = randomUUID();
    const insert = async (table: string, values: Record<string, postgres.JSONValue>) => {
      const [row] = await query`INSERT INTO ${query(table)} ${query({
        id: randomUUID(),
        organisation_id: org,
        created_by: author,
        updated_by: author,
        ...values,
      })} RETURNING id`;
      return String(row!.id);
    };
    const at = new Date("2026-10-11T12:00:00Z");
    try {
      await query`INSERT INTO organisations (id,name,slug,created_by,updated_by)
      VALUES (${org},'Dashboard test',${`dashboard-${org}`},${author},${author})`;
      await query`INSERT INTO app_settings (organisation_id,timezone,base_currency,working_days,
      standard_daily_hours,standard_weekly_hours,leave_year_start,leave_year_end,document_reminder_days,
      employee_number_format,candidate_reference_format,created_by,updated_by)
      VALUES (${org},'Asia/Muscat','OMR',ARRAY[0,1,2,3,4],8,40,'04-01','03-31',ARRAY[30,7],
      'EMP-{####}','CAN-{####}',${author},${author})`;
      const master: Record<string, string> = {};
      for (const table of ["departments", "positions", "locations", "employment_types", "grades"])
        master[table] = await insert(table, {
          name: table,
          code: table,
          is_active: true,
          order_index: 1,
        });
      const person = async (name: string) =>
        insert("employees", {
          employee_number: name,
          legal_name: name,
          preferred_name: name,
          work_email: `${name}@viahr.test`,
          department_id: master["departments"]!,
          position_id: master["positions"]!,
          location_id: master["locations"]!,
          employment_type_id: master["employment_types"]!,
          start_date: "2020-01-01",
          status: "Active",
        });
      const a = await person("first"),
        b = await person("second");
      await insert("users", {
        id: author,
        employee_id: b,
        display_name: "Test HR",
        workspace_email: "second@viahr.test",
        status: "Active",
      });
      await query`UPDATE employees SET employment_confirmation_status='Pending HR Review',
      record_version=record_version+1 WHERE id=${b}`;
      const file = await insert("file_metadata", {
        name: "test.pdf",
        mime_type: "application/pdf",
        size: 12,
        storage_status: "Available",
        owner_entity_type: "employee",
        owner_entity_id: a,
      });
      const document = (extra: Record<string, postgres.JSONValue>) =>
        insert("employee_documents", {
          employee_id: a,
          file_id: file,
          type: "passport",
          visibility: "Restricted",
          status: "Valid",
          ...extra,
        });
      await document({ expiry_date: "2026-10-10" });
      await document({
        type: "visa",
        dependant_id: randomUUID(),
        dependant_document_kind: "visa",
        expiry_date: "2026-10-11",
      });
      await document({ employee_id: b, type: "insurance_card", expiry_date: "2026-11-10" });
      await document({ expiry_date: "2026-10-11", waiver_reason: "Requirement waived" });
      await document({ expiry_date: "2026-10-11", status: "Replaced" });
      await document({
        expiry_date: "2026-10-11",
        status: "Rejected",
        rejection_reason: "Wrong file",
      });
      await document({ expiry_date: "2026-10-11", archived_at: at.toISOString() });
      const pendingDoc = await document({
        expiry_date: "2026-11-25",
        status: "Pending Verification",
      });
      for (const [status, date] of [
        ["Published", "2026-12-10"],
        ["Draft", "2026-10-11"],
      ])
        await insert("company_library", {
          family_id: randomUUID(),
          version: 1,
          title: "Registration",
          category: "Legal",
          kind: "Company",
          audience: "HR only",
          status: status!,
          expiry_date: date!,
          file_id: file,
        });

      const policy = await insert("leave_policies", {
        code: "ANNUAL",
        name: "Annual leave",
        type: "Annual",
        category: "Company Policy",
        description: "Test",
        is_paid: true,
        scope: "Annual",
        accrual_mode: "Upfront",
      });
      for (const [employee, year, balance] of [
        [a, 2026, 18],
        [b, 2026, 9],
        [a, 2025, 99],
      ] as const)
        await insert("leave_balances", {
          employee_id: employee,
          policy_id: policy,
          leave_year: year,
          balance_days: balance,
        });
      for (const [type, days] of [
        ["Carry-Forward", 5],
        ["Approved Leave", -2],
      ] as const)
        await insert("leave_transactions", {
          employee_id: a,
          policy_id: policy,
          date: "2026-04-01",
          transaction_type: type,
          days,
          reason: "Test movement",
          actor_user_id: author,
        });
      await insert("leave_requests", {
        employee_id: a,
        policy_id: policy,
        start_date: "2026-10-09",
        end_date: "2026-10-12",
        working_days_requested: 4,
        status: "Approved",
        reason: "Annual leave",
        policy_snapshot: {
          name: "Annual leave",
          workingDates: ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"],
        },
      });
      await insert("leave_requests", {
        employee_id: b,
        policy_id: policy,
        start_date: "2026-10-15",
        end_date: "2026-10-15",
        working_days_requested: 1,
        status: "Pending HR",
        reason: "Request",
        policy_snapshot: {},
      });
      const period = await insert("timesheet_periods", {
        start_date: "2026-09-01",
        end_date: "2026-09-30",
        status: "Closed",
      });
      await insert("timesheets", {
        employee_id: a,
        period_id: period,
        expected_hours: 180,
        status: "Pending HR",
      });
      await insert("timesheets", {
        employee_id: b,
        period_id: period,
        expected_hours: 180,
        status: "Pending Manager",
      });
      const record = await insert("attendance_records", {
        employee_id: b,
        date: "2026-10-11",
        clock_in_at: "2026-10-11T03:30:00Z",
        status: "Present",
        source: "Hardware Terminal",
      });
      await insert("attendance_corrections", {
        employee_id: b,
        attendance_record_id: record,
        correction_type: "Punch Correction",
        original_status: "Present",
        explanation: "Fix time",
        status: "Pending HR",
      });
      await insert("time_away", {
        employee_id: a,
        date: "2026-10-14",
        start_time: "09:00",
        end_time: "12:00",
        category: "Medical appointment",
        status: "Pending HR",
      });
      await insert("time_away", {
        employee_id: b,
        date: "2026-10-14",
        start_time: "09:00",
        end_time: "12:00",
        category: "Medical appointment",
        status: "Cancelled",
      });
      await insert("profile_change_requests", {
        employee_id: a,
        changes: {},
        requested_by: author,
        status: "Pending",
      });
      await insert("site_visit_requests", {
        employee_id: a,
        date: "2026-10-14",
        start_time: "09:00",
        end_time: "12:00",
        origin: "Office",
        destination: "Ministry",
        purpose: "Meeting",
        requested_at: at.toISOString(),
        status: "Approved",
        details: { extension: { status: "Pending" } },
      });
      const trip = await insert("travel_requests", {
        employee_id: a,
        purpose: "Meeting",
        destination: "Site",
        start_date: "2026-10-15",
        end_date: "2026-10-15",
        total_estimate: 0,
        currency: "OMR",
        status: "Pending HR and Accounts",
      });

      const cv = await insert("recruitment_documents", {
        name: "cv.pdf",
        mime_type: "application/pdf",
        size: 12,
        owner_entity_type: "candidate",
        owner_entity_id: randomUUID(),
      });
      const vacancy = async (status: string) =>
        insert("vacancies", {
          title: "Engineer",
          department_id: master["departments"]!,
          location_id: master["locations"]!,
          position_id: master["positions"]!,
          grade_id: master["grades"]!,
          employment_type_id: master["employment_types"]!,
          status,
          summary: "Engineering",
          responsibilities: [],
          requirements: [],
          hiring_reason: "Growth",
          education: "Degree",
          minimum_experience: "2",
          skills: { required: [], preferred: [] },
        });
      const open = await vacancy("Open"),
        closed = await vacancy("Closed");
      for (const [vacancyId, status, archived] of [
        [open, "Interviewing", false],
        [open, "Hired", false],
        [closed, "New", false],
        [open, "New", true],
      ] as const) {
        const candidate = await insert("candidates", {
          first_name: "Test",
          last_name: "Candidate",
          email: `${randomUUID()}@viahr.test`,
          phone: randomUUID(),
          location: "Muscat",
          stage: "Applied",
        });
        await insert("candidate_applications", {
          candidate_id: candidate,
          vacancy_id: vacancyId,
          cv_file_id: cv,
          reference_id: randomUUID(),
          status,
          notice_period: "Immediate",
          source: "Careers Portal",
          consented_at: at.toISOString(),
          archived_at: archived ? at.toISOString() : null,
        });
      }

      const hr = { activeRole: "HR" as const };
      const chart = await getWorkforceAnalytics(org, hr, "hr", 30, at);
      assert.equal(
        chart.today.recorded,
        1,
        "An unfinished machine clock-in is visible without requiring clock-out",
      );
      assert.deepEqual(
        chart.priorities.expiries.map((row) => row.count),
        [1, 2, 1, 0],
      );
      assert.equal(chart.priorities.leaveYearStart, "2026-04-01");
      assert.deepEqual(chart.priorities.annualLeave, [
        { name: "Annual leave", used: 2, booked: 2, remaining: 27, carry: 3 },
      ]);
      assert.deepEqual(chart.recruitment, [
        { name: "Interviewing", count: 1 },
        { name: "Hired", count: 1 },
      ]);
      const approvals = new Map(chart.priorities.approvals.map((row) => [row.name, row.count]));
      for (const name of [
        "Timesheets · HR",
        "Timesheets · Manager",
        "Attendance corrections · HR",
        "Time away · HR",
        "Documents · HR",
        "Profile updates · HR",
        "Employment details · HR",
        "Visits · HR",
        "Leave · HR",
        "Travel · Manager",
      ])
        assert.equal(approvals.get(name), 1, name);
      assert.equal(approvals.has("Travel · HR"), false);
      assert.equal(approvals.has("Travel · Finance"), false);
      const tasks = (activeRole: "HR" | "Accounts") =>
        listTasksForActorInDatabase(
          org,
          { activeRole, userId: author, employeeId: b },
          "2026-10-11",
        );
      assert.equal(
        (await tasks("HR")).some((task) => task.id === `travel-hr-${trip}`),
        false,
      );
      assert.equal(
        (await tasks("Accounts")).some((task) => task.id === `travel-accounts-${trip}`),
        false,
      );

      await query`UPDATE travel_requests SET manager_approval_status='Approved', record_version=record_version+1 WHERE id=${trip}`;
      const readyHr = await getWorkforceAnalytics(org, hr, "hr", 7, at);
      assert.equal(
        readyHr.priorities.approvals.find((row) => row.name === "Travel · HR")?.count,
        1,
      );
      assert.equal(
        readyHr.priorities.approvals.some((row) => row.name === "Travel · Finance"),
        false,
      );
      assert.equal(
        (await tasks("HR")).some((task) => task.id === `travel-hr-${trip}`),
        true,
      );
      assert.equal(
        (await tasks("Accounts")).some((task) => task.id === `travel-accounts-${trip}`),
        false,
      );
      await query`UPDATE travel_requests SET hr_approval_status='Approved', record_version=record_version+1 WHERE id=${trip}`;
      const readyFinance = await getWorkforceAnalytics(org, hr, "hr", 7, at);
      assert.equal(
        readyFinance.priorities.approvals.find((row) => row.name === "Travel · Finance")?.count,
        1,
      );
      assert.equal(
        (await tasks("HR")).some((task) => task.id === `travel-hr-${trip}`),
        false,
      );
      assert.equal(
        (await tasks("Accounts")).some((task) => task.id === `travel-accounts-${trip}`),
        true,
      );
      assert.deepEqual(
        readyFinance.priorities.annualLeave,
        chart.priorities.annualLeave,
        "Attendance range does not alter annual balances",
      );
      await query`UPDATE employee_documents SET status='Valid', record_version=record_version+1 WHERE id=${pendingDoc}`;
      const verified = await getWorkforceAnalytics(org, hr, "hr", 7, at);
      assert.deepEqual(
        verified.priorities.expiries.map((row) => row.count),
        [1, 2, 2, 0],
      );
      assert.equal(
        verified.priorities.approvals.some((row) => row.name === "Documents · HR"),
        false,
      );
      const own = await getWorkforceAnalytics(
        org,
        { activeRole: "Employee", employeeId: a },
        "self",
        7,
        at,
      );
      const selected = await getWorkforceAnalytics(org, hr, "hr", 7, at, a);
      assert.deepEqual(selected.priorities.annualLeave, own.priorities.annualLeave);
      assert.deepEqual(
        selected.priorities.expiries.map((row) => row.count),
        [1, 1, 1, 0],
        "Employee filter excludes colleagues and company documents",
      );
      assert.equal(
        selected.priorities.approvals.some((row) => row.name === "Timesheets · Manager"),
        false,
      );
      assert.deepEqual(own.priorities.approvals, []);
      assert.deepEqual(own.priorities.expiries, []);
      assert.deepEqual(own.recruitment, []);
      for (const role of ["Employee", "Accounts", "IT", "Line Manager"] as const)
        await assert.rejects(
          getWorkforceAnalytics(org, { activeRole: role, employeeId: a }, "hr", 7, at),
          /Only HR/,
        );
    } finally {
      try {
        for (const table of [
          "notifications",
          "audit_events",
          "candidate_applications",
          "candidates",
          "vacancies",
          "recruitment_documents",
          "travel_requests",
          "site_visit_requests",
          "profile_change_requests",
          "time_away",
          "attendance_corrections",
          "attendance_records",
          "timesheets",
          "timesheet_periods",
          "leave_requests",
          "leave_transactions",
          "leave_balances",
          "leave_policies",
          "company_library",
          "employee_documents",
          "file_metadata",
          "users",
          "employees",
          "grades",
          "departments",
          "positions",
          "locations",
          "employment_types",
          "app_settings",
        ])
          await query`DELETE FROM ${query(table)} WHERE organisation_id=${org}`;
        await query`DELETE FROM organisations WHERE id=${org}`;
      } finally {
        await query.end();
        await closeDatabaseConnection();
      }
    }
  },
);
