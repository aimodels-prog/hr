import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import { getRolePermissions, type CurrentUserContext } from "../auth/permissions.ts";
import { redactEmployee } from "../auth/redaction.ts";
import {
  createEmployeeInDatabase,
  changeEmployeeStatusInDatabase,
  createProfileChangeRequestInDatabase,
  decideProfileChangeRequestInDatabase,
  type CreateEmployeeInput,
  type EmploymentRecordChanges,
  listEmployeesForOrganisation,
  listEmploymentHistoryForOrganisation,
  listProfileChangeRequestsForOrganisation,
  listUsersForOrganisation,
  recordEmployeeAccessDenied,
  type PersonalRecordChanges,
  updatePersonalRecordInDatabase,
  updateUserAccessInDatabase,
  updateEmploymentRecordInDatabase,
} from "../db/repositories/employee.repository.server.ts";
import { resolveOrganisationIdForActor, verifyServerActorRole } from "../db/utils.server.ts";
import {
  ROLE_VALUES,
  type Employee,
  type EmploymentHistory,
  type ProfileChangeRequest,
  type Role,
  type User,
} from "../data/types.ts";

const SnapshotInput = z
  .object({
    actorId: z.string().min(1),
    actorEmail: z.string().email().optional(),
    activeRole: z.enum(ROLE_VALUES),
  })
  .strict();

export interface CoreHrSnapshot {
  employees: Employee[];
  users: User[];
  employmentHistory: EmploymentHistory[];
  profileChangeRequests: ProfileChangeRequest[];
}

export const getCoreHrSnapshotFn = createServerFn({ method: "POST" })
  .validator((input: z.infer<typeof SnapshotInput>) => SnapshotInput.parse(input))
  .handler(async ({ data }): Promise<CoreHrSnapshot> => {
    const organisationId = await resolveOrganisationIdForActor(data.actorId, data.actorEmail);
    const verification = await verifyServerActorRole(
      organisationId,
      data.actorId,
      undefined,
      data.actorEmail,
    );
    if (!verification.verified || !verification.actor) {
      throw new Error("Your VIA HR user is not active or is not linked to this organisation.");
    }
    if (!verification.actor.roles.includes(data.activeRole as Role)) {
      throw new Error("The selected responsibility is not assigned to your user account.");
    }

    const actor = verification.actor;
    const viewer: CurrentUserContext = {
      userId: actor.userId,
      employeeId: actor.employeeId,
      displayName: actor.displayName,
      workspaceEmail: actor.workspaceEmail,
      assignedRoles: actor.roles,
      activeRole: data.activeRole,
      permissions: getRolePermissions(data.activeRole),
    };
    const [employees, allUsers, employmentHistory, allProfileChangeRequests] = await Promise.all([
      listEmployeesForOrganisation(organisationId),
      listUsersForOrganisation(organisationId),
      listEmploymentHistoryForOrganisation(organisationId),
      listProfileChangeRequestsForOrganisation(organisationId),
    ]);

    return {
      employees: employees.map((employee) => redactEmployee(employee, viewer)),
      users:
        data.activeRole === "HR" || data.activeRole === "Super Admin"
          ? allUsers
          : allUsers.filter((user) => user.id === actor.userId),
      employmentHistory: employmentHistory.filter((entry) => {
        const employee = employees.find((item) => item.id === entry.employeeId);
        if (!employee) return false;
        if (entry.field !== "salary") return true;
        return (
          actor.employeeId === entry.employeeId ||
          data.activeRole === "Accounts" ||
          data.activeRole === "Super Admin"
        );
      }),
      profileChangeRequests:
        data.activeRole === "HR" || data.activeRole === "Super Admin"
          ? allProfileChangeRequests
          : allProfileChangeRequests.filter((request) => request.employeeId === actor.employeeId),
    };
  });

const ActorInput = z
  .object({
    actorId: z.string().min(1),
    actorEmail: z.string().email().optional(),
    activeRole: z.enum(ROLE_VALUES),
  })
  .strict();

