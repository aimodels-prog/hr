import "@tanstack/react-start/server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDatabaseClient } from "../client.ts";
import { users } from "../schema/employee.ts";
import { auditEvents } from "../schema/system.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";
import {
  STATUS_GROUPS,
  toTrackedRequest,
  type RequestDecision,
  type RequestRow,
  type RequestGroup,
} from "../../data/request-tracking.ts";

// Static SQL expressions only. No caller-provided identifier or SQL is interpolated here.
const sources = [
  {
    table: "leave_requests",
    module: "Leave",
    title:
      "btrim(regexp_replace(COALESCE(NULLIF(btrim(r.policy_snapshot->>'name'), ''), 'Leave'), '[[:space:]]+[—–-][[:space:]]+imported history[[:space:]]*$', '', 'i')) || ' · ' || r.start_date || ' to ' || r.end_date",
    self: "'/staff/me/leave-balances#request=' || r.id",
    hr: "'/staff/leave-admin#request=' || r.id",
    meta: "jsonb_build_object('chain', r.chain_approvals)",
    auditType: "leave-request",
    decisionActions: "^(approve|decline|reject)$",
  },
  {
    table: "timesheets",
    module: "Timesheets",
    self: "'/staff/me/timesheets/' || r.period_id",
    hr: "'/staff/timesheet-monitoring'",
    meta: "jsonb_build_object('submittedAt',r.submitted_at,'managerAt',r.supervisor_reviewed_at,'managerBy',r.supervisor_reviewed_by,'approvedAt',r.approved_at,'approvedBy',r.approved_by)",
    reviewedBy: ["r.supervisor_reviewed_by", "r.approved_by"],
    auditType: "timesheet",
    decisionActions: "^(approve|return)$",
  },
  {
    table: "overtime_claims",
    module: "Overtime",
    self: "'/staff/overtime'",
    hr: "'/staff/overtime-approvals'",
    meta: "jsonb_build_object('approvedAt',r.approved_at,'approvedBy',r.approved_by,'preAuthorisedAt',r.pre_authorised_at,'preAuthorisedBy',r.pre_authorised_by)",
    reviewedBy: ["r.pre_authorised_by", "r.approved_by"],
    auditType: "overtime-claim",
    decisionActions: "^(approve|reject|return)$",
  },
  {
    table: "attendance_corrections",
    module: "Attendance corrections",
    self: "'/staff/me/attendance'",
    hr: "'/staff/attendance/corrections'",
    meta: "jsonb_build_object('managerAt',r.manager_reviewed_at,'managerBy',r.manager_reviewed_by,'hrAt',r.hr_reviewed_at,'hrBy',r.hr_reviewed_by,'managerComment',r.manager_notes,'hrComment',r.hr_notes)",
    reviewedBy: ["r.manager_reviewed_by", "r.hr_reviewed_by"],
    auditType: "attendance-correction",
    decisionActions: "^(approve|reject)$",
  },
  {
    table: "time_away",
    module: "Time Away",
    title: "r.category || ' · ' || r.date::text",
    self: "'/staff/time-away?date=' || r.date::text",
    hr: "'/staff/time-away?date=' || r.date::text",
    meta: "jsonb_build_object('hrBy',r.reviewed_by,'hrComment',r.review_note)",
    reviewedBy: ["r.reviewed_by"],
    auditType: "time-away",
    decisionActions: "^time-away-(approved|rejected)$",
  },
  {
    table: "site_visit_requests",
    module: "Visits",
    self: "'/staff/me/attendance'",
    hr: "'/staff/attendance'",
    meta: "jsonb_build_object('submittedAt',r.requested_at,'hrAt',r.hr_reviewed_at,'hrBy',r.hr_reviewed_by,'hrComment',r.hr_notes,'extensionPending',coalesce(r.details->'extension'->>'status'='Pending',false))",
    reviewedBy: ["r.hr_reviewed_by"],
    auditType: "site-visit",
    decisionActions: "^(approve|reject|extension-approve|extension-reject)$",
  },
  {
    table: "travel_requests",
    module: "Travel",
    self: "'/staff/travel/' || r.id",
    hr: "'/staff/travel/' || r.id",
    meta: "jsonb_build_object('manager',r.manager_approval_status,'hr',r.hr_approval_status,'finance',r.accounts_approval_status,'managerAt',r.manager_approved_at,'managerBy',r.manager_approved_by,'hrAt',r.hr_approved_at,'hrBy',r.hr_approved_by,'financeAt',r.accounts_approved_at,'financeBy',r.accounts_approved_by,'closedAt',r.closed_at,'closedBy',r.closed_by)",
    reviewedBy: [
      "r.manager_approved_by",
      "r.hr_approved_by",
      "r.accounts_approved_by",
      "r.closed_by",
    ],
    auditType: "travel-request",
    decisionActions: "^((approve|reject)-(manager|hr|accounts)|close|reject)$",
  },
  {
    table: "training_requests",
    module: "Training",
    self: "'/staff/me/training'",
    hr: "'/staff/training'",
    meta: "jsonb_build_object('managerAt',r.supervisor_decision_at,'managerBy',r.supervisor_decision_by,'hrAt',r.hr_decision_at,'hrBy',r.hr_decision_by,'managerComment',r.supervisor_comment,'hrComment',r.hr_comment)",
    reviewedBy: ["r.supervisor_decision_by", "r.hr_decision_by"],
  },
  {
    table: "profile_change_requests",
    module: "Profile updates",
    self: "'/staff/me/profile'",
    hr: "'/staff/employees/' || r.employee_id",
    meta: "jsonb_build_object('hrAt',r.reviewed_at,'hrBy',r.reviewer_id,'hrComment',r.review_notes)",
    reviewedBy: ["r.reviewer_id"],
  },
  {
    table: "employee_documents",
    module: "Documents",
    title: "initcap(replace(r.type::text,'_',' '))",
    status: "CASE WHEN r.replaced_by_id IS NOT NULL THEN 'Replaced' ELSE r.status::text END",
    self: "'/staff/me/profile'",
    hr: "'/staff/employees/' || r.employee_id || '#documents'",
    auditType: "employee-document",
    decisionActions: "^(verify|reject)$",
  },
  {
    table: "employee_goals",
    module: "Objectives",
    self: "'/staff/me/performance'",
    hr: "'/staff/performance/team'",
    meta: "jsonb_build_object('submittedAt',r.submitted_at,'approvedAt',r.approved_at,'approvedBy',r.approved_by,'closedAt',r.completed_at)",
    reviewedBy: ["r.approved_by"],
    auditType: "employee-goal",
    decisionActions: "^(approve|reject|return)$",
  },
  {
    table: "performance_reviews",
    module: "Performance",
    self: "'/staff/performance/reviews/' || r.id",
    hr: "'/staff/performance/reviews/' || r.id",
    reviewedBy: ["r.moderated_by", "r.locked_by"],
    auditType: "performance-review",
    decisionActions: "^(approve|reject|return|moderate|lock)$",
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
    meta: "jsonb_build_object('hrAt',r.reviewed_at,'hrBy',r.reviewed_by_user_id)",
    reviewedBy: ["r.reviewed_by_user_id"],
    auditType: "candidate-recommendation",
    decisionActions: "^(approve|reject|decline)$",
  },
  {
    table: "job_offers",
    module: "Offers",
    employee: "NULL::uuid",
    self: "'/staff/offers'",
    hr: "'/staff/offers'",
    hrOnly: true,
    meta: "jsonb_build_object('approver',(SELECT u.display_name FROM users u WHERE u.id=r.approver_user_id AND u.organisation_id=r.organisation_id AND u.status='Active' AND u.archived_at IS NULL))",
    reviewedBy: ["r.approved_by"],
    auditType: "job-offer",
    decisionActions: "^(approve|reject|return)$",
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
  hrOnly?: boolean;
  reviewedBy?: string[];
  auditType?: string;
  decisionActions?: string;
}>;

export async function listTrackedRequests(
  organisationId: string,
  actor: AuditActorContext,
  input: {
    scope: "my" | "organisation" | "reviewed";
    page: number;
    query?: string | undefined;
    module?: string | undefined;
    group?: RequestGroup | undefined;
  },
) {
  const actorUserId = actor.userId;
  if (!actorUserId) throw new Error("A verified user is required.");
  if (input.scope !== "my" && input.scope !== "organisation" && input.scope !== "reviewed")
    throw new Error("Unknown request scope.");
  const hr = input.scope === "organisation";
  const reviewed = input.scope === "reviewed";
  if (hr && !["HR", "Super Admin"].includes(actor.activeRole ?? ""))
    throw new Error("Only HR can view the organisation request tracker.");
  if (
    reviewed &&
    !["HR", "Line Manager", "Accounts", "Travel Admin"].includes(actor.activeRole ?? "")
  )
    throw new Error("Use an approval role to view your decisions.");
  if (!hr && !reviewed && !actor.employeeId) throw new Error("An employee profile is required.");
  if (!Number.isInteger(input.page) || input.page < 1 || input.page > 100000)
    throw new Error("Invalid page.");
  const branches = sources
    .filter((source) => hr || reviewed || !("hrOnly" in source && source.hrOnly))
    .map((source) => {
      const employee = "employee" in source ? source.employee : "r.employee_id";
      const status = "status" in source ? source.status : "r.status";
      const title = "title" in source ? sql.raw(source.title) : sql`${source.module}`;
      const directReview =
        "reviewedBy" in source
          ? source.reviewedBy.map((column) => sql`${sql.raw(column)} = ${actorUserId}::uuid`)
          : [];
      if (source.table === "leave_requests") {
        directReview.push(sql`EXISTS (
          SELECT 1 FROM jsonb_array_elements(coalesce(r.chain_approvals,'[]'::jsonb)) step
          WHERE step->>'approvedBy' = ${actorUserId} AND step->>'status' IN ('Approved','Declined')
        )`);
        directReview.push(sql`EXISTS (
          SELECT 1 FROM jsonb_array_elements(coalesce(r.pending_amendment->'chainApprovals','[]'::jsonb)) step
          WHERE step->>'approvedBy' = ${actorUserId} AND step->>'status' IN ('Approved','Declined')
        )`);
      }
      if ("auditType" in source && "decisionActions" in source)
        directReview.push(sql`EXISTS (
          SELECT 1 FROM audit_events ae
          WHERE ae.organisation_id=r.organisation_id AND ae.entity_id=r.id
            AND ae.entity_type=${source.auditType} AND ae.actor_user_id=${actorUserId}::uuid
            AND ae.action ~* ${source.decisionActions}
        )`);
      const reviewFilter = directReview.length
        ? sql`(${sql.join(directReview, sql` OR `)})`
        : sql`false`;
      return sql`SELECT r.id::text id, ${source.module}::text module, ${title}::text title,
      ${sql.raw(employee)}::text employee_id, coalesce(e.preferred_name,e.legal_name) employee_name,
      e.work_email employee_email, coalesce(m.preferred_name,m.legal_name) manager_name,
      ${sql.raw(status)}::text status, r.created_at, r.updated_at,
      ${sql.raw(hr || (reviewed && actor.activeRole === "HR") ? source.hr : source.self)} action_url,
      ${sql.raw("meta" in source ? source.meta : "'{}'::jsonb")} metadata
      FROM ${sql.raw(source.table)} r
      LEFT JOIN employees e ON e.id=${sql.raw(employee)} AND e.organisation_id=${organisationId}
      LEFT JOIN employees m ON m.id=e.line_manager_id AND m.organisation_id=${organisationId} AND m.archived_at IS NULL
      WHERE r.organisation_id=${organisationId} AND r.archived_at IS NULL
        AND ${hr || reviewed ? sql`true` : sql`${sql.raw(employee)}=${actor.employeeId}::uuid`}
        AND ${reviewed ? reviewFilter : sql`true`}`;
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
  const db = getDatabaseClient();
  const [result] = await db.execute(sql`
    WITH source AS (${sql.join(branches, sql` UNION ALL `)}), classified AS (
      SELECT *, CASE ${sql.join(groupCases, sql` `)} WHEN status ~* 'pending|awaiting' OR status='New' THEN 'Waiting' ELSE 'In progress' END request_group FROM source
    ), filtered AS (SELECT * FROM classified WHERE ${filters})
    SELECT (SELECT count(*)::int FROM filtered) total,
      coalesce((SELECT jsonb_agg(page_rows) FROM (SELECT id,module,title,employee_id,employee_name,manager_name,status,created_at,updated_at,action_url,metadata FROM filtered ORDER BY updated_at DESC,module,id LIMIT 30 OFFSET ${(input.page - 1) * 30}) page_rows),'[]'::jsonb) rows`);
  const payload = result as unknown as { total: number; rows: RequestRow[] };
  const ids = [...new Set(payload.rows.map((row) => row.id))];
  const reviewerIds = new Set<string>();
  for (const row of payload.rows) {
    for (const [key, value] of Object.entries(row.metadata ?? {}))
      if (key.endsWith("By") && typeof value === "string") reviewerIds.add(value);
    const chain = row.metadata?.["chain"];
    if (Array.isArray(chain))
      for (const step of chain)
        if (step && typeof step === "object" && typeof step.approvedBy === "string")
          reviewerIds.add(step.approvedBy);
  }
  const [audits, reviewers] = await Promise.all([
    ids.length
      ? db
          .select({
            entityId: auditEvents.entityId,
            entityType: auditEvents.entityType,
            action: auditEvents.action,
            actorName: auditEvents.actorDisplayName,
            role: auditEvents.activeRole,
            at: auditEvents.occurredAt,
          })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.organisationId, organisationId),
              inArray(auditEvents.entityId, ids),
              sql`${auditEvents.action} ~* '(approv|reject|declin|return|verif|moderat|lock|close)'`,
            ),
          )
          .orderBy(asc(auditEvents.occurredAt))
      : [],
    reviewerIds.size
      ? db
          .select({ id: users.id, name: users.displayName })
          .from(users)
          .where(and(eq(users.organisationId, organisationId), inArray(users.id, [...reviewerIds])))
      : [],
  ]);
  const reviewerNames = Object.fromEntries(reviewers.map((user) => [user.id, user.name]));
  const decisionsByRecord = new Map<string, RequestDecision[]>();
  for (const audit of audits) {
    const source = sources.find(
      (item) => "auditType" in item && item.auditType === audit.entityType,
    );
    if (!source || !("decisionActions" in source)) continue;
    if (!new RegExp(source.decisionActions, "i").test(audit.action)) continue;
    const action = audit.action.toLowerCase();
    const outcome = /reject|declin/.test(action)
      ? "Rejected"
      : /return/.test(action)
        ? "Returned"
        : /moderate/.test(action)
          ? "Moderated"
          : /lock/.test(action)
            ? "Locked"
            : /close/.test(action)
              ? "Closed"
              : "Approved";
    const stage = /-(manager|hr|accounts)$/.exec(action)?.[1];
    const role = stage
      ? stage === "hr"
        ? "HR"
        : stage === "accounts"
          ? "Accounts"
          : "Line Manager"
      : audit.role || "Reviewer";
    const key = `${source.module}:${audit.entityId}`;
    const decisions = decisionsByRecord.get(key) ?? [];
    decisions.push({
      actorName: audit.actorName,
      role,
      outcome,
      at: audit.at,
    });
    decisionsByRecord.set(key, decisions);
  }
  return {
    total: payload.total,
    page: input.page,
    pageSize: 30,
    rows: payload.rows.map((row) => {
      const request = toTrackedRequest(
        row,
        decisionsByRecord.get(`${row.module}:${row.id}`) ?? [],
        reviewerNames,
      );
      return reviewed && actor.activeRole !== "HR"
        ? {
            ...request,
            events: request.events.map((event) => ({ label: event.label, at: event.at })),
          }
        : request;
    }),
  };
}
