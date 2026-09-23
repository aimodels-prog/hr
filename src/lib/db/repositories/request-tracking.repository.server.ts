import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";
import { getDatabaseClient } from "../client.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";
import {
  STATUS_GROUPS,
  toTrackedRequest,
  type RequestRow,
  type RequestGroup,
} from "../../data/request-tracking.ts";

// Static SQL expressions only. No caller-provided identifier or SQL is interpolated here.
const sources = [
  {
    table: "leave_requests",
    module: "Leave",
    title: "'Leave · ' || r.start_date || ' to ' || r.end_date",
    self: "'/staff/leave'",
    hr: "'/staff/leave-admin'",
    meta: "jsonb_build_object('chain', r.chain_approvals)",
  },
  {
    table: "timesheets",
    module: "Timesheets",
    self: "'/staff/me/timesheets/' || r.period_id",
    hr: "'/staff/timesheet-monitoring'",
    meta: "jsonb_build_object('submittedAt',r.submitted_at,'managerAt',r.supervisor_reviewed_at,'approvedAt',r.approved_at)",
  },
  {
    table: "overtime_claims",
    module: "Overtime",
    self: "'/staff/overtime'",
    hr: "'/staff/overtime-approvals'",
    meta: "jsonb_build_object('approvedAt',r.approved_at)",
  },
  {
    table: "attendance_corrections",
    module: "Attendance corrections",
    self: "'/staff/me/attendance'",
    hr: "'/staff/attendance/corrections'",
    meta: "jsonb_build_object('managerAt',r.manager_reviewed_at,'hrAt',r.hr_reviewed_at,'managerComment',r.manager_notes,'hrComment',r.hr_notes)",
  },
  {
    table: "site_visit_requests",
    module: "Visits",
    self: "'/staff/me/attendance'",
    hr: "'/staff/attendance'",
    meta: "jsonb_build_object('submittedAt',r.requested_at,'hrAt',r.hr_reviewed_at,'hrComment',r.hr_notes,'extensionPending',coalesce(r.details->'extension'->>'status'='Pending',false))",
  },
  {
    table: "travel_requests",
    module: "Travel",
    self: "'/staff/travel/' || r.id",
    hr: "'/staff/travel/' || r.id",
    meta: "jsonb_build_object('manager',r.manager_approval_status,'hr',r.hr_approval_status,'finance',r.accounts_approval_status,'managerAt',r.manager_approved_at,'hrAt',r.hr_approved_at,'financeAt',r.accounts_approved_at,'closedAt',r.closed_at)",
  },
  {
    table: "training_requests",
    module: "Training",
    self: "'/staff/me/training'",
    hr: "'/staff/training'",
    meta: "jsonb_build_object('managerAt',r.supervisor_decision_at,'hrAt',r.hr_decision_at,'managerComment',r.supervisor_comment,'hrComment',r.hr_comment)",
  },
  {
    table: "profile_change_requests",
    module: "Profile updates",
    self: "'/staff/me/profile'",
    hr: "'/staff/employees/' || r.employee_id",
    meta: "jsonb_build_object('hrAt',r.reviewed_at,'hrComment',r.review_notes)",
  },
  {
    table: "employee_documents",
    module: "Documents",
    self: "'/staff/me/profile'",
    hr: "'/staff/employees/' || r.employee_id || '#documents'",
    extra: "r.replaced_by_id IS NULL",
  },
  {
    table: "employee_goals",
    module: "Objectives",
    self: "'/staff/me/performance'",
    hr: "'/staff/performance/team'",
    meta: "jsonb_build_object('submittedAt',r.submitted_at,'approvedAt',r.approved_at,'closedAt',r.completed_at)",
  },
  {
    table: "performance_reviews",
    module: "Performance",
    self: "'/staff/performance/reviews/' || r.id",
    hr: "'/staff/performance/reviews/' || r.id",
  },
  {
    table: "candidate_applications",
    module: "Applications",
    title: "'Job application · ' || r.reference_id",
    employee: "r.internal_applicant_employee_id",
    self: "'/staff/opportunities'",
    hr: "'/staff/candidates/' || r.candidate_id",
  },
  {
    table: "candidate_recommendations",
    module: "Referrals",
    employee: "r.recommender_employee_id",
    status: "r.review_status",
    self: "'/staff/opportunities'",
    hr: "'/staff/recommendations'",
    meta: "jsonb_build_object('hrAt',r.reviewed_at)",
  },
  {
    table: "job_offers",
    module: "Offers",
    employee: "NULL::uuid",
    self: "'/staff/offers'",
    hr: "'/staff/offers'",
    hrOnly: true,
    meta: "jsonb_build_object('approver',(SELECT u.display_name FROM users u WHERE u.id=r.approver_user_id AND u.organisation_id=r.organisation_id AND u.status='Active' AND u.archived_at IS NULL))",
  },
] satisfies Array<{
  table: string;
  module: string;
  title?: string;
  employee?: string;
  status?: string;
  self: string;
  hr: string;
  meta?: string;
  extra?: string;
  hrOnly?: boolean;
}>;

