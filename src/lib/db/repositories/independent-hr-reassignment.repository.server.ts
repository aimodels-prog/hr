import "@tanstack/react-start/server-only";

import { sql } from "drizzle-orm";
import { getDatabaseClient } from "../client.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";
import {
  reassignIndependentHrReview,
  type IndependentHrReviewModule,
} from "./independent-hr-review.repository.server.ts";

export interface PendingIndependentHrReview {
  module: IndependentHrReviewModule;
  requestId: string;
  requesterEmployeeId: string;
  requesterName: string;
  reviewerEmployeeId: string;
  reviewerName: string;
  reviewerActive: boolean;
  status: string;
}

/** Completed requests are deliberately excluded; this list is for explicit reassignment only. */
export async function listPendingIndependentHrReviewsInDatabase(
  organisationId: string,
): Promise<PendingIndependentHrReview[]> {
  const rows = await getDatabaseClient().execute(sql`
    WITH pending_requests AS (
      SELECT 'Leave' AS module, id, status::text AS status FROM leave_requests
        WHERE organisation_id=${organisationId}::uuid
          AND status IN ('Pending HR','Amendment Pending HR','Cancellation Pending')
          AND archived_at IS NULL
      UNION ALL SELECT 'Timesheet', id, status::text FROM timesheets
        WHERE organisation_id=${organisationId}::uuid AND status='Pending HR' AND archived_at IS NULL
      UNION ALL SELECT 'Attendance Correction', id, status::text FROM attendance_corrections
        WHERE organisation_id=${organisationId}::uuid AND status='Pending HR' AND archived_at IS NULL
      UNION ALL SELECT 'Overtime', id, status::text FROM overtime_claims
        WHERE organisation_id=${organisationId}::uuid
          AND status IN ('Pending HR','Pending Pre-authorisation') AND archived_at IS NULL
      UNION ALL SELECT 'Training', id, status::text FROM training_requests
        WHERE organisation_id=${organisationId}::uuid AND status='Pending HR' AND archived_at IS NULL
      UNION ALL SELECT 'Visit', id, status::text FROM site_visit_requests
        WHERE organisation_id=${organisationId}::uuid AND archived_at IS NULL
          AND (status='Pending HR' OR
            (status IN ('Approved','Completed') AND details->'extension'->>'status'='Pending'))
      UNION ALL SELECT 'Time Away', id, status::text FROM time_away
        WHERE organisation_id=${organisationId}::uuid AND status='Pending HR' AND archived_at IS NULL
      UNION ALL SELECT 'Document', id, status::text FROM employee_documents
        WHERE organisation_id=${organisationId}::uuid AND status='Pending Verification' AND archived_at IS NULL
      UNION ALL SELECT 'Training Certificate', id, 'Pending HR' FROM training_records
        WHERE organisation_id=${organisationId}::uuid AND hr_verified=false
          AND rejected_at IS NULL AND archived_at IS NULL
      UNION ALL SELECT 'Employment Confirmation', id, employment_confirmation_status::text FROM employees
        WHERE organisation_id=${organisationId}::uuid
          AND employment_confirmation_status='Pending HR Review'
          AND proposed_employment_details IS NOT NULL AND archived_at IS NULL
    )
    SELECT a.module, a.request_id, a.requester_employee_id, a.reviewer_employee_id,
      COALESCE(NULLIF(requester.preferred_name,''), NULLIF(requester.legal_name,''), 'Employee') AS requester_name,
      COALESCE(NULLIF(reviewer.preferred_name,''), NULLIF(reviewer.legal_name,''), 'Employee') AS reviewer_name,
      EXISTS (
        SELECT 1 FROM users reviewer_user WHERE reviewer_user.employee_id=reviewer.id
          AND reviewer_user.organisation_id=${organisationId}::uuid
          AND reviewer_user.status='Active' AND reviewer_user.archived_at IS NULL
      ) AND reviewer.status IN ('Active','Probation','Notice') AND reviewer.archived_at IS NULL AS reviewer_active,
      p.status
    FROM hr_independent_review_assignments a
    JOIN pending_requests p ON p.module=a.module AND p.id=a.request_id
    JOIN employees requester ON requester.id=a.requester_employee_id
    JOIN employees reviewer ON reviewer.id=a.reviewer_employee_id
    WHERE a.organisation_id=${organisationId}::uuid AND a.stage='HR' AND a.archived_at IS NULL
    ORDER BY reviewer_active ASC, a.created_at ASC
  `);
  return rows.map((row) => ({
    module: String(row["module"]) as IndependentHrReviewModule,
    requestId: String(row["request_id"]),
    requesterEmployeeId: String(row["requester_employee_id"]),
    requesterName: String(row["requester_name"]),
    reviewerEmployeeId: String(row["reviewer_employee_id"]),
    reviewerName: String(row["reviewer_name"]),
    reviewerActive: Boolean(row["reviewer_active"]),
    status: String(row["status"]),
  }));
}

export async function reassignPendingIndependentHrReviewInDatabase(
  organisationId: string,
  module: IndependentHrReviewModule,
  requestId: string,
  newReviewerEmployeeId: string,
  actor: AuditActorContext,
): Promise<void> {
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    await reassignIndependentHrReview(
      organisationId,
      module,
      requestId,
      newReviewerEmployeeId,
      actor,
      tx,
    );
  });
}
