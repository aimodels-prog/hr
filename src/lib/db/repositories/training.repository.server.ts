import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import type {
  TrainingCourse,
  TrainingEnrollment,
  TrainingRecord,
  TrainingRequest,
  TrainingSession,
} from "../../data/training-types.ts";
import { getDatabaseClient } from "../client.ts";
import { readObjectFile } from "../object-storage.server.ts";
import { fileMetadata } from "../schema/documents.ts";
import { employees, roles, userRoles, users } from "../schema/employee.ts";
import { currencies, locations, projects } from "../schema/master-data.ts";
import { organisations } from "../schema/organisation.ts";
import { auditEvents, notifications } from "../schema/system.ts";
import {
  trainingAssignments,
  trainingCourses,
  trainingRecords,
  trainingRequests,
  trainingSessions,
} from "../schema/talent.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

type Db = ReturnType<typeof getDatabaseClient>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

function activeRole(actor: AuditActorContext) {
  return actor.activeRole ?? actor.roles?.[0] ?? "Employee";
}
function isHr(actor: AuditActorContext) {
  return ["HR", "Super Admin"].includes(activeRole(actor));
}
function actorFields(actor: AuditActorContext) {
  return {
    actorUserId: actor.userId,
    actorEmployeeId: actor.employeeId,
    actorDisplayName: actor.displayName,
    activeRole: activeRole(actor),
    actorRoles: actor.roles ?? [],
  };
}
function base(row: {
  id: string;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
  archivedAt: Date | null;
  recordVersion: number;
}) {
  return {
    id: row.id,
    databaseId: row.id,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    ...(row.archivedAt ? { archivedAt: row.archivedAt.toISOString() } : {}),
    recordVersion: row.recordVersion,
  };
}
function requireHr(actor: AuditActorContext) {
  if (!isHr(actor)) throw new Error("Only HR or Super Admin can manage organisation training.");
}
async function scopedEmployees(org: string, actor: AuditActorContext) {
  if (isHr(actor)) return null;
  if (!actor.employeeId) throw new Error("Your employee profile is not connected.");
  if (activeRole(actor) !== "Line Manager") return [actor.employeeId];
  const reports = await getDatabaseClient()
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(
        eq(employees.organisationId, org),
        eq(employees.lineManagerId, actor.employeeId),
        isNull(employees.archivedAt),
      ),
    );
  return [actor.employeeId, ...reports.map((item) => item.id)];
}
async function assertManager(tx: Tx, org: string, employeeId: string, actor: AuditActorContext) {
  if (activeRole(actor) !== "Line Manager" || !actor.employeeId || actor.employeeId === employeeId)
    throw new Error("Only the employee's assigned supervisor can complete this action.");
  const [employee] = await tx
    .select({ managerId: employees.lineManagerId })
    .from(employees)
    .where(and(eq(employees.organisationId, org), eq(employees.id, employeeId)))
    .limit(1);
  if (employee?.managerId !== actor.employeeId)
    throw new Error("Only the employee's assigned supervisor can complete this action.");
}
async function notifyEmployee(
  tx: Tx,
  org: string,
  employeeId: string,
  title: string,
  message: string,
  entityId: string,
  key: string,
  actor: AuditActorContext,
) {
  const [recipient] = await tx
    .select({ userId: users.id })
    .from(users)
    .where(
      and(
        eq(users.organisationId, org),
        eq(users.employeeId, employeeId),
        eq(users.status, "Active"),
      ),
    )
    .limit(1);
  if (!recipient) return;
  await tx
    .insert(notifications)
    .values({
      organisationId: org,
      recipientUserId: recipient.userId,
      type: "training",
      title,
      message,
      priority: "Normal",
      status: "Unread",
      deduplicationKey: key,
      link: { entityType: "training", entityId, path: "/staff/me/training" },
      createdBy: actor.userId,
      updatedBy: actor.userId,
    } as typeof notifications.$inferInsert)
    .onConflictDoNothing();
}
async function notifyHr(
  tx: Tx,
  org: string,
  title: string,
  message: string,
  entityId: string,
  key: string,
  actor: AuditActorContext,
) {
  const recipients = await tx
    .selectDistinct({ userId: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(
      and(
        eq(users.organisationId, org),
        eq(users.status, "Active"),
        inArray(roles.code, ["HR", "Super Admin"]),
      ),
    );
  for (const recipient of recipients)
    await tx
      .insert(notifications)
      .values({
        organisationId: org,
        recipientUserId: recipient.userId,
        type: "training",
        title,
        message,
        priority: "High",
        status: "Unread",
        deduplicationKey: `${key}-${recipient.userId}`,
        link: { entityType: "training", entityId, path: "/staff/training" },
        createdBy: actor.userId,
        updatedBy: actor.userId,
      } as typeof notifications.$inferInsert)
      .onConflictDoNothing();
}
async function audit(
  tx: Tx,
  org: string,
  actor: AuditActorContext,
  action: string,
  entityType: string,
  entityId: string,
  reason: string,
  before?: Record<string, unknown>,
  after?: Record<string, unknown>,
) {
  await tx.insert(auditEvents).values({
    organisationId: org,
    ...actorFields(actor),
    action,
    module: "training",
    entityType,
    entityId,
    beforeSummary: before,
    afterSummary: after,
    reason,
    riskLevel: action === "view" ? "High" : "Critical",
  } as typeof auditEvents.$inferInsert);
}

export interface TrainingSnapshot {
  courses: TrainingCourse[];
  requests: TrainingRequest[];
  sessions: TrainingSession[];
  enrollments: TrainingEnrollment[];
  records: TrainingRecord[];
}

export async function listTrainingForActor(
  org: string,
  actor: AuditActorContext,
): Promise<TrainingSnapshot> {
  const db = getDatabaseClient();
  const scoped = await scopedEmployees(org, actor);
  const noRows = scoped !== null && scoped.length === 0;
  const [courseRows, sessionRows, requestRows, assignmentRows, recordRows] = await Promise.all([
    db
      .select()
      .from(trainingCourses)
      .where(
        and(
          eq(trainingCourses.organisationId, org),
          ...(isHr(actor)
            ? []
            : [isNull(trainingCourses.archivedAt), eq(trainingCourses.isActive, true)]),
        ),
      ),
    db
      .select()
      .from(trainingSessions)
      .where(and(eq(trainingSessions.organisationId, org), isNull(trainingSessions.archivedAt))),
    noRows
      ? []
      : db
          .select()
          .from(trainingRequests)
          .where(
            and(
              eq(trainingRequests.organisationId, org),
              isNull(trainingRequests.archivedAt),
              ...(scoped ? [inArray(trainingRequests.employeeId, scoped)] : []),
            ),
          ),
    noRows
      ? []
      : db
          .select()
          .from(trainingAssignments)
          .where(
            and(
              eq(trainingAssignments.organisationId, org),
              isNull(trainingAssignments.archivedAt),
              ...(scoped ? [inArray(trainingAssignments.employeeId, scoped)] : []),
            ),
          ),
    noRows
      ? []
      : db
          .select()
          .from(trainingRecords)
          .where(
            and(
              eq(trainingRecords.organisationId, org),
              isNull(trainingRecords.archivedAt),
              ...(scoped ? [inArray(trainingRecords.employeeId, scoped)] : []),
            ),
          ),
  ]);
  const recordByAssignment = new Map(
    recordRows.filter((item) => item.assignmentId).map((item) => [item.assignmentId!, item.id]),
  );
  const result: TrainingSnapshot = {
    courses: courseRows.map((row) => ({
      ...base(row),
      code: row.code,
      title: row.title,
      description: row.description,
      provider: row.provider,
      category: row.category,
      deliveryType: row.deliveryType as TrainingCourse["deliveryType"],
      durationHours: Number(row.durationHours),
      cost: Number(row.cost),
      currency: row.currency,
      ...(row.validityMonths ? { validityMonths: row.validityMonths } : {}),
      ...(row.renewalIntervalMonths ? { renewalIntervalMonths: row.renewalIntervalMonths } : {}),
      requiredRoles: row.requiredRoles,
      requiredLocations: row.requiredLocations,
      requiredProjects: row.requiredProjects,
      isMandatory: row.isMandatory,
      isActive: row.isActive,
    })),
    requests: requestRows.map((row) => ({
      ...base(row),
      employeeId: row.employeeId,
      courseId: row.courseId,
      origin: row.origin as TrainingRequest["origin"],
      reason: row.reason,
      status: row.status as TrainingRequest["status"],
      ...(row.supervisorDecisionAt ? { supervisorDecisionAt: row.supervisorDecisionAt } : {}),
      ...(row.supervisorDecisionBy ? { supervisorDecisionBy: row.supervisorDecisionBy } : {}),
      ...(row.supervisorComment ? { supervisorComment: row.supervisorComment } : {}),
      ...(row.hrDecisionAt ? { hrDecisionAt: row.hrDecisionAt } : {}),
      ...(row.hrDecisionBy ? { hrDecisionBy: row.hrDecisionBy } : {}),
      ...(row.hrComment ? { hrComment: row.hrComment } : {}),
      ...(row.rejectionReason ? { rejectionReason: row.rejectionReason } : {}),
    })),
    sessions: sessionRows.map((row) => ({
      ...base(row),
      courseId: row.courseId,
      title: row.title,
      startAt: row.startAt,
      endAt: row.endAt,
      location: row.location,
      facilitator: row.facilitator,
      capacity: row.capacity,
      status: row.status as TrainingSession["status"],
    })),
    enrollments: assignmentRows.map((row) => ({
      ...base(row),
      employeeId: row.employeeId,
      courseId: row.courseId,
      ...(row.requestId ? { requestId: row.requestId } : {}),
      ...(row.sessionId ? { sessionId: row.sessionId } : {}),
      status: row.status as TrainingEnrollment["status"],
      assignedBy: row.assignedBy,
      assignedAt: row.assignedAt,
      ...(row.attendanceRecordedAt ? { attendanceRecordedAt: row.attendanceRecordedAt } : {}),
      ...(row.attendanceRecordedBy ? { attendanceRecordedBy: row.attendanceRecordedBy } : {}),
      ...(row.completionDate ? { completionDate: row.completionDate } : {}),
      ...(row.result ? { result: row.result } : {}),
      ...(row.actualCost === null ? {} : { actualCost: Number(row.actualCost) }),
      ...(recordByAssignment.get(row.id)
        ? { trainingRecordId: recordByAssignment.get(row.id)! }
        : {}),
      ...(row.cancellationReason ? { cancellationReason: row.cancellationReason } : {}),
    })),
    records: recordRows.map((row) => ({
      ...base(row),
      employeeId: row.employeeId,
      ...(row.courseId ? { courseId: row.courseId } : {}),
      ...(row.assignmentId ? { enrollmentId: row.assignmentId } : {}),
      title: row.title,
      provider: row.provider,
      completionDate: row.completionDate,
      ...(row.expiryDate ? { expiryDate: row.expiryDate } : {}),
      ...(row.certificateFileId ? { certificateFileId: row.certificateFileId } : {}),
      hrVerified: row.hrVerified,
      ...(row.verifiedAt ? { verifiedAt: row.verifiedAt } : {}),
      ...(row.verifiedBy ? { verifiedBy: row.verifiedBy } : {}),
      ...(row.verificationComment ? { verificationComment: row.verificationComment } : {}),
      ...(row.rejectedAt ? { rejectedAt: row.rejectedAt } : {}),
      ...(row.rejectedBy ? { rejectedBy: row.rejectedBy } : {}),
      ...(row.rejectionReason ? { rejectionReason: row.rejectionReason } : {}),
    })),
  };
  if (actor.userId)
    await audit(
      db as unknown as Tx,
      org,
      actor,
      "view",
      "training-register",
      org,
      "Viewed permitted training records",
      undefined,
      {
        requests: result.requests.length,
        assignments: result.enrollments.length,
        records: result.records.length,
      },
    );
  return result;
}

export type CourseInput = Omit<
  TrainingCourse,
  | "id"
  | "databaseId"
  | "createdAt"
  | "createdBy"
  | "updatedAt"
  | "updatedBy"
  | "recordVersion"
  | "archivedAt"
>;

function validateCourse(input: CourseInput) {
  if (input.code.trim().length < 2 || input.title.trim().length < 3)
    throw new Error("Enter a course code and title.");
  if (input.description.trim().length < 10 || input.provider.trim().length < 2)
    throw new Error("Enter a clear course description and provider.");
  if (input.durationHours <= 0 || input.cost < 0 || !/^[A-Z]{3}$/.test(input.currency))
    throw new Error("Check the duration, cost and three-letter currency.");
  for (const value of [input.validityMonths, input.renewalIntervalMonths])
    if (value !== undefined && (!Number.isInteger(value) || value <= 0))
      throw new Error("Validity and renewal periods must be positive whole months.");
}

const SYSTEM_ROLES = new Set(["Employee", "Line Manager", "HR", "Accounts", "Super Admin", "IT"]);

export async function saveTrainingCourseInDatabase(
  org: string,
  input: CourseInput & { courseId?: string; expectedVersion?: number },
  actor: AuditActorContext,
) {
  requireHr(actor);
  validateCourse(input);
  const db = getDatabaseClient();
  const id = input.courseId ?? randomUUID();
  await db.transaction(async (tx) => {
    if (input.requiredRoles.some((role) => !SYSTEM_ROLES.has(role)))
      throw new Error("Select only roles available in VIA HR System.");
    if (input.requiredLocations.length) {
      const selected = await tx
        .select({ id: locations.id })
        .from(locations)
        .where(
          and(
            eq(locations.organisationId, org),
            inArray(locations.id, [...new Set(input.requiredLocations)]),
            eq(locations.isActive, true),
            isNull(locations.archivedAt),
          ),
        );
      if (selected.length !== new Set(input.requiredLocations).size)
        throw new Error("One or more selected locations are no longer available.");
    }
    if (input.requiredProjects.length) {
      const selected = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.organisationId, org),
            inArray(projects.id, [...new Set(input.requiredProjects)]),
            eq(projects.isActive, true),
            isNull(projects.archivedAt),
          ),
        );
      if (selected.length !== new Set(input.requiredProjects).size)
        throw new Error("One or more selected projects are no longer available.");
    }
    const [currency] = await tx
      .select({ id: currencies.id })
      .from(currencies)
      .where(
        and(
          eq(currencies.organisationId, org),
          eq(currencies.code, input.currency.trim().toUpperCase()),
          eq(currencies.isActive, true),
          isNull(currencies.archivedAt),
        ),
      )
      .limit(1);
    if (!currency) throw new Error("Select an active currency configured by HR.");
    const [existing] = input.courseId
      ? await tx
          .select()
          .from(trainingCourses)
          .where(and(eq(trainingCourses.organisationId, org), eq(trainingCourses.id, id)))
          .for("update")
          .limit(1)
      : [];
    if (
      existing &&
      input.expectedVersion !== undefined &&
      existing.recordVersion !== input.expectedVersion
    )
      throw new Error("This course changed after you opened it. Reload and try again.");
    const [duplicate] = await tx
      .select({ id: trainingCourses.id })
      .from(trainingCourses)
      .where(
        and(
          eq(trainingCourses.organisationId, org),
          sql`${trainingCourses.id} <> ${id}`,
          sql`(lower(${trainingCourses.code}) = ${input.code.trim().toLowerCase()} OR lower(${trainingCourses.title}) = ${input.title.trim().toLowerCase()})`,
        ),
      )
      .limit(1);
    if (duplicate) throw new Error("A course with this code or title already exists.");
    const values = {
      code: input.code.trim().toUpperCase(),
      title: input.title.trim(),
      description: input.description.trim(),
      provider: input.provider.trim(),
      category: input.category.trim(),
      deliveryType: input.deliveryType,
      durationHours: String(input.durationHours),
      cost: String(input.cost),
      currency: input.currency.trim().toUpperCase(),
      validityMonths: input.validityMonths ?? null,
      renewalIntervalMonths: input.renewalIntervalMonths ?? null,
      requiredRoles: [...new Set(input.requiredRoles)],
      requiredLocations: [...new Set(input.requiredLocations)],
      requiredProjects: [...new Set(input.requiredProjects)],
      isMandatory: input.isMandatory,
      isActive: input.isActive,
      updatedAt: new Date(),
      updatedBy: actor.userId,
    };
    if (existing)
      await tx
        .update(trainingCourses)
        .set({ ...values, recordVersion: sql`${trainingCourses.recordVersion} + 1` })
        .where(eq(trainingCourses.id, id));
    else
      await tx.insert(trainingCourses).values({
        id,
        organisationId: org,
        ...values,
        createdBy: actor.userId,
      } as typeof trainingCourses.$inferInsert);
    await audit(
      tx,
      org,
      actor,
      existing ? "update" : "create",
      "training-course",
      id,
      existing ? "Updated training course" : "Created training course",
      existing ? { title: existing.title } : undefined,
      { title: input.title.trim(), mandatory: input.isMandatory },
    );
  });
  return id;
}

