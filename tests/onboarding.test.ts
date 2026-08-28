import assert from "node:assert/strict";
import test from "node:test";

import { AuditService } from "../src/lib/data/audit-service.ts";
import { configureApplicationDataServices } from "../src/lib/data/application-data.ts";
import { NotificationService } from "../src/lib/data/notification-service.ts";
import { OnboardingService } from "../src/lib/data/onboarding-service.ts";
import type {
  OnboardingTemplate,
  OnboardingTemplateTask,
} from "../src/lib/data/onboarding-types.ts";
import { initializeSeedData } from "../src/lib/data/seed-service.ts";
import { MemoryStorageDriver } from "../src/lib/data/storage-driver.ts";
import { VersionedStorageService } from "../src/lib/data/storage.ts";
import type { FileRepository, SaveFileInput } from "../src/lib/data/file-repository.ts";
import type {
  ActorContext,
  Employee,
  EmployeeDocument,
  FileMetadata,
  Role,
  User,
} from "../src/lib/data/types.ts";

function actor(userId: string, employeeId: string, activeRole: Role): ActorContext {
  return {
    actor: { userId, employeeId, displayName: userId, roles: ["Employee", activeRole], activeRole },
  };
}

const hr = actor("user-rana", "employee-rana", "HR");
const accounts = actor("user-aisha", "employee-aisha", "Accounts");

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

function setup(startDate = "2026-08-30") {
  const storage = new VersionedStorageService(new MemoryStorageDriver());
  initializeSeedData(storage);
  const audit = new AuditService(storage);
  const notifications = new NotificationService(storage, audit);
  const files = fakeFileRepository();
  configureApplicationDataServices({ storage, audit, notifications, files });
  const sourceEmployee = storage
    .readCollection<Employee>("employees")
    .find((item) => item.id === "employee-omar")!;
  const now = "2026-08-24T08:00:00.000Z";
  const employee: Employee = {
    ...sourceEmployee,
    id: "employee-new",
    employeeNumber: "VIA-NEW-001",
    legalName: "Mariam Al Noor",
    preferredName: "Mariam",
    workEmail: "mariam@via.example",
    workspaceEmail: "mariam@via.example",
    startDate,
    status: "Onboarding",
    lineManagerId: "employee-layla",
    bankDetails: undefined,
    createdAt: now,
    createdBy: "user-rana",
    updatedAt: now,
    updatedBy: "user-rana",
    recordVersion: 1,
  };
  storage.writeCollection("employees", [
    ...storage.readCollection<Employee>("employees"),
    employee,
  ]);
  const user: User = {
    id: "user-new",
    employeeId: employee.id,
    displayName: employee.preferredName,
    workspaceEmail: employee.workEmail,
    roles: ["Employee"],
    status: "Active",
    createdAt: now,
    createdBy: "user-rana",
    updatedAt: now,
    updatedBy: "user-rana",
    recordVersion: 1,
  };
  storage.writeCollection("users", [...storage.readCollection<User>("users"), user]);
  return { storage, audit, notifications, files, service: new OnboardingService() };
}

function template(
  service: OnboardingService,
  id: string,
  tasks: OnboardingTemplateTask[],
): OnboardingTemplate {
  const now = "2026-08-24T08:00:00.000Z";
  const result: OnboardingTemplate = {
    id,
    name: `Template ${id}`,
    description: "A complete test onboarding checklist",
    isActive: true,
    countries: [],
    legalEntities: [],
    departments: [],
    roles: [],
    employmentTypes: [],
    tasks,
    createdAt: now,
    createdBy: "user-rana",
    updatedAt: now,
    updatedBy: "user-rana",
    recordVersion: 1,
  };
  return service.saveTemplate(result, hr);
}

test("case creation assigns employee, manager and HR work and prevents duplicates", () => {
  const { service, notifications } = setup();
  const onboardingCase = service.createCaseForEmployee("employee-new", hr, {
    templateId: "tmpl-default",
    assignedHRId: "user-rana",
  });
  assert.ok(
    onboardingCase.tasks.some(
      (task) => task.ownerRole === "Employee" && task.assignedUserId === "user-new",
    ),
  );
  assert.ok(
    onboardingCase.tasks.some(
      (task) => task.ownerRole === "Line Manager" && task.assignedUserId === "user-layla",
    ),
  );
  assert.ok(
    onboardingCase.tasks.some(
      (task) => task.ownerRole === "HR" && task.assignedUserId === "user-rana",
    ),
  );
  assert.ok(onboardingCase.tasks.some((task) => task.checkpoint === "Day 60"));
  assert.ok(onboardingCase.tasks.some((task) => task.checkpoint === "Day 90"));
  assert.ok(
    notifications
      .listForUser("user-new")
      .some((item) => item.link?.path === "/staff/me/onboarding"),
  );
  assert.throws(
    () => service.createCaseForEmployee("employee-new", hr),
    /already has an active onboarding case/i,
  );
});

