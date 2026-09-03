import "@tanstack/react-start/server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type {
  ReportCellValue,
  ReportColumn,
  ReportData,
  ReportFilters,
} from "../../data/report-service.ts";
import { getDatabaseClient } from "../client.ts";
import { auditEvents, reportSavedViews } from "../schema/system.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

export const REPORT_CATALOGUE = [
  { id: "headcount", name: "Headcount & Diversity", category: "Core HR" },
  { id: "recruitment", name: "Recruitment Funnel", category: "Recruitment" },
  { id: "recruitment_sources", name: "Candidate Sources", category: "Recruitment" },
  { id: "recommenders", name: "Recommender Outcomes", category: "Recruitment" },
  { id: "contact_activity", name: "Candidate Contact Activity", category: "Recruitment" },
  { id: "leave_balances", name: "Leave Balances", category: "Time & Attendance" },
  { id: "leave_usage", name: "Leave Usage & Upcoming Absence", category: "Time & Attendance" },
  { id: "timesheet_completion", name: "Timesheet Completion", category: "Time & Attendance" },
  { id: "timesheet_projects", name: "Project & Cost Centre Hours", category: "Time & Attendance" },
  { id: "attendance", name: "Attendance Exceptions", category: "Time & Attendance" },
  { id: "overtime", name: "Overtime Summary", category: "Time & Attendance" },
  { id: "performance", name: "Performance Distribution", category: "Performance" },
  { id: "training", name: "Training Certifications", category: "Training" },
  { id: "documents", name: "Document Expiries", category: "Compliance" },
  { id: "travel", name: "Travel Variance", category: "Operations" },
  { id: "onboarding", name: "Onboarding Progress", category: "Operations" },
  { id: "offboarding", name: "Offboarding Progress", category: "Operations" },
  { id: "payroll", name: "Payroll Inputs Summary", category: "Finance" },
] as const;

export type ReportId = (typeof REPORT_CATALOGUE)[number]["id"];

type QueryDefinition = {
  name: string;
  description: string;
  columns: ReportColumn[];
  containsPersonalData: boolean;
  query: (organisationId: string) => Promise<unknown>;
};

const c = (key: string, label: string, type?: ReportColumn["type"]): ReportColumn => ({
  key,
  label,
  ...(type ? { type } : {}),
});

