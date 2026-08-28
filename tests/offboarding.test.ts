import { SYSTEM_CONTEXT } from "../src/lib/data/types.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { AuditService } from "../src/lib/data/audit-service.ts";
import {
  configureApplicationDataServices,
  getApplicationDataServices,
} from "../src/lib/data/application-data.ts";
import { EmployeeService } from "../src/lib/data/employee-service.ts";
import type { FileRepository, SaveFileInput } from "../src/lib/data/file-repository.ts";
import { LifecycleTaskService } from "../src/lib/data/lifecycle-task-service.ts";
import { NotificationService } from "../src/lib/data/notification-service.ts";
import { OffboardingService } from "../src/lib/data/offboarding-service.ts";
import { initializeSeedData } from "../src/lib/data/seed-service.ts";
import { MemoryStorageDriver } from "../src/lib/data/storage-driver.ts";
import { VersionedStorageService } from "../src/lib/data/storage.ts";
import type { ActorContext, FileMetadata, Role } from "../src/lib/data/types.ts";

function actor(userId: string, employeeId: string, activeRole: Role): ActorContext {
  return {
    actor: { userId, employeeId, displayName: userId, roles: ["Employee", activeRole], activeRole },
  };
}

const hr = actor("user-rana", "employee-rana", "HR");
const accounts = actor("user-aisha", "employee-aisha", "Accounts");
// The seeded Super Admin user record is "user-super-admin" (linked to employee-yusuf) -
// distinct from the employee's own id, matching this repo's seed data conventions.
const superAdmin = actor("user-super-admin", "employee-yusuf", "Super Admin");

function fakeFileRepository(): FileRepository {
  const files = new Map<string, { metadata: FileMetadata; blob: Blob }>();
  let counter = 0;
  return {
    async save(input: SaveFileInput, context) {
      const id = `file-${++counter}`;
      const metadata: FileMetadata = {
        id,
        name: input.name,
        mimeType: input.mimeType ?? "application/octet-stream",
        size: input.blob.size,
        owner: input.owner,
        createdAt: new Date().toISOString(),
        createdBy: context.actor.userId,
      } as FileMetadata;
      files.set(id, { metadata, blob: input.blob });
      return metadata;
    },
    async getMetadata(id: string) {
      return files.get(id)?.metadata ?? null;
    },
    async getBlob(id: string) {
      return files.get(id)?.blob ?? null;
    },
    async listByOwner(owner) {
      return [...files.values()]
        .filter(
          (f) =>
            f.metadata.owner.entityType === owner.entityType &&
            f.metadata.owner.entityId === owner.entityId,
        )
        .map((f) => f.metadata);
    },
    async delete(id: string) {
      files.delete(id);
    },
    async clear() {
      files.clear();
    },
  };
}

function setup() {
  const storage = new VersionedStorageService(new MemoryStorageDriver());
  initializeSeedData(storage);
  const audit = new AuditService(storage);
  const notifications = new NotificationService(storage, audit);
  configureApplicationDataServices({ storage, audit, notifications, files: fakeFileRepository() });
  return { audit, notifications };
}

let counter = 0;
async function addEmployee(
  employeeService: EmployeeService,
  overrides: { lineManagerId?: string; nationality?: string } = {},
) {
  counter += 1;
  const { employee } = await employeeService.createEmployee(
    {
      employeeNumber: `VIA-OFFB-${counter}`,
      legalName: `Departing Employee ${counter}`,
      preferredName: `Departing${counter}`,
      workEmail: `departing.${counter}@via.example`,
      department: "Operations",
      position: "Coordinator",
      location: "Muscat, Oman",
      employmentType: "Full-time",
      startDate: "2023-01-01",
      status: "Active",
      lineManagerId: overrides.lineManagerId ?? "employee-rana",
      nationality: overrides.nationality ?? "Omani",
    },
    ["Employee"],
    hr,
  );
  return employee;
}