const UserAccessInput = z
  .object({
    actor: ActorInput,
    userId: z.string().uuid(),
    roles: z.array(z.enum(ROLE_VALUES)),
    status: z.enum(["Active", "Suspended", "Archived"]),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();

export const updateUserAccessFn = createServerFn({ method: "POST" })
  .validator((input: z.infer<typeof UserAccessInput>) => UserAccessInput.parse(input))
  .handler(async ({ data }): Promise<User> => {
    const organisationId = await resolveOrganisationIdForActor(
      data.actor.actorId,
      data.actor.actorEmail,
    );
    const verification = await verifyServerActorRole(
      organisationId,
      data.actor.actorId,
      undefined,
      data.actor.actorEmail,
    );
    if (!verification.verified || !verification.actor) {
      throw new Error("Only HR or a Super Admin can change user access.");
    }
    if (!verification.actor.roles.some((role) => role === "HR" || role === "Super Admin")) {
      await recordEmployeeAccessDenied(
        organisationId,
        { ...verification.actor, activeRole: data.actor.activeRole },
        "change user access",
        "user",
        data.userId,
        "Only HR or a Super Admin can change user access.",
      );
      throw new Error("Only HR or a Super Admin can change user access.");
    }
    if (!verification.actor.roles.includes(data.actor.activeRole)) {
      await recordEmployeeAccessDenied(
        organisationId,
        { ...verification.actor, activeRole: data.actor.activeRole },
        "change user access",
        "user",
        data.userId,
        "The selected responsibility is not assigned to this account.",
      );
      throw new Error("The selected responsibility is not assigned to your account.");
    }
    return updateUserAccessInDatabase(
      organisationId,
      data.userId,
      data.roles,
      data.status,
      data.reason,
      { ...verification.actor, activeRole: data.actor.activeRole },
    );
  });

const EmployeeInput = z
  .object({
    employeeNumber: z.string().trim().min(1).max(40),
    legalName: z.string().trim().min(1).max(200),
    preferredName: z.string().trim().min(1).max(120),
    workEmail: z.string().trim().email(),
    personalEmail: z.string().trim().email().optional(),
    phone: z.string().trim().max(40).optional(),
    department: z.string().trim().min(1),
    position: z.string().trim().min(1),
    grade: z.string().trim().optional(),
    location: z.string().trim().min(1),
    country: z.string().trim().optional(),
    legalEntity: z.string().trim().optional(),
    employmentType: z.string().trim().min(1),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    probationEndDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    lineManagerId: z.string().uuid().optional(),
    workspaceEmail: z.string().trim().email().optional(),
    candidateId: z.string().uuid().optional(),
    offerId: z.string().uuid().optional(),
    status: z.enum(["Onboarding", "Active", "Probation", "Notice", "Inactive", "Archived"]),
    projectId: z.string().uuid().optional(),
    costCentreId: z.string().uuid().optional(),
    address: z.string().trim().max(1000).optional(),
    emergencyContacts: z
      .array(
        z
          .object({
            name: z.string().trim().min(1),
            relationship: z.string().trim().min(1),
            phone: z.string().trim().min(1),
            email: z.string().email().optional(),
          })
          .strict(),
      )
      .optional(),
    dependants: z
      .array(
        z
          .object({
            name: z.string().trim().min(1),
            relationship: z.string().trim().min(1),
            dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          })
          .strict(),
      )
      .optional(),
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    gender: z.enum(["Male", "Female"]).optional(),
    nationality: z.string().trim().optional(),
    maritalStatus: z.enum(["Single", "Married", "Divorced", "Widowed"]).optional(),
    terminationDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    terminationReason: z.string().trim().optional(),
    weeklyHours: z.number().positive().max(168).optional(),
    socialInsuranceNumber: z.string().trim().optional(),
    passportNumber: z.string().trim().optional(),
    nationalId: z.string().trim().optional(),
    performanceRating: z.number().min(0).max(5).optional(),
    performanceNotes: z.string().trim().optional(),
    salary: z
      .object({
        baseMonthly: z.number().nonnegative(),
        currency: z.string().trim().length(3),
        housingAllowance: z.number().nonnegative().optional(),
        transportAllowance: z.number().nonnegative().optional(),
        otherAllowances: z
          .array(z.object({ label: z.string().trim().min(1), amount: z.number().nonnegative() }))
          .optional(),
        payFrequency: z.enum(["Monthly", "Biweekly", "Weekly"]).optional(),
        paymentMethod: z.enum(["Bank Transfer", "Cheque", "Cash"]).optional(),
      })
      .strict()
      .optional(),
    bankDetails: z
      .object({
        bankName: z.string().trim().min(1),
        accountNumber: z.string().trim().min(1),
        iban: z.string().trim().min(1),
        swiftCode: z.string().trim().optional(),
        branch: z.string().trim().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const CreateEmployeeRequest = z.object({ actor: ActorInput, employee: EmployeeInput }).strict();

export const createEmployeeFn = createServerFn({ method: "POST" })
  .validator((input: z.infer<typeof CreateEmployeeRequest>) => CreateEmployeeRequest.parse(input))
  .handler(async ({ data }) => {
    const organisationId = await resolveOrganisationIdForActor(
      data.actor.actorId,
      data.actor.actorEmail,
    );
    const verification = await verifyServerActorRole(
      organisationId,
      data.actor.actorId,
      undefined,
      data.actor.actorEmail,
    );
    if (!verification.verified || !verification.actor) {
      throw new Error("Only HR or a Super Admin can add employees.");
    }
    if (!verification.actor.roles.some((role) => role === "HR" || role === "Super Admin")) {
      await recordEmployeeAccessDenied(
        organisationId,
        { ...verification.actor, activeRole: data.actor.activeRole },
        "add employee",
        "employee",
        "new-employee",
        "Only HR or a Super Admin can add employees.",
      );
      throw new Error("Only HR or a Super Admin can add employees.");
    }
    if (!verification.actor.roles.includes(data.actor.activeRole)) {
      await recordEmployeeAccessDenied(
        organisationId,
        { ...verification.actor, activeRole: data.actor.activeRole },
        "add employee",
        "employee",
        "new-employee",
        "The selected responsibility is not assigned to this account.",
      );
      throw new Error("The selected responsibility is not assigned to your account.");
    }
    if (
      (data.employee.salary || data.employee.socialInsuranceNumber) &&
      data.actor.activeRole !== "Super Admin"
    ) {
      await recordEmployeeAccessDenied(
        organisationId,
        { ...verification.actor, activeRole: data.actor.activeRole },
        "set compensation while adding employee",
        "employee",
        "new-employee",
        "Only a Super Admin can set salary or social-insurance details.",
      );
      throw new Error(
        "Only a Super Admin can set salary or social-insurance details while creating an employee.",
      );
    }
    if (
      data.employee.probationEndDate &&
      data.employee.probationEndDate < data.employee.startDate
    ) {
      throw new Error("Probation end date cannot be before start date.");
    }
    return createEmployeeInDatabase(organisationId, data.employee as CreateEmployeeInput, {
      ...verification.actor,
      activeRole: data.actor.activeRole,
    });
  });

const EmploymentChangesInput = z
  .object({
    department: z.string().trim().min(1).optional(),
    position: z.string().trim().min(1).optional(),
    grade: z.string().trim().optional(),
    location: z.string().trim().min(1).optional(),
    employmentType: z.string().trim().min(1).optional(),
    lineManagerId: z.string().uuid().optional(),
    projectId: z.string().uuid().or(z.literal("")).optional(),
    costCentreId: z.string().uuid().or(z.literal("")).optional(),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    probationEndDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .or(z.literal(""))
      .optional(),
    weeklyHours: z.number().positive().max(168).optional(),
    salary: EmployeeInput.shape.salary,
  })
  .strict()
  .refine((changes) => Object.keys(changes).length > 0, "Select at least one detail to change.");

const UpdateEmploymentRequest = z
  .object({
    actor: ActorInput,
    employeeId: z.string().uuid(),
    changes: EmploymentChangesInput,
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();

export const updateEmploymentRecordFn = createServerFn({ method: "POST" })
  .validator((input: z.infer<typeof UpdateEmploymentRequest>) =>
    UpdateEmploymentRequest.parse(input),
  )
  .handler(async ({ data }) => {
    const organisationId = await resolveOrganisationIdForActor(
      data.actor.actorId,
      data.actor.actorEmail,
    );
    const verification = await verifyServerActorRole(
      organisationId,
      data.actor.actorId,
      undefined,
      data.actor.actorEmail,
    );
    if (!verification.verified || !verification.actor) {
      throw new Error("Your VIA HR user is not active or linked to this organisation.");
    }
    if (!verification.actor.roles.includes(data.actor.activeRole)) {
      await recordEmployeeAccessDenied(
        organisationId,
        { ...verification.actor, activeRole: data.actor.activeRole },
        "update employment record",
        "employee",
        data.employeeId,
        "The selected responsibility is not assigned to this account.",
      );
      throw new Error("The selected responsibility is not assigned to your account.");
    }
    await updateEmploymentRecordInDatabase(
      organisationId,
      data.employeeId,
      data.changes as EmploymentRecordChanges,
      data.effectiveDate,
      data.reason,
      { ...verification.actor, activeRole: data.actor.activeRole },
    );
  });

const PersonalChangesInput = EmployeeInput.pick({
  preferredName: true,
  phone: true,
  personalEmail: true,
  address: true,
  dateOfBirth: true,
  gender: true,
  nationality: true,
  maritalStatus: true,
  emergencyContacts: true,
  dependants: true,
})
  .partial()
  .strict()
  .refine((changes) => Object.keys(changes).length > 0, "No personal details were changed.");

const PersonalRecordRequest = z
  .object({
    actor: ActorInput,
    employeeId: z.string().uuid(),
    changes: PersonalChangesInput,
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();

async function verifyEmployeeActor(data: z.infer<typeof ActorInput>) {
  const organisationId = await resolveOrganisationIdForActor(data.actorId, data.actorEmail);
  const verification = await verifyServerActorRole(
    organisationId,
    data.actorId,
    undefined,
    data.actorEmail,
  );
  if (!verification.verified || !verification.actor) {
    throw new Error("Your VIA HR user is not active or linked to this organisation.");
  }
  if (!verification.actor.roles.includes(data.activeRole)) {
    throw new Error("The selected responsibility is not assigned to your account.");
  }
  return { organisationId, actor: { ...verification.actor, activeRole: data.activeRole } };
}

export const updatePersonalRecordFn = createServerFn({ method: "POST" })
  .validator((input: z.infer<typeof PersonalRecordRequest>) => PersonalRecordRequest.parse(input))
  .handler(async ({ data }) => {
    const verified = await verifyEmployeeActor(data.actor);
    await updatePersonalRecordInDatabase(
      verified.organisationId,
      data.employeeId,
      data.changes as PersonalRecordChanges,
      data.reason,
      verified.actor,
    );
  });

const ProfileRequestInput = PersonalRecordRequest.omit({ reason: true });

export const createProfileChangeRequestFn = createServerFn({ method: "POST" })
  .validator((input: z.infer<typeof ProfileRequestInput>) => ProfileRequestInput.parse(input))
  .handler(async ({ data }) => {
    const verified = await verifyEmployeeActor(data.actor);
    return createProfileChangeRequestInDatabase(
      verified.organisationId,
      data.employeeId,
      data.changes as PersonalRecordChanges,
      verified.actor,
    );
  });

const ProfileDecisionInput = z
  .object({
    actor: ActorInput,
    requestId: z.string().uuid(),
    decision: z.enum(["Approved", "Rejected"]),
    reviewerNotes: z.string().trim().max(1000),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.decision === "Rejected" && data.reviewerNotes.length < 3) {
      ctx.addIssue({
        code: "custom",
        path: ["reviewerNotes"],
        message: "A rejection reason is required.",
      });
    }
  });

export const decideProfileChangeRequestFn = createServerFn({ method: "POST" })
  .validator((input: z.infer<typeof ProfileDecisionInput>) => ProfileDecisionInput.parse(input))
  .handler(async ({ data }) => {
    const verified = await verifyEmployeeActor(data.actor);
    await decideProfileChangeRequestInDatabase(
      verified.organisationId,
      data.requestId,
      data.decision,
      data.reviewerNotes,
      verified.actor,
    );
  });

const EmployeeStatusRequest = z
  .object({
    actor: ActorInput,
    employeeId: z.string().uuid(),
    status: EmployeeInput.shape.status,
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();

export const changeEmployeeStatusFn = createServerFn({ method: "POST" })
  .validator((input: z.infer<typeof EmployeeStatusRequest>) => EmployeeStatusRequest.parse(input))
  .handler(async ({ data }) => {
    const verified = await verifyEmployeeActor(data.actor);
    await changeEmployeeStatusInDatabase(
      verified.organisationId,
      data.employeeId,
      data.status,
      data.reason,
      verified.actor,
    );
  });