const definitions: Record<ReportId, QueryDefinition> = {
  headcount: {
    name: "Headcount & Diversity",
    description: "Current workforce by department, location and employment type.",
    containsPersonalData: true,
    columns: [
      c("employeeNumber", "Employee ID"),
      c("name", "Name"),
      c("department", "Department"),
      c("location", "Location"),
      c("employmentType", "Type"),
      c("status", "Status"),
      c("startDate", "Start Date", "date"),
    ],
    query: (org) =>
      getDatabaseClient().execute(
        sql`select e.employee_number as "employeeNumber", e.legal_name as name, d.name as department, l.name as location, et.name as "employmentType", e.status::text as status, e.start_date as "startDate" from employees e join departments d on d.id=e.department_id join locations l on l.id=e.location_id join employment_types et on et.id=e.employment_type_id where e.organisation_id=${org} and e.archived_at is null order by e.legal_name`,
      ),
  },
  recruitment: {
    name: "Recruitment Funnel",
    description: "Applications and their current vacancy stage.",
    containsPersonalData: true,
    columns: [
      c("candidate", "Candidate"),
      c("source", "Source"),
      c("vacancy", "Vacancy"),
      c("status", "Stage"),
      c("score", "Latest Score", "number"),
      c("date", "Applied", "date"),
    ],
    query: (org) =>
      getDatabaseClient().execute(
        sql`select concat(c.first_name,' ',c.last_name) as candidate, a.source, v.title as vacancy, a.status::text as status, coalesce((select csr.overall_score::double precision from candidate_score_runs csr where csr.application_id=a.id and csr.archived_at is null order by csr.created_at desc limit 1),0) as score, a.created_at::date::text as date from candidate_applications a join candidates c on c.id=a.candidate_id join vacancies v on v.id=a.vacancy_id where a.organisation_id=${org} and a.archived_at is null order by a.created_at desc`,
      ),
  },
  recruitment_sources: {
    name: "Candidate Sources",
    description: "Application sources and current outcomes.",
    containsPersonalData: true,
    columns: [
      c("candidate", "Candidate"),
      c("vacancy", "Vacancy"),
      c("source", "Source"),
      c("status", "Status"),
      c("date", "Applied", "date"),
    ],
    query: (org) =>
      getDatabaseClient().execute(
        sql`select concat(c.first_name,' ',c.last_name) as candidate, v.title as vacancy, a.source, a.status::text as status, a.created_at::date::text as date from candidate_applications a join candidates c on c.id=a.candidate_id join vacancies v on v.id=a.vacancy_id where a.organisation_id=${org} and a.archived_at is null order by a.created_at desc`,
      ),
  },
  recommenders: {
    name: "Recommender Outcomes",
    description: "Recommendation sources, owners and current outcomes.",
    containsPersonalData: true,
    columns: [
      c("recommender", "Recommender"),
      c("company", "Company"),
      c("candidate", "Candidate"),
      c("vacancy", "Vacancy"),
      c("owner", "HR Owner"),
      c("status", "Outcome"),
      c("date", "Date", "date"),
    ],
    query: (org) =>
      getDatabaseClient().execute(
        sql`select r.recommender_name as recommender, coalesce(r.recommender_company,'Independent') as company, concat(c.first_name,' ',c.last_name) as candidate, coalesce(v.title,'Candidate Pool') as vacancy, coalesce(e.legal_name,'Unassigned') as owner, r.source_outcome as status, r.date::text as date from candidate_recommendations r join candidates c on c.id=r.candidate_id left join vacancies v on v.id=r.vacancy_id left join employees e on e.id=r.hr_owner_id where r.organisation_id=${org} and r.archived_at is null order by r.date desc`,
      ),
  },
  contact_activity: {
    name: "Candidate Contact Activity",
    description: "Candidate contact ownership and follow-up outcomes.",
    containsPersonalData: true,
    columns: [
      c("candidate", "Candidate"),
      c("channel", "Channel"),
      c("owner", "Contacted By"),
      c("status", "Outcome"),
      c("date", "Contact Date", "date"),
      c("followUp", "Next Follow-up", "date"),
    ],
    query: (org) =>
      getDatabaseClient().execute(
        sql`select concat(c.first_name,' ',c.last_name) as candidate, cc.channel, u.display_name as owner, cc.outcome as status, cc.date::date::text as date, cc.next_follow_up_date::text as "followUp" from candidate_contacts cc join candidates c on c.id=cc.candidate_id join users u on u.id=cc.contacted_by_user_id where cc.organisation_id=${org} and cc.archived_at is null order by cc.date desc`,
      ),
  },
  leave_balances: {
    name: "Leave Balances",
    description: "Current employee leave balances by policy.",
    containsPersonalData: true,
    columns: [
      c("employee", "Employee"),
      c("department", "Department"),
      c("leaveType", "Leave Type"),
      c("entitlement", "Entitlement", "number"),
      c("used", "Used", "number"),
      c("pending", "Pending", "number"),
      c("available", "Available", "number"),
    ],
    query: (org) =>
      getDatabaseClient().execute(
        sql`select e.legal_name as employee, d.name as department, p.name as "leaveType", coalesce(sum(lt.days) filter (where lt.transaction_type in ('Entitlement','Carry-Forward','Accrual')),0)::double precision as entitlement, abs(coalesce(sum(lt.days) filter (where lt.transaction_type in ('Approved Leave','Leave Amendment')),0))::double precision as used, coalesce((select sum(lr.working_days_requested) from leave_requests lr where lr.employee_id=b.employee_id and lr.policy_id=b.policy_id and lr.status in ('Pending Line Manager','Pending HR','Pending Super Admin','Cancellation Pending') and lr.archived_at is null),0)::double precision as pending, b.balance_days::double precision as available from leave_balances b join employees e on e.id=b.employee_id join departments d on d.id=e.department_id join leave_policies p on p.id=b.policy_id left join leave_transactions lt on lt.employee_id=b.employee_id and lt.policy_id=b.policy_id and lt.archived_at is null where b.organisation_id=${org} and b.archived_at is null group by b.id,e.id,d.name,p.name order by e.legal_name,p.name`,
      ),
  },
  leave_usage: {
    name: "Leave Usage & Upcoming Absence",
    description: "Submitted leave, approval status and working days away.",
    containsPersonalData: true,
    columns: [
      c("employee", "Employee"),
      c("department", "Department"),
      c("leaveType", "Leave Type"),
      c("startDate", "Start", "date"),
      c("endDate", "End", "date"),
      c("days", "Working Days", "number"),
      c("status", "Status"),
    ],
    query: (org) =>
      getDatabaseClient().execute(
        sql`select e.legal_name as employee, d.name as department, p.name as "leaveType", r.start_date as "startDate", r.end_date as "endDate", r.working_days_requested::double precision as days, r.status::text as status from leave_requests r join employees e on e.id=r.employee_id join departments d on d.id=e.department_id join leave_policies p on p.id=r.policy_id where r.organisation_id=${org} and r.archived_at is null order by r.start_date desc`,
      ),
  },
  timesheet_completion: {
    name: "Timesheet Completion",
    description: "Timesheet status and recorded hours.",
    containsPersonalData: true,
    columns: [
      c("period", "Period"),
      c("employee", "Employee"),
      c("department", "Department"),
      c("status", "Status"),
      c("totalHours", "Total Hours", "number"),
      c("overtime", "Overtime Hours", "number"),
      c("date", "Period End", "date"),
    ],
    query: (org) =>
      getDatabaseClient().execute(
        sql`select concat(p.start_date,' to ',p.end_date) as period, e.legal_name as employee, d.name as department, t.status::text as status, t.total_hours::double precision as "totalHours", greatest(t.total_hours-t.expected_hours,0)::double precision as overtime, p.end_date as date from timesheets t join timesheet_periods p on p.id=t.period_id join employees e on e.id=t.employee_id join departments d on d.id=e.department_id where t.organisation_id=${org} and t.archived_at is null order by p.end_date desc,e.legal_name`,
      ),
  },
  timesheet_projects: {
    name: "Project & Cost Centre Hours",
    description: "Recorded time allocated to projects and cost centres.",
    containsPersonalData: true,
    columns: [
      c("employee", "Employee"),
      c("department", "Department"),
      c("project", "Project"),
      c("costCentre", "Cost Centre"),
      c("hours", "Hours", "number"),
      c("status", "Timesheet Status"),
      c("date", "Work Date", "date"),
    ],
    query: (org) =>
      getDatabaseClient().execute(
        sql`select e.legal_name as employee, d.name as department, p.name as project, cc.name as "costCentre", te.hours::double precision as hours, t.status::text as status, te.work_date as date from timesheet_entries te join timesheets t on t.id=te.timesheet_id join employees e on e.id=t.employee_id join departments d on d.id=e.department_id join projects p on p.id=te.project_id join cost_centres cc on cc.id=te.cost_centre_id where te.organisation_id=${org} and te.archived_at is null order by te.work_date desc`,
      ),
  },
  attendance: {
    name: "Attendance Exceptions",
    description: "Daily hours, late arrivals and attendance records requiring attention.",
    containsPersonalData: true,
    columns: [
      c("employee", "Employee"),
      c("department", "Department"),
      c("date", "Date", "date"),
      c("location", "Location"),
      c("hours", "Hours", "number"),
      c("status", "Status"),
      c("late", "Late"),
    ],
    query: (org) =>
      getDatabaseClient().execute(
        sql`select e.legal_name as employee, d.name as department, ar.date, coalesce(l.name,'Not recorded') as location, coalesce(ar.calculated_hours,0)::double precision as hours, ar.status::text as status, case when ar.is_late then 'Yes' else 'No' end as late from attendance_records ar join employees e on e.id=ar.employee_id join departments d on d.id=e.department_id left join locations l on l.id=ar.location_id where ar.organisation_id=${org} and ar.archived_at is null order by ar.date desc`,
      ),
  },
  overtime: {
    name: "Overtime Summary",
    description: "Overtime claims, compensation choices and approval outcomes.",
    containsPersonalData: true,
    columns: [
      c("employee", "Employee"),
      c("department", "Department"),
      c("date", "Date", "date"),
      c("hours", "Hours", "number"),
      c("compensation", "Compensation"),
      c("status", "Status"),
      c("warnings", "Review Notes"),
    ],
    query: (org) =>
      getDatabaseClient().execute(
        sql`select e.legal_name as employee, d.name as department, oc.date, oc.hours::double precision as hours, oc.compensation_type as compensation, oc.status::text as status, trim(both '[]' from oc.cross_check_warnings::text) as warnings from overtime_claims oc join employees e on e.id=oc.employee_id join departments d on d.id=e.department_id where oc.organisation_id=${org} and oc.archived_at is null order by oc.date desc`,
      ),
  },
  performance: {
    name: "Performance Distribution",
    description: "Performance review outcomes without confidential comments.",
    containsPersonalData: true,
    columns: [
      c("employee", "Employee"),
      c("department", "Department"),
      c("cycle", "Review Cycle"),
      c("status", "Status"),
      c("score", "Final Score", "number"),
    ],
    query: (org) =>
      getDatabaseClient().execute(
        sql`select e.legal_name as employee, d.name as department, pc.name as cycle, pr.status::text as status, coalesce(pr.overall_manager_score,pr.overall_self_score,0)::double precision as score from performance_reviews pr join employees e on e.id=pr.employee_id join departments d on d.id=e.department_id join performance_cycles pc on pc.id=pr.cycle_id where pr.organisation_id=${org} and pr.archived_at is null order by pc.self_assessment_deadline desc,e.legal_name`,
      ),
  },
  training: {
    name: "Training Certifications",
    description: "Training completions, certification expiry and HR verification.",
    containsPersonalData: true,
    columns: [
      c("employee", "Employee"),
      c("department", "Department"),
      c("title", "Certification"),
      c("provider", "Provider"),
      c("completionDate", "Completed", "date"),
      c("expiryDate", "Expires", "date"),
      c("status", "Verification"),
    ],
    query: (org) =>
      getDatabaseClient().execute(
        sql`select e.legal_name as employee, d.name as department, tr.title, tr.provider, tr.completion_date as "completionDate", tr.expiry_date as "expiryDate", case when tr.hr_verified then 'Verified' when tr.rejected_at is not null then 'Rejected' else 'Pending' end as status from training_records tr join employees e on e.id=tr.employee_id join departments d on d.id=e.department_id where tr.organisation_id=${org} and tr.archived_at is null order by coalesce(tr.expiry_date,tr.completion_date)`,
      ),
  },
  documents: {
    name: "Document Expiries",
    description: "Employee document expiry and verification status.",
    containsPersonalData: true,
    columns: [
      c("employee", "Employee"),
      c("department", "Department"),
      c("document", "Document"),
      c("expiryDate", "Expiry Date", "date"),
      c("status", "Status"),
    ],
    query: (org) =>
      getDatabaseClient().execute(
        sql`select e.legal_name as employee, d.name as department, ed.type::text as document, ed.expiry_date as "expiryDate", ed.status::text as status from employee_documents ed join employees e on e.id=ed.employee_id join departments d on d.id=e.department_id where ed.organisation_id=${org} and ed.archived_at is null and ed.expiry_date is not null order by ed.expiry_date`,
      ),
  },
  travel: {
    name: "Travel Variance",
    description: "Travel approvals, estimates and reimbursement variance.",
    containsPersonalData: true,
    columns: [
      c("employee", "Employee"),
      c("department", "Department"),
      c("destination", "Destination"),
      c("startDate", "Start", "date"),
      c("estimate", "Estimate", "currency"),
      c("actual", "Actual", "currency"),
      c("variance", "Variance", "currency"),
      c("status", "Status"),
    ],
    query: (org) =>
      getDatabaseClient().execute(
        sql`select e.legal_name as employee, d.name as department, tr.destination, tr.start_date as "startDate", tr.total_estimate::double precision as estimate, coalesce(tr.actual_total,0)::double precision as actual, (coalesce(tr.actual_total,0)-tr.total_estimate)::double precision as variance, tr.status::text as status from travel_requests tr join employees e on e.id=tr.employee_id join departments d on d.id=e.department_id where tr.organisation_id=${org} and tr.archived_at is null order by tr.start_date desc`,
      ),
  },
  onboarding: {
    name: "Onboarding Progress",
    description: "New-starter readiness and outstanding onboarding work.",
    containsPersonalData: true,
    columns: [
      c("employee", "Employee"),
      c("department", "Department"),
      c("startDate", "Start Date", "date"),
      c("progress", "Completion %", "number"),
      c("outstanding", "Outstanding Tasks", "number"),
      c("status", "Status"),
    ],
    query: (org) =>
      getDatabaseClient().execute(
        sql`select e.legal_name as employee, d.name as department, e.start_date as "startDate", oc.progress_percentage as progress, count(ot.id) filter (where ot.status not in ('Completed','Waived') and ot.archived_at is null)::integer as outstanding, oc.status::text as status from onboarding_cases oc join employees e on e.id=oc.employee_id join departments d on d.id=e.department_id left join onboarding_tasks ot on ot.case_id=oc.id where oc.organisation_id=${org} and oc.archived_at is null group by oc.id,e.id,d.name order by e.start_date`,
      ),
  },
  offboarding: {
    name: "Offboarding Progress",
    description: "Departures, clearance progress and outstanding offboarding work.",
    containsPersonalData: true,
    columns: [
      c("employee", "Employee"),
      c("department", "Department"),
      c("reason", "Reason"),
      c("lastWorkingDate", "Last Working Date", "date"),
      c("progress", "Completion %", "number"),
      c("outstanding", "Outstanding Tasks", "number"),
      c("status", "Status"),
    ],
    query: (org) =>
      getDatabaseClient().execute(
        sql`select e.legal_name as employee, d.name as department, oc.reason_category as reason, oc.last_working_date as "lastWorkingDate", oc.progress_percentage as progress, count(ot.id) filter (where ot.status not in ('Completed','Waived') and ot.archived_at is null)::integer as outstanding, oc.status::text as status from offboarding_cases oc join employees e on e.id=oc.employee_id join departments d on d.id=e.department_id left join offboarding_tasks ot on ot.case_id=oc.id where oc.organisation_id=${org} and oc.archived_at is null group by oc.id,e.id,d.name order by oc.last_working_date`,
      ),
  },
  payroll: {
    name: "Payroll Inputs Summary",
    description: "Approved payroll inputs by period. Restricted to Accounts and Super Admin.",
    containsPersonalData: true,
    columns: [
      c("period", "Payroll Period"),
      c("employee", "Employee"),
      c("department", "Department"),
      c("overtimeHours", "Overtime Hours", "number"),
      c("unpaidLeaveDays", "Unpaid Leave Days", "number"),
      c("reimbursements", "Reimbursements", "currency"),
      c("adjustments", "Adjustments", "currency"),
      c("status", "Period Status"),
    ],
    query: (org) =>
      getDatabaseClient().execute(
        sql`select pp.name as period, e.legal_name as employee, d.name as department, pi.approved_overtime_hours::double precision as "overtimeHours", pi.unpaid_leave_days::double precision as "unpaidLeaveDays", pi.reimbursements_total::double precision as reimbursements, pi.manual_adjustments_total::double precision as adjustments, pp.status::text as status from payroll_inputs pi join payroll_periods pp on pp.id=pi.period_id join employees e on e.id=pi.employee_id join departments d on d.id=e.department_id where pi.organisation_id=${org} and pi.archived_at is null order by pp.end_date desc,e.legal_name`,
      ),
  },
};