test("startCase rejects invalid or out-of-order dates", async () => {
  setup();
  const employeeService = new EmployeeService();
  const offboardingService = new OffboardingService();
  const employee = await addEmployee(employeeService);

  assert.throws(
    () =>
      offboardingService.startCase(
        employee.id,
        "Resignation",
        "not-a-date",
        "2026-09-30",
        false,
        undefined,
        hr,
      ),
    /Notice date is not a valid date/i,
  );
  assert.throws(
    () =>
      offboardingService.startCase(
        employee.id,
        "Resignation",
        "2026-09-01",
        "also-not-a-date",
        false,
        undefined,
        hr,
      ),
    /Last working date is not a valid date/i,
  );
  assert.throws(
    () =>
      offboardingService.startCase(
        employee.id,
        "Resignation",
        "2026-09-30",
        "2026-09-01",
        false,
        undefined,
        hr,
      ),
    /Notice date cannot be after the last working date/i,
  );
});

test("startCase lets HR choose a specific template and assign a specific HR case owner", async () => {
  setup();
  const employeeService = new EmployeeService();
  const offboardingService = new OffboardingService();
  const employee = await addEmployee(employeeService);

  // A second HR user, distinct from the actor starting the case, to prove an explicit
  // assignment is honoured rather than just defaulting to whoever is currently acting.
  const extraHrEmployee = await addEmployee(employeeService);
  const extraHrUser = employeeService
    .getUserRepository(SYSTEM_CONTEXT)
    .list()
    .find((u) => u.employeeId === extraHrEmployee.id)!;
  employeeService
    .getUserRepository(SYSTEM_CONTEXT)
    .update(extraHrUser.id, { roles: ["Employee", "HR"] }, hr);

  // A custom template, distinct from the seeded default, to prove the selection is honoured
  // rather than always falling back to department/employment-type auto-matching.
  offboardingService.saveTemplate(
    {
      id: "tmpl-custom-offboarding",
      name: "Custom Offboarding",
      description: "A minimal custom checklist",
      isActive: true,
      departments: [],
      employmentTypes: [],
      tasks: [
        {
          id: "c1",
          title: "Custom HR task",
          group: "Exit Interview",
          ownerRole: "HR",
          offsetDaysFromLastWorkingDate: 0,
          isMandatory: true,
          requiresEvidence: false,
        },
      ],
    },
    hr,
  );

  const c = offboardingService.startCase(
    employee.id,
    "Resignation",
    "2026-09-01",
    "2026-09-30",
    true,
    undefined,
    hr,
    { templateId: "tmpl-custom-offboarding", assignedHRId: extraHrUser.id },
  );

  assert.equal(c.templateId, "tmpl-custom-offboarding");
  assert.equal(c.tasks.length, 1);
  assert.equal(c.tasks[0]?.title, "Custom HR task");
  assert.equal(c.assignedHRId, extraHrUser.id);
  // The named HR owner is auto-assigned the HR-owned task too, not just recorded on the case.
  assert.equal(c.tasks[0]?.assignedUserId, extraHrUser.id);

  // An inactive/non-existent template id is rejected rather than silently falling back.
  assert.throws(
    () =>
      offboardingService.startCase(
        extraHrEmployee.id,
        "Resignation",
        "2026-09-01",
        "2026-09-30",
        true,
        undefined,
        hr,
        { templateId: "does-not-exist" },
      ),
    /Select an active offboarding template/i,
  );

  // A user who isn't an active HR holder is rejected as an HR owner - "employee"'s own linked
  // user account only ever holds the plain Employee role (per addEmployee/createEmployee).
  const nonHrUser = employeeService
    .getUserRepository(SYSTEM_CONTEXT)
    .list()
    .find((u) => u.employeeId === employee.id)!;
  assert.throws(
    () =>
      offboardingService.startCase(
        extraHrEmployee.id,
        "Resignation",
        "2026-09-01",
        "2026-09-30",
        true,
        undefined,
        hr,
        { assignedHRId: nonHrUser.id },
      ),
    /Select an active HR owner/i,
  );
});

