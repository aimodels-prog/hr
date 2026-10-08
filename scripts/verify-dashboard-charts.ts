/** Read-only reconciliation. Prints aggregate counts only, never employee details. */
import assert from "node:assert/strict";
import postgres from "postgres";
import { getWorkforceAnalytics } from "../src/lib/db/repositories/workforce-analytics.repository.server.ts";
import { closeDatabaseConnection } from "../src/lib/db/client.ts";

const sql = postgres(process.env["DATABASE_URL"]!, { max: 1 });
try {
  const organisations = await sql`SELECT id FROM organisations WHERE is_active = true
    AND (${process.argv[2] ?? null}::uuid IS NULL OR id = ${process.argv[2] ?? null}::uuid)`;
  assert.equal(
    organisations.length,
    1,
    "Supply an organisation UUID when the database has multiple organisations",
  );
  const organisationId = String(organisations[0]!.id);
  const at = new Date();
  const hr = { activeRole: "HR" as const };
  const chart = await getWorkforceAnalytics(organisationId, hr, "hr", 30, at);
  const today = chart.today.date;
  const people = await sql`SELECT id FROM employees WHERE organisation_id = ${organisationId}
    AND archived_at IS NULL AND start_date <= ${today} AND (termination_date IS NULL OR termination_date >= ${today})
    AND (status IN ('Active','Probation','Notice','Onboarding') OR termination_date IS NOT NULL)`;
  assert.equal(chart.workforceHeadcount, people.length);
  const personIds = people.length
    ? people.map((person) => person.id)
    : ["00000000-0000-0000-0000-000000000000"];
  for (const groups of [chart.departments, chart.offices, chart.employmentStatuses])
    assert.equal(
      groups.reduce((sum, row) => sum + row.count, 0),
      people.length,
    );

  const applications =
    await sql`SELECT a.status AS name, count(*)::int AS count FROM candidate_applications a
    JOIN vacancies v ON v.id = a.vacancy_id AND v.organisation_id = a.organisation_id
    WHERE a.organisation_id = ${organisationId} AND a.archived_at IS NULL AND v.archived_at IS NULL AND v.status = 'Open'
    GROUP BY a.status`;
  const sorted = (rows: { name: string; count: number }[]) =>
    [...rows].sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(
    sorted(chart.recruitment),
    sorted(applications as unknown as { name: string; count: number }[]),
  );

  const [leave] =
    await sql`SELECT coalesce(sum(b.balance_days),0)::float8 AS remaining FROM leave_balances b
    JOIN leave_policies p ON p.id = b.policy_id AND p.organisation_id = b.organisation_id
    WHERE b.organisation_id = ${organisationId} AND b.archived_at IS NULL AND p.archived_at IS NULL
      AND p.is_enabled AND p.type = 'Annual' AND b.leave_year = ${chart.priorities.leaveYear}
      AND b.employee_id IN ${sql(personIds)}`;
  assert.ok(
    Math.abs(
      chart.priorities.annualLeave.reduce((sum, row) => sum + row.remaining, 0) -
        Number(leave!.remaining),
    ) < 0.001,
  );

  const approvals = await sql`SELECT
    (SELECT count(*) FROM leave_requests WHERE organisation_id=${organisationId} AND archived_at IS NULL AND status IN ('Pending Line Manager','Pending HR','Pending Super Admin','Cancellation Pending','Amendment Pending Line Manager','Amendment Pending HR')) +
    (SELECT count(*) FROM overtime_claims WHERE organisation_id=${organisationId} AND archived_at IS NULL AND status IN ('Pending Pre-authorisation','Pending Manager','Pending HR')) +
    (SELECT coalesce(sum((manager_approval_status='Pending')::int + (hr_approval_status='Pending')::int + (accounts_approval_status='Pending')::int),0) FROM travel_requests WHERE organisation_id=${organisationId} AND archived_at IS NULL AND status='Pending HR and Accounts') +
    (SELECT count(*) FROM travel_requests WHERE organisation_id=${organisationId} AND archived_at IS NULL AND status='Pending Super Admin Closure') +
    (SELECT count(*) FROM training_requests WHERE organisation_id=${organisationId} AND archived_at IS NULL AND status IN ('Pending Supervisor','Pending HR')) +
    (SELECT count(*) FROM site_visit_requests WHERE organisation_id=${organisationId} AND archived_at IS NULL AND status='Pending HR') AS total`;
  assert.equal(
    chart.priorities.approvals.reduce((sum, row) => sum + row.count, 0),
    Number(approvals[0]!.total),
  );
  const expiry =
    await sql`SELECT expiry_date::text AS date FROM employee_documents WHERE organisation_id=${organisationId}
      AND archived_at IS NULL AND replaced_by_id IS NULL AND status='Valid' AND expiry_date <= ${today}::date + 90
      AND employee_id IN ${sql(personIds)}
    UNION ALL SELECT expiry_date::text FROM company_library WHERE organisation_id=${organisationId}
      AND archived_at IS NULL AND kind='Company' AND status='Published' AND expiry_date <= ${today}::date + 90`;
  const expiryCounts = [0, 0, 0, 0];
  for (const row of expiry) {
    const days = Math.round((Date.parse(row.date) - Date.parse(today)) / 86400000);
    expiryCounts[days < 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : 3]!++;
  }
  assert.deepEqual(
    chart.priorities.expiries.map((row) => row.count),
    expiryCounts,
  );

  // Independent SQL reconciliation of recorded presence, including today's
  // unfinished shifts and breaks. A live shift is not an absence finding.
  const completed = await sql`SELECT r.date::text AS date, count(*)::int AS count,
      sum(CASE WHEN r.date=${today}::date THEN
        extract(epoch FROM (least(coalesce(r.clock_out_at,${at.toISOString()}::timestamptz),${at.toISOString()}::timestamptz)-r.clock_in_at))/3600.0
        ELSE round(extract(epoch FROM (r.clock_out_at-r.clock_in_at))/3600.0,2) END)::float8 AS hours
    FROM attendance_records r JOIN employees e ON e.id=r.employee_id AND e.organisation_id=r.organisation_id
    WHERE r.organisation_id=${organisationId} AND r.archived_at IS NULL AND e.archived_at IS NULL
      AND r.date BETWEEN ${chart.startDate} AND ${chart.endDate}
      AND e.start_date <= r.date AND (e.termination_date IS NULL OR e.termination_date >= r.date)
      AND (e.status IN ('Active','Probation','Notice','Onboarding') OR e.termination_date IS NOT NULL)
      AND r.clock_in_at IS NOT NULL AND (r.clock_out_at IS NOT NULL OR r.date=${today}::date)
      AND r.status NOT IN ('Correction Pending','Absent')
      AND extract(epoch FROM (CASE WHEN r.date=${today}::date
        THEN least(coalesce(r.clock_out_at,${at.toISOString()}::timestamptz),${at.toISOString()}::timestamptz)
        ELSE r.clock_out_at END-r.clock_in_at)) BETWEEN 0 AND 86400
      AND NOT EXISTS (SELECT 1 FROM site_visit_requests s WHERE s.organisation_id=r.organisation_id AND s.employee_id=r.employee_id
        AND s.date=r.date AND s.archived_at IS NULL AND s.status='Pending HR') GROUP BY r.date`;
  for (const day of chart.days) {
    const saved = completed.find((row) => row.date === day.date);
    assert.equal(day.recorded, saved?.count ?? 0, `Recorded count on ${day.date}`);
    assert.ok(Math.abs(day.worked - Number(saved?.hours ?? 0)) < 0.011, `Hours on ${day.date}`);
    assert.ok(day.date <= today);
    if (day.date === today) {
      assert.equal(day.expected, 0, "Today's target is not included in completed-day totals");
      assert.equal(day.missing, 0, "An unfinished shift is not an absence");
    }
  }
  assert.equal(chart.endDate, today);
  assert.equal(chart.days.at(-1)?.date, today, "The chart includes today");
  for (const person of people) {
    for (const period of [7, 30] as const) {
      const self = await getWorkforceAnalytics(
        organisationId,
        { activeRole: "Employee", employeeId: person.id },
        "self",
        period,
        at,
      );
      const selected = await getWorkforceAnalytics(organisationId, hr, "hr", period, at, person.id);
      assert.deepEqual(selected.days, self.days);
      assert.deepEqual(selected.priorities.annualLeave, self.priorities.annualLeave);
      assert.deepEqual(self.priorities.approvals, []);
      assert.deepEqual(self.priorities.expiries, []);
      assert.deepEqual(self.recruitment, []);
      assert.deepEqual(self.departments, []);
      assert.deepEqual(self.offices, []);
    }
  }
  await assert.rejects(
    getWorkforceAnalytics(organisationId, { activeRole: "Employee" }, "hr", 7),
    /Only HR/,
  );
  console.log(
    JSON.stringify({
      verified: true,
      employeeComparisons: people.length * 2,
      attendance: chart.days.filter((day) => day.recorded || day.review || day.missing),
      headcount: chart.workforceHeadcount,
      recruitmentApplications: chart.recruitment.reduce((sum, row) => sum + row.count, 0),
      pendingDecisions: Number(approvals[0]!.total),
      expiringDocuments: expiry.length,
      annualLeaveRemaining: Number(leave!.remaining),
    }),
  );
} finally {
  await sql.end();
  await closeDatabaseConnection();
}