function assertAccess(reportId: string, actor: AuditActorContext): asserts reportId is ReportId {
  const reportExists = REPORT_CATALOGUE.some((item) => item.id === reportId);
  const roleAllowed =
    actor.activeRole === "HR" ||
    actor.activeRole === "Super Admin" ||
    actor.activeRole === "Accounts";
  const reportAllowed =
    actor.activeRole !== "Accounts" || reportId === "travel" || reportId === "payroll";
  if (!reportExists) throw new Error("This report does not exist.");
  if (!roleAllowed || !reportAllowed)
    throw new Error("You do not have permission to view this report.");
}

function normalizeCell(value: unknown): ReportCellValue {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function applyFilters(
  rows: Record<string, ReportCellValue>[],
  columns: ReportColumn[],
  filters: ReportFilters,
) {
  const q = filters.search.trim().toLowerCase();
  const dateKeys = columns.filter((column) => column.type === "date").map((column) => column.key);
  return rows.filter((row) => {
    if (
      q &&
      !Object.values(row).some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(q),
      )
    )
      return false;
    if (filters.status !== "all" && String(row["status"] ?? "") !== filters.status) return false;
    if (filters.department !== "all" && String(row["department"] ?? "") !== filters.department)
      return false;
    if (filters.dateFrom || filters.dateTo) {
      const values = dateKeys.map((key) => String(row[key] ?? "").slice(0, 10)).filter(Boolean);
      if (!values.length) return false;
      if (filters.dateFrom && !values.some((value) => value >= filters.dateFrom)) return false;
      if (filters.dateTo && !values.some((value) => value <= filters.dateTo)) return false;
    }
    return true;
  });
}

