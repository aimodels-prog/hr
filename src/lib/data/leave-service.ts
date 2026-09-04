import { SYSTEM_CONTEXT } from "./types.ts";
import { getApplicationDataServices } from "./application-data.ts";
import { LocalRepository, type NewRecord } from "./repository.ts";
import type { ActorContext, Employee, User } from "./types.ts";
import { SYSTEM_ACTOR } from "./types.ts";
import { EmployeeService } from "./employee-service.ts";
import type {
  LeavePolicy,
  LeaveTransaction,
  LeaveBalanceReport,
  LeaveTransactionType,
  LeaveRequest,
  LeaveRequestStatus,
  SickPayTier,
  SickPayTierBreakdown,
  EmployeeLeaveEntitlementOverride,
} from "./leave-types.ts";
import { differenceInCalendarDays, parseISO, eachDayOfInterval, isValid } from "date-fns";
import { NotificationService } from "./notification-service.ts";
import { getMasterDataRepository } from "./master-data.ts";
import { SettingsService } from "./settings-service.ts";

// Recognises the different labels a policy's approvalChain might use for the line-manager
// step, matching the same tolerance approveRequest already applies when locating that step.
function isManagerRoleName(role: string): boolean {
  return role === "Line Manager" || role === "Supervisor" || role === "Manager";
}

// The 15 statutory + company-policy leave types required under Royal Decree 53/2023,
// seeded exactly once when the policy collection is empty. No randomized demo data.
export const POLICY_DEFINITIONS = [
  {
    code: "A/L",
    name: "Annual Leave",
    type: "Annual",
    category: "Statutory",
    legalBasis: "Labour Law Art. 78 & 81",
    description:
      "Paid annual holiday. By law every employee is entitled to at least 30 days per year, earns the right to take it after 6 months of service, and must take at least 30 days once every 2 years. Unused days carry forward up to 30 days into the next year unless the delay was for work reasons, in which case the balance is protected.",
    isPaid: true,
    baseEntitlementDays: 30,
    scope: "Annual",
    accrualMode: "Upfront",
    carryForwardLimit: 30,
    allowNegativeBalance: true,
    maxNegativeBalance: 5,
    requiresAttachment: false,
    requiresHandoverContact: true,
    countsTowardGratuity: true,
    eligibility: { minimumServiceMonths: 3 },
    approvalChain: ["Line Manager", "HR"],
    noticeRules: {
      enabled: true,
      shortLeaveMaxDays: 5,
      shortLeaveNoticeDays: 14,
      longLeaveNoticeDays: 60,
    },
    isEnabled: true,
    isStatutory: true,
    consumesBalance: true,
  },
  {
    code: "Sick",
    name: "Sick Leave",
    type: "Sick",
    category: "Statutory",
    legalBasis: "Labour Law Art. 82",
    description:
      "Paid medical leave, up to 182 days per year, with pay stepping down the longer the absence runs: 100% for days 1-21, 75% for days 22-35, 50% for days 36-70, and 35% for days 71-182. A medical certificate is required. The percentage that applies is calculated automatically from how many sick days the employee has already taken this year.",
    isPaid: true,
    payTiers: [
      { fromDay: 1, toDay: 21, payPercentage: 100 },
      { fromDay: 22, toDay: 35, payPercentage: 75 },
      { fromDay: 36, toDay: 70, payPercentage: 50 },
      { fromDay: 71, toDay: 182, payPercentage: 35 },
    ],
    baseEntitlementDays: 182,
    scope: "Annual",
    accrualMode: "Upfront",
    carryForwardLimit: 0,
    allowNegativeBalance: false,
    requiresAttachment: true,
    requiresHandoverContact: false,
    countsTowardGratuity: true,
    approvalChain: ["Line Manager", "HR"],
    isEnabled: true,
    isStatutory: true,
    consumesBalance: true,
  },
  {
    code: "MAT",
    name: "Maternity Leave",
    type: "Maternity",
    category: "Statutory",
    legalBasis: "Labour Law Art. 84.10",
    description:
      "98 days paid leave to cover childbirth. Up to 14 days may be taken before the due date, based on a medical recommendation, with the remainder taken from the date of birth. Available to female employees only.",
    isPaid: true,
    baseEntitlementDays: 98,
    scope: "Per Event",
    accrualMode: "Not Applicable",
    carryForwardLimit: 0,
    allowNegativeBalance: true,
    maxNegativeBalance: 98,
    requiresAttachment: true,
    requiresHandoverContact: true,
    countsTowardGratuity: true,
    eligibility: { genderRestriction: "Female" },
    approvalChain: ["Line Manager", "HR"],
    isEnabled: true,
    isStatutory: true,
    consumesBalance: true,
  },
  {
    code: "P",
    name: "Paternity Leave",
    type: "Paternity",
    category: "Statutory",
    legalBasis: "Labour Law Art. 84.1",
    description:
      "7 days paid leave for a father when a child is born alive, usable any time before the child reaches 98 days of age. Available to male employees only.",
    isPaid: true,
    baseEntitlementDays: 7,
    scope: "Per Event",
    accrualMode: "Not Applicable",
    carryForwardLimit: 0,
    allowNegativeBalance: true,
    maxNegativeBalance: 7,
    requiresAttachment: true,
    requiresHandoverContact: true,
    countsTowardGratuity: true,
    eligibility: { genderRestriction: "Male" },
    approvalChain: ["Line Manager"],
    isEnabled: true,
    isStatutory: true,
    consumesBalance: true,
  },
  {
    code: "M",
    name: "Marriage Leave",
    type: "Marriage",
    category: "Statutory",
    legalBasis: "Labour Law Art. 84.2",
    description: "3 days paid leave on the occasion of the employee getting married.",
    isPaid: true,
    baseEntitlementDays: 3,
    scope: "Per Event",
    accrualMode: "Not Applicable",
    carryForwardLimit: 0,
    allowNegativeBalance: true,
    maxNegativeBalance: 3,
    requiresAttachment: true,
    requiresHandoverContact: true,
    countsTowardGratuity: true,
    approvalChain: ["Line Manager"],
    isEnabled: true,
    isStatutory: true,
    consumesBalance: true,
  },
  {
    code: "C",
    name: "Compassionate Leave",
    type: "Compassionate",
    category: "Statutory",
    legalBasis: "Labour Law Art. 84.3-84.5",
    description:
      "Paid bereavement leave. The number of days depends on the relationship to the deceased: 10 days for the death of a spouse, son, or daughter; 3 days for a parent, grandparent, brother, or sister; 2 days for a paternal or maternal aunt or uncle. This policy is set to the maximum of 10 days. HR verifies the correct number for the specific relationship when approving each request.",
    isPaid: true,
    baseEntitlementDays: 10,
    scope: "Per Event",
    accrualMode: "Not Applicable",
    carryForwardLimit: 0,
    allowNegativeBalance: true,
    maxNegativeBalance: 10,
    requiresAttachment: true,
    requiresHandoverContact: false,
    countsTowardGratuity: true,
    approvalChain: ["Line Manager", "HR"],
    isEnabled: true,
    isStatutory: true,
    consumesBalance: true,
  },
  {
    code: "C/OFF",
    name: "Compensation Leave (Overtime Off-in-Lieu)",
    type: "CompensationOff",
    category: "Statutory",
    legalBasis: "Labour Law Art. 71 & 72",
    description:
      "A paid day off in lieu of working a weekly rest day or official holiday, or in lieu of overtime pay. Days are credited by HR when overtime worked on a rest day or holiday is approved (see the Overtime module) rather than accrued automatically, then requested here like any other leave. If an employee has 0 days credited, a request cannot be submitted until HR credits some days via Manual Adjustment.",
    isPaid: true,
    baseEntitlementDays: 0,
    scope: "Ledger",
    accrualMode: "Not Applicable",
    carryForwardLimit: 0,
    allowNegativeBalance: false,
    requiresAttachment: false,
    requiresHandoverContact: true,
    countsTowardGratuity: true,
    approvalChain: ["Line Manager"],
    isEnabled: true,
    isStatutory: true,
    consumesBalance: true,
  },
  {
    code: "AH",
    name: "Accompany Hospitalized Patient",
    type: "AccompanyPatient",
    category: "Statutory",
    legalBasis: "Labour Law Art. 84.9",
    description:
      "15 days per year for an Omani employee to accompany a sick relative, such as a spouse or a blood relative up to the 2nd degree, who requires hospital treatment.",
    isPaid: true,
    baseEntitlementDays: 15,
    scope: "Annual",
    accrualMode: "Upfront",
    carryForwardLimit: 0,
    allowNegativeBalance: false,
    requiresAttachment: true,
    requiresHandoverContact: false,
    countsTowardGratuity: true,
    eligibility: { omaniOnly: true },
    approvalChain: ["Line Manager", "HR"],
    isEnabled: true,
    isStatutory: true,
    consumesBalance: true,
  },
  {
    code: "H",
    name: "Al Hajj Leave",
    type: "Hajj",
    category: "Statutory",
    legalBasis: "Labour Law Art. 84.6",
    description:
      "15 days paid leave to perform Hajj. This entitlement can be used only one time in total during employment with the company, and only after completing 1 continuous year of service. Once used, it cannot be taken again.",
    isPaid: true,
    baseEntitlementDays: 15,
    scope: "Once Per Service",
    accrualMode: "Not Applicable",
    carryForwardLimit: 0,
    allowNegativeBalance: true,
    maxNegativeBalance: 15,
    requiresAttachment: true,
    requiresHandoverContact: true,
    countsTowardGratuity: true,
    eligibility: { omaniOnly: true, minimumServiceMonths: 12 },
    approvalChain: ["Line Manager", "HR"],
    isEnabled: true,
    isStatutory: true,
    consumesBalance: true,
  },
  {
    code: "EXAM",
    name: "Study Exam Leave",
    type: "Exam",
    category: "Statutory",
    legalBasis: "Labour Law Art. 84.7",
    description:
      "Up to 15 days per year for an Omani employee enrolled in a school, institute, college, or university to sit exams.",
    isPaid: true,
    baseEntitlementDays: 15,
    scope: "Annual",
    accrualMode: "Upfront",
    carryForwardLimit: 0,
    allowNegativeBalance: false,
    requiresAttachment: true,
    requiresHandoverContact: true,
    countsTowardGratuity: true,
    eligibility: { omaniOnly: true },
    approvalChain: ["Line Manager", "HR"],
    isEnabled: true,
    isStatutory: true,
    consumesBalance: true,
  },
  {
    code: "IDDAH",
    name: "Iddah Leave (Widowhood)",
    type: "Iddah",
    category: "Statutory",
    legalBasis: "Labour Law Art. 84.8",
    description:
      "Paid leave for a female employee whose husband has died: 130 days for a Muslim employee and 14 days for a non-Muslim employee. HR can set the correct individual allowance from the employee's leave record.",
    isPaid: true,
    baseEntitlementDays: 130,
    scope: "Per Event",
    accrualMode: "Not Applicable",
    carryForwardLimit: 0,
    allowNegativeBalance: true,
    maxNegativeBalance: 130,
    requiresAttachment: true,
    requiresHandoverContact: false,
    countsTowardGratuity: true,
    eligibility: { genderRestriction: "Female" },
    approvalChain: ["Line Manager", "HR"],
    isEnabled: true,
    isStatutory: true,
    consumesBalance: true,
  },
  {
    code: "UPL",
    name: "Unpaid Leave",
    type: "Unpaid",
    category: "Statutory",
    legalBasis: "Labour Law Art. 80 & 83",
    description:
      "Unpaid leave granted at employee request and HR discretion. General unpaid leave under Art. 80 has no fixed day limit in the law. Unpaid leave to care for a newborn or young child under Art. 83 is capped at 1 year. In both cases the employee is responsible for their own share plus the employer share and the government share of social insurance contributions during the leave, and the period does NOT count toward end-of-service gratuity. HR credits days to this balance as each case is approved via Manual Adjustment.",
    isPaid: false,
    baseEntitlementDays: 0,
    scope: "Ledger",
    accrualMode: "Not Applicable",
    carryForwardLimit: 0,
    allowNegativeBalance: false,
    requiresAttachment: false,
    requiresHandoverContact: true,
    countsTowardGratuity: false,
    approvalChain: ["Line Manager", "HR"],
    isEnabled: true,
    isStatutory: true,
    consumesBalance: true,
  },
  {
    code: "EML",
    name: "Emergency Leave",
    type: "Emergency",
    category: "Company Policy",
    description:
      "A discretionary company benefit, not required by the Labour Law, for short-notice personal emergencies. HR can adjust the day allowance or disable this policy entirely if the organisation prefers to handle emergencies as regular Annual or Unpaid leave instead.",
    isPaid: true,
    baseEntitlementDays: 3,
    scope: "Annual",
    accrualMode: "Upfront",
    carryForwardLimit: 0,
    allowNegativeBalance: true,
    maxNegativeBalance: 2,
    requiresAttachment: false,
    requiresHandoverContact: false,
    countsTowardGratuity: true,
    approvalChain: ["Line Manager"],
    isEnabled: true,
    isStatutory: false,
    consumesBalance: true,
  },
  {
    code: "RM",
    name: "Remote Work Day",
    type: "Remote",
    category: "Attendance Marker",
    description:
      "Marks a day the employee worked from outside the office rather than an absence. It does not consume any leave balance. Purely for attendance record-keeping.",
    isPaid: true,
    baseEntitlementDays: 0,
    scope: "Not Tracked",
    accrualMode: "Not Applicable",
    carryForwardLimit: 0,
    allowNegativeBalance: true,
    requiresAttachment: false,
    requiresHandoverContact: false,
    countsTowardGratuity: true,
    approvalChain: ["Line Manager"],
    isEnabled: true,
    isStatutory: false,
    consumesBalance: false,
  },
  {
    code: "R",
    name: "Resignation / Last Working Day Marker",
    type: "Resignation",
    category: "Attendance Marker",
    description:
      "Marks an employee resignation or last working day on the leave calendar. This is not an absence type. Most organisations track resignations through the Offboarding module instead, so it is safe to hide this policy if it is not used here.",
    isPaid: false,
    baseEntitlementDays: 0,
    scope: "Not Tracked",
    accrualMode: "Not Applicable",
    carryForwardLimit: 0,
    allowNegativeBalance: true,
    requiresAttachment: false,
    requiresHandoverContact: false,
    countsTowardGratuity: false,
    approvalChain: ["HR"],
    isEnabled: true,
    isStatutory: false,
    consumesBalance: false,
  },
] satisfies NewRecord<LeavePolicy>[];

