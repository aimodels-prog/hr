import "@tanstack/react-start/server-only";

import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { leaveYearForDate } from "../../data/leave-year.ts";
import type { ReportData, ReportFilters } from "../../data/report-service.ts";
import { getDatabaseClient } from "../client.ts";
import { appSettings } from "../schema/organisation.ts";

type LeaveReportYears = NonNullable<ReportData["leaveYears"]>;

// Match the request/balance year convention: the year in which the period starts.
function yearForDate(date: SQL, start: string) {
  return sql`(extract(year from ${date})::integer - case when to_char(${date}, 'MM-DD') < ${start} then 1 else 0 end)`;
}

function periodStart(year: SQL, start: string) {
  // A February 29 boundary becomes March 1 in a non-leap year, matching
  // leaveYearForDate's MM-DD comparison without constructing an invalid date.
  return sql`(make_date(${year}, split_part(${start}, '-', 1)::integer, 1) + (split_part(${start}, '-', 2)::integer - 1))`;
}

export async function resolveLeaveReportYears(
  org: string,
  requested: ReportFilters["leaveYear"],
): Promise<LeaveReportYears> {
  if (
    requested !== undefined &&
    requested !== "current" &&
    requested !== "all" &&
    (!Number.isInteger(requested) || requested < 2000 || requested > 2200)
  )
    throw new Error("Choose a valid leave year between 2000 and 2200.");
  const db = getDatabaseClient();
  const [settings] = await db
    .select()
    .from(appSettings)
    .where(and(eq(appSettings.organisationId, org), isNull(appSettings.archivedAt)))
    .limit(1);
  if (!settings) throw new Error("Organisation leave-year settings are unavailable.");
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const currentYear = leaveYearForDate(today, settings.leaveYearStart);
  const selectedYear = requested === undefined || requested === "current" ? currentYear : requested;
  const years = await db.execute<{ year: number }>(sql`
    select leave_year as year from leave_balances where organisation_id=${org} and archived_at is null
    union select ${yearForDate(sql`start_date`, settings.leaveYearStart)} as year
      from leave_requests where organisation_id=${org} and archived_at is null`);
  return {
    currentYear,
    selectedYear,
    startMonthDay: settings.leaveYearStart,
    availableYears: [
      ...new Set([
        currentYear - 1,
        currentYear,
        currentYear + 1,
        ...(selectedYear === "all" ? [] : [selectedYear]),
        ...years.map((row) => row.year),
      ]),
    ]
      .filter((year) => year >= 2000 && year <= 2200)
      .sort((a, b) => b - a),
  };
}

export function queryLeaveBalances(org: string, years?: LeaveReportYears) {
  if (!years) throw new Error("A leave year is required for this report.");
  const start = periodStart(sql`b.leave_year`, years.startMonthDay);
  const nextStart = periodStart(sql`b.leave_year + 1`, years.startMonthDay);
  const transactionYear = sql`coalesce(rb.leave_year, ${yearForDate(sql`coalesce(rr.start_date, lt.date)`, years.startMonthDay)})`;
  return getDatabaseClient().execute(sql`
    select e.legal_name as employee, d.name as department, p.name as "leaveType",
      b.leave_year as "leaveYear", ${start}::text as "periodStart", (${nextStart} - 1)::text as "periodEnd",
      ledger.entitlement::double precision as entitlement,
      ledger.used::double precision as used, ledger.adjustments::double precision as adjustments,
      pending.days::double precision as pending, b.balance_days::double precision as available
    from leave_balances b
    join employees e on e.id=b.employee_id and e.organisation_id=b.organisation_id
    join departments d on d.id=e.department_id and d.organisation_id=b.organisation_id
    join leave_policies p on p.id=b.policy_id and p.organisation_id=b.organisation_id
    cross join lateral (
      select coalesce(sum(lt.days) filter (where lt.transaction_type in ('Entitlement','Carry-Forward','Accrual')),0) as entitlement,
        greatest(0, -coalesce(sum(lt.days) filter (where lt.transaction_type in ('Approved Leave','Leave Amendment','Cancellation Restoration')),0)) as used,
        coalesce(sum(lt.days) filter (where lt.transaction_type in ('Manual Adjustment','Expiry')),0) as adjustments
      from leave_transactions lt
      left join leave_balances rb on rb.id=lt.reference_id and rb.organisation_id=b.organisation_id
        and rb.employee_id=b.employee_id and rb.policy_id=b.policy_id
      left join leave_requests rr on rr.id=lt.reference_id and rr.organisation_id=b.organisation_id
        and rr.employee_id=b.employee_id and rr.policy_id=b.policy_id
      where lt.organisation_id=b.organisation_id and lt.employee_id=b.employee_id and lt.policy_id=b.policy_id
        and lt.archived_at is null and ${transactionYear}=b.leave_year
    ) ledger
    cross join lateral (
      select coalesce(sum(case
        when r.status in ('Pending Line Manager','Pending HR','Pending Super Admin') then r.working_days_requested
        when r.status in ('Amendment Pending Line Manager','Amendment Pending HR') then
          greatest(0, coalesce((r.pending_amendment->>'proposedWorkingDays')::numeric, r.working_days_requested) - r.working_days_requested)
        else 0 end),0) as days
      from leave_requests r where r.organisation_id=b.organisation_id and r.employee_id=b.employee_id
        and r.policy_id=b.policy_id and r.archived_at is null
        and r.start_date >= ${start} and r.start_date < ${nextStart}
    ) pending
    where b.organisation_id=${org} and b.archived_at is null
      and ${years.selectedYear === "all" ? sql`true` : sql`b.leave_year=${years.selectedYear}`}
    order by b.leave_year desc, e.legal_name, p.name, b.id`);
}

export function queryLeaveUsage(org: string, years?: LeaveReportYears) {
  if (!years) throw new Error("A leave year is required for this report.");
  const year = yearForDate(sql`r.start_date`, years.startMonthDay);
  return getDatabaseClient().execute(sql`
    select e.legal_name as employee, d.name as department, p.name as "leaveType", ${year} as "leaveYear",
      r.start_date::text as "startDate", r.end_date::text as "endDate",
      r.working_days_requested::double precision as days, r.status::text as status
    from leave_requests r
    join employees e on e.id=r.employee_id and e.organisation_id=r.organisation_id
    join departments d on d.id=e.department_id and d.organisation_id=r.organisation_id
    join leave_policies p on p.id=r.policy_id and p.organisation_id=r.organisation_id
    where r.organisation_id=${org} and r.archived_at is null
      and ${years.selectedYear === "all" ? sql`true` : sql`${year}=${years.selectedYear}`}
    order by r.start_date desc, e.legal_name, r.id`);
}