test("saveTemplate validates task content and deleteTemplate keeps at least one active template", () => {
  setup();
  const offboardingService = new OffboardingService();

  assert.throws(
    () =>
      offboardingService.saveTemplate(
        {
          id: "bad-name",
          name: "",
          description: "A description long enough",
          isActive: true,
          departments: [],
          employmentTypes: [],
          tasks: [
            {
              id: "t1",
              title: "A task",
              group: "Exit Interview",
              ownerRole: "HR",
              offsetDaysFromLastWorkingDate: 0,
              isMandatory: true,
              requiresEvidence: false,
            },
          ],
        },
        hr,
      ),
    /Template name is required/i,
  );

  assert.throws(
    () =>
      offboardingService.saveTemplate(
        {
          id: "bad-no-tasks",
          name: "Valid Name",
          description: "A description long enough",
          isActive: true,
          departments: [],
          employmentTypes: [],
          tasks: [],
        },
        hr,
      ),
    /Add at least one offboarding task/i,
  );

  assert.throws(
    () =>
      offboardingService.saveTemplate(
        {
          id: "bad-loop",
          name: "Loop Template",
          description: "A description long enough",
          isActive: true,
          departments: [],
          employmentTypes: [],
          tasks: [
            {
              id: "a",
              title: "Task A",
              group: "Exit Interview",
              ownerRole: "HR",
              offsetDaysFromLastWorkingDate: 0,
              isMandatory: true,
              requiresEvidence: false,
              dependsOnTaskIds: ["b"],
            },
            {
              id: "b",
              title: "Task B",
              group: "Exit Interview",
              ownerRole: "HR",
              offsetDaysFromLastWorkingDate: 0,
              isMandatory: true,
              requiresEvidence: false,
              dependsOnTaskIds: ["a"],
            },
          ],
        },
        hr,
      ),
    /cannot form a loop/i,
  );

  // The final active template cannot be archived.
  const activeTemplates = offboardingService.getTemplates(SYSTEM_CONTEXT).filter((t) => t.isActive);
  assert.equal(activeTemplates.length, 1);
  assert.throws(
    () => offboardingService.deleteTemplate(activeTemplates[0]!.id, hr),
    /Keep at least one active offboarding template/i,
  );
});

test("assignTaskOwner rejects a user who does not hold the task's owner role", async () => {
  setup();
  const employeeService = new EmployeeService();
  const offboardingService = new OffboardingService();
  const employee = await addEmployee(employeeService);

  const c = offboardingService.startCase(
    employee.id,
    "Resignation",
    "2026-09-01",
    "2026-09-30",
    true,
    undefined,
    hr,
  );
  const itTask = c.tasks.find((t) => t.group === "IT & Assets")!;

  // employee's own linked user account only ever holds the plain Employee role.
  const employeeUser = employeeService
    .getUserRepository(SYSTEM_CONTEXT)
    .list()
    .find((u) => u.employeeId === employee.id)!;
  assert.throws(
    () => offboardingService.assignTaskOwner(c.id, itTask.id, employeeUser.id, hr),
    /must hold the IT role/i,
  );
});

test("a departing employee holding HR, Accounts or Super Admin cannot approve their own clearance or finalisation", async () => {
  setup();
  const employeeService = new EmployeeService();
  const offboardingService = new OffboardingService();
  const employee = await addEmployee(employeeService, { lineManagerId: "employee-layla" });

  const c = offboardingService.startCase(
    employee.id,
    "Resignation",
    "2020-01-01",
    "2020-01-31",
    true,
    undefined,
    hr,
  );
  await completeAllMandatoryTasks(offboardingService, employeeService, c.id, employee.id);

  // Dual-hatted as Accounts/HR/Super Admin while being the departing employee themselves -
  // the role check alone must not be enough to approve their own case.
  const selfAsAccounts = actor("user-self-dual", employee.id, "Accounts");
  assert.throws(
    () => offboardingService.grantFinancialClearance(c.id, selfAsAccounts),
    /cannot confirm financial clearance on your own/i,
  );
  const selfAsHr = actor("user-self-dual", employee.id, "HR");
  assert.throws(
    () => offboardingService.grantLegalClearance(c.id, selfAsHr),
    /cannot confirm legal\/document clearance on your own/i,
  );

  // Legitimate, unrelated actors can still grant clearance normally.
  offboardingService.grantFinancialClearance(c.id, accounts);
  offboardingService.grantLegalClearance(c.id, hr);

  const selfAsSuperAdmin = actor("user-self-dual", employee.id, "Super Admin");
  assert.throws(
    () => offboardingService.finalizeCase(c.id, selfAsSuperAdmin),
    /cannot finalise your own offboarding case/i,
  );

  const finalised = offboardingService.finalizeCase(c.id, superAdmin);
  assert.equal(finalised.status, "Completed");
});