async function recordDenied(organisationId: string, reportId: string, actor: AuditActorContext) {
  await getDatabaseClient()
    .insert(auditEvents)
    .values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole ?? null,
      actorRoles: actor.roles ?? [],
      action: "access-denied",
      module: "reports",
      entityType: "report",
      entityId: actor.userId!,
      afterSummary: { reportId },
      reason: "Role is not authorised for this report",
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
}

export function listAvailableReportsForActor(actor: AuditActorContext) {
  if (actor.activeRole === "Accounts")
    return REPORT_CATALOGUE.filter((r) => r.id === "travel" || r.id === "payroll");
  if (actor.activeRole === "HR") return REPORT_CATALOGUE.filter((r) => r.id !== "payroll");
  if (actor.activeRole === "Super Admin") return REPORT_CATALOGUE;
  return [];
}

export async function generateReportInDatabase(
  organisationId: string,
  reportId: string,
  filters: ReportFilters,
  actor: AuditActorContext,
): Promise<ReportData> {
  try {
    assertAccess(reportId, actor);
  } catch (error) {
    await recordDenied(organisationId, reportId, actor);
    throw error;
  }
  const definition = definitions[reportId];
  const result = await definition.query(organisationId);
  const rows = Array.from(result as Iterable<Record<string, unknown>>).map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeCell(value)])),
  );
  return {
    id: reportId,
    name: definition.name,
    description: definition.description,
    columns: definition.columns,
    containsPersonalData: definition.containsPersonalData,
    rows: applyFilters(rows, definition.columns, filters),
  };
}