export async function archiveTrainingCourseInDatabase(
  org: string,
  courseId: string,
  archive: boolean,
  reason: string,
  actor: AuditActorContext,
) {
  requireHr(actor);
  if (reason.trim().length < 5) throw new Error("Record a reason for this change.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [course] = await tx
      .select()
      .from(trainingCourses)
      .where(and(eq(trainingCourses.organisationId, org), eq(trainingCourses.id, courseId)))
      .for("update")
      .limit(1);
    if (!course) throw new Error("Training course not found.");
    if (archive) {
      const [open] = await tx
        .select({ id: trainingAssignments.id })
        .from(trainingAssignments)
        .where(
          and(
            eq(trainingAssignments.courseId, courseId),
            isNull(trainingAssignments.archivedAt),
            inArray(trainingAssignments.status, ["Assigned", "Scheduled", "Attended"]),
          ),
        )
        .limit(1);
      if (open) throw new Error("This course has active assignments and cannot be archived.");
    }
    await tx
      .update(trainingCourses)
      .set({
        archivedAt: archive ? new Date() : null,
        isActive: !archive,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${trainingCourses.recordVersion} + 1`,
      })
      .where(eq(trainingCourses.id, courseId));
    await audit(
      tx,
      org,
      actor,
      archive ? "archive" : "restore",
      "training-course",
      courseId,
      reason.trim(),
      { archived: Boolean(course.archivedAt) },
      { archived: archive },
    );
  });
}

async function createAssignment(
  tx: Tx,
  org: string,
  request: typeof trainingRequests.$inferSelect,
  actor: AuditActorContext,
) {
  const [existing] = await tx
    .select({ id: trainingAssignments.id })
    .from(trainingAssignments)
    .where(
      and(
        eq(trainingAssignments.organisationId, org),
        eq(trainingAssignments.employeeId, request.employeeId),
        eq(trainingAssignments.courseId, request.courseId),
        isNull(trainingAssignments.archivedAt),
        inArray(trainingAssignments.status, ["Assigned", "Scheduled", "Attended"]),
      ),
    )
    .limit(1);
  if (existing) return existing.id;
  const id = randomUUID();
  await tx.insert(trainingAssignments).values({
    id,
    organisationId: org,
    employeeId: request.employeeId,
    courseId: request.courseId,
    requestId: request.id,
    status: "Assigned",
    assignedBy: actor.userId!,
    assignedAt: new Date().toISOString(),
    createdBy: actor.userId,
    updatedBy: actor.userId,
  } as typeof trainingAssignments.$inferInsert);
  return id;
}

export async function createTrainingRequestInDatabase(
  org: string,
  input: {
    employeeId: string;
    courseId: string;
    reason: string;
    origin: TrainingRequest["origin"];
  },
  actor: AuditActorContext,
) {
  if (input.reason.trim().length < 5) throw new Error("Explain why this training is needed.");
  const self = actor.employeeId === input.employeeId;
  const manager = activeRole(actor) === "Line Manager";
  if (input.origin === "Employee Request" && (!self || activeRole(actor) !== "Employee"))
    throw new Error("Employees can request training only for themselves.");
  if (input.origin === "HR Assignment") requireHr(actor);
  const db = getDatabaseClient();
  let requestId = "";
  await db.transaction(async (tx) => {
    if (input.origin === "Supervisor Assignment")
      await assertManager(tx, org, input.employeeId, actor);
    if (input.origin !== "Employee Request" && self)
      throw new Error("You cannot approve or assign your own training.");
    const [employee] = await tx
      .select()
      .from(employees)
      .where(
        and(
          eq(employees.organisationId, org),
          eq(employees.id, input.employeeId),
          isNull(employees.archivedAt),
        ),
      )
      .limit(1);
    const [course] = await tx
      .select()
      .from(trainingCourses)
      .where(
        and(
          eq(trainingCourses.organisationId, org),
          eq(trainingCourses.id, input.courseId),
          eq(trainingCourses.isActive, true),
          isNull(trainingCourses.archivedAt),
        ),
      )
      .limit(1);
    if (!employee || ["Inactive", "Archived"].includes(employee.status))
      throw new Error("Select an active employee.");
    if (!course) throw new Error("Select an active training course.");
    const [duplicate] = await tx
      .select({ id: trainingRequests.id })
      .from(trainingRequests)
      .where(
        and(
          eq(trainingRequests.organisationId, org),
          eq(trainingRequests.employeeId, input.employeeId),
          eq(trainingRequests.courseId, input.courseId),
          isNull(trainingRequests.archivedAt),
          inArray(trainingRequests.status, ["Pending Supervisor", "Pending HR", "Approved"]),
        ),
      )
      .limit(1);
    if (duplicate) throw new Error("This course is already in the employee's training plan.");
    requestId = randomUUID();
    const status: TrainingRequest["status"] =
      input.origin === "HR Assignment" ||
      (input.origin === "Employee Request" && Number(course.cost) === 0)
        ? "Approved"
        : input.origin === "Supervisor Assignment" || !employee.lineManagerId
          ? "Pending HR"
          : "Pending Supervisor";
    const now = new Date().toISOString();
    await tx.insert(trainingRequests).values({
      id: requestId,
      organisationId: org,
      employeeId: input.employeeId,
      courseId: input.courseId,
      origin: input.origin,
      reason: input.reason.trim(),
      status,
      ...(input.origin === "Supervisor Assignment"
        ? {
            supervisorDecisionAt: now,
            supervisorDecisionBy: actor.userId,
            supervisorComment: input.reason.trim(),
          }
        : {}),
      ...(input.origin === "HR Assignment"
        ? { hrDecisionAt: now, hrDecisionBy: actor.userId, hrComment: input.reason.trim() }
        : {}),
      createdBy: actor.userId,
      updatedBy: actor.userId,
    } as typeof trainingRequests.$inferInsert);
    if (status === "Approved")
      await createAssignment(
        tx,
        org,
        {
          id: requestId,
          organisationId: org,
          employeeId: input.employeeId,
          courseId: input.courseId,
        } as typeof trainingRequests.$inferSelect,
        actor,
      );
    else if (status === "Pending Supervisor" && employee.lineManagerId)
      await notifyEmployee(
        tx,
        org,
        employee.lineManagerId,
        "Training request awaiting review",
        `${employee.preferredName} requested ${course.title}.`,
        requestId,
        `training-supervisor-${requestId}`,
        actor,
      );
    else
      await notifyHr(
        tx,
        org,
        "Training request awaiting HR review",
        `${employee.preferredName} requested ${course.title}.`,
        requestId,
        `training-hr-${requestId}`,
        actor,
      );
    await notifyEmployee(
      tx,
      org,
      input.employeeId,
      status === "Approved" ? "Training assigned" : "Training request submitted",
      `${course.title} is ${status.toLowerCase()}.`,
      requestId,
      `training-request-${requestId}-${status}`,
      actor,
    );
    await audit(
      tx,
      org,
      actor,
      input.origin === "Employee Request" ? "submit" : "assign",
      "training-request",
      requestId,
      input.reason.trim(),
      undefined,
      { employeeId: input.employeeId, courseId: input.courseId, status, origin: input.origin },
    );
  });
  return requestId;
}

export async function decideTrainingRequestInDatabase(
  org: string,
  requestId: string,
  stage: "Supervisor" | "HR",
  decision: "Approve" | "Reject",
  comment: string,
  actor: AuditActorContext,
) {
  if (comment.trim().length < 5) throw new Error("Record a reason for this decision.");
  if (stage === "HR") requireHr(actor);
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(trainingRequests)
      .where(and(eq(trainingRequests.organisationId, org), eq(trainingRequests.id, requestId)))
      .for("update")
      .limit(1);
    if (!request) throw new Error("Training request not found.");
    if (actor.employeeId === request.employeeId)
      throw new Error("You cannot approve your own training request.");
    if (stage === "Supervisor") {
      await assertManager(tx, org, request.employeeId, actor);
      if (request.status !== "Pending Supervisor")
        throw new Error("This request is not awaiting supervisor review.");
    } else if (request.status !== "Pending HR")
      throw new Error("This request is not awaiting HR review.");
    const status: TrainingRequest["status"] =
      decision === "Reject" ? "Rejected" : stage === "Supervisor" ? "Pending HR" : "Approved";
    const now = new Date().toISOString();
    await tx
      .update(trainingRequests)
      .set({
        status,
        ...(stage === "Supervisor"
          ? {
              supervisorDecisionAt: now,
              supervisorDecisionBy: actor.userId,
              supervisorComment: comment.trim(),
            }
          : { hrDecisionAt: now, hrDecisionBy: actor.userId, hrComment: comment.trim() }),
        rejectionReason: decision === "Reject" ? comment.trim() : null,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${trainingRequests.recordVersion} + 1`,
      })
      .where(eq(trainingRequests.id, requestId));
    if (status === "Approved") await createAssignment(tx, org, request, actor);
    if (status === "Pending HR")
      await notifyHr(
        tx,
        org,
        "Training request awaiting HR review",
        "A supervisor-approved training request needs a decision.",
        requestId,
        `training-hr-${requestId}`,
        actor,
      );
    await notifyEmployee(
      tx,
      org,
      request.employeeId,
      decision === "Reject"
        ? "Training request declined"
        : status === "Approved"
          ? "Training approved"
          : "Training request sent to HR",
      decision === "Reject"
        ? comment.trim()
        : `Your training request is now ${status.toLowerCase()}.`,
      requestId,
      `training-decision-${requestId}-${stage}-${decision}`,
      actor,
    );
    await audit(
      tx,
      org,
      actor,
      decision.toLowerCase(),
      "training-request",
      requestId,
      comment.trim(),
      { status: request.status },
      { status },
    );
  });
}

