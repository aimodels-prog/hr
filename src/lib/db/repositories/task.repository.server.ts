import "@tanstack/react-start/server-only";
import { employeeDocumentLink } from "../../data/document-links.ts";

import { randomUUID } from "node:crypto";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import type { AppTask, TaskState } from "../../data/task-service.ts";
import { isApprovalTask } from "../../data/request-tracking.ts";
import type { NotificationPriority, Role } from "../../data/types.ts";
import { getDatabaseClient } from "../client.ts";
import { roles, userRoles, users } from "../schema/employee.ts";
import { workflowTasks } from "../schema/onboarding-offboarding.ts";
import { organisations } from "../schema/organisation.ts";
import { auditEvents, notifications } from "../schema/system.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

type TaskRow = {
  task_id: string;
  module: string;
  title: string;
  description: string;
  priority: NotificationPriority;
  due_date: string | null;
  state_override: TaskState | null;
  action_label: string;
  action_url: string;
  source_type: string;
  source_id: string;
  source_version: number | null;
  subject_employee_id: string | null;
  subject_name: string | null;
};

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function stateFor(dueDate: string | null, override: TaskState | null, today: string): TaskState {
  if (override) return override;
  if (!dueDate) return "Open";
  if (dueDate < today) return "Overdue";
  if (dueDate <= addDays(today, 7)) return "Due Soon";
  return "Open";
}

/**
 * Derives the inbox directly from authoritative workflow rows. Every branch includes its own
 * employee, reporting-line or role predicate so an unauthorised row never reaches the caller.
 */
