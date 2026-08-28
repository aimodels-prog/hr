import assert from "node:assert/strict";
import test from "node:test";

import { AuditService } from "../src/lib/data/audit-service.ts";
import { configureApplicationDataServices } from "../src/lib/data/application-data.ts";
import { NotificationService } from "../src/lib/data/notification-service.ts";
import { OffboardingService } from "../src/lib/data/offboarding-service.ts";
import type { OffboardingCase } from "../src/lib/data/offboarding-types.ts";
import { OnboardingService } from "../src/lib/data/onboarding-service.ts";
import type { OnboardingCase } from "../src/lib/data/onboarding-types.ts";
import { initializeSeedData } from "../src/lib/data/seed-service.ts";
import { MemoryStorageDriver } from "../src/lib/data/storage-driver.ts";
import { VersionedStorageService } from "../src/lib/data/storage.ts";
import { TaskService } from "../src/lib/data/task-service.ts";
import type { ActorContext, Role } from "../src/lib/data/types.ts";

function actor(
  userId: string,
  employeeId: string,
  activeRole: Role,
  roles: Role[] = ["Employee", activeRole],
): ActorContext {
  return {
    actor: {
      userId,
      employeeId,
      displayName: userId,
      activeRole,
      roles: [...new Set(roles)],
    },
  };
}

function base(id: string) {
  return {
    id,
    createdAt: "2026-08-01T08:00:00.000Z",
    createdBy: "user-rana",
    updatedAt: "2026-08-01T08:00:00.000Z",
    updatedBy: "user-rana",
    recordVersion: 1,
  };
}

function setup() {
  const storage = new VersionedStorageService(new MemoryStorageDriver());
  initializeSeedData(storage);
  const audit = new AuditService(storage);
  const notifications = new NotificationService(storage, audit);
  configureApplicationDataServices({ storage, audit, notifications, files: {} as never });
  return { storage, audit, notifications };
}

function onboardingCase(): OnboardingCase {
  return {
    ...base("onboarding-task-test"),
    employeeId: "employee-omar",
    status: "In Progress",
    progressPercentage: 0,
    isReadyForStartDate: false,
    tasks: [
      {
        id: "employee-task",
        title: "Employee details",
        group: "Personal & Legal Documents",
        checkpoint: "Pre-Arrival",
        ownerRole: "Employee",
        dueDate: "2026-08-20",
        isMandatory: true,
        requiresEvidence: false,
        dependsOnTaskIds: [],
        status: "Pending",
      },
      {
        id: "hr-task",
        title: "HR induction",
        group: "HSE & Induction",
        checkpoint: "Day 1",
        ownerRole: "HR",
        dueDate: "2026-08-24",
        isMandatory: true,
        requiresEvidence: false,
        dependsOnTaskIds: [],
        status: "Pending",
      },
      {
        id: "it-task",
        title: "Prepare laptop",
        group: "IT & Equipment",
        checkpoint: "Pre-Arrival",
        ownerRole: "IT",
        dueDate: "2026-08-25",
        isMandatory: true,
        requiresEvidence: false,
        dependsOnTaskIds: [],
        status: "Pending",
      },
      {
        id: "manager-task",
        title: "Welcome plan",
        group: "Manager Plan",
        checkpoint: "Week 1",
        ownerRole: "Line Manager",
        dueDate: "2026-08-31",
        isMandatory: true,
        requiresEvidence: false,
        dependsOnTaskIds: ["hr-task"],
        status: "Blocked",
      },
    ],
  };
}

test("task inbox uses the active role and preserves employee self tasks", () => {
  const { storage } = setup();
  storage.writeCollection("onboardingCases", [onboardingCase()]);
  const service = new TaskService({ now: () => new Date("2026-08-24T12:00:00.000Z") });

  const hrTasks = service.getMyTasks({
    userId: "user-rana",
    employeeId: "employee-rana",
    activeRole: "HR",
  });
  assert.ok(hrTasks.some((task) => task.id.endsWith("hr-task")));
  assert.ok(!hrTasks.some((task) => task.id.endsWith("it-task")));
  assert.ok(!hrTasks.some((task) => task.id.endsWith("manager-task")));

  const employeeTasks = service.getMyTasks({
    userId: "user-omar",
    employeeId: "employee-omar",
    activeRole: "Employee",
  });
  assert.ok(employeeTasks.some((task) => task.id.endsWith("employee-task")));
  assert.ok(!employeeTasks.some((task) => task.id.endsWith("hr-task")));
  assert.equal(employeeTasks.find((task) => task.id.endsWith("employee-task"))?.state, "Overdue");
});

