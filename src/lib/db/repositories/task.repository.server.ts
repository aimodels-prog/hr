import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import type { AppTask, TaskState } from "../../data/task-service.ts";
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
      WHERE l.organisation_id=${organisationId} AND l.archived_at IS NULL AND ${role}='Line Manager'
        AND e.line_manager_id=${employeeId}::uuid AND l.status IN ('Pending Line Manager','Amendment Pending Line Manager')

      UNION ALL
      SELECT 'timesheet-manager-' || t.id, 'Timesheets', 'Review submitted timesheet',
        coalesce(e.preferred_name,e.legal_name) || ' submitted ' || t.total_hours || ' hours.', 'Normal',
        (coalesce(t.submitted_at,t.updated_at)::date + 2)::text, NULL, 'Review timesheet',
        '/staff/timesheet-approvals/' || t.id, 'timesheet', t.id::text, t.employee_id::text,
        coalesce(e.preferred_name,e.legal_name)
      FROM timesheets t JOIN employees e ON e.id=t.employee_id
      WHERE t.organisation_id=${organisationId} AND t.archived_at IS NULL AND ${role}='Line Manager'
        AND e.line_manager_id=${employeeId}::uuid AND t.status='Pending Manager'

      UNION ALL
      SELECT 'attendance-manager-' || c.id, 'Attendance', 'Review attendance correction',
        coalesce(e.preferred_name,e.legal_name) || ' submitted an attendance correction.', 'High',
        (c.created_at::date + 1)::text, NULL, 'Review correction', '/staff/attendance/corrections',
        'attendance-correction', c.id::text, c.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM attendance_corrections c JOIN employees e ON e.id=c.employee_id
      WHERE c.organisation_id=${organisationId} AND c.archived_at IS NULL AND ${role}='Line Manager'
        AND e.line_manager_id=${employeeId}::uuid AND c.status='Pending Manager'

      UNION ALL
      SELECT 'overtime-manager-' || o.id, 'Overtime', 'Review overtime claim',
        coalesce(e.preferred_name,e.legal_name) || ' submitted ' || o.hours || ' overtime hours.',
        CASE WHEN jsonb_array_length(o.cross_check_warnings)>0 THEN 'High' ELSE 'Normal' END,
        (o.created_at::date + 2)::text, NULL, 'Review claim', '/staff/overtime-approvals',
        'overtime-claim', o.id::text, o.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM overtime_claims o JOIN employees e ON e.id=o.employee_id
      WHERE o.organisation_id=${organisationId} AND o.archived_at IS NULL AND ${role}='Line Manager'
        AND e.line_manager_id=${employeeId}::uuid AND o.status IN ('Pending Pre-authorisation','Pending Manager')

      UNION ALL
      SELECT 'training-manager-' || r.id, 'Training', 'Review training request',
        coalesce(e.preferred_name,e.legal_name) || ' submitted a training request.', 'Normal',
        (r.created_at::date + 3)::text, NULL, 'Review training', '/staff/training',
        'training-request', r.id::text, r.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM training_requests r JOIN employees e ON e.id=r.employee_id
      WHERE r.organisation_id=${organisationId} AND r.archived_at IS NULL AND ${role}='Line Manager'
        AND e.line_manager_id=${employeeId}::uuid AND r.status='Pending Supervisor'

      UNION ALL
      SELECT 'performance-manager-' || r.id, 'Performance',
        CASE WHEN r.status='Manager Review Pending' THEN 'Complete manager review' ELSE 'Hold performance discussion' END,
        'Complete the current review for ' || coalesce(e.preferred_name,e.legal_name) || '.', 'High',
        CASE WHEN r.status='Manager Review Pending' THEN c.manager_review_deadline::text ELSE c.discussion_deadline::text END,
        NULL, 'Open review', '/staff/performance/reviews/' || r.id, 'performance-review', r.id::text,
        r.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM performance_reviews r JOIN performance_cycles c ON c.id=r.cycle_id JOIN employees e ON e.id=r.employee_id
      WHERE r.organisation_id=${organisationId} AND r.archived_at IS NULL AND ${role}='Line Manager'
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
        coalesce(e.preferred_name,e.legal_name) || '''s supervisor completed the first review.', 'High',
        (l.updated_at::date + 2)::text, NULL, 'Review request', '/staff/leave-approvals',
        'leave-request', l.id::text, l.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM leave_requests l JOIN employees e ON e.id=l.employee_id
      WHERE l.organisation_id=${organisationId} AND l.archived_at IS NULL AND ${role} IN ('HR','Super Admin')
        AND l.status IN ('Pending HR','Pending Super Admin','Amendment Pending HR')

      UNION ALL
      SELECT 'timesheet-hr-' || t.id, 'Timesheets', 'Approve reviewed timesheet',
        coalesce(e.preferred_name,e.legal_name) || '''s supervisor completed the first review.', 'High',
        (t.updated_at::date + 2)::text, NULL, 'Review timesheet', '/staff/timesheet-approvals/' || t.id,
        'timesheet', t.id::text, t.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM timesheets t JOIN employees e ON e.id=t.employee_id
      WHERE t.organisation_id=${organisationId} AND t.archived_at IS NULL AND ${role} IN ('HR','Super Admin') AND t.status='Pending HR'

      UNION ALL
      SELECT 'attendance-hr-' || c.id, 'Attendance', 'Complete attendance correction review',
        'Review the supervisor-approved correction for ' || coalesce(e.preferred_name,e.legal_name) || '.', 'High',
        (c.updated_at::date + 1)::text, NULL, 'Review correction', '/staff/attendance/corrections',
        'attendance-correction', c.id::text, c.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM attendance_corrections c JOIN employees e ON e.id=c.employee_id
      WHERE c.organisation_id=${organisationId} AND c.archived_at IS NULL AND ${role} IN ('HR','Super Admin') AND c.status='Pending HR'

      UNION ALL
      SELECT 'site-visit-hr-' || v.id, 'Attendance', 'Review site visit request',
        coalesce(e.preferred_name,e.legal_name) || ' requested permission to visit ' || v.destination || '.', 'Normal',
        v.date::text, NULL, 'Review request', '/staff/attendance', 'site-visit-request', v.id::text,
        v.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM site_visit_requests v JOIN employees e ON e.id=v.employee_id
      WHERE v.organisation_id=${organisationId} AND v.archived_at IS NULL AND ${role} IN ('HR','Super Admin') AND v.status='Pending HR'

      UNION ALL
      SELECT 'overtime-hr-' || o.id, 'Overtime', 'Verify overtime claim',
        coalesce(e.preferred_name,e.legal_name) || ' has a supervisor-approved overtime claim.', 'High',
        (o.updated_at::date + 2)::text, NULL, 'Verify claim', '/staff/overtime-approvals',
        'overtime-claim', o.id::text, o.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM overtime_claims o JOIN employees e ON e.id=o.employee_id
      WHERE o.organisation_id=${organisationId} AND o.archived_at IS NULL AND ${role} IN ('HR','Super Admin') AND o.status='Pending HR'

      UNION ALL
      SELECT 'training-hr-' || r.id, 'Training', 'Approve training request',
        coalesce(e.preferred_name,e.legal_name) || ' has a training request awaiting HR.', 'Normal',
        (r.updated_at::date + 3)::text, NULL, 'Review training', '/staff/training',
        'training-request', r.id::text, r.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM training_requests r JOIN employees e ON e.id=r.employee_id
      WHERE r.organisation_id=${organisationId} AND r.archived_at IS NULL AND ${role} IN ('HR','Super Admin') AND r.status='Pending HR'

      UNION ALL
      SELECT 'training-verify-' || r.id, 'Training', 'Verify training certificate',
        'Review ' || coalesce(e.preferred_name,e.legal_name) || '''s certificate for ' || r.title || '.', 'Normal',
        (r.created_at::date + 3)::text, NULL, 'Review certificate', '/staff/training',
        'training-record', r.id::text, r.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM training_records r JOIN employees e ON e.id=r.employee_id
      WHERE r.organisation_id=${organisationId} AND r.archived_at IS NULL AND ${role} IN ('HR','Super Admin')
        AND r.certificate_file_id IS NOT NULL AND r.hr_verified=false AND r.rejected_at IS NULL

      UNION ALL
      SELECT 'travel-hr-' || r.id, 'Travel', 'Review travel pre-authorisation',
        coalesce(e.preferred_name,e.legal_name) || ' requested travel to ' || r.destination || '.', 'Normal',
        (r.created_at::date + 2)::text, NULL, 'Review travel', '/staff/travel-hr-approvals',
        'travel-request', r.id::text, r.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM travel_requests r JOIN employees e ON e.id=r.employee_id
      WHERE r.organisation_id=${organisationId} AND r.archived_at IS NULL AND ${role} IN ('HR','Super Admin')
        AND r.status='Pending HR and Accounts' AND r.hr_approval_status='Pending'

      UNION ALL
      SELECT 'travel-accounts-' || r.id, 'Travel', 'Review travel pre-authorisation',
        coalesce(e.preferred_name,e.legal_name) || ' requested travel to ' || r.destination || '.', 'Normal',
        (r.created_at::date + 2)::text, NULL, 'Review travel', '/staff/travel-accounts-approvals',
        'travel-request', r.id::text, r.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM travel_requests r JOIN employees e ON e.id=r.employee_id
      WHERE r.organisation_id=${organisationId} AND r.archived_at IS NULL AND ${role} IN ('Accounts','Super Admin')
        AND r.status='Pending HR and Accounts' AND r.accounts_approval_status='Pending'

      UNION ALL
      SELECT 'travel-close-' || r.id, 'Travel', 'Close reimbursement',
        'Review submitted expenses for ' || coalesce(e.preferred_name,e.legal_name) || '.', 'High',
        (r.updated_at::date + 2)::text, NULL, 'Review reimbursement', '/staff/travel-closures',
        'travel-request', r.id::text, r.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM travel_requests r JOIN employees e ON e.id=r.employee_id
      WHERE r.organisation_id=${organisationId} AND r.archived_at IS NULL AND ${role} IN ('Accounts','Super Admin')
        AND r.status='Pending Super Admin Closure'

      UNION ALL
      SELECT 'performance-hr-' || r.id, 'Performance',
        CASE WHEN r.status='Moderation Pending' THEN 'Moderate performance review' ELSE 'Finalise acknowledged review' END,
        'Complete the review stage for ' || coalesce(e.preferred_name,e.legal_name) || '.', 'High',
        c.discussion_deadline::text, NULL, 'Open review', '/staff/performance/reviews/' || r.id,
        'performance-review', r.id::text, r.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM performance_reviews r JOIN performance_cycles c ON c.id=r.cycle_id JOIN employees e ON e.id=r.employee_id
      WHERE r.organisation_id=${organisationId} AND r.archived_at IS NULL AND ${role} IN ('HR','Super Admin')
        AND r.status IN ('Moderation Pending','Acknowledged')

      UNION ALL
      SELECT 'profile-review-' || p.id, 'Employee Records', 'Review profile update',
        coalesce(e.preferred_name,e.legal_name) || ' requested changes to their personal details.', 'Normal',
        (p.created_at::date + 3)::text, NULL, 'Review profile', '/staff/employees/' || p.employee_id,
        'profile-change-request', p.id::text, p.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM profile_change_requests p JOIN employees e ON e.id=p.employee_id
      WHERE p.organisation_id=${organisationId} AND p.archived_at IS NULL AND ${role} IN ('HR','Super Admin') AND p.status='Pending'

      UNION ALL
      SELECT 'document-verify-' || d.id, 'Documents', 'Verify employee document',
        'Review ' || coalesce(e.preferred_name,e.legal_name) || '''s employee document.', 'Normal',
        (d.created_at::date + 3)::text, NULL, 'Review document', '/staff/employees/' || d.employee_id,
        'employee-document', d.id::text, d.employee_id::text, coalesce(e.preferred_name,e.legal_name)
      FROM employee_documents d JOIN employees e ON e.id=d.employee_id
      WHERE d.organisation_id=${organisationId} AND d.archived_at IS NULL AND ${role} IN ('HR','Super Admin') AND d.status='Pending Verification'

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
          (t.owner_role='Line Manager' AND ${role}='Line Manager' AND e.line_manager_id=${employeeId}::uuid) OR
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
          (t.owner_role='Line Manager' AND ${role}='Line Manager' AND e.line_manager_id=${employeeId}::uuid) OR
          (t.owner_role=${role}::system_role_code AND ${role} NOT IN ('Employee','Line Manager')))))

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
         (${role}='Super Admin' AND p.status IN ('Prepared','Approved')))
    ) SELECT * FROM task_rows
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
      actionUrl: row.action_url,
      sourceType: row.source_type,
      sourceId: row.source_id,
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
  return [...new Map(tasks.map((task) => [task.id, task])).values()].sort((a, b) => {
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
    for (const task of tasks)
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
      if (projection.task.state !== "Overdue" && projection.task.state !== "Due Soon") continue;
      const key = `task-${projection.task.state.toLowerCase().replaceAll(" ", "-")}-${projection.task.id}-${projection.role}`;
      const inserted = await tx
        .insert(notifications)
        .values({
          organisationId,
          recipientUserId: projection.userId,
          type: "task.reminder",
          title: projection.task.state === "Overdue" ? "Task overdue" : "Task due soon",
          message: projection.task.title,
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
