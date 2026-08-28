import { SYSTEM_CONTEXT } from "./types.ts";
import { LocalRepository } from "./repository.ts";
import { getApplicationDataServices } from "./application-data.ts";
import type { OvertimeClaim } from "./overtime-types.ts";
import type { ActorContext } from "./types.ts";
import { TimesheetService } from "./timesheet-service.ts";
import { AttendanceService } from "./attendance-service.ts";
import { EmployeeService } from "./employee-service.ts";
import { LeaveService } from "./leave-service.ts";
import { NotificationService } from "./notification-service.ts";
import { getMasterDataRepository, getProjectRepository } from "./master-data.ts";
import { SYSTEM_ACTOR } from "./types.ts";
import { getRolePermissions, type Permission } from "../auth/permissions.ts";

const MAX_CLAIM_HOURS_PER_DAY = 12;

export class OvertimeService {
  private claimRepo: LocalRepository<OvertimeClaim>;

  constructor() {
    const { storage, audit } = getApplicationDataServices();
    this.claimRepo = new LocalRepository<OvertimeClaim>("overtimeClaims", storage, audit, {
      module: "overtime",
      entityType: "claim",
    });
  }

  private hasAdminOrPayrollView(context: ActorContext): boolean {
    const permissions = context.actor.activeRole
      ? getRolePermissions(context.actor.activeRole)
      : new Set<Permission>();
    return permissions.has("overtime:admin_all") || permissions.has("payroll:view");
  }

  private isManagerOf(employeeId: string, context: ActorContext): boolean {
    if (context.actor.activeRole !== "Line Manager" || !context.actor.employeeId) return false;
    return (
      new EmployeeService().getById(employeeId, SYSTEM_CONTEXT)?.lineManagerId ===
      context.actor.employeeId
    );
  }

  /** Requires HR/Super Admin (overtime:admin_all) or Accounts (payroll:view, for payroll reconciliation). */
  getAllClaims(context: ActorContext): OvertimeClaim[] {
    if (!this.hasAdminOrPayrollView(context)) {
      this.denyAccess(context, "view all overtime claims", "all-claims");
    }
    return this.claimRepo.list();
  }

  getClaimsForEmployee(employeeId: string, context: ActorContext): OvertimeClaim[] {
    const isSelf = context.actor.employeeId === employeeId;
    if (!isSelf && !this.hasAdminOrPayrollView(context) && !this.isManagerOf(employeeId, context)) {
      this.denyAccess(context, "view this employee's overtime claims", employeeId);
    }
    return this.claimRepo.list().filter((c) => c.employeeId === employeeId);
  }

  /** The manager queue for Overtime Approvals: own direct reports, or everything for HR/Accounts/Super Admin. */
  getClaimsForDirectReports(context: ActorContext): OvertimeClaim[] {
    if (this.hasAdminOrPayrollView(context)) return this.claimRepo.list();
    if (context.actor.activeRole !== "Line Manager" || !context.actor.employeeId) {
      this.denyAccess(context, "review team overtime claims", "direct-reports");
    }
    const directReportIds = new EmployeeService()
      .getEmployees(SYSTEM_CONTEXT)
      .filter((employee) => employee.lineManagerId === context.actor.employeeId)
      .map((employee) => employee.id);
    return this.claimRepo.list().filter((claim) => directReportIds.includes(claim.employeeId));
  }

