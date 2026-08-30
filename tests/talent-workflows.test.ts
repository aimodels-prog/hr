import assert from "node:assert/strict";
import test from "node:test";

import { AuditService } from "../src/lib/data/audit-service.ts";
import {
  configureApplicationDataServices,
  getApplicationDataServices,
} from "../src/lib/data/application-data.ts";
import type { FileRepository, SaveFileInput } from "../src/lib/data/file-repository.ts";
import { GoalService } from "../src/lib/data/goal-service.ts";
import { NotificationService } from "../src/lib/data/notification-service.ts";
import { PerformanceService } from "../src/lib/data/performance-service.ts";
import { initializeSeedData } from "../src/lib/data/seed-service.ts";
import { MemoryStorageDriver } from "../src/lib/data/storage-driver.ts";
import { VersionedStorageService } from "../src/lib/data/storage.ts";
import { TrainingService } from "../src/lib/data/training-service.ts";
import type { ActorContext, FileMetadata } from "../src/lib/data/types.ts";

const employee: ActorContext = {
  actor: {
    userId: "user-omar",
    employeeId: "employee-omar",
    displayName: "Omar Rahman",
    activeRole: "Employee",
    roles: ["Employee"],
  },
};
const manager: ActorContext = {
  actor: {
    userId: "user-layla",
    employeeId: "employee-layla",
    displayName: "Layla Haddad",
    activeRole: "Line Manager",
    roles: ["Employee", "Line Manager"],
  },
};
const hr: ActorContext = {
  actor: {
    userId: "user-rana",
    employeeId: "employee-rana",
    displayName: "Rana Nair",
    activeRole: "HR",
    roles: ["Employee", "HR"],
  },
};
const unrelatedEmployee: ActorContext = {
  actor: {
    userId: "user-yusuf",
    employeeId: "employee-yusuf",
    displayName: "Yusuf",
    activeRole: "Employee",
    roles: ["Employee"],
  },
};

function files(): FileRepository {
  const values = new Map<string, { metadata: FileMetadata; blob: Blob }>();
  return {
    async save(input: SaveFileInput, context) {
      const id = crypto.randomUUID();
      const metadata = {
        id,
        name: input.name,
        mimeType: input.mimeType ?? input.blob.type,
        size: input.blob.size,
        owner: input.owner,
        createdAt: new Date().toISOString(),
        createdBy: context.actor.userId,
      } as FileMetadata;
      values.set(id, { metadata, blob: input.blob });
      return metadata;
    },
    async getMetadata(id) {
      return values.get(id)?.metadata ?? null;
    },
    async getBlob(id) {
      return values.get(id)?.blob ?? null;
    },
    async listByOwner(owner) {
      return [...values.values()]
        .filter(
          (item) =>
            item.metadata.owner.entityType === owner.entityType &&
            item.metadata.owner.entityId === owner.entityId,
        )
        .map((item) => item.metadata);
    },
    async updateOwner(id, owner) {
      const item = values.get(id);
      if (!item) throw new Error("File not found");
      item.metadata.owner = owner;
      return item.metadata;
    },
    async delete(id) {
      values.delete(id);
    },
    async clear() {
      values.clear();
    },
  };
}

function setup() {
  const storage = new VersionedStorageService(new MemoryStorageDriver());
  initializeSeedData(storage);
  const audit = new AuditService(storage);
  const notifications = new NotificationService(storage, audit);
  configureApplicationDataServices({ storage, audit, notifications, files: files() });
  return { audit, notifications };
}

