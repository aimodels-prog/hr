import "@tanstack/react-start/server-only";

import { and, asc, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";

import type { AuditActorContext } from "./master-data.repository.server.ts";
import type {
  BankDetails,
  Employee,
  EmployeeSalary,
  EmploymentHistory,
  ProfileChangeRequest,
  Role,
  User,
} from "../../data/types.ts";
import { getDatabaseClient } from "../client.ts";
import { decryptSensitiveJson } from "../encryption.server.ts";
import {
  employeeBankDetails,
  employeeCompensation,
  employees,
  employeeSensitiveIdentifiers,
  employeeReportingLines,
  roles,
  userRoles,
  users,
} from "../schema/employee.ts";
import { employmentChanges, profileChangeRequests } from "../schema/documents.ts";
import { offboardingCases } from "../schema/onboarding-offboarding.ts";
import {
  costCentres,
  departments,
  employmentTypes,
  grades,
  locations,
  positions,
  projects,
} from "../schema/master-data.ts";
import { auditEvents, notifications } from "../schema/system.ts";
import { encryptSensitiveJson } from "../encryption.server.ts";

function iso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : String(value);
}

function requiredIso(value: Date | string): string {
  return iso(value) ?? new Date(0).toISOString();
}

function decryptOptional<T>(value: string | null | undefined): T | undefined {
  return value ? decryptSensitiveJson<T>(value) : undefined;
}

export async function listEmployeesForOrganisation(organisationId: string): Promise<Employee[]> {
  const db = getDatabaseClient();
  const [
    employeeRows,
    departmentRows,
    positionRows,
    gradeRows,
    locationRows,
    employmentTypeRows,
    identifierRows,
    compensationRows,
    bankRows,
  ] = await Promise.all([
    db
      .select()
      .from(employees)
      .where(eq(employees.organisationId, organisationId))
      .orderBy(asc(employees.employeeNumber)),
    db.select().from(departments).where(eq(departments.organisationId, organisationId)),
    db.select().from(positions).where(eq(positions.organisationId, organisationId)),
    db.select().from(grades).where(eq(grades.organisationId, organisationId)),
    db.select().from(locations).where(eq(locations.organisationId, organisationId)),
    db.select().from(employmentTypes).where(eq(employmentTypes.organisationId, organisationId)),
    db
      .select()
      .from(employeeSensitiveIdentifiers)
      .where(eq(employeeSensitiveIdentifiers.organisationId, organisationId)),
    db
      .select()
      .from(employeeCompensation)
      .where(eq(employeeCompensation.organisationId, organisationId)),
    db
      .select()
      .from(employeeBankDetails)
      .where(eq(employeeBankDetails.organisationId, organisationId)),
  ]);

  const names = <T extends { id: string; name: string }>(rows: T[]) =>
    new Map(rows.map((row) => [row.id, row.name]));
  const departmentNames = names(departmentRows);
  const positionNames = names(positionRows);
  const gradeNames = names(gradeRows);
  const locationNames = names(locationRows);
  const employmentTypeNames = names(employmentTypeRows);
  const identifiersByEmployee = new Map(identifierRows.map((row) => [row.employeeId, row]));
  const compensationByEmployee = new Map(compensationRows.map((row) => [row.employeeId, row]));
  const bankByEmployee = new Map(bankRows.map((row) => [row.employeeId, row]));

  return employeeRows.map((row): Employee => {
    const identifiers = identifiersByEmployee.get(row.id);
    const salary = decryptOptional<EmployeeSalary>(
      compensationByEmployee.get(row.id)?.encryptedPayload,
    );
    const bankDetails = decryptOptional<BankDetails>(bankByEmployee.get(row.id)?.encryptedPayload);
    return {
      id: row.id,
      createdAt: requiredIso(row.createdAt),
      createdBy: row.createdBy,
      updatedAt: requiredIso(row.updatedAt),
      updatedBy: row.updatedBy,
      ...(row.archivedAt ? { archivedAt: requiredIso(row.archivedAt) } : {}),
      recordVersion: row.recordVersion,
      employeeNumber: row.employeeNumber,
      legalName: row.legalName,
      preferredName: row.preferredName,
      workEmail: row.workEmail,
      ...(row.personalEmail ? { personalEmail: row.personalEmail } : {}),
      ...(row.phone ? { phone: row.phone } : {}),
      department: departmentNames.get(row.departmentId) ?? "Unavailable",
      position: positionNames.get(row.positionId) ?? "Unavailable",
      ...(row.gradeId ? { grade: gradeNames.get(row.gradeId) ?? "Unavailable" } : {}),
      location: locationNames.get(row.locationId) ?? "Unavailable",
      employmentType: employmentTypeNames.get(row.employmentTypeId) ?? "Unavailable",
      ...(row.lineManagerId ? { lineManagerId: row.lineManagerId } : {}),
      ...(row.projectId ? { projectId: row.projectId } : {}),
      ...(row.costCentreId ? { costCentreId: row.costCentreId } : {}),
      ...(row.country ? { country: row.country } : {}),
      ...(row.legalEntity ? { legalEntity: row.legalEntity } : {}),
      startDate: row.startDate,
      ...(row.probationEndDate ? { probationEndDate: row.probationEndDate } : {}),
      ...(row.staffEntryType ? { staffEntryType: row.staffEntryType } : {}),
      profileSetupStatus: row.profileSetupStatus,
      ...(row.profileSetupCompletedAt
        ? { profileSetupCompletedAt: requiredIso(row.profileSetupCompletedAt) }
        : {}),
      ...(row.proposedLineManagerEmail
        ? { proposedLineManagerEmail: row.proposedLineManagerEmail }
        : {}),
      ...(row.workspaceEmail ? { workspaceEmail: row.workspaceEmail } : {}),
      ...(row.candidateId ? { candidateId: row.candidateId } : {}),
      ...(row.offerId ? { offerId: row.offerId } : {}),
      status: row.status,
      ...(row.address ? { address: row.address } : {}),
      emergencyContacts: row.emergencyContacts,
      dependants: row.dependants,
      ...(row.dateOfBirth ? { dateOfBirth: row.dateOfBirth } : {}),
      ...(row.gender === "Male" || row.gender === "Female" ? { gender: row.gender } : {}),
      ...(row.nationality ? { nationality: row.nationality } : {}),
      ...(row.maritalStatus &&
      ["Single", "Married", "Divorced", "Widowed"].includes(row.maritalStatus)
        ? { maritalStatus: row.maritalStatus as Employee["maritalStatus"] }
        : {}),
      ...(row.terminationDate ? { terminationDate: row.terminationDate } : {}),
      ...(row.terminationReason ? { terminationReason: row.terminationReason } : {}),
      ...(row.weeklyHours !== null ? { weeklyHours: Number(row.weeklyHours) } : {}),
      ...(row.performanceRating !== null
        ? { performanceRating: Number(row.performanceRating) }
        : {}),
      ...(row.performanceNotes ? { performanceNotes: row.performanceNotes } : {}),
      ...(salary ? { salary } : {}),
      ...(bankDetails ? { bankDetails } : {}),
      ...(identifiers?.passportNumberEncrypted
        ? { passportNumber: decryptSensitiveJson<string>(identifiers.passportNumberEncrypted) }
        : {}),
      ...(identifiers?.nationalIdEncrypted
        ? { nationalId: decryptSensitiveJson<string>(identifiers.nationalIdEncrypted) }
        : {}),
      ...(identifiers?.socialInsuranceNumberEncrypted
        ? {
            socialInsuranceNumber: decryptSensitiveJson<string>(
              identifiers.socialInsuranceNumberEncrypted,
            ),
          }
        : {}),
    };
  });
}