  // Validates a claim submission and builds its full payload WITHOUT writing anything - shared by
  // submitClaim (write immediately) and createCorrection (write atomically alongside archiving the
  // original, via LocalRepository.createWithSideEffect).
  private async buildClaimPayload(
    data: Partial<OvertimeClaim>,
    context: ActorContext,
  ): Promise<
    Omit<
      OvertimeClaim,
      "id" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy" | "recordVersion"
    >
  > {
    if (
      !data.employeeId ||
      !data.date ||
      !data.hours ||
      data.hours <= 0 ||
      !data.reason ||
      !data.costCentreId ||
      !data.activityCodeId ||
      !data.locationCodeId
    ) {
      throw new Error(
        "Date, valid hours, cost centre, activity, work location and a reason are required.",
      );
    }
    if (context.actor.employeeId !== data.employeeId) {
      if (
        context.actor.activeRole !== "HR" &&
        context.actor.activeRole !== "Super Admin" &&
        !this.isManagerOf(data.employeeId, context)
      ) {
        this.denyAccess(context, "submit an overtime claim for another employee", data.employeeId);
      }
    }
    if (data.evidenceFileId) {
      const { files } = getApplicationDataServices();
      const meta = await files.getMetadata(data.evidenceFileId);
      if (
        !meta ||
        meta.owner.entityType !== "overtime-claim" ||
        meta.owner.entityId !== data.employeeId
      ) {
        throw new Error("The uploaded evidence file could not be verified. Please re-upload it.");
      }
    }
    const employee = new EmployeeService().getById(data.employeeId, SYSTEM_CONTEXT);
    if (!employee) {
      throw new Error("The employee for this overtime claim could not be found.");
    }
    const date = data.date;
    const hours = data.hours;

    if (hours > MAX_CLAIM_HOURS_PER_DAY) {
      throw new Error(`A single overtime claim cannot exceed ${MAX_CLAIM_HOURS_PER_DAY} hours.`);
    }
    if (date > new Date().toISOString().slice(0, 10)) {
      throw new Error("Overtime cannot be claimed for a future date.");
    }
    if (data.projectId) {
      const project = getProjectRepository().getById(data.projectId);
      if (!project || !project.isActive) {
        throw new Error("Selected project is invalid or archived.");
      }
    }
    for (const [collection, id, label] of [
      ["costCentres", data.costCentreId, "cost centre"],
      ["activityCodes", data.activityCodeId, "activity"],
      ["locations", data.locationCodeId, "work location"],
    ] as const) {
      const record = getMasterDataRepository(collection).getById(id);
      if (!record || !record.isActive) throw new Error(`Selected ${label} is invalid or archived.`);
    }

    const existing = this.claimRepo
      .list()
      .find(
        (c) =>
          c.employeeId === data.employeeId &&
          c.date === date &&
          c.id !== data.originalClaimId &&
          c.status !== "Rejected" &&
          c.status !== "Corrected",
      );

    if (existing) {
      throw new Error("An active overtime claim already exists for this date.");
    }

    const tsService = new TimesheetService();
    const attService = new AttendanceService();
    const settings = tsService.getSettings(); // Re-use settings

    // Cross checks
    const warnings: string[] = [];

    // Timesheet
    const allTs = tsService
      .getAllTimesheets(SYSTEM_CONTEXT)
      .filter((t) => t.employeeId === data.employeeId);
    let tsHours = 0;
    allTs.forEach((ts) => {
      ts.entries.forEach((entry) => {
        if (entry.hours[date]) {
          tsHours += entry.hours[date];
        }
      });
    });

    if (tsHours < settings.standardDailyHours + hours) {
      warnings.push(
        `Timesheet for ${date} shows only ${tsHours}h logged, which does not cover standard hours plus ${hours}h overtime.`,
      );
    }

    // Attendance
    const attRecord = attService
      .getAllRecords(SYSTEM_CONTEXT)
      .find((r) => r.employeeId === data.employeeId && r.date === date);
    const attHours = attRecord?.calculatedHours || 0;

    if (attHours < settings.standardDailyHours + hours) {
      warnings.push(
        `Physical attendance punch for ${date} shows only ${attHours}h worked, which does not mathematically support ${hours}h overtime.`,
      );
    }

    return {
      employeeId: data.employeeId!,
      date,
      hours,
      reason: data.reason,
      compensationType: data.compensationType === "TOIL" ? "TOIL" : "Payment",
      ...(data.projectId !== undefined ? { projectId: data.projectId } : {}),
      costCentreId: data.costCentreId,
      activityCodeId: data.activityCodeId,
      locationCodeId: data.locationCodeId,
      ...(data.evidenceFileId !== undefined ? { evidenceFileId: data.evidenceFileId } : {}),
      ...(data.originalClaimId !== undefined ? { originalClaimId: data.originalClaimId } : {}),
      crossCheckWarnings: warnings,
      status: "Pending Manager",
    };
  }

  async submitClaim(data: Partial<OvertimeClaim>, context: ActorContext): Promise<OvertimeClaim> {
    const claim = await this.buildClaimPayload(data, context);
    const created = this.claimRepo.create(claim, context);
    this.notifyManager(created, context);
    return created;
  }

  managerApprove(claimId: string, context: ActorContext): OvertimeClaim {
    const claim = this.claimRepo.getById(claimId);
    if (!claim) throw new Error("Claim not found");
    if (context.actor.employeeId === claim.employeeId) {
      this.denyAccess(context, "approve your own overtime claim", claim.id);
    }
    this.requireApproveDirectReportOrAdmin(
      claim.employeeId,
      context,
      "approve this overtime claim",
    );
    if (claim.status !== "Pending Manager") throw new Error("Invalid status");

    const tsService = new TimesheetService();
    const settings = tsService.getSettings();

    if (settings.requireHrOvertimeVerification) {
      claim.status = "Pending HR";
      const updated = this.claimRepo.update(claim.id, claim, context);
      this.notifyHr(updated, context);
      return updated;
    }

    claim.status = "Approved";
    const updated = this.claimRepo.update(claim.id, claim, context);
    this.notifyDecision(updated, context);
    return updated;
  }

