import { SYSTEM_CONTEXT } from "./types.ts";
import { LocalRepository } from "./repository.ts";
import { getApplicationDataServices } from "./application-data.ts";
import type {
  OvertimeClaim,
  PayrollOvertimeLedgerFilters,
  PayrollOvertimeLedgerRow,
} from "./overtime-types.ts";
import type { ActorContext } from "./types.ts";
import { TimesheetService } from "./timesheet-service.ts";
import { AttendanceService } from "./attendance-service.ts";
import { EmployeeService } from "./employee-service.ts";
import { LeaveService } from "./leave-service.ts";
import { NotificationService } from "./notification-service.ts";
import { getMasterDataRepository, getProjectRepository } from "./master-data.ts";
import { SYSTEM_ACTOR } from "./types.ts";
import { getRolePermissions, type Permission } from "../auth/permissions.ts";
import type { PayrollPeriod } from "./payroll-types.ts";

const MAX_CLAIM_HOURS_PER_DAY = 12;

function escapeCsvCell(value: string): string {
  const safeValue = /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value;
  return `"${safeValue.replace(/"/g, '""')}"`;
}

export class OvertimeService {
  private claimRepo: LocalRepository<OvertimeClaim>;

  constructor() {
    const { storage, audit } = getApplicationDataServices();
    this.claimRepo = new LocalRepository<OvertimeClaim>("overtimeClaims", storage, audit, {
      module: "overtime",
      entityType: "claim",
    });
  }

  private async serverActor(context: ActorContext) {
    const users = getApplicationDataServices().storage.readCollection<{
      id: string;
      workspaceEmail?: string;
    }>("users");
    const actorEmail =
      context.actor.workspaceEmail ??
      users.find((user) => user.id === context.actor.userId)?.workspaceEmail;
    return {
      actorId: context.actor.userId,
      ...(actorEmail ? { actorEmail } : {}),
      activeRole: context.actor.activeRole ?? context.actor.roles[0] ?? "Employee",
    } as const;
  }

  private databaseId(collection: string, id: string): string {
    const item = getApplicationDataServices()
      .storage.readCollection<{ id: string; databaseId?: string }>(collection)
      .find((record) => record.id === id || record.databaseId === id);
    const databaseId = item?.databaseId ?? (/^[0-9a-f-]{36}$/i.test(id) ? id : undefined);
    if (!databaseId) throw new Error("This record is not connected to PostgreSQL yet.");
    return databaseId;
  }

  async hydrateCompatibilityCache(context: ActorContext): Promise<void> {
    if (typeof window === "undefined") return;
    const { storage } = getApplicationDataServices();
    const relation = new Map<string, string>();
    for (const collection of [
      "employees",
      "users",
      "projects",
      "costCentres",
      "activityCodes",
      "locations",
      "payrollPeriods",
    ]) {
      for (const item of storage.readCollection<{ id: string; databaseId?: string }>(collection))
        if (item.databaseId) relation.set(item.databaseId, item.id);
    }
    const { getOvertimeClaimsFn } = await import("../server-functions/overtime.server.ts");
    const claims = await getOvertimeClaimsFn({ data: { actor: await this.serverActor(context) } });
    storage.writeCollection(
      "overtimeClaims",
      claims.map((claim) => ({
        ...claim,
        employeeId: relation.get(claim.employeeId) ?? claim.employeeId,
        ...(claim.projectId ? { projectId: relation.get(claim.projectId) ?? claim.projectId } : {}),
        costCentreId: relation.get(claim.costCentreId) ?? claim.costCentreId,
        activityCodeId: relation.get(claim.activityCodeId) ?? claim.activityCodeId,
        locationCodeId: relation.get(claim.locationCodeId) ?? claim.locationCodeId,
        ...(claim.approvedBy
          ? { approvedBy: relation.get(claim.approvedBy) ?? claim.approvedBy }
          : {}),
        ...(claim.payrollPeriodId
          ? { payrollPeriodId: relation.get(claim.payrollPeriodId) ?? claim.payrollPeriodId }
          : {}),
        ...(claim.originalClaimId ? { originalClaimId: claim.originalClaimId } : {}),
      })),
    );
  }