export async function listUsersForOrganisation(organisationId: string): Promise<User[]> {
  const db = getDatabaseClient();
  const [userRows, roleRows] = await Promise.all([
    db
      .select()
      .from(users)
      .where(eq(users.organisationId, organisationId))
      .orderBy(asc(users.displayName)),
    db
      .select({ userId: userRoles.userId, code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.organisationId, organisationId)),
  ]);
  const rolesByUser = new Map<string, Role[]>();
  for (const row of roleRows) {
    const assigned = rolesByUser.get(row.userId) ?? [];
    assigned.push(row.code as Role);
    rolesByUser.set(row.userId, assigned);
  }
  return userRows.map((row): User => ({
    id: row.id,
    employeeId: row.employeeId,
    displayName: row.displayName,
    workspaceEmail: row.workspaceEmail,
    ...(row.workspaceSubject ? { workspaceSubject: row.workspaceSubject } : {}),
    roles: rolesByUser.get(row.id) ?? ["Employee"],
    status: row.status,
    createdAt: requiredIso(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: requiredIso(row.updatedAt),
    updatedBy: row.updatedBy,
    ...(row.archivedAt ? { archivedAt: requiredIso(row.archivedAt) } : {}),
    recordVersion: row.recordVersion,
  }));
}

export async function listEmploymentHistoryForOrganisation(
  organisationId: string,
): Promise<EmploymentHistory[]> {
  const rows = await getDatabaseClient()
    .select()
    .from(employmentChanges)
    .where(eq(employmentChanges.organisationId, organisationId))
    .orderBy(asc(employmentChanges.effectiveDate));
  return rows.map((row) => ({
    id: row.id,
    employeeId: row.employeeId,
    effectiveDate: row.effectiveDate,
    field: row.field,
    ...(row.oldValue === null ? {} : { oldValue: row.oldValue }),
    ...(row.newValue === null ? {} : { newValue: row.newValue }),
    reason: row.reason,
    createdAt: requiredIso(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: requiredIso(row.updatedAt),
    updatedBy: row.updatedBy,
    ...(row.archivedAt ? { archivedAt: requiredIso(row.archivedAt) } : {}),
    recordVersion: row.recordVersion,
  }));
}

export async function listProfileChangeRequestsForOrganisation(
  organisationId: string,
): Promise<ProfileChangeRequest[]> {
  const db = getDatabaseClient();
  const [rows, userRows] = await Promise.all([
    db
      .select()
      .from(profileChangeRequests)
      .where(eq(profileChangeRequests.organisationId, organisationId))
      .orderBy(asc(profileChangeRequests.createdAt)),
    db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.organisationId, organisationId)),
  ]);
  const userNames = new Map(userRows.map((row) => [row.id, row.displayName]));
  return rows.map((row) => ({
    id: row.id,
    employeeId: row.employeeId,
    changes: row.changes as Partial<Employee>,
    status: row.status,
    requestedBy: userNames.get(row.requestedBy) ?? "Employee",
    ...(row.reviewerId ? { reviewerId: row.reviewerId } : {}),
    ...(row.reviewedAt ? { reviewedAt: row.reviewedAt } : {}),
    ...(row.reviewNotes ? { reviewNotes: row.reviewNotes } : {}),
    createdAt: requiredIso(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: requiredIso(row.updatedAt),
    updatedBy: row.updatedBy,
    ...(row.archivedAt ? { archivedAt: requiredIso(row.archivedAt) } : {}),
    recordVersion: row.recordVersion,
  }));
}

export async function findEmployeeById(organisationId: string, employeeId: string) {
  const db = getDatabaseClient();
  const [row] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.organisationId, organisationId), eq(employees.id, employeeId)))
    .limit(1);
  return row ?? null;
}