  managerReject(claimId: string, reason: string, context: ActorContext): OvertimeClaim {
    const claim = this.claimRepo.getById(claimId);
    if (!claim) throw new Error("Claim not found");
    if (context.actor.employeeId === claim.employeeId) {
      this.denyAccess(context, "reject your own overtime claim", claim.id);
    }
    this.requireApproveDirectReportOrAdmin(claim.employeeId, context, "reject this overtime claim");
    if (claim.status !== "Pending Manager") throw new Error("Invalid status");
    if (!reason) throw new Error("Rejection reason required.");

    claim.status = "Rejected";
    claim.managerNotes = reason;
    const updated = this.claimRepo.update(claim.id, claim, context);
    this.notifyDecision(updated, context);
    return updated;
  }

  hrVerify(claimId: string, approve: boolean, notes: string, context: ActorContext): OvertimeClaim {
    const claim = this.claimRepo.getById(claimId);
    if (!claim) throw new Error("Claim not found");
    if (context.actor.employeeId === claim.employeeId) {
      this.denyAccess(context, "verify your own overtime claim", claim.id);
    }
    this.requireAdmin(context, "verify this overtime claim");
    if (claim.status !== "Pending HR") throw new Error("Invalid status");

    claim.status = approve ? "Approved" : "Rejected";
    claim.hrNotes = notes;
    const updated = this.claimRepo.update(claim.id, claim, context);
    this.notifyDecision(updated, context);
    return updated;
  }

  async createCorrection(
    originalClaimId: string,
    newHours: number,
    newReason: string,
    context: ActorContext,
    replacementEvidenceFileId?: string,
  ): Promise<OvertimeClaim> {
    const original = this.claimRepo.getById(originalClaimId);
    if (!original) throw new Error("Claim not found");
    if (original.status !== "Approved")
      throw new Error("Only approved claims can be corrected. Use normal edits for drafts.");

    // Validate and build the replacement's full payload WITHOUT writing anything - only once
    // that succeeds do we commit both the new claim and the original's "Corrected" status, in a
    // single LocalRepository.createWithSideEffect() write. That single write is genuinely atomic
    // (JS is single-threaded and nothing yields between building the next array and the one
    // writeCollection call), so there is no window where the replacement exists but the original
    // is still "Approved", or vice versa - unlike the earlier two-separate-writes-plus-rollback
    // approach this replaces.
    const payload = await this.buildClaimPayload(
      {
        employeeId: original.employeeId,
        date: original.date,
        hours: newHours,
        reason: newReason,
        compensationType: original.compensationType,
        ...(original.projectId !== undefined ? { projectId: original.projectId } : {}),
        costCentreId: original.costCentreId,
        activityCodeId: original.activityCodeId,
        locationCodeId: original.locationCodeId,
        ...((replacementEvidenceFileId ?? original.evidenceFileId) !== undefined
          ? { evidenceFileId: replacementEvidenceFileId ?? original.evidenceFileId }
          : {}),
        originalClaimId: original.id,
      },
      context,
    );

    // buildClaimPayload awaits (evidence-file lookup), which yields to the event loop - another
    // concurrent createCorrection call for the SAME original (double-click, two tabs) could have
    // already committed its own replacement while this call was suspended there. Re-read the
    // original fresh, synchronously, with no further await between this check and the write below,
    // so nothing can interleave between the check and the act. Without this, createWithSideEffect
    // would blindly re-apply {status:"Corrected"} even if the original were already corrected,
    // silently producing two live replacement claims from one original.
    const stillCorrectable = this.claimRepo.getById(originalClaimId);
    if (!stillCorrectable || stillCorrectable.status !== "Approved") {
      throw new Error("This claim was already corrected by another request.");
    }

    const { storage } = getApplicationDataServices();
    const snapshot = storage.createRawSnapshot();
    try {
      let toilReversedAt: string | undefined;
      if (original.compensationType === "TOIL" && original.toilCreditedAt) {
        const systemContext: ActorContext = {
          actor: { ...SYSTEM_ACTOR, activeRole: "Super Admin" },
          reason: `Reversed time-off credit before overtime correction ${original.id}: ${newReason}`,
        };
        new LeaveService().reverseCompensationLeaveCredit(
          original.employeeId,
          original.id,
          `Time-off credit reversed because overtime claim ${original.id} was corrected.`,
          systemContext,
        );
        toilReversedAt = new Date().toISOString();
      }
      const { created } = this.claimRepo.createWithSideEffect(
        payload,
        {
          id: original.id,
          changes: {
            status: "Corrected",
            ...(toilReversedAt ? { toilReversedAt } : {}),
          },
        },
        context,
      );
      this.notifyManager(created, context);
      return created;
    } catch (error) {
      storage.restoreRawSnapshot(snapshot);
      throw error;
    }
  }