export async function withdrawTrainingRequestInDatabase(
  org: string,
  requestId: string,
  reason: string,
  actor: AuditActorContext,
) {
  if (reason.trim().length < 5) throw new Error("Explain why the request is being withdrawn.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(trainingRequests)
      .where(and(eq(trainingRequests.organisationId, org), eq(trainingRequests.id, requestId)))
      .for("update")
      .limit(1);
    if (
      !request ||
      actor.employeeId !== request.employeeId ||
      activeRole(actor) !== "Employee" ||
      !["Pending Supervisor", "Pending HR"].includes(request.status)
    )
      throw new Error("Only the employee can withdraw their pending request.");
    await tx
      .update(trainingRequests)
      .set({
        status: "Withdrawn",
        rejectionReason: reason.trim(),
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${trainingRequests.recordVersion} + 1`,
      })
      .where(eq(trainingRequests.id, requestId));
    await audit(
      tx,
      org,
      actor,
      "withdraw",
      "training-request",
      requestId,
      reason.trim(),
      { status: request.status },
      { status: "Withdrawn" },
    );
  });
}

export type SessionInput = Omit<
  TrainingSession,
  | "id"
  | "databaseId"
  | "createdAt"
  | "createdBy"
  | "updatedAt"
  | "updatedBy"
  | "recordVersion"
  | "archivedAt"
  | "status"
>;

export async function saveTrainingSessionInDatabase(
  org: string,
  input: SessionInput & { sessionId?: string; expectedVersion?: number },
  actor: AuditActorContext,
) {
  requireHr(actor);
  const start = new Date(input.startAt);
  const end = new Date(input.endAt);
  if (
    input.title.trim().length < 3 ||
    input.location.trim().length < 2 ||
    input.facilitator.trim().length < 2 ||
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end <= start ||
    !Number.isInteger(input.capacity) ||
    input.capacity < 1
  )
    throw new Error("Complete the session details with a valid date range and capacity.");
  const db = getDatabaseClient();
  const id = input.sessionId ?? randomUUID();
  await db.transaction(async (tx) => {
    const [course] = await tx
      .select({ id: trainingCourses.id })
      .from(trainingCourses)
      .where(
        and(
          eq(trainingCourses.organisationId, org),
          eq(trainingCourses.id, input.courseId),
          eq(trainingCourses.isActive, true),
          isNull(trainingCourses.archivedAt),
        ),
      )
      .limit(1);
    if (!course) throw new Error("Select an active training course.");
    const [existing] = input.sessionId
      ? await tx
          .select()
          .from(trainingSessions)
          .where(and(eq(trainingSessions.organisationId, org), eq(trainingSessions.id, id)))
          .for("update")
          .limit(1)
      : [];
    if (existing && existing.status !== "Scheduled")
      throw new Error("Only a scheduled session can be edited.");
    if (
      existing &&
      input.expectedVersion !== undefined &&
      existing.recordVersion !== input.expectedVersion
    )
      throw new Error("This session changed after you opened it. Reload and try again.");
    const values = {
      courseId: input.courseId,
      title: input.title.trim(),
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      location: input.location.trim(),
      facilitator: input.facilitator.trim(),
      capacity: input.capacity,
      status: "Scheduled",
      updatedAt: new Date(),
      updatedBy: actor.userId,
    };
    if (existing)
      await tx
        .update(trainingSessions)
        .set({ ...values, recordVersion: sql`${trainingSessions.recordVersion} + 1` })
        .where(eq(trainingSessions.id, id));
    else
      await tx.insert(trainingSessions).values({
        id,
        organisationId: org,
        ...values,
        createdBy: actor.userId,
      } as typeof trainingSessions.$inferInsert);
    await audit(
      tx,
      org,
      actor,
      existing ? "update" : "create",
      "training-session",
      id,
      existing ? "Updated training session" : "Created training session",
      undefined,
      { title: input.title.trim(), startAt: start.toISOString(), capacity: input.capacity },
    );
  });
  return id;
}

export async function cancelTrainingSessionInDatabase(
  org: string,
  sessionId: string,
  reason: string,
  actor: AuditActorContext,
) {
  requireHr(actor);
  if (reason.trim().length < 5) throw new Error("Explain why the session is being cancelled.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(trainingSessions)
      .where(and(eq(trainingSessions.organisationId, org), eq(trainingSessions.id, sessionId)))
      .for("update")
      .limit(1);
    if (!session || session.status !== "Scheduled")
      throw new Error("Only a scheduled session can be cancelled.");
    const assignments = await tx
      .select()
      .from(trainingAssignments)
      .where(
        and(
          eq(trainingAssignments.organisationId, org),
          eq(trainingAssignments.sessionId, sessionId),
          eq(trainingAssignments.status, "Scheduled"),
          isNull(trainingAssignments.archivedAt),
        ),
      )
      .for("update");
    await tx
      .update(trainingAssignments)
      .set({
        status: "Assigned",
        sessionId: null,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${trainingAssignments.recordVersion} + 1`,
      })
      .where(
        and(
          eq(trainingAssignments.sessionId, sessionId),
          eq(trainingAssignments.status, "Scheduled"),
        ),
      );
    await tx
      .update(trainingSessions)
      .set({
        status: "Cancelled",
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${trainingSessions.recordVersion} + 1`,
      })
      .where(eq(trainingSessions.id, sessionId));
    for (const assignment of assignments)
      await notifyEmployee(
        tx,
        org,
        assignment.employeeId,
        "Training session cancelled",
        `${session.title} was cancelled. HR will arrange a new date.`,
        assignment.id,
        `training-session-cancelled-${sessionId}-${assignment.employeeId}`,
        actor,
      );
    await audit(
      tx,
      org,
      actor,
      "cancel",
      "training-session",
      sessionId,
      reason.trim(),
      {
        status: session.status,
      },
      { status: "Cancelled", assignmentsReturned: assignments.length },
    );
  });
}

export async function scheduleTrainingAssignmentInDatabase(
  org: string,
  assignmentId: string,
  sessionId: string,
  actor: AuditActorContext,
) {
  requireHr(actor);
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [assignment] = await tx
      .select()
      .from(trainingAssignments)
      .where(
        and(eq(trainingAssignments.organisationId, org), eq(trainingAssignments.id, assignmentId)),
      )
      .for("update")
      .limit(1);
    const [session] = await tx
      .select()
      .from(trainingSessions)
      .where(and(eq(trainingSessions.organisationId, org), eq(trainingSessions.id, sessionId)))
      .for("update")
      .limit(1);
    if (!assignment || !["Assigned", "Scheduled"].includes(assignment.status))
      throw new Error("Only assigned training can be scheduled.");
    if (
      !session ||
      session.status !== "Scheduled" ||
      session.courseId !== assignment.courseId ||
      new Date(session.startAt) <= new Date()
    )
      throw new Error("Select a future active session for the same course.");
    const [occupancy] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(trainingAssignments)
      .where(
        and(
          eq(trainingAssignments.sessionId, sessionId),
          sql`${trainingAssignments.id} <> ${assignmentId}`,
          sql`${trainingAssignments.status} <> 'Cancelled'`,
          isNull(trainingAssignments.archivedAt),
        ),
      );
    if ((occupancy?.count ?? 0) >= session.capacity)
      throw new Error("This training session is full.");
    await tx
      .update(trainingAssignments)
      .set({
        sessionId,
        status: "Scheduled",
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${trainingAssignments.recordVersion} + 1`,
      })
      .where(eq(trainingAssignments.id, assignmentId));
    await notifyEmployee(
      tx,
      org,
      assignment.employeeId,
      "Training session scheduled",
      `${session.title} has been scheduled for you.`,
      assignmentId,
      `training-scheduled-${assignmentId}-${sessionId}`,
      actor,
    );
    await audit(
      tx,
      org,
      actor,
      "schedule",
      "training-assignment",
      assignmentId,
      "Scheduled employee training",
      { sessionId: assignment.sessionId },
      { sessionId },
    );
  });
}