export async function recordEmployeeAccessDenied(
  organisationId: string,
  actor: AuditActorContext,
  action: string,
  entityType: string,
  entityId: string,
  reason: string,
): Promise<void> {
  await getDatabaseClient()
    .insert(auditEvents)
    .values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "access-denied",
      module: "core-hr",
      entityType,
      entityId,
      reason: `${action}: ${reason}`,
      riskLevel: "High",
    });
}

export type PersonalRecordChanges = Pick<
  Partial<Employee>,
  | "preferredName"
  | "phone"
  | "personalEmail"
  | "address"
  | "dateOfBirth"
  | "gender"
  | "nationality"
  | "maritalStatus"
  | "emergencyContacts"
  | "dependants"
>;

function personalEmployeeValues(changes: PersonalRecordChanges) {
  const values: Partial<typeof employees.$inferInsert> = {};
  if (changes.preferredName !== undefined) values.preferredName = changes.preferredName;
  if (changes.phone !== undefined) values.phone = changes.phone || null;
  if (changes.personalEmail !== undefined)
    values.personalEmail = changes.personalEmail?.trim().toLowerCase() || null;
  if (changes.address !== undefined) values.address = changes.address || null;
  if (changes.dateOfBirth !== undefined) values.dateOfBirth = changes.dateOfBirth || null;
  if (changes.gender !== undefined) values.gender = changes.gender || null;
  if (changes.nationality !== undefined) values.nationality = changes.nationality || null;
  if (changes.maritalStatus !== undefined) values.maritalStatus = changes.maritalStatus || null;
  if (changes.emergencyContacts !== undefined) values.emergencyContacts = changes.emergencyContacts;
  if (changes.dependants !== undefined) values.dependants = changes.dependants;
  return values;
}

export async function updatePersonalRecordInDatabase(
  organisationId: string,
  employeeId: string,
  changes: PersonalRecordChanges,
  reason: string,
  actor: AuditActorContext,
): Promise<void> {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin") {
    throw new Error("Only HR or a Super Admin can correct an employee's personal record.");
  }
  const fields = Object.keys(changes);
  if (fields.length === 0) throw new Error("No personal details were changed.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.organisationId, organisationId), eq(employees.id, employeeId)))
      .limit(1);
    if (!current) throw new Error("Employee not found.");
    await tx
      .update(employees)
      .set({
        ...personalEmployeeValues(changes),
        updatedAt: new Date(),
        updatedBy: actor.userId ?? employeeId,
        recordVersion: sql`${employees.recordVersion} + 1`,
      })
      .where(and(eq(employees.organisationId, organisationId), eq(employees.id, employeeId)));
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "update-personal-record",
      module: "core-hr",
      entityType: "employee",
      entityId: employeeId,
      afterSummary: { changedFields: fields },
      reason,
      riskLevel: "High",
    });
  });
}

export async function createProfileChangeRequestInDatabase(
  organisationId: string,
  employeeId: string,
  changes: PersonalRecordChanges,
  actor: AuditActorContext,
): Promise<string> {
  if (actor.employeeId !== employeeId) {
    throw new Error("You can request changes only to your own profile.");
  }
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [employee] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.organisationId, organisationId), eq(employees.id, employeeId)))
      .limit(1);
    if (!employee) throw new Error("Employee not found.");
    const [pending] = await tx
      .select({ id: profileChangeRequests.id })
      .from(profileChangeRequests)
      .where(
        and(
          eq(profileChangeRequests.organisationId, organisationId),
          eq(profileChangeRequests.employeeId, employeeId),
          eq(profileChangeRequests.status, "Pending"),
        ),
      )
      .limit(1);
    if (pending) throw new Error("A profile update is already awaiting HR review.");
    const [request] = await tx
      .insert(profileChangeRequests)
      .values({
        organisationId,
        employeeId,
        changes,
        status: "Pending",
        requestedBy: actor.userId ?? employeeId,
        createdBy: actor.userId ?? employeeId,
        updatedBy: actor.userId ?? employeeId,
      })
      .returning({ id: profileChangeRequests.id });
    if (!request) throw new Error("The profile request could not be saved.");

    const reviewers = await tx
      .selectDistinct({ userId: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(
          eq(users.organisationId, organisationId),
          eq(users.status, "Active"),
          inArray(roles.code, ["HR", "Super Admin"]),
        ),
      );
    for (const reviewer of reviewers) {
      if (reviewer.userId === actor.userId) continue;
      await tx
        .insert(notifications)
        .values({
          organisationId,
          recipientUserId: reviewer.userId,
          type: "profile.review-requested",
          title: "Profile update awaiting review",
          message: `${actor.displayName} submitted changes to their personal details.`,
          priority: "Normal",
          status: "Unread",
          deduplicationKey: `profile-review-${request.id}-${reviewer.userId}`,
          link: {
            entityType: "profile_change_request",
            entityId: request.id,
            path: `/staff/employees/${employeeId}`,
          },
          createdBy: actor.userId ?? employeeId,
          updatedBy: actor.userId ?? employeeId,
        })
        .onConflictDoNothing();
    }
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "submit",
      module: "core-hr",
      entityType: "profile_change_request",
      entityId: request.id,
      afterSummary: { changedFields: Object.keys(changes), status: "Pending" },
      reason: "Employee requested a personal-profile update",
      riskLevel: "Medium",
    });
    return request.id;
  });
}

