import { randomUUID } from "node:crypto";

import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import { ROLE_VALUES } from "../data/types.ts";
import { deleteObjectFile, saveObjectFile } from "../db/object-storage.server.ts";
import {
  addTrainingRecordInDatabase,
  archiveTrainingCourseInDatabase,
  cancelTrainingAssignmentInDatabase,
  cancelTrainingSessionInDatabase,
  completeTrainingAssignmentInDatabase,
  createTrainingRequestInDatabase,
  decideTrainingRecordInDatabase,
  decideTrainingRequestInDatabase,
  listTrainingForActor,
  readTrainingCertificateInDatabase,
  recordTrainingAttendanceInDatabase,
  saveTrainingCourseInDatabase,
  saveTrainingSessionInDatabase,
  scheduleTrainingAssignmentInDatabase,
  withdrawTrainingRequestInDatabase,
} from "../db/repositories/training.repository.server.ts";
import { resolveOrganisationIdForActor, verifyServerActorRole } from "../db/utils.server.ts";

const Actor = z.object({
  actorId: z.string().min(1),
  actorEmail: z.string().email().optional(),
  activeRole: z.enum(ROLE_VALUES),
});
async function verify(actor: z.infer<typeof Actor>) {
  const organisationId = await resolveOrganisationIdForActor(actor.actorId, actor.actorEmail);
  const result = await verifyServerActorRole(
    organisationId,
    actor.actorId,
    undefined,
    actor.actorEmail,
  );
  if (!result.verified || !result.actor?.roles.includes(actor.activeRole))
    throw new Error("Your VIA access could not be verified.");
  return { organisationId, actor: { ...result.actor, activeRole: actor.activeRole } };
}
const Course = z
  .object({
    courseId: z.string().uuid().optional(),
    expectedVersion: z.number().int().positive().optional(),
    code: z.string().trim().min(2).max(50),
    title: z.string().trim().min(3).max(300),
    description: z.string().trim().min(10).max(4000),
    provider: z.string().trim().min(2).max(300),
    category: z.string().trim().min(2).max(200),
    deliveryType: z.enum(["Classroom", "Virtual", "Blended", "Self-paced"]),
    durationHours: z.number().positive().max(10_000),
    cost: z.number().nonnegative().max(1_000_000_000),
    currency: z.string().regex(/^[A-Z]{3}$/),
    validityMonths: z.number().int().positive().max(1_200).optional(),
    renewalIntervalMonths: z.number().int().positive().max(1_200).optional(),
    requiredRoles: z.array(z.enum(ROLE_VALUES)).max(ROLE_VALUES.length),
    requiredLocations: z.array(z.string().uuid()).max(1_000),
    requiredProjects: z.array(z.string().uuid()).max(1_000),
    isMandatory: z.boolean(),
    isActive: z.boolean(),
  })
  .strict();
const Certificate = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
    bytes: z
      .array(z.number().int().min(0).max(255))
      .min(1)
      .max(10 * 1024 * 1024),
  })
  .strict();
function certificateBytes(file: z.infer<typeof Certificate>) {
  const bytes = Uint8Array.from(file.bytes);
  const valid =
    (file.mimeType === "application/pdf" &&
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46) ||
    (file.mimeType === "image/jpeg" &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff) ||
    (file.mimeType === "image/png" &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47);
  if (!valid) throw new Error("The uploaded content does not match its file type.");
  return bytes;
}

export const getTrainingSnapshotFn = createServerFn({ method: "GET" })
  .validator((input) => z.object({ actor: Actor }).strict().parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return listTrainingForActor(v.organisationId, v.actor);
  });

export const saveTrainingCourseFn = createServerFn({ method: "POST" })
  .validator((input) => z.object({ actor: Actor, course: Course }).strict().parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    const course = data.course;
    return saveTrainingCourseInDatabase(
      v.organisationId,
      {
        code: course.code,
        title: course.title,
        description: course.description,
        provider: course.provider,
        category: course.category,
        deliveryType: course.deliveryType,
        durationHours: course.durationHours,
        cost: course.cost,
        currency: course.currency,
        requiredRoles: course.requiredRoles,
        requiredLocations: course.requiredLocations,
        requiredProjects: course.requiredProjects,
        isMandatory: course.isMandatory,
        isActive: course.isActive,
        ...(course.courseId ? { courseId: course.courseId } : {}),
        ...(course.expectedVersion ? { expectedVersion: course.expectedVersion } : {}),
        ...(course.validityMonths ? { validityMonths: course.validityMonths } : {}),
        ...(course.renewalIntervalMonths
          ? { renewalIntervalMonths: course.renewalIntervalMonths }
          : {}),
      },
      v.actor,
    );
  });

export const archiveTrainingCourseFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        courseId: z.string().uuid(),
        archive: z.boolean(),
        reason: z.string().trim().min(5).max(2000),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return archiveTrainingCourseInDatabase(
      v.organisationId,
      data.courseId,
      data.archive,
      data.reason,
      v.actor,
    );
  });

export const createTrainingRequestFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        employeeId: z.string().uuid(),
        courseId: z.string().uuid(),
        reason: z.string().trim().min(5).max(2000),
        origin: z.enum(["Employee Request", "Supervisor Assignment", "HR Assignment"]),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return createTrainingRequestInDatabase(v.organisationId, data, v.actor);
  });

