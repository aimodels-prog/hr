import "@tanstack/react-start/server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { ViaHrDatabase } from "../client.ts";
import { employees, roles, userRoles, users } from "../schema/employee.ts";
import { hrIndependentReviewAssignments } from "../schema/hr-independent-review.ts";
import { getApprovalRoutingSettingsInDatabase } from "./approval-routing.repository.server.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";
import {
  isAssignedIndependentReviewer,
  isNewEmploymentReviewCycle,
  mustPreserveSpecialLeaveChain,
} from "../../data/hr-independent-review.ts";
import { getDatabaseClient } from "../client.ts";
import { leaveRequests } from "../schema/leave.ts";
import {
  timesheets,
  attendanceCorrections,
  overtimeClaims,
  siteVisitRequests,
} from "../schema/time.ts";
import { timeAway } from "../schema/time-away.ts";
import { trainingRequests } from "../schema/talent.ts";
import { trainingRecords } from "../schema/talent.ts";
import { employeeDocuments } from "../schema/documents.ts";
import { auditEvents, notifications } from "../schema/system.ts";

type Transaction = Parameters<Parameters<ViaHrDatabase["transaction"]>[0]>[0];
export type IndependentHrReviewModule =
  | "Leave"
  | "Timesheet"
  | "Attendance Correction"
  | "Overtime"
  | "Training"
  | "Visit"
  | "Time Away"
  | "Document"
  | "Training Certificate"
  | "Employment Confirmation";