export class LeaveService {
  private policyRepo: LocalRepository<LeavePolicy>;
  private transactionRepo: LocalRepository<LeaveTransaction>;
  private requestRepo: LocalRepository<LeaveRequest>;
  private entitlementOverrideRepo: LocalRepository<EmployeeLeaveEntitlementOverride>;

  constructor() {
    const { storage, audit } = getApplicationDataServices();
    this.policyRepo = new LocalRepository<LeavePolicy>("leave_policies", storage, audit, {
      module: "hr",
      entityType: "leave_policy",
    });
    this.transactionRepo = new LocalRepository<LeaveTransaction>(
      "leave_transactions",
      storage,
      audit,
      { module: "hr", entityType: "leave_transaction" },
    );
    this.requestRepo = new LocalRepository<LeaveRequest>("leave_requests", storage, audit, {
      module: "hr",
      entityType: "leave_request",
    });
    this.entitlementOverrideRepo = new LocalRepository<EmployeeLeaveEntitlementOverride>(
      "leave_entitlement_overrides",
      storage,
      audit,
      { module: "hr", entityType: "leave_entitlement_override" },
    );

    this.ensureSeedData();
  }

  private async serverActor(context: ActorContext) {
    const users = getApplicationDataServices().storage.readCollection<User>("users");
    const actorEmail =
      context.actor.workspaceEmail ??
      users.find((user) => user.id === context.actor.userId)?.workspaceEmail;
    return {
      actorId: context.actor.userId,
      ...(actorEmail ? { actorEmail } : {}),
      activeRole: context.actor.activeRole ?? context.actor.roles[0] ?? "Employee",
    } as const;
  }

  /** PostgreSQL is authoritative; these collections are a read-only compatibility projection. */
  async hydrateCompatibilityCache(context: ActorContext): Promise<void> {
    if (typeof window === "undefined") return;
    const { storage } = getApplicationDataServices();
    const employees = storage.readCollection<Employee & { databaseId?: string }>("employees");
    const users = storage.readCollection<User & { databaseId?: string }>("users");
    const employeeIdMap = new Map(
      employees.filter((item) => item.databaseId).map((item) => [item.databaseId!, item.id]),
    );
    const userIdMap = new Map(
      users.filter((item) => item.databaseId).map((item) => [item.databaseId!, item.id]),
    );
    const { getLeaveSnapshotFn } = await import("../server-functions/leave.server.ts");
    const snapshot = await getLeaveSnapshotFn({ data: { actor: await this.serverActor(context) } });
    const mapEmployee = (id: string) => employeeIdMap.get(id) ?? id;
    storage.writeCollection("leave_policies", snapshot.policies);
    storage.writeCollection(
      "leave_requests",
      snapshot.requests.map((request) => ({
        ...request,
        employeeId: mapEmployee(request.employeeId),
        ...(request.handoverContactId
          ? { handoverContactId: mapEmployee(request.handoverContactId) }
          : {}),
        chainApprovals: request.chainApprovals.map((step) => ({
          ...step,
          ...(step.approvedBy
            ? { approvedBy: userIdMap.get(step.approvedBy) ?? step.approvedBy }
            : {}),
        })),
      })),
    );
    storage.writeCollection(
      "leave_transactions",
      snapshot.transactions.map((transaction) => ({
        ...transaction,
        employeeId: mapEmployee(transaction.employeeId),
        actorUserId: userIdMap.get(transaction.actorUserId) ?? transaction.actorUserId,
      })),
    );
    storage.writeCollection(
      "leave_entitlement_overrides",
      snapshot.entitlementOverrides.map((override) => ({
        ...override,
        employeeId: mapEmployee(override.employeeId),
      })),
    );
    storage.writeCollection(
      "leave_database_balances",
      snapshot.balances.map((balance) => ({
        ...balance,
        employeeId: mapEmployee(balance.employeeId),
      })),
    );
  }

  private denyAccess(
    action: string,
    entityId: string,
    reason: string,
    context: ActorContext,
  ): never {
    getApplicationDataServices().audit.record({
      context,
      action: "access-denied",
      module: "leave",
      entityType: "leave_request",
      entityId,
      reason: `${action}: ${reason}`,
      riskLevel: "High",
    });
    throw new Error(reason);
  }

  private requireOrganisationRead(context: ActorContext, action: string): void {
    const activeRole = context.actor.activeRole ?? context.actor.roles[0];
    if (activeRole && ["HR", "Super Admin"].includes(activeRole)) return;
    this.denyAccess(
      "Leave read denied",
      "all-leave-records",
      `You are not authorised to ${action}.`,
      context,
    );
  }

  private requireEmployeeRead(employeeId: string, context: ActorContext, action: string): void {
    const activeRole = context.actor.activeRole ?? context.actor.roles[0];
    if (context.actor.employeeId === employeeId) return;
    if (activeRole && ["HR", "Super Admin"].includes(activeRole)) return;
    if (activeRole === "Line Manager" && context.actor.employeeId) {
      const employee = new EmployeeService().getById(employeeId, SYSTEM_CONTEXT);
      if (employee?.lineManagerId === context.actor.employeeId) return;
    }
    this.denyAccess(
      "Leave read denied",
      employeeId,
      `You are not authorised to ${action}.`,
      context,
    );
  }

  async getAttachmentBlob(
    requestId: string,
    context: ActorContext,
  ): Promise<{ blob: Blob; fileName: string }> {
    const req = this.requestRepo.getById(requestId);
    if (!req) throw new Error("Request not found");
    if (!req.attachmentFileId) throw new Error("This request has no supporting attachment.");

    const isOwner = context.actor.employeeId === req.employeeId;
    const isHrOrAdmin =
      context.actor.activeRole === "HR" || context.actor.activeRole === "Super Admin";
    const employee = new EmployeeService().getById(req.employeeId, SYSTEM_CONTEXT);
    const isLineManager =
      Boolean(context.actor.employeeId) && employee?.lineManagerId === context.actor.employeeId;

    if (!isOwner && !isHrOrAdmin && !isLineManager) {
      this.denyAccess(
        "Leave attachment access denied",
        req.id,
        "You are not authorised to view this employee's leave attachment.",
        context,
      );
    }

    if (typeof window !== "undefined") {
      const { readLeaveAttachmentFn } = await import("../server-functions/leave.server.ts");
      const result = await readLeaveAttachmentFn({
        data: { actor: await this.serverActor(context), requestId },
      });
      return {
        blob: new Blob([Uint8Array.from(result.bytes)], { type: result.metadata.mimeType }),
        fileName: result.metadata.name,
      };
    }
    const { files } = getApplicationDataServices();
    const [metadata, blob] = await Promise.all([
      files.getMetadata(req.attachmentFileId),
      files.getBlob(req.attachmentFileId),
    ]);
    if (!metadata || !blob) throw new Error("The supporting file could not be found.");

    getApplicationDataServices().audit.record({
      context,
      action: "leave_attachment_accessed",
      module: "leave",
      entityType: "leave_request",
      entityId: req.id,
      reason: `Viewed supporting attachment for leave request ${req.id}.`,
      riskLevel: "Medium",
    });

    return { blob, fileName: metadata.name ?? "attachment" };
  }

  private ensureSeedData() {
    const systemActor: ActorContext = {
      actor: { userId: "system", displayName: "System Initialization", roles: ["Super Admin"] },
    };

    const existingPolicies = this.policyRepo.list({ includeArchived: true });
    for (const definition of POLICY_DEFINITIONS) {
      const existing = existingPolicies.find(
        (policy) =>
          policy.code === definition.code ||
          policy.type === definition.type ||
          policy.name === definition.name,
      );

      if (!existing) {
        this.policyRepo.create({ ...definition }, systemActor);
        continue;
      }

      // Policies created by older browser schemas did not contain the newer
      // eligibility and visibility fields. Preserve every HR-edited value and
      // only fill fields that did not exist at the time the record was saved.
      const backfill: Partial<LeavePolicy> = {};
      for (const [key, value] of Object.entries(definition)) {
        const policyKey = key as keyof LeavePolicy;
        if (existing[policyKey] === undefined) {
          (backfill as Record<string, unknown>)[key] = structuredClone(value);
        }
      }

      if (definition.noticeRules && existing.noticeRules) {
        const noticeRules = {
          ...definition.noticeRules,
          ...existing.noticeRules,
        };
        if (JSON.stringify(noticeRules) !== JSON.stringify(existing.noticeRules)) {
          backfill.noticeRules = noticeRules;
        }
      }

      if (Object.keys(backfill).length > 0) {
        this.policyRepo.update(existing.id, backfill, {
          ...systemActor,
          reason: `Completed missing fields on the saved ${existing.name} policy`,
        });
      }
    }

    const policies = this.policyRepo.list();

    const transactions = this.transactionRepo.list();
    const wasFreshLeaveLedger = transactions.length === 0;
    const empService = new EmployeeService();
    const employees = empService
      .getEmployees(SYSTEM_CONTEXT)
      .filter((employee) => !["Inactive", "Archived"].includes(employee.status));
    const now = new Date().toISOString();
    const currentYear = new Date(now).getFullYear();

    // Reconcile each employee/policy pair independently. Previously this ran
    // only when the whole ledger was empty, which left employees added later
    // with no entitlement at all.
    for (const emp of employees) {
      for (const policy of policies) {
        if (policy.scope !== "Annual" || !policy.isEnabled) continue;
        if (!this.isEmployeeEligibleForPolicy(emp, policy)) continue;

        const alreadyGranted = this.transactionRepo
          .list()
          .some(
            (transaction) =>
              transaction.employeeId === emp.id &&
              transaction.policyId === policy.id &&
              transaction.transactionType === "Entitlement" &&
              new Date(transaction.date).getFullYear() === currentYear,
          );
        if (alreadyGranted) continue;

        this.transactionRepo.create(
          {
            employeeId: emp.id,
            policyId: policy.id,
            date: now,
            transactionType: "Entitlement",
            days: policy.baseEntitlementDays,
            reason: `${currentYear} ${policy.name} entitlement granted under VIA leave policy.`,
            actorUserId: "system",
          },
          systemActor,
        );
      }
    }

    if (wasFreshLeaveLedger) {
      // One realistic in-flight demo request so the HR and manager attention queues
      // have something genuine to show, rather than reading empty on a fresh install.
      const annualPolicy = policies.find((p) => p.type === "Annual");
      const omar = employees.find((e) => e.id === "employee-omar");
      if (annualPolicy && omar) {
        const start = new Date();
        start.setDate(start.getDate() + 10);
        const end = new Date(start);
        end.setDate(end.getDate() + 2);

        this.requestRepo.create(
          {
            employeeId: omar.id,
            policyId: annualPolicy.id,
            startDate: start.toISOString().slice(0, 10),
            endDate: end.toISOString().slice(0, 10),
            isHalfDay: false,
            workingDaysRequested: 3,
            reason: "Family travel",
            status: "Pending Line Manager",
            chainApprovals: [
              { role: "Line Manager", status: "Pending" },
              { role: "HR", status: "Pending" },
            ],
            policySnapshot: {
              name: annualPolicy.name,
              type: annualPolicy.type,
              isPaid: annualPolicy.isPaid,
              baseEntitlementDays: annualPolicy.baseEntitlementDays,
              accrualMode: annualPolicy.accrualMode,
            },
          },
          systemActor,
        );
      }
    }

    this.migrateLegacyAnnualPolicy(systemActor);
  }

  private migrateLegacyAnnualPolicy(context: ActorContext): void {
    const annualPolicy = this.policyRepo.list().find((policy) => policy.type === "Annual");
    if (
      !annualPolicy ||
      annualPolicy.baseEntitlementDays !== 25 ||
      annualPolicy.updatedBy !== "system"
    ) {
      return;
    }

    this.updatePolicy(
      annualPolicy.id,
      {
        baseEntitlementDays: 30,
        noticeRules: {
          enabled: true,
          shortLeaveMaxDays: 5,
          shortLeaveNoticeDays: 14,
          longLeaveNoticeDays: 60,
        },
      },
      {
        ...context,
        reason: "Legacy demo allowance aligned with the approved VIA annual leave policy",
      },
    );
  }