test("objectives require self-service, 100% weighting and the assigned supervisor", async () => {
  const { audit, notifications } = setup();
  const performance = new PerformanceService();
  const template = performance.getTemplates(hr)[0]!;
  const cycle = performance.createCycle(
    {
      name: "2027 Annual Review",
      templateId: template.id,
      status: "Active",
      departments: ["Operations"],
      employmentTypes: [],
      objectiveSettingDeadline: "2027-01-31",
      selfAssessmentDeadline: "2027-02-28",
      managerReviewDeadline: "2027-03-31",
      discussionDeadline: "2027-04-30",
      requiresModeration: true,
      employeeCanSeeManagerRatings: true,
    },
    hr,
  );
  const goals = new GoalService();
  const first = goals.createGoal(
    {
      employeeId: "employee-omar",
      cycleId: cycle.id,
      title: "Improve shipment accuracy",
      description: "Reduce preventable processing errors in assigned shipments.",
      successMeasure: "Monthly shipment audit",
      targetValue: "At least 98% accuracy",
      startDate: "2026-09-01",
      dueDate: "2027-01-31",
      weight: 60,
    },
    employee,
  );
  assert.throws(
    () => goals.submitCycleGoalsForApproval("employee-omar", cycle.id, employee),
    /total 100%/i,
  );
  const second = goals.createGoal(
    {
      employeeId: "employee-omar",
      cycleId: cycle.id,
      title: "Improve customer updates",
      description: "Provide accurate milestone updates to assigned customers.",
      successMeasure: "Updates delivered on schedule",
      targetValue: "95% on-time updates",
      startDate: "2026-09-01",
      dueDate: "2027-01-31",
      weight: 40,
    },
    employee,
  );
  assert.throws(
    () =>
      goals.createGoal(
        {
          employeeId: "employee-rana",
          cycleId: cycle.id,
          title: "Unauthorised",
          description: "This must not be created for another employee.",
          successMeasure: "None",
          targetValue: "None",
          startDate: "2026-09-01",
          dueDate: "2027-01-31",
          weight: 10,
        },
        employee,
      ),
    /own objectives/i,
  );
  goals.submitCycleGoalsForApproval("employee-omar", cycle.id, employee);
  assert.equal(goals.getPendingGoalsForManager(manager).length, 2);
  assert.equal(goals.getPendingGoalsForTeam(hr).length, 2);
  assert.equal(
    performance.getReviewsForTeam(hr).some((review) => review.employeeId === "employee-omar"),
    true,
  );
  assert.equal(
    performance.getCyclesForTeam(hr).some((item) => item.id === cycle.id),
    true,
  );
  assert.throws(() => goals.approveGoal(first.id, hr), /assigned supervisor/i);
  goals.approveGoal(first.id, manager);
  goals.returnGoal(second.id, "Please make the customer measure more specific.", manager);
  assert.equal(
    notifications.listForUser("user-omar").some((item) => item.title.includes("changes")),
    true,
  );
  goals.updateGoal(second.id, { targetValue: "At least 96% on-time customer updates" }, employee);
  goals.submitCycleGoalsForApproval("employee-omar", cycle.id, employee);
  goals.approveGoal(second.id, manager);
  const evidence = await getApplicationDataServices().files.save(
    {
      blob: new Blob(["monthly shipment audit"], { type: "application/pdf" }),
      name: "shipment-audit.pdf",
      owner: { entityType: "performance-goal", entityId: first.id },
    },
    employee,
  );
  const progress = await goals.recordProgress(
    first.id,
    25,
    "Completed the first monthly shipment accuracy audit.",
    evidence.id,
    employee,
  );
  const checkIn = progress.checkIns[0]!;
  const opened = await goals.getEvidenceFile(first.id, checkIn.id, manager);
  assert.equal(opened.name, "shipment-audit.pdf");
  await assert.rejects(
    () => goals.getEvidenceFile(first.id, checkIn.id, unrelatedEmployee),
    /outside your permitted employee scope/i,
  );
  assert.equal(
    performance
      .getReviewsForEmployee("employee-omar", employee)
      .find((review) => review.cycleId === cycle.id)?.status,
    "Self Assessment Pending",
  );
  assert.equal(
    audit.list().some((event) => event.action.toLowerCase().includes("denied")),
    true,
  );
});

test("performance review follows self assessment through HR lock", () => {
  setup();
  const service = new PerformanceService();
  const template = service.getTemplates(hr)[0]!;
  const cycle = service.createCycle(
    {
      name: "2027 Midyear Review",
      templateId: template.id,
      status: "Active",
      departments: ["Operations"],
      employmentTypes: [],
      objectiveSettingDeadline: "2027-01-31",
      selfAssessmentDeadline: "2027-02-28",
      managerReviewDeadline: "2027-03-31",
      discussionDeadline: "2027-04-30",
      requiresModeration: true,
      employeeCanSeeManagerRatings: true,
    },
    hr,
  );
  const goals = new GoalService();
  const goal = goals.createGoal(
    {
      employeeId: "employee-omar",
      cycleId: cycle.id,
      title: "Deliver operations improvement",
      description: "Complete an evidence-based improvement in shipment operations.",
      successMeasure: "Signed-off improvement result",
      targetValue: "One improvement delivered",
      startDate: "2026-09-01",
      dueDate: "2027-01-31",
      weight: 100,
    },
    employee,
  );
  goals.submitCycleGoalsForApproval("employee-omar", cycle.id, employee);
  goals.approveGoal(goal.id, manager);
  let review = service
    .getReviewsForEmployee("employee-omar", employee)
    .find((item) => item.cycleId === cycle.id)!;
  const selfSections = structuredClone(review.sections);
  selfSections.forEach((section) =>
    section.items.forEach((item) => {
      item.selfRating = 4;
      item.selfComment = "Delivered the expected result with documented evidence.";
    }),
  );
  review = service.submitSelfAssessment(review.id, selfSections, employee);
  assert.equal(review.status, "Manager Review Pending");
  assert.throws(
    () => service.getReviewById(review.id, unrelatedEmployee),
    /authorised|permission/i,
  );
  const managerSections = structuredClone(review.sections);
  managerSections.forEach((section) =>
    section.items.forEach((item) => {
      item.managerRating = 4;
      item.managerComment = "Consistent delivery supported by specific work results.";
    }),
  );
  review = service.submitManagerReview(
    review.id,
    managerSections,
    "Omar delivered consistently and supported team priorities.",
    "Complete advanced operations training and lead one improvement project.",
    manager,
  );
  assert.equal(review.status, "Moderation Pending");
  review = service.approveModeration(
    review.id,
    "Ratings are consistent with the evidence presented.",
    hr,
  );
  review = service.recordDiscussion(
    review.id,
    "2026-08-29",
    "Discussed achievements, expectations and the agreed development plan.",
    manager,
  );
  review = service.acknowledgeReview(
    review.id,
    false,
    "I acknowledge receipt but would like one rating reconsidered.",
    employee,
  );
  review = service.lockReview(review.id, hr);
  assert.equal(review.status, "Locked");
  assert.equal(review.employeeAgreesWithReview, false);
  assert.match(review.developmentPlan ?? "", /advanced operations/i);
});