export async function recordTrainingAttendanceInDatabase(
  org: string,
  assignmentId: string,
  attended: boolean,
  reason: string,
  actor: AuditActorContext,
) {
  requireHr(actor);
  if (!attended && reason.trim().length < 5) throw new Error("Record the reason for the absence.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [assignment] = await tx
      .select()
      .from(trainingAssignments)
      .where(
        and(eq(trainingAssignments.organisationId, org), eq(trainingAssignments.id, assignmentId)),
      )
      .for("update")
      .limit(1);
    if (!assignment || assignment.status !== "Scheduled" || !assignment.sessionId)
      throw new Error("Only scheduled training can have attendance recorded.");
    if (actor.employeeId === assignment.employeeId)
      throw new Error("You cannot record your own training attendance.");
    const [session] = await tx
      .select()
      .from(trainingSessions)
      .where(eq(trainingSessions.id, assignment.sessionId))
      .limit(1);
    if (!session || new Date(session.startAt) > new Date())
      throw new Error("Attendance cannot be recorded before the session starts.");
    const status = attended ? "Attended" : "No Show";
    await tx
      .update(trainingAssignments)
      .set({
        status,
        attendanceRecordedAt: new Date().toISOString(),
        attendanceRecordedBy: actor.userId,
        cancellationReason: attended ? null : reason.trim(),
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${trainingAssignments.recordVersion} + 1`,
      })
      .where(eq(trainingAssignments.id, assignmentId));
    await notifyEmployee(
      tx,
      org,
      assignment.employeeId,
      attended ? "Training attendance confirmed" : "Training marked as no show",
      attended ? `${session.title} attendance was confirmed.` : reason.trim(),
      assignmentId,
      `training-attendance-${assignmentId}-${status}`,
      actor,
    );
    await audit(
      tx,
      org,
      actor,
      attended ? "attend" : "no-show",
      "training-assignment",
      assignmentId,
      reason.trim() || "Attendance confirmed",
      { status: assignment.status },
      { status },
    );
  });
}

export async function cancelTrainingAssignmentInDatabase(
  org: string,
  assignmentId: string,
  reason: string,
  actor: AuditActorContext,
) {
  requireHr(actor);
  if (reason.trim().length < 5) throw new Error("Explain why the assignment is being cancelled.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [assignment] = await tx
      .select()
      .from(trainingAssignments)
      .where(
        and(eq(trainingAssignments.organisationId, org), eq(trainingAssignments.id, assignmentId)),
      )
      .for("update")
      .limit(1);
    if (!assignment || ["Completed", "Cancelled", "No Show"].includes(assignment.status))
      throw new Error("This training assignment is already closed.");
    if (actor.employeeId === assignment.employeeId)
      throw new Error("You cannot cancel your own training assignment.");
    await tx
      .update(trainingAssignments)
      .set({
        status: "Cancelled",
        cancellationReason: reason.trim(),
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${trainingAssignments.recordVersion} + 1`,
      })
      .where(eq(trainingAssignments.id, assignmentId));
    await notifyEmployee(
      tx,
      org,
      assignment.employeeId,
      "Training cancelled",
      reason.trim(),
      assignmentId,
      `training-assignment-cancelled-${assignmentId}`,
      actor,
    );
    await audit(
      tx,
      org,
      actor,
      "cancel",
      "training-assignment",
      assignmentId,
      reason.trim(),
      { status: assignment.status },
      { status: "Cancelled" },
    );
  });
}