export async function listTrackedRequests(
  organisationId: string,
  actor: AuditActorContext,
  input: {
    scope: "my" | "organisation";
    page: number;
    query?: string | undefined;
    module?: string | undefined;
    group?: RequestGroup | undefined;
  },
) {
  if (!actor.userId) throw new Error("A verified user is required.");
  if (input.scope !== "my" && input.scope !== "organisation")
    throw new Error("Unknown request scope.");
  const hr = input.scope === "organisation";
  if (hr && !["HR", "Super Admin"].includes(actor.activeRole ?? ""))
    throw new Error("Only HR can view the organisation request tracker.");
  if (!hr && !actor.employeeId) throw new Error("An employee profile is required.");
  if (!Number.isInteger(input.page) || input.page < 1 || input.page > 100000)
    throw new Error("Invalid page.");
  const branches = sources
    .filter((source) => hr || !("hrOnly" in source && source.hrOnly))
    .map((source) => {
      const employee = "employee" in source ? source.employee : "r.employee_id";
      const status = "status" in source ? source.status : "r.status";
      const title = "title" in source ? sql.raw(source.title) : sql`${source.module}`;
      return sql`SELECT r.id::text id, ${source.module}::text module, ${title}::text title,
      ${sql.raw(employee)}::text employee_id, coalesce(e.preferred_name,e.legal_name) employee_name,
      e.work_email employee_email, coalesce(m.preferred_name,m.legal_name) manager_name,
      ${sql.raw(status)}::text status, r.created_at, r.updated_at,
      ${sql.raw(hr ? source.hr : source.self)} action_url,
      ${sql.raw("meta" in source ? source.meta : "'{}'::jsonb")} metadata
      FROM ${sql.raw(source.table)} r
      LEFT JOIN employees e ON e.id=${sql.raw(employee)} AND e.organisation_id=${organisationId}
      LEFT JOIN employees m ON m.id=e.line_manager_id AND m.organisation_id=${organisationId} AND m.archived_at IS NULL
      WHERE r.organisation_id=${organisationId} AND r.archived_at IS NULL
        AND ${hr ? sql`true` : sql`${sql.raw(employee)}=${actor.employeeId}::uuid`}
        AND ${sql.raw("extra" in source ? source.extra : "true")}`;
    });
  const groupCases = Object.entries(STATUS_GROUPS).map(
    ([group, statuses]) =>
      sql`WHEN status IN (${sql.join(
        statuses.map((status) => sql`${status}`),
        sql`,`,
      )}) THEN ${group}`,
  );
  const query = (input.query ?? "").trim().slice(0, 160);
  const filters = sql`(${input.module ?? "All"}='All' OR module=${input.module ?? "All"})
    AND (${input.group ?? "All"}='All' OR request_group=${input.group ?? "All"})
    AND (${query}='' OR position(lower(${query}) in lower(concat_ws(' ',title,employee_name,employee_email,id,status)))>0)`;
  const [result] = await getDatabaseClient().execute(sql`
    WITH source AS (${sql.join(branches, sql` UNION ALL `)}), classified AS (
      SELECT *, CASE ${sql.join(groupCases, sql` `)} WHEN status ~* 'pending|awaiting' OR status='New' THEN 'Waiting' ELSE 'In progress' END request_group FROM source
    ), filtered AS (SELECT * FROM classified WHERE ${filters})
    SELECT (SELECT count(*)::int FROM filtered) total,
      coalesce((SELECT jsonb_agg(page_rows) FROM (SELECT id,module,title,employee_id,employee_name,manager_name,status,created_at,updated_at,action_url,metadata FROM filtered ORDER BY updated_at DESC,module,id LIMIT 30 OFFSET ${(input.page - 1) * 30}) page_rows),'[]'::jsonb) rows`);
  const payload = result as unknown as { total: number; rows: RequestRow[] };
  return {
    total: payload.total,
    page: input.page,
    pageSize: 30,
    rows: payload.rows.map(toTrackedRequest),
  };
}
