import "@tanstack/react-start/server-only";
import { isCeoPosition, validateCeoSupervisor } from "../../data/executive-reporting.ts";
import {
  changedRecordFields,
  changeReason,
  employmentReasonRequired,
  personalReasonRequired,
} from "../../data/change-reason-policy.ts";
import { syncEmployeeAttendanceTracking } from "./attendance-tracking.repository.server.ts";

import { and, asc, eq, inArray, isNull, lte, ne, notInArray, sql } from "drizzle-orm";
import {
  canManageEmploymentFields,
  employmentCalendarDate,
  sameEmploymentValue,
  validateEmploymentEffectiveDate,
  type EmploymentChangeResult,
  type ScheduledEmploymentChangeView,
} from "../../data/employment-change-policy.ts";

import type { AuditActorContext } from "./master-data.repository.server.ts";
import {
  assignSupervisorApprovalAccess,
  validateSupervisorAccount,
} from "./supervisor-access.repository.server.ts";
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
import { scheduledEmploymentChanges } from "../schema/employment-schedule.ts";
import { appSettings, organisations } from "../schema/organisation.ts";

type EmploymentTransaction = Parameters<
  Parameters<ReturnType<typeof getDatabaseClient>["transaction"]>[0]
>[0];
type ScheduledEmploymentChange = typeof scheduledEmploymentChanges.$inferSelect;

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
      ...(row.visaRequired !== null ? { visaRequired: row.visaRequired } : {}),
      profileSetupStatus: row.profileSetupStatus,
      ...(row.profileSetupCompletedAt
        ? { profileSetupCompletedAt: requiredIso(row.profileSetupCompletedAt) }
        : {}),
      employmentConfirmationStatus: row.employmentConfirmationStatus,
      ...(row.employmentConfirmedAt
        ? { employmentConfirmedAt: requiredIso(row.employmentConfirmedAt) }
        : {}),
      ...(row.employmentConfirmedBy ? { employmentConfirmedBy: row.employmentConfirmedBy } : {}),
      ...(row.employmentReviewNote ? { employmentReviewNote: row.employmentReviewNote } : {}),
      ...(row.proposedEmploymentDetails
        ? { proposedEmploymentDetails: row.proposedEmploymentDetails }
        : {}),
      ...(row.proposedLineManagerEmail
        ? { proposedLineManagerEmail: row.proposedLineManagerEmail }
        : {}),
      ...(row.workspaceEmail ? { workspaceEmail: row.workspaceEmail } : {}),
      ...(row.candidateId ? { candidateId: row.candidateId } : {}),
      ...(row.offerId ? { offerId: row.offerId } : {}),
      status: row.status,
      ...(row.address ? { address: row.address } : {}),
      ...(row.homeCountryPhone ? { homeCountryPhone: row.homeCountryPhone } : {}),
      ...(row.homeCountryAddress ? { homeCountryAddress: row.homeCountryAddress } : {}),
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
  actor: AuditActorContext,
): Promise<EmploymentHistory[]> {
  if (!actor?.userId || !actor.activeRole || !actor.roles?.includes(actor.activeRole))
    throw new Error("Verified employee-history access is required.");
  const role = actor.activeRole;
  const self = actor.employeeId ?? null;
  const rows = await getDatabaseClient()
    .select()
    .from(employmentChanges)
    .where(
      and(
        eq(employmentChanges.organisationId, organisationId),
        isNull(employmentChanges.archivedAt),
        sql`(
        ${employmentChanges.employeeId} = ${self}::uuid
        OR ${role} = 'Super Admin'
        OR (${employmentChanges.field} = 'salary' AND ${role} = 'Accounts')
        OR (${employmentChanges.field} <> 'salary' AND (
          ${role} = 'HR'
          OR (${role} = 'Line Manager' AND EXISTS (
            SELECT 1 FROM employees e WHERE e.id = ${employmentChanges.employeeId}
            AND e.organisation_id = ${organisationId} AND e.line_manager_id = ${self}::uuid
            AND e.archived_at IS NULL
          ))
        ))
      )`,
      ),
    )
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
  | "homeCountryPhone"
  | "homeCountryAddress"
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
  if (changes.homeCountryPhone !== undefined)
    values.homeCountryPhone = changes.homeCountryPhone || null;
  if (changes.homeCountryAddress !== undefined)
    values.homeCountryAddress = changes.homeCountryAddress || null;
  if (changes.dateOfBirth !== undefined) values.dateOfBirth = changes.dateOfBirth || null;
  if (changes.gender !== undefined) values.gender = changes.gender || null;
  if (changes.nationality !== undefined) values.nationality = changes.nationality || null;
  if (changes.maritalStatus !== undefined) values.maritalStatus = changes.maritalStatus || null;
  if (changes.emergencyContacts !== undefined) values.emergencyContacts = changes.emergencyContacts;
  if (changes.dependants !== undefined)
    values.dependants = changes.dependants.map((d) => ({ ...d, id: d.id ?? crypto.randomUUID() }));
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
  let fields = Object.keys(changes);
  if (fields.length === 0) throw new Error("No personal details were changed.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(employees)
      .where(and(eq(employees.organisationId, organisationId), eq(employees.id, employeeId)))
      .for("update")
      .limit(1);
    if (!current) throw new Error("Employee not found.");
    fields = changedRecordFields({ ...current }, { ...changes });
    if (!fields.length) throw new Error("No personal details were changed.");
    reason = changeReason(reason, personalReasonRequired(fields), "Personal details updated by HR");
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
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin") {
    throw new Error("Only HR or a Super Admin can change user access.");
  }
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(users)
      .where(and(eq(users.organisationId, organisationId), eq(users.id, targetUserId)))
      .limit(1)
      .for("update");
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
    reason = reason.trim() || "User access updated by administrator";
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

    if (desiredRoles.includes("Travel Admin"))
      await tx
        .insert(roles)
        .values({
          code: "Travel Admin",
          description: "Arrange Finance-approved travel bookings",
          createdBy: actor.userId!,
          updatedBy: actor.userId!,
        })
        .onConflictDoNothing();
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
  lineManagerId?: string | null;
  projectId?: string;
  costCentreId?: string;
};