export async function employeeHasHrRole(
  organisationId: string,
  employeeId: string,
  tx: Transaction,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: employees.id })
    .from(employees)
    .innerJoin(users, eq(users.employeeId, employees.id))
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(
      and(
        eq(employees.organisationId, organisationId),
        eq(employees.id, employeeId),
        eq(users.organisationId, organisationId),
        eq(userRoles.organisationId, organisationId),
        eq(roles.code, "HR"),
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function activeReviewer(organisationId: string, employeeId: string, tx: Transaction) {
  const [row] = await tx
    .select({ employeeId: employees.id, userId: users.id })
    .from(employees)
    .innerJoin(users, eq(users.employeeId, employees.id))
    .where(
      and(
        eq(employees.organisationId, organisationId),
        eq(employees.id, employeeId),
        inArray(employees.status, ["Active", "Probation", "Notice"]),
        isNull(employees.archivedAt),
        eq(users.organisationId, organisationId),
        eq(users.status, "Active"),
        isNull(users.archivedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Resolve current policy only for new requests. Pending requests use their saved assignment. */
export async function independentReviewerForHrEmployee(
  organisationId: string,
  requesterEmployeeId: string,
  tx: Transaction,
): Promise<{ employeeId: string; userId: string } | null> {
  const [hrRequester] = await tx
    .select({ id: employees.id })
    .from(employees)
    .innerJoin(users, eq(users.employeeId, employees.id))
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(
      and(
        eq(employees.organisationId, organisationId),
        eq(employees.id, requesterEmployeeId),
        inArray(employees.status, ["Active", "Probation", "Notice"]),
        isNull(employees.archivedAt),
        eq(users.organisationId, organisationId),
        eq(users.status, "Active"),
        isNull(users.archivedAt),
        eq(userRoles.organisationId, organisationId),
        eq(roles.code, "HR"),
      ),
    )
    .limit(1);
  if (!hrRequester) return null;
  const configured = (await getApprovalRoutingSettingsInDatabase(organisationId, tx))
    .hrOwnRequestReviewerEmployeeId;
  if (!configured || configured === requesterEmployeeId)
    throw new Error(
      "Ask the administrator to assign an independent reviewer for HR's own requests.",
    );
  const reviewer = await activeReviewer(organisationId, configured, tx);
  if (!reviewer)
    throw new Error(
      "The independent reviewer is inactive. Ask the administrator to choose an active reviewer.",
    );
  return reviewer;
}

export async function assignIndependentHrReviewer(
  organisationId: string,
  module: IndependentHrReviewModule,
  requestId: string,
  requesterEmployeeId: string,
  reviewerEmployeeId: string,
  actorUserId: string | undefined,
  tx: Transaction,
  stage = "HR",
): Promise<void> {
  if (requesterEmployeeId === reviewerEmployeeId)
    throw new Error("An employee cannot review their own request.");
  if (!actorUserId) throw new Error("A verified user is required for reviewer assignment.");
  const [existing] = await tx
    .select({
      requesterEmployeeId: hrIndependentReviewAssignments.requesterEmployeeId,
      reviewerEmployeeId: hrIndependentReviewAssignments.reviewerEmployeeId,
      archivedAt: hrIndependentReviewAssignments.archivedAt,
    })
    .from(hrIndependentReviewAssignments)
    .where(
      and(
        eq(hrIndependentReviewAssignments.organisationId, organisationId),
        eq(hrIndependentReviewAssignments.module, module),
        eq(hrIndependentReviewAssignments.requestId, requestId),
        eq(hrIndependentReviewAssignments.stage, stage),
      ),
    )
    .limit(1);
  if (existing) {
    if (
      existing.archivedAt ||
      existing.requesterEmployeeId !== requesterEmployeeId ||
      existing.reviewerEmployeeId !== reviewerEmployeeId
    )
      throw new Error(
        "This request already has a different reviewer assignment. Reassign it explicitly.",
      );
    return;
  }
  await tx.insert(hrIndependentReviewAssignments).values({
    organisationId,
    module,
    requestId,
    requesterEmployeeId,
    reviewerEmployeeId,
    stage,
    createdBy: actorUserId,
    updatedBy: actorUserId,
  });
}

/** Resubmission retains the original named reviewer even if settings changed. */
export async function reviewerForExistingOrNewHrRequest(
  organisationId: string,
  module: IndependentHrReviewModule,
  requestId: string,
  requesterEmployeeId: string,
  tx: Transaction,
): Promise<{ employeeId: string; userId: string } | null> {
  const [existing] = await tx
    .select({ id: hrIndependentReviewAssignments.id })
    .from(hrIndependentReviewAssignments)
    .where(
      and(
        eq(hrIndependentReviewAssignments.organisationId, organisationId),
        eq(hrIndependentReviewAssignments.module, module),
        eq(hrIndependentReviewAssignments.requestId, requestId),
        isNull(hrIndependentReviewAssignments.archivedAt),
      ),
    )
    .limit(1);
  if (existing) {
    const reviewer = await assignedIndependentHrReviewer(
      organisationId,
      module,
      requestId,
      requesterEmployeeId,
      tx,
    );
    if (!reviewer)
      throw new Error(
        "The assigned independent reviewer is no longer active. Ask the administrator to reassign this request.",
      );
    return reviewer;
  }
  return independentReviewerForHrEmployee(organisationId, requesterEmployeeId, tx);
}

/** A newly confirmed employment cycle snapshots current routing; returned corrections keep theirs. */
export async function reviewerForEmploymentReviewCycle(
  organisationId: string,
  employeeId: string,
  previousStatus: string,
  actor: AuditActorContext,
  tx: Transaction,
): Promise<{ employeeId: string; userId: string } | null> {
  if (!isNewEmploymentReviewCycle(previousStatus))
    return reviewerForExistingOrNewHrRequest(
      organisationId,
      "Employment Confirmation",
      employeeId,
      employeeId,
      tx,
    );
  const reviewer = await independentReviewerForHrEmployee(organisationId, employeeId, tx);
  if (!reviewer) return null;
  const [existing] = await tx
    .select()
    .from(hrIndependentReviewAssignments)
    .where(
      and(
        eq(hrIndependentReviewAssignments.organisationId, organisationId),
        eq(hrIndependentReviewAssignments.module, "Employment Confirmation"),
        eq(hrIndependentReviewAssignments.requestId, employeeId),
        eq(hrIndependentReviewAssignments.stage, "HR"),
      ),
    )
    .for("update")
    .limit(1);
  if (existing?.archivedAt || (existing && existing.requesterEmployeeId !== employeeId))
    throw new Error("The earlier employment review assignment needs administrator attention.");
  if (existing && existing.reviewerEmployeeId !== reviewer.employeeId) {
    if (!actor.userId) throw new Error("A verified user is required for reviewer assignment.");
    await tx
      .update(hrIndependentReviewAssignments)
      .set({
        reviewerEmployeeId: reviewer.employeeId,
        updatedBy: actor.userId,
        updatedAt: new Date(),
        recordVersion: sql`${hrIndependentReviewAssignments.recordVersion} + 1`,
      })
      .where(eq(hrIndependentReviewAssignments.id, existing.id));
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: "new-employment-review-cycle",
      module: "core-hr",
      entityType: "hr-independent-review-assignment",
      entityId: existing.id,
      beforeSummary: { reviewerEmployeeId: existing.reviewerEmployeeId },
      afterSummary: { reviewerEmployeeId: reviewer.employeeId },
      reason: "A new employment confirmation cycle captured the current independent reviewer.",
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
  }
  return reviewer;
}

/** Returns the saved reviewer, regardless of subsequent policy changes. */
export async function assignedIndependentHrReviewer(
  organisationId: string,
  module: IndependentHrReviewModule,
  requestId: string,
  requesterEmployeeId: string,
  tx: Transaction,
  stage = "HR",
): Promise<{ employeeId: string; userId: string } | null> {
  const [assignment] = await tx
    .select({ reviewerEmployeeId: hrIndependentReviewAssignments.reviewerEmployeeId })
    .from(hrIndependentReviewAssignments)
    .where(
      and(
        eq(hrIndependentReviewAssignments.organisationId, organisationId),
        eq(hrIndependentReviewAssignments.module, module),
        eq(hrIndependentReviewAssignments.requestId, requestId),
        eq(hrIndependentReviewAssignments.requesterEmployeeId, requesterEmployeeId),
        eq(hrIndependentReviewAssignments.stage, stage),
        isNull(hrIndependentReviewAssignments.archivedAt),
      ),
    )
    .limit(1);
  if (!assignment) return null;
  const reviewer = await activeReviewer(organisationId, assignment.reviewerEmployeeId, tx);
  if (!reviewer)
    throw new Error(
      "The assigned independent reviewer is inactive. Ask the administrator to reassign this request.",
    );
  return reviewer;
}

export function actorIsIndependentHrReviewer(
  actor: Pick<AuditActorContext, "employeeId" | "userId" | "activeRole">,
  requesterEmployeeId: string,
  reviewer: { employeeId: string; userId: string } | null,
): boolean {
  return isAssignedIndependentReviewer(actor, requesterEmployeeId, reviewer);
}

async function requestStillAwaitingIndependentReview(
  organisationId: string,
  module: IndependentHrReviewModule,
  requestId: string,
  tx: Transaction,
): Promise<boolean> {
  if (module === "Leave") {
    const [row] = await tx
      .select({ status: leaveRequests.status })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.organisationId, organisationId),
          eq(leaveRequests.id, requestId),
          isNull(leaveRequests.archivedAt),
        ),
      )
      .limit(1);
    return Boolean(
      row && ["Pending HR", "Amendment Pending HR", "Cancellation Pending"].includes(row.status),
    );
  }
  if (module === "Timesheet") {
    const [row] = await tx
      .select({ status: timesheets.status })
      .from(timesheets)
      .where(
        and(
          eq(timesheets.organisationId, organisationId),
          eq(timesheets.id, requestId),
          isNull(timesheets.archivedAt),
        ),
      )
      .limit(1);
    return row?.status === "Pending HR";
  }
  if (module === "Attendance Correction") {
    const [row] = await tx
      .select({ status: attendanceCorrections.status })
      .from(attendanceCorrections)
      .where(
        and(
          eq(attendanceCorrections.organisationId, organisationId),
          eq(attendanceCorrections.id, requestId),
          isNull(attendanceCorrections.archivedAt),
        ),
      )
      .limit(1);
    return row?.status === "Pending HR";
  }
  if (module === "Overtime") {
    const [row] = await tx
      .select({ status: overtimeClaims.status })
      .from(overtimeClaims)
      .where(
        and(
          eq(overtimeClaims.organisationId, organisationId),
          eq(overtimeClaims.id, requestId),
          isNull(overtimeClaims.archivedAt),
        ),
      )
      .limit(1);
    return Boolean(row && ["Pending HR", "Pending Pre-authorisation"].includes(row.status));
  }
  if (module === "Visit") {
    const [row] = await tx
      .select({ status: siteVisitRequests.status, details: siteVisitRequests.details })
      .from(siteVisitRequests)
      .where(
        and(
          eq(siteVisitRequests.organisationId, organisationId),
          eq(siteVisitRequests.id, requestId),
          isNull(siteVisitRequests.archivedAt),
        ),
      )
      .limit(1);
    return Boolean(
      row &&
      (row.status === "Pending HR" ||
        (row.details.extension?.status === "Pending" &&
          ["Approved", "Completed"].includes(row.status))),
    );
  }
  if (module === "Time Away") {
    const [row] = await tx
      .select({ status: timeAway.status })
      .from(timeAway)
      .where(
        and(
          eq(timeAway.organisationId, organisationId),
          eq(timeAway.id, requestId),
          isNull(timeAway.archivedAt),
        ),
      )
      .limit(1);
    return row?.status === "Pending HR";
  }
  if (module === "Document") {
    const [row] = await tx
      .select({ status: employeeDocuments.status })
      .from(employeeDocuments)
      .where(
        and(
          eq(employeeDocuments.organisationId, organisationId),
          eq(employeeDocuments.id, requestId),
          isNull(employeeDocuments.archivedAt),
        ),
      )
      .limit(1);
    return row?.status === "Pending Verification";
  }
  if (module === "Training Certificate") {
    const [row] = await tx
      .select({ verified: trainingRecords.hrVerified, rejectedAt: trainingRecords.rejectedAt })
      .from(trainingRecords)
      .where(
        and(
          eq(trainingRecords.organisationId, organisationId),
          eq(trainingRecords.id, requestId),
          isNull(trainingRecords.archivedAt),
        ),
      )
      .limit(1);
    return Boolean(row && !row.verified && !row.rejectedAt);
  }
  if (module === "Employment Confirmation") {
    const [row] = await tx
      .select({
        status: employees.employmentConfirmationStatus,
        proposed: employees.proposedEmploymentDetails,
      })
      .from(employees)
      .where(
        and(
          eq(employees.organisationId, organisationId),
          eq(employees.id, requestId),
          isNull(employees.archivedAt),
        ),
      )
      .limit(1);
    return row?.status === "Pending HR Review" && Boolean(row.proposed);
  }
  const [row] = await tx
    .select({ status: trainingRequests.status })
    .from(trainingRequests)
    .where(
      and(
        eq(trainingRequests.organisationId, organisationId),
        eq(trainingRequests.id, requestId),
        isNull(trainingRequests.archivedAt),
      ),
    )
    .limit(1);
  return row?.status === "Pending HR";
}

/** Explicit reassignment only; never run implicitly when organisation settings change. */
export async function reassignIndependentHrReview(
  organisationId: string,
  module: IndependentHrReviewModule,
  requestId: string,
  newReviewerEmployeeId: string,
  actor: AuditActorContext,
  tx: Transaction,
): Promise<void> {
  if (actor.activeRole !== "Super Admin" || actor.roles?.includes("HR") || !actor.userId)
    throw new Error("Only a Super Admin can reassign an independent reviewer.");
  const [assignment] = await tx
    .select()
    .from(hrIndependentReviewAssignments)
    .where(
      and(
        eq(hrIndependentReviewAssignments.organisationId, organisationId),
        eq(hrIndependentReviewAssignments.module, module),
        eq(hrIndependentReviewAssignments.requestId, requestId),
        isNull(hrIndependentReviewAssignments.archivedAt),
      ),
    )
    .for("update")
    .limit(1);
  if (!assignment || assignment.requesterEmployeeId === newReviewerEmployeeId)
    throw new Error("The review assignment cannot be changed to this employee.");
  if (!(await requestStillAwaitingIndependentReview(organisationId, module, requestId, tx)))
    throw new Error("Only a request still awaiting independent review can be reassigned.");
  const reviewer = await activeReviewer(organisationId, newReviewerEmployeeId, tx);
  if (!reviewer) throw new Error("Choose an active reviewer.");
  await tx
    .update(hrIndependentReviewAssignments)
    .set({
      reviewerEmployeeId: newReviewerEmployeeId,
      updatedBy: actor.userId,
      updatedAt: new Date(),
      recordVersion: sql`${hrIndependentReviewAssignments.recordVersion} + 1`,
    })
    .where(eq(hrIndependentReviewAssignments.id, assignment.id));
  await tx.insert(auditEvents).values({
    organisationId,
    actorUserId: actor.userId,
    actorEmployeeId: actor.employeeId,
    actorDisplayName: actor.displayName,
    activeRole: actor.activeRole,
    actorRoles: actor.roles ?? [],
    action: "reassign-independent-reviewer",
    module: module.toLowerCase(),
    entityType: "hr-independent-review-assignment",
    entityId: assignment.id,
    beforeSummary: { reviewerEmployeeId: assignment.reviewerEmployeeId },
    afterSummary: { reviewerEmployeeId: newReviewerEmployeeId },
    reason: "An administrator explicitly changed the pending request's independent reviewer.",
    riskLevel: "High",
  } as typeof auditEvents.$inferInsert);
  const links: Record<IndependentHrReviewModule, { entityType: string; path: string }> = {
    Leave: { entityType: "leave-request", path: "/staff/leave-approvals" },
    Timesheet: { entityType: "timesheet", path: `/staff/timesheet-approvals/${requestId}` },
    "Attendance Correction": {
      entityType: "attendance-correction",
      path: "/staff/attendance/corrections",
    },
    Overtime: { entityType: "overtime-claim", path: "/staff/overtime-approvals" },
    Training: { entityType: "training", path: "/staff/training" },
    Visit: {
      entityType: "site-visit",
      path: `/staff/independent-visit-reviews#review=${requestId}`,
    },
    "Time Away": { entityType: "time-away", path: "/staff/time-away" },
    Document: {
      entityType: "employee-document",
      path: `/staff/independent-record-reviews#review=${requestId}`,
    },
    "Training Certificate": {
      entityType: "training-record",
      path: `/staff/independent-record-reviews#review=${requestId}`,
    },
    "Employment Confirmation": {
      entityType: "employee",
      path: `/staff/independent-record-reviews#review=${requestId}`,
    },
  };
  await tx
    .insert(notifications)
    .values({
      organisationId,
      recipientUserId: reviewer.userId,
      type: "Approval",
      title: `${module} awaiting your independent review`,
      message: "A request has been reassigned to you for an independent decision.",
      priority: "High",
      status: "Unread",
      deduplicationKey: `hr-independent-reassign-${module}-${requestId}-${reviewer.userId}-${assignment.recordVersion + 1}`,
      link: { entityType: links[module].entityType, entityId: requestId, path: links[module].path },
      createdBy: actor.userId,
      updatedBy: actor.userId,
    } as typeof notifications.$inferInsert)
    .onConflictDoNothing();
}

/**
 * One-time, confirmed migration of existing HR-owned pending requests. A settings
 * save never invokes this function. Completed approval steps remain in the leave
 * history; superseded pending steps are replaced by one named HR review step.
 */
export async function assignExistingHrOwnRequestsToConfiguredReviewerInDatabase(
  organisationId: string,
  actor: AuditActorContext,
): Promise<{ assigned: number; skipped: number }> {
  if (actor.activeRole !== "Super Admin" || actor.roles?.includes("HR") || !actor.userId)
    throw new Error("Only a Super Admin can assign existing HR requests for independent review.");
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const pending = await tx.execute(sql`
      WITH pending_requests AS (
        SELECT 'Leave' AS module, id, employee_id, status::text AS status FROM leave_requests
          WHERE organisation_id=${organisationId}::uuid AND status IN ('Pending Line Manager','Pending HR') AND archived_at IS NULL
        UNION ALL SELECT 'Timesheet', id, employee_id, status::text FROM timesheets
          WHERE organisation_id=${organisationId}::uuid AND status IN ('Pending Manager','Pending HR') AND archived_at IS NULL
        UNION ALL SELECT 'Attendance Correction', id, employee_id, status::text FROM attendance_corrections
          WHERE organisation_id=${organisationId}::uuid AND status IN ('Pending Manager','Pending HR') AND archived_at IS NULL
        UNION ALL SELECT 'Overtime', id, employee_id, status::text FROM overtime_claims
          WHERE organisation_id=${organisationId}::uuid AND status IN ('Pending Manager','Pending HR','Pending Pre-authorisation') AND archived_at IS NULL
        UNION ALL SELECT 'Training', id, employee_id, status::text FROM training_requests
          WHERE organisation_id=${organisationId}::uuid AND status IN ('Pending Supervisor','Pending HR') AND archived_at IS NULL
        UNION ALL SELECT 'Visit', id, employee_id, status::text FROM site_visit_requests
          WHERE organisation_id=${organisationId}::uuid AND archived_at IS NULL AND
            (status='Pending HR' OR (status IN ('Approved','Completed') AND details->'extension'->>'status'='Pending'))
        UNION ALL SELECT 'Time Away', id, employee_id, status::text FROM time_away
          WHERE organisation_id=${organisationId}::uuid AND status='Pending HR' AND archived_at IS NULL
        UNION ALL SELECT 'Document', id, employee_id, status::text FROM employee_documents
          WHERE organisation_id=${organisationId}::uuid AND status='Pending Verification' AND archived_at IS NULL
        UNION ALL SELECT 'Training Certificate', id, employee_id, 'Pending HR' FROM training_records
          WHERE organisation_id=${organisationId}::uuid AND hr_verified=false AND rejected_at IS NULL AND archived_at IS NULL
        UNION ALL SELECT 'Employment Confirmation', id, id, employment_confirmation_status::text FROM employees
          WHERE organisation_id=${organisationId}::uuid AND employment_confirmation_status='Pending HR Review'
            AND proposed_employment_details IS NOT NULL AND archived_at IS NULL
      )
      SELECT DISTINCT p.module, p.id, p.employee_id, p.status
      FROM pending_requests p
      JOIN employees e ON e.id=p.employee_id AND e.organisation_id=${organisationId}::uuid
        AND e.status IN ('Active','Probation','Notice') AND e.archived_at IS NULL
      JOIN users u ON u.employee_id=e.id AND u.organisation_id=e.organisation_id
        AND u.status='Active' AND u.archived_at IS NULL
      JOIN user_roles ur ON ur.user_id=u.id AND ur.organisation_id=e.organisation_id
      JOIN roles r ON r.id=ur.role_id AND r.code='HR'
      LEFT JOIN hr_independent_review_assignments a ON a.organisation_id=${organisationId}::uuid
        AND a.module=p.module AND a.request_id=p.id AND a.stage='HR' AND a.archived_at IS NULL
      WHERE a.id IS NULL
      ORDER BY p.module, p.id
    `);
    let assigned = 0;
    let skipped = 0;
    for (const candidate of pending) {
      const module = String(candidate["module"]) as IndependentHrReviewModule;
      const requestId = String(candidate["id"]);
      const requesterEmployeeId = String(candidate["employee_id"]);
      const previousStatus = String(candidate["status"]);
      const reviewer = await independentReviewerForHrEmployee(
        organisationId,
        requesterEmployeeId,
        tx,
      );
      if (!reviewer) {
        skipped++;
        continue;
      }
      let changed = false;
      if (module === "Leave") {
        const [request] = await tx
          .select()
          .from(leaveRequests)
          .where(
            and(eq(leaveRequests.organisationId, organisationId), eq(leaveRequests.id, requestId)),
          )
          .for("update")
          .limit(1);
        if (request && ["Pending Line Manager", "Pending HR"].includes(request.status)) {
          const chain = Array.isArray(request.chainApprovals)
            ? (request.chainApprovals as Array<{
                role: string;
                status: string;
                approvedBy?: string;
                date?: string;
              }>)
            : [];
          if (mustPreserveSpecialLeaveChain(request.policySnapshot, chain)) {
            // Preserve special approval stages; these cases need individual routing review.
            skipped++;
            continue;
          }
          const completed = chain.filter((step) => step.status !== "Pending");
          await tx
            .update(leaveRequests)
            .set({
              status: "Pending HR",
              chainApprovals: [...completed, { role: "HR", status: "Pending" }],
              updatedBy: actor.userId,
              updatedAt: new Date(),
              recordVersion: sql`${leaveRequests.recordVersion} + 1`,
            })
            .where(eq(leaveRequests.id, requestId));
          changed = true;
        }
      } else if (module === "Timesheet") {
        const rows = await tx
          .update(timesheets)
          .set({
            status: "Pending HR",
            updatedBy: actor.userId,
            updatedAt: new Date(),
            recordVersion: sql`${timesheets.recordVersion} + 1`,
          })
          .where(
            and(
              eq(timesheets.id, requestId),
              eq(timesheets.organisationId, organisationId),
              sql`${timesheets.status} IN ('Pending Manager','Pending HR')`,
            ),
          )
          .returning({ id: timesheets.id });
        changed = rows.length > 0;
      } else if (module === "Attendance Correction") {
        const rows = await tx
          .update(attendanceCorrections)
          .set({
            status: "Pending HR",
            updatedBy: actor.userId,
            updatedAt: new Date(),
            recordVersion: sql`${attendanceCorrections.recordVersion} + 1`,
          })
          .where(
            and(
              eq(attendanceCorrections.id, requestId),
              eq(attendanceCorrections.organisationId, organisationId),
              sql`${attendanceCorrections.status} IN ('Pending Manager','Pending HR')`,
            ),
          )
          .returning({ id: attendanceCorrections.id });
        changed = rows.length > 0;
      } else if (module === "Overtime") {
        const rows = await tx
          .update(overtimeClaims)
          .set({
            status:
              previousStatus === "Pending Pre-authorisation"
                ? "Pending Pre-authorisation"
                : "Pending HR",
            updatedBy: actor.userId,
            updatedAt: new Date(),
            recordVersion: sql`${overtimeClaims.recordVersion} + 1`,
          })
          .where(
            and(
              eq(overtimeClaims.id, requestId),
              eq(overtimeClaims.organisationId, organisationId),
              sql`${overtimeClaims.status} IN ('Pending Manager','Pending HR','Pending Pre-authorisation')`,
            ),
          )
          .returning({ id: overtimeClaims.id });
        changed = rows.length > 0;
      } else if (module === "Training") {
        const rows = await tx
          .update(trainingRequests)
          .set({
            status: "Pending HR",
            updatedBy: actor.userId,
            updatedAt: new Date(),
            recordVersion: sql`${trainingRequests.recordVersion} + 1`,
          })
          .where(
            and(
              eq(trainingRequests.id, requestId),
              eq(trainingRequests.organisationId, organisationId),
              sql`${trainingRequests.status} IN ('Pending Supervisor','Pending HR')`,
            ),
          )
          .returning({ id: trainingRequests.id });
        changed = rows.length > 0;
      } else if (module === "Visit") {
        changed = await requestStillAwaitingIndependentReview(
          organisationId,
          module,
          requestId,
          tx,
        );
      } else if (module === "Time Away") {
        changed = await requestStillAwaitingIndependentReview(
          organisationId,
          module,
          requestId,
          tx,
        );
      } else if (["Document", "Training Certificate", "Employment Confirmation"].includes(module)) {
        changed = await requestStillAwaitingIndependentReview(
          organisationId,
          module,
          requestId,
          tx,
        );
      }
      if (!changed) {
        skipped++;
        continue;
      }
      await assignIndependentHrReviewer(
        organisationId,
        module,
        requestId,
        requesterEmployeeId,
        reviewer.employeeId,
        actor.userId,
        tx,
      );
      const links: Record<IndependentHrReviewModule, { entityType: string; path: string }> = {
        Leave: { entityType: "leave-request", path: "/staff/leave-approvals" },
        Timesheet: { entityType: "timesheet", path: `/staff/timesheet-approvals/${requestId}` },
        "Attendance Correction": {
          entityType: "attendance-correction",
          path: "/staff/attendance/corrections",
        },
        Overtime: { entityType: "overtime-claim", path: "/staff/overtime-approvals" },
        Training: { entityType: "training", path: "/staff/training" },
        Visit: {
          entityType: "site-visit",
          path: `/staff/independent-visit-reviews#review=${requestId}`,
        },
        "Time Away": { entityType: "time-away", path: "/staff/time-away" },
        Document: {
          entityType: "employee-document",
          path: `/staff/independent-record-reviews#review=${requestId}`,
        },
        "Training Certificate": {
          entityType: "training-record",
          path: `/staff/independent-record-reviews#review=${requestId}`,
        },
        "Employment Confirmation": {
          entityType: "employee",
          path: `/staff/independent-record-reviews#review=${requestId}`,
        },
      };
      await tx
        .insert(notifications)
        .values({
          organisationId,
          recipientUserId: reviewer.userId,
          type: "Approval",
          title: `${module} awaiting your independent review`,
          message: "An HR employee's request has been assigned to you for an independent decision.",
          priority: "High",
          status: "Unread",
          deduplicationKey: `hr-independent-backfill-${module}-${requestId}-${reviewer.userId}`,
          link: {
            entityType: links[module].entityType,
            entityId: requestId,
            path: links[module].path,
          },
          createdBy: actor.userId,
          updatedBy: actor.userId,
        } as typeof notifications.$inferInsert)
        .onConflictDoNothing();
      await tx.insert(auditEvents).values({
        organisationId,
        actorUserId: actor.userId,
        actorEmployeeId: actor.employeeId,
        actorDisplayName: actor.displayName,
        activeRole: actor.activeRole,
        actorRoles: actor.roles ?? [],
        action: "assign-independent-reviewer",
        module: module.toLowerCase(),
        entityType: links[module].entityType,
        entityId: requestId,
        beforeSummary: { status: previousStatus },
        afterSummary: {
          status:
            (module === "Overtime" && previousStatus === "Pending Pre-authorisation") ||
            [
              "Visit",
              "Time Away",
              "Document",
              "Training Certificate",
              "Employment Confirmation",
            ].includes(module)
              ? previousStatus
              : "Pending HR",
          reviewerEmployeeId: reviewer.employeeId,
        },
        reason: "Explicit administrator assignment of an existing HR-owned request.",
        riskLevel: "High",
      } as typeof auditEvents.$inferInsert);
      assigned++;
    }
    return { assigned, skipped };
  });
}