test("finalizeCase rejects finalising before the employee's last working date", async () => {
  setup();
  const employeeService = new EmployeeService();
  const offboardingService = new OffboardingService();
  const employee = await addEmployee(employeeService, { lineManagerId: "employee-layla" });

  const c = offboardingService.startCase(
    employee.id,
    "Resignation",
    "2099-01-01",
    "2099-01-31",
    true,
    undefined,
    hr,
  );
  await completeAllMandatoryTasks(offboardingService, employeeService, c.id, employee.id);
  offboardingService.grantFinancialClearance(c.id, accounts);
  offboardingService.grantLegalClearance(c.id, hr);

  assert.throws(
    () => offboardingService.finalizeCase(c.id, superAdmin),
    /Cannot finalise before the employee's last working date/i,
  );
});

test("a Restricted case's confidential notes are hidden from HR but visible to Super Admin, and getCaseForViewer never leaks to someone with no case access", async () => {
  setup();
  const employeeService = new EmployeeService();
  const offboardingService = new OffboardingService();
  const employee = await addEmployee(employeeService, { lineManagerId: "employee-layla" });

  const c = offboardingService.startCase(
    employee.id,
    "Termination",
    "2026-09-01",
    "2026-09-30",
    false,
    "Terminated for cause - see legal file.",
    hr,
    { confidentialityLevel: "Restricted" },
  );
  assert.equal(c.confidentialityLevel, "Restricted");
  // The raw case (as returned directly by startCase, e.g. to the actor who just created it)
  // does carry the note - redaction is applied when a VIEWER reads it, not at write time.
  assert.equal(c.confidentialNotes, "Terminated for cause - see legal file.");

  // A regular HR user viewing the case does not see the note at all.
  const viewedByHr = offboardingService.getCaseForViewer(c.id, hr);
  assert.ok(viewedByHr);
  assert.equal(viewedByHr.confidentialNotes, undefined);
  assert.equal(offboardingService.redactCaseForViewer(c, hr).confidentialNotes, undefined);

  // Super Admin still sees it.
  const viewedBySuperAdmin = offboardingService.getCaseForViewer(c.id, superAdmin);
  assert.equal(viewedBySuperAdmin?.confidentialNotes, "Terminated for cause - see legal file.");

  // A Standard-confidentiality case is visible to any HR user, as before.
  const employee2 = await addEmployee(employeeService);
  const standardCase = offboardingService.startCase(
    employee2.id,
    "Resignation",
    "2026-09-01",
    "2026-09-30",
    true,
    "Routine resignation note.",
    hr,
  );
  assert.equal(standardCase.confidentialityLevel, "Standard");
  const standardViewedByHr = offboardingService.getCaseForViewer(standardCase.id, hr);
  assert.equal(standardViewedByHr?.confidentialNotes, "Routine resignation note.");

  // Someone with no access to the Restricted case at all gets nothing back - not even a
  // redacted shell of it.
  const unrelated = actor("user-unrelated", "employee-unrelated", "Line Manager");
  assert.equal(offboardingService.getCaseForViewer(c.id, unrelated), undefined);
});