test("line managers receive only direct-report lifecycle work and blockers remain visible", () => {
  const { storage } = setup();
  storage.writeCollection("onboardingCases", [onboardingCase()]);
  const tasks = new TaskService({ now: () => new Date("2026-08-24T12:00:00.000Z") }).getMyTasks({
    userId: "user-layla",
    employeeId: "employee-layla",
    activeRole: "Line Manager",
  });
  const managerTask = tasks.find((task) => task.id.endsWith("manager-task"));
  assert.equal(managerTask?.state, "Blocked");
  assert.equal(managerTask?.actionLabel, "View blocker");
  assert.ok(!tasks.some((task) => task.id.endsWith("hr-task")));
});

test("onboarding completion is enforced by owner role and denials are audited", async () => {
  const { storage, audit } = setup();
  storage.writeCollection("onboardingCases", [onboardingCase()]);
  const service = new OnboardingService();

  await assert.rejects(
    service.updateTaskStatus(
      "onboarding-task-test",
      "hr-task",
      "Completed",
      actor("user-omar", "employee-omar", "Employee"),
    ),
    /assigned to another person or role/i,
  );
  assert.equal(audit.list().at(-1)?.action, "access-denied");

  const updated = await service.updateTaskStatus(
    "onboarding-task-test",
    "hr-task",
    "Completed",
    actor("user-rana", "employee-rana", "HR"),
  );
  assert.equal(updated.tasks.find((task) => task.id === "hr-task")?.status, "Completed");

  await assert.rejects(
    service.updateTaskStatus(
      "onboarding-task-test",
      "it-task",
      "Waived",
      actor("user-it", "employee-omar", "IT"),
      undefined,
      "Not needed",
    ),
    /Only HR or a Super Admin/i,
  );
});

test("offboarding financial and HR clearances require the correct active role", () => {
  const { storage } = setup();
  const offboarding: OffboardingCase = {
    ...base("offboarding-clearance-test"),
    employeeId: "employee-omar",
    reasonCategory: "Resignation",
    noticeDate: "2026-08-01",
    lastWorkingDate: "2026-08-31",
    rehireEligible: true,
    status: "Pending Clearance",
    tasks: [],
    progressPercentage: 100,
  };
  storage.writeCollection("offboardingCases", [offboarding]);
  const service = new OffboardingService();

  assert.throws(
    () =>
      service.grantFinancialClearance(offboarding.id, actor("user-rana", "employee-rana", "HR")),
    /Only Accounts or Super Admin/i,
  );
  const financiallyCleared = service.grantFinancialClearance(
    offboarding.id,
    actor("user-aisha", "employee-aisha", "Accounts"),
  );
  assert.ok(financiallyCleared.financialClearanceAt);
  assert.throws(
    () =>
      service.grantLegalClearance(
        offboarding.id,
        actor("user-aisha", "employee-aisha", "Accounts"),
      ),
    /Only HR or Super Admin/i,
  );
  const legallyCleared = service.grantLegalClearance(
    offboarding.id,
    actor("user-rana", "employee-rana", "HR"),
  );
  assert.ok(legallyCleared.legalClearanceAt);
});

test("a user cannot read-state another user's notification", () => {
  const { notifications, audit } = setup();
  const created = notifications.create(
    {
      recipientUserId: "user-rana",
      type: "task.review",
      title: "Review required",
      message: "A task is waiting.",
      priority: "Normal",
      status: "Unread",
    },
    actor("user-rana", "employee-rana", "HR"),
  );
  assert.throws(
    () => notifications.markRead(created.id, actor("user-omar", "employee-omar", "Employee")),
    /only your own notifications/i,
  );
  assert.equal(notifications.listForUser("user-rana")[0]?.status, "Unread");
  assert.equal(audit.list().at(-1)?.action, "access-denied");
});

test.after(() => configureApplicationDataServices(undefined));