  private hasAdminOrPayrollView(context: ActorContext): boolean {
    const permissions = context.actor.activeRole
      ? getRolePermissions(context.actor.activeRole)
      : new Set<Permission>();
    return permissions.has("overtime:admin_all") || permissions.has("payroll:view");
  }

  private hasPayrollView(context: ActorContext): boolean {
    const permissions = context.actor.activeRole
      ? getRolePermissions(context.actor.activeRole)
      : new Set<Permission>();
    return permissions.has("payroll:view");
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

  /**
   * Finance-safe overtime view. Unlike getAllClaims(), this is deliberately unavailable to HR:
   * HR completes policy verification on the approvals page, while payroll information remains
   * restricted to Accounts and Super Admin.
   */
  getPayrollOvertimeLedger(
    context: ActorContext,
    filters: PayrollOvertimeLedgerFilters = {},
  ): PayrollOvertimeLedgerRow[] {
    if (!this.hasPayrollView(context)) {
      this.denyAccess(context, "view the overtime payroll ledger", "payroll-ledger");
    }

    const rows = this.buildPayrollLedgerRows(filters);
    getApplicationDataServices().audit.record({
      context,
      action: "payroll_overtime_ledger_viewed",
      module: "payroll",
      entityType: "overtime-ledger",
      entityId: "all",
      reason: `Viewed the overtime ledger (${rows.length} matching record${rows.length === 1 ? "" : "s"}).`,
      riskLevel: "Medium",
    });
    return rows;
  }

  exportPayrollOvertimeLedgerCsv(
    context: ActorContext,
    filters: PayrollOvertimeLedgerFilters = {},
  ): string {
    if (!this.hasPayrollView(context)) {
      this.denyAccess(context, "export the overtime payroll ledger", "payroll-ledger-export");
    }

    const rows = this.buildPayrollLedgerRows(filters);
    const csvRows = [
      [
        "Employee Number",
        "Employee",
        "Overtime Date",
        "Approved Hours",
        "Compensation",
        "Project",
        "Cost Centre",
        "Activity",
        "Work Location",
        "Reason",
        "Approved Date",
        "Payroll Period",
        "Ledger Status",
        "Cross-check Warnings",
        "Manager Notes",
        "HR Notes",
        "Evidence Attached",
      ],
      ...rows.map((row) => [
        row.employeeNumber,
        row.employeeName,
        row.date,
        String(row.hours),
        row.compensationType === "TOIL" ? "Time off in lieu" : "Payment",
        row.projectName,
        row.costCentreName,
        row.activityName,
        row.locationName,
        row.reason,
        row.approvedAt,
        row.payrollPeriodName ?? "",
        row.state,
        row.crossCheckWarnings.join(" | "),
        row.managerNotes ?? "",
        row.hrNotes ?? "",
        row.hasEvidence ? "Yes" : "No",
      ]),
    ];

    const csv = csvRows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
    getApplicationDataServices().audit.record({
      context,
      action: "payroll_overtime_ledger_exported",
      module: "payroll",
      entityType: "overtime-ledger",
      entityId: "all",
      reason: `Exported ${rows.length} overtime ledger record${rows.length === 1 ? "" : "s"} to CSV.`,
      riskLevel: "High",
      after: {
        rowCount: rows.length,
        filters: {
          view: filters.view ?? "all",
          searchApplied: Boolean(filters.search?.trim()),
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          payrollPeriodId: filters.payrollPeriodId,
        },
      },
    });
    return csv;
  }

  private buildPayrollLedgerRows(
    filters: PayrollOvertimeLedgerFilters,
  ): PayrollOvertimeLedgerRow[] {
    const { storage } = getApplicationDataServices();
    const employees = new EmployeeService().getEmployees(SYSTEM_CONTEXT);
    const projects = getProjectRepository().list({ includeArchived: true });
    const costCentres = getMasterDataRepository("costCentres").list({ includeArchived: true });
    const activities = getMasterDataRepository("activityCodes").list({ includeArchived: true });
    const locations = getMasterDataRepository("locations").list({ includeArchived: true });
    const periods = storage.readCollection<PayrollPeriod>("payrollPeriods");

    const rows = this.claimRepo
      .list()
      .filter((claim) => claim.status === "Approved")
      .map((claim): PayrollOvertimeLedgerRow => {
        const employee = employees.find((item) => item.id === claim.employeeId);
        const period = claim.payrollPeriodId
          ? periods.find((item) => item.id === claim.payrollPeriodId)
          : undefined;
        let state: PayrollOvertimeLedgerRow["state"];
        if (claim.compensationType === "TOIL" && claim.payrollPeriodId) {
          state = "Review Needed";
        } else if (claim.compensationType === "TOIL" && claim.toilCreditedAt) {
          state = "Time Off Credited";
        } else if (claim.compensationType === "TOIL") {
          state = "Time Off Pending";
        } else if (claim.payrollPeriodId) {
          state = "Included in Payroll";
        } else {
          state = "Ready for Payroll";
        }

        return {
          claimId: claim.id,
          employeeId: claim.employeeId,
          employeeName: employee?.preferredName || employee?.legalName || "Employee unavailable",
          employeeNumber: employee?.employeeNumber || "—",
          date: claim.date,
          hours: claim.hours,
          compensationType: claim.compensationType,
          projectName:
            projects.find((item) => item.id === claim.projectId)?.name || "General operations",
          costCentreName:
            costCentres.find((item) => item.id === claim.costCentreId)?.name ||
            "Cost centre unavailable",
          activityName:
            activities.find((item) => item.id === claim.activityCodeId)?.name ||
            "Activity unavailable",
          locationName:
            locations.find((item) => item.id === claim.locationCodeId)?.name ||
            "Location unavailable",
          reason: claim.reason,
          hasEvidence: Boolean(claim.evidenceFileId),
          crossCheckWarnings: [...(claim.crossCheckWarnings || [])],
          ...(claim.managerNotes ? { managerNotes: claim.managerNotes } : {}),
          ...(claim.hrNotes ? { hrNotes: claim.hrNotes } : {}),
          approvedAt: claim.approvedAt || claim.updatedAt,
          ...(claim.approvedBy ? { approvedBy: claim.approvedBy } : {}),
          ...(claim.payrollPeriodId ? { payrollPeriodId: claim.payrollPeriodId } : {}),
          ...(period?.name ? { payrollPeriodName: period.name } : {}),
          ...(period?.status ? { payrollPeriodStatus: period.status } : {}),
          state,
        };
      });

    const search = filters.search?.trim().toLocaleLowerCase();
    return rows
      .filter((row) => !filters.dateFrom || row.date >= filters.dateFrom)
      .filter((row) => !filters.dateTo || row.date <= filters.dateTo)
      .filter((row) => {
        if (!filters.payrollPeriodId) return true;
        if (filters.payrollPeriodId === "unassigned") return !row.payrollPeriodId;
        return row.payrollPeriodId === filters.payrollPeriodId;
      })
      .filter((row) => {
        switch (filters.view) {
          case "ready":
            return row.state === "Ready for Payroll";
          case "included":
            return row.state === "Included in Payroll";
          case "time-off":
            return row.compensationType === "TOIL";
          case "exceptions":
            return row.state === "Review Needed" || row.crossCheckWarnings.length > 0;
          default:
            return true;
        }
      })
      .filter((row) => {
        if (!search) return true;
        return [
          row.employeeName,
          row.employeeNumber,
          row.projectName,
          row.costCentreName,
          row.activityName,
          row.locationName,
          row.reason,
          row.payrollPeriodName,
        ].some((value) => value?.toLocaleLowerCase().includes(search));
      })
      .sort((a, b) => b.date.localeCompare(a.date) || a.employeeName.localeCompare(b.employeeName));
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
    const requestKind = data.requestKind ?? "Emergency Retrospective";
    const today = new Date().toISOString().slice(0, 10);

    if (requestKind === "Planned" && date < today)
      throw new Error("Planned overtime must be requested before the work is performed.");
    if (requestKind === "Emergency Retrospective" && date > today)
      throw new Error("Use a planned overtime request for a future date.");
    if (
      data.requestKind === "Emergency Retrospective" &&
      (data.emergencyReason?.trim().length ?? 0) < 5
    )
      throw new Error("Explain why prior approval could not be obtained for emergency overtime.");
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
    const dailyLimit = settings.overtimeMaxDailyHours ?? MAX_CLAIM_HOURS_PER_DAY;
    if (hours > dailyLimit)
      throw new Error(`A single overtime request cannot exceed ${dailyLimit} hours.`);
    const activeClaims = this.claimRepo
      .list()
      .filter(
        (claim) =>
          claim.employeeId === data.employeeId &&
          claim.id !== data.originalClaimId &&
          claim.status !== "Rejected" &&
          claim.status !== "Corrected",
      );
    const target = new Date(`${date}T00:00:00Z`);
    const weekStart = new Date(target);
    weekStart.setUTCDate(target.getUTCDate() - ((target.getUTCDay() + 6) % 7));
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
    const weeklyHours = activeClaims
      .filter((claim) => {
        const value = new Date(`${claim.date}T00:00:00Z`);
        return value >= weekStart && value <= weekEnd;
      })
      .reduce((sum, claim) => sum + claim.hours, 0);
    const monthlyHours = activeClaims
      .filter((claim) => claim.date.slice(0, 7) === date.slice(0, 7))
      .reduce((sum, claim) => sum + claim.hours, 0);
    if (weeklyHours + hours > (settings.overtimeMaxWeeklyHours ?? 12))
      throw new Error(`This request exceeds the weekly overtime limit.`);
    if (monthlyHours + hours > (settings.overtimeMaxMonthlyHours ?? 40))
      throw new Error(`This request exceeds the monthly overtime limit.`);

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

    if (
      requestKind === "Emergency Retrospective" &&
      tsHours < settings.standardDailyHours + hours
    ) {
      warnings.push(
        `Timesheet for ${date} shows only ${tsHours}h logged, which does not cover standard hours plus ${hours}h overtime.`,
      );
    }

    // Attendance
    const attRecord = attService
      .getAllRecords(SYSTEM_CONTEXT)
      .find((r) => r.employeeId === data.employeeId && r.date === date);
    const attHours = attRecord?.calculatedHours || 0;

    if (
      requestKind === "Emergency Retrospective" &&
      attHours < settings.standardDailyHours + hours
    ) {
      warnings.push(
        `Physical attendance punch for ${date} shows only ${attHours}h worked, which does not mathematically support ${hours}h overtime.`,
      );
    }

    return {
      employeeId: data.employeeId!,
      date,
      hours,
      reason: data.reason,
      requestKind,
      ...(requestKind === "Emergency Retrospective"
        ? { emergencyReason: data.emergencyReason?.trim() || data.reason }
        : {}),
      compensationType: data.compensationType === "TOIL" ? "TOIL" : "Payment",
      ...(data.projectId !== undefined ? { projectId: data.projectId } : {}),
      costCentreId: data.costCentreId,
      activityCodeId: data.activityCodeId,
      locationCodeId: data.locationCodeId,
      ...(data.evidenceFileId !== undefined ? { evidenceFileId: data.evidenceFileId } : {}),
      ...(data.originalClaimId !== undefined ? { originalClaimId: data.originalClaimId } : {}),
      crossCheckWarnings: warnings,
      status: requestKind === "Planned" ? "Pending Pre-authorisation" : "Pending Manager",
    };
  }

  async submitClaim(
    data: Partial<OvertimeClaim>,
    context: ActorContext,
    evidenceFile?: File,
  ): Promise<OvertimeClaim> {
    if (typeof window !== "undefined") {
      if (
        !data.employeeId ||
        !data.date ||
        !data.hours ||
        !data.reason ||
        !data.costCentreId ||
        !data.activityCodeId ||
        !data.locationCodeId
      )
        throw new Error("Date, hours, allocation and reason are required.");
      const mimeType = evidenceFile?.type as
        "application/pdf" | "image/jpeg" | "image/png" | undefined;
      if (evidenceFile && !["application/pdf", "image/jpeg", "image/png"].includes(mimeType ?? ""))
        throw new Error("Upload overtime evidence as PDF, JPG or PNG.");
      const { createOvertimeClaimFn } = await import("../server-functions/overtime.server.ts");
      const databaseId = await createOvertimeClaimFn({
        data: {
          actor: await this.serverActor(context),
          employeeId: this.databaseId("employees", data.employeeId),
          date: data.date,
          hours: data.hours,
          reason: data.reason,
          requestKind: data.requestKind ?? "Emergency Retrospective",
          ...(data.emergencyReason ? { emergencyReason: data.emergencyReason } : {}),
          compensationType: data.compensationType === "TOIL" ? "TOIL" : "Payment",
          ...(data.projectId ? { projectId: this.databaseId("projects", data.projectId) } : {}),
          costCentreId: this.databaseId("costCentres", data.costCentreId),
          activityCodeId: this.databaseId("activityCodes", data.activityCodeId),
          locationId: this.databaseId("locations", data.locationCodeId),
          ...(evidenceFile && mimeType
            ? {
                evidence: {
                  fileName: evidenceFile.name,
                  mimeType,
                  bytes: Array.from(new Uint8Array(await evidenceFile.arrayBuffer())),
                },
              }
            : {}),
        },
      });
      await this.hydrateCompatibilityCache(context);
      const created = this.claimRepo
        .list()
        .find((item) => item.databaseId === databaseId || item.id === databaseId);
      if (!created) throw new Error("The overtime claim could not be reloaded.");
      return created;
    }
    const claim = await this.buildClaimPayload(data, context);
    const created = this.claimRepo.create(claim, context);
    this.notifyManager(created, context);
    return created;
  }

  async confirmPlannedHours(
    id: string,
    actualHours: number,
    note: string,
    context: ActorContext,
  ): Promise<void> {
    const { confirmPlannedOvertimeFn } = await import("../server-functions/overtime.server.ts");
    await confirmPlannedOvertimeFn({
      data: {
        actor: await this.serverActor(context),
        claimId: this.databaseId("overtimeClaims", id),
        actualHours,
        note,
      },
    });
    await this.hydrateCompatibilityCache(context);
  }

  async decideClaimAsync(
    claimId: string,
    decision: "approve" | "reject",
    notes: string | undefined,
    context: ActorContext,
  ): Promise<OvertimeClaim> {
    if (typeof window === "undefined") {
      const claim = this.claimRepo.getById(claimId);
      if (claim?.status === "Pending HR")
        return this.hrVerify(claimId, decision === "approve", notes ?? "", context);
      return decision === "approve"
        ? this.managerApprove(claimId, context)
        : this.managerReject(claimId, notes ?? "Rejected", context);
    }
    const { decideOvertimeClaimFn } = await import("../server-functions/overtime.server.ts");
    await decideOvertimeClaimFn({
      data: {
        actor: await this.serverActor(context),
        claimId: this.databaseId("overtimeClaims", claimId),
        decision,
        ...(notes?.trim() ? { notes: notes.trim() } : {}),
      },
    });
    await this.hydrateCompatibilityCache(context);
    const updated = this.claimRepo
      .list()
      .find((item) => item.id === claimId || item.databaseId === claimId);
    if (!updated) throw new Error("The overtime claim could not be reloaded.");
    return updated;
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
    claim.approvedAt = new Date().toISOString();
    claim.approvedBy = context.actor.userId;
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
    if (approve) {
      claim.approvedAt = new Date().toISOString();
      claim.approvedBy = context.actor.userId;
    }
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
    replacementEvidenceFile?: File,
  ): Promise<OvertimeClaim> {
    if (typeof window !== "undefined") {
      const mimeType = replacementEvidenceFile?.type as
        "application/pdf" | "image/jpeg" | "image/png" | undefined;
      if (
        replacementEvidenceFile &&
        !["application/pdf", "image/jpeg", "image/png"].includes(mimeType ?? "")
      )
        throw new Error("Upload correction evidence as PDF, JPG or PNG.");
      const { correctOvertimeClaimFn } = await import("../server-functions/overtime.server.ts");
      const databaseId = await correctOvertimeClaimFn({
        data: {
          actor: await this.serverActor(context),
          claimId: this.databaseId("overtimeClaims", originalClaimId),
          hours: newHours,
          reason: newReason,
          ...(replacementEvidenceFileId
            ? { evidenceFileId: this.databaseId("files", replacementEvidenceFileId) }
            : {}),
          ...(replacementEvidenceFile && mimeType
            ? {
                evidence: {
                  fileName: replacementEvidenceFile.name,
                  mimeType,
                  bytes: Array.from(new Uint8Array(await replacementEvidenceFile.arrayBuffer())),
                },
              }
            : {}),
        },
      });
      await this.hydrateCompatibilityCache(context);
      const created = this.claimRepo
        .list()
        .find((item) => item.databaseId === databaseId || item.id === databaseId);
      if (!created) throw new Error("The corrected overtime claim could not be reloaded.");
      return created;
    }
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
    const uniqueClaimIds = [...new Set(claimIds)];
    const claims = uniqueClaimIds.map((claimId) => {
      const claim = this.claimRepo.getById(claimId);
      if (!claim) throw new Error("An overtime claim selected for payroll could not be found.");
      if (claim.status !== "Approved") {
        throw new Error("Only approved overtime can be included in payroll.");
      }
      if (claim.compensationType !== "Payment") {
        throw new Error("Time off in lieu cannot be included as payable overtime.");
      }
      if (claim.payrollPeriodId && claim.payrollPeriodId !== payrollPeriodId) {
        throw new Error("An overtime claim is already assigned to another payroll period.");
      }
      return claim;
    });

    for (const claim of claims) {
      if (claim.payrollPeriodId === payrollPeriodId) continue;
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
    if (typeof window !== "undefined") {
      const { readOvertimeEvidenceFn } = await import("../server-functions/overtime.server.ts");
      const result = await readOvertimeEvidenceFn({
        data: {
          actor: await this.serverActor(context),
          claimId: this.databaseId("overtimeClaims", claimId),
        },
      });
      return {
        blob: new Blob([Uint8Array.from(result.bytes)], { type: result.metadata.mimeType }),
        fileName: result.metadata.name,
      };
    }
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

  async getPayrollOvertimeLedgerAsync(context: ActorContext): Promise<PayrollOvertimeLedgerRow[]> {
    if (typeof window === "undefined") return this.getPayrollOvertimeLedger(context);
    const { getPayrollOvertimeLedgerFn } = await import("../server-functions/overtime.server.ts");
    return (await getPayrollOvertimeLedgerFn({
      data: { actor: await this.serverActor(context) },
    })) as PayrollOvertimeLedgerRow[];
  }

  async exportPayrollOvertimeLedgerCsvAsync(
    context: ActorContext,
    filters: PayrollOvertimeLedgerFilters = {},
  ): Promise<string> {
    if (typeof window === "undefined") return this.exportPayrollOvertimeLedgerCsv(context);
    const { exportPayrollOvertimeLedgerFn } =
      await import("../server-functions/overtime.server.ts");
    return exportPayrollOvertimeLedgerFn({
      data: { actor: await this.serverActor(context), filters },
    });
  }

  async markIncludedInPayrollAsync(
    claimIds: string[],
    payrollPeriodId: string,
    context: ActorContext,
  ): Promise<void> {
    if (typeof window === "undefined") {
      this.markIncludedInPayroll(claimIds, payrollPeriodId, context);
      return;
    }
    const { assignOvertimeToPayrollFn } = await import("../server-functions/overtime.server.ts");
    await assignOvertimeToPayrollFn({
      data: {
        actor: await this.serverActor(context),
        claimIds: claimIds.map((id) => this.databaseId("overtimeClaims", id)),
        payrollPeriodId: this.databaseId("payrollPeriods", payrollPeriodId),
      },
    });
    await this.hydrateCompatibilityCache(context);
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