test("startCase notifies task owners, including a specifically named owner from the template", async () => {
  const { notifications } = setup();
  const employeeService = new EmployeeService();
  const offboardingService = new OffboardingService();
  const employee = await addEmployee(employeeService, { lineManagerId: "employee-layla" });

  // A second, specific HR user - distinct from Rana, who is the default auto-assigned HR
  // owner - named as the owner of the HR-owned "reconcile leave" task. Them receiving a
  // notification can only be explained by the assignedUserId override actually working, since
  // the generic "anyone with HR" role-based fallback would notify Rana (or whoever the case's
  // assignedHRId resolves to), not specifically this person.
  const namedHrEmployee = await addEmployee(employeeService);
  const namedHrUser = employeeService
    .getUserRepository(SYSTEM_CONTEXT)
    .list()
    .find((u) => u.employeeId === namedHrEmployee.id)!;
  employeeService
    .getUserRepository(SYSTEM_CONTEXT)
    .update(namedHrUser.id, { roles: ["Employee", "HR"] }, hr);

  const defaultTemplate = offboardingService.getTemplates(SYSTEM_CONTEXT)[0]!;
  const named = {
    ...defaultTemplate,
    tasks: defaultTemplate.tasks.map((t) =>
      t.group === "Leave & Attendance Reconciliation"
        ? { ...t, assignedUserId: namedHrUser.id }
        : t,
    ),
  };
  offboardingService.saveTemplate(named, hr);

  const c = offboardingService.startCase(
    employee.id,
    "Resignation",
    "2026-09-01",
    "2026-09-30",
    true,
    undefined,
    hr,
  );

  const reconcileTask = c.tasks.find((t) => t.group === "Leave & Attendance Reconciliation")!;
  assert.equal(reconcileTask.assignedUserId, namedHrUser.id);

  // The named HR owner is notified specifically, not just whichever HR person the case's own
  // assignedHRId auto-resolved to.
  const namedHrNotifications = notifications
    .listForUser(namedHrUser.id)
    .filter((n) => n.type === "offboarding.assigned");
  assert.ok(namedHrNotifications.length > 0);

  // Layla (the line manager) is notified for the "Reassign active projects" task via the
  // ordinary role-based fallback (no named owner set for that task).
  const laylaNotifications = notifications
    .listForUser("user-layla")
    .filter((n) => n.type === "offboarding.assigned");
  assert.ok(laylaNotifications.length > 0);

  // The departing employee's own account stays Active through Notice - they are still
  // actively employed and must be able to log in to complete self-service tasks assigned to
  // them (e.g. "Handover notes to line manager", ownerRole "Employee"). They are correctly
  // notified about that task, same as any other task owner.
  const employeeUser = employeeService
    .getUserRepository(SYSTEM_CONTEXT)
    .list()
    .find((u) => u.employeeId === employee.id)!;
  assert.equal(employeeUser.status, "Active");
  const employeeNotifications = notifications
    .listForUser(employeeUser.id)
    .filter((n) => n.type === "offboarding.assigned");
  assert.ok(employeeNotifications.length > 0);
});