export async function decideProfileChangeRequestInDatabase(
  organisationId: string,
  requestId: string,
  decision: "Approved" | "Rejected",
  reviewerNotes: string,
  actor: AuditActorContext,
): Promise<void> {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin") {
    throw new Error("Only HR or a Super Admin can review profile changes.");
  }
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(profileChangeRequests)
      .where(
        and(
          eq(profileChangeRequests.organisationId, organisationId),
          eq(profileChangeRequests.id, requestId),
        ),
      )
      .limit(1);
    if (!request || request.status !== "Pending") {
      throw new Error("This profile request is no longer awaiting review.");
    }
    if (request.employeeId === actor.employeeId) {
      throw new Error("You cannot review your own profile change request.");
    }
    const changes = request.changes as PersonalRecordChanges;
    if (decision === "Approved") {
      await tx
        .update(employees)
        .set({
          ...personalEmployeeValues(changes),
          updatedAt: new Date(),
          updatedBy: actor.userId ?? request.employeeId,
          recordVersion: sql`${employees.recordVersion} + 1`,
        })
        .where(
          and(eq(employees.organisationId, organisationId), eq(employees.id, request.employeeId)),
        );
    }
    await tx
      .update(profileChangeRequests)
      .set({
        status: decision,
        reviewerId: actor.userId,
        reviewedAt: new Date().toISOString(),
        reviewNotes: reviewerNotes || null,
        updatedAt: new Date(),
        updatedBy: actor.userId ?? request.employeeId,
        recordVersion: sql`${profileChangeRequests.recordVersion} + 1`,
      })
      .where(eq(profileChangeRequests.id, request.id));
    const [employeeUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(eq(users.organisationId, organisationId), eq(users.employeeId, request.employeeId)),
      )
      .limit(1);
    if (employeeUser) {
      await tx.insert(notifications).values({
        organisationId,
        recipientUserId: employeeUser.id,
        type: `profile.${decision.toLowerCase()}`,
        title: decision === "Approved" ? "Profile update approved" : "Profile update needs changes",
        message:
          decision === "Approved"
            ? "HR approved the changes to your personal details."
            : reviewerNotes,
        priority: decision === "Approved" ? "Normal" : "High",
        status: "Unread",
        deduplicationKey: `profile-decision-${request.id}`,
        link: {
          entityType: "profile_change_request",
          entityId: request.id,
          path: "/staff/me/profile",
        },
        createdBy: actor.userId ?? request.employeeId,
        updatedBy: actor.userId ?? request.employeeId,
      });
    }
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: decision === "Approved" ? "approve" : "reject",
      module: "core-hr",
      entityType: "profile_change_request",
      entityId: request.id,
      beforeSummary: { status: "Pending" },
      afterSummary: { status: decision, changedFields: Object.keys(changes) },
      reason: reviewerNotes || `Profile request ${decision.toLowerCase()}`,
      riskLevel: "High",
    });
  });
}

export async function changeEmployeeStatusInDatabase(
  organisationId: string,
  employeeId: string,
  newStatus: Employee["status"],
  reason: string,
  actor: AuditActorContext,
): Promise<void> {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin") {
    throw new Error("Only HR or a Super Admin can change an employee's status.");
  }
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [employee] = await tx
      .select()
      .from(employees)
      .where(and(eq(employees.organisationId, organisationId), eq(employees.id, employeeId)))
      .limit(1);
    if (!employee) throw new Error("Employee not found.");
    if (employee.status === newStatus) return;

    if (["Notice", "Inactive", "Archived"].includes(newStatus)) {
      const [offboardingCase] = await tx
        .select({ status: offboardingCases.status })
        .from(offboardingCases)
        .where(
          and(
            eq(offboardingCases.organisationId, organisationId),
            eq(offboardingCases.employeeId, employeeId),
            ne(offboardingCases.status, "Cancelled"),
          ),
        )
        .orderBy(sql`${offboardingCases.createdAt} desc`)
        .limit(1);
      const permitted =
        newStatus === "Notice"
          ? offboardingCase?.status === "In Progress" ||
            offboardingCase?.status === "Pending Clearance"
          : offboardingCase?.status === "Completed";
      if (!permitted) {
        throw new Error(
          newStatus === "Notice"
            ? "Start an offboarding case before moving an employee to Notice."
            : "Complete offboarding clearance before making an employee inactive or archived.",
        );
      }
    }

    const now = new Date();
    await tx
      .update(employees)
      .set({
        status: newStatus,
        archivedAt: newStatus === "Archived" ? now : null,
        updatedAt: now,
        updatedBy: actor.userId ?? employeeId,
        recordVersion: sql`${employees.recordVersion} + 1`,
      })
      .where(eq(employees.id, employeeId));
    const userStatus: User["status"] =
      newStatus === "Archived" ? "Archived" : newStatus === "Inactive" ? "Suspended" : "Active";
    await tx
      .update(users)
      .set({
        status: userStatus,
        archivedAt: userStatus === "Archived" ? now : null,
        updatedAt: now,
        updatedBy: actor.userId ?? employeeId,
        recordVersion: sql`${users.recordVersion} + 1`,
      })
      .where(and(eq(users.organisationId, organisationId), eq(users.employeeId, employeeId)));
    await tx.insert(employmentChanges).values({
      organisationId,
      employeeId,
      effectiveDate: now.toISOString().slice(0, 10),
      field: "status",
      oldValue: employee.status,
      newValue: newStatus,
      reason,
      createdBy: actor.userId ?? employeeId,
      updatedBy: actor.userId ?? employeeId,
    });
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: newStatus === "Archived" ? "archive" : "change-status",
      module: "core-hr",
      entityType: "employee",
      entityId: employeeId,
      beforeSummary: { status: employee.status },
      afterSummary: { status: newStatus, userStatus },
      reason,
      riskLevel: "Critical",
    });
  });
}