  markIncludedInPayroll(claimIds: string[], payrollPeriodId: string, context: ActorContext): void {
    if (!["Accounts", "Super Admin"].includes(context.actor.activeRole ?? "")) {
      this.denyAccess(context, "mark overtime as included in payroll", payrollPeriodId);
    }
    for (const claimId of claimIds) {
      const claim = this.claimRepo.getById(claimId);
      if (!claim || claim.status !== "Approved") continue;
      if (claim.payrollPeriodId && claim.payrollPeriodId !== payrollPeriodId) {
        throw new Error("An overtime claim is already assigned to another payroll period.");
      }
      this.claimRepo.update(
        claim.id,
        { payrollPeriodId },
        { ...context, reason: `Included in payroll period ${payrollPeriodId}` },
      );
    }
  }

  async getEvidenceBlob(
    claimId: string,
    context: ActorContext,
  ): Promise<{ blob: Blob; fileName: string }> {
    const claim = this.claimRepo.getById(claimId);
    if (!claim) throw new Error("Claim not found");
    if (!claim.evidenceFileId) throw new Error("This claim has no supporting evidence.");

    const isSelf = context.actor.employeeId === claim.employeeId;
    if (
      !isSelf &&
      !this.hasAdminOrPayrollView(context) &&
      !this.isManagerOf(claim.employeeId, context)
    ) {
      this.denyAccess(context, "view this claim's evidence", claimId);
    }

    const { files } = getApplicationDataServices();
    const [metadata, blob] = await Promise.all([
      files.getMetadata(claim.evidenceFileId),
      files.getBlob(claim.evidenceFileId),
    ]);
    if (!metadata || !blob) throw new Error("The supporting file could not be found.");

    getApplicationDataServices().audit.record({
      context,
      action: "overtime_evidence_accessed",
      module: "overtime",
      entityType: "claim",
      entityId: claimId,
      reason: `Viewed supporting evidence for overtime claim ${claimId}.`,
      riskLevel: "Medium",
    });

    return { blob, fileName: metadata.name ?? "evidence" };
  }

  private notifyManager(claim: OvertimeClaim, context: ActorContext): void {
    const employee = new EmployeeService().getById(claim.employeeId, SYSTEM_CONTEXT);
    if (!employee?.lineManagerId) return;
    const { storage, audit } = getApplicationDataServices();
    const notifService = new NotificationService(storage, audit);
    const managerUser = storage
      .readCollection<{ id: string; employeeId?: string; status: string }>("users")
      .find((user) => user.employeeId === employee.lineManagerId && user.status === "Active");
    if (!managerUser) return;
    notifService.create(
      {
        recipientUserId: managerUser.id,
        type: "Info",
        title: "Overtime claim awaiting your review",
        message: `${employee.preferredName} ${employee.legalName} submitted a ${claim.hours}h overtime claim for ${claim.date}.`,
        priority: "Normal",
        status: "Unread",
        deduplicationKey: `overtime-submitted-${claim.id}`,
      },
      context,
    );
  }

  private notifyHr(claim: OvertimeClaim, context: ActorContext): void {
    const employee = new EmployeeService().getById(claim.employeeId, SYSTEM_CONTEXT);
    const { storage, audit } = getApplicationDataServices();
    const notifService = new NotificationService(storage, audit);
    const hrUsers = storage
      .readCollection<{ id: string; roles: string[]; status: string }>("users")
      .filter((user) => user.roles.includes("HR") && user.status === "Active");
    for (const hr of hrUsers) {
      notifService.create(
        {
          recipientUserId: hr.id,
          type: "Info",
          title: "Overtime claim awaiting HR verification",
          message: `${employee?.preferredName ?? "An employee"}'s ${claim.hours}h overtime claim for ${claim.date} needs HR verification.`,
          priority: "Normal",
          status: "Unread",
          deduplicationKey: `overtime-pending-hr-${claim.id}`,
        },
        context,
      );
    }
  }

