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
import type {
  ActorContext,
  Employee,
  EmployeeDocument,
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

function setup(startDate = "2026-08-30") {
  const storage = new VersionedStorageService(new MemoryStorageDriver());
  initializeSeedData(storage);
  const audit = new AuditService(storage);
  const notifications = new NotificationService(storage, audit);
  configureApplicationDataServices({ storage, audit, notifications, files: {} as never });
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
  return { storage, audit, notifications, service: new OnboardingService() };
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

test("bank and verified-document gates validate underlying employee records", () => {
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
  service.updateTaskStatus(
    onboardingCase.id,
    upload.id,
    "Completed",
    actor("user-new", "employee-new", "Employee"),
    document.fileId,
  );
  assert.throws(
    () => service.updateTaskStatus(onboardingCase.id, verify.id, "Completed", hr),
    /Verify the required employee document/i,
  );
  storage.writeCollection("employee_documents", [{ ...document, status: "Valid" }]);
  service.updateTaskStatus(onboardingCase.id, verify.id, "Completed", hr);
  assert.throws(
    () => service.updateTaskStatus(onboardingCase.id, bank.id, "Completed", accounts),
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
  const updated = service.updateTaskStatus(onboardingCase.id, bank.id, "Completed", accounts);
  assert.equal(updated.status, "Completed");
});

test("start-date readiness activates the employee while later check-ins remain open", () => {
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
  const updated = service.updateTaskStatus(onboardingCase.id, ready.id, "Completed", hr);
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