export async function updateUserAccessInDatabase(
  organisationId: string,
  targetUserId: string,
  requestedRoles: Role[],
  status: User["status"],
  reason: string,
  actor: AuditActorContext,
): Promise<User> {
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(users)
      .where(and(eq(users.organisationId, organisationId), eq(users.id, targetUserId)))
      .limit(1);
    if (!target) throw new Error("User not found.");
    if (target.id === actor.userId) {
      throw new Error("Ask another authorised administrator to change your access.");
    }

    const currentRoleRows = await tx
      .select({ roleId: roles.id, code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(and(eq(userRoles.organisationId, organisationId), eq(userRoles.userId, target.id)));
    const currentRoles = currentRoleRows.map((row) => row.code as Role);
    const desiredRoles = Array.from(new Set<Role>(["Employee", ...requestedRoles]));
    if (actor.activeRole === "HR" && currentRoles.includes("Super Admin")) {
      throw new Error("Only a Super Admin can change a Super Admin account.");
    }
    const changesSuperAdmin =
      currentRoles.includes("Super Admin") !== desiredRoles.includes("Super Admin");
    if (changesSuperAdmin && actor.activeRole !== "Super Admin") {
      throw new Error("Only a Super Admin can grant or remove Super Admin access.");
    }

    if (
      target.status === "Active" &&
      currentRoles.includes("Super Admin") &&
      (status !== "Active" || !desiredRoles.includes("Super Admin"))
    ) {
      const activeSuperAdmins = await tx
        .select({ id: users.id })
        .from(users)
        .innerJoin(userRoles, eq(userRoles.userId, users.id))
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(
          and(
            eq(users.organisationId, organisationId),
            eq(users.status, "Active"),
            eq(roles.code, "Super Admin"),
          ),
        );
      if (activeSuperAdmins.length <= 1) {
        throw new Error("At least one active Super Admin must remain.");
      }
    }

    const [employee] = await tx
      .select({ status: employees.status })
      .from(employees)
      .where(and(eq(employees.organisationId, organisationId), eq(employees.id, target.employeeId)))
      .limit(1);
    if (status === "Active" && employee && ["Inactive", "Archived"].includes(employee.status)) {
      throw new Error("An inactive or archived employee cannot be given active system access.");
    }
    if (!desiredRoles.includes("Line Manager") || status !== "Active") {
      const directReports = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(
            eq(employees.organisationId, organisationId),
            eq(employees.lineManagerId, target.employeeId),
            notInArray(employees.status, ["Inactive", "Archived"]),
          ),
        );
      if (directReports.length > 0) {
        throw new Error(
          `Reassign ${directReports.length} direct report${directReports.length === 1 ? "" : "s"} before removing this supervisor's access.`,
        );
      }
    }

    const desiredRoleRows = await tx.select().from(roles).where(inArray(roles.code, desiredRoles));
    if (desiredRoleRows.length !== desiredRoles.length) {
      throw new Error("One or more requested responsibilities are not configured.");
    }
    for (const role of desiredRoleRows) {
      await tx
        .insert(userRoles)
        .values({
          organisationId,
          userId: target.id,
          roleId: role.id,
          assignedBy: actor.userId ?? target.id,
          reason,
        })
        .onConflictDoNothing();
    }
    const unwantedRoleIds = currentRoleRows
      .filter((row) => !desiredRoles.includes(row.code as Role))
      .map((row) => row.roleId);
    if (unwantedRoleIds.length > 0) {
      await tx
        .delete(userRoles)
        .where(and(eq(userRoles.userId, target.id), inArray(userRoles.roleId, unwantedRoleIds)));
    }
    const now = new Date();
    const [updated] = await tx
      .update(users)
      .set({
        status,
        archivedAt: status === "Archived" ? now : null,
        updatedAt: now,
        updatedBy: actor.userId ?? target.id,
        recordVersion: sql`${users.recordVersion} + 1`,
      })
      .where(and(eq(users.organisationId, organisationId), eq(users.id, target.id)))
      .returning();
    if (!updated) throw new Error("The user access change could not be saved.");

    await tx.insert(notifications).values({
      organisationId,
      recipientUserId: target.id,
      type: "access.changed",
      title: "Your VIA HR access changed",
      message: `Your access is now ${status.toLowerCase()}. Responsibilities: ${desiredRoles.join(", ")}.`,
      priority: status === "Active" ? "Normal" : "High",
      status: "Unread",
      deduplicationKey: `access-change-${target.id}-${updated.recordVersion}`,
      link: { entityType: "user", entityId: target.id, path: "/staff" },
      createdBy: actor.userId ?? target.id,
      updatedBy: actor.userId ?? target.id,
    });
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: status === "Archived" ? "archive" : "update-access",
      module: "user-management",
      entityType: "user",
      entityId: target.id,
      beforeSummary: { status: target.status, roles: currentRoles },
      afterSummary: { status, roles: desiredRoles },
      reason,
      riskLevel: changesSuperAdmin ? "Critical" : "High",
    });

    return {
      id: updated.id,
      employeeId: updated.employeeId,
      displayName: updated.displayName,
      workspaceEmail: updated.workspaceEmail,
      ...(updated.workspaceSubject ? { workspaceSubject: updated.workspaceSubject } : {}),
      roles: desiredRoles,
      status: updated.status,
      createdAt: requiredIso(updated.createdAt),
      createdBy: updated.createdBy,
      updatedAt: requiredIso(updated.updatedAt),
      updatedBy: updated.updatedBy,
      ...(updated.archivedAt ? { archivedAt: requiredIso(updated.archivedAt) } : {}),
      recordVersion: updated.recordVersion,
    };
  });
}

export type CreateEmployeeInput = Omit<
  Employee,
  | "id"
  | "databaseId"
  | "createdAt"
  | "createdBy"
  | "updatedAt"
  | "updatedBy"
  | "recordVersion"
  | "archivedAt"
> & {
  lineManagerId?: string;
  projectId?: string;
  costCentreId?: string;
};

export type EmploymentRecordChanges = Pick<
  Partial<Employee>,
  | "department"
  | "position"
  | "grade"
  | "location"
  | "employmentType"
  | "staffEntryType"
  | "lineManagerId"
  | "projectId"
  | "costCentreId"
  | "startDate"
  | "probationEndDate"
  | "weeklyHours"
  | "salary"