test("each active role sees only its relevant onboarding work", () => {
  const { service } = setup();
  const onboardingCase = service.createCaseForEmployee("employee-new", hr, {
    templateId: "tmpl-default",
    assignedHRId: "user-rana",
  });
  const employeeTasks = service.getTasksForContext(
    onboardingCase,
    actor("user-new", "employee-new", "Employee"),
  );
  assert.ok(employeeTasks.length > 0);
  assert.ok(employeeTasks.every((task) => task.ownerRole === "Employee"));
  const managerTasks = service.getTasksForContext(
    onboardingCase,
    actor("user-layla", "employee-layla", "Line Manager"),
  );
  assert.ok(managerTasks.length > 0);
  assert.ok(managerTasks.every((task) => task.ownerRole === "Line Manager"));
  const itTasks = service.getTasksForContext(onboardingCase, actor("user-it", "employee-it", "IT"));
  assert.ok(itTasks.length > 0);
  assert.ok(itTasks.every((task) => task.ownerRole === "IT"));
  const superAdminTasks = service.getTasksForContext(
    onboardingCase,
    actor("user-super", "employee-super", "Super Admin"),
  );
  assert.equal(superAdminTasks.length, onboardingCase.tasks.length);
});

test("Line Manager and Employee access is scoped to the actual relationship, not just a shared owner role", async () => {
  const { service } = setup();
  // A bare template with no assignedUserId set on its Employee/Line Manager tasks, so
  // updateTaskStatus must fall back to role-based checks rather than an explicit assignment.
  const bare = template(service, "bare", [
    {
      id: "emp-task",
      title: "Self-service form",
      group: "Personal & Legal Documents",
      checkpoint: "Pre-Arrival",
      ownerRole: "Employee",
      offsetDaysFromStart: -7,
      isMandatory: true,
      requiresEvidence: false,
    },
    {
      id: "lm-task",
      title: "30-day check-in",
      group: "Manager Plan",
      checkpoint: "Day 30",
      ownerRole: "Line Manager",
      offsetDaysFromStart: 30,
      isMandatory: true,
      requiresEvidence: false,
    },
  ]);
  const onboardingCase = service.createCaseForEmployee("employee-new", hr, { templateId: bare.id });
  const empTask = onboardingCase.tasks.find((t) => t.group === "Personal & Legal Documents")!;
  const lmTask = onboardingCase.tasks.find((t) => t.group === "Manager Plan")!;

  // employee-new's real manager is employee-layla (per setup()). An unrelated Line Manager
  // must not be able to act on employee-new's Line-Manager-owned task just by holding that
  // role somewhere else in the company.
  const unrelatedManager = actor("user-tariq", "employee-tariq", "Line Manager");
  await assert.rejects(
    service.updateTaskStatus(onboardingCase.id, lmTask.id, "Completed", unrelatedManager),
    /assigned to another person or role/i,
  );
  const realManager = actor("user-layla", "employee-layla", "Line Manager");
  const afterLm = await service.updateTaskStatus(
    onboardingCase.id,
    lmTask.id,
    "Completed",
    realManager,
  );
  assert.equal(afterLm.tasks.find((t) => t.id === lmTask.id)?.status, "Completed");

  // An unrelated employee must not be able to complete employee-new's own Employee-owned
  // task just by holding the base Employee role every employee has.
  const unrelatedEmployee = actor("user-random", "employee-random", "Employee");
  await assert.rejects(
    service.updateTaskStatus(onboardingCase.id, empTask.id, "Completed", unrelatedEmployee),
    /assigned to another person or role/i,
  );
  const self = actor("user-new", "employee-new", "Employee");
  const afterEmp = await service.updateTaskStatus(onboardingCase.id, empTask.id, "Completed", self);
  assert.equal(afterEmp.tasks.find((t) => t.id === empTask.id)?.status, "Completed");
});