function csvValue(value: ReportCellValue): string {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function exportReportCsvInDatabase(
  organisationId: string,
  reportId: string,
  filters: ReportFilters,
  actor: AuditActorContext,
) {
  const report = await generateReportInDatabase(organisationId, reportId, filters, actor);
  const csv = [
    report.columns.map((column) => csvValue(column.label)).join(","),
    ...report.rows.map((row) =>
      report.columns.map((column) => csvValue(row[column.key])).join(","),
    ),
  ].join("\r\n");
  await getDatabaseClient()
    .insert(auditEvents)
    .values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole ?? null,
      actorRoles: actor.roles ?? [],
      action: "export",
      module: "reports",
      entityType: "report",
      entityId: actor.userId!,
      afterSummary: { reportId, format: "CSV", rowCount: report.rows.length, filters },
      reason: "Exported a permission-filtered report",
      riskLevel: report.containsPersonalData ? "High" : "Medium",
    } as typeof auditEvents.$inferInsert);
  return {
    fileName: `via-${reportId}-${new Date().toISOString().slice(0, 10)}.csv`,
    csv,
    rowCount: report.rows.length,
  };
}

export async function listSavedReportViewsInDatabase(
  organisationId: string,
  ownerUserId: string,
  reportId: string,
) {
  return getDatabaseClient()
    .select()
    .from(reportSavedViews)
    .where(
      and(
        eq(reportSavedViews.organisationId, organisationId),
        eq(reportSavedViews.ownerUserId, ownerUserId),
        eq(reportSavedViews.reportId, reportId),
        isNull(reportSavedViews.archivedAt),
      ),
    )
    .orderBy(asc(reportSavedViews.name));
}