>;

export async function updateEmploymentRecordInDatabase(
  organisationId: string,
  employeeId: string,
  changes: EmploymentRecordChanges,
  effectiveDate: string,
  reason: string,
  actor: AuditActorContext,
): Promise<void> {
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(employees)
      .where(and(eq(employees.organisationId, organisationId), eq(employees.id, employeeId)))
      .limit(1);
    if (!current) throw new Error("Employee not found.");

    const fields = Object.keys(changes) as Array<keyof EmploymentRecordChanges>;
    if (fields.length === 0) throw new Error("Select at least one employment detail to change.");
    const changesSalary = fields.includes("salary");
    const changesEmployment = fields.some((field) => field !== "salary");
    if (changesSalary && actor.activeRole !== "Accounts" && actor.activeRole !== "Super Admin") {
      throw new Error("Only Accounts or a Super Admin can change compensation.");
    }
    if (changesEmployment && actor.activeRole !== "HR" && actor.activeRole !== "Super Admin") {
      throw new Error("Only HR or a Super Admin can change employment details.");
    }

    const resolveNamedMaster = async (
      table:
        | typeof departments
        | typeof positions
        | typeof grades
        | typeof locations
        | typeof employmentTypes,
      name: string | undefined,
      label: string,
    ): Promise<string | null | undefined> => {
      if (name === undefined) return undefined;
      if (!name.trim()) {
        if (label === "grade") return null;
        throw new Error(`Select an active ${label}.`);
      }
      const [record] = await tx
        .select({ id: table.id })
        .from(table)
        .where(
          and(
            eq(table.organisationId, organisationId),
            eq(table.name, name),
            eq(table.isActive, true),
            isNull(table.archivedAt),
          ),
        )
        .limit(1);
      if (!record) throw new Error(`Select an active ${label}.`);
      return record.id;
    };

    const departmentId = await resolveNamedMaster(departments, changes.department, "department");
    const positionId = await resolveNamedMaster(positions, changes.position, "position");
    const gradeId = await resolveNamedMaster(grades, changes.grade, "grade");
    const locationId = await resolveNamedMaster(locations, changes.location, "location");
    const employmentTypeId = await resolveNamedMaster(
      employmentTypes,
      changes.employmentType,
      "employment type",
    );

    if (changes.lineManagerId !== undefined) {
      if (!changes.lineManagerId)
        throw new Error("Every employee must have an assigned supervisor.");
      if (changes.lineManagerId === employeeId)
        throw new Error("An employee cannot report to themselves.");
      const organisationEmployees = await tx
        .select({ id: employees.id, managerId: employees.lineManagerId, status: employees.status })
        .from(employees)
        .where(eq(employees.organisationId, organisationId));
      const manager = organisationEmployees.find((row) => row.id === changes.lineManagerId);
      if (!manager || manager.status === "Archived") {
        throw new Error("Selected supervisor is invalid or archived.");
      }
      const managerByEmployee = new Map(
        organisationEmployees.map((row) => [row.id, row.managerId]),
      );
      let cursor: string | null | undefined = changes.lineManagerId;
      const visited = new Set<string>();
      while (cursor) {
        if (cursor === employeeId)
          throw new Error("The selected supervisor creates a reporting cycle.");
        if (visited.has(cursor))
          throw new Error("The existing reporting structure contains a cycle.");
        visited.add(cursor);
        cursor = managerByEmployee.get(cursor);
      }
    }

    for (const [id, table, label] of [
      [changes.projectId, projects, "project"],
      [changes.costCentreId, costCentres, "cost centre"],
    ] as const) {
      if (id === undefined) continue;
      if (!id) continue;
      const [record] = await tx
        .select({ id: table.id })
        .from(table)
        .where(
          and(
            eq(table.organisationId, organisationId),
            eq(table.id, id),
            eq(table.isActive, true),
            isNull(table.archivedAt),
          ),
        )
        .limit(1);
      if (!record) throw new Error(`Select an active ${label}.`);
    }

    if (changes.salary) {
      if (changes.salary.baseMonthly <= 0 || !changes.salary.currency.trim()) {
        throw new Error("Compensation requires a positive base salary and currency.");
      }
      await tx
        .insert(employeeCompensation)
        .values({
          organisationId,
          employeeId,
          encryptedPayload: encryptSensitiveJson(changes.salary),
          createdBy: actor.userId ?? employeeId,
          updatedBy: actor.userId ?? employeeId,
        })
        .onConflictDoUpdate({
          target: employeeCompensation.employeeId,
          set: {
            encryptedPayload: encryptSensitiveJson(changes.salary),
            updatedAt: new Date(),
            updatedBy: actor.userId ?? employeeId,
            recordVersion: sql`${employeeCompensation.recordVersion} + 1`,
          },
        });
    }

    const updateValues: Partial<typeof employees.$inferInsert> = {
      updatedAt: new Date(),
      updatedBy: actor.userId ?? employeeId,
      recordVersion: sql`${employees.recordVersion} + 1` as never,
    };
    if (departmentId) updateValues.departmentId = departmentId;
    if (positionId) updateValues.positionId = positionId;
    if (gradeId !== undefined) updateValues.gradeId = gradeId;
    if (locationId) updateValues.locationId = locationId;
    if (employmentTypeId) updateValues.employmentTypeId = employmentTypeId;
    if (changes.staffEntryType !== undefined) updateValues.staffEntryType = changes.staffEntryType;
    if (changes.lineManagerId !== undefined) updateValues.lineManagerId = changes.lineManagerId;
    if (changes.projectId !== undefined) updateValues.projectId = changes.projectId || null;
    if (changes.costCentreId !== undefined)
      updateValues.costCentreId = changes.costCentreId || null;
    if (changes.startDate !== undefined) updateValues.startDate = changes.startDate;
    if (changes.probationEndDate !== undefined)
      updateValues.probationEndDate = changes.probationEndDate || null;
    if (changes.weeklyHours !== undefined) updateValues.weeklyHours = String(changes.weeklyHours);
    if (changesEmployment) {
      await tx
        .update(employees)
        .set(updateValues)
        .where(and(eq(employees.organisationId, organisationId), eq(employees.id, employeeId)));
    }

    if (changes.lineManagerId && changes.lineManagerId !== current.lineManagerId) {
      await tx
        .update(employeeReportingLines)
        .set({
          effectiveTo: effectiveDate,
          updatedAt: new Date(),
          updatedBy: actor.userId ?? employeeId,
          recordVersion: sql`${employeeReportingLines.recordVersion} + 1`,
        })
        .where(
          and(
            eq(employeeReportingLines.organisationId, organisationId),
            eq(employeeReportingLines.employeeId, employeeId),
            eq(employeeReportingLines.isPrimary, true),
            isNull(employeeReportingLines.effectiveTo),
            isNull(employeeReportingLines.archivedAt),
          ),
        );
      await tx.insert(employeeReportingLines).values({
        organisationId,
        employeeId,
        supervisorId: changes.lineManagerId,
        effectiveFrom: effectiveDate,
        isPrimary: true,
        reason,
        createdBy: actor.userId ?? employeeId,
        updatedBy: actor.userId ?? employeeId,
      });
    }

    for (const field of fields) {
      const oldValue =
        field === "salary"
          ? "Compensation on file"
          : String(current[field as keyof typeof current] ?? "");
      const nextValue = field === "salary" ? "Compensation updated" : String(changes[field] ?? "");
      if (oldValue === nextValue) continue;
      await tx.insert(employmentChanges).values({
        organisationId,
        employeeId,
        effectiveDate,
        field,
        oldValue,
        newValue: nextValue,
        reason,
        createdBy: actor.userId ?? employeeId,
        updatedBy: actor.userId ?? employeeId,
      });
    }
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "update",
      module: "core-hr",
      entityType: "employee",
      entityId: employeeId,
      beforeSummary: { changedFields: fields },
      afterSummary: { changedFields: fields, effectiveDate },
      reason,
      riskLevel: changesSalary ? "Critical" : "High",
    });
  });
}

