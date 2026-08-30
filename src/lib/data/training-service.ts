import { getApplicationDataServices } from "./application-data.ts";
import { DocumentService } from "./document-service.ts";
import { EmployeeService } from "./employee-service.ts";
import { LocalRepository } from "./repository.ts";
import type {
  TrainingCourse,
  TrainingEnrollment,
  TrainingRecord,
  TrainingRequest,
  TrainingSession,
} from "./training-types.ts";
import { SYSTEM_CONTEXT, type ActorContext, type Employee, type User } from "./types.ts";

export class TrainingService {
  private recordRepo: LocalRepository<TrainingRecord>;
  private courseRepo: LocalRepository<TrainingCourse>;
  private requestRepo: LocalRepository<TrainingRequest>;
  private sessionRepo: LocalRepository<TrainingSession>;
  private enrollmentRepo: LocalRepository<TrainingEnrollment>;
  private documentService = new DocumentService();
  private employeeService = new EmployeeService();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
    const { storage, audit } = getApplicationDataServices();
    this.recordRepo = new LocalRepository<TrainingRecord>("training_records", storage, audit, {
      module: "training",
      entityType: "training-record",
    });
    this.courseRepo = new LocalRepository<TrainingCourse>("training_courses", storage, audit, {
      module: "training",
      entityType: "training-course",
    });
    this.requestRepo = new LocalRepository<TrainingRequest>("training_requests", storage, audit, {
      module: "training",
      entityType: "training-request",
    });
    this.sessionRepo = new LocalRepository<TrainingSession>("training_sessions", storage, audit, {
      module: "training",
      entityType: "training-session",
    });
    this.enrollmentRepo = new LocalRepository<TrainingEnrollment>(
      "training_enrollments",
      storage,
      audit,
      { module: "training", entityType: "training-enrollment" },
    );
  }

  getCourses(context: ActorContext, options: { includeInactive?: boolean } = {}): TrainingCourse[] {
    this.requireTrainingAccess(context, "view the training catalogue", "catalogue");
    const courses = this.courseRepo.list({ includeArchived: this.isHr(context) });
    return this.isHr(context) && options.includeInactive
      ? courses
      : courses.filter((course) => course.isActive && !course.archivedAt);
  }

  saveCourse(
    input: Omit<
      TrainingCourse,
      "id" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy" | "recordVersion" | "archivedAt"
    > & { id?: string },
    context: ActorContext,
  ): TrainingCourse {
    this.requireHr(context, "manage the training catalogue", input.id ?? "new-course");
    const cleaned = this.validateCourse(input);
    const duplicate = this.courseRepo
      .list({ includeArchived: true })
      .find(
        (course) =>
          course.id !== input.id &&
          (course.code.toLowerCase() === cleaned.code.toLowerCase() ||
            course.title.toLowerCase() === cleaned.title.toLowerCase()),
      );
    if (duplicate) throw new Error("A course with this code or title already exists.");
    return input.id
      ? this.courseRepo.update(input.id, cleaned, context)
      : this.courseRepo.create(cleaned, context);
  }

  archiveCourse(courseId: string, reason: string, context: ActorContext): TrainingCourse {
    this.requireHr(context, "archive this training course", courseId);
    if (reason.trim().length < 5) throw new Error("Explain why this course is being archived.");
    const activeEnrollments = this.enrollmentRepo
      .list()
      .filter(
        (enrollment) =>
          enrollment.courseId === courseId &&
          !["Completed", "Cancelled", "No Show"].includes(enrollment.status),
      );
    if (activeEnrollments.length > 0) {
      throw new Error("This course has active enrolments and cannot be archived yet.");
    }
    return this.courseRepo.archive(courseId, { ...context, reason: reason.trim() });
  }

  restoreCourse(courseId: string, context: ActorContext): TrainingCourse {
    this.requireHr(context, "restore this training course", courseId);
    return this.courseRepo.restore(courseId, context);
  }

  getRequests(context: ActorContext): TrainingRequest[] {
    const requests = this.requestRepo.list();
    if (this.isHr(context)) return requests;
    if (context.actor.activeRole === "Line Manager" && context.actor.employeeId) {
      const reportIds = new Set(
        this.directReports(context.actor.employeeId).map((item) => item.id),
      );
      return requests.filter((request) => reportIds.has(request.employeeId));
    }
    if (context.actor.employeeId) {
      return requests.filter((request) => request.employeeId === context.actor.employeeId);
    }
    this.deny(context, "view training requests", "all", "You cannot view training requests.");
  }

  submitRequest(courseId: string, reason: string, context: ActorContext): TrainingRequest {
    const employeeId = context.actor.employeeId;
    if (!employeeId) {
      this.deny(
        context,
        "request training",
        courseId,
        "A linked employee profile is required to request training.",
      );
    }
    if (reason.trim().length < 5) throw new Error("Explain why this training is needed.");
    const course = this.requireActiveCourse(courseId);
    this.requireNoOpenRequest(employeeId, courseId);
    const employee = this.employeeService.getById(employeeId, SYSTEM_CONTEXT);
    if (!employee) throw new Error("Employee not found.");
    const status: TrainingRequest["status"] =
      course.cost <= 0 ? "Approved" : employee.lineManagerId ? "Pending Supervisor" : "Pending HR";
    const request = this.requestRepo.create(
      {
        employeeId,
        courseId,
        origin: "Employee Request",
        reason: reason.trim(),
        status,
      },
      context,
    );
    if (status === "Approved") this.createEnrollment(request, context);
    else if (status === "Pending Supervisor" && employee.lineManagerId)
      this.notifyEmployee(
        employee.lineManagerId,
        "Training request awaiting review",
        `${employee.preferredName || employee.legalName} requested ${course.title}.`,
        "/staff/training",
        `training-supervisor-${request.id}`,
        context,
      );
    else this.notifyHr(request, course, context);
    return request;
  }

  assignCourse(
    employeeId: string,
    courseId: string,
    reason: string,
    context: ActorContext,
  ): TrainingRequest {
    if (reason.trim().length < 5) throw new Error("Explain why this training is being assigned.");
    const employee = this.employeeService.getById(employeeId, SYSTEM_CONTEXT);
    if (!employee || ["Inactive", "Archived"].includes(employee.status)) {
      throw new Error("Select an active employee.");
    }
    const managerAssignment = context.actor.activeRole === "Line Manager";
    if (managerAssignment) this.requireAssignedManager(employeeId, context, "assign this training");
    else {
      this.requireHr(context, "assign training", employeeId);
      this.requireNotSelf(employeeId, context, "approve your own training assignment", employeeId);
    }
    const course = this.requireActiveCourse(courseId);
    this.requireNoOpenRequest(employeeId, courseId);
    const status: TrainingRequest["status"] =
      managerAssignment && course.cost > 0 ? "Pending HR" : "Approved";
    const request = this.requestRepo.create(
      {
        employeeId,
        courseId,
        origin: managerAssignment ? "Supervisor Assignment" : "HR Assignment",
        reason: reason.trim(),
        status,
        ...(managerAssignment
          ? {
              supervisorDecisionAt: this.now().toISOString(),
              supervisorDecisionBy: context.actor.userId,
              supervisorComment: reason.trim(),
            }
          : {
              hrDecisionAt: this.now().toISOString(),
              hrDecisionBy: context.actor.userId,
              hrComment: reason.trim(),
            }),
      },
      context,
    );
    if (status === "Approved") this.createEnrollment(request, context);
    else this.notifyHr(request, course, context);
    this.notifyEmployee(
      employeeId,
      status === "Approved" ? "Training assigned" : "Training assignment awaiting HR approval",
      `${course.title} has been assigned to you.`,
      "/staff/me/training",
      `training-assignment-${request.id}-${status}`,
      context,
    );
    return request;
  }

  decideSupervisor(
    requestId: string,
    decision: "Approve" | "Reject",
    comment: string,
    context: ActorContext,
  ): TrainingRequest {
    const request = this.requireRequest(requestId);
    this.requireAssignedManager(request.employeeId, context, "review this training request");
    if (request.status !== "Pending Supervisor") {
      throw new Error("This request is not awaiting supervisor review.");
    }
    if (comment.trim().length < 5) throw new Error("Record a reason for this decision.");
    const updated = this.requestRepo.update(
      request.id,
      decision === "Approve"
        ? {
            status: "Pending HR",
            supervisorDecisionAt: this.now().toISOString(),
            supervisorDecisionBy: context.actor.userId,
            supervisorComment: comment.trim(),
          }
        : {
            status: "Rejected",
            supervisorDecisionAt: this.now().toISOString(),
            supervisorDecisionBy: context.actor.userId,
            supervisorComment: comment.trim(),
            rejectionReason: comment.trim(),
          },
      { ...context, reason: comment.trim() },
    );
    const course = this.requireCourse(request.courseId);
    if (decision === "Approve") this.notifyHr(updated, course, context);
    this.notifyEmployee(
      request.employeeId,
      decision === "Approve" ? "Training request sent to HR" : "Training request declined",
      decision === "Approve"
        ? `${course.title} has been supported by your supervisor and is awaiting HR approval.`
        : `${course.title} was declined: ${comment.trim()}`,
      "/staff/me/training",
      `training-supervisor-decision-${request.id}-${decision}`,
      context,
    );
    return updated;
  }

  decideHr(
    requestId: string,
    decision: "Approve" | "Reject",
    comment: string,
    context: ActorContext,
  ): TrainingRequest {
    this.requireHr(context, "decide this training request", requestId);
    const request = this.requireRequest(requestId);
    this.requireNotSelf(
      request.employeeId,
      context,
      "approve your own training request",
      request.id,
    );
    if (request.status !== "Pending HR") throw new Error("This request is not awaiting HR review.");
    if (comment.trim().length < 5) throw new Error("Record a reason for this decision.");
    const updated = this.requestRepo.update(
      request.id,
      decision === "Approve"
        ? {
            status: "Approved",
            hrDecisionAt: this.now().toISOString(),
            hrDecisionBy: context.actor.userId,
            hrComment: comment.trim(),
          }
        : {
            status: "Rejected",
            hrDecisionAt: this.now().toISOString(),
            hrDecisionBy: context.actor.userId,
            hrComment: comment.trim(),
            rejectionReason: comment.trim(),
          },
      { ...context, reason: comment.trim() },
    );
    if (decision === "Approve") this.createEnrollment(updated, context);
    const course = this.requireCourse(request.courseId);
    this.notifyEmployee(
      request.employeeId,
      decision === "Approve" ? "Training approved" : "Training request declined",
      decision === "Approve"
        ? `${course.title} has been approved and added to your training plan.`
        : `${course.title} was declined: ${comment.trim()}`,
      "/staff/me/training",
      `training-hr-decision-${request.id}-${decision}`,
      context,
    );
    return updated;
  }

  withdrawRequest(requestId: string, reason: string, context: ActorContext): TrainingRequest {
    const request = this.requireRequest(requestId);
    if (
      context.actor.activeRole !== "Employee" ||
      context.actor.employeeId !== request.employeeId ||
      !["Pending Supervisor", "Pending HR"].includes(request.status)
    ) {
      this.deny(
        context,
        "withdraw this training request",
        requestId,
        "Only the employee can withdraw their pending request.",
      );
    }
    if (reason.trim().length < 5) throw new Error("Explain why the request is being withdrawn.");
    const updated = this.requestRepo.update(
      request.id,
      { status: "Withdrawn", rejectionReason: reason.trim() },
      { ...context, reason: reason.trim() },
    );
    const employee = this.employeeService.getById(request.employeeId, SYSTEM_CONTEXT);
    if (request.status === "Pending Supervisor" && employee?.lineManagerId) {
      this.notifyEmployee(
        employee.lineManagerId,
        "Training request withdrawn",
        `${this.employeeName(request.employeeId)} withdrew their request for ${this.requireCourse(request.courseId).title}.`,
        "/staff/training",
        `training-withdrawn-manager-${request.id}`,
        context,
      );
    }
    return updated;
  }

  getSessions(context: ActorContext): TrainingSession[] {
    this.requireTrainingAccess(context, "view training sessions", "sessions");
    return this.sessionRepo.list();
  }

  saveSession(
    input: Omit<
      TrainingSession,
      "id" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy" | "recordVersion" | "archivedAt"
    > & { id?: string },
    context: ActorContext,
  ): TrainingSession {
    this.requireHr(context, "manage training sessions", input.id ?? "new-session");
    this.requireActiveCourse(input.courseId);
    if (input.title.trim().length < 3) throw new Error("Enter a session title.");
    if (input.location.trim().length < 2)
      throw new Error("Enter the session location or meeting link.");
    if (input.facilitator.trim().length < 2) throw new Error("Enter the session facilitator.");
    const start = new Date(input.startAt);
    const end = new Date(input.endAt);
    if (
      !input.startAt ||
      !input.endAt ||
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end <= start
    ) {
      throw new Error("The session end must be after its start.");
    }
    if (input.capacity < 1 || !Number.isInteger(input.capacity)) {
      throw new Error("Session capacity must be a whole number greater than zero.");
    }
    const existing = input.id ? this.sessionRepo.getById(input.id) : null;
    if (input.id && !existing) throw new Error("Training session not found.");
    if (existing && existing.status !== "Scheduled")
      throw new Error("Only a scheduled session can be edited.");
    const cleaned = {
      ...input,
      title: input.title.trim(),
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      location: input.location.trim(),
      facilitator: input.facilitator.trim(),
      status: "Scheduled" as const,
    };
    return input.id
      ? this.sessionRepo.update(input.id, cleaned, context)
      : this.sessionRepo.create(cleaned, context);
  }

  cancelSession(sessionId: string, reason: string, context: ActorContext): TrainingSession {
    this.requireHr(context, "cancel this training session", sessionId);
    const session = this.sessionRepo.getById(sessionId);
    if (!session) throw new Error("Training session not found.");
    if (session.status !== "Scheduled")
      throw new Error("Only a scheduled session can be cancelled.");
    if (reason.trim().length < 5) throw new Error("Explain why the session is being cancelled.");
    const { storage } = getApplicationDataServices();
    const snapshot = storage.createRawSnapshot();
    try {
      for (const enrollment of this.enrollmentRepo
        .list()
        .filter((item) => item.sessionId === session.id && item.status === "Scheduled")) {
        this.enrollmentRepo.update(
          enrollment.id,
          { status: "Assigned", sessionId: undefined },
          { ...context, reason: reason.trim() },
        );
        this.notifyEmployee(
          enrollment.employeeId,
          "Training session cancelled",
          `${session.title} was cancelled. HR will arrange a new date.`,
          "/staff/me/training",
          `training-session-cancelled-${session.id}-${enrollment.employeeId}`,
          context,
        );
      }
      return this.sessionRepo.update(
        session.id,
        { status: "Cancelled" },
        { ...context, reason: reason.trim() },
      );
    } catch (error) {
      storage.restoreRawSnapshot(snapshot);
      throw error;
    }
  }

  getEnrollments(context: ActorContext): TrainingEnrollment[] {
    const enrollments = this.enrollmentRepo.list();
    if (this.isHr(context)) return enrollments;
    if (context.actor.activeRole === "Line Manager" && context.actor.employeeId) {
      const reportIds = new Set(
        this.directReports(context.actor.employeeId).map((item) => item.id),
      );
      return enrollments.filter((enrollment) => reportIds.has(enrollment.employeeId));
    }
    if (context.actor.employeeId) {
      return enrollments.filter((enrollment) => enrollment.employeeId === context.actor.employeeId);
    }
    this.deny(context, "view training enrolments", "all", "You cannot view training enrolments.");
  }

  scheduleEnrollment(
    enrollmentId: string,
    sessionId: string,
    context: ActorContext,
  ): TrainingEnrollment {
    this.requireHr(context, "schedule this training enrolment", enrollmentId);
    const enrollment = this.requireEnrollment(enrollmentId);
    if (!["Assigned", "Scheduled"].includes(enrollment.status)) {
      throw new Error("Only assigned training can be scheduled.");
    }
    const session = this.sessionRepo.getById(sessionId);
    if (!session || session.status !== "Scheduled" || session.courseId !== enrollment.courseId) {
      throw new Error("Select an active session for the same course.");
    }
    if (new Date(session.startAt) <= this.now())
      throw new Error("A past session cannot accept new enrolments.");
    const occupied = this.enrollmentRepo
      .list()
      .filter(
        (item) =>
          item.id !== enrollment.id && item.sessionId === sessionId && item.status !== "Cancelled",
      ).length;
    if (occupied >= session.capacity) throw new Error("This training session is full.");
    const updated = this.enrollmentRepo.update(
      enrollment.id,
      { sessionId, status: "Scheduled" },
      context,
    );
    this.notifyEmployee(
      enrollment.employeeId,
      "Training session scheduled",
      `${this.requireCourse(enrollment.courseId).title} is scheduled for ${new Date(session.startAt).toLocaleString()}.`,
      "/staff/me/training",
      `training-scheduled-${enrollment.id}-${session.id}`,
      context,
    );
    return updated;
  }

  recordAttendance(
    enrollmentId: string,
    attended: boolean,
    reason: string,
    context: ActorContext,
  ): TrainingEnrollment {
    this.requireHr(context, "record training attendance", enrollmentId);
    const enrollment = this.requireEnrollment(enrollmentId);
    this.requireNotSelf(
      enrollment.employeeId,
      context,
      "record your own training attendance",
      enrollment.id,
    );
    if (enrollment.status !== "Scheduled")
      throw new Error("Only scheduled training can be marked.");
    const session = enrollment.sessionId ? this.sessionRepo.getById(enrollment.sessionId) : null;
    if (!session) throw new Error("The linked training session could not be found.");
    if (new Date(session.startAt) > this.now())
      throw new Error("Attendance cannot be recorded before the session starts.");
    if (!attended && reason.trim().length < 5)
      throw new Error("Record the reason for the absence.");
    const updated = this.enrollmentRepo.update(
      enrollment.id,
      {
        status: attended ? "Attended" : "No Show",
        attendanceRecordedAt: this.now().toISOString(),
        attendanceRecordedBy: context.actor.userId,
        ...(!attended ? { cancellationReason: reason.trim() } : {}),
      },
      { ...context, reason: reason.trim() || "Attendance confirmed" },
    );
    if (!attended) {
      this.notifyEmployee(
        enrollment.employeeId,
        "Training attendance recorded as no show",
        `${this.requireCourse(enrollment.courseId).title} was recorded as not attended: ${reason.trim()}`,
        "/staff/me/training",
        `training-no-show-${enrollment.id}`,
        context,
      );
    }
    if (!attended) this.closeSessionIfFinished(session.id, context);
    return updated;
  }

  cancelEnrollment(
    enrollmentId: string,
    reason: string,
    context: ActorContext,
  ): TrainingEnrollment {
    this.requireHr(context, "cancel this training enrolment", enrollmentId);
    const enrollment = this.requireEnrollment(enrollmentId);
    this.requireNotSelf(
      enrollment.employeeId,
      context,
      "cancel your own training enrolment",
      enrollment.id,
    );
    if (["Completed", "Cancelled", "No Show"].includes(enrollment.status)) {
      throw new Error("This training enrolment is already closed.");
    }
    if (reason.trim().length < 5) throw new Error("Explain why the enrolment is being cancelled.");
    const updated = this.enrollmentRepo.update(
      enrollment.id,
      { status: "Cancelled", cancellationReason: reason.trim() },
      { ...context, reason: reason.trim() },
    );
    this.notifyEmployee(
      enrollment.employeeId,
      "Training cancelled",
      `${this.requireCourse(enrollment.courseId).title} was removed from your training plan: ${reason.trim()}`,
      "/staff/me/training",
      `training-enrolment-cancelled-${enrollment.id}`,
      context,
    );
    return updated;
  }

  completeEnrollment(
    enrollmentId: string,
    result: string,
    completionDate: string,
    actualCost: number,
    context: ActorContext,
  ): TrainingEnrollment {
    this.requireHr(context, "complete this training enrolment", enrollmentId);
    const enrollment = this.requireEnrollment(enrollmentId);
    this.requireNotSelf(
      enrollment.employeeId,
      context,
      "complete your own training record",
      enrollment.id,
    );
    if (enrollment.status !== "Attended") {
      throw new Error("Attendance must be confirmed before training can be completed.");
    }
    if (result.trim().length < 2) throw new Error("Record the training result.");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(completionDate) ||
      Number.isNaN(Date.parse(completionDate)) ||
      completionDate > this.now().toISOString().slice(0, 10)
    ) {
      throw new Error("Enter a valid completion date that is not in the future.");
    }
    if (!Number.isFinite(actualCost) || actualCost < 0) {
      throw new Error("Actual training cost must be zero or greater.");
    }
    const course = this.requireCourse(enrollment.courseId);
    const session = enrollment.sessionId ? this.sessionRepo.getById(enrollment.sessionId) : null;
    if (session && completionDate < session.endAt.slice(0, 10)) {
      throw new Error("The completion date cannot be before the training session ended.");
    }
    const expiryDate = course.validityMonths
      ? this.addMonths(completionDate, course.validityMonths)
      : undefined;
    const { storage } = getApplicationDataServices();
    const snapshot = storage.createRawSnapshot();
    try {
      const record = this.createRecord(
        {
          employeeId: enrollment.employeeId,
          courseId: course.id,
          enrollmentId: enrollment.id,
          title: course.title,
          provider: course.provider,
          completionDate,
          ...(expiryDate ? { expiryDate } : {}),
        },
        context,
      );
      const updated = this.enrollmentRepo.update(
        enrollment.id,
        {
          status: "Completed",
          completionDate,
          result: result.trim(),
          actualCost,
          trainingRecordId: record.id,
        },
        context,
      );
      this.notifyEmployee(
        enrollment.employeeId,
        "Training completed",
        `${course.title} has been added to your completed training record.`,
        "/staff/me/training",
        `training-completed-${enrollment.id}`,
        context,
      );
      if (session) this.closeSessionIfFinished(session.id, context);
      return updated;
    } catch (error) {
      storage.restoreRawSnapshot(snapshot);
      throw error;
    }
  }

  getRecords(context: ActorContext): TrainingRecord[] {
    this.requireHr(context, "view all training records", "all");
    return this.recordRepo.list();
  }

  getTeamRecords(context: ActorContext): TrainingRecord[] {
    if (this.isHr(context)) return this.recordRepo.list();
    if (context.actor.activeRole === "Line Manager" && context.actor.employeeId) {
      const reportIds = new Set(
        this.directReports(context.actor.employeeId).map((item) => item.id),
      );
      return this.recordRepo.list().filter((record) => reportIds.has(record.employeeId));
    }
    this.deny(
      context,
      "view team training records",
      "all",
      "Only an assigned supervisor, HR or Super Admin can view team training records.",
    );
  }

  getRecordsForEmployee(employeeId: string, context: ActorContext): TrainingRecord[] {
    this.requireRead(employeeId, context, "view training records");
    return this.recordRepo.list().filter((record) => record.employeeId === employeeId);
  }

  getRecordsForUser(employeeId: string, context: ActorContext): TrainingRecord[] {
    return this.getRecordsForEmployee(employeeId, context);
  }

  addRecord(
    data: {
      employeeId: string;
      title: string;
      provider: string;
      completionDate: string;
      expiryDate?: string;
      certificateFileId?: string;
    },
    context: ActorContext,
  ): TrainingRecord {
    this.assertCanAdd(data.employeeId, context);
    if (data.certificateFileId)
      throw new Error(
        "Certificates must be uploaded through the secure certificate upload process.",
      );
    this.validateRecord(data);
    return this.createRecord(data, context);
  }

  async addRecordWithCertificate(
    data: {
      employeeId: string;
      title: string;
      provider: string;
      completionDate: string;
      expiryDate?: string;
    },
    file: { blob: Blob; name: string },
    context: ActorContext,
  ): Promise<TrainingRecord> {
    this.assertCanAdd(data.employeeId, context);
    this.validateRecord(data);
    if (!file.name.trim() || file.blob.size === 0)
      throw new Error("Choose a valid certificate file.");
    if (file.blob.size > 10 * 1024 * 1024)
      throw new Error("The certificate must be 10 MB or smaller.");
    const permitted = new Set(["application/pdf", "image/jpeg", "image/png"]);
    if (!permitted.has(file.blob.type))
      throw new Error("Certificates must be PDF, JPG or PNG files.");

    const { files, storage } = getApplicationDataServices();
    const savedFile = await files.save(
      {
        blob: file.blob,
        name: file.name,
        owner: { entityType: "employee", entityId: data.employeeId },
      },
      context,
    );
    const snapshot = storage.createRawSnapshot();
    try {
      const record = this.createRecord({ ...data, certificateFileId: savedFile.id }, context);
      this.documentService.getDocumentRepository(SYSTEM_CONTEXT).create(
        {
          employeeId: data.employeeId,
          type: "professional_certificate",
          fileId: savedFile.id,
          issueDate: data.completionDate,
          ...(data.expiryDate ? { expiryDate: data.expiryDate } : {}),
          notes: `Certificate for training: ${data.title.trim()}`,
          visibility: "Public",
          status: "Pending Verification",
        },
        context,
      );
      return record;
    } catch (error) {
      storage.restoreRawSnapshot(snapshot);
      await files.delete(savedFile.id, {
        actor: context.actor,
        reason: "Certificate upload rolled back after the training record failed",
      });
      throw error;
    }
  }

  verifyRecord(recordId: string, context: ActorContext): TrainingRecord {
    this.requireHr(context, "verify training records", recordId);
    const record = this.recordRepo.getById(recordId);
    if (!record) throw new Error("Training record not found.");
    this.requireNotSelf(
      record.employeeId,
      context,
      "verify your own training certificate",
      record.id,
    );
    if (!record.certificateFileId)
      throw new Error("A certificate must be attached before this record can be verified.");
    const document = this.documentService
      .getDocumentRepository(SYSTEM_CONTEXT)
      .list()
      .find((item) => item.fileId === record.certificateFileId);
    if (!document) throw new Error("The linked certificate document could not be found.");
    if (document.status === "Pending Verification")
      this.documentService.verifyDocument(document.id, context);
    return this.recordRepo.update(
      recordId,
      {
        hrVerified: true,
        verifiedAt: this.now().toISOString(),
        verifiedBy: context.actor.userId,
        verificationComment: "Certificate checked against the uploaded document",
        rejectedAt: undefined,
        rejectedBy: undefined,
        rejectionReason: undefined,
      },
      { ...context, reason: "Certificate verified" },
    );
  }

  rejectRecord(recordId: string, reason: string, context: ActorContext): TrainingRecord {
    this.requireHr(context, "reject this training certificate", recordId);
    const record = this.recordRepo.getById(recordId);
    if (!record) throw new Error("Training record not found.");
    this.requireNotSelf(
      record.employeeId,
      context,
      "reject your own training certificate",
      record.id,
    );
    if (reason.trim().length < 5) throw new Error("Explain why the certificate was rejected.");
    return this.recordRepo.update(
      record.id,
      {
        hrVerified: false,
        rejectedAt: this.now().toISOString(),
        rejectedBy: context.actor.userId,
        rejectionReason: reason.trim(),
        verifiedAt: undefined,
        verifiedBy: undefined,
        verificationComment: undefined,
      },
      { ...context, reason: reason.trim() },
    );
  }

  async getCertificateFile(
    recordId: string,
    context: ActorContext,
  ): Promise<{ blob: Blob; name: string; mimeType: string }> {
    const record = this.recordRepo.getById(recordId);
    if (!record) throw new Error("Training record not found.");
    this.requireRead(record.employeeId, context, "view this certificate", record.id);
    if (!record.certificateFileId) throw new Error("No certificate is attached to this record.");
    const { files, audit } = getApplicationDataServices();
    const [metadata, blob] = await Promise.all([
      files.getMetadata(record.certificateFileId),
      files.getBlob(record.certificateFileId),
    ]);
    if (
      !metadata ||
      !blob ||
      metadata.owner.entityType !== "employee" ||
      metadata.owner.entityId !== record.employeeId
    )
      throw new Error("The certificate file could not be verified.");
    audit.record({
      context,
      action: "view",
      module: "training",
      entityType: "training-certificate",
      entityId: record.id,
      reason: "Viewed training certificate",
      after: { fileName: metadata.name },
    });
    return { blob, name: metadata.name, mimeType: metadata.mimeType };
  }

  private createRecord(
    data: {
      employeeId: string;
      courseId?: string;
      enrollmentId?: string;
      title: string;
      provider: string;
      completionDate: string;
      expiryDate?: string;
      certificateFileId?: string;
    },
    context: ActorContext,
  ): TrainingRecord {
    return this.recordRepo.create(
      {
        employeeId: data.employeeId,
        ...(data.courseId ? { courseId: data.courseId } : {}),
        ...(data.enrollmentId ? { enrollmentId: data.enrollmentId } : {}),
        title: data.title.trim(),
        provider: data.provider.trim(),
        completionDate: data.completionDate,
        ...(data.expiryDate ? { expiryDate: data.expiryDate } : {}),
        ...(data.certificateFileId ? { certificateFileId: data.certificateFileId } : {}),
        hrVerified: false,
      },
      context,
    );
  }

  private validateCourse(
    input: Omit<
      TrainingCourse,
      "id" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy" | "recordVersion" | "archivedAt"
    > & { id?: string },
  ): Omit<
    TrainingCourse,
    "id" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy" | "recordVersion" | "archivedAt"
  > {
    if (input.code.trim().length < 2) throw new Error("Enter a course code.");
    if (input.title.trim().length < 3) throw new Error("Enter a course title.");
    if (input.description.trim().length < 10) throw new Error("Describe what the course covers.");
    if (input.provider.trim().length < 2) throw new Error("Enter the training provider.");
    if (input.category.trim().length < 2) throw new Error("Enter a training category.");
    if (!Number.isFinite(input.durationHours) || input.durationHours <= 0)
      throw new Error("Duration must be greater than zero.");
    if (!Number.isFinite(input.cost) || input.cost < 0)
      throw new Error("Course cost must be zero or greater.");
    if (!/^[A-Z]{3}$/.test(input.currency.trim().toUpperCase()))
      throw new Error("Use a three-letter currency code, such as AED.");
    for (const [value, label] of [
      [input.validityMonths, "Validity"],
      [input.renewalIntervalMonths, "Renewal interval"],
    ] as const) {
      if (value !== undefined && (!Number.isInteger(value) || value <= 0))
        throw new Error(`${label} must be a whole number of months greater than zero.`);
    }
    return {
      code: input.code.trim().toUpperCase(),
      title: input.title.trim(),
      description: input.description.trim(),
      provider: input.provider.trim(),
      category: input.category.trim(),
      deliveryType: input.deliveryType,
      durationHours: input.durationHours,
      cost: input.cost,
      currency: input.currency.trim().toUpperCase(),
      ...(input.validityMonths ? { validityMonths: input.validityMonths } : {}),
      ...(input.renewalIntervalMonths
        ? { renewalIntervalMonths: input.renewalIntervalMonths }
        : {}),
      requiredRoles: [...new Set(input.requiredRoles.map((item) => item.trim()).filter(Boolean))],
      requiredLocations: [
        ...new Set(input.requiredLocations.map((item) => item.trim()).filter(Boolean)),
      ],
      requiredProjects: [
        ...new Set(input.requiredProjects.map((item) => item.trim()).filter(Boolean)),
      ],
      isMandatory: input.isMandatory,
      isActive: input.isActive,
    };
  }

  private isHr(context: ActorContext): boolean {
    return (
      context.actor.userId === "system" ||
      context.actor.activeRole === "HR" ||
      context.actor.activeRole === "Super Admin"
    );
  }

  private directReports(managerId: string): Employee[] {
    return this.employeeService
      .getEmployees(SYSTEM_CONTEXT)
      .filter(
        (employee) =>
          employee.lineManagerId === managerId &&
          employee.status !== "Inactive" &&
          employee.status !== "Archived",
      );
  }

  private requireTrainingAccess(context: ActorContext, action: string, entityId: string): void {
    if (this.isHr(context)) return;
    if (context.actor.employeeId) return;
    this.deny(context, action, entityId, "You do not have access to training information.");
  }

  private requireCourse(courseId: string): TrainingCourse {
    const course = this.courseRepo.getById(courseId);
    if (!course) throw new Error("Training course not found.");
    return course;
  }

  private requireActiveCourse(courseId: string): TrainingCourse {
    const course = this.requireCourse(courseId);
    if (!course.isActive || course.archivedAt) throw new Error("This course is not available.");
    return course;
  }

  private requireRequest(requestId: string): TrainingRequest {
    const request = this.requestRepo.getById(requestId);
    if (!request) throw new Error("Training request not found.");
    return request;
  }

  private requireEnrollment(enrollmentId: string): TrainingEnrollment {
    const enrollment = this.enrollmentRepo.getById(enrollmentId);
    if (!enrollment) throw new Error("Training enrolment not found.");
    return enrollment;
  }

  private requireNoOpenRequest(employeeId: string, courseId: string): void {
    const duplicate = this.requestRepo
      .list()
      .some(
        (request) =>
          request.employeeId === employeeId &&
          request.courseId === courseId &&
          !["Rejected", "Withdrawn"].includes(request.status),
      );
    if (duplicate) throw new Error("This course is already in the employee's training plan.");
  }

  private requireAssignedManager(employeeId: string, context: ActorContext, action: string): void {
    const employee = this.employeeService.getById(employeeId, SYSTEM_CONTEXT);
    if (
      context.actor.activeRole === "Line Manager" &&
      context.actor.employeeId &&
      context.actor.employeeId !== employeeId &&
      employee?.lineManagerId === context.actor.employeeId
    )
      return;
    this.deny(
      context,
      action,
      employeeId,
      "Only the employee's assigned supervisor can complete this action.",
    );
  }

  private requireNotSelf(
    employeeId: string,
    context: ActorContext,
    action: string,
    entityId: string,
  ): void {
    if (!context.actor.employeeId || context.actor.employeeId !== employeeId) return;
    this.deny(
      context,
      action,
      entityId,
      "Another authorised person must complete this action for your own training record.",
    );
  }

  private createEnrollment(request: TrainingRequest, context: ActorContext): TrainingEnrollment {
    const existing = this.enrollmentRepo
      .list()
      .find((enrollment) => enrollment.requestId === request.id);
    if (existing) return existing;
    return this.enrollmentRepo.create(
      {
        employeeId: request.employeeId,
        courseId: request.courseId,
        requestId: request.id,
        status: "Assigned",
        assignedBy: context.actor.userId,
        assignedAt: this.now().toISOString(),
      },
      context,
    );
  }

  private notifyHr(request: TrainingRequest, course: TrainingCourse, context: ActorContext): void {
    for (const user of getApplicationDataServices().storage.readCollection<User>("users")) {
      if (
        user.status === "Active" &&
        user.roles.some((role) => role === "HR" || role === "Super Admin")
      ) {
        this.notifyUser(
          user.id,
          "Training request awaiting HR review",
          `${this.employeeName(request.employeeId)} requested ${course.title}.`,
          "/staff/training",
          `training-hr-${request.id}-${user.id}`,
          context,
        );
      }
    }
  }

  private notifyEmployee(
    employeeId: string,
    title: string,
    message: string,
    path: string,
    key: string,
    context: ActorContext,
  ): void {
    const user = getApplicationDataServices()
      .storage.readCollection<User>("users")
      .find((item) => item.employeeId === employeeId && item.status === "Active");
    if (user) this.notifyUser(user.id, title, message, path, key, context);
  }

  private notifyUser(
    userId: string,
    title: string,
    message: string,
    path: string,
    key: string,
    context: ActorContext,
  ): void {
    getApplicationDataServices().notifications.create(
      {
        recipientUserId: userId,
        type: "Action Required",
        title,
        message,
        priority: "Normal",
        status: "Unread",
        deduplicationKey: key,
        link: { entityType: "training-request", entityId: key, path },
      },
      context,
    );
  }

  private employeeName(employeeId: string): string {
    const employee = this.employeeService.getById(employeeId, SYSTEM_CONTEXT);
    return employee?.preferredName || employee?.legalName || "An employee";
  }

  private addMonths(date: string, months: number): string {
    const result = new Date(`${date}T12:00:00`);
    const day = result.getDate();
    result.setDate(1);
    result.setMonth(result.getMonth() + months);
    const endOfMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
    result.setDate(Math.min(day, endOfMonth));
    return result.toISOString().slice(0, 10);
  }

  private closeSessionIfFinished(sessionId: string, context: ActorContext): void {
    const session = this.sessionRepo.getById(sessionId);
    if (!session || session.status !== "Scheduled") return;
    const enrolments = this.enrollmentRepo.list().filter((item) => item.sessionId === sessionId);
    if (
      enrolments.length > 0 &&
      enrolments.every((item) => ["Completed", "No Show", "Cancelled"].includes(item.status))
    ) {
      this.sessionRepo.update(
        session.id,
        { status: "Completed" },
        { ...context, reason: "All scheduled enrolments are complete" },
      );
    }
  }

  private validateRecord(data: {
    employeeId: string;
    title: string;
    provider: string;
    completionDate: string;
    expiryDate?: string;
  }): void {
    if (!this.employeeService.getById(data.employeeId, SYSTEM_CONTEXT))
      throw new Error("Employee not found.");
    if (data.title.trim().length < 2 || data.provider.trim().length < 2)
      throw new Error("Enter the training title and provider.");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(data.completionDate) ||
      Number.isNaN(Date.parse(data.completionDate))
    )
      throw new Error("Enter a valid completion date.");
    if (data.completionDate > this.now().toISOString().slice(0, 10))
      throw new Error("The completion date cannot be in the future.");
    if (
      data.expiryDate &&
      (Number.isNaN(Date.parse(data.expiryDate)) || data.expiryDate < data.completionDate)
    )
      throw new Error("The expiry date cannot be before the completion date.");
  }

  private assertCanAdd(employeeId: string, context: ActorContext): void {
    const isSelf = context.actor.employeeId === employeeId;
    const isHr = context.actor.activeRole === "HR" || context.actor.activeRole === "Super Admin";
    if (isSelf || isHr) return;
    this.deny(
      context,
      "add training for another employee",
      employeeId,
      "You can add training only for yourself, or while acting as HR or Super Admin.",
    );
  }

  private requireRead(
    employeeId: string,
    context: ActorContext,
    action: string,
    entityId = employeeId,
  ): void {
    if (context.actor.employeeId === employeeId) return;
    if (context.actor.activeRole === "HR" || context.actor.activeRole === "Super Admin") return;
    if (context.actor.activeRole === "Line Manager" && context.actor.employeeId) {
      const employee = this.employeeService.getById(employeeId, SYSTEM_CONTEXT);
      if (employee?.lineManagerId === context.actor.employeeId) return;
    }
    this.deny(
      context,
      action,
      entityId,
      "You do not have permission to view this employee's training record.",
    );
  }

  private requireHr(context: ActorContext, action: string, entityId: string): void {
    if (context.actor.activeRole === "HR" || context.actor.activeRole === "Super Admin") return;
    this.deny(
      context,
      action,
      entityId,
      "Only HR or a Super Admin can manage organisation-wide training records.",
    );
  }

  private deny(context: ActorContext, action: string, entityId: string, message: string): never {
    getApplicationDataServices().audit.record({
      context,
      action: "access-denied",
      module: "training",
      entityType: "training-record",
      entityId,
      reason: `Attempted to ${action}`,
      riskLevel: "High",
    });
    throw new Error(message);
  }
}