export async function listTasksForActorInDatabase(
  organisationId: string,
  actor: AuditActorContext,
  today = new Date().toISOString().slice(0, 10),
): Promise<AppTask[]> {
  if (!actor.userId) throw new Error("A verified user is required.");
  const role = (actor.activeRole ?? actor.roles?.[0] ?? "Employee") as Role;
  const employeeId = actor.employeeId ?? null;
  const result = await getDatabaseClient().execute(sql`
    WITH task_rows AS (
      SELECT
        'timesheet-self-' || t.id AS task_id, 'Timesheets' AS module,
        CASE WHEN t.status='Returned' THEN 'Correct returned timesheet' ELSE 'Submit timesheet' END AS title,
        CASE WHEN t.status='Returned' THEN coalesce(t.manager_notes,'Your supervisor returned this timesheet for correction.') ELSE 'Complete and submit this timesheet period.' END AS description,
        CASE WHEN t.status='Returned' THEN 'High' ELSE 'Normal' END AS priority,
        (p.end_date + 2)::text AS due_date, NULL::text AS state_override,
        'Open timesheet' AS action_label, '/staff/me/timesheets/' || p.id AS action_url,
        'timesheet' AS source_type, t.id::text AS source_id, t.employee_id::text AS subject_employee_id,
        coalesce(e.preferred_name,e.legal_name) AS subject_name
      FROM timesheets t JOIN timesheet_periods p ON p.id=t.period_id JOIN employees e ON e.id=t.employee_id
      WHERE t.organisation_id=${organisationId} AND t.archived_at IS NULL AND t.employee_id=${employeeId}::uuid
        AND (t.status='Returned' OR (t.status='Draft' AND p.end_date <= ${today}::date))

      UNION ALL
      SELECT 'travel-expenses-' || r.id, 'Travel', 'Submit trip expenses',
        'Add bill references and receipts for your trip to ' || r.destination, 'Normal',
        (r.end_date + 7)::text, NULL, 'Add expenses', '/staff/travel/' || r.id,
        'travel-request', r.id::text, r.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM travel_requests r JOIN employees e ON e.id=r.employee_id
      WHERE r.organisation_id=${organisationId} AND r.archived_at IS NULL AND r.employee_id=${employeeId}::uuid
        AND r.status='Pre-authorised' AND r.end_date < ${today}::date

      UNION ALL
      SELECT 'document-replace-' || d.id, 'Documents', 'Replace rejected document',
        coalesce(d.rejection_reason,'Upload a corrected employee document.'), 'High', NULL, NULL,
        'Open documents', '/staff/me/profile', 'employee-document', d.id::text,
        d.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM employee_documents d JOIN employees e ON e.id=d.employee_id
      WHERE d.organisation_id=${organisationId} AND d.archived_at IS NULL AND d.employee_id=${employeeId}::uuid
        AND d.status='Rejected'

      UNION ALL
      SELECT 'training-attend-' || a.id, 'Training', 'Attend scheduled training',
        s.title || ' at ' || s.location, 'Normal', s.start_at::date::text, NULL,
        'View training plan', '/staff/me/training', 'training-assignment', a.id::text,
        a.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM training_assignments a JOIN training_sessions s ON s.id=a.session_id JOIN employees e ON e.id=a.employee_id
      WHERE a.organisation_id=${organisationId} AND a.archived_at IS NULL AND a.employee_id=${employeeId}::uuid
        AND a.status='Scheduled' AND s.status='Scheduled'

      UNION ALL
      SELECT 'training-renew-' || tr.id, 'Training', 'Renew expiring certification',
        tr.title || ' expires on ' || tr.expiry_date, CASE WHEN tr.expiry_date <= ${today}::date + 30 THEN 'High' ELSE 'Normal' END,
        tr.expiry_date::text, NULL, 'Open my learning', '/staff/me/training', 'training-record', tr.id::text,
        tr.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM training_records tr JOIN employees e ON e.id=tr.employee_id
      WHERE tr.organisation_id=${organisationId} AND tr.archived_at IS NULL AND tr.employee_id=${employeeId}::uuid
        AND tr.expiry_date IS NOT NULL AND tr.expiry_date <= ${today}::date + 60

      UNION ALL
      SELECT 'leave-manager-' || l.id, 'Leave', 'Review leave request',
        coalesce(e.preferred_name,e.legal_name) || ' has submitted a leave request.', 'Normal',
        (l.created_at::date + 2)::text, NULL, 'Review request', '/staff/leave-approvals',
        'leave-request', l.id::text, l.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM leave_requests l JOIN employees e ON e.id=l.employee_id
      WHERE l.organisation_id=${organisationId} AND l.archived_at IS NULL
        AND ${role} IN ('Line Manager','HR')
        AND e.line_manager_id=${employeeId}::uuid AND l.status IN ('Pending Line Manager','Amendment Pending Line Manager')

      UNION ALL
      SELECT 'timesheet-manager-' || t.id, 'Timesheets', 'Review submitted timesheet',
        coalesce(e.preferred_name,e.legal_name) || ' submitted ' || t.total_hours || ' hours.', 'Normal',
        (coalesce(t.submitted_at,t.updated_at)::date + 2)::text, NULL, 'Review timesheet',
        '/staff/timesheet-approvals/' || t.id, 'timesheet', t.id::text, t.employee_id::text,
        coalesce(e.preferred_name,e.legal_name)
      FROM timesheets t JOIN employees e ON e.id=t.employee_id
      WHERE t.organisation_id=${organisationId} AND t.archived_at IS NULL AND ${role} IN ('Line Manager','HR')
        AND e.line_manager_id=${employeeId}::uuid AND t.status='Pending Manager'

      UNION ALL
      SELECT 'attendance-manager-' || c.id, 'Attendance', 'Review attendance correction',
        coalesce(e.preferred_name,e.legal_name) || ' submitted an attendance correction.', 'High',
        (c.created_at::date + 1)::text, NULL, 'Review correction', '/staff/attendance/corrections',
        'attendance-correction', c.id::text, c.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM attendance_corrections c JOIN employees e ON e.id=c.employee_id
      WHERE c.organisation_id=${organisationId} AND c.archived_at IS NULL AND ${role} IN ('Line Manager','HR')
        AND e.line_manager_id=${employeeId}::uuid AND c.status='Pending Manager'

      UNION ALL
      SELECT 'overtime-manager-' || o.id, 'Overtime', 'Review overtime claim',
        coalesce(e.preferred_name,e.legal_name) || ' submitted ' || o.hours || ' overtime hours.',
        CASE WHEN jsonb_array_length(o.cross_check_warnings)>0 THEN 'High' ELSE 'Normal' END,
        (o.created_at::date + 2)::text, NULL, 'Review claim', '/staff/overtime-approvals',
        'overtime-claim', o.id::text, o.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM overtime_claims o JOIN employees e ON e.id=o.employee_id
      WHERE o.organisation_id=${organisationId} AND o.archived_at IS NULL AND ${role} IN ('Line Manager','HR')
        AND e.line_manager_id=${employeeId}::uuid AND o.status IN ('Pending Pre-authorisation','Pending Manager')

      UNION ALL
      SELECT 'training-manager-' || r.id, 'Training', 'Review training request',
        coalesce(e.preferred_name,e.legal_name) || ' submitted a training request.', 'Normal',
        (r.created_at::date + 3)::text, NULL, 'Review training', '/staff/training',
        'training-request', r.id::text, r.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM training_requests r JOIN employees e ON e.id=r.employee_id
      WHERE r.organisation_id=${organisationId} AND r.archived_at IS NULL AND ${role} IN ('Line Manager','HR')
        AND e.line_manager_id=${employeeId}::uuid AND r.status='Pending Supervisor'

      UNION ALL
      SELECT 'performance-manager-' || r.id, 'Performance',
        CASE WHEN r.status='Manager Review Pending' THEN 'Complete manager review' ELSE 'Hold performance discussion' END,
        'Complete the current review for ' || coalesce(e.preferred_name,e.legal_name) || '.', 'High',
        CASE WHEN r.status='Manager Review Pending' THEN c.manager_review_deadline::text ELSE c.discussion_deadline::text END,
        NULL, 'Open review', '/staff/performance/reviews/' || r.id, 'performance-review', r.id::text,
        r.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM performance_reviews r JOIN performance_cycles c ON c.id=r.cycle_id JOIN employees e ON e.id=r.employee_id
      WHERE r.organisation_id=${organisationId} AND r.archived_at IS NULL AND ${role} IN ('Line Manager','HR')
        AND e.line_manager_id=${employeeId}::uuid AND r.status IN ('Manager Review Pending','Discussion Pending')

      UNION ALL
      SELECT 'performance-self-' || r.id, 'Performance',
        CASE WHEN r.status='Objectives Pending' THEN 'Set performance objectives' WHEN r.status='Self Assessment Pending' THEN 'Complete self-assessment' ELSE 'Acknowledge performance review' END,
        'Complete your action for ' || c.name || '.', 'High',
        CASE WHEN r.status='Objectives Pending' THEN c.objective_setting_deadline::text WHEN r.status='Self Assessment Pending' THEN c.self_assessment_deadline::text ELSE c.discussion_deadline::text END,
        NULL, 'Open review', '/staff/performance/reviews/' || r.id, 'performance-review', r.id::text,
        r.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM performance_reviews r JOIN performance_cycles c ON c.id=r.cycle_id JOIN employees e ON e.id=r.employee_id
      WHERE r.organisation_id=${organisationId} AND r.archived_at IS NULL AND r.employee_id=${employeeId}::uuid
        AND r.status IN ('Objectives Pending','Self Assessment Pending','Acknowledgement Pending')

      UNION ALL
      SELECT 'leave-hr-' || l.id, 'Leave', 'Confirm leave request',
        CASE WHEN l.policy_snapshot->'noticeException' IS NOT NULL
          THEN coalesce(e.preferred_name,e.legal_name) || '''s short-notice request needs your exception review.'
          ELSE coalesce(e.preferred_name,e.legal_name) || '''s leave request needs your decision.' END, 'High',
        (l.updated_at::date + 2)::text, NULL, 'Review request', '/staff/leave-approvals',
        'leave-request', l.id::text, l.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM leave_requests l JOIN employees e ON e.id=l.employee_id
      WHERE l.organisation_id=${organisationId} AND l.archived_at IS NULL AND ${role}='HR'
        AND NOT EXISTS (SELECT 1 FROM hr_independent_review_assignments a
          WHERE a.organisation_id=l.organisation_id AND a.archived_at IS NULL AND a.module='Leave'
            AND a.request_id=l.id AND a.stage='HR')
        AND (
          l.status IN ('Amendment Pending HR','Cancellation Pending')
          OR (l.status='Pending HR' AND (
            (l.policy_snapshot->'specialRequest' IS NOT NULL AND ${role}='HR'
              AND NOT l.chain_approvals @> '[{"role":"Country Manager","status":"Pending"}]'::jsonb
              AND l.chain_approvals @> '[{"role":"HR","status":"Pending"}]'::jsonb)
            OR (l.policy_snapshot->'noticeException' IS NOT NULL AND ${role}='HR'
              AND l.chain_approvals @> '[{"role":"HR","status":"Pending"}]'::jsonb)
            OR (l.policy_snapshot->'specialRequest' IS NULL
              AND l.policy_snapshot->'noticeException' IS NULL)
          ))
        )

      UNION ALL
      SELECT 'leave-country-manager-' || l.id, 'Leave',
        CASE WHEN l.policy_snapshot->'noticeException' IS NOT NULL
          THEN 'Review short-notice exception' ELSE 'Review special leave' END,
        coalesce(e.preferred_name,e.legal_name) || '''s leave request needs the Country Manager decision.', 'High',
        (l.updated_at::date + 2)::text, NULL, 'Review request', '/staff/leave-approvals',
        'leave-request', l.id::text, l.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM leave_requests l JOIN employees e ON e.id=l.employee_id
      WHERE l.organisation_id=${organisationId} AND l.archived_at IS NULL
        AND ${role} IN ('Employee','Line Manager','HR')
        AND l.status='Pending HR'
        AND l.chain_approvals @> '[{"role":"Country Manager","status":"Pending"}]'::jsonb
        AND coalesce(
          l.policy_snapshot->'specialRequest'->>'countryManagerEmployeeId',
          l.policy_snapshot->'noticeException'->>'countryManagerEmployeeId'
        )=${employeeId}
        AND l.employee_id<>${employeeId}::uuid

      UNION ALL
      SELECT 'timesheet-hr-' || t.id, 'Timesheets', 'Approve reviewed timesheet',
        coalesce(e.preferred_name,e.legal_name) || '''s supervisor completed the first review.', 'High',
        (t.updated_at::date + 2)::text, NULL, 'Review timesheet', '/staff/timesheet-approvals/' || t.id,
        'timesheet', t.id::text, t.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM timesheets t JOIN employees e ON e.id=t.employee_id
      WHERE t.organisation_id=${organisationId} AND t.archived_at IS NULL AND ${role}='HR' AND t.status='Pending HR'
        AND NOT EXISTS (SELECT 1 FROM hr_independent_review_assignments a
          WHERE a.organisation_id=t.organisation_id AND a.archived_at IS NULL AND a.module='Timesheet'
            AND a.request_id=t.id AND a.stage='HR')

      UNION ALL
      SELECT 'attendance-hr-' || c.id, 'Attendance', 'Complete attendance correction review',
        'Review the supervisor-approved correction for ' || coalesce(e.preferred_name,e.legal_name) || '.', 'High',
        (c.updated_at::date + 1)::text, NULL, 'Review correction', '/staff/attendance/corrections',
        'attendance-correction', c.id::text, c.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM attendance_corrections c JOIN employees e ON e.id=c.employee_id
      WHERE c.organisation_id=${organisationId} AND c.archived_at IS NULL AND ${role}='HR' AND c.status='Pending HR'
        AND NOT EXISTS (SELECT 1 FROM hr_independent_review_assignments a
          WHERE a.organisation_id=c.organisation_id AND a.archived_at IS NULL AND a.module='Attendance Correction'
            AND a.request_id=c.id AND a.stage='HR')

      UNION ALL
      SELECT 'site-visit-hr-' || v.id, 'Attendance', 'Review site visit request',
        coalesce(e.preferred_name,e.legal_name) || ' requested permission to visit ' || v.destination || '.', 'Normal',
        v.date::text, NULL, 'Review request', '/staff/attendance#section=site-visits&visit=' || v.id::text, 'site-visit-request', v.id::text,
        v.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM site_visit_requests v JOIN employees e ON e.id=v.employee_id
      WHERE v.organisation_id=${organisationId} AND v.archived_at IS NULL AND ${role}='HR'
        AND v.employee_id<>${employeeId}::uuid
        AND NOT EXISTS (SELECT 1 FROM hr_independent_review_assignments a
          WHERE a.organisation_id=v.organisation_id AND a.archived_at IS NULL
            AND a.module='Visit' AND a.request_id=v.id AND a.stage='HR')
        AND (v.status='Pending HR' OR (v.status IN ('Approved','Completed') AND v.details->'extension'->>'status'='Pending'))

      UNION ALL
      SELECT 'time-away-hr-' || a.id, 'Attendance', 'Review time away',
        coalesce(e.preferred_name,e.legal_name) || ' has time away awaiting an HR decision.', 'Normal',
        a.date::text, NULL, 'Review time away',
        '/staff/time-away?date=' || a.date::text || '&review=' || a.id::text,
        'time-away', a.id::text, a.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM time_away a JOIN employees e ON e.id=a.employee_id
      WHERE a.organisation_id=${organisationId} AND a.archived_at IS NULL AND ${role}='HR'
        AND a.status='Pending HR' AND a.employee_id<>${employeeId}::uuid
        AND a.created_by<>${actor.userId}::uuid
        AND NOT EXISTS (SELECT 1 FROM hr_independent_review_assignments ira
          WHERE ira.organisation_id=a.organisation_id AND ira.archived_at IS NULL
            AND ira.module='Time Away' AND ira.request_id=a.id AND ira.stage='HR')

      UNION ALL
      SELECT 'independent-hr-review-Visit-' || v.id, 'Attendance', 'Review HR colleague visit',
        coalesce(e.preferred_name,e.legal_name) || ' requested a visit to ' || v.destination || '.', 'High',
        v.date::text, NULL, 'Review visit', '/staff/independent-visit-reviews#review=' || v.id,
        'site-visit-request', v.id::text, v.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM hr_independent_review_assignments ira
      JOIN site_visit_requests v ON v.id=ira.request_id AND v.organisation_id=ira.organisation_id
      JOIN employees e ON e.id=v.employee_id AND e.organisation_id=v.organisation_id
      JOIN employees reviewer ON reviewer.id=ira.reviewer_employee_id AND reviewer.organisation_id=ira.organisation_id
      WHERE ira.organisation_id=${organisationId} AND ira.archived_at IS NULL
        AND ira.module='Visit' AND ira.stage='HR' AND ${role}='Employee'
        AND ira.reviewer_employee_id=${employeeId}::uuid AND ira.requester_employee_id<>${employeeId}::uuid
        AND reviewer.status='Active' AND reviewer.archived_at IS NULL
        AND v.archived_at IS NULL
        AND (v.status='Pending HR' OR (v.status IN ('Approved','Completed') AND v.details->'extension'->>'status'='Pending'))

      UNION ALL
      SELECT 'independent-hr-review-Time-Away-' || a.id, 'Attendance', 'Review HR colleague time away',
        coalesce(e.preferred_name,e.legal_name) || ' has time away waiting for your decision.', 'High',
        a.date::text, NULL, 'Review time away',
        '/staff/time-away?date=' || a.date::text || '&review=' || a.id,
        'time-away', a.id::text, a.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM hr_independent_review_assignments ira
      JOIN time_away a ON a.id=ira.request_id AND a.organisation_id=ira.organisation_id
      JOIN employees e ON e.id=a.employee_id AND e.organisation_id=a.organisation_id
      JOIN employees reviewer ON reviewer.id=ira.reviewer_employee_id AND reviewer.organisation_id=ira.organisation_id
      WHERE ira.organisation_id=${organisationId} AND ira.archived_at IS NULL
        AND ira.module='Time Away' AND ira.stage='HR' AND ${role}='Employee'
        AND ira.reviewer_employee_id=${employeeId}::uuid AND ira.requester_employee_id<>${employeeId}::uuid
        AND reviewer.status='Active' AND reviewer.archived_at IS NULL
        AND a.archived_at IS NULL AND a.status='Pending HR'

      UNION ALL
      SELECT 'overtime-hr-' || o.id, 'Overtime', 'Verify overtime claim',
        coalesce(e.preferred_name,e.legal_name) || ' has a supervisor-approved overtime claim.', 'High',
        (o.updated_at::date + 2)::text, NULL, 'Verify claim', '/staff/overtime-approvals',
        'overtime-claim', o.id::text, o.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM overtime_claims o JOIN employees e ON e.id=o.employee_id
      WHERE o.organisation_id=${organisationId} AND o.archived_at IS NULL AND ${role}='HR' AND o.status='Pending HR'
        AND NOT EXISTS (SELECT 1 FROM hr_independent_review_assignments a
          WHERE a.organisation_id=o.organisation_id AND a.archived_at IS NULL AND a.module='Overtime'
            AND a.request_id=o.id AND a.stage='HR')

      UNION ALL
      SELECT 'training-hr-' || r.id, 'Training', 'Approve training request',
        coalesce(e.preferred_name,e.legal_name) || ' has a training request awaiting HR.', 'Normal',
        (r.updated_at::date + 3)::text, NULL, 'Review training', '/staff/training',
        'training-request', r.id::text, r.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM training_requests r JOIN employees e ON e.id=r.employee_id
      WHERE r.organisation_id=${organisationId} AND r.archived_at IS NULL AND ${role}='HR' AND r.status='Pending HR'
        AND NOT EXISTS (SELECT 1 FROM hr_independent_review_assignments a
          WHERE a.organisation_id=r.organisation_id AND a.archived_at IS NULL AND a.module='Training'
            AND a.request_id=r.id AND a.stage='HR')

      UNION ALL
      SELECT 'independent-hr-review-Leave-' || l.id, 'Leave', 'Review HR colleague leave',
        coalesce(e.preferred_name,e.legal_name) || ' needs your independent decision.', 'High',
        (l.updated_at::date + 2)::text, NULL, 'Review leave', '/staff/leave-approvals',
        'leave-request', l.id::text, l.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM hr_independent_review_assignments a
      JOIN leave_requests l ON l.id=a.request_id AND l.organisation_id=a.organisation_id
      JOIN employees e ON e.id=l.employee_id AND e.organisation_id=l.organisation_id
      JOIN employees reviewer ON reviewer.id=a.reviewer_employee_id AND reviewer.organisation_id=a.organisation_id
      WHERE a.organisation_id=${organisationId} AND a.archived_at IS NULL AND a.module='Leave' AND a.stage='HR' AND ${role}='Employee'
        AND a.reviewer_employee_id=${employeeId}::uuid AND a.requester_employee_id<>${employeeId}::uuid
        AND reviewer.status='Active' AND reviewer.archived_at IS NULL
        AND l.archived_at IS NULL AND l.status='Pending HR'
        AND l.chain_approvals @> '[{"role":"HR","status":"Pending"}]'::jsonb

      UNION ALL
      SELECT 'independent-hr-review-Timesheet-' || t.id, 'Timesheets', 'Review HR colleague timesheet',
        coalesce(e.preferred_name,e.legal_name) || ' needs your independent decision.', 'High',
        (t.updated_at::date + 2)::text, NULL, 'Review timesheet', '/staff/timesheet-approvals/' || t.id,
        'timesheet', t.id::text, t.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM hr_independent_review_assignments a
      JOIN timesheets t ON t.id=a.request_id AND t.organisation_id=a.organisation_id
      JOIN employees e ON e.id=t.employee_id AND e.organisation_id=t.organisation_id
      JOIN employees reviewer ON reviewer.id=a.reviewer_employee_id AND reviewer.organisation_id=a.organisation_id
      WHERE a.organisation_id=${organisationId} AND a.archived_at IS NULL AND a.module='Timesheet' AND a.stage='HR' AND ${role}='Employee'
        AND a.reviewer_employee_id=${employeeId}::uuid AND a.requester_employee_id<>${employeeId}::uuid
        AND reviewer.status='Active' AND reviewer.archived_at IS NULL
        AND t.archived_at IS NULL AND t.status='Pending HR'

      UNION ALL
      SELECT 'independent-hr-review-Attendance-' || c.id, 'Attendance', 'Review HR colleague attendance correction',
        coalesce(e.preferred_name,e.legal_name) || ' needs your independent decision.', 'High',
        (c.updated_at::date + 1)::text, NULL, 'Review correction', '/staff/attendance/corrections',
        'attendance-correction', c.id::text, c.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM hr_independent_review_assignments a
      JOIN attendance_corrections c ON c.id=a.request_id AND c.organisation_id=a.organisation_id
      JOIN employees e ON e.id=c.employee_id AND e.organisation_id=c.organisation_id
      JOIN employees reviewer ON reviewer.id=a.reviewer_employee_id AND reviewer.organisation_id=a.organisation_id
      WHERE a.organisation_id=${organisationId} AND a.archived_at IS NULL AND a.module='Attendance Correction' AND a.stage='HR' AND ${role}='Employee'
        AND a.reviewer_employee_id=${employeeId}::uuid AND a.requester_employee_id<>${employeeId}::uuid
        AND reviewer.status='Active' AND reviewer.archived_at IS NULL
        AND c.archived_at IS NULL AND c.status='Pending HR'

      UNION ALL
      SELECT 'independent-hr-review-Overtime-' || o.id, 'Overtime', 'Review HR colleague overtime',
        coalesce(e.preferred_name,e.legal_name) || ' needs your independent decision.', 'High',
        (o.updated_at::date + 2)::text, NULL, 'Review overtime', '/staff/overtime-approvals',
        'overtime-claim', o.id::text, o.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM hr_independent_review_assignments a
      JOIN overtime_claims o ON o.id=a.request_id AND o.organisation_id=a.organisation_id
      JOIN employees e ON e.id=o.employee_id AND e.organisation_id=o.organisation_id
      JOIN employees reviewer ON reviewer.id=a.reviewer_employee_id AND reviewer.organisation_id=a.organisation_id
      WHERE a.organisation_id=${organisationId} AND a.archived_at IS NULL AND a.module='Overtime' AND a.stage='HR' AND ${role}='Employee'
        AND a.reviewer_employee_id=${employeeId}::uuid AND a.requester_employee_id<>${employeeId}::uuid
        AND reviewer.status='Active' AND reviewer.archived_at IS NULL
        AND o.archived_at IS NULL AND o.status IN ('Pending HR','Pending Pre-authorisation')

      UNION ALL
      SELECT 'independent-hr-review-Training-' || r.id, 'Training', 'Review HR colleague training request',
        coalesce(e.preferred_name,e.legal_name) || ' needs your independent decision.', 'Normal',
        (r.updated_at::date + 3)::text, NULL, 'Review training', '/staff/training',
        'training-request', r.id::text, r.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM hr_independent_review_assignments a
      JOIN training_requests r ON r.id=a.request_id AND r.organisation_id=a.organisation_id
      JOIN employees e ON e.id=r.employee_id AND e.organisation_id=r.organisation_id
      JOIN employees reviewer ON reviewer.id=a.reviewer_employee_id AND reviewer.organisation_id=a.organisation_id
      WHERE a.organisation_id=${organisationId} AND a.archived_at IS NULL AND a.module='Training' AND a.stage='HR' AND ${role}='Employee'
        AND a.reviewer_employee_id=${employeeId}::uuid AND a.requester_employee_id<>${employeeId}::uuid
        AND reviewer.status='Active' AND reviewer.archived_at IS NULL
        AND r.archived_at IS NULL AND r.status='Pending HR'

      UNION ALL
      SELECT 'training-verify-' || r.id, 'Training', 'Verify training certificate',
        'Review ' || coalesce(e.preferred_name,e.legal_name) || '''s certificate for ' || r.title || '.', 'Normal',
        (r.created_at::date + 3)::text, NULL, 'Review certificate', '/staff/training',
        'training-record', r.id::text, r.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM training_records r JOIN employees e ON e.id=r.employee_id
      WHERE r.organisation_id=${organisationId} AND r.archived_at IS NULL AND ${role}='HR'
        AND r.certificate_file_id IS NOT NULL AND r.hr_verified=false AND r.rejected_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM users ru JOIN user_roles rur ON rur.user_id=ru.id
          JOIN roles rr ON rr.id=rur.role_id WHERE ru.organisation_id=r.organisation_id
          AND ru.employee_id=r.employee_id AND rr.code='HR')

      UNION ALL
      SELECT 'travel-hr-' || r.id, 'Travel', 'Review travel pre-authorisation',
        coalesce(e.preferred_name,e.legal_name) || ' requested travel to ' || r.destination || '.', 'Normal',
        (r.created_at::date + 2)::text, NULL, 'Review travel', '/staff/travel-hr-approvals',
        'travel-request', r.id::text, r.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM travel_requests r JOIN employees e ON e.id=r.employee_id
      WHERE r.organisation_id=${organisationId} AND r.archived_at IS NULL AND ${role}='HR'
        AND r.status='Pending HR and Accounts' AND r.hr_approval_status='Pending'
        AND r.manager_approval_status IN ('Approved','Not Required')
        AND (coalesce(r.approval_route->>'kind','Standard')='Standard'
          OR (r.approval_route->>'kind'='Managerless Executive'
            AND r.approval_route->>'reviewerRole'='HR'
            AND r.accounts_approval_status='Not Required'))
        AND r.employee_id<>${employeeId}::uuid
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r.participants) p WHERE p->>'employeeId'=${employeeId})
        AND r.manager_approved_by IS DISTINCT FROM ${actor.userId}::uuid
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r.participants) p WHERE p->>'decidedBy'=${actor.userId})

      UNION ALL
      SELECT 'travel-manager-' || r.id, 'Travel', 'Review travel request',
        coalesce(e.preferred_name,e.legal_name) || ' submitted a travel request.', 'Normal',
        (r.created_at::date + 2)::text, NULL, 'Review travel', '/staff/travel-approvals',
        'travel-request', r.id::text, r.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM travel_requests r JOIN employees e ON e.id=r.employee_id AND e.organisation_id=r.organisation_id
      WHERE r.organisation_id=${organisationId} AND r.archived_at IS NULL AND ${role} IN ('Line Manager','HR')
        AND r.employee_id<>${employeeId}::uuid
        AND r.status='Pending HR and Accounts' AND r.manager_approval_status='Pending'
        AND ((e.line_manager_id=${employeeId}::uuid AND r.manager_approved_by IS NULL)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(r.participants) p
            WHERE p->>'managerId'=${employeeId} AND p->>'status'='Pending'))

      UNION ALL
      SELECT 'independent-hr-review-Travel-' || r.id, 'Travel', 'Review HR colleague travel',
        coalesce(e.preferred_name,e.legal_name) || ' needs your independent travel decision.', 'High',
        (r.created_at::date + 2)::text, NULL, 'Review trip', '/staff/travel/' || r.id,
        'travel-request', r.id::text, r.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM travel_requests r JOIN employees e ON e.id=r.employee_id AND e.organisation_id=r.organisation_id
      WHERE r.organisation_id=${organisationId} AND r.archived_at IS NULL AND ${role}='Employee'
        AND r.status='Pending HR and Accounts' AND r.manager_approval_status='Pending'
        AND r.approval_route->>'kind'='HR Own Travel'
        AND r.approval_route->>'reviewerEmployeeId'=${employeeId}
        AND r.employee_id<>${employeeId}::uuid

      UNION ALL
      SELECT 'goal-manager-' || g.id, 'Performance', 'Review employee objective',
        coalesce(e.preferred_name,e.legal_name) || ' has an objective awaiting your decision.', 'Normal',
        (g.updated_at::date + 3)::text, NULL, 'Review objective', '/staff/performance/team',
        'employee-goal', g.id::text, g.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM employee_goals g JOIN employees e ON e.id=g.employee_id AND e.organisation_id=g.organisation_id
      WHERE g.organisation_id=${organisationId} AND g.archived_at IS NULL AND ${role} IN ('Line Manager','HR')
        AND e.line_manager_id=${employeeId}::uuid AND g.employee_id<>${employeeId}::uuid
        AND g.status IN ('Pending Approval','Completion Pending')

      UNION ALL
      SELECT 'referral-hr-' || r.id, 'Recruitment', 'Review employee referral',
        'An employee referral is waiting for an HR decision.', 'Normal',
        (r.created_at::date + 3)::text, NULL, 'Review referral', '/staff/recommendations',
        'candidate-recommendation', r.id::text, r.recommender_employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM candidate_recommendations r LEFT JOIN employees e ON e.id=r.recommender_employee_id AND e.organisation_id=r.organisation_id
      WHERE r.organisation_id=${organisationId} AND r.archived_at IS NULL AND ${role}='HR'
        AND r.review_status='Pending HR Review' AND r.recommender_employee_id IS NOT NULL

      UNION ALL
      SELECT 'travel-accounts-' || r.id, 'Travel', 'Review travel pre-authorisation',
        coalesce(e.preferred_name,e.legal_name) || ' requested travel to ' || r.destination || '.', 'Normal',
        (r.created_at::date + 2)::text, NULL, 'Review travel', '/staff/travel-accounts-approvals',
        'travel-request', r.id::text, r.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM travel_requests r JOIN employees e ON e.id=r.employee_id
      WHERE r.organisation_id=${organisationId} AND r.archived_at IS NULL AND ${role}='Accounts'
        AND r.status='Pending HR and Accounts' AND r.accounts_approval_status='Pending'
        AND r.manager_approval_status IN ('Approved','Not Required')
        AND ((coalesce(r.approval_route->>'kind','Standard')='Standard' AND r.hr_approval_status='Approved')
          OR (r.approval_route->>'kind'='Managerless Executive'
            AND r.approval_route->>'reviewerRole'='Accounts'
            AND r.hr_approval_status='Not Required')
          OR (r.approval_route->>'kind'='HR Own Travel'
            AND r.manager_approval_status='Approved'
            AND r.hr_approval_status='Not Required'))
        AND r.employee_id<>${employeeId}::uuid
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r.participants) p WHERE p->>'employeeId'=${employeeId})
        AND r.manager_approved_by IS DISTINCT FROM ${actor.userId}::uuid
        AND r.hr_approved_by IS DISTINCT FROM ${actor.userId}::uuid
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r.participants) p WHERE p->>'decidedBy'=${actor.userId})

      UNION ALL
      SELECT 'travel-close-' || r.id, 'Travel', 'Close reimbursement',
        'Review submitted expenses for ' || coalesce(e.preferred_name,e.legal_name) || '.', 'High',
        (r.updated_at::date + 2)::text, NULL, 'Review reimbursement', '/staff/travel-closures',
        'travel-request', r.id::text, r.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM travel_requests r JOIN employees e ON e.id=r.employee_id
      WHERE r.organisation_id=${organisationId} AND r.archived_at IS NULL AND ${role}='Accounts'
        AND r.status='Pending Super Admin Closure'
        AND r.employee_id<>${employeeId}::uuid
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r.participants) p WHERE p->>'employeeId'=${employeeId})

      UNION ALL
      SELECT 'performance-hr-' || r.id, 'Performance',
        CASE WHEN r.status='Moderation Pending' THEN 'Moderate performance review' ELSE 'Finalise acknowledged review' END,
        'Complete the review stage for ' || coalesce(e.preferred_name,e.legal_name) || '.', 'High',
        c.discussion_deadline::text, NULL, 'Open review', '/staff/performance/reviews/' || r.id,
        'performance-review', r.id::text, r.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM performance_reviews r JOIN performance_cycles c ON c.id=r.cycle_id JOIN employees e ON e.id=r.employee_id
      WHERE r.organisation_id=${organisationId} AND r.archived_at IS NULL AND ${role}='HR'
        AND r.status IN ('Moderation Pending','Acknowledged')

      UNION ALL
      SELECT 'document-verify-' || d.id, 'Documents', 'Verify employee document',
        'Review ' || coalesce(e.preferred_name,e.legal_name) || '''s employee document.', 'Normal',
        (d.created_at::date + 3)::text, NULL, 'Review document',
        '/staff/employees/' || d.employee_id || '#section=documents&document=' || d.id,
        'employee-document', d.id::text, d.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM employee_documents d JOIN employees e ON e.id=d.employee_id
      WHERE d.organisation_id=${organisationId} AND d.archived_at IS NULL AND ${role}='HR' AND d.status='Pending Verification'
        AND NOT EXISTS (SELECT 1 FROM users du JOIN user_roles dur ON dur.user_id=du.id
          JOIN roles dr ON dr.id=dur.role_id WHERE du.organisation_id=d.organisation_id
          AND du.employee_id=d.employee_id AND dr.code='HR')

      UNION ALL
      SELECT 'employment-hr-' || e.id, 'Employment details', 'Confirm employment details',
        coalesce(e.preferred_name,e.legal_name) || ' has employment details awaiting HR confirmation.', 'Normal',
        (e.updated_at::date + 3)::text, NULL, 'Review details',
        '/staff/employees/' || e.id || '#section=employment',
        'employee', e.id::text, e.id::text, coalesce(e.preferred_name,e.legal_name)
      FROM employees e
      WHERE e.organisation_id=${organisationId} AND e.archived_at IS NULL AND ${role}='HR'
        AND e.employment_confirmation_status='Pending HR Review'
        AND e.proposed_employment_details IS NOT NULL
        AND e.id<>${employeeId}::uuid
        AND NOT EXISTS (SELECT 1 FROM users eu JOIN user_roles eur ON eur.user_id=eu.id
          JOIN roles er ON er.id=eur.role_id WHERE eu.organisation_id=e.organisation_id
          AND eu.employee_id=e.id AND er.code='HR')

      UNION ALL
      SELECT 'independent-hr-review-' || a.module || '-' || a.request_id, 'HR records',
        CASE a.module WHEN 'Document' THEN 'Review assigned employee document'
          WHEN 'Training Certificate' THEN 'Review assigned training certificate'
          ELSE 'Confirm assigned employment details' END,
        'Review ' || coalesce(e.preferred_name,e.legal_name) || '''s ' || lower(a.module) || '.',
        'High', (a.created_at::date + 3)::text, NULL, 'Review now',
        '/staff/independent-record-reviews#review=' || a.request_id,
        CASE a.module WHEN 'Document' THEN 'employee-document'
          WHEN 'Training Certificate' THEN 'training-record' ELSE 'employee' END,
        a.request_id::text, a.requester_employee_id::text,
        coalesce(e.preferred_name,e.legal_name)
      FROM hr_independent_review_assignments a
      JOIN employees e ON e.id=a.requester_employee_id AND e.organisation_id=a.organisation_id
      LEFT JOIN employee_documents d ON a.module='Document' AND d.id=a.request_id
        AND d.organisation_id=a.organisation_id AND d.archived_at IS NULL
      LEFT JOIN training_records tr ON a.module='Training Certificate' AND tr.id=a.request_id
        AND tr.organisation_id=a.organisation_id AND tr.archived_at IS NULL
      WHERE a.organisation_id=${organisationId} AND a.archived_at IS NULL
        AND ${role}='Employee' AND a.reviewer_employee_id=${employeeId}::uuid
        AND a.requester_employee_id<>${employeeId}::uuid
        AND ((a.module='Document' AND d.status='Pending Verification')
          OR (a.module='Training Certificate' AND tr.hr_verified=false AND tr.rejected_at IS NULL)
          OR (a.module='Employment Confirmation' AND e.employment_confirmation_status='Pending HR Review'
            AND e.proposed_employment_details IS NOT NULL))

      UNION ALL
      SELECT 'travel-booking-accounts-' || (booking->>'id'), 'Travel', 'Review travel arrangement cost',
        coalesce(e.preferred_name,e.legal_name) || ' requested ' ||
          coalesce(nullif(booking->>'name',''),'an arrangement') || ' for ' || r.destination || '.', 'Normal',
        (r.updated_at::date + 2)::text, NULL, 'Review cost',
        '/staff/travel/' || r.id || '#booking-' || (booking->>'id'),
        'travel-request', r.id::text, r.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM travel_requests r JOIN employees e ON e.id=r.employee_id AND e.organisation_id=r.organisation_id
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.bookings,'[]'::jsonb)) booking
      WHERE r.organisation_id=${organisationId} AND r.archived_at IS NULL AND ${role}='Accounts'
        AND r.status='Pre-authorised' AND r.end_date>=${today}::date
        AND (booking->>'status')='Pending Finance' AND (booking->>'id') IS NOT NULL
        AND r.employee_id<>${employeeId}::uuid
        AND (booking->>'requestedBy') IS DISTINCT FROM ${actor.userId}
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r.participants) p WHERE p->>'employeeId'=${employeeId})

      UNION ALL
      SELECT 'onboarding-' || c.id || '-' || t.id, 'Onboarding', t.title,
        coalesce(t.instructions,t.task_group || ' for ' || coalesce(e.preferred_name,e.legal_name) || '.'),
        CASE WHEN t.is_mandatory THEN 'High' ELSE 'Normal' END, t.due_date::text,
        CASE WHEN t.status='Blocked' THEN 'Blocked' ELSE NULL END, CASE WHEN t.status='Blocked' THEN 'View blocker' ELSE 'Open task' END,
        CASE WHEN t.owner_role='Employee' AND c.employee_id=${employeeId}::uuid THEN '/staff/me/onboarding' ELSE '/staff/onboarding/' || c.id END,
        'onboarding-task', t.id::text, c.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM onboarding_tasks t JOIN onboarding_cases c ON c.id=t.case_id JOIN employees e ON e.id=c.employee_id
      WHERE t.organisation_id=${organisationId} AND t.archived_at IS NULL AND c.status='In Progress' AND t.status IN ('Pending','Blocked')
        AND (t.assigned_user_id=${actor.userId}::uuid OR (t.assigned_user_id IS NULL AND (
          (t.owner_role='Employee' AND c.employee_id=${employeeId}::uuid) OR
          (t.owner_role='Line Manager' AND ${role} IN ('Line Manager','HR') AND e.line_manager_id=${employeeId}::uuid) OR
          (t.owner_role=${role}::system_role_code AND ${role} NOT IN ('Employee','Line Manager')))))

      UNION ALL
      SELECT 'offboarding-' || c.id || '-' || t.id, 'Offboarding', t.title,
        coalesce(t.instructions,t.task_group || ' for ' || coalesce(e.preferred_name,e.legal_name) || '.'),
        CASE WHEN t.is_mandatory THEN 'High' ELSE 'Normal' END, t.due_date::text,
        CASE WHEN t.status='Blocked' THEN 'Blocked' ELSE NULL END, CASE WHEN t.status='Blocked' THEN 'View blocker' ELSE 'Open task' END,
        '/staff/offboarding/' || c.id, 'offboarding-task', t.id::text, c.employee_id::text,
        coalesce(e.preferred_name,e.legal_name)
      FROM offboarding_tasks t JOIN offboarding_cases c ON c.id=t.case_id JOIN employees e ON e.id=c.employee_id
      WHERE t.organisation_id=${organisationId} AND t.archived_at IS NULL AND c.status NOT IN ('Completed','Cancelled') AND t.status IN ('Pending','Blocked')
        AND (t.assigned_user_id=${actor.userId}::uuid OR (t.assigned_user_id IS NULL AND (
          (t.owner_role='Employee' AND c.employee_id=${employeeId}::uuid) OR
          (t.owner_role='Line Manager' AND ${role} IN ('Line Manager','HR') AND e.line_manager_id=${employeeId}::uuid) OR
          (t.owner_role=${role}::system_role_code AND ${role} NOT IN ('Employee','Line Manager')))))

      UNION ALL
      SELECT 'offboarding-financial-' || c.id, 'Offboarding', 'Confirm financial clearance',
        'Review expenses, advances and final payroll inputs for ' || coalesce(e.preferred_name,e.legal_name) || '.',
        'High', c.last_working_date::text, NULL, 'Open clearance', '/staff/offboarding/' || c.id,
        'offboarding-case', c.id::text, c.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM offboarding_cases c JOIN employees e ON e.id=c.employee_id AND e.organisation_id=c.organisation_id
      WHERE c.organisation_id=${organisationId} AND c.archived_at IS NULL
        AND c.status IN ('In Progress','Pending Clearance') AND c.progress_percentage=100
        AND c.financial_clearance_at IS NULL AND ${role}='Accounts'
        AND c.employee_id<>${employeeId}::uuid

      UNION ALL
      SELECT 'offboarding-legal-' || c.id, 'Offboarding', 'Confirm HR and document clearance',
        'Review the HR and document closure for ' || coalesce(e.preferred_name,e.legal_name) || '.',
        'High', c.last_working_date::text, NULL, 'Open clearance', '/staff/offboarding/' || c.id,
        'offboarding-case', c.id::text, c.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM offboarding_cases c JOIN employees e ON e.id=c.employee_id AND e.organisation_id=c.organisation_id
      WHERE c.organisation_id=${organisationId} AND c.archived_at IS NULL
        AND c.status IN ('In Progress','Pending Clearance') AND c.progress_percentage=100
        AND c.legal_clearance_at IS NULL AND ${role}='HR'
        AND c.employee_id<>${employeeId}::uuid

      UNION ALL
      SELECT 'offboarding-finalise-' || c.id, 'Offboarding', 'Complete offboarding',
        'All clearances are complete for ' || coalesce(e.preferred_name,e.legal_name) || '.',
        'High', c.last_working_date::text, NULL, 'Open case', '/staff/offboarding/' || c.id,
        'offboarding-case', c.id::text, c.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM offboarding_cases c JOIN employees e ON e.id=c.employee_id AND e.organisation_id=c.organisation_id
      WHERE c.organisation_id=${organisationId} AND c.archived_at IS NULL
        AND c.status IN ('In Progress','Pending Clearance') AND c.progress_percentage=100
        AND c.financial_clearance_at IS NOT NULL AND c.legal_clearance_at IS NOT NULL
        AND c.last_working_date<=${today}::date AND ${role}='HR'
        AND c.employee_id<>${employeeId}::uuid

      UNION ALL
      SELECT 'interview-scorecard-' || i.id || '-' || ${actor.userId}, 'Recruitment', 'Complete interview scorecard',
        'Submit your evidence-based scores for ' || c.first_name || ' ' || c.last_name || '.', 'High',
        coalesce((i.confirmed_slot->>'endTime')::timestamptz::date,i.occurred_at::date)::text, NULL,
        'Open interviews', '/staff/interviews', 'interview', i.id::text, NULL, c.first_name || ' ' || c.last_name
      FROM interviews i JOIN interview_panelists p ON p.interview_id=i.id JOIN candidates c ON c.id=i.candidate_id
      LEFT JOIN interview_scorecards s ON s.interview_id=i.id AND s.panel_user_id=p.user_id AND s.archived_at IS NULL
      WHERE i.organisation_id=${organisationId} AND i.archived_at IS NULL AND p.user_id=${actor.userId}::uuid
        AND i.status IN ('Scheduled','Completed') AND coalesce(s.status,'Draft') <> 'Submitted'

      UNION ALL
      SELECT 'payroll-' || p.id, 'Payroll',
        CASE WHEN p.status='Prepared' THEN 'Approve payroll period' WHEN p.status='Approved' THEN 'Lock payroll period' ELSE 'Prepare payroll inputs' END,
        'Complete the next payroll action for ' || p.name || '.', 'High', p.cutoff_date::text, NULL,
        'Open payroll', '/staff/payroll', 'payroll-period', p.id::text, NULL, NULL
      FROM payroll_periods p
      WHERE p.organisation_id=${organisationId} AND p.archived_at IS NULL AND
        ((${role}='Accounts' AND p.status IN ('Draft','Collecting Inputs','Exceptions','Corrected','Approved')) OR
         (${role}='Accounts' AND p.status='Prepared' AND p.prepared_by IS NOT NULL AND p.prepared_by<>${actor.userId} AND p.updated_by<>${actor.userId}
           AND NOT EXISTS (SELECT 1 FROM payroll_exceptions x WHERE x.organisation_id=${organisationId} AND x.period_id=p.id AND x.acknowledged_by=${actor.userId})) OR
         (${role} IN ('Accounts','Super Admin') AND p.status='Approved'))

      UNION ALL
      SELECT 'offer-approval-' || o.id, 'Recruitment', 'Review assigned offer',
        'Review the proposed employment terms and approve or return them to HR.', 'High',
        NULL::text, NULL::text, 'Review offer', '/staff/offers', 'offer', o.id::text, NULL::text, NULL::text
      FROM job_offers o
      JOIN users u ON u.id=o.approver_user_id AND u.organisation_id=o.organisation_id
      JOIN employees e ON e.id=u.employee_id AND e.organisation_id=o.organisation_id
      JOIN candidates c ON c.id=o.candidate_id AND c.organisation_id=o.organisation_id
      WHERE o.organisation_id=${organisationId} AND o.archived_at IS NULL AND o.status='Pending Approval'
        AND o.approver_user_id=${actor.userId}::uuid AND o.created_by<>${actor.userId}::uuid
        AND o.approval_requested_by<>${actor.userId}::uuid
        AND u.status='Active' AND e.status='Active' AND u.archived_at IS NULL AND e.archived_at IS NULL
        AND lower(c.email)<>lower(u.workspace_email) AND c.converted_to_employee_id IS DISTINCT FROM e.id
        AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id
          WHERE ur.organisation_id=${organisationId} AND ur.user_id=u.id AND r.code='Line Manager')
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(o.history) entry
          WHERE entry->>'preparedBy'=${actor.userId})
    ) SELECT *, CASE source_type
        WHEN 'leave-request' THEN (SELECT record_version FROM leave_requests v WHERE v.id::text=task_rows.source_id AND v.organisation_id=${organisationId})
        WHEN 'timesheet' THEN (SELECT record_version FROM timesheets v WHERE v.id::text=task_rows.source_id AND v.organisation_id=${organisationId})
        WHEN 'attendance-correction' THEN (SELECT record_version FROM attendance_corrections v WHERE v.id::text=task_rows.source_id AND v.organisation_id=${organisationId})
        WHEN 'overtime-claim' THEN (SELECT record_version FROM overtime_claims v WHERE v.id::text=task_rows.source_id AND v.organisation_id=${organisationId})
        WHEN 'training-request' THEN (SELECT record_version FROM training_requests v WHERE v.id::text=task_rows.source_id AND v.organisation_id=${organisationId})
        WHEN 'employee-goal' THEN (SELECT record_version FROM employee_goals v WHERE v.id::text=task_rows.source_id AND v.organisation_id=${organisationId})
        WHEN 'site-visit-request' THEN (SELECT record_version FROM site_visit_requests v WHERE v.id::text=task_rows.source_id AND v.organisation_id=${organisationId})
        WHEN 'time-away' THEN (SELECT record_version FROM time_away v WHERE v.id::text=task_rows.source_id AND v.organisation_id=${organisationId})
        WHEN 'travel-request' THEN (SELECT record_version FROM travel_requests v WHERE v.id::text=task_rows.source_id AND v.organisation_id=${organisationId})
        WHEN 'employee' THEN (SELECT record_version FROM employees v WHERE v.id::text=task_rows.source_id AND v.organisation_id=${organisationId})
        WHEN 'profile-change-request' THEN (SELECT record_version FROM profile_change_requests v WHERE v.id::text=task_rows.source_id AND v.organisation_id=${organisationId})
        WHEN 'employee-document' THEN (SELECT record_version FROM employee_documents v WHERE v.id::text=task_rows.source_id AND v.organisation_id=${organisationId})
        WHEN 'performance-review' THEN (SELECT record_version FROM performance_reviews v WHERE v.id::text=task_rows.source_id AND v.organisation_id=${organisationId})
        WHEN 'offer' THEN (SELECT record_version FROM job_offers v WHERE v.id::text=task_rows.source_id AND v.organisation_id=${organisationId})
        WHEN 'offboarding-case' THEN (SELECT record_version FROM offboarding_cases v WHERE v.id::text=task_rows.source_id AND v.organisation_id=${organisationId})
        WHEN 'candidate-recommendation' THEN (SELECT record_version FROM candidate_recommendations v WHERE v.id::text=task_rows.source_id AND v.organisation_id=${organisationId})
        ELSE 1 END source_version FROM task_rows
  `);
  const rows = [...result] as unknown as TaskRow[];
  const tasks = rows.map((row): AppTask => {
    const state = stateFor(row.due_date, row.state_override, today);
    return {
      id: row.task_id,
      module: row.module,
      title: row.title,
      description: row.description,
      priority: state === "Overdue" && row.priority === "Normal" ? "High" : row.priority,
      state,
      actionLabel: row.action_label,
      actionUrl:
        row.source_type === "employee-document" && row.subject_employee_id
          ? employeeDocumentLink(row.subject_employee_id, row.source_id)
          : row.action_url,
      sourceType: row.source_type,
      sourceId: row.source_id,
      sourceVersion: row.source_version ?? 1,
      ...(row.due_date ? { dueDate: row.due_date } : {}),
      ...(row.subject_employee_id ? { subjectEmployeeId: row.subject_employee_id } : {}),
      ...(row.subject_name ? { subjectName: row.subject_name } : {}),
    };
  });
  const stateOrder: Record<TaskState, number> = { Overdue: 0, "Due Soon": 1, Open: 2, Blocked: 3 };
  const priorityOrder: Record<NotificationPriority, number> = {
    Low: 0,
    Normal: 1,
    High: 2,
    Critical: 3,
  };
  const roleScopedTasks =
    role === "Super Admin" ? tasks.filter((task) => !isApprovalTask(task)) : tasks;
  return [...new Map(roleScopedTasks.map((task) => [task.id, task])).values()].sort((a, b) => {
    const state = stateOrder[a.state] - stateOrder[b.state];
    if (state) return state;
    const priority = priorityOrder[b.priority] - priorityOrder[a.priority];
    if (priority) return priority;
    return (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31");
  });
}

/** Refreshes the durable task projection and creates one deduplicated reminder per urgency stage. */
export async function processTaskAutomationInDatabase(
  organisationId: string,
  today = new Date().toISOString().slice(0, 10),
) {
  const db = getDatabaseClient();
  const people = await db
    .select({
      userId: users.id,
      employeeId: users.employeeId,
      displayName: users.displayName,
      role: roles.code,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(
      and(
        eq(users.organisationId, organisationId),
        eq(users.status, "Active"),
        isNull(users.archivedAt),
      ),
    );
  const projections: Array<{
    userId: string;
    employeeId: string | null;
    displayName: string;
    role: Role;
    task: AppTask;
  }> = [];
  for (const person of people) {
    const role = person.role as Role;
    const tasks = await listTasksForActorInDatabase(
      organisationId,
      {
        userId: person.userId,
        employeeId: person.employeeId ?? undefined,
        displayName: person.displayName,
        activeRole: role,
        roles: [role],
      },
      today,
    );
    for (const task of tasks.filter(
      (task) => !isApprovalTask(task) || task.subjectEmployeeId !== person.employeeId,
    ))
      projections.push({
        userId: person.userId,
        employeeId: person.employeeId,
        displayName: person.displayName,
        role,
        task,
      });
  }
  const fallbackActor = people[0];
  if (!fallbackActor) return { tasksOpen: 0, remindersCreated: 0 };
  let remindersCreated = 0;
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`task-automation:${organisationId}`}))`,
    );
    await tx
      .update(workflowTasks)
      .set({
        status: "Completed",
        completedAt: new Date().toISOString(),
        updatedAt: new Date(),
        updatedBy: fallbackActor.userId,
        recordVersion: sql`${workflowTasks.recordVersion} + 1`,
      })
      .where(
        and(
          eq(workflowTasks.organisationId, organisationId),
          inArray(workflowTasks.status, ["Open", "In Progress"]),
        ),
      );
    for (const projection of projections) {
      if (!/^[0-9a-f-]{36}$/i.test(projection.task.sourceId)) continue;
      const [existing] = await tx
        .select({ id: workflowTasks.id })
        .from(workflowTasks)
        .where(
          and(
            eq(workflowTasks.organisationId, organisationId),
            eq(workflowTasks.entityType, projection.task.sourceType),
            eq(workflowTasks.entityId, projection.task.sourceId),
            eq(workflowTasks.assignedUserId, projection.userId),
            eq(workflowTasks.assignedRole, projection.role),
          ),
        )
        .limit(1);
      const values = {
        title: projection.task.title,
        module: projection.task.module,
        entityType: projection.task.sourceType,
        entityId: projection.task.sourceId,
        assignedUserId: projection.userId,
        assignedRole: projection.role,
        status: projection.task.state === "Blocked" ? "In Progress" : "Open",
        priority: projection.task.priority,
        dueAt: projection.task.dueDate ? `${projection.task.dueDate}T23:59:59Z` : null,
        completedAt: null,
        updatedAt: new Date(),
        updatedBy: fallbackActor.userId,
      } as const;
      if (existing)
        await tx
          .update(workflowTasks)
          .set({ ...values, recordVersion: sql`${workflowTasks.recordVersion} + 1` })
          .where(eq(workflowTasks.id, existing.id));
      else
        await tx.insert(workflowTasks).values({
          id: randomUUID(),
          organisationId,
          ...values,
          createdBy: fallbackActor.userId,
        } as typeof workflowTasks.$inferInsert);
      const approval = isApprovalTask(projection.task);
      if (!approval && projection.task.state !== "Overdue" && projection.task.state !== "Due Soon")
        continue;
      const key = `task-${projection.task.state.toLowerCase().replaceAll(" ", "-")}-${projection.task.id}-v${projection.task.sourceVersion ?? 1}`;
      const inserted = await tx
        .insert(notifications)
        .values({
          organisationId,
          recipientUserId: projection.userId,
          type: approval ? "approval.reminder" : "task.reminder",
          title:
            projection.task.state === "Overdue"
              ? "Task overdue"
              : approval
                ? "Your approval is required"
                : "Task due soon",
          message: [
            projection.task.title,
            projection.task.subjectName ? `Employee: ${projection.task.subjectName}` : null,
            projection.task.dueDate ? `Due: ${projection.task.dueDate}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
          priority: projection.task.state === "Overdue" ? "High" : projection.task.priority,
          status: "Unread",
          dueAt: projection.task.dueDate ? `${projection.task.dueDate}T23:59:59Z` : null,
          deduplicationKey: key,
          link: {
            entityType: projection.task.sourceType,
            entityId: projection.task.sourceId,
            path: projection.task.actionUrl,
          },
          createdBy: fallbackActor.userId,
          updatedBy: fallbackActor.userId,
        } as typeof notifications.$inferInsert)
        .onConflictDoNothing()
        .returning({ id: notifications.id });
      remindersCreated += inserted.length;
    }
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: fallbackActor.userId,
      actorEmployeeId: fallbackActor.employeeId,
      actorDisplayName: "VIA background worker",
      activeRole: "Super Admin",
      actorRoles: ["Super Admin"],
      action: "reconcile",
      module: "tasks",
      entityType: "workflow-task",
      entityId: organisationId,
      afterSummary: { tasksOpen: projections.length, remindersCreated, today },
      reason: "Reconciled task inboxes and overdue reminders",
      riskLevel: "Low",
    } as typeof auditEvents.$inferInsert);
  });
  return { tasksOpen: projections.length, remindersCreated };
}

export async function processTaskWorker(today = new Date().toISOString().slice(0, 10)) {
  const db = getDatabaseClient();
  const organisationRows = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(eq(organisations.isActive, true));
  let tasksOpen = 0;
  let remindersCreated = 0;
  for (const organisation of organisationRows) {
    const result = await processTaskAutomationInDatabase(organisation.id, today);
    tasksOpen += result.tasksOpen;
    remindersCreated += result.remindersCreated;
  }
  return { organisationsProcessed: organisationRows.length, tasksOpen, remindersCreated };
}