test("Line Manager and Employee access is scoped to the actual relationship, not just a shared owner role", async () => {
  setup();
  const employeeService = new EmployeeService();
  const offboardingService = new OffboardingService();

  // Two departing employees with different managers.
  const laylasReport = await addEmployee(employeeService, { lineManagerId: "employee-layla" });
  const otherReport = await addEmployee(employeeService); // manager defaults to employee-rana

  const caseA = offboardingService.startCase(
    laylasReport.id,
    "Resignation",
    "2026-09-01",
    "2026-09-30",
    true,
    undefined,
    hr,
  );
  const caseB = offboardingService.startCase(
    otherReport.id,
    "Resignation",
    "2026-09-01",
    "2026-09-30",
    true,
    undefined,
    hr,
  );

  const layla = actor("user-layla", "employee-layla", "Line Manager");

  // Layla manages caseA's employee, not caseB's - being active as "Line Manager" must not by
  // itself grant access to every case that happens to have a Line-Manager-owned task.
  assert.equal(offboardingService.canAccessCase(caseA, layla), true);
  assert.equal(offboardingService.canAccessCase(caseB, layla), false);
  const projectTaskB = caseB.tasks.find((t) => t.group === "Project Reassignment")!;
  await assert.rejects(
    offboardingService.updateTaskStatus(caseB.id, projectTaskB.id, "Completed", layla),
    /assigned to another person or role/i,
  );

  // An unrelated employee must not be able to complete another employee's own
  // "Employee"-owned handover task just by holding the base Employee role.
  const unrelatedEmployee = actor("user-random", "employee-random", "Employee");
  const handoverTaskA = caseA.tasks.find((t) => t.group === "Manager Handover")!;
  await assert.rejects(
    offboardingService.updateTaskStatus(caseA.id, handoverTaskA.id, "Completed", unrelatedEmployee),
    /assigned to another person or role/i,
  );

  // IT remains a genuine shared-service role: any IT user may act on any case's IT task,
  // regardless of who the departing employee's manager is.
  const it = actor("user-it", "employee-it", "IT");
  const itTaskB = caseB.tasks.find((t) => t.group === "IT & Assets")!;
  const updated = await offboardingService.updateTaskStatus(caseB.id, itTaskB.id, "Completed", it);
  assert.equal(updated.tasks.find((t) => t.id === itTaskB.id)?.status, "Completed");
});

test("assignTaskOwner reassigns a task on an active case, notifies the new owner, and rejects invalid targets", async () => {
  const { notifications } = setup();
  const employeeService = new EmployeeService();
  const offboardingService = new OffboardingService();
  const employee = await addEmployee(employeeService);

  const c = offboardingService.startCase(
    employee.id,
    "Resignation",
    "2026-09-01",
    "2026-09-30",
    true,
    undefined,
    hr,
  );
  const hrTask = c.tasks.find((t) => t.group === "Leave & Attendance Reconciliation")!;

  // Only HR/Super Admin can reassign.
  assert.throws(
    () => offboardingService.assignTaskOwner(c.id, hrTask.id, "user-aisha", accounts),
    /Only HR or Super Admin/i,
  );

  // Rejects a non-existent user.
  assert.throws(
    () => offboardingService.assignTaskOwner(c.id, hrTask.id, "user-does-not-exist", hr),
    /active user/i,
  );

  // Rejects a Suspended user.
  employeeService
    .getUserRepository(SYSTEM_CONTEXT)
    .update("user-aisha", { status: "Suspended" }, hr);
  assert.throws(
    () => offboardingService.assignTaskOwner(c.id, hrTask.id, "user-aisha", hr),
    /active user/i,
  );
  employeeService.getUserRepository(SYSTEM_CONTEXT).update("user-aisha", { status: "Active" }, hr);

  // A valid reassignment succeeds and notifies the new owner.
  const updated = offboardingService.assignTaskOwner(c.id, hrTask.id, "user-aisha", hr);
  const reassignedTask = updated.tasks.find((t) => t.id === hrTask.id)!;
  assert.equal(reassignedTask.assignedUserId, "user-aisha");
  assert.ok(
    notifications
      .listForUser("user-aisha")
      .some((n) => n.deduplicationKey === `offboarding-reassigned-${c.id}-${hrTask.id}-user-aisha`),
  );

  // Clearing the assignment (passing undefined) removes it.
  const cleared = offboardingService.assignTaskOwner(c.id, hrTask.id, undefined, hr);
  assert.equal(cleared.tasks.find((t) => t.id === hrTask.id)!.assignedUserId, undefined);
});