export async function saveReportViewInDatabase(
  organisationId: string,
  reportId: string,
  name: string,
  filters: ReportFilters,
  actor: AuditActorContext,
) {
  assertAccess(reportId, actor);
  if (!actor.userId) throw new Error("A verified user is required.");
  const actorUserId = actor.userId;
  const cleanName = name.trim();
  if (cleanName.length < 2 || cleanName.length > 60)
    throw new Error("View name must be between 2 and 60 characters.");
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(reportSavedViews)
      .where(
        and(
          eq(reportSavedViews.organisationId, organisationId),
          eq(reportSavedViews.ownerUserId, actorUserId),
          eq(reportSavedViews.reportId, reportId),
          sql`lower(${reportSavedViews.name})=lower(${cleanName})`,
          isNull(reportSavedViews.archivedAt),
        ),
      )
      .for("update")
      .limit(1);
    const now = new Date();
    const [saved] = existing
      ? await tx
          .update(reportSavedViews)
          .set({
            filters,
            updatedAt: now,
            updatedBy: actorUserId,
            recordVersion: sql`${reportSavedViews.recordVersion}+1`,
          })
          .where(eq(reportSavedViews.id, existing.id))
          .returning()
      : await tx
          .insert(reportSavedViews)
          .values({
            organisationId,
            ownerUserId: actorUserId,
            reportId,
            name: cleanName,
            filters,
            createdBy: actorUserId,
            updatedBy: actorUserId,
          })
          .returning();
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole ?? null,
      actorRoles: actor.roles ?? [],
      action: existing ? "update" : "create",
      module: "reports",
      entityType: "saved-report-view",
      entityId: saved!.id,
      afterSummary: { reportId, name: cleanName },
      reason: existing ? "Updated saved report view" : "Created saved report view",
      riskLevel: "Low",
    } as typeof auditEvents.$inferInsert);
    return saved!;
  });
}

export async function archiveReportViewInDatabase(
  organisationId: string,
  viewId: string,
  actor: AuditActorContext,
) {
  if (!actor.userId) throw new Error("A verified user is required.");
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [view] = await tx
      .select()
      .from(reportSavedViews)
      .where(
        and(
          eq(reportSavedViews.organisationId, organisationId),
          eq(reportSavedViews.id, viewId),
          isNull(reportSavedViews.archivedAt),
        ),
      )
      .for("update")
      .limit(1);
    if (!view || view.ownerUserId !== actor.userId)
      throw new Error("The saved view was not found.");
    assertAccess(view.reportId, actor);
    await tx
      .update(reportSavedViews)
      .set({
        archivedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${reportSavedViews.recordVersion}+1`,
      })
      .where(eq(reportSavedViews.id, view.id));
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole ?? null,
      actorRoles: actor.roles ?? [],
      action: "archive",
      module: "reports",
      entityType: "saved-report-view",
      entityId: view.id,
      beforeSummary: { reportId: view.reportId, name: view.name },
      reason: "Removed saved report view",
      riskLevel: "Low",
    } as typeof auditEvents.$inferInsert);
  });
}