function addMonths(date: string, months: number) {
  const value = new Date(`${date}T12:00:00Z`);
  const day = value.getUTCDate();
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth() + months);
  const end = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)).getUTCDate();
  value.setUTCDate(Math.min(day, end));
  return value.toISOString().slice(0, 10);
}

export async function completeTrainingAssignmentInDatabase(
  org: string,
  assignmentId: string,
  result: string,
  completionDate: string,
  actualCost: number,
  actor: AuditActorContext,
) {
  requireHr(actor);
  if (
    result.trim().length < 2 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(completionDate) ||
    completionDate > new Date().toISOString().slice(0, 10) ||
    actualCost < 0
  )
    throw new Error("Enter a valid result, completion date and cost.");
  const db = getDatabaseClient();
  let recordId = "";
  await db.transaction(async (tx) => {
    const [assignment] = await tx
      .select()
      .from(trainingAssignments)
      .where(
        and(eq(trainingAssignments.organisationId, org), eq(trainingAssignments.id, assignmentId)),
      )
      .for("update")
      .limit(1);
    if (!assignment || assignment.status !== "Attended")
      throw new Error("Attendance must be confirmed before completion.");
    if (actor.employeeId === assignment.employeeId)
      throw new Error("You cannot complete your own training record.");
    const [course] = await tx
      .select()
      .from(trainingCourses)
      .where(eq(trainingCourses.id, assignment.courseId))
      .limit(1);
    const [session] = assignment.sessionId
      ? await tx
          .select()
          .from(trainingSessions)
          .where(eq(trainingSessions.id, assignment.sessionId))
          .limit(1)
      : [];
    if (!course) throw new Error("Training course not found.");
    if (session && completionDate < session.endAt.slice(0, 10))
      throw new Error("Completion cannot be before the session ended.");
    const [existingRecord] = await tx
      .select({ id: trainingRecords.id })
      .from(trainingRecords)
      .where(eq(trainingRecords.assignmentId, assignmentId))
      .limit(1);
    if (existingRecord) throw new Error("This assignment already has a completion record.");
    recordId = randomUUID();
    await tx.insert(trainingRecords).values({
      id: recordId,
      organisationId: org,
      employeeId: assignment.employeeId,
      courseId: course.id,
      assignmentId,
      title: course.title,
      provider: course.provider,
      completionDate,
      expiryDate:
        course.validityMonths || course.renewalIntervalMonths
          ? addMonths(completionDate, course.validityMonths ?? course.renewalIntervalMonths!)
          : null,
      hrVerified: false,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    } as typeof trainingRecords.$inferInsert);
    await tx
      .update(trainingAssignments)
      .set({
        status: "Completed",
        completionDate,
        result: result.trim(),
        actualCost: String(actualCost),
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${trainingAssignments.recordVersion} + 1`,
      })
      .where(eq(trainingAssignments.id, assignmentId));
    await notifyEmployee(
      tx,
      org,
      assignment.employeeId,
      "Training completed",
      `${course.title} has been added to your training record.`,
      recordId,
      `training-completed-${assignmentId}`,
      actor,
    );
    await audit(
      tx,
      org,
      actor,
      "complete",
      "training-assignment",
      assignmentId,
      result.trim(),
      { status: assignment.status },
      { status: "Completed", recordId, actualCost },
    );
  });
  return recordId;
}

export interface TrainingRecordInput {
  employeeId: string;
  title: string;
  provider: string;
  completionDate: string;
  expiryDate?: string;
  certificateFileId?: string;
  recordId?: string;
}

export async function addTrainingRecordInDatabase(
  org: string,
  input: TrainingRecordInput,
  actor: AuditActorContext,
) {
  const self = actor.employeeId === input.employeeId;
  if (!self && !isHr(actor))
    throw new Error("You can add training only for yourself or while acting as HR.");
  if (
    input.title.trim().length < 2 ||
    input.provider.trim().length < 2 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.completionDate) ||
    input.completionDate > new Date().toISOString().slice(0, 10) ||
    (input.expiryDate && input.expiryDate < input.completionDate)
  )
    throw new Error("Check the training title, provider and completion dates.");
  const db = getDatabaseClient();
  const id = input.recordId ?? randomUUID();
  await db.transaction(async (tx) => {
    const [employee] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(
        and(
          eq(employees.organisationId, org),
          eq(employees.id, input.employeeId),
          isNull(employees.archivedAt),
        ),
      )
      .limit(1);
    if (!employee) throw new Error("Employee not found.");
    if (input.certificateFileId) {
      const [file] = await tx
        .select()
        .from(fileMetadata)
        .where(
          and(
            eq(fileMetadata.organisationId, org),
            eq(fileMetadata.id, input.certificateFileId),
            eq(fileMetadata.storageStatus, "Available"),
          ),
        )
        .limit(1);
      if (!file || file.ownerEntityType !== "training-record" || file.ownerEntityId !== id)
        throw new Error("The certificate does not belong to this training record.");
    }
    await tx.insert(trainingRecords).values({
      id,
      organisationId: org,
      employeeId: input.employeeId,
      title: input.title.trim(),
      provider: input.provider.trim(),
      completionDate: input.completionDate,
      expiryDate: input.expiryDate ?? null,
      certificateFileId: input.certificateFileId ?? null,
      hrVerified: false,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    } as typeof trainingRecords.$inferInsert);
    await notifyHr(
      tx,
      org,
      "Training certificate awaiting verification",
      `${input.title.trim()} has been submitted for verification.`,
      id,
      `training-certificate-review-${id}`,
      actor,
    );
    await audit(
      tx,
      org,
      actor,
      "create",
      "training-record",
      id,
      "Added completed training",
      undefined,
      {
        employeeId: input.employeeId,
        title: input.title.trim(),
        hasCertificate: Boolean(input.certificateFileId),
      },
    );
  });
  return id;
}

export async function decideTrainingRecordInDatabase(
  org: string,
  recordId: string,
  decision: "Verify" | "Reject",
  reason: string,
  actor: AuditActorContext,
) {
  requireHr(actor);
  if (reason.trim().length < 5) throw new Error("Record a reason for this decision.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [record] = await tx
      .select()
      .from(trainingRecords)
      .where(and(eq(trainingRecords.organisationId, org), eq(trainingRecords.id, recordId)))
      .for("update")
      .limit(1);
    if (!record) throw new Error("Training record not found.");
    if (actor.employeeId === record.employeeId)
      throw new Error("You cannot verify your own certificate.");
    if (decision === "Verify" && !record.certificateFileId)
      throw new Error("A certificate is required before verification.");
    if (decision === "Verify" && record.certificateFileId) {
      const [file] = await tx
        .select()
        .from(fileMetadata)
        .where(
          and(
            eq(fileMetadata.organisationId, org),
            eq(fileMetadata.id, record.certificateFileId),
            eq(fileMetadata.storageStatus, "Available"),
          ),
        )
        .limit(1);
      if (!file || file.ownerEntityType !== "training-record" || file.ownerEntityId !== recordId)
        throw new Error("The linked certificate could not be verified.");
    }
    const now = new Date().toISOString();
    await tx
      .update(trainingRecords)
      .set(
        decision === "Verify"
          ? {
              hrVerified: true,
              verifiedAt: now,
              verifiedBy: actor.userId,
              verificationComment: reason.trim(),
              rejectedAt: null,
              rejectedBy: null,
              rejectionReason: null,
              updatedAt: new Date(),
              updatedBy: actor.userId,
              recordVersion: sql`${trainingRecords.recordVersion} + 1`,
            }
          : {
              hrVerified: false,
              verifiedAt: null,
              verifiedBy: null,
              verificationComment: null,
              rejectedAt: now,
              rejectedBy: actor.userId,
              rejectionReason: reason.trim(),
              updatedAt: new Date(),
              updatedBy: actor.userId,
              recordVersion: sql`${trainingRecords.recordVersion} + 1`,
            },
      )
      .where(eq(trainingRecords.id, recordId));
    await notifyEmployee(
      tx,
      org,
      record.employeeId,
      decision === "Verify"
        ? "Training certificate verified"
        : "Training certificate needs attention",
      decision === "Verify" ? `${record.title} has been verified by HR.` : reason.trim(),
      recordId,
      `training-record-${recordId}-${decision}`,
      actor,
    );
    await audit(
      tx,
      org,
      actor,
      decision.toLowerCase(),
      "training-record",
      recordId,
      reason.trim(),
      { verified: record.hrVerified },
      { verified: decision === "Verify" },
    );
  });
}

export async function readTrainingCertificateInDatabase(
  org: string,
  recordId: string,
  actor: AuditActorContext,
) {
  const db = getDatabaseClient();
  const [record] = await db
    .select()
    .from(trainingRecords)
    .where(
      and(
        eq(trainingRecords.organisationId, org),
        eq(trainingRecords.id, recordId),
        isNull(trainingRecords.archivedAt),
      ),
    )
    .limit(1);
  if (!record?.certificateFileId) throw new Error("No certificate is attached to this record.");
  const scoped = await scopedEmployees(org, actor);
  if (scoped && !scoped.includes(record.employeeId))
    throw new Error("You are not authorised to view this certificate.");
  return readObjectFile(
    org,
    record.certificateFileId,
    {
      ...(actor.userId ? { userId: actor.userId } : {}),
      ...(actor.employeeId ? { employeeId: actor.employeeId } : {}),
      displayName: actor.displayName,
      activeRole: activeRole(actor),
      ...(actor.roles ? { roles: actor.roles } : {}),
    },
    `Viewed training certificate ${recordId}`,
  );
}

export async function processTrainingAutomationInDatabase(
  org: string,
  actor: AuditActorContext,
  today = new Date().toISOString().slice(0, 10),
) {
  const db = getDatabaseClient();
  let assignmentsCreated = 0;
  let remindersCreated = 0;
  await db.transaction(async (tx) => {
    const courses = await tx
      .select()
      .from(trainingCourses)
      .where(
        and(
          eq(trainingCourses.organisationId, org),
          eq(trainingCourses.isMandatory, true),
          eq(trainingCourses.isActive, true),
          isNull(trainingCourses.archivedAt),
        ),
      );
    const employeeRows = await tx
      .select()
      .from(employees)
      .where(
        and(
          eq(employees.organisationId, org),
          inArray(employees.status, ["Active", "Probation", "Onboarding"]),
          isNull(employees.archivedAt),
        ),
      );
    const roleRows = await tx
      .select({ employeeId: users.employeeId, code: roles.code })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(users.organisationId, org), eq(users.status, "Active")));
    const rolesByEmployee = new Map<string, Set<string>>();
    for (const row of roleRows) {
      const values = rolesByEmployee.get(row.employeeId) ?? new Set<string>();
      values.add(row.code);
      rolesByEmployee.set(row.employeeId, values);
    }
    for (const course of courses)
      for (const employee of employeeRows) {
        if (
          course.requiredLocations.length &&
          !course.requiredLocations.includes(employee.locationId)
        )
          continue;
        if (
          course.requiredProjects.length &&
          (!employee.projectId || !course.requiredProjects.includes(employee.projectId))
        )
          continue;
        if (
          course.requiredRoles.length &&
          !course.requiredRoles.some((value) => rolesByEmployee.get(employee.id)?.has(value))
        )
          continue;
        const [valid] = await tx
          .select({ id: trainingRecords.id })
          .from(trainingRecords)
          .where(
            and(
              eq(trainingRecords.employeeId, employee.id),
              eq(trainingRecords.courseId, course.id),
              isNull(trainingRecords.archivedAt),
              sql`(${trainingRecords.expiryDate} IS NULL OR ${trainingRecords.expiryDate} >= ${today})`,
            ),
          )
          .limit(1);
        const [open] = await tx
          .select({ id: trainingAssignments.id })
          .from(trainingAssignments)
          .where(
            and(
              eq(trainingAssignments.employeeId, employee.id),
              eq(trainingAssignments.courseId, course.id),
              isNull(trainingAssignments.archivedAt),
              inArray(trainingAssignments.status, ["Assigned", "Scheduled", "Attended"]),
            ),
          )
          .limit(1);
        if (valid || open) continue;
        const requestId = randomUUID();
        await tx.insert(trainingRequests).values({
          id: requestId,
          organisationId: org,
          employeeId: employee.id,
          courseId: course.id,
          origin: "HR Assignment",
          reason: "Mandatory training assigned automatically",
          status: "Approved",
          hrDecisionAt: new Date().toISOString(),
          hrDecisionBy: actor.userId,
          hrComment: "Mandatory training assignment",
          createdBy: actor.userId,
          updatedBy: actor.userId,
        } as typeof trainingRequests.$inferInsert);
        await createAssignment(
          tx,
          org,
          {
            id: requestId,
            organisationId: org,
            employeeId: employee.id,
            courseId: course.id,
          } as typeof trainingRequests.$inferSelect,
          actor,
        );
        await notifyEmployee(
          tx,
          org,
          employee.id,
          "Mandatory training assigned",
          `${course.title} has been added to your training plan.`,
          requestId,
          `mandatory-training-${course.id}-${employee.id}`,
          actor,
        );
        assignmentsCreated += 1;
      }
    const records = await tx
      .select()
      .from(trainingRecords)
      .where(
        and(
          eq(trainingRecords.organisationId, org),
          isNull(trainingRecords.archivedAt),
          sql`${trainingRecords.expiryDate} IS NOT NULL`,
        ),
      );
    const todayMs = Date.parse(`${today}T00:00:00Z`);
    for (const record of records) {
      const remaining = Math.ceil(
        (Date.parse(`${record.expiryDate}T00:00:00Z`) - todayMs) / 86_400_000,
      );
      if (remaining < 0) {
        const before = await tx
          .select({ id: notifications.id })
          .from(notifications)
          .where(
            and(
              eq(notifications.organisationId, org),
              eq(notifications.deduplicationKey, `training-expired-${record.id}`),
            ),
          )
          .limit(1);
        await notifyEmployee(
          tx,
          org,
          record.employeeId,
          "Training certification expired",
          `${record.title} expired ${Math.abs(remaining)} day${Math.abs(remaining) === 1 ? "" : "s"} ago.`,
          record.id,
          `training-expired-${record.id}`,
          actor,
        );
        if (!before.length) remindersCreated += 1;
        continue;
      }
      for (const threshold of [60, 30, 14, 7, 0])
        if (remaining <= threshold) {
          const before = await tx
            .select({ id: notifications.id })
            .from(notifications)
            .where(
              and(
                eq(notifications.organisationId, org),
                eq(notifications.deduplicationKey, `training-expiry-${record.id}-${threshold}`),
              ),
            )
            .limit(1);
          await notifyEmployee(
            tx,
            org,
            record.employeeId,
            remaining <= 0
              ? "Training certification expires today"
              : "Training certification expiring",
            `${record.title} expires in ${remaining} day${remaining === 1 ? "" : "s"}.`,
            record.id,
            `training-expiry-${record.id}-${threshold}`,
            actor,
          );
          if (!before.length) remindersCreated += 1;
        }
    }
    await audit(
      tx,
      org,
      actor,
      "process",
      "training-automation",
      org,
      "Processed mandatory training and certification reminders",
      undefined,
      { assignmentsCreated, remindersCreated, today },
    );
  });
  return { assignmentsCreated, remindersCreated };
}

export async function processTrainingWorker(today = new Date().toISOString().slice(0, 10)) {
  const db = getDatabaseClient();
  const organisationRows = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(eq(organisations.isActive, true));
  let organisationsProcessed = 0;
  let assignmentsCreated = 0;
  let remindersCreated = 0;
  for (const organisation of organisationRows) {
    const [workerUser] = await db
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
          eq(users.organisationId, organisation.id),
          eq(users.status, "Active"),
          inArray(roles.code, ["Super Admin", "HR"]),
        ),
      )
      .orderBy(sql`CASE WHEN ${roles.code} = 'Super Admin' THEN 0 ELSE 1 END`)
      .limit(1);
    if (!workerUser) continue;
    const result = await processTrainingAutomationInDatabase(
      organisation.id,
      {
        userId: workerUser.userId,
        employeeId: workerUser.employeeId,
        displayName: "VIA training automation",
        activeRole: workerUser.role,
        roles: ["Employee", workerUser.role],
      },
      today,
    );
    organisationsProcessed += 1;
    assignmentsCreated += result.assignmentsCreated;
    remindersCreated += result.remindersCreated;
  }
  return { organisationsProcessed, assignmentsCreated, remindersCreated };
}