test("updateTaskStatus independently verifies evidence ownership instead of trusting the caller", async () => {
  setup();
  const employeeService = new EmployeeService();
  const offboardingService = new OffboardingService();
  const lifecycle = new LifecycleTaskService();
  const employee = await addEmployee(employeeService);
  const employeeCtx = actor(`user-for-${employee.id}`, employee.id, "Employee");
  // Give the departing employee a real user record so requireTaskAction's ownerRole check
  // resolves correctly through the same path production code uses.
  employeeService.getUserRepository(SYSTEM_CONTEXT).create(
    {
      employeeId: employee.id,
      displayName: employee.preferredName,
      workspaceEmail: employee.workEmail,
      roles: ["Employee"],
      status: "Active",
    },
    hr,
  );

  const c = offboardingService.startCase(
    employee.id,
    "Resignation",
    "2026-09-01",
    "2026-09-30",
    true,
    undefined,
    hr,
  );
  const handoverTask = c.tasks.find((t) => t.group === "Manager Handover")!;
  assert.equal(handoverTask.requiresEvidence, true);

  // A fileId that was never uploaded/linked to this case at all is rejected outright.
  await assert.rejects(
    offboardingService.updateTaskStatus(
      c.id,
      handoverTask.id,
      "Completed",
      employeeCtx,
      "file-that-does-not-exist",
    ),
    /could not be verified/i,
  );

  // A real file exists but is owned by a DIFFERENT case - still rejected.
  const foreignFile = await getApplicationDataServices().files.save(
    {
      blob: new Blob(["x"]),
      name: "evidence.pdf",
      owner: { entityType: "offboarding-case", entityId: "some-other-case" },
    },
    hr,
  );
  await assert.rejects(
    offboardingService.updateTaskStatus(
      c.id,
      handoverTask.id,
      "Completed",
      employeeCtx,
      foreignFile.id,
    ),
    /could not be verified/i,
  );

  // The real, correct path - LifecycleTaskService.complete() uploads evidence linked to THIS
  // case - is accepted.
  const completedCase = await lifecycle.complete(
    "offboarding",
    c.id,
    handoverTask.id,
    employeeCtx,
    new File(["handover notes"], "handover.pdf", { type: "application/pdf" }),
  );
  assert.equal(completedCase.tasks.find((t) => t.id === handoverTask.id)!.status, "Completed");
});

test("clearance notifications nudge whoever needs to act next, then signal both are ready to finalise", async () => {
  const { notifications } = setup();
  const employeeService = new EmployeeService();
  const offboardingService = new OffboardingService();
  // completeAllMandatoryTasks acts as Layla for the "Project Reassignment" task, so this
  // employee's real manager must actually be Layla - a Line Manager's access is scoped to
  // their own reports, not any Line-Manager-owned task company-wide.
  const employee = await addEmployee(employeeService, { lineManagerId: "employee-layla" });

  const c = offboardingService.startCase(
    employee.id,
    "Resignation",
    "2026-09-01",
    "2026-09-30",
    true,
    undefined,
    hr,
  );

  // Complete every mandatory task so clearance is unlocked.
  await completeAllMandatoryTasks(offboardingService, employeeService, c.id, employee.id);

  offboardingService.grantFinancialClearance(c.id, accounts);
  assert.ok(
    notifications
      .listForUser("user-rana")
      .some((n) => n.deduplicationKey === `offboarding-clearance-needed-${c.id}-HR`),
    "expected HR to be nudged once financial clearance is in and HR's is still outstanding",
  );

  offboardingService.grantLegalClearance(c.id, hr);
  assert.ok(
    notifications
      .listForUser("user-super-admin")
      .some((n) => n.deduplicationKey === `offboarding-ready-${c.id}`),
    "expected Super Admin to be told the case is ready to finalise once both clearances are in",
  );
});