  isEmployeeEligibleForPolicy(employee: Employee, policy: LeavePolicy): boolean {
    const eligibility = policy.eligibility;
    if (!eligibility) return true;

    if (eligibility.genderRestriction) {
      if (employee.gender !== eligibility.genderRestriction) return false;
    }

    if (eligibility.omaniOnly) {
      const nationality = (employee.nationality ?? "").trim().toLowerCase();
      if (nationality !== "omani") return false;
    }

    // Minimum-service rules affect the first permissible leave date. Keep the policy visible so
    // employees can understand their future entitlement and plan ahead.

    return true;
  }

  getEligiblePolicies(employeeId: string, context: ActorContext): LeavePolicy[] {
    this.requireEmployeeRead(employeeId, context, "view this employee's leave eligibility");
    const empService = new EmployeeService();
    const employee = empService.getById(employeeId, SYSTEM_CONTEXT);
    const policies = this.getPolicies();

    if (!employee) {
      return policies.filter((p) => p.isEnabled && !p.eligibility);
    }

    return policies.filter((p) => p.isEnabled && this.isEmployeeEligibleForPolicy(employee, p));
  }

  getPolicies(): LeavePolicy[] {
    return this.policyRepo.list();
  }

  async updatePolicyAsync(policy: LeavePolicy, context: ActorContext): Promise<LeavePolicy> {
    if (typeof window === "undefined") return this.updatePolicy(policy.id, policy, context);
    const { updateLeavePolicyFn } = await import("../server-functions/leave.server.ts");
    await updateLeavePolicyFn({
      data: {
        actor: await this.serverActor(context),
        policyId: policy.id,
        policy: {
          recordVersion: policy.recordVersion,
          description: policy.description,
          isPaid: policy.isPaid,
          ...(policy.payTiers ? { payTiers: policy.payTiers } : {}),
          baseEntitlementDays: policy.baseEntitlementDays,
          accrualMode: policy.accrualMode,
          carryForwardLimit: policy.carryForwardLimit,
          allowNegativeBalance: policy.allowNegativeBalance,
          ...(policy.maxNegativeBalance !== undefined
            ? { maxNegativeBalance: policy.maxNegativeBalance }
            : {}),
          requiresAttachment: policy.requiresAttachment,
          requiresHandoverContact: policy.requiresHandoverContact,
          countsTowardGratuity: policy.countsTowardGratuity,
          ...(policy.eligibility ? { eligibility: policy.eligibility } : {}),
          approvalChain: ["Line Manager", "HR"],
          ...(policy.noticeRules ? { noticeRules: policy.noticeRules } : {}),
          isEnabled: policy.isEnabled,
          consumesBalance: policy.consumesBalance,
        },
      },
    });
    await this.hydrateCompatibilityCache(context);
    const updated = this.policyRepo.getById(policy.id);
    if (!updated) throw new Error("The leave policy was saved but could not be reloaded.");
    return updated;
  }

  updatePolicy(id: string, updates: Partial<LeavePolicy>, context: ActorContext): LeavePolicy {
    const activeRole = context.actor.activeRole ?? context.actor.roles[0];
    if (activeRole !== "HR" && activeRole !== "Super Admin") {
      getApplicationDataServices().audit.record({
        context,
        action: "leave_policy_access_denied",
        module: "leave",
        entityType: "leave_policy",
        entityId: id,
        reason: "Only HR or Super Admin may change organisation-wide leave policy.",
        riskLevel: "High",
      });
      throw new Error("Your active role is not authorised to change leave policy.");
    }

    const current = this.policyRepo.getById(id);
    if (!current) throw new Error("Leave policy was not found.");

    const candidate = { ...current, ...updates };
    if (!candidate.name.trim() || !candidate.code.trim() || !candidate.description.trim()) {
      throw new Error("Policy name, code and explanation are required.");
    }
    if (!Number.isFinite(candidate.baseEntitlementDays) || candidate.baseEntitlementDays < 0) {
      throw new Error("Base entitlement days must be zero or greater.");
    }
    if (!Number.isFinite(candidate.carryForwardLimit) || candidate.carryForwardLimit < 0) {
      throw new Error("Carry-forward days must be zero or greater.");
    }
    if (
      !["Upfront", "Monthly", "Per Pay Period", "Not Applicable"].includes(candidate.accrualMode)
    ) {
      throw new Error("Select a valid balance method.");
    }
    if (candidate.allowNegativeBalance) {
      if (
        !Number.isFinite(candidate.maxNegativeBalance) ||
        (candidate.maxNegativeBalance ?? 0) <= 0
      ) {
        throw new Error("Enter the maximum number of advance leave days allowed.");
      }
    } else {
      candidate.maxNegativeBalance = undefined;
    }
    if (
      candidate.eligibility?.minimumServiceMonths !== undefined &&
      (!Number.isInteger(candidate.eligibility.minimumServiceMonths) ||
        candidate.eligibility.minimumServiceMonths < 0)
    ) {
      throw new Error("Minimum service must be a whole number of months.");
    }
    if (
      candidate.approvalChain.length !== 2 ||
      candidate.approvalChain[0] !== "Line Manager" ||
      candidate.approvalChain[1] !== "HR"
    ) {
      throw new Error("Leave approval must follow Supervisor, then HR.");
    }
    if (candidate.noticeRules?.enabled) {
      const noticeValues = [
        candidate.noticeRules.shortLeaveMaxDays,
        candidate.noticeRules.shortLeaveNoticeDays,
        candidate.noticeRules.longLeaveNoticeDays,
      ];
      if (noticeValues.some((value) => !Number.isInteger(value) || value < 0)) {
        throw new Error("Notice rules must use whole numbers of zero or greater.");
      }
      if (candidate.noticeRules.longLeaveNoticeDays < candidate.noticeRules.shortLeaveNoticeDays) {
        throw new Error("Long leave notice cannot be shorter than short leave notice.");
      }
    }
    if (candidate.payTiers?.length) {
      const tiers = [...candidate.payTiers].sort((a, b) => a.fromDay - b.fromDay);
      tiers.forEach((tier, index) => {
        if (
          !Number.isInteger(tier.fromDay) ||
          !Number.isInteger(tier.toDay) ||
          tier.fromDay < 1 ||
          tier.toDay < tier.fromDay ||
          !Number.isFinite(tier.payPercentage) ||
          tier.payPercentage < 0 ||
          tier.payPercentage > 100
        ) {
          throw new Error("Sick pay tiers must contain valid day ranges and percentages.");
        }
        if (index > 0 && tiers[index - 1]!.toDay + 1 !== tier.fromDay) {
          throw new Error("Sick pay tiers must be continuous without overlapping or missing days.");
        }
      });
      candidate.payTiers = tiers;
    }

    if (
      updates.baseEntitlementDays !== undefined &&
      (!Number.isFinite(updates.baseEntitlementDays) || updates.baseEntitlementDays < 0)
    ) {
      throw new Error("Base entitlement days must be zero or greater.");
    }
    if (
      updates.carryForwardLimit !== undefined &&
      (!Number.isFinite(updates.carryForwardLimit) || updates.carryForwardLimit < 0)
    ) {
      throw new Error("Carry-forward days must be zero or greater.");
    }
    if (updates.isEnabled === false) {
      if (current.isStatutory) {
        const basis = current.legalBasis || "the Labour Law";
        throw new Error(`${current.name} is required by ${basis} and cannot be disabled.`);
      }
    }

    const { storage } = getApplicationDataServices();
    const snapshot = storage.createRawSnapshot();
    try {
      const updated = this.policyRepo.update(id, candidate, context);
      if (
        current.scope === "Annual" &&
        updated.scope === "Annual" &&
        current.baseEntitlementDays !== updated.baseEntitlementDays
      ) {
        this.applyCurrentYearEntitlementChange(current, updated, context);
      }
      return updated;
    } catch (error) {
      storage.restoreRawSnapshot(snapshot);
      throw error;
    }
  }

  private applyCurrentYearEntitlementChange(
    previous: LeavePolicy,
    updated: LeavePolicy,
    context: ActorContext,
  ): void {
    const delta = updated.baseEntitlementDays - previous.baseEntitlementDays;
    if (delta === 0) return;

    const currentYear = new Date().getFullYear();
    const employees = new EmployeeService()
      .getEmployees(SYSTEM_CONTEXT)
      .filter((employee) => !["Inactive", "Archived"].includes(employee.status));

    for (const employee of employees) {
      if (!this.isEmployeeEligibleForPolicy(employee, updated)) continue;

      const currentYearEntitlement = this.getTransactionsForEmployee(
        employee.id,
        updated.id,
        context,
      ).find(
        (transaction) =>
          transaction.transactionType === "Entitlement" &&
          new Date(transaction.date).getFullYear() === currentYear,
      );

      if (!currentYearEntitlement) {
        this.recordTransaction(
          {
            employeeId: employee.id,
            policyId: updated.id,
            date: new Date().toISOString(),
            transactionType: "Entitlement",
            days: updated.baseEntitlementDays,
            reason: `${currentYear} entitlement created from the updated ${updated.name} policy.`,
          },
          { ...context, reason: `${updated.name} entitlement applied to all eligible staff` },
        );
        continue;
      }

      this.recordTransaction(
        {
          employeeId: employee.id,
          policyId: updated.id,
          date: new Date().toISOString(),
          transactionType: "Manual Adjustment",
          days: delta,
          reason: `HR updated the ${currentYear} ${updated.name} entitlement from ${previous.baseEntitlementDays} to ${updated.baseEntitlementDays} days.`,
        },
        { ...context, reason: `${updated.name} entitlement applied to all eligible staff` },
      );
    }
  }

  getTransactionsForEmployee(
    employeeId: string,
    policyId: string | undefined,
    context: ActorContext,
  ): LeaveTransaction[] {
    this.requireEmployeeRead(employeeId, context, "view this employee's leave balance activity");
    const list = this.transactionRepo.list().filter((t) => t.employeeId === employeeId);
    if (policyId) return list.filter((t) => t.policyId === policyId);
    return list;
  }

  getAllRequests(context: ActorContext): LeaveRequest[] {
    this.requireOrganisationRead(context, "view all leave requests");
    return this.requestRepo.list();
  }

  getPayrollLeaveRequests(context: ActorContext): LeaveRequest[] {
    if (context.actor.activeRole !== "Accounts" && context.actor.activeRole !== "Super Admin") {
      this.denyAccess(
        "Payroll leave read denied",
        "payroll-leave-records",
        "Only Accounts or Super Admin can view payroll leave inputs.",
        context,
      );
    }
    return this.requestRepo
      .list()
      .filter((request) => request.status === "Approved" || request.status === "Taken")
      .map((request) => {
        const safeRequest = {
          ...request,
          reason: "Not included in payroll",
        };
        delete safeRequest.attachmentFileId;
        delete safeRequest.handoverContactId;
        return safeRequest;
      });
  }

  getRequests(context: ActorContext): LeaveRequest[] {
    if (["HR", "Super Admin"].includes(context.actor.activeRole ?? "")) {
      return this.requestRepo.list().map((request) => this.presentRequest(request));
    }
    if (context.actor.activeRole === "Accounts") return this.getPayrollLeaveRequests(context);
    if (context.actor.activeRole === "Line Manager" && context.actor.employeeId) {
      const reportIds = new Set(
        new EmployeeService()
          .getEmployees(SYSTEM_CONTEXT)
          .filter((employee) => employee.lineManagerId === context.actor.employeeId)
          .map((employee) => employee.id),
      );
      return this.requestRepo
        .list()
        .filter(
          (request) =>
            request.employeeId === context.actor.employeeId || reportIds.has(request.employeeId),
        )
        .map((request) => this.presentRequest(request));
    }
    return context.actor.employeeId
      ? this.requestRepo
          .list()
          .filter((request) => request.employeeId === context.actor.employeeId)
          .map((request) => this.presentRequest(request))
      : [];
  }

  getLeaveRequestsForEmployee(employeeId: string, context: ActorContext): LeaveRequest[] {
    this.requireEmployeeRead(employeeId, context, "view this employee's leave requests");
    return this.requestRepo
      .list()
      .filter((r) => r.employeeId === employeeId)
      .map((request) => this.presentRequest(request));
  }

  private presentRequest(request: LeaveRequest): LeaveRequest {
    const today = new Date().toISOString().slice(0, 10);
    return request.status === "Approved" && request.endDate < today
      ? { ...request, status: "Taken" }
      : request;
  }

  getPendingRequestsForManager(context: ActorContext): LeaveRequest[] {
    if (!context.actor.employeeId || context.actor.activeRole !== "Line Manager") {
      this.denyAccess(
        "Manager leave queue denied",
        "manager-queue",
        "Only a line manager can view their direct-report leave queue.",
        context,
      );
    }
    const empService = new EmployeeService();
    const allEmployees = empService.getEmployees(SYSTEM_CONTEXT);

    // Find employees who report directly to this manager
    const directReports = allEmployees.filter((e) => e.lineManagerId === context.actor.employeeId);
    const reportIds = new Set(directReports.map((e) => e.id));

    return this.requestRepo
      .list()
      .filter(
        (r) =>
          (r.status === "Pending Line Manager" || r.status === "Amendment Pending Line Manager") &&
          reportIds.has(r.employeeId),
      );
  }