test("updateTaskStatus independently verifies generic evidence ownership instead of trusting the caller", async () => {
  const { service, files } = setup();
  const bare = template(service, "generic-evidence", [
    {
      id: "generic",
      title: "Sign off induction checklist",
      group: "HSE & Induction",
      checkpoint: "Pre-Arrival",
      ownerRole: "HR",
      offsetDaysFromStart: -1,
      isMandatory: true,
      requiresEvidence: true,
    },
  ]);
  const onboardingCase = service.createCaseForEmployee("employee-new", hr, {
    templateId: bare.id,
  });
  const task = onboardingCase.tasks[0]!;

  // A fileId that was never uploaded/linked to this case at all is rejected outright.
  await assert.rejects(
    service.updateTaskStatus(
      onboardingCase.id,
      task.id,
      "Completed",
      hr,
      "file-that-does-not-exist",
    ),
    /could not be verified/i,
  );

  // A real file exists but is owned by a DIFFERENT case entirely - still rejected.
  const foreignFile = await files.save(
    {
      blob: new Blob(["x"]),
      name: "evidence.pdf",
      owner: { entityType: "onboarding-case", entityId: "some-other-case" },
    },
    hr,
  );
  await assert.rejects(
    service.updateTaskStatus(onboardingCase.id, task.id, "Completed", hr, foreignFile.id),
    /could not be verified/i,
  );

  // A file genuinely saved against THIS case (the real upload path) is accepted.
  const realFile = await files.save(
    {
      blob: new Blob(["real evidence"]),
      name: "evidence.pdf",
      owner: { entityType: "onboarding-case", entityId: onboardingCase.id },
    },
    hr,
  );
  const updated = await service.updateTaskStatus(
    onboardingCase.id,
    task.id,
    "Completed",
    hr,
    realFile.id,
  );
  assert.equal(updated.tasks.find((t) => t.id === task.id)?.status, "Completed");
});

test("template validation rejects dependency loops and malformed offsets", () => {
  const { service } = setup();
  assert.throws(
    () =>
      template(service, "loop", [
        {
          id: "a",
          title: "First task",
          group: "Manager Plan",
          checkpoint: "Day 30",
          ownerRole: "Line Manager",
          offsetDaysFromStart: 30,
          isMandatory: true,
          requiresEvidence: false,
          dependsOnTaskIds: ["b"],
        },
        {
          id: "b",
          title: "Second task",
          group: "Manager Plan",
          checkpoint: "Day 60",
          ownerRole: "Line Manager",
          offsetDaysFromStart: 60,
          isMandatory: true,
          requiresEvidence: false,
          dependsOnTaskIds: ["a"],
        },
      ]),
    /cannot form a loop/i,
  );
  assert.throws(
    () =>
      template(service, "offset", [
        {
          id: "a",
          title: "Impossible date",
          group: "HSE & Induction",
          checkpoint: "Day 1",
          ownerRole: "HR",
          offsetDaysFromStart: 500,
          isMandatory: true,
          requiresEvidence: false,
        },
      ]),
    /between -365 and 365/i,
  );
});