test("full lifecycle: start, complete every mandatory task, clear both sides, finalise - and cancellation reverts the employee to Active", async () => {
  const { notifications } = setup();
  const employeeService = new EmployeeService();
  const offboardingService = new OffboardingService();

  // Finalisation path. completeAllMandatoryTasks acts as Layla for "Project Reassignment", so
  // this employee's real manager must actually be Layla. The last working date is set safely
  // in the past so finalizeCase's last-working-date gate does not block this test.
  const employee = await addEmployee(employeeService, { lineManagerId: "employee-layla" });
  const c = offboardingService.startCase(
    employee.id,
    "Resignation",
    "2020-01-01",
    "2020-01-31",
    true,
    undefined,
    hr,
  );
  assert.equal(employeeService.getById(employee.id, SYSTEM_CONTEXT)?.status, "Notice");

  await completeAllMandatoryTasks(offboardingService, employeeService, c.id, employee.id);
  offboardingService.grantFinancialClearance(c.id, accounts);
  offboardingService.grantLegalClearance(c.id, hr);
  const finalised = offboardingService.finalizeCase(c.id, superAdmin);
  assert.equal(finalised.status, "Completed");
  assert.equal(employeeService.getById(employee.id, SYSTEM_CONTEXT)?.status, "Inactive");

  const employeeUser = employeeService
    .getUserRepository(SYSTEM_CONTEXT)
    .list()
    .find((u) => u.employeeId === employee.id)!;
  assert.ok(
    notifications.listForUser(employeeUser.id).some((n) => n.type === "offboarding.completed"),
  );

  // Cancellation path, on a separate employee.
  const employee2 = await addEmployee(employeeService);
  const c2 = offboardingService.startCase(
    employee2.id,
    "Resignation",
    "2026-09-01",
    "2026-09-30",
    true,
    undefined,
    hr,
  );
  assert.equal(employeeService.getById(employee2.id, SYSTEM_CONTEXT)?.status, "Notice");
  const cancelled = offboardingService.cancelCase(c2.id, "Employee decided to stay", hr);
  assert.equal(cancelled.status, "Cancelled");
  assert.equal(employeeService.getById(employee2.id, SYSTEM_CONTEXT)?.status, "Active");
});

/** Completes (or waives, where evidence would otherwise be required) every mandatory task on
 * the default seeded template, in an order that respects the o3->o4 and o6+o7->o8 dependencies. */
async function completeAllMandatoryTasks(
  offboardingService: OffboardingService,
  employeeService: EmployeeService,
  caseId: string,
  employeeId: string,
) {
  const lineManager = actor("user-layla", "employee-layla", "Line Manager");
  const it = actor("user-it", "employee-it", "IT");

  const byGroup = (group: string) => {
    const c = offboardingService.getCaseById(caseId, SYSTEM_CONTEXT)!;
    return c.tasks.find((t) => t.group === group)!;
  };

  // o1 Manager Handover (Employee, requires evidence) -> waive via HR instead of uploading a file.
  await offboardingService.updateTaskStatus(
    caseId,
    byGroup("Manager Handover").id,
    "Waived",
    hr,
    undefined,
    "Handover notes provided verbally, waived for test purposes",
  );
  // o2 Project Reassignment (Line Manager)
  await offboardingService.updateTaskStatus(
    caseId,
    byGroup("Project Reassignment").id,
    "Completed",
    lineManager,
  );
  // o3 IT & Assets (IT)
  await offboardingService.updateTaskStatus(caseId, byGroup("IT & Assets").id, "Completed", it);
  // o4 Access & Security (IT, depends on o3)
  await offboardingService.updateTaskStatus(
    caseId,
    byGroup("Access & Security").id,
    "Completed",
    it,
  );
  // o6 Leave & Attendance Reconciliation (HR)
  await offboardingService.updateTaskStatus(
    caseId,
    byGroup("Leave & Attendance Reconciliation").id,
    "Completed",
    hr,
  );
  // o7 Expenses & Advances (Accounts)
  await offboardingService.updateTaskStatus(
    caseId,
    byGroup("Expenses & Advances").id,
    "Completed",
    accounts,
  );
  // o8 Final Payroll Input (Accounts, depends on o6 + o7)
  await offboardingService.updateTaskStatus(
    caseId,
    byGroup("Final Payroll Input").id,
    "Completed",
    accounts,
  );
  // o10 Service Documents (HR)
  await offboardingService.updateTaskStatus(
    caseId,
    byGroup("Service Documents").id,
    "Completed",
    hr,
  );
}

test.after(() => configureApplicationDataServices(undefined));