export type EmploymentRecordChanges = Omit<
  Pick<
    Partial<Employee>,
    | "department"
    | "position"
    | "grade"
    | "location"
    | "employmentType"
    | "staffEntryType"
    | "visaRequired"
    | "lineManagerId"
    | "projectId"
    | "costCentreId"
    | "startDate"
    | "probationEndDate"
    | "weeklyHours"
    | "salary"
  >,
  "lineManagerId"
> & { lineManagerId?: string | null | undefined };

export async function updateEmploymentRecordInDatabase(
  organisationId: string,
  employeeId: string,
  changes: EmploymentRecordChanges,
  effectiveDate: string,
  reason: string,
  actor: AuditActorContext,
  now = new Date(),
): Promise<EmploymentChangeResult> {
  return getDatabaseClient().transaction((tx) =>
    applyEmploymentRecord(
      tx,
      organisationId,
      employeeId,
      changes,
      effectiveDate,
      reason,
      actor,
      now,
    ),
  );
}

async function applyEmploymentRecord(
  tx: EmploymentTransaction,
  organisationId: string,
  employeeId: string,
  changes: EmploymentRecordChanges,
  effectiveDate: string,
  reason: string,
  actor: AuditActorContext,
  now: Date,
  scheduled?: ScheduledEmploymentChange,
): Promise<EmploymentChangeResult> {
  validateEmploymentEffectiveDate(effectiveDate);
  // Also serialises reporting-line checks across employees, and schedule cancellation/application.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`employment:${organisationId}`}, 0))`,
  );
  const [current] = await tx
    .select()
    .from(employees)
    .where(and(eq(employees.organisationId, organisationId), eq(employees.id, employeeId)))
    .for("update")
    .limit(1);
  if (!current) throw new Error("Employee not found.");
  if (current.archivedAt || ["Archived", "Inactive"].includes(current.status))
    throw new Error("Employment changes cannot be applied to an inactive or archived employee.");

  let fields = Object.keys(changes).filter(
    (field) => changes[field as keyof EmploymentRecordChanges] !== undefined,
  ) as Array<keyof EmploymentRecordChanges>;
  if (fields.length === 0) throw new Error("Select at least one employment detail to change.");
  const changesSalary = fields.includes("salary");
  const changesEmployment = fields.some((field) => field !== "salary");
  if (changesSalary && actor.activeRole !== "Accounts" && actor.activeRole !== "Super Admin") {
    throw new Error("Only Accounts or a Super Admin can change compensation.");
  }
  if (changesEmployment && actor.activeRole !== "HR" && actor.activeRole !== "Super Admin") {
    throw new Error("Only HR or a Super Admin can change employment details.");
  }
  if (!canManageEmploymentFields(actor.activeRole, fields))
    throw new Error("This workflow can change employment details only.");
  const [settings] = await tx
    .select({ timezone: appSettings.timezone })
    .from(appSettings)
    .where(eq(appSettings.organisationId, organisationId))
    .limit(1);
  if (!settings)
    throw new Error("Configure the organisation timezone before changing employment details.");
  const today = employmentCalendarDate(settings.timezone, now);
  if (scheduled && effectiveDate > today) throw new Error("This employment change is not due yet.");

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
  if (changes.position !== undefined || changes.lineManagerId !== undefined) {
    const [currentPosition] = await tx
      .select({ name: positions.name })
      .from(positions)
      .where(eq(positions.id, current.positionId))
      .limit(1);
    validateCeoSupervisor(
      changes.position ?? currentPosition?.name ?? "",
      changes.lineManagerId === undefined ? current.lineManagerId : changes.lineManagerId,
    );
  }
  const gradeId = await resolveNamedMaster(grades, changes.grade, "grade");
  const locationId = await resolveNamedMaster(locations, changes.location, "location");
  const employmentTypeId = await resolveNamedMaster(
    employmentTypes,
    changes.employmentType,
    "employment type",
  );

  if (changes.lineManagerId !== undefined && changes.lineManagerId !== null) {
    await validateSupervisorAccount(
      tx,
      organisationId,
      employeeId,
      changes.lineManagerId,
      "update",
    );
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
    const managerByEmployee = new Map(organisationEmployees.map((row) => [row.id, row.managerId]));
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
  }
  const [compensation] = changes.salary
    ? await tx
        .select()
        .from(employeeCompensation)
        .where(
          and(
            eq(employeeCompensation.organisationId, organisationId),
            eq(employeeCompensation.employeeId, employeeId),
          ),
        )
    : [];
  const previous: Record<string, unknown> = {
    ...current,
    department: current.departmentId,
    position: current.positionId,
    location: current.locationId,
    grade: current.gradeId,
    employmentType: current.employmentTypeId,
    weeklyHours: current.weeklyHours === null ? null : Number(current.weeklyHours),
    salary: compensation ? decryptSensitiveJson(compensation.encryptedPayload) : null,
  };
  const proposed: Record<string, unknown> = {
    ...changes,
    department: departmentId,
    position: positionId,
    grade: gradeId,
    location: locationId,
    employmentType: employmentTypeId,
  };
  if (scheduled) {
    const payload = decryptSensitiveJson<{ baseline: Record<string, unknown> }>(
      scheduled.encryptedPayload,
    );
    if (fields.some((field) => !sameEmploymentValue(previous[field], payload.baseline[field])))
      throw new Error(
        "The employee details have changed since this change was scheduled. Review and schedule a new change.",
      );
  }
  if (changes.lineManagerId && effectiveDate <= today) {
    await assignSupervisorApprovalAccess(
      tx,
      organisationId,
      employeeId,
      changes.lineManagerId,
      actor,
    );
  }
  fields = fields.filter((field) => !sameEmploymentValue(previous[field], proposed[field]));
  if (fields.length === 0) return { status: "Applied", effectiveDate };
  reason = changeReason(
    reason,
    employmentReasonRequired(fields, current.employmentConfirmationStatus),
    "Employment details updated by HR",
  );
  changes = Object.fromEntries(
    fields.map((field) => [field, changes[field]]),
  ) as EmploymentRecordChanges;
  const pending = await tx
    .select({ id: scheduledEmploymentChanges.id, fields: scheduledEmploymentChanges.fields })
    .from(scheduledEmploymentChanges)
    .where(
      and(
        eq(scheduledEmploymentChanges.organisationId, organisationId),
        eq(scheduledEmploymentChanges.employeeId, employeeId),
        eq(scheduledEmploymentChanges.status, "Pending"),
      ),
    );
  if (
    pending.some(
      (entry) => entry.id !== scheduled?.id && fields.some((field) => entry.fields.includes(field)),
    )
  )
    throw new Error(
      "A pending change already covers these details. Cancel that scheduled change before replacing it.",
    );
  if (effectiveDate > today) {
    await tx.insert(scheduledEmploymentChanges).values({
      organisationId,
      employeeId,
      effectiveDate,
      fields,
      encryptedPayload: encryptSensitiveJson({
        changes,
        baseline: Object.fromEntries(fields.map((field) => [field, previous[field] ?? null])),
      }),
      reason: reason.trim(),
      authorRole: actor.activeRole,
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
      action: "schedule",
      module: "core-hr",
      entityType: "employee",
      entityId: employeeId,
      afterSummary: { changedFields: fields, effectiveDate, status: "Pending" },
      reason: reason.trim(),
      riskLevel: changesSalary ? "Critical" : "High",
    });
    return { status: "Scheduled", effectiveDate };
  }

  if (changes.salary) {
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
  if (changes.visaRequired !== undefined) updateValues.visaRequired = changes.visaRequired;
  if (changes.lineManagerId !== undefined) updateValues.lineManagerId = changes.lineManagerId;
  if (changes.projectId !== undefined) updateValues.projectId = changes.projectId || null;
  if (changes.costCentreId !== undefined) updateValues.costCentreId = changes.costCentreId || null;
  if (changes.startDate !== undefined) updateValues.startDate = changes.startDate;
  if (changes.probationEndDate !== undefined)
    updateValues.probationEndDate = changes.probationEndDate || null;
  if (changes.weeklyHours !== undefined) updateValues.weeklyHours = String(changes.weeklyHours);
  if (changesEmployment) {
    await tx
      .update(employees)
      .set(updateValues)
      .where(and(eq(employees.organisationId, organisationId), eq(employees.id, employeeId)));
    if (locationId)
      await syncEmployeeAttendanceTracking(
        tx,
        organisationId,
        employeeId,
        locationId,
        effectiveDate,
      );
  }

  if (changes.lineManagerId !== undefined && changes.lineManagerId !== current.lineManagerId) {
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
    if (changes.lineManagerId) {
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
  }

  for (const field of fields) {
    const oldValue = field === "salary" ? "Compensation on file" : String(previous[field] ?? "");
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
  return { status: "Applied", effectiveDate };
}

export async function listScheduledEmploymentChangesInDatabase(
  organisationId: string,
  employeeId: string,
  actor: AuditActorContext,
): Promise<ScheduledEmploymentChangeView[]> {
  if (!["HR", "Accounts", "Super Admin"].includes(actor.activeRole))
    throw new Error("You do not have access to scheduled employment changes.");
  const rows = await getDatabaseClient()
    .select()
    .from(scheduledEmploymentChanges)
    .where(
      and(
        eq(scheduledEmploymentChanges.organisationId, organisationId),
        eq(scheduledEmploymentChanges.employeeId, employeeId),
        inArray(scheduledEmploymentChanges.status, ["Pending", "Needs Review"]),
      ),
    )
    .orderBy(
      asc(scheduledEmploymentChanges.effectiveDate),
      asc(scheduledEmploymentChanges.createdAt),
    );
  return rows
    .filter((row) => canManageEmploymentFields(actor.activeRole, row.fields))
    .map((row) => ({
      id: row.id,
      effectiveDate: row.effectiveDate,
      fields: row.fields,
      changes: decryptSensitiveJson<{ changes: ScheduledEmploymentChangeView["changes"] }>(
        row.encryptedPayload,
      ).changes,
      reason: row.reason,
      status: row.status as "Pending" | "Needs Review",
      reviewNote: row.reviewNote,
    }));
}

export async function cancelScheduledEmploymentChangeInDatabase(
  organisationId: string,
  id: string,
  reason: string,
  actor: AuditActorContext,
): Promise<void> {
  if (reason.trim().length < 5)
    throw new Error("Give a cancellation reason of at least five characters.");
  await getDatabaseClient().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`employment:${organisationId}`}, 0))`,
    );
    const [row] = await tx
      .select()
      .from(scheduledEmploymentChanges)
      .where(
        and(
          eq(scheduledEmploymentChanges.organisationId, organisationId),
          eq(scheduledEmploymentChanges.id, id),
        ),
      )
      .for("update")
      .limit(1);
    if (!row) throw new Error("Scheduled change not found.");
    if (!canManageEmploymentFields(actor.activeRole, row.fields))
      throw new Error("You do not have permission to cancel this scheduled change.");
    if (row.status !== "Pending" && row.status !== "Needs Review")
      throw new Error("This scheduled change has already been applied or cancelled.");
    await tx
      .update(scheduledEmploymentChanges)
      .set({
        status: "Cancelled",
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${scheduledEmploymentChanges.recordVersion} + 1`,
      })
      .where(eq(scheduledEmploymentChanges.id, id));
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "cancel",
      module: "core-hr",
      entityType: "scheduled-employment-change",
      entityId: id,
      afterSummary: { employeeId: row.employeeId, effectiveDate: row.effectiveDate },
      reason: reason.trim(),
      riskLevel: row.fields.includes("salary") ? "Critical" : "High",
    });
  });
}