export const decideTrainingRequestFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        requestId: z.string().uuid(),
        stage: z.enum(["Supervisor", "HR"]),
        decision: z.enum(["Approve", "Reject"]),
        comment: z.string().trim().min(5).max(2000),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return decideTrainingRequestInDatabase(
      v.organisationId,
      data.requestId,
      data.stage,
      data.decision,
      data.comment,
      v.actor,
    );
  });

export const withdrawTrainingRequestFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        requestId: z.string().uuid(),
        reason: z.string().trim().min(5).max(2000),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return withdrawTrainingRequestInDatabase(
      v.organisationId,
      data.requestId,
      data.reason,
      v.actor,
    );
  });

export const saveTrainingSessionFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        session: z
          .object({
            sessionId: z.string().uuid().optional(),
            expectedVersion: z.number().int().positive().optional(),
            courseId: z.string().uuid(),
            title: z.string().trim().min(3).max(300),
            startAt: z.string().datetime(),
            endAt: z.string().datetime(),
            location: z.string().trim().min(2).max(500),
            facilitator: z.string().trim().min(2).max(300),
            capacity: z.number().int().positive().max(100_000),
          })
          .strict(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    const session = data.session;
    return saveTrainingSessionInDatabase(
      v.organisationId,
      {
        courseId: session.courseId,
        title: session.title,
        startAt: session.startAt,
        endAt: session.endAt,
        location: session.location,
        facilitator: session.facilitator,
        capacity: session.capacity,
        ...(session.sessionId ? { sessionId: session.sessionId } : {}),
        ...(session.expectedVersion ? { expectedVersion: session.expectedVersion } : {}),
      },
      v.actor,
    );
  });

export const cancelTrainingSessionFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        sessionId: z.string().uuid(),
        reason: z.string().trim().min(5).max(2000),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return cancelTrainingSessionInDatabase(v.organisationId, data.sessionId, data.reason, v.actor);
  });

export const scheduleTrainingAssignmentFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({ actor: Actor, assignmentId: z.string().uuid(), sessionId: z.string().uuid() })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return scheduleTrainingAssignmentInDatabase(
      v.organisationId,
      data.assignmentId,
      data.sessionId,
      v.actor,
    );
  });

export const recordTrainingAttendanceFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        assignmentId: z.string().uuid(),
        attended: z.boolean(),
        reason: z.string().max(2000),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return recordTrainingAttendanceInDatabase(
      v.organisationId,
      data.assignmentId,
      data.attended,
      data.reason,
      v.actor,
    );
  });

export const cancelTrainingAssignmentFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        assignmentId: z.string().uuid(),
        reason: z.string().trim().min(5).max(2000),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return cancelTrainingAssignmentInDatabase(
      v.organisationId,
      data.assignmentId,
      data.reason,
      v.actor,
    );
  });

export const completeTrainingAssignmentFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        assignmentId: z.string().uuid(),
        result: z.string().trim().min(2).max(2000),
        completionDate: z.string().date(),
        actualCost: z.number().nonnegative().max(1_000_000_000),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return completeTrainingAssignmentInDatabase(
      v.organisationId,
      data.assignmentId,
      data.result,
      data.completionDate,
      data.actualCost,
      v.actor,
    );
  });

export const addTrainingRecordFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        employeeId: z.string().uuid(),
        title: z.string().trim().min(2).max(300),
        provider: z.string().trim().min(2).max(300),
        completionDate: z.string().date(),
        expiryDate: z.string().date().optional(),
        certificate: Certificate.optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    const recordId = randomUUID();
    let certificateFileId: string | undefined;
    try {
      if (data.certificate) {
        const saved = await saveObjectFile({
          organisationId: v.organisationId,
          bytes: certificateBytes(data.certificate),
          name: data.certificate.fileName,
          mimeType: data.certificate.mimeType,
          owner: { entityType: "training-record", entityId: recordId },
          actor: v.actor,
        });
        certificateFileId = saved.id;
      }
      return await addTrainingRecordInDatabase(
        v.organisationId,
        {
          recordId,
          employeeId: data.employeeId,
          title: data.title,
          provider: data.provider,
          completionDate: data.completionDate,
          ...(data.expiryDate ? { expiryDate: data.expiryDate } : {}),
          ...(certificateFileId ? { certificateFileId } : {}),
        },
        v.actor,
      );
    } catch (error) {
      if (certificateFileId)
        await deleteObjectFile(
          v.organisationId,
          certificateFileId,
          v.actor,
          "Training record creation failed",
        ).catch(() => undefined);
      throw error;
    }
  });

export const decideTrainingRecordFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        recordId: z.string().uuid(),
        decision: z.enum(["Verify", "Reject"]),
        reason: z.string().trim().min(5).max(2000),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return decideTrainingRecordInDatabase(
      v.organisationId,
      data.recordId,
      data.decision,
      data.reason,
      v.actor,
    );
  });

export const readTrainingCertificateFn = createServerFn({ method: "GET" })
  .validator((input) =>
    z.object({ actor: Actor, recordId: z.string().uuid() }).strict().parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    const result = await readTrainingCertificateInDatabase(
      v.organisationId,
      data.recordId,
      v.actor,
    );
    return { ...result, bytes: Array.from(result.bytes) };
  });