  getPendingRequestsForHr(context: ActorContext): LeaveRequest[] {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      this.denyAccess(
        "HR leave queue denied",
        "hr-queue",
        "Only HR or Super Admin can view the final leave queue.",
        context,
      );
    }
    return this.requestRepo
      .list()
      .filter(
        (r) =>
          r.status === "Pending Line Manager" ||
          r.status === "Pending HR" ||
          r.status === "Pending Super Admin" ||
          r.status === "Cancellation Pending" ||
          r.status === "Amendment Pending Line Manager" ||
          r.status === "Amendment Pending HR",
      );
  }

  /** Compatibility alias for older dashboard code and browser records. */
  getPendingRequestsForSuperAdmin(context: ActorContext): LeaveRequest[] {
    return this.getPendingRequestsForHr(context);
  }

  getTeamOverlaps(
    departmentId: string,
    startDate: string,
    endDate: string,
    context: ActorContext,
  ): LeaveRequest[] {
    if (!["Line Manager", "HR", "Super Admin"].includes(context.actor.activeRole ?? "")) {
      this.denyAccess(
        "Team leave overlap denied",
        departmentId,
        "You are not authorised to view team leave overlaps.",
        context,
      );
    }
    const start = parseISO(startDate);
    const end = parseISO(endDate);

    const empService = new EmployeeService();
    const allEmployees = empService.getEmployees(SYSTEM_CONTEXT);
    const deptEmployees = new Set(
      allEmployees
        .filter(
          (employee) =>
            employee.department === departmentId &&
            (context.actor.activeRole !== "Line Manager" ||
              employee.lineManagerId === context.actor.employeeId),
        )
        .map((e) => e.id),
    );

    return this.requestRepo.list().filter((r) => {
      if (!deptEmployees.has(r.employeeId)) return false;
      if (
        r.status !== "Approved" &&
        r.status !== "Pending Line Manager" &&
        r.status !== "Pending HR" &&
        r.status !== "Pending Super Admin" &&
        r.status !== "Amendment Pending Line Manager" &&
        r.status !== "Amendment Pending HR"
      )
        return false;

      const rStart = parseISO(r.startDate);
      const rEnd = parseISO(r.endDate);

      // Check for date overlap
      return start <= rEnd && end >= rStart;
    });
  }

  async decideRequestAsync(
    requestId: string,
    decision: "approve" | "decline",
    reason: string | undefined,
    context: ActorContext,
  ): Promise<LeaveRequest> {
    if (typeof window === "undefined") {
      return decision === "approve"
        ? this.approveRequest(requestId, context)
        : this.rejectRequest(requestId, reason ?? "", context);
    }
    const { decideLeaveRequestFn } = await import("../server-functions/leave.server.ts");
    await decideLeaveRequestFn({
      data: {
        actor: await this.serverActor(context),
        requestId,
        decision,
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
      },
    });
    await this.hydrateCompatibilityCache(context);
    const updated = this.requestRepo.getById(requestId);
    if (!updated) throw new Error("Leave was updated but could not be reloaded.");
    return updated;
  }

  approveRequest(requestId: string, context: ActorContext): LeaveRequest {
    const req = this.requestRepo.getById(requestId);
    if (!req) throw new Error("Request not found");

    if (req.status === "Amendment Pending Line Manager" || req.status === "Amendment Pending HR") {
      return this.approveAmendment(req, context);
    }

    if (req.status === "Pending Line Manager") {
      const employee = new EmployeeService().getById(req.employeeId, SYSTEM_CONTEXT);
      const isAssignedManager =
        Boolean(context.actor.employeeId) && employee?.lineManagerId === context.actor.employeeId;
      const isRecoveryApprover = ["HR", "Super Admin"].includes(context.actor.activeRole ?? "");
      if (!isAssignedManager && !isRecoveryApprover) {
        this.denyAccess(
          "Leave approval denied",
          req.id,
          "Only the employee’s assigned line manager can complete this approval.",
          context,
        );
      }
      if (isRecoveryApprover && !isAssignedManager && (context.reason?.trim().length ?? 0) < 5) {
        throw new Error("Enter a reason for completing the unavailable supervisor's review.");
      }
      // Update chain
      const step = req.chainApprovals.find(
        (c) => c.role === "Supervisor" || c.role === "Line Manager" || c.role === "Manager",
      );
      if (step) {
        step.status = "Approved";
        step.approvedBy = context.actor.userId;
        step.date = new Date().toISOString();
      }

      // Honor the policy's configured approval chain: only move to an HR step if one is
      // actually next in this request's chain (some policies are manager-only, single-step
      // approvals) - otherwise this manager approval is the final decision.
      const hasRemainingHrStep = req.chainApprovals.some(
        (c) => (c.role === "HR" || c.role === "Super Admin") && c.status === "Pending",
      );
      if (hasRemainingHrStep) {
        req.status = "Pending HR";
        const advancedReq = this.requestRepo.update(req.id, req, context);
        this.notifySubmission(advancedReq, context);
        return advancedReq;
      }

      req.status = "Approved";
      const updatedReq = this.requestRepo.update(req.id, req, context);
      this.finalizeApprovedLeave(updatedReq, context);
      return updatedReq;
    }

    if (req.status === "Pending HR" || req.status === "Pending Super Admin") {
      if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
        this.denyAccess(
          "Final leave approval denied",
          req.id,
          "Only HR can complete final leave approval.",
          context,
        );
      }
      if (context.actor.employeeId === req.employeeId) {
        this.denyAccess(
          "Final leave approval denied",
          req.id,
          "You cannot approve your own leave request.",
          context,
        );
      }
      req.status = "Approved";
      // Update chain
      const step = req.chainApprovals.find((c) => c.role === "HR" || c.role === "Super Admin");
      if (step) {
        step.status = "Approved";
        step.approvedBy = context.actor.userId;
        step.date = new Date().toISOString();
      }

      const updatedReq = this.requestRepo.update(req.id, req, context);
      this.finalizeApprovedLeave(updatedReq, context);
      return updatedReq;
    }

    if (req.status === "Cancellation Pending") {
      if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
        this.denyAccess(
          "Leave cancellation approval denied",
          req.id,
          "Only HR can approve a leave cancellation.",
          context,
        );
      }
      if (context.actor.employeeId === req.employeeId) {
        this.denyAccess(
          "Leave cancellation approval denied",
          req.id,
          "You cannot approve your own leave cancellation.",
          context,
        );
      }
      req.status = "Cancellation Approved";
      const updatedReq = this.requestRepo.update(req.id, req, context);

      // Restore ledger balance
      this.recordTransaction(
        {
          employeeId: req.employeeId,
          policyId: req.policyId,
          transactionType: "Cancellation Restoration",
          days: req.workingDaysRequested, // positive addition
          reason: `Cancellation approved: ${req.cancellationReason || "No reason provided"}`,
          referenceId: req.id,
        },
        context,
      );

      return updatedReq;
    }

    throw new Error("Cannot approve request in its current state.");
  }

  rejectRequest(requestId: string, reason: string, context: ActorContext): LeaveRequest {
    const req = this.requestRepo.getById(requestId);
    if (!req) throw new Error("Request not found");

    if (req.status === "Amendment Pending Line Manager" || req.status === "Amendment Pending HR") {
      return this.rejectAmendment(req, reason, context);
    }

    if (req.status === "Pending Line Manager") {
      const employee = new EmployeeService().getById(req.employeeId, SYSTEM_CONTEXT);
      const isAssignedManager =
        Boolean(context.actor.employeeId) && employee?.lineManagerId === context.actor.employeeId;
      const isRecoveryApprover = ["HR", "Super Admin"].includes(context.actor.activeRole ?? "");
      if (!isAssignedManager && !isRecoveryApprover) {
        this.denyAccess(
          "Leave rejection denied",
          req.id,
          "Only the employee’s assigned line manager can decline this request at this stage.",
          context,
        );
      }
      if (isRecoveryApprover && !isAssignedManager && (context.reason?.trim().length ?? 0) < 5) {
        throw new Error("Enter a reason for completing the unavailable supervisor's review.");
      }
    } else if (
      req.status === "Pending HR" ||
      req.status === "Pending Super Admin" ||
      req.status === "Cancellation Pending"
    ) {
      if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
        this.denyAccess(
          "Final leave decision denied",
          req.id,
          "Only HR can make this final leave decision.",
          context,
        );
      }
      if (context.actor.employeeId === req.employeeId) {
        this.denyAccess(
          "Final leave decision denied",
          req.id,
          "You cannot decide your own leave request.",
          context,
        );
      }
    } else {
      throw new Error("This leave request is not awaiting a decision.");
    }

    if (!reason || reason.trim().length < 3) {
      throw new Error("A reason is required to reject a request.");
    }

    if (req.status === "Cancellation Pending") {
      // Denying a cancellation request means HR wants the original approved leave
      // to stand as-is. The original "Approved Leave" balance deduction transaction
      // must NOT be reversed or touched - the leave itself was never declined.
      req.status = "Approved";
      req.cancellationReason = `Cancellation request denied: ${reason}`;
      return this.requestRepo.update(req.id, req, context);
    }

    req.status = "Declined";
    // Find the currently pending step to mark declined
    const step = req.chainApprovals.find((c) => c.status === "Pending");
    if (step) {
      step.status = "Declined";
      step.approvedBy = context.actor.userId;
      step.date = new Date().toISOString();
    }

    req.refusalReason = reason;

    return this.requestRepo.update(req.id, req, context);
  }

  // Shared by both approval paths - a manager-only policy finalizing right after the line
  // manager's decision, and a policy whose chain continues on to HR - so the balance deduction
  // and notifications happen exactly once, wherever in the chain the request actually finishes.
  private finalizeApprovedLeave(req: LeaveRequest, context: ActorContext): void {
    this.recordTransaction(
      {
        employeeId: req.employeeId,
        policyId: req.policyId,
        transactionType: "Approved Leave",
        days: -req.workingDaysRequested, // deduction
        reason: req.reason,
        referenceId: req.id,
      },
      context,
    );

    // Notify the backstop if one is assigned
    if (req.handoverContactId) {
      const { storage, audit } = getApplicationDataServices();
      const notifService = new NotificationService(storage, audit);
      const empService = new EmployeeService();
      const requester = empService.getById(req.employeeId, SYSTEM_CONTEXT);
      const handoverUser = storage
        .readCollection<User>("users")
        .find((user) => user.employeeId === req.handoverContactId && user.status === "Active");
      if (handoverUser) {
        notifService.create(
          {
            recipientUserId: handoverUser.id,
            type: "Info",
            title: "Leave Backstop Assignment",
            message: `${requester?.legalName || "A colleague"} has an approved leave from ${new Date(req.startDate).toLocaleDateString()} to ${new Date(req.endDate).toLocaleDateString()}. You are listed as their covering colleague.`,
            priority: "High",
            status: "Unread",
            deduplicationKey: `leave-handover-${req.id}-${handoverUser.id}`,
          },
          context,
        );
      }
    }

    this.notifyApprovedLeave(req, context);
  }

  private notifyApprovedLeave(request: LeaveRequest, context: ActorContext): void {
    const { storage, notifications } = getApplicationDataServices();
    const employees = new EmployeeService().getEmployees(SYSTEM_CONTEXT);
    const requester = employees.find((employee) => employee.id === request.employeeId);
    if (!requester) return;
    const users = storage.readCollection<User>("users").filter((user) => user.status === "Active");
    const requesterUser = users.find((user) => user.employeeId === requester.id);
    if (requesterUser) {
      notifications.create(
        {
          recipientUserId: requesterUser.id,
          type: "Success",
          title: "Leave approved",
          message: `HR approved your leave from ${request.startDate} to ${request.endDate}.`,
          priority: "High",
          status: "Unread",
          deduplicationKey: `leave-approved-${request.id}`,
          link: {
            entityType: "leave-request",
            entityId: request.id,
            path: "/staff/me/leave-balances",
          },
        },
        context,
      );
    }

    const colleagueIds = new Set(
      employees
        .filter(
          (employee) =>
            employee.id !== requester.id &&
            employee.location === requester.location &&
            !["Inactive", "Archived"].includes(employee.status),
        )
        .map((employee) => employee.id),
    );
    for (const user of users) {
      if (!user.employeeId || !colleagueIds.has(user.employeeId)) continue;
      notifications.create(
        {
          recipientUserId: user.id,
          type: "Info",
          title: "Team availability update",
          message: `${requester.preferredName || requester.legalName} will be away from ${request.startDate} to ${request.endDate}.`,
          priority: "Normal",
          status: "Unread",
          deduplicationKey: `leave-office-${request.id}-${user.id}`,
          link: { entityType: "leave-request", entityId: request.id, path: "/staff" },
        },
        context,
      );
    }
  }

  calculateWorkingDays(startDate: string, endDate: string, isHalfDay: boolean): number {
    const start = parseISO(startDate);
    const end = parseISO(endDate);

    if (start > end) return 0;

    const workingDaysOfWeek = new SettingsService().getAppSettingsSync().workingDays;
    const isRestDay = (d: Date) => !workingDaysOfWeek.includes(d.getDay());

    let workingDays = 0;
    const publicHolidayDates = new Set(
      getMasterDataRepository("publicHolidays")
        .list()
        .filter((holiday) => holiday.isActive)
        .map((holiday) => {
          const record = holiday as typeof holiday & { date?: string };
          if (record.date) return record.date;
          if (/^\d{4}-\d{2}-\d{2}$/.test(holiday.description ?? "")) {
            return holiday.description;
          }
          return holiday.name.match(/\d{4}-\d{2}-\d{2}/)?.[0];
        })
        .filter((date): date is string => Boolean(date)),
    );
    if (isHalfDay) {
      if (startDate !== endDate || isRestDay(start) || publicHolidayDates.has(startDate)) return 0;
      return 0.5;
    }
    const days = eachDayOfInterval({ start, end });
    for (const d of days) {
      const dateKey = [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, "0"),
        String(d.getDate()).padStart(2, "0"),
      ].join("-");
      if (!isRestDay(d) && !publicHolidayDates.has(dateKey)) {
        workingDays++;
      }
    }

    return workingDays;
  }

  async submitLeaveRequest(
    payload: Partial<LeaveRequest>,
    context: ActorContext,
    attachment?: File,
  ): Promise<LeaveRequest> {
    if (
      !payload.employeeId ||
      !payload.policyId ||
      !payload.startDate ||
      !payload.endDate ||
      !payload.reason?.trim()
    ) {
      throw new Error("Missing required fields for leave request.");
    }

    if (!context.actor.employeeId || context.actor.employeeId !== payload.employeeId) {
      this.denyAccess(
        "Leave request submission denied",
        payload.employeeId,
        "You can only submit a leave request for yourself.",
        context,
      );
    }

    if (typeof window !== "undefined") {
      const employees = getApplicationDataServices().storage.readCollection<
        Employee & { databaseId?: string }
      >("employees");
      const employeeById = new Map(employees.map((item) => [item.id, item]));
      const employee = employeeById.get(payload.employeeId);
      if (!employee?.databaseId)
        throw new Error("Your employee record is not linked to PostgreSQL.");
      const handover = payload.handoverContactId
        ? employeeById.get(payload.handoverContactId)
        : undefined;
      if (payload.handoverContactId && !handover?.databaseId)
        throw new Error("The covering colleague is not linked to PostgreSQL.");
      const { createLeaveRequestFn } = await import("../server-functions/leave.server.ts");
      const requestId = await createLeaveRequestFn({
        data: {
          actor: await this.serverActor(context),
          employeeId: employee.databaseId,
          policyId: payload.policyId,
          startDate: payload.startDate,
          endDate: payload.endDate,
          reason: payload.reason.trim(),
          ...(payload.isHalfDay !== undefined ? { isHalfDay: payload.isHalfDay } : {}),
          ...(handover?.databaseId ? { handoverContactId: handover.databaseId } : {}),
          ...(attachment
            ? {
                attachment: {
                  fileName: attachment.name,
                  mimeType: attachment.type as "application/pdf" | "image/jpeg" | "image/png",
                  bytes: Array.from(new Uint8Array(await attachment.arrayBuffer())),
                },
              }
            : {}),
        },
      });
      await this.hydrateCompatibilityCache(context);
      const created = this.requestRepo.getById(requestId);
      if (!created) throw new Error("Leave was submitted but could not be reloaded.");
      return created;
    }

    const policy = this.policyRepo.getById(payload.policyId);
    if (!policy) throw new Error("Policy not found.");
    if (policy.requiresAttachment && !payload.attachmentFileId) {
      throw new Error(`Supporting evidence is required for ${policy.name}.`);
    }
    if (policy.requiresHandoverContact && !payload.handoverContactId) {
      throw new Error(`A covering colleague is required for ${policy.name}.`);
    }
    // A caller could otherwise reference any file ID at all, including one belonging to a
    // different employee entirely - the file must actually exist and be tagged as evidence
    // owned by the person submitting this request.
    if (payload.attachmentFileId) {
      const meta = await getApplicationDataServices().files.getMetadata(payload.attachmentFileId);
      if (
        !meta ||
        meta.owner.entityType !== "leave-request-evidence" ||
        meta.owner.entityId !== payload.employeeId
      ) {
        throw new Error("The uploaded evidence file could not be verified. Please re-upload it.");
      }
    }

    const workingDays = this.calculateWorkingDays(
      payload.startDate,
      payload.endDate,
      !!payload.isHalfDay,
    );
    if (workingDays <= 0) {
      throw new Error("Requested period contains 0 working days.");
    }

    // Re-check eligibility server-side. The UI dropdown filtering is a convenience;
    // this is the real enforcement.
    const empServiceForEligibility = new EmployeeService();
    const employeeForEligibility = empServiceForEligibility.getById(
      payload.employeeId,
      SYSTEM_CONTEXT,
    );

    if (policy.eligibility && employeeForEligibility) {
      const eligibility = policy.eligibility;
      const basis = policy.legalBasis ? ` (${policy.legalBasis})` : "";

      if (
        eligibility.genderRestriction &&
        employeeForEligibility.gender !== eligibility.genderRestriction
      ) {
        throw new Error(
          `${policy.name} is restricted to ${eligibility.genderRestriction} employees${basis}.`,
        );
      }

      if (eligibility.omaniOnly) {
        const nationality = (employeeForEligibility.nationality ?? "").trim().toLowerCase();
        if (nationality !== "omani") {
          throw new Error(`${policy.name} is an Omani-national entitlement${basis}.`);
        }
      }

      if (eligibility.minimumServiceMonths !== undefined) {
        const eligibleFrom = new Date(`${employeeForEligibility.startDate}T00:00:00Z`);
        eligibleFrom.setUTCMonth(eligibleFrom.getUTCMonth() + eligibility.minimumServiceMonths);
        const eligibleFromDate = eligibleFrom.toISOString().slice(0, 10);
        if (payload.startDate < eligibleFromDate) {
          throw new Error(
            `${policy.name} can be taken from ${eligibleFromDate}, after ${eligibility.minimumServiceMonths} completed months of service${basis}.`,
          );
        }
      }
    }

    // Scope-aware balance/cap validation
    if (policy.consumesBalance) {
      if (policy.scope === "Once Per Service") {
        const serviceLimit = this.getEmployeeEntitlementLimit(
          payload.employeeId,
          policy.id,
          context,
        );
        const activeStatuses: LeaveRequestStatus[] = [
          "Pending Line Manager",
          "Pending HR",
          "Pending Super Admin",
          "Approved",
          "Taken",
          "Amendment Pending Line Manager",
          "Amendment Pending HR",
        ];
        const alreadyUsed = this.requestRepo
          .list()
          .some(
            (r) =>
              r.employeeId === payload.employeeId &&
              r.policyId === payload.policyId &&
              activeStatuses.includes(r.status),
          );
        if (alreadyUsed) {
          const basis = policy.legalBasis ? ` (${policy.legalBasis})` : "";
          throw new Error(
            `${policy.name} can be used only one time in total for this employee${basis}. The entitlement has already been used or requested.`,
          );
        }
        if (workingDays > serviceLimit) {
          const basis = policy.legalBasis ? ` (${policy.legalBasis})` : "";
          throw new Error(
            `${policy.name} is capped at ${serviceLimit} days per occurrence${basis}. You requested ${workingDays} days.`,
          );
        }
      } else if (policy.scope === "Per Event") {
        const eventLimit = this.getEmployeeEntitlementLimit(payload.employeeId, policy.id, context);
        if (workingDays > eventLimit) {
          const basis = policy.legalBasis ? ` (${policy.legalBasis})` : "";
          throw new Error(
            `${policy.name} is capped at ${eventLimit} days per occurrence${basis}. You requested ${workingDays} days.`,
          );
        }
      } else {
        // Annual or Ledger: balance-ledger check, unchanged.
        const balance = this.calculateBalance(payload.employeeId, payload.policyId, context);
        const minimumBalance = policy.allowNegativeBalance ? -(policy.maxNegativeBalance ?? 0) : 0;
        const balanceAfterRequest = balance.projectedAvailable - workingDays;
        if (balanceAfterRequest < minimumBalance) {
          throw new Error(
            policy.allowNegativeBalance
              ? `This request would reduce the balance to ${balanceAfterRequest} days. The lowest permitted balance is ${minimumBalance} days.`
              : `Insufficient balance. You requested ${workingDays} days, but only have ${balance.projectedAvailable} days available.`,
          );
        }
      }
    }

    // Leave Notice Rules
    const chainIncludesManager = policy.approvalChain.some(isManagerRoleName);
    const chainStartsWithManager =
      chainIncludesManager && isManagerRoleName(policy.approvalChain[0] ?? "");
    let status: LeaveRequestStatus = chainStartsWithManager ? "Pending Line Manager" : "Pending HR";
    let refusalReason = "";

    if (policy.noticeRules && policy.noticeRules.enabled) {
      const today = new Date();
      // Reset hours to start of day for fair calendar math
      today.setHours(0, 0, 0, 0);
      const start = parseISO(payload.startDate);
      start.setHours(0, 0, 0, 0);

      const noticeDays = differenceInCalendarDays(start, today);
      const rules = policy.noticeRules;

      if (workingDays > rules.shortLeaveMaxDays) {
        if (noticeDays < rules.longLeaveNoticeDays) {
          status = "Automatically Refused";
          refusalReason = `Notice period violation: Requests for more than ${rules.shortLeaveMaxDays} working days require at least ${rules.longLeaveNoticeDays} calendar days notice. You requested ${workingDays} days with only ${noticeDays} days notice.`;
        }
      } else {
        if (noticeDays < rules.shortLeaveNoticeDays) {
          status = "Automatically Refused";
          refusalReason = `Notice period violation: Requests for ${rules.shortLeaveMaxDays} working days or fewer require at least ${rules.shortLeaveNoticeDays} calendar days notice. You requested ${workingDays} days with only ${noticeDays} days notice.`;
        }
      }
    }

    // Built from the policy's own configured chain rather than a hardcoded two-step sequence,
    // so a manager-only policy (e.g. Compensation Off) stays a single approval and an HR-only
    // policy (e.g. Resignation) never waits on a line-manager step that was never meant to exist.
    const chainApprovals: LeaveRequest["chainApprovals"] = policy.approvalChain.map((role) => ({
      role,
      status: "Pending" as const,
    }));

    const empService = new EmployeeService();
    const requester = empService.getById(payload.employeeId, SYSTEM_CONTEXT);

    if (chainIncludesManager && status !== "Automatically Refused" && !requester?.lineManagerId) {
      throw new Error(
        "Your supervisor has not been assigned. Ask HR to update your reporting line before requesting leave.",
      );
    }
    if (
      chainIncludesManager &&
      status !== "Automatically Refused" &&
      requester?.lineManagerId === payload.employeeId
    ) {
      throw new Error("Your reporting line is invalid. Ask HR to assign a different supervisor.");
    }

    const policySnapshot = {
      name: policy.name,
      type: policy.type,
      isPaid: policy.isPaid,
      baseEntitlementDays: policy.baseEntitlementDays,
      accrualMode: policy.accrualMode,
    };

    // Persist the sick-leave pay-percentage tier breakdown at submission time so payroll
    // has a stable record of which days fall into which declining-pay tier, rather than
    // having to recompute it later from mutable "already taken this year" state.
    const sickPayTiers: SickPayTierBreakdown[] | undefined =
      policy.payTiers && policy.payTiers.length > 0
        ? this.getSickLeavePayBreakdown(payload.employeeId, workingDays, context)
        : undefined;

    const request: NewRecord<LeaveRequest> = {
      employeeId: payload.employeeId,
      policyId: payload.policyId,
      startDate: payload.startDate,
      endDate: payload.endDate,
      isHalfDay: !!payload.isHalfDay,
      workingDaysRequested: workingDays,
      reason: payload.reason,
      ...(payload.handoverContactId ? { handoverContactId: payload.handoverContactId } : {}),
      ...(payload.attachmentFileId ? { attachmentFileId: payload.attachmentFileId } : {}),
      status,
      chainApprovals,
      policySnapshot,
      ...(refusalReason ? { refusalReason } : {}),
      ...(payload.attachmentUrl ? { attachmentUrl: payload.attachmentUrl } : {}),
      ...(sickPayTiers ? { sickPayTiers } : {}),
    };
    const created = this.requestRepo.create(request, context);
    this.notifySubmission(created, context);
    return created;
  }

  // Whoever the request lands with first - the line manager for a manager-led chain, or HR
  // directly for an HR-only policy - is notified the moment it's submitted, not left to notice
  // it only when they happen to open the approvals screen.
  private notifySubmission(request: LeaveRequest, context: ActorContext): void {
    if (request.status === "Automatically Refused") return;
    const { storage, notifications } = getApplicationDataServices();
    const requester = new EmployeeService().getById(request.employeeId, SYSTEM_CONTEXT);
    const requesterName = requester
      ? `${requester.preferredName} ${requester.legalName}`
      : "An employee";

    const managerStage =
      request.status === "Pending Line Manager" ||
      request.status === "Amendment Pending Line Manager";
    const hrStage = request.status === "Pending HR" || request.status === "Amendment Pending HR";
    const amendment = request.pendingAmendment;
    const dateSummary = amendment
      ? `${amendment.proposedStartDate} to ${amendment.proposedEndDate}`
      : `${request.startDate} to ${request.endDate}`;
    const actionLabel = amendment ? "requested a change to" : "requested";

    if (managerStage && requester?.lineManagerId) {
      const managerUser = storage
        .readCollection<User>("users")
        .find((user) => user.employeeId === requester.lineManagerId && user.status === "Active");
      if (managerUser) {
        notifications.create(
          {
            recipientUserId: managerUser.id,
            type: "Approval",
            title: amendment
              ? "Leave date change awaiting your approval"
              : "Leave request awaiting your approval",
            message: `${requesterName} ${actionLabel} ${amendment?.proposedWorkingDays ?? request.workingDaysRequested} day(s) of ${request.policySnapshot.name}: ${dateSummary}.`,
            priority: "High",
            status: "Unread",
            deduplicationKey: amendment
              ? `leave-amendment-manager-${request.id}-${amendment.requestedAt}`
              : `leave-submitted-manager-${request.id}`,
            link: {
              entityType: "leave-request",
              entityId: request.id,
              path: "/staff/leave-approvals",
            },
          },
          context,
        );
      }
    } else if (hrStage) {
      const hrUsers = storage
        .readCollection<User>("users")
        .filter((user) => user.status === "Active" && user.roles.includes("HR"));
      for (const hrUser of hrUsers) {
        notifications.create(
          {
            recipientUserId: hrUser.id,
            type: "Approval",
            title: amendment
              ? "Leave date change awaiting HR approval"
              : "Leave request awaiting HR approval",
            message: `${requesterName} ${actionLabel} ${amendment?.proposedWorkingDays ?? request.workingDaysRequested} day(s) of ${request.policySnapshot.name}: ${dateSummary}.`,
            priority: "High",
            status: "Unread",
            deduplicationKey: amendment
              ? `leave-amendment-hr-${request.id}-${amendment.requestedAt}-${hrUser.id}`
              : `leave-submitted-hr-${request.id}-${hrUser.id}`,
            link: {
              entityType: "leave-request",
              entityId: request.id,
              path: "/staff/leave-approvals",
            },
          },
          context,
        );
      }
    }
  }

  withdrawRequest(requestId: string, context: ActorContext): LeaveRequest {
    const req = this.requestRepo.getById(requestId);
    if (!req) throw new Error("Request not found");
    if (!context.actor.employeeId || context.actor.employeeId !== req.employeeId) {
      this.denyAccess(
        "Leave withdrawal denied",
        req.id,
        "You can only withdraw your own leave request.",
        context,
      );
    }
    if (!req.status.startsWith("Pending")) {
      throw new Error("Only pending requests can be withdrawn.");
    }

    req.status = "Cancelled";
    req.cancellationReason = "Withdrawn by employee before approval";
    return this.requestRepo.update(req.id, req, context);
  }

  async requestChangeAsync(
    requestId: string,
    action:
      | { kind: "withdraw" }
      | { kind: "cancel"; reason: string }
      | { kind: "amend"; startDate: string; endDate: string; reason: string },
    context: ActorContext,
  ): Promise<LeaveRequest> {
    if (typeof window === "undefined") {
      if (action.kind === "withdraw") return this.withdrawRequest(requestId, context);
      if (action.kind === "cancel")
        return this.requestCancellation(requestId, action.reason, context);
      return this.requestAmendment(
        requestId,
        action.startDate,
        action.endDate,
        action.reason,
        context,
      );
    }
    const { requestLeaveChangeFn } = await import("../server-functions/leave.server.ts");
    await requestLeaveChangeFn({
      data: { actor: await this.serverActor(context), requestId, ...action },
    });
    await this.hydrateCompatibilityCache(context);
    const updated = this.requestRepo.getById(requestId);
    if (!updated) throw new Error("Leave was changed but could not be reloaded.");
    return updated;
  }

  requestCancellation(requestId: string, reason: string, context: ActorContext): LeaveRequest {
    const req = this.requestRepo.getById(requestId);
    if (!req) throw new Error("Request not found");
    if (!context.actor.employeeId || context.actor.employeeId !== req.employeeId) {
      this.denyAccess(
        "Leave cancellation denied",
        req.id,
        "You can only cancel your own approved leave.",
        context,
      );
    }
    if (req.status !== "Approved") {
      throw new Error("Only approved requests can be cancelled.");
    }

    // Check if it's already in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = parseISO(req.endDate);
    if (end < today) {
      throw new Error("Cannot cancel past leave. Contact HR for historical corrections.");
    }

    req.status = "Cancellation Pending";
    req.cancellationReason = reason;
    return this.requestRepo.update(req.id, req, context);
  }

  requestAmendment(
    requestId: string,
    proposedStartDate: string,
    proposedEndDate: string,
    reason: string,
    context: ActorContext,
  ): LeaveRequest {
    const req = this.requestRepo.getById(requestId);
    if (!req) throw new Error("Request not found");
    if (!context.actor.employeeId || context.actor.employeeId !== req.employeeId) {
      this.denyAccess(
        "Leave amendment denied",
        req.id,
        "You can only change your own approved leave.",
        context,
      );
    }
    if (req.status !== "Approved") throw new Error("Only approved future leave can be changed.");
    if (reason.trim().length < 3) throw new Error("Explain why the leave dates need to change.");
    const start = parseISO(proposedStartDate);
    const end = parseISO(proposedEndDate);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(proposedStartDate) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(proposedEndDate) ||
      !isValid(start) ||
      !isValid(end) ||
      end < start
    ) {
      throw new Error("Enter a valid new leave date range.");
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (parseISO(req.startDate) <= today || start <= today) {
      throw new Error(
        "Leave that has started or is in the past cannot be changed here. Contact HR.",
      );
    }
    if (req.startDate === proposedStartDate && req.endDate === proposedEndDate) {
      throw new Error("Choose dates that are different from the current approved leave.");
    }
    const policy = this.policyRepo.getById(req.policyId);
    if (!policy || !policy.isEnabled) throw new Error("This leave policy is no longer available.");
    const workingDays = this.calculateWorkingDays(
      proposedStartDate,
      proposedEndDate,
      req.isHalfDay,
    );
    if (workingDays <= 0) throw new Error("The proposed period contains no working days.");

    if (policy.noticeRules?.enabled) {
      const noticeDays = differenceInCalendarDays(start, today);
      const rules = policy.noticeRules;
      const requiredNotice =
        workingDays > rules.shortLeaveMaxDays
          ? rules.longLeaveNoticeDays
          : rules.shortLeaveNoticeDays;
      if (noticeDays < requiredNotice) {
        throw new Error(
          `${workingDays > rules.shortLeaveMaxDays ? "Long" : "Short"} leave changes require at least ${requiredNotice} calendar days' notice.`,
        );
      }
    }
    if (policy.scope === "Per Event") {
      const limit = this.getEmployeeEntitlementLimit(req.employeeId, policy.id, context);
      if (workingDays > limit) throw new Error(`${policy.name} is limited to ${limit} days.`);
    } else if (policy.scope === "Once Per Service") {
      const limit = this.getEmployeeEntitlementLimit(req.employeeId, policy.id, context);
      if (workingDays > limit) throw new Error(`${policy.name} is limited to ${limit} days.`);
    } else if (policy.consumesBalance) {
      const balance = this.calculateBalance(req.employeeId, req.policyId, context);
      const minimum = policy.allowNegativeBalance ? -(policy.maxNegativeBalance ?? 0) : 0;
      const availableAfterChange = balance.available + req.workingDaysRequested - workingDays;
      if (availableAfterChange < minimum) {
        throw new Error("The proposed dates exceed the available leave balance.");
      }
    }

    const overlapping = this.requestRepo
      .list()
      .some(
        (other) =>
          other.id !== req.id &&
          other.employeeId === req.employeeId &&
          [
            "Pending Line Manager",
            "Pending HR",
            "Pending Super Admin",
            "Approved",
            "Taken",
            "Amendment Pending Line Manager",
            "Amendment Pending HR",
          ].includes(other.status) &&
          proposedStartDate <= other.endDate &&
          proposedEndDate >= other.startDate,
      );
    if (overlapping) throw new Error("The proposed dates overlap another active leave request.");

    const chainApprovals = policy.approvalChain.map((role) => ({
      role,
      status: "Pending" as const,
    }));
    const startsWithManager = isManagerRoleName(policy.approvalChain[0] ?? "");
    const employee = new EmployeeService().getById(req.employeeId, SYSTEM_CONTEXT);
    if (startsWithManager && !employee?.lineManagerId) {
      throw new Error(
        "Your supervisor has not been assigned. Ask HR to update your reporting line.",
      );
    }
    req.status = startsWithManager ? "Amendment Pending Line Manager" : "Amendment Pending HR";
    req.pendingAmendment = {
      proposedStartDate,
      proposedEndDate,
      proposedWorkingDays: workingDays,
      reason: reason.trim(),
      requestedAt: new Date().toISOString(),
      requestedBy: context.actor.userId,
      chainApprovals,
    };
    const updated = this.requestRepo.update(req.id, req, context);
    this.notifySubmission(updated, context);
    return updated;
  }

  private approveAmendment(req: LeaveRequest, context: ActorContext): LeaveRequest {
    const amendment = req.pendingAmendment;
    if (!amendment) throw new Error("The proposed leave change could not be found.");
    if (req.status === "Amendment Pending Line Manager") {
      const employee = new EmployeeService().getById(req.employeeId, SYSTEM_CONTEXT);
      const isManager =
        Boolean(context.actor.employeeId) && employee?.lineManagerId === context.actor.employeeId;
      const isRecovery = ["HR", "Super Admin"].includes(context.actor.activeRole ?? "");
      if (!isManager && !isRecovery) {
        this.denyAccess(
          "Leave amendment approval denied",
          req.id,
          "Only the assigned supervisor can approve this leave date change.",
          context,
        );
      }
      if (isRecovery && !isManager && (context.reason?.trim().length ?? 0) < 5) {
        throw new Error("Enter a reason for completing the unavailable supervisor's review.");
      }
      const step = amendment.chainApprovals.find(
        (item) => isManagerRoleName(item.role) && item.status === "Pending",
      );
      if (step) {
        step.status = "Approved";
        step.approvedBy = context.actor.userId;
        step.date = new Date().toISOString();
      }
      const hasHrStep = amendment.chainApprovals.some(
        (item) => ["HR", "Super Admin"].includes(item.role) && item.status === "Pending",
      );
      if (hasHrStep) {
        req.status = "Amendment Pending HR";
        const updated = this.requestRepo.update(req.id, req, context);
        this.notifySubmission(updated, context);
        return updated;
      }
      return this.finalizeAmendment(req, context);
    }
    if (!["HR", "Super Admin"].includes(context.actor.activeRole ?? "")) {
      this.denyAccess(
        "Leave amendment approval denied",
        req.id,
        "Only HR can complete this leave date change.",
        context,
      );
    }
    if (context.actor.employeeId === req.employeeId) {
      this.denyAccess(
        "Leave amendment approval denied",
        req.id,
        "You cannot approve your own leave date change.",
        context,
      );
    }
    const step = amendment.chainApprovals.find(
      (item) => ["HR", "Super Admin"].includes(item.role) && item.status === "Pending",
    );
    if (step) {
      step.status = "Approved";
      step.approvedBy = context.actor.userId;
      step.date = new Date().toISOString();
    }
    return this.finalizeAmendment(req, context);
  }

  private finalizeAmendment(req: LeaveRequest, context: ActorContext): LeaveRequest {
    const amendment = req.pendingAmendment;
    if (!amendment) throw new Error("The proposed leave change could not be found.");
    // Approval can happen days after the employee proposed the change. Recheck the facts that may
    // have changed in the meantime so HR cannot approve stale dates, a new overlap, or an
    // overdrawn balance.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (parseISO(amendment.proposedStartDate) <= today) {
      throw new Error(
        "These proposed dates have already started or passed. The employee must submit a new request.",
      );
    }
    const policy = this.policyRepo.getById(req.policyId);
    if (!policy || !policy.isEnabled) {
      throw new Error("This leave policy is no longer available.");
    }
    const currentWorkingDays = this.calculateWorkingDays(
      amendment.proposedStartDate,
      amendment.proposedEndDate,
      req.isHalfDay,
    );
    if (currentWorkingDays !== amendment.proposedWorkingDays) {
      throw new Error(
        "The working-day calendar changed while this request was awaiting approval. The employee must submit the new dates again.",
      );
    }
    const nowOverlaps = this.requestRepo
      .list()
      .some(
        (other) =>
          other.id !== req.id &&
          other.employeeId === req.employeeId &&
          [
            "Pending Line Manager",
            "Pending HR",
            "Pending Super Admin",
            "Approved",
            "Taken",
            "Amendment Pending Line Manager",
            "Amendment Pending HR",
          ].includes(other.status) &&
          amendment.proposedStartDate <= other.endDate &&
          amendment.proposedEndDate >= other.startDate,
      );
    if (nowOverlaps) {
      throw new Error(
        "These proposed dates now overlap another leave request. Review the dates with the employee.",
      );
    }
    if (policy.scope === "Per Event" || policy.scope === "Once Per Service") {
      const limit = this.getEmployeeEntitlementLimit(req.employeeId, policy.id, context);
      if (amendment.proposedWorkingDays > limit) {
        throw new Error(`${policy.name} is limited to ${limit} days.`);
      }
    } else if (policy.consumesBalance) {
      const balance = this.calculateBalance(req.employeeId, req.policyId, context);
      const minimum = policy.allowNegativeBalance ? -(policy.maxNegativeBalance ?? 0) : 0;
      const availableAfterChange =
        balance.available + req.workingDaysRequested - amendment.proposedWorkingDays;
      if (availableAfterChange < minimum) {
        throw new Error(
          "The employee no longer has enough leave for these dates. Review the balance before approving.",
        );
      }
    }
    const { storage, audit } = getApplicationDataServices();
    const snapshot = storage.createRawSnapshot();
    try {
      const dayDifference = amendment.proposedWorkingDays - req.workingDaysRequested;
      if (dayDifference !== 0) {
        this.recordTransaction(
          {
            employeeId: req.employeeId,
            policyId: req.policyId,
            transactionType: "Leave Amendment",
            days: -dayDifference,
            reason: `Approved date change: ${req.startDate} to ${req.endDate} changed to ${amendment.proposedStartDate} to ${amendment.proposedEndDate}.`,
            referenceId: `amendment:${req.id}:${amendment.requestedAt}`,
          },
          context,
        );
      }
      const history = [
        ...(req.amendmentHistory ?? []),
        {
          previousStartDate: req.startDate,
          previousEndDate: req.endDate,
          previousWorkingDays: req.workingDaysRequested,
          newStartDate: amendment.proposedStartDate,
          newEndDate: amendment.proposedEndDate,
          newWorkingDays: amendment.proposedWorkingDays,
          reason: amendment.reason,
          decidedAt: new Date().toISOString(),
          decidedBy: context.actor.userId,
          outcome: "Approved" as const,
        },
      ];
      const updated = this.requestRepo.update(
        req.id,
        {
          startDate: amendment.proposedStartDate,
          endDate: amendment.proposedEndDate,
          workingDaysRequested: amendment.proposedWorkingDays,
          status: "Approved",
          amendmentHistory: history,
          pendingAmendment: undefined,
        } as never,
        context,
      );
      this.notifyAmendmentOutcome(updated, amendment.reason, true, context);
      return updated;
    } catch (error) {
      storage.restoreRawSnapshot(snapshot);
      try {
        audit.record({
          context,
          action: "leave_amendment_rolled_back",
          module: "leave",
          entityType: "leave-request",
          entityId: req.id,
          reason: `The leave date change was not completed and all records were restored: ${error instanceof Error ? error.message : "unknown error"}.`,
          riskLevel: "High",
        });
      } catch {
        // Preserve the original workflow error.
      }
      throw error;
    }
  }

  private rejectAmendment(req: LeaveRequest, reason: string, context: ActorContext): LeaveRequest {
    const amendment = req.pendingAmendment;
    if (!amendment) throw new Error("The proposed leave change could not be found.");
    if (reason.trim().length < 3)
      throw new Error("A reason is required to decline the date change.");
    if (req.status === "Amendment Pending Line Manager") {
      const employee = new EmployeeService().getById(req.employeeId, SYSTEM_CONTEXT);
      const isManager =
        Boolean(context.actor.employeeId) && employee?.lineManagerId === context.actor.employeeId;
      const isRecovery = ["HR", "Super Admin"].includes(context.actor.activeRole ?? "");
      if (!isManager && !isRecovery) {
        this.denyAccess(
          "Leave amendment rejection denied",
          req.id,
          "Only the assigned supervisor can decline this leave date change.",
          context,
        );
      }
    } else if (!["HR", "Super Admin"].includes(context.actor.activeRole ?? "")) {
      this.denyAccess(
        "Leave amendment rejection denied",
        req.id,
        "Only HR can decline this leave date change.",
        context,
      );
    }
    if (context.actor.employeeId === req.employeeId) {
      this.denyAccess(
        "Leave amendment rejection denied",
        req.id,
        "You cannot decide your own leave date change.",
        context,
      );
    }
    const history = [
      ...(req.amendmentHistory ?? []),
      {
        previousStartDate: req.startDate,
        previousEndDate: req.endDate,
        previousWorkingDays: req.workingDaysRequested,
        newStartDate: amendment.proposedStartDate,
        newEndDate: amendment.proposedEndDate,
        newWorkingDays: amendment.proposedWorkingDays,
        reason: amendment.reason,
        decidedAt: new Date().toISOString(),
        decidedBy: context.actor.userId,
        outcome: "Declined" as const,
        decisionReason: reason.trim(),
      },
    ];
    const updated = this.requestRepo.update(
      req.id,
      { status: "Approved", amendmentHistory: history, pendingAmendment: undefined } as never,
      context,
    );
    this.notifyAmendmentOutcome(updated, reason.trim(), false, context);
    return updated;
  }

  private notifyAmendmentOutcome(
    request: LeaveRequest,
    reason: string,
    approved: boolean,
    context: ActorContext,
  ): void {
    const { storage, notifications } = getApplicationDataServices();
    const user = storage
      .readCollection<User>("users")
      .find(
        (candidate) => candidate.employeeId === request.employeeId && candidate.status === "Active",
      );
    if (!user) return;
    notifications.create(
      {
        recipientUserId: user.id,
        type: approved ? "Success" : "Warning",
        title: approved ? "Leave dates changed" : "Leave date change declined",
        message: approved
          ? `Your approved leave now runs from ${request.startDate} to ${request.endDate}.`
          : `Your original approved leave remains unchanged. ${reason}`,
        priority: "High",
        status: "Unread",
        deduplicationKey: `leave-amendment-outcome-${request.id}-${request.recordVersion}`,
        link: {
          entityType: "leave-request",
          entityId: request.id,
          path: "/staff/me/leave-balances",
        },
      },
      context,
    );
  }

  reconcileLeaveStates(context: ActorContext): void {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      this.denyAccess(
        "Leave state reconciliation denied",
        "leave-reconcile",
        "Only HR or Super Admin can reconcile leave states.",
        context,
      );
    }
    const allRequests = this.requestRepo.list();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const req of allRequests) {
      if (req.status === "Approved") {
        const end = parseISO(req.endDate);
        if (end < today) {
          req.status = "Taken";
          this.requestRepo.update(req.id, req, context);
        }
      }
    }
  }

  // Grants Compensation Leave (Overtime Off-in-Lieu) days when HR/Super Admin verifies an
  // overtime claim submitted for time-off-in-lieu rather than payment - the C/OFF policy's own
  // description promises this ("Days are credited by HR when overtime worked... is approved"),
  // but nothing ever actually called it until the Overtime module was wired up to do so.
  creditCompensationLeave(
    employeeId: string,
    days: number,
    reason: string,
    context: ActorContext,
    referenceId?: string,
  ): LeaveTransaction {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      this.denyAccess(
        "Compensation leave credit denied",
        employeeId,
        "Only HR or Super Admin can credit compensation leave.",
        context,
      );
    }
    if (!Number.isFinite(days) || days <= 0) {
      throw new Error("Compensation leave days must be a positive number.");
    }
    const policy = this.getPolicies().find((p) => p.code === "C/OFF");
    if (!policy) {
      throw new Error("The Compensation Leave (Overtime Off-in-Lieu) policy is not configured.");
    }
    return this.recordTransaction(
      {
        employeeId,
        policyId: policy.id,
        transactionType: "Manual Adjustment",
        days,
        reason,
        ...(referenceId ? { referenceId } : {}),
      },
      context,
    );
  }

  reverseCompensationLeaveCredit(
    employeeId: string,
    overtimeClaimId: string,
    reason: string,
    context: ActorContext,
  ): LeaveTransaction {
    if (!["HR", "Super Admin"].includes(context.actor.activeRole ?? "")) {
      this.denyAccess(
        "Compensation leave reversal denied",
        overtimeClaimId,
        "Only HR or Super Admin can reverse compensation leave.",
        context,
      );
    }
    const original = this.transactionRepo
      .list()
      .find(
        (transaction) =>
          transaction.employeeId === employeeId &&
          transaction.referenceId === overtimeClaimId &&
          transaction.days > 0,
      );
    if (!original) throw new Error("The original time-off credit could not be found.");
    const reversalReference = `reversal:${overtimeClaimId}`;
    const existing = this.transactionRepo
      .list()
      .find((transaction) => transaction.referenceId === reversalReference);
    if (existing) return existing;
    return this.recordTransaction(
      {
        employeeId,
        policyId: original.policyId,
        transactionType: "Manual Adjustment",
        days: -original.days,
        reason: reason.trim(),
        referenceId: reversalReference,
      },
      context,
    );
  }

  // Not exposed outside this class - every legitimate way to move a leave balance goes through
  // a method here that carries its own authorization check first (approveRequest,
  // setEmployeeAvailableBalance, creditCompensationLeave, runAnnualRollover, etc.). Keeping this
  // private closes off a path that let any caller mutate balances with no check at all.
  private recordTransaction(
    payload: Partial<LeaveTransaction>,
    context: ActorContext,
  ): LeaveTransaction {
    if (
      !payload.employeeId ||
      !payload.policyId ||
      !payload.transactionType ||
      payload.days === undefined
    ) {
      throw new Error("Missing required fields for leave transaction.");
    }

    if (
      payload.transactionType === "Manual Adjustment" &&
      (!payload.reason || payload.reason.trim().length < 5)
    ) {
      throw new Error("A detailed reason is required for manual adjustments.");
    }

    const transaction: NewRecord<LeaveTransaction> = {
      employeeId: payload.employeeId,
      policyId: payload.policyId,
      transactionType: payload.transactionType,
      days: payload.days,
      reason: payload.reason?.trim() || "Leave balance transaction",
      date: payload.date || new Date().toISOString(),
      actorUserId: context.actor.userId,
      ...(payload.referenceId ? { referenceId: payload.referenceId } : {}),
    };
    return this.transactionRepo.create(transaction, context);
  }

  setEmployeeAvailableBalance(
    employeeId: string,
    policyId: string,
    newAvailableBalance: number,
    reason: string,
    context: ActorContext,
  ): LeaveTransaction | EmployeeLeaveEntitlementOverride {
    const activeRole = context.actor.activeRole ?? context.actor.roles[0];
    if (activeRole !== "HR" && activeRole !== "Super Admin") {
      getApplicationDataServices().audit.record({
        context,
        action: "leave_balance_adjustment_access_denied",
        module: "leave",
        entityType: "leave_balance",
        entityId: `${employeeId}:${policyId}`,
        reason: "Only HR or Super Admin may correct employee leave balances.",
        riskLevel: "High",
      });
      throw new Error("Your active role is not authorised to adjust leave balances.");
    }

    if (!Number.isFinite(newAvailableBalance)) {
      throw new Error("Enter a valid available balance.");
    }
    if (reason.trim().length < 5) {
      throw new Error("A detailed reason is required for the audit history.");
    }

    const employee = new EmployeeService().getById(employeeId, SYSTEM_CONTEXT);
    if (!employee) throw new Error("The employee record was not found.");
    const policy = this.policyRepo.getById(policyId);
    if (!policy || !policy.isEnabled) throw new Error("The leave policy is not available.");
    if (!this.isEmployeeEligibleForPolicy(employee, policy)) {
      throw new Error(`${employee.preferredName} is not eligible for ${policy.name}.`);
    }
    if (policy.scope === "Per Event" || policy.scope === "Once Per Service") {
      return this.setEmployeeEntitlementLimit(
        employeeId,
        policyId,
        newAvailableBalance,
        reason,
        context,
      );
    }
    if (policy.scope !== "Annual" && policy.scope !== "Ledger") {
      throw new Error(`${policy.name} does not have an editable allowance.`);
    }

    const minimumBalance = policy.allowNegativeBalance ? -(policy.maxNegativeBalance ?? 0) : 0;
    if (newAvailableBalance < minimumBalance) {
      throw new Error(
        policy.allowNegativeBalance
          ? `The lowest permitted balance for ${policy.name} is ${minimumBalance} days.`
          : `${policy.name} cannot have a negative balance.`,
      );
    }

    const current = this.calculateBalance(employeeId, policyId, context);
    const adjustment = Number((newAvailableBalance - current.available).toFixed(2));
    if (adjustment === 0) {
      throw new Error("The new balance is the same as the current balance.");
    }

    return this.recordTransaction(
      {
        employeeId,
        policyId,
        transactionType: "Manual Adjustment",
        days: adjustment,
        reason: reason.trim(),
      },
      {
        ...context,
        reason: `Corrected ${employee.preferredName}'s ${policy.name} balance from ${current.available} to ${newAvailableBalance} days: ${reason.trim()}`,
      },
    );
  }

  async setEmployeeAvailableBalanceAsync(
    employeeId: string,
    policyId: string,
    newBalance: number,
    reason: string,
    context: ActorContext,
  ): Promise<void> {
    if (typeof window === "undefined") {
      this.setEmployeeAvailableBalance(employeeId, policyId, newBalance, reason, context);
      return;
    }
    const employee = getApplicationDataServices()
      .storage.readCollection<Employee & { databaseId?: string }>("employees")
      .find((item) => item.id === employeeId);
    if (!employee?.databaseId) throw new Error("The employee is not linked to PostgreSQL.");
    const { adjustEmployeeLeaveBalanceFn } = await import("../server-functions/leave.server.ts");
    await adjustEmployeeLeaveBalanceFn({
      data: {
        actor: await this.serverActor(context),
        employeeId: employee.databaseId,
        policyId,
        newValue: newBalance,
        reason: reason.trim(),
      },
    });
    await this.hydrateCompatibilityCache(context);
  }

  getEmployeeEntitlementLimit(employeeId: string, policyId: string, context: ActorContext): number {
    this.requireEmployeeRead(employeeId, context, "view this employee's leave allowance");
    const policy = this.policyRepo.getById(policyId);
    if (!policy) throw new Error("The leave policy was not found.");
    const latest = this.entitlementOverrideRepo
      .list()
      .filter((item) => item.employeeId === employeeId && item.policyId === policyId)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
    return latest?.days ?? policy.baseEntitlementDays;
  }

  setEmployeeEntitlementLimit(
    employeeId: string,
    policyId: string,
    days: number,
    reason: string,
    context: ActorContext,
  ): EmployeeLeaveEntitlementOverride {
    const role = context.actor.activeRole ?? context.actor.roles[0];
    if (!role || !["HR", "Super Admin"].includes(role)) {
      this.denyAccess(
        "Leave allowance exception denied",
        `${employeeId}:${policyId}`,
        "Only HR or Super Admin can set an employee-specific allowance.",
        context,
      );
    }
    if (!Number.isFinite(days) || days < 0) throw new Error("Enter a valid allowance.");
    if (reason.trim().length < 5) throw new Error("Explain why this allowance is different.");
    const employee = new EmployeeService().getById(employeeId, SYSTEM_CONTEXT);
    const policy = this.policyRepo.getById(policyId);
    if (!employee || !policy) throw new Error("The employee or leave policy was not found.");
    if (policy.scope !== "Per Event" && policy.scope !== "Once Per Service") {
      throw new Error("This leave type uses a running balance instead of an individual limit.");
    }
    const existing = this.entitlementOverrideRepo
      .list()
      .find((item) => item.employeeId === employeeId && item.policyId === policyId);
    const values = {
      employeeId,
      policyId,
      days,
      reason: reason.trim(),
      effectiveFrom: new Date().toISOString(),
    };
    return existing
      ? this.entitlementOverrideRepo.update(existing.id, values, { ...context, reason })
      : this.entitlementOverrideRepo.create(values, { ...context, reason });
  }

  calculateBalance(
    employeeId: string,
    policyId: string,
    context: ActorContext,
  ): LeaveBalanceReport {
    this.requireEmployeeRead(employeeId, context, "view this employee's leave balance");
    const settings = new SettingsService().getAppSettingsSync();
    const today = new Date();
    const currentYear = today.getFullYear();
    const todayKey = [
      currentYear,
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0"),
    ].join("-");
    const candidateStartKey = `${currentYear}-${settings.leaveYearStart}`;
    const leaveYear = todayKey >= candidateStartKey ? currentYear : currentYear - 1;
    const leaveYearStartKey = `${leaveYear}-${settings.leaveYearStart}`;
    const nextLeaveYearStartKey = `${leaveYear + 1}-${settings.leaveYearStart}`;
    const txs = this.getTransactionsForEmployee(employeeId, policyId, context).filter((item) => {
      const date = item.date.slice(0, 10);
      return date >= leaveYearStartKey && date < nextLeaveYearStartKey;
    });

    let entitlement = 0;
    let carriedForward = 0;
    let accrued = 0;
    let adjustments = 0;
    let taken = 0;
    let approvedFuture = 0;
    let pending = 0;

    // Get all requests for this policy
    const requests = this.getLeaveRequestsForEmployee(employeeId, context).filter(
      (request) =>
        request.policyId === policyId &&
        request.startDate >= leaveYearStartKey &&
        request.startDate < nextLeaveYearStartKey,
    );
    for (const req of requests) {
      if (
        req.status === "Pending Line Manager" ||
        req.status === "Pending HR" ||
        req.status === "Pending Super Admin"
      ) {
        pending += req.workingDaysRequested;
      } else if (
        (req.status === "Amendment Pending Line Manager" ||
          req.status === "Amendment Pending HR") &&
        req.pendingAmendment
      ) {
        pending += Math.max(0, req.pendingAmendment.proposedWorkingDays - req.workingDaysRequested);
      }
    }

    today.setHours(0, 0, 0, 0);

    for (const tx of txs) {
      if (tx.transactionType === "Entitlement") entitlement += tx.days;
      else if (tx.transactionType === "Carry-Forward") carriedForward += tx.days;
      else if (tx.transactionType === "Accrual") accrued += tx.days;
      else if (tx.transactionType === "Manual Adjustment") adjustments += tx.days;
      else if (tx.transactionType === "Leave Amendment") adjustments += tx.days;
      else if (tx.transactionType === "Cancellation Restoration")
        adjustments += tx.days; // Acts as a positive adjustment
      else if (tx.transactionType === "Approved Leave") {
        if (tx.referenceId) {
          const req = requests.find((r) => r.id === tx.referenceId);
          if (req && req.status === "Taken") {
            taken += Math.abs(tx.days);
          } else {
            approvedFuture += Math.abs(tx.days);
          }
        } else {
          taken += Math.abs(tx.days);
        }
      } else if (tx.transactionType === "Expiry") {
        adjustments += tx.days;
      }
    }

    // Available = (Entitlement + Carried + Accrued + Adjustments) - Taken - ApprovedFuture
    const available = entitlement + carriedForward + accrued + adjustments - taken - approvedFuture;

    return {
      employeeId,
      policyId,
      entitlement,
      carriedForward,
      accrued,
      adjustments,
      taken,
      approvedFuture,
      pending,
      available,
      projectedAvailable: available - pending,
    };
  }

  getAllBalancesForEmployee(employeeId: string, context: ActorContext): LeaveBalanceReport[] {
    return this.getEligiblePolicies(employeeId, context).map((policy) =>
      this.calculateBalance(employeeId, policy.id, context),
    );
  }

  /**
   * Grants next-year entitlement and carries forward unused balance for every employee
   * eligible for every Annual-scoped policy. Nothing else in the system ever creates a
   * Carry-Forward or a fresh Entitlement transaction after the initial seed, so this is
   * the method that must be invoked (manually by HR, or by a future scheduled job) once
   * per calendar year to actually roll balances forward.
   *
   * Idempotent per employee+policy+targetYear: if an Entitlement transaction already
   * exists dated within targetYear, that employee/policy pair is skipped entirely so
   * calling this repeatedly (or for employees added mid-cycle) never double-grants.
   */
  runAnnualRollover(
    targetYear: number,
    context: ActorContext,
  ): Array<{
    employeeId: string;
    policyId: string;
    carriedForward: number;
    entitlementGranted: number;
  }> {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      this.denyAccess(
        "Annual leave rollover denied",
        "leave-rollover",
        "Only HR or Super Admin can run the annual leave rollover.",
        context,
      );
    }
    const empService = new EmployeeService();
    const employees = empService.getEmployees(SYSTEM_CONTEXT);
    const annualPolicies = this.getPolicies().filter((p) => p.scope === "Annual" && p.isEnabled);
    const allTransactions = this.transactionRepo.list();
    const rolloverDate = new Date(Date.UTC(targetYear, 0, 1)).toISOString();

    const results: Array<{
      employeeId: string;
      policyId: string;
      carriedForward: number;
      entitlementGranted: number;
    }> = [];

    for (const emp of employees) {
      for (const policy of annualPolicies) {
        if (!this.isEmployeeEligibleForPolicy(emp, policy)) continue;

        // Idempotency guard: never grant a second Entitlement transaction for the same
        // employee/policy/year, no matter how many times this method is invoked.
        const alreadyRolled = allTransactions.some(
          (t) =>
            t.employeeId === emp.id &&
            t.policyId === policy.id &&
            t.transactionType === "Entitlement" &&
            new Date(t.date).getFullYear() === targetYear,
        );
        if (alreadyRolled) continue;

        const balanceBeforeRollover = this.calculateBalance(emp.id, policy.id, context);
        const unused = Math.max(0, balanceBeforeRollover.available);
        const carryForwardLimit = policy.carryForwardLimit ?? 0;
        const carriedForward = Math.min(unused, carryForwardLimit);

        if (carriedForward > 0) {
          this.recordTransaction(
            {
              employeeId: emp.id,
              policyId: policy.id,
              date: rolloverDate,
              transactionType: "Carry-Forward",
              days: carriedForward,
              reason: `Annual rollover ${targetYear}: carried forward ${carriedForward} unused day(s) from the prior year (policy carry-forward limit: ${carryForwardLimit}).`,
            },
            context,
          );
        }

        this.recordTransaction(
          {
            employeeId: emp.id,
            policyId: policy.id,
            date: rolloverDate,
            transactionType: "Entitlement",
            days: policy.baseEntitlementDays,
            reason: `Annual rollover ${targetYear}: new year entitlement grant.`,
          },
          context,
        );

        results.push({
          employeeId: emp.id,
          policyId: policy.id,
          carriedForward,
          entitlementGranted: policy.baseEntitlementDays,
        });
      }
    }

    return results;
  }

  async runAnnualRolloverAsync(targetYear: number, context: ActorContext): Promise<number> {
    if (typeof window === "undefined") return this.runAnnualRollover(targetYear, context).length;
    const { rolloverLeaveBalancesFn } = await import("../server-functions/leave.server.ts");
    const created = await rolloverLeaveBalancesFn({
      data: { actor: await this.serverActor(context), leaveYear: targetYear },
    });
    await this.hydrateCompatibilityCache(context);
    return created;
  }

  async exportRequestsCsv(
    filters: { status?: string; departmentId?: string },
    context: ActorContext,
  ): Promise<{ fileName: string; content: string; rowCount: number }> {
    if (typeof window === "undefined")
      throw new Error("Leave exports must run through the server.");
    const { exportLeaveRequestsFn } = await import("../server-functions/leave.server.ts");
    return exportLeaveRequestsFn({
      data: {
        actor: await this.serverActor(context),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      },
    });
  }

  /**
   * Opportunistic, unattended trigger for the current calendar year's rollover - called from the
   * app shell (see OperationsAutomation in staff.tsx) alongside the other background reconciliation
   * jobs, so HR no longer has to remember to open Leave Admin and run it by hand every January.
   * This is still not a true server-side scheduled job (there is no backend to run one on): it only
   * fires when someone, any authenticated user, has the app open, exactly like the existing
   * attendance/onboarding reconciliation calls it sits alongside. runAnnualRollover's own
   * idempotency guard (skips any employee/policy/year that already has an Entitlement transaction)
   * makes it safe to call this on every reconciliation tick without ever double-granting.
   */
  autoRunAnnualRollover(): void {
    const systemContext: ActorContext = {
      actor: { ...SYSTEM_ACTOR, activeRole: "Super Admin" },
      reason: "Automatic annual leave rollover check",
    };
    try {
      this.runAnnualRollover(new Date().getFullYear(), systemContext);
    } catch (error) {
      getApplicationDataServices().audit.record({
        context: systemContext,
        action: "leave_auto_rollover_failed",
        module: "leave",
        entityType: "leave_policy",
        entityId: "annual-rollover",
        reason:
          error instanceof Error
            ? error.message
            : "Unknown error running automatic annual rollover",
        riskLevel: "Medium",
      });
    }
  }

  getSickLeavePayBreakdown(
    employeeId: string,
    additionalDays: number,
    context: ActorContext,
  ): SickPayTierBreakdown[] {
    this.requireEmployeeRead(employeeId, context, "view this employee's sick-leave calculation");
    const sickPolicy = this.getPolicies().find((p) => p.type === "Sick");
    if (!sickPolicy || !sickPolicy.payTiers || sickPolicy.payTiers.length === 0) {
      return [];
    }

    const activeStatuses: LeaveRequestStatus[] = [
      "Taken",
      "Approved",
      "Pending Line Manager",
      "Pending HR",
      "Pending Super Admin",
      "Amendment Pending Line Manager",
      "Amendment Pending HR",
    ];
    const currentYear = new Date().getFullYear();

    const alreadyTaken = this.getLeaveRequestsForEmployee(employeeId, context)
      .filter((r) => r.policyId === sickPolicy.id)
      .filter((r) => activeStatuses.includes(r.status))
      .filter((r) => parseISO(r.startDate).getFullYear() === currentYear)
      .reduce((sum, r) => sum + r.workingDaysRequested, 0);

    const result: Array<{ fromDay: number; toDay: number; payPercentage: number; days: number }> =
      [];
    const consumed = alreadyTaken;
    let remainingToAllocate = additionalDays;

    for (const tier of sickPolicy.payTiers as SickPayTier[]) {
      if (remainingToAllocate <= 0) break;

      const tierCapacity = tier.toDay - tier.fromDay + 1;
      const consumedInTier = Math.min(Math.max(consumed - (tier.fromDay - 1), 0), tierCapacity);
      const remainingCapacityInTier = tierCapacity - consumedInTier;

      if (remainingCapacityInTier <= 0) continue;

      const allocated = Math.min(remainingCapacityInTier, remainingToAllocate);
      if (allocated > 0) {
        result.push({
          fromDay: tier.fromDay,
          toDay: tier.toDay,
          payPercentage: tier.payPercentage,
          days: allocated,
        });
        remainingToAllocate -= allocated;
      }
    }

    return result;
  }
}
