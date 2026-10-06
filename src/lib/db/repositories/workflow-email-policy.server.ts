import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";

/** Email duties are narrower than administrative access. Aliases: notifications n, users u. */
export function workflowEmailRecipientPolicy() {
  const hasHrRole = sql`EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id
    WHERE ur.organisation_id=n.organisation_id AND ur.user_id=u.id AND r.code='HR')`;
  return sql`(
    CASE
      WHEN n.type IN ('approval.reminder','task.reminder') THEN EXISTS (
        SELECT 1 FROM workflow_tasks t
        JOIN user_roles ur ON ur.user_id=u.id AND ur.organisation_id=n.organisation_id
        JOIN roles r ON r.id=ur.role_id AND r.code=t.assigned_role
        WHERE t.organisation_id=n.organisation_id AND t.assigned_user_id=u.id
          AND t.entity_id::text=n.link->>'entityId' AND t.entity_type=n.link->>'entityType'
          AND t.assigned_role<>'Super Admin' AND t.status IN ('Open','In Progress')
      )
      WHEN n.type IN (
        'employee-document.approval_required','profile.review-requested',
        'employment_details.review_requested','employment.scheduled_change_review',
        'time_away.submitted','leave_submitted','employee_profile_ready',
        'Internal Application','Employee Referral','attendance.correction_submitted',
        'company_document_expiry','offer_expired','offer_deadline','attendance.device-user-unmatched'
      ) OR n.link->>'path'='/staff/travel-hr-approvals'
        OR coalesce(n.deduplication_key,'') ~ '^(timesheet-hr-|overtime-hr-|overtime-overdue-hr-|site-visit-review-|site-visit-extension-|employee-profile-ready-|training-hr-|training-certificate-review-|leave-Pending HR-|leave-Amendment Pending HR-|leave-change-.*-Cancellation Pending-)'
        THEN ${hasHrRole}
      WHEN coalesce(n.deduplication_key,'') LIKE 'overtime-actual-%' THEN
        ${hasHrRole} OR EXISTS (
          SELECT 1 FROM overtime_claims o JOIN employees e ON e.id=o.employee_id
          WHERE o.organisation_id=n.organisation_id AND o.id::text=n.link->>'entityId'
            AND e.line_manager_id=u.employee_id AND o.status='Pending Manager'
        )
      WHEN n.type='performance-review' AND (
        coalesce(n.deduplication_key,'') LIKE '%-acknowledge-%' OR (
          coalesce(n.deduplication_key,'') LIKE '%-manager-%' AND EXISTS (
            SELECT 1 FROM performance_reviews p JOIN performance_cycles c ON c.id=p.cycle_id
            WHERE p.organisation_id=n.organisation_id AND p.id::text=n.link->>'entityId' AND c.requires_moderation
          )
        )
      ) THEN ${hasHrRole}
      WHEN n.link->>'path' IN ('/staff/travel-closures','/staff/travel-accounts-approvals') THEN EXISTS (
        SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id
        WHERE ur.organisation_id=n.organisation_id AND ur.user_id=u.id AND r.code='Accounts'
      )
      ELSE TRUE
    END
  )`;
}
