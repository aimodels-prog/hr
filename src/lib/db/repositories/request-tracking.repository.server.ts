import "@tanstack/react-start/server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDatabaseClient } from "../client.ts";
import { users } from "../schema/employee.ts";
import { auditEvents } from "../schema/system.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";
import {
  STATUS_GROUPS,
  requestDecisionOutcome,
  toTrackedRequest,
  type RequestDecision,
  type RequestSubmission,
  type RequestRow,
  type RequestGroup,
} from "../../data/request-tracking.ts";
import {
  canViewRequestDecisionSnapshot,
  parseRequestDecisionSnapshot,
  TRACKED_AUDIT_ACTION_PATTERN,
} from "../../data/request-decision-snapshot.ts";
import { reviewedEmployeeCurrentDetailsPolicy } from "../../data/request-tracking-detail-access.ts";

// Static SQL expressions only. No caller-provided identifier or SQL is interpolated here.
const independentReviewerMeta = (
  module:
    | "Leave"
    | "Timesheet"
    | "Attendance Correction"
    | "Overtime"
    | "Training"
    | "Visit"
    | "Time Away"
    | "Document"
    | "Training Certificate"
    | "Employment Confirmation",
) =>
  `,'independentReviewerName',(SELECT coalesce(rev.preferred_name,rev.legal_name) FROM hr_independent_review_assignments ia JOIN employees rev ON rev.id=ia.reviewer_employee_id AND rev.organisation_id=ia.organisation_id WHERE ia.organisation_id=r.organisation_id AND ia.module='${module}' AND ia.request_id=r.id AND ia.stage='HR' AND ia.archived_at IS NULL LIMIT 1)`;