test("certificates are securely uploaded, scoped, viewed and verified", async () => {
  const { audit } = setup();
  const service = new TrainingService();
  const record = await service.addRecordWithCertificate(
    {
      employeeId: "employee-omar",
      title: "First Aid at Work",
      provider: "VIA Academy",
      completionDate: "2026-08-20",
      expiryDate: "2028-08-20",
    },
    { name: "first-aid.pdf", blob: new Blob(["certificate"], { type: "application/pdf" }) },
    employee,
  );
  assert.equal(service.getRecordsForEmployee("employee-omar", employee).length, 1);
  assert.throws(
    () => service.getRecordsForEmployee("employee-omar", unrelatedEmployee),
    /permission/i,
  );
  await assert.rejects(
    () => service.getCertificateFile(record.id, unrelatedEmployee),
    /permission/i,
  );
  const certificate = await service.getCertificateFile(record.id, manager);
  assert.equal(certificate.name, "first-aid.pdf");
  const verified = service.verifyRecord(record.id, hr);
  assert.equal(verified.hrVerified, true);
  const ownRecord = service.addRecord(
    {
      employeeId: "employee-rana",
      title: "HR Compliance Refresher",
      provider: "VIA Academy",
      completionDate: "2026-08-20",
    },
    hr,
  );
  assert.throws(() => service.verifyRecord(ownRecord.id, hr), /Another authorised person/i);
  assert.equal(
    audit
      .list()
      .some((event) => event.entityType === "training-certificate" && event.action === "view"),
    true,
  );
});

test("training follows employee request, supervisor, HR, session and completion", () => {
  const { audit, notifications } = setup();
  let now = new Date("2026-10-01T08:00:00.000Z");
  const service = new TrainingService({ now: () => now });
  const request = service
    .getRequests(employee)
    .find((item) => item.id === "training-request-omar-first-aid")!;
  assert.equal(request.status, "Pending Supervisor");
  assert.equal(
    service.getRequests(unrelatedEmployee).some((item) => item.id === request.id),
    false,
  );

  const managerDecision = service.decideSupervisor(
    request.id,
    "Approve",
    "This is relevant to Omar's regular site work.",
    manager,
  );
  assert.equal(managerDecision.status, "Pending HR");
  assert.throws(
    () => service.decideHr(request.id, "Approve", "Trying to bypass HR.", manager),
    /Only HR|Super Admin/i,
  );
  const approved = service.decideHr(
    request.id,
    "Approve",
    "Approved within the current learning budget.",
    hr,
  );
  assert.equal(approved.status, "Approved");
  const enrollment = service
    .getEnrollments(employee)
    .find((item) => item.requestId === request.id)!;
  assert.equal(enrollment.status, "Assigned");

  const session = service.saveSession(
    {
      courseId: request.courseId,
      title: "First Aid - October Intake",
      startAt: "2026-10-05T08:00:00.000Z",
      endAt: "2026-10-05T16:00:00.000Z",
      location: "VIA Muscat Training Room",
      facilitator: "Oman Safety Institute",
      capacity: 10,
      status: "Scheduled",
    },
    hr,
  );
  service.scheduleEnrollment(enrollment.id, session.id, hr);
  assert.throws(
    () => service.recordAttendance(enrollment.id, true, "Attendance confirmed", hr),
    /before the session starts/i,
  );
  now = new Date("2026-10-06T08:00:00.000Z");
  service.recordAttendance(enrollment.id, true, "Attendance confirmed", hr);
  const completed = service.completeEnrollment(
    enrollment.id,
    "Passed practical assessment",
    "2026-10-05",
    65,
    hr,
  );
  assert.equal(completed.status, "Completed");
  assert.equal(completed.actualCost, 65);
  assert.equal(
    service
      .getRecordsForEmployee("employee-omar", employee)
      .some((item) => item.enrollmentId === enrollment.id),
    true,
  );
  assert.equal(
    notifications.listForUser("user-omar").some((item) => item.title === "Training completed"),
    true,
  );
  assert.equal(
    audit.list().some((event) => event.entityType === "training-enrollment"),
    true,
  );
});