test("bank and verified-document gates validate underlying employee records", async () => {
  const { service, storage } = setup();
  const custom = template(service, "controlled", [
    {
      id: "upload",
      title: "Upload passport",
      group: "Personal & Legal Documents",
      checkpoint: "Pre-Arrival",
      ownerRole: "Employee",
      offsetDaysFromStart: -7,
      isMandatory: true,
      requiresEvidence: true,
      selfServiceFormKey: "document_upload",
      documentType: "passport",
    },
    {
      id: "verify",
      title: "Verify passport",
      group: "Visa, Work Permit & ID",
      checkpoint: "Pre-Arrival",
      ownerRole: "HR",
      offsetDaysFromStart: -2,
      isMandatory: true,
      requiresEvidence: false,
      dependsOnTaskIds: ["upload"],
      verificationDocumentType: "passport",
    },
    {
      id: "bank",
      title: "Confirm bank details",
      group: "Contract & Payroll",
      checkpoint: "Pre-Arrival",
      ownerRole: "Accounts",
      offsetDaysFromStart: -2,
      isMandatory: true,
      requiresEvidence: false,
      requiresBankDetails: true,
    },
  ]);
  const onboardingCase = service.createCaseForEmployee("employee-new", hr, {
    templateId: custom.id,
  });
  const upload = onboardingCase.tasks.find((task) => task.templateTaskId === "upload")!;
  const verify = onboardingCase.tasks.find((task) => task.templateTaskId === "verify")!;
  const bank = onboardingCase.tasks.find((task) => task.templateTaskId === "bank")!;
  const document: EmployeeDocument = {
    id: "doc-passport",
    employeeId: "employee-new",
    type: "passport",
    fileId: "file-passport",
    visibility: "Restricted",
    status: "Pending Verification",
    createdAt: "2026-08-24T08:00:00.000Z",
    createdBy: "user-new",
    updatedAt: "2026-08-24T08:00:00.000Z",
    updatedBy: "user-new",
    recordVersion: 1,
  };
  storage.writeCollection("employee_documents", [document]);
  await service.updateTaskStatus(
    onboardingCase.id,
    upload.id,
    "Completed",
    actor("user-new", "employee-new", "Employee"),
    document.fileId,
  );
  await assert.rejects(
    service.updateTaskStatus(onboardingCase.id, verify.id, "Completed", hr),
    /Verify the required employee document/i,
  );
  storage.writeCollection("employee_documents", [{ ...document, status: "Valid" }]);
  await service.updateTaskStatus(onboardingCase.id, verify.id, "Completed", hr);
  await assert.rejects(
    service.updateTaskStatus(onboardingCase.id, bank.id, "Completed", accounts),
    /must submit complete bank details/i,
  );
  const employees = storage.readCollection<Employee>("employees");
  storage.writeCollection(
    "employees",
    employees.map((employee) =>
      employee.id === "employee-new"
        ? {
            ...employee,
            bankDetails: { bankName: "Bank Muscat", accountNumber: "001234", iban: "OM120001234" },
          }
        : employee,
    ),
  );
  const updated = await service.updateTaskStatus(onboardingCase.id, bank.id, "Completed", accounts);
  assert.equal(updated.status, "Completed");
});

test("start-date readiness activates the employee while later check-ins remain open", async () => {
  const { service, storage } = setup("2026-08-20");
  const custom = template(service, "activation", [
    {
      id: "ready",
      title: "Confirm readiness",
      group: "HSE & Induction",
      checkpoint: "Pre-Arrival",
      ownerRole: "HR",
      offsetDaysFromStart: -1,
      isMandatory: true,
      requiresEvidence: false,
    },
    {
      id: "later",
      title: "30-day review",
      group: "Manager Plan",
      checkpoint: "Day 30",
      ownerRole: "Line Manager",
      offsetDaysFromStart: 30,
      isMandatory: true,
      requiresEvidence: false,
      dependsOnTaskIds: ["ready"],
    },
  ]);
  const onboardingCase = service.createCaseForEmployee("employee-new", hr, {
    templateId: custom.id,
  });
  const ready = onboardingCase.tasks.find((task) => task.templateTaskId === "ready")!;
  const updated = await service.updateTaskStatus(onboardingCase.id, ready.id, "Completed", hr);
  assert.equal(updated.isReadyForStartDate, true);
  assert.equal(updated.status, "In Progress");
  assert.equal(
    storage.readCollection<Employee>("employees").find((item) => item.id === "employee-new")
      ?.status,
    "Active",
  );
});

test("cancelling onboarding suspends local access and keeps an audit trail", () => {
  const { service, storage, audit } = setup();
  const onboardingCase = service.createCaseForEmployee("employee-new", hr, {
    templateId: "tmpl-default",
  });
  assert.throws(
    () =>
      service.cancelCase(
        onboardingCase.id,
        "Cancelled",
        actor("user-new", "employee-new", "Employee"),
      ),
    /Only HR or a Super Admin/i,
  );
  const cancelled = service.cancelCase(
    onboardingCase.id,
    "Offer conditions were not completed",
    hr,
  );
  assert.equal(cancelled.status, "Cancelled");
  assert.equal(
    storage.readCollection<Employee>("employees").find((item) => item.id === "employee-new")
      ?.status,
    "Inactive",
  );
  assert.equal(
    storage.readCollection<User>("users").find((item) => item.id === "user-new")?.status,
    "Suspended",
  );
  assert.ok(
    audit.list().some((event) => event.action === "access-denied" && event.module === "onboarding"),
  );
});

test.after(() => configureApplicationDataServices(undefined));