export async function createEmployeeInDatabase(
  organisationId: string,
  input: CreateEmployeeInput,
  actor: AuditActorContext,
): Promise<{ employeeId: string; userId: string }> {
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const normalEmail = (input.workspaceEmail || input.workEmail).trim().toLowerCase();
    const [duplicateNumber] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(
        and(
          eq(employees.organisationId, organisationId),
          eq(employees.employeeNumber, input.employeeNumber.trim()),
        ),
      )
      .limit(1);
    if (duplicateNumber)
      throw new Error(`Employee number ${input.employeeNumber} is already in use.`);
    const [duplicateEmail] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.organisationId, organisationId), eq(users.workspaceEmail, normalEmail)))
      .limit(1);
    if (duplicateEmail)
      throw new Error(`Workspace email ${normalEmail} is already assigned to a user.`);

    const [department] = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(
        and(
          eq(departments.organisationId, organisationId),
          eq(departments.name, input.department),
          eq(departments.isActive, true),
          isNull(departments.archivedAt),
        ),
      )
      .limit(1);
    const [position] = await tx
      .select({ id: positions.id })
      .from(positions)
      .where(
        and(
          eq(positions.organisationId, organisationId),
          eq(positions.name, input.position),
          eq(positions.isActive, true),
          isNull(positions.archivedAt),
        ),
      )
      .limit(1);
    const [location] = await tx
      .select({ id: locations.id })
      .from(locations)
      .where(
        and(
          eq(locations.organisationId, organisationId),
          eq(locations.name, input.location),
          eq(locations.isActive, true),
          isNull(locations.archivedAt),
        ),
      )
      .limit(1);
    const [employmentType] = await tx
      .select({ id: employmentTypes.id })
      .from(employmentTypes)
      .where(
        and(
          eq(employmentTypes.organisationId, organisationId),
          eq(employmentTypes.name, input.employmentType),
          eq(employmentTypes.isActive, true),
          isNull(employmentTypes.archivedAt),
        ),
      )
      .limit(1);
    if (!department || !position || !location || !employmentType) {
      throw new Error("Select active department, position, location and employment type values.");
    }
    const [grade] = input.grade
      ? await tx
          .select({ id: grades.id })
          .from(grades)
          .where(
            and(
              eq(grades.organisationId, organisationId),
              eq(grades.name, input.grade),
              eq(grades.isActive, true),
              isNull(grades.archivedAt),
            ),
          )
          .limit(1)
      : [];
    if (input.grade && !grade) throw new Error("Select an active grade.");
    const [employeeCountRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(employees)
      .where(and(eq(employees.organisationId, organisationId), ne(employees.status, "Archived")));
    const employeeCount = employeeCountRow?.count ?? 0;
    if ((employeeCount ?? 0) > 0 && !input.lineManagerId) {
      throw new Error("A supervisor must be assigned before an employee record can be created.");
    }
    if (input.lineManagerId) {
      const [manager] = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(
            eq(employees.organisationId, organisationId),
            eq(employees.id, input.lineManagerId),
            ne(employees.status, "Archived"),
          ),
        )
        .limit(1);
      if (!manager) throw new Error("Selected supervisor is invalid or archived.");
    }
    if (input.projectId) {
      const [project] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.organisationId, organisationId),
            eq(projects.id, input.projectId),
            eq(projects.isActive, true),
            isNull(projects.archivedAt),
          ),
        )
        .limit(1);
      if (!project) throw new Error("Selected project is invalid or inactive.");
    }
    if (input.costCentreId) {
      const [costCentre] = await tx
        .select({ id: costCentres.id })
        .from(costCentres)
        .where(
          and(
            eq(costCentres.organisationId, organisationId),
            eq(costCentres.id, input.costCentreId),
            eq(costCentres.isActive, true),
            isNull(costCentres.archivedAt),
          ),
        )
        .limit(1);
      if (!costCentre) throw new Error("Selected cost centre is invalid or inactive.");
    }

    const now = new Date();
    const [employee] = await tx
      .insert(employees)
      .values({
        organisationId,
        employeeNumber: input.employeeNumber.trim(),
        legalName: input.legalName.trim(),
        preferredName: input.preferredName.trim(),
        workEmail: input.workEmail.trim().toLowerCase(),
        personalEmail: input.personalEmail?.trim().toLowerCase(),
        phone: input.phone?.trim(),
        departmentId: department.id,
        positionId: position.id,
        gradeId: grade?.id,
        locationId: location.id,
        employmentTypeId: employmentType.id,
        lineManagerId: input.lineManagerId,
        projectId: input.projectId,
        costCentreId: input.costCentreId,
        country: input.country,
        legalEntity: input.legalEntity,
        startDate: input.startDate,
        probationEndDate: input.probationEndDate,
        workspaceEmail: normalEmail,
        candidateId: input.candidateId,
        offerId: input.offerId,
        status: input.status,
        address: input.address,
        emergencyContacts: input.emergencyContacts ?? [],
        dependants: input.dependants ?? [],
        dateOfBirth: input.dateOfBirth,
        gender: input.gender,
        nationality: input.nationality,
        maritalStatus: input.maritalStatus,
        terminationDate: input.terminationDate,
        terminationReason: input.terminationReason,
        weeklyHours: input.weeklyHours === undefined ? undefined : String(input.weeklyHours),
        performanceRating:
          input.performanceRating === undefined ? undefined : String(input.performanceRating),
        performanceNotes: input.performanceNotes,
        createdBy: actor.userId ?? organisationId,
        updatedBy: actor.userId ?? organisationId,
      })
      .returning({ id: employees.id });
    if (!employee) throw new Error("The employee record could not be created.");
    const [user] = await tx
      .insert(users)
      .values({
        organisationId,
        employeeId: employee.id,
        displayName: input.preferredName.trim(),
        workspaceEmail: normalEmail,
        status: input.status === "Active" || input.status === "Onboarding" ? "Active" : "Suspended",
        createdBy: actor.userId ?? organisationId,
        updatedBy: actor.userId ?? organisationId,
      })
      .returning({ id: users.id });
    if (!user) throw new Error("The employee access record could not be created.");
    const [employeeRole] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.code, "Employee"));
    if (!employeeRole) throw new Error("The Employee responsibility is not configured.");
    await tx
      .insert(userRoles)
      .values({
        organisationId,
        userId: user.id,
        roleId: employeeRole.id,
        assignedBy: actor.userId ?? user.id,
        reason: "Initial employee access",
      })
      .onConflictDoNothing();
    if (input.lineManagerId) {
      await tx.insert(employeeReportingLines).values({
        organisationId,
        employeeId: employee.id,
        supervisorId: input.lineManagerId,
        effectiveFrom: input.startDate,
        isPrimary: true,
        reason: "Initial supervisor assignment",
        createdBy: actor.userId ?? organisationId,
        updatedBy: actor.userId ?? organisationId,
      });
      const [managerUser] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.employeeId, input.lineManagerId));
      const [managerRole] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.code, "Line Manager"));
      if (managerUser && managerRole) {
        await tx
          .insert(userRoles)
          .values({
            organisationId,
            userId: managerUser.id,
            roleId: managerRole.id,
            assignedBy: actor.userId ?? user.id,
            reason: "Assigned a direct report",
          })
          .onConflictDoNothing();
      }
    }
    await tx.insert(employmentChanges).values({
      organisationId,
      employeeId: employee.id,
      effectiveDate: input.startDate,
      field: "status",
      newValue: input.status,
      reason: "Initial employment",
      createdBy: actor.userId ?? organisationId,
      updatedBy: actor.userId ?? organisationId,
    });
    if (input.salary) {
      await tx.insert(employeeCompensation).values({
        organisationId,
        employeeId: employee.id,
        encryptedPayload: encryptSensitiveJson(input.salary),
        createdBy: actor.userId ?? organisationId,
        updatedBy: actor.userId ?? organisationId,
      });
    }
    if (input.bankDetails) {
      await tx.insert(employeeBankDetails).values({
        organisationId,
        employeeId: employee.id,
        encryptedPayload: encryptSensitiveJson(input.bankDetails),
        createdBy: actor.userId ?? organisationId,
        updatedBy: actor.userId ?? organisationId,
      });
    }
    if (input.passportNumber || input.nationalId || input.socialInsuranceNumber) {
      await tx.insert(employeeSensitiveIdentifiers).values({
        organisationId,
        employeeId: employee.id,
        passportNumberEncrypted: input.passportNumber
          ? encryptSensitiveJson(input.passportNumber)
          : null,
        nationalIdEncrypted: input.nationalId ? encryptSensitiveJson(input.nationalId) : null,
        socialInsuranceNumberEncrypted: input.socialInsuranceNumber
          ? encryptSensitiveJson(input.socialInsuranceNumber)
          : null,
        createdBy: actor.userId ?? organisationId,
        updatedBy: actor.userId ?? organisationId,
      });
    }
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "create",
      module: "core-hr",
      entityType: "employee",
      entityId: employee.id,
      afterSummary: {
        employeeNumber: input.employeeNumber,
        legalName: input.legalName,
        workEmail: input.workEmail,
        status: input.status,
      },
      riskLevel: "High",
    });
    return { employeeId: employee.id, userId: user.id };
  });
}