const reviewerRolesByModule: Record<string, readonly string[]> = {
  Leave: ["HR", "Line Manager", "Employee"],
  Timesheets: ["HR", "Line Manager", "Employee"],
  Overtime: ["HR", "Line Manager", "Employee"],
  "Attendance corrections": ["HR", "Line Manager", "Employee"],
  "Time Away": ["HR", "Employee"],
  Visits: ["HR", "Employee"],
  Travel: ["HR", "Line Manager", "Accounts", "Travel Admin", "Employee"],
  Training: ["HR", "Line Manager", "Employee"],
  "Training certificates": ["HR", "Employee"],
  "Profile updates": ["HR", "Employee"],
  Documents: ["HR", "Employee"],
  Objectives: ["HR", "Line Manager"],
  Performance: ["HR", "Line Manager"],
  Applications: ["HR"],
  Referrals: ["HR"],
  Offers: ["HR", "Line Manager", "Accounts", "Travel Admin"],
  Payroll: ["Accounts"],
};
const sources = [
  {
    table: "leave_requests",
    module: "Leave",
    title:
      "btrim(regexp_replace(COALESCE(NULLIF(btrim(r.policy_snapshot->>'name'), ''), 'Leave'), '[[:space:]]+[—–-][[:space:]]+imported history[[:space:]]*$', '', 'i')) || ' · ' || r.start_date || ' to ' || r.end_date",
    self: "'/staff/me/leave-balances#request=' || r.id",
    hr: "'/staff/leave-admin#request=' || r.id",
    meta:
      "jsonb_build_object('chain',r.chain_approvals,'amendmentChain',r.pending_amendment->'chainApprovals','specialRequest',r.policy_snapshot ? 'specialRequest','noticeException',r.policy_snapshot ? 'noticeException','countryManagerName',(SELECT coalesce(cm.preferred_name,cm.legal_name) FROM employees cm WHERE cm.organisation_id=r.organisation_id AND cm.id::text=coalesce(r.policy_snapshot->'specialRequest'->>'countryManagerEmployeeId',r.policy_snapshot->'noticeException'->>'countryManagerEmployeeId') LIMIT 1)" +
      independentReviewerMeta("Leave") +
      ")",
    details:
      "jsonb_build_object('Leave type',btrim(regexp_replace(COALESCE(NULLIF(btrim(r.policy_snapshot->>'name'), ''), 'Leave'), 'imported history[[:space:]]*$', '', 'i'), ' ' || chr(8211) || chr(8212) || '-'),'Dates',r.start_date::text || ' to ' || r.end_date::text,'Days requested',r.working_days_requested::text,'Reason',r.reason,'Half day',CASE WHEN r.is_half_day THEN 'Yes' ELSE 'No' END,'Special request',CASE WHEN r.policy_snapshot ? 'specialRequest' THEN 'Yes' END,'Leave balance used',(SELECT string_agg(coalesce(lp.name,'Leave') || ' ' || (allocation.value->>'leaveYear') || ': ' || (allocation.value->>'days') || ' days', E'\\n') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.policy_snapshot->'specialRequest'->'allocations')='array' THEN r.policy_snapshot->'specialRequest'->'allocations' ELSE '[]'::jsonb END) AS allocation(value) LEFT JOIN leave_policies lp ON lp.organisation_id=r.organisation_id AND lp.id::text=(allocation.value->>'policyId')),'Remaining days pay',r.policy_snapshot->'specialRequest'->>'remainingPay','Supporting evidence',CASE WHEN r.attachment_file_id IS NOT NULL THEN 'Attached' END)",
    auditType: "leave-request",
    decisionActions: "^(approve|decline|reject)$",
  },
  {
    table: "timesheets",
    module: "Timesheets",
    self: "'/staff/me/timesheets/' || r.period_id",
    hr: "'/staff/timesheet-monitoring'",
    meta:
      "jsonb_build_object('submittedAt',r.submitted_at,'managerAt',r.supervisor_reviewed_at,'managerBy',r.supervisor_reviewed_by,'approvedAt',r.approved_at,'approvedBy',r.approved_by" +
      independentReviewerMeta("Timesheet") +
      ")",
    details:
      "jsonb_build_object('Period',(SELECT p.start_date::text || ' to ' || p.end_date::text FROM timesheet_periods p WHERE p.id=r.period_id),'Expected hours',r.expected_hours::text,'Recorded hours',r.total_hours::text,'Work entries',(SELECT string_agg(te.work_date::text || ' / ' || coalesce(project.name,'Project') || ' / ' || te.hours::text || ' h' || coalesce(' - ' || nullif(te.notes,''),''), E'\\n' ORDER BY te.work_date,project.name) FROM timesheet_entries te LEFT JOIN projects project ON project.id=te.project_id WHERE te.timesheet_id=r.id AND te.archived_at IS NULL))",
    reviewedBy: ["r.supervisor_reviewed_by", "r.approved_by"],
    auditType: "timesheet",
    decisionActions: "^(approve|return)$",
  },
  {
    table: "overtime_claims",
    module: "Overtime",
    self: "'/staff/overtime'",
    hr: "'/staff/overtime-approvals'",
    meta:
      "jsonb_build_object('approvedAt',r.approved_at,'approvedBy',r.approved_by,'preAuthorisedAt',r.pre_authorised_at,'preAuthorisedBy',r.pre_authorised_by" +
      independentReviewerMeta("Overtime") +
      ")",
    details:
      "jsonb_build_object('Date',r.date::text,'Hours requested',r.hours::text,'Reason',r.reason,'Compensation',r.compensation_type,'Request type',r.request_kind)",
    reviewedBy: ["r.pre_authorised_by", "r.approved_by"],
    auditType: "overtime-claim",
    decisionActions: "^(approve|reject|return)$",
  },
  {
    table: "attendance_corrections",
    module: "Attendance corrections",
    self: "'/staff/me/attendance'",
    hr: "'/staff/attendance/corrections'",
    meta:
      "jsonb_build_object('managerAt',r.manager_reviewed_at,'managerBy',r.manager_reviewed_by,'hrAt',r.hr_reviewed_at,'hrBy',r.hr_reviewed_by,'managerComment',r.manager_notes,'hrComment',r.hr_notes" +
      independentReviewerMeta("Attendance Correction") +
      ")",
    details:
      "jsonb_build_object('Correction type',r.correction_type,'Original clock in',r.original_clock_in::text,'Original clock out',r.original_clock_out::text,'Proposed clock in',r.proposed_clock_in::text,'Proposed clock out',r.proposed_clock_out::text,'Explanation',r.explanation)",
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
    meta:
      "jsonb_build_object('hrBy',r.reviewed_by,'hrComment',r.review_note" +
      independentReviewerMeta("Time Away") +
      ")",
    details:
      "jsonb_build_object('Date',r.date::text,'From',r.start_time,'Until',r.end_time,'Category',r.category,'Note',r.note,'Treatment',r.treatment)",
    reviewedBy: ["r.reviewed_by"],
    auditType: "time-away",
    decisionActions: "^time-away-(approved|rejected)$",
  },
  {
    table: "site_visit_requests",
    module: "Visits",
    status:
      "CASE WHEN r.details->'extension'->>'status'='Pending' THEN 'Extension Pending' ELSE r.status::text END",
    self: "'/staff/me/attendance'",
    hr: "'/staff/attendance'",
    meta:
      "jsonb_build_object('submittedAt',r.requested_at,'hrAt',r.hr_reviewed_at,'hrBy',r.hr_reviewed_by,'hrComment',r.hr_notes,'extensionPending',coalesce(r.details->'extension'->>'status'='Pending',false)" +
      independentReviewerMeta("Visit") +
      ")",
    details:
      "jsonb_build_object('Date',r.date::text,'From',r.start_time,'Until',r.end_time,'Origin',r.origin,'Destination',r.destination,'Purpose',r.purpose)",
    reviewedBy: ["r.hr_reviewed_by"],
    auditType: "site-visit",
    decisionActions: "^(approve|reject|extension-approve|extension-reject)$",
  },
  {
    table: "travel_requests",
    module: "Travel",
    self: "'/staff/travel/' || r.id",
    hr: "'/staff/travel/' || r.id",
    meta: "jsonb_build_object('manager',r.manager_approval_status,'hr',r.hr_approval_status,'finance',r.accounts_approval_status,'approvalRoute',r.approval_route,'independentReviewerName',(SELECT coalesce(rev.preferred_name,rev.legal_name) FROM employees rev WHERE rev.organisation_id=r.organisation_id AND rev.id::text=r.approval_route->>'reviewerEmployeeId' LIMIT 1),'pendingParticipantManagers',(SELECT string_agg(DISTINCT coalesce(m.preferred_name,m.legal_name), ', ') FROM jsonb_array_elements(r.participants) p JOIN employees m ON m.organisation_id=r.organisation_id AND m.id::text=p->>'managerId' WHERE p->>'status'='Pending'),'managerAt',r.manager_approved_at,'managerBy',r.manager_approved_by,'hrAt',r.hr_approved_at,'hrBy',r.hr_approved_by,'financeAt',r.accounts_approved_at,'financeBy',r.accounts_approved_by,'closedAt',r.closed_at,'closedBy',r.closed_by)",
    details:
      "jsonb_build_object('Destination',r.destination,'Purpose',r.purpose,'Dates',r.start_date::text || ' to ' || r.end_date::text,'Estimated cost',r.total_estimate::text || ' ' || r.currency,'Notes',r.notes)",
    reviewedBy: [
      "r.manager_approved_by",
      "r.hr_approved_by",
      "r.accounts_approved_by",
      "r.closed_by",
    ],
    auditType: "travel-request",
    decisionActions:
      "^((approve|reject)-(manager|hr|accounts|independent-review|participation)|close|reject)$",
  },
  {
    table: "training_requests",
    module: "Training",
    self: "'/staff/me/training'",
    hr: "'/staff/training'",
    meta:
      "jsonb_build_object('managerAt',r.supervisor_decision_at,'managerBy',r.supervisor_decision_by,'hrAt',r.hr_decision_at,'hrBy',r.hr_decision_by,'managerComment',r.supervisor_comment,'hrComment',r.hr_comment" +
      independentReviewerMeta("Training") +
      ")",
    details:
      "jsonb_build_object('Course',(SELECT c.title FROM training_courses c WHERE c.id=r.course_id),'Reason',r.reason,'Origin',r.origin)",
    reviewedBy: ["r.supervisor_decision_by", "r.hr_decision_by"],
    auditType: "training-request",
    decisionActions: "^(approve|reject)$",
  },
  {
    table: "profile_change_requests",
    module: "Profile updates",
    self: "'/staff/me/profile'",
    hr: "'/staff/employees/' || r.employee_id",
    meta: "jsonb_build_object('hrAt',r.reviewed_at,'hrBy',r.reviewer_id,'hrComment',r.review_notes)",
    details: "jsonb_build_object('Requested changes',r.changes::text,'HR notes',r.review_notes)",
    reviewedBy: ["r.reviewer_id"],
  },
  {
    table: "employees",
    module: "Profile updates",
    employee: "r.id",
    title: "'Employment details'",
    status: "r.employment_confirmation_status",
    sourceWhere:
      "(r.employment_confirmation_status <> 'Confirmed' OR r.employment_confirmed_by IS NOT NULL)",
    self: "'/staff/me/profile'",
    reviewedSelf: "'/staff/independent-record-reviews#review=' || r.id",
    hr: "'/staff/employees/' || r.id || '#section=employment'",
    meta:
      "jsonb_build_object('hrAt',r.employment_confirmed_at,'hrBy',r.employment_confirmed_by,'hrComment',r.employment_review_note" +
      independentReviewerMeta("Employment Confirmation") +
      ")",
    details:
      "jsonb_build_object('Employee',coalesce(r.proposed_employment_details->>'legalName',r.legal_name),'Start date',coalesce(r.proposed_employment_details->>'startDate',r.start_date::text),'Position',(SELECT p.name FROM positions p WHERE p.id=coalesce((r.proposed_employment_details->>'positionId')::uuid,r.position_id)),'Department',(SELECT d.name FROM departments d WHERE d.id=coalesce((r.proposed_employment_details->>'departmentId')::uuid,r.department_id)),'Location',(SELECT l.name FROM locations l WHERE l.id=coalesce((r.proposed_employment_details->>'locationId')::uuid,r.location_id)),'Supervisor',coalesce(r.proposed_employment_details->>'lineManagerEmail',(SELECT m.work_email FROM employees m WHERE m.id=r.line_manager_id),'No supervisor'),'Review note',r.employment_review_note)",
    reviewedBy: ["r.employment_confirmed_by"],
    auditType: "employee-employment-details",
    decisionActions: "^(confirm|request-changes)$",
  },
  {
    table: "training_records",
    module: "Training certificates",
    title: "r.title",
    status:
      "CASE WHEN r.hr_verified THEN 'Verified' WHEN r.rejected_at IS NOT NULL THEN 'Rejected' ELSE 'Pending HR' END",
    self: "'/staff/me/training'",
    reviewedSelf: "'/staff/independent-record-reviews#review=' || r.id",
    hr: "'/staff/employees/' || r.employee_id",
    meta:
      "jsonb_build_object('hrAt',coalesce(r.verified_at,r.rejected_at),'hrBy',coalesce(r.verified_by,r.rejected_by),'hrComment',coalesce(r.verification_comment,r.rejection_reason)" +
      independentReviewerMeta("Training Certificate") +
      ")",
    details:
      "jsonb_build_object('Certificate',r.title,'Provider',r.provider,'Completion date',r.completion_date::text,'Expiry date',r.expiry_date::text)",
    reviewedBy: ["r.verified_by", "r.rejected_by"],
    auditType: "training-record",
    decisionActions: "^(verify|reject)$",
  },
  {
    table: "employee_documents",
    module: "Documents",
    title: "initcap(replace(r.type::text,'_',' '))",
    status: "CASE WHEN r.replaced_by_id IS NOT NULL THEN 'Replaced' ELSE r.status::text END",
    details:
      "jsonb_build_object('Document type',initcap(replace(r.type::text,'_',' ')),'Issue date',r.issue_date::text,'Expiry date',r.expiry_date::text,'Issuing authority',r.issuing_authority,'Issuing country',r.issuing_country,'Notes',r.notes)",
    self: "'/staff/me/profile'",
    reviewedSelf: "'/staff/independent-record-reviews#review=' || r.id",
    hr: "'/staff/employees/' || r.employee_id || '#documents'",
    meta:
      "jsonb_build_object('hrComment',r.rejection_reason" +
      independentReviewerMeta("Document") +
      ")",
    auditType: "employee-document",
    decisionActions: "^(verify|reject)$",
  },
  {
    table: "employee_goals",
    module: "Objectives",
    self: "'/staff/me/performance'",
    hr: "'/staff/performance/team'",
    meta: "jsonb_build_object('submittedAt',r.submitted_at,'approvedAt',r.approved_at,'approvedBy',r.approved_by,'closedAt',r.completed_at)",
    details:
      "jsonb_build_object('Objective',r.title,'Description',r.description,'Success measure',r.success_measure,'Target',r.target_value,'Dates',r.start_date::text || ' to ' || r.due_date::text,'Progress',r.progress_percent::text || '%')",
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
    details:
      "jsonb_build_object('Manager summary',r.manager_summary_comment,'Development plan',r.development_plan,'Self score',r.overall_self_score::text,'Manager score',r.overall_manager_score::text)",
    detailsSelf:
      "jsonb_build_object('Self score',r.overall_self_score::text,'Manager summary',CASE WHEN r.status IN ('Acknowledgement Pending','Acknowledged','Locked') THEN r.manager_summary_comment END,'Development plan',CASE WHEN r.status IN ('Acknowledgement Pending','Acknowledged','Locked') THEN r.development_plan END,'Manager score',CASE WHEN r.status IN ('Acknowledgement Pending','Acknowledged','Locked') THEN r.overall_manager_score::text END)",
    auditType: "performance-review",
    decisionActions: "^(manager|moderate|lock)$",
  },
  {
    table: "candidate_applications",
    module: "Applications",
    title: "'Job application · ' || r.reference_id",
    employee: "r.internal_applicant_employee_id",
    details:
      "jsonb_build_object('Reference',r.reference_id,'Source',r.source,'Notice period',r.notice_period,'Cover note',r.cover_note)",
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
    details:
      "jsonb_build_object('Candidate',r.recommender_name,'Relationship',r.relationship,'Notes',r.notes,'Date',r.date::text)",
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
    details:
      "jsonb_build_object('Position',r.position,'Grade',r.grade,'Start date',r.start_date::text,'Location',r.location,'Conditions',r.conditions)",
    reviewedBy: ["r.approved_by"],
    auditType: "job-offer",
    decisionActions: "^(approve|reject|return)$",
  },
  {
    table: "payroll_periods",
    module: "Payroll",
    title: "r.name",
    employee: "NULL::uuid",
    self: "'/staff/payroll/periods/' || r.id",
    hr: "'/staff/payroll/periods/' || r.id",
    hrOnly: true,
    accountsOnly: true,
    meta: "jsonb_build_object('preparedBy',r.prepared_by)",
    details:
      "jsonb_build_object('Period',r.start_date::text || ' to ' || r.end_date::text,'Cutoff date',r.cutoff_date::text,'Payment date',r.payment_date::text,'Notes',r.notes)",
    auditType: "payroll-period",
    decisionActions: "^(approve|lock|reopen)$",
  },
] satisfies Array<{
  table: string;
  module: string;
  title?: string;
  employee?: string;
  status?: string;
  self: string;
  reviewedSelf?: string;
  hr: string;
  sourceWhere?: string;
  meta?: string;
  details?: string;
  detailsSelf?: string;
  hrOnly?: boolean;
  accountsOnly?: boolean;
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
    requestId?: string | undefined;
    includeDetails?: boolean | undefined;
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
    !["HR", "Line Manager", "Accounts", "Travel Admin", "Employee"].includes(actor.activeRole ?? "")
  )
    throw new Error("Use an approval role to view your decisions.");
  if (!hr && !reviewed && !actor.employeeId) throw new Error("An employee profile is required.");
  if (!Number.isInteger(input.page) || input.page < 1 || input.page > 100000)
    throw new Error("Invalid page.");
  const branches = sources
    .filter(
      (source) =>
        (!("accountsOnly" in source && source.accountsOnly) ||
          (reviewed && actor.activeRole === "Accounts")) &&
        (!reviewed ||
          reviewerRolesByModule[source.module]?.includes(actor.activeRole ?? "") === true) &&
        (hr || reviewed || !("hrOnly" in source && source.hrOnly)) &&
        (!input.module || input.module === "All" || source.module === input.module),
    )
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
          SELECT 1 FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(r.chain_approvals)='array' THEN r.chain_approvals ELSE '[]'::jsonb END
          ) step
          WHERE step->>'approvedBy' = ${actorUserId} AND step->>'status' IN ('Approved','Declined')
        )`);
        directReview.push(sql`EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(r.pending_amendment->'chainApprovals')='array'
              THEN r.pending_amendment->'chainApprovals' ELSE '[]'::jsonb END
          ) step
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
      const historicDecision =
        "auditType" in source && "decisionActions" in source
          ? sql`EXISTS (
              SELECT 1 FROM audit_events historical
              WHERE historical.organisation_id=r.organisation_id
                AND historical.entity_id=r.id
                AND historical.entity_type=${source.auditType}
                AND historical.action ~* ${source.decisionActions}
            )`
          : sql`false`;
      const detailPolicy =
        reviewed && actor.activeRole === "Employee"
          ? reviewedEmployeeCurrentDetailsPolicy(source.table)
          : { kind: "normal" as const };
      const detailsExpression =
        !input.includeDetails || !("details" in source)
          ? sql`'{}'::jsonb`
          : detailPolicy.kind === "omit"
            ? sql`'{}'::jsonb`
            : detailPolicy.kind === "assigned"
              ? actor.employeeId
                ? sql`CASE WHEN EXISTS (
                    SELECT 1 FROM hr_independent_review_assignments ia
                    WHERE ia.organisation_id=r.organisation_id
                      AND ia.module=${detailPolicy.module}
                      AND ia.request_id=r.id
                      AND ia.stage='HR'
                      AND ia.reviewer_employee_id=${actor.employeeId}::uuid
                      AND ia.archived_at IS NULL
                  ) THEN ${sql.raw(source.details)} ELSE '{}'::jsonb END`
                : sql`'{}'::jsonb`
              : sql.raw(
                  !hr && !reviewed && "detailsSelf" in source ? source.detailsSelf : source.details,
                );
      const actionExpression =
        reviewed && actor.activeRole === "Employee" && "reviewedSelf" in source
          ? source.reviewedSelf
          : hr || (reviewed && actor.activeRole === "HR")
            ? source.hr
            : source.self;
      return sql`SELECT r.id::text id, ${source.module}::text module, ${title}::text title,
      ${sql.raw(employee)}::text employee_id, coalesce(e.preferred_name,e.legal_name) employee_name,
      e.work_email employee_email, coalesce(m.preferred_name,m.legal_name) manager_name,
      creator.display_name created_by_name, ${sql.raw(status)}::text status, r.created_at, r.updated_at, r.archived_at,
      ${sql.raw(actionExpression)} action_url,
      ${sql.raw("meta" in source ? source.meta : "'{}'::jsonb")} metadata,
      ${detailsExpression} details
      FROM ${sql.raw(source.table)} r
      LEFT JOIN employees e ON e.id=${sql.raw(employee)} AND e.organisation_id=${organisationId}
      LEFT JOIN employees m ON m.id=e.line_manager_id AND m.organisation_id=${organisationId} AND m.archived_at IS NULL
      LEFT JOIN users creator ON creator.id=r.created_by AND creator.organisation_id=${organisationId}
      WHERE r.organisation_id=${organisationId}
        AND ${"sourceWhere" in source ? sql.raw(source.sourceWhere) : sql`true`}
        AND (r.archived_at IS NULL
          OR (${sql.raw(status)})::text IN ('Approved','Rejected','Declined','Valid','Verified','Replaced','Pre-authorised','Completed','Closed','Taken','Locked','Payroll Locked')
          OR ${historicDecision})
        AND ${hr || reviewed ? sql`true` : sql`${sql.raw(employee)}=${actor.employeeId}::uuid`}
        AND ${reviewed ? reviewFilter : sql`true`}`;
    });
  if (!branches.length) return { total: 0, page: input.page, pageSize: 30, rows: [] };
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
    AND (${input.requestId ?? ""}='' OR id=${input.requestId ?? ""})
    AND (${query}='' OR position(lower(${query}) in lower(concat_ws(' ',title,employee_name,employee_email,id,status)))>0)`;
  const db = getDatabaseClient();
  const [result] = await db.execute(sql`
    WITH source AS (${sql.join(branches, sql` UNION ALL `)}), classified AS (
      SELECT *, CASE WHEN archived_at IS NOT NULL THEN 'Closed' ELSE CASE ${sql.join(groupCases, sql` `)} WHEN status ~* 'pending|awaiting' OR status='New' THEN 'Waiting' ELSE 'In progress' END END request_group FROM source
    ), filtered AS (SELECT * FROM classified WHERE ${filters})
    SELECT (SELECT count(*)::int FROM filtered) total,
      coalesce((SELECT jsonb_agg(page_rows) FROM (SELECT id,module,title,employee_id,employee_name,manager_name,created_by_name,status,created_at,updated_at,archived_at,action_url,metadata,details FROM filtered ORDER BY updated_at DESC,module,id LIMIT 30 OFFSET ${(input.page - 1) * 30}) page_rows),'[]'::jsonb) rows`);
  const payload = result as unknown as { total: number; rows: RequestRow[] };
  const ids = [...new Set(payload.rows.map((row) => row.id))];
  const reviewerIds = new Set<string>();
  for (const row of payload.rows) {
    for (const [key, value] of Object.entries(row.metadata ?? {}))
      if (key.endsWith("By") && typeof value === "string") reviewerIds.add(value);
    for (const key of ["chain", "amendmentChain"]) {
      const chain = row.metadata?.[key];
      if (Array.isArray(chain))
        for (const step of chain)
          if (step && typeof step === "object" && typeof step.approvedBy === "string")
            reviewerIds.add(step.approvedBy);
    }
  }
  const [audits, reviewers] = await Promise.all([
    ids.length
      ? db
          .select({
            entityId: auditEvents.entityId,
            entityType: auditEvents.entityType,
            action: auditEvents.action,
            actorName: auditEvents.actorDisplayName,
            actorUserId: auditEvents.actorUserId,
            role: auditEvents.activeRole,
            at: auditEvents.occurredAt,
            reason: auditEvents.reason,
            afterSummary: auditEvents.afterSummary,
          })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.organisationId, organisationId),
              inArray(auditEvents.entityId, ids),
              sql`${auditEvents.action} ~* ${TRACKED_AUDIT_ACTION_PATTERN}`,
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
  const submissionsByRecord = new Map<string, RequestSubmission[]>();
  const rowsByKey = new Map(payload.rows.map((row) => [`${row.module}:${row.id}`, row]));
  const actualReviewerUserIdsByRecord = new Map<string, Set<string>>();
  for (const audit of audits) {
    const source = sources.find(
      (item) => "auditType" in item && item.auditType === audit.entityType,
    );
    if (!source || !("decisionActions" in source) || !audit.actorUserId) continue;
    if (!new RegExp(source.decisionActions, "i").test(audit.action)) continue;
    const key = `${source.module}:${audit.entityId}`;
    const reviewers = actualReviewerUserIdsByRecord.get(key) ?? new Set<string>();
    reviewers.add(audit.actorUserId);
    actualReviewerUserIdsByRecord.set(key, reviewers);
  }
  for (const audit of audits) {
    const source = sources.find(
      (item) => "auditType" in item && item.auditType === audit.entityType,
    );
    if (!source) continue;
    const key = `${source.module}:${audit.entityId}`;
    if (/^(submit|request)$/i.test(audit.action)) {
      const submissions = submissionsByRecord.get(key) ?? [];
      submissions.push({ actorName: audit.actorName, at: audit.at });
      submissionsByRecord.set(key, submissions);
      continue;
    }
    if (!("decisionActions" in source)) continue;
    if (!new RegExp(source.decisionActions, "i").test(audit.action)) continue;
    const action = audit.action.toLowerCase();
    const outcome = requestDecisionOutcome(action);
    const stage = /-(manager|hr|accounts)$/.exec(action)?.[1];
    const chainRole = ["chain", "amendmentChain"]
      .flatMap((chainKey) => {
        const chain = rowsByKey.get(key)?.metadata?.[chainKey];
        return Array.isArray(chain) ? chain : [];
      })
      .find(
        (step) =>
          step &&
          typeof step === "object" &&
          step.approvedBy === audit.actorUserId &&
          typeof step.date === "string" &&
          Math.abs(Date.parse(step.date) - Date.parse(audit.at)) < 60_000,
      );
    const role =
      typeof chainRole?.role === "string"
        ? chainRole.role
        : /-independent-review$/.test(action)
          ? "Independent reviewer"
          : source.module === "Profile updates" && audit.role === "Employee"
            ? "Independent reviewer"
            : stage
              ? stage === "hr"
                ? "HR"
                : stage === "accounts"
                  ? "Accounts"
                  : "Line Manager"
              : audit.role || "Reviewer";
    const decisions = decisionsByRecord.get(key) ?? [];
    const after =
      audit.afterSummary &&
      typeof audit.afterSummary === "object" &&
      !Array.isArray(audit.afterSummary)
        ? (audit.afterSummary as Record<string, unknown>)
        : {};
    const row = rowsByKey.get(key);
    const mayReadSnapshot =
      !!row &&
      canViewRequestDecisionSnapshot({
        subjectEmployeeId: row.employee_id,
        viewerEmployeeId: actor.employeeId,
        viewerUserId: actorUserId,
        viewerRole: actor.activeRole,
        actualReviewerUserIds: actualReviewerUserIdsByRecord.get(key) ?? new Set<string>(),
      });
    const snapshot = mayReadSnapshot ? parseRequestDecisionSnapshot(source.module, after) : null;
    decisions.push({
      ...(audit.actorUserId ? { actorId: audit.actorUserId } : {}),
      actorName: audit.actorName,
      role,
      outcome,
      at: audit.at,
      ...(typeof after["status"] === "string" ? { statusAfter: after["status"] } : {}),
      ...(snapshot ? { snapshot } : {}),
      ...(mayReadSnapshot && ["Profile updates", "Timesheets"].includes(source.module) && !snapshot
        ? { snapshotUnavailable: true }
        : {}),
      ...((!reviewed || actor.activeRole === "HR" || audit.actorUserId === actorUserId) &&
      audit.reason
        ? { comment: audit.reason }
        : {}),
    });
    decisionsByRecord.set(key, decisions);
  }
  return {
    total: payload.total,
    page: input.page,
    pageSize: 30,
    rows: payload.rows.map((row) => {
      const safeRow =
        reviewed && actor.activeRole !== "HR"
          ? {
              ...row,
              metadata: Object.fromEntries(
                Object.entries(row.metadata ?? {}).filter(([key]) => !key.endsWith("Comment")),
              ),
            }
          : row;
      const request = toTrackedRequest(
        safeRow,
        decisionsByRecord.get(`${row.module}:${row.id}`) ?? [],
        reviewerNames,
        submissionsByRecord.get(`${row.module}:${row.id}`),
      );
      return request;
    }),
  };
}