  // Notifies the employee of the final decision, and - for a TOIL claim that just reached
  // Approved - credits the corresponding Compensation Leave days exactly once (guarded by
  // toilCreditedAt so a re-save or duplicate call can never double-credit).
  private notifyDecision(claim: OvertimeClaim, context: ActorContext): void {
    const employee = new EmployeeService().getById(claim.employeeId, SYSTEM_CONTEXT);
    if (!employee) return;
    const { storage, audit } = getApplicationDataServices();
    const notifService = new NotificationService(storage, audit);
    const employeeUser = storage
      .readCollection<{ id: string; employeeId?: string; status: string }>("users")
      .find((user) => user.employeeId === claim.employeeId && user.status === "Active");

    if (claim.status === "Approved" && claim.compensationType === "TOIL" && !claim.toilCreditedAt) {
      try {
        const leaveService = new LeaveService();
        const standardDailyHours = new TimesheetService().getSettings().standardDailyHours || 8;
        const days = claim.hours / standardDailyHours;
        // A single-step (manager-only) claim can finalize entirely under a Line Manager's
        // authority, who won't hold LeaveService's own HR/Super-Admin gate on granting balance -
        // the overtime approval itself was already properly authorized by this point, so the
        // credit is attributed to the system on the approver's behalf rather than re-demanding
        // an HR-specific role from whoever happened to be the final human approver.
        const creditContext: ActorContext =
          context.actor.activeRole === "HR" || context.actor.activeRole === "Super Admin"
            ? context
            : {
                actor: { ...SYSTEM_ACTOR, activeRole: "Super Admin" },
                reason: `Overtime claim ${claim.id} approved by ${context.actor.displayName || context.actor.userId}`,
              };
        leaveService.creditCompensationLeave(
          claim.employeeId,
          days,
          `Overtime worked ${claim.date} (${claim.hours}h), converted to time off in lieu.`,
          creditContext,
          claim.id,
        );
        claim.toilCreditedAt = new Date().toISOString();
        this.claimRepo.update(claim.id, claim, context);
      } catch (error) {
        // Do not fail the approval itself if the credit can't be posted - HR still sees the
        // claim as Approved and can retry the credit manually via Compensation Leave adjustment.
        getApplicationDataServices().audit.record({
          context,
          action: "overtime_toil_credit_failed",
          module: "overtime",
          entityType: "claim",
          entityId: claim.id,
          reason: error instanceof Error ? error.message : "Unknown error crediting TOIL",
          riskLevel: "High",
        });
      }
    }

    if (employeeUser) {
      notifService.create(
        {
          recipientUserId: employeeUser.id,
          type: claim.status === "Approved" ? "Success" : "Warning",
          title:
            claim.status === "Approved" ? "Overtime claim approved" : "Overtime claim rejected",
          message:
            claim.status === "Approved"
              ? `Your ${claim.hours}h overtime claim for ${claim.date} was approved.`
              : `Your ${claim.hours}h overtime claim for ${claim.date} was rejected. ${claim.managerNotes || claim.hrNotes || ""}`.trim(),
          priority: "Normal",
          status: "Unread",
          deduplicationKey: `overtime-decision-${claim.id}-${claim.status}`,
        },
        context,
      );
    }
  }

  private requireApproveDirectReportOrAdmin(
    employeeId: string,
    context: ActorContext,
    action: string,
  ): void {
    // Checked against the actor's currently active role, not the full set of roles they have
    // ever been granted - a dual-role manager/employee who switched to Employee mode must not
    // retain manager-level overtime approval just because a manager role is still assigned.
    const permissions = context.actor.activeRole
      ? getRolePermissions(context.actor.activeRole)
      : new Set<Permission>();

    if (permissions.has("overtime:admin_all")) {
      return;
    }

    if (permissions.has("overtime:approve_direct_reports") && context.actor.employeeId) {
      const employee = new EmployeeService().getById(employeeId, SYSTEM_CONTEXT);
      if (employee?.lineManagerId === context.actor.employeeId) {
        return;
      }
    }

    this.denyAccess(context, action, employeeId);
  }

  private requireAdmin(context: ActorContext, action: string): void {
    const permissions = context.actor.activeRole
      ? getRolePermissions(context.actor.activeRole)
      : new Set<Permission>();
    if (permissions.has("overtime:admin_all")) {
      return;
    }
    this.denyAccess(context, action, "overtime-verification");
  }

  private denyAccess(context: ActorContext, action: string, entityId: string): never {
    getApplicationDataServices().audit.record({
      context,
      action: "overtime_access_denied",
      module: "overtime",
      entityType: "claim",
      entityId,
      reason: `Not authorised to ${action}.`,
      riskLevel: "High",
    });
    throw new Error(`You are not authorised to ${action}.`);
  }
}