/** Worker-only entry point; never accepts a browser-supplied clock or authority. */
export async function processScheduledEmploymentChanges(
  now = new Date(),
  organisationId?: string,
): Promise<{ applied: number; needsReview: number }> {
  const db = getDatabaseClient();
  const orgs = await db
    .select({ id: organisations.id, timezone: appSettings.timezone })
    .from(organisations)
    .innerJoin(appSettings, eq(appSettings.organisationId, organisations.id))
    .where(
      and(
        eq(organisations.isActive, true),
        organisationId ? eq(organisations.id, organisationId) : undefined,
      ),
    );
  let applied = 0;
  let needsReview = 0;
  for (const org of orgs) {
    const today = employmentCalendarDate(org.timezone, now);
    const due = await db
      .select({ id: scheduledEmploymentChanges.id })
      .from(scheduledEmploymentChanges)
      .where(
        and(
          eq(scheduledEmploymentChanges.organisationId, org.id),
          eq(scheduledEmploymentChanges.status, "Pending"),
          lte(scheduledEmploymentChanges.effectiveDate, today),
        ),
      )
      .orderBy(
        asc(scheduledEmploymentChanges.effectiveDate),
        asc(scheduledEmploymentChanges.createdAt),
      )
      .limit(100);
    for (const entry of due) {
      const outcome = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`employment:${org.id}`}, 0))`,
        );
        const [row] = await tx
          .select()
          .from(scheduledEmploymentChanges)
          .where(
            and(
              eq(scheduledEmploymentChanges.organisationId, org.id),
              eq(scheduledEmploymentChanges.id, entry.id),
            ),
          )
          .for("update")
          .limit(1);
        if (!row || row.status !== "Pending" || row.effectiveDate > today) return "Skipped";
        let reviewNote: string | null = null;
        try {
          // Savepoint ensures a failed application cannot leave a partial employee/payroll update.
          await tx.transaction(async (work) => {
            const [author] = await work
              .select()
              .from(users)
              .where(
                and(
                  eq(users.organisationId, org.id),
                  eq(users.id, row.createdBy),
                  eq(users.status, "Active"),
                  isNull(users.archivedAt),
                ),
              )
              .limit(1);
            const authorRoles = await work
              .select({ code: roles.code })
              .from(userRoles)
              .innerJoin(roles, eq(userRoles.roleId, roles.id))
              .where(
                and(eq(userRoles.organisationId, org.id), eq(userRoles.userId, row.createdBy)),
              );
            if (!author || !authorRoles.some((role) => role.code === row.authorRole))
              throw new Error(
                "The person who scheduled this change no longer has the required access.",
              );
            const { changes } = decryptSensitiveJson<{ changes: EmploymentRecordChanges }>(
              row.encryptedPayload,
            );
            await applyEmploymentRecord(
              work,
              org.id,
              row.employeeId,
              changes,
              row.effectiveDate,
              row.reason,
              {
                userId: author.id,
                employeeId: author.employeeId,
                displayName: author.displayName,
                activeRole: row.authorRole,
                roles: authorRoles.map((role) => role.code),
              },
              now,
              row,
            );
          });
        } catch (error) {
          // Only expose controlled validation messages, never SQL errors containing parameters.
          const message = error instanceof Error ? error.message : "";
          reviewNote =
            message.startsWith("The employee details have changed") ||
            message.startsWith("The person who scheduled") ||
            message.startsWith("Employment changes cannot be applied") ||
            /^Select an active (department|position|grade|location|employment type|project|cost centre)\.$/.test(
              message,
            )
              ? message
              : "Not applied. Review the employee's details, selected references and scheduler access, then cancel and create a corrected change.";
        }
        await tx
          .update(scheduledEmploymentChanges)
          .set({
            status: reviewNote ? "Needs Review" : "Applied",
            appliedAt: reviewNote ? null : now,
            reviewNote,
            updatedAt: now,
            recordVersion: sql`${scheduledEmploymentChanges.recordVersion} + 1`,
          })
          .where(eq(scheduledEmploymentChanges.id, row.id));
        if (reviewNote) {
          const recipients = await tx
            .selectDistinct({ id: users.id })
            .from(users)
            .innerJoin(userRoles, eq(userRoles.userId, users.id))
            .innerJoin(roles, eq(roles.id, userRoles.roleId))
            .where(
              and(
                eq(users.organisationId, org.id),
                eq(users.status, "Active"),
                isNull(users.archivedAt),
                inArray(
                  roles.code,
                  (["HR", "Accounts", "Super Admin"] as const).filter((role) =>
                    canManageEmploymentFields(role, row.fields),
                  ),
                ),
              ),
            );
          for (const recipient of recipients) {
            await tx
              .insert(notifications)
              .values({
                organisationId: org.id,
                recipientUserId: recipient.id,
                type: "employment.scheduled_change_review",
                title: "Scheduled employment change needs review",
                message: reviewNote,
                priority: "High",
                status: "Unread",
                deduplicationKey: `employment-change-review:${row.id}:${recipient.id}`,
                link: {
                  entityType: "employee",
                  entityId: row.employeeId,
                  path: `/staff/employees/${row.employeeId}`,
                },
                createdBy: row.createdBy,
                updatedBy: row.createdBy,
              })
              .onConflictDoNothing();
          }
          await tx.insert(auditEvents).values({
            organisationId: org.id,
            actorDisplayName: "Employment scheduler",
            activeRole: row.authorRole,
            actorRoles: [row.authorRole],
            action: "needs-review",
            module: "core-hr",
            entityType: "scheduled-employment-change",
            entityId: row.id,
            afterSummary: { employeeId: row.employeeId, effectiveDate: row.effectiveDate },
            reason: reviewNote,
            riskLevel: "High",
          });
        }
        return reviewNote ? "Needs Review" : "Applied";
      });
      if (outcome === "Applied") applied++;
      if (outcome === "Needs Review") needsReview++;
    }
  }
  return { applied, needsReview };
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
    validateCeoSupervisor(input.position, input.lineManagerId);
    if ((employeeCount ?? 0) > 0 && !input.lineManagerId && !isCeoPosition(input.position)) {
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
        homeCountryPhone: input.homeCountryPhone,
        homeCountryAddress: input.homeCountryAddress,
        emergencyContacts: input.emergencyContacts ?? [],
        dependants: (input.dependants ?? []).map((d) => ({
          ...d,
          id: d.id ?? crypto.randomUUID(),
        })),
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
    await syncEmployeeAttendanceTracking(
      tx,
      organisationId,
      employee.id,
      location.id,
      input.startDate,
    );
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
      await assignSupervisorApprovalAccess(
        tx,
        organisationId,
        employee.id,
        input.lineManagerId,
        actor,
      );
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
