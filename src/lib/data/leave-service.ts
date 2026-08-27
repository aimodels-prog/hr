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
} from "./leave-types.ts";
import {
  differenceInCalendarDays,
  differenceInMonths,
  parseISO,
  eachDayOfInterval,
} from "date-fns";
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
const POLICY_DEFINITIONS = [
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
    countsTowardGratuity: true,
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
      "Paid leave for a female employee whose husband has died: 130 days for a Muslim employee, 14 days for a non-Muslim employee. This policy defaults to 130 days. HR should adjust the entitlement down to 14 for a non-Muslim employee via Manual Adjustment when granting it.",
    isPaid: true,
    baseEntitlementDays: 130,
    scope: "Per Event",
    accrualMode: "Not Applicable",
    carryForwardLimit: 0,
    allowNegativeBalance: true,
    maxNegativeBalance: 130,
    requiresAttachment: true,
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

    this.ensureSeedData();
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

  async getAttachmentBlob(
    requestId: string,
    context: ActorContext,
  ): Promise<{ blob: Blob; fileName: string }> {
    const req = this.requestRepo.getById(requestId);
    if (!req) throw new Error("Request not found");
    if (!req.attachmentFileId) throw new Error("This request has no supporting attachment.");

    const isOwner = context.actor.employeeId === req.employeeId;
    const isHrOrAdmin = context.actor.activeRole === "HR" || context.actor.activeRole === "Super Admin";
    const employee = new EmployeeService().getById(req.employeeId);
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
      .getEmployees()
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

    if (eligibility.minimumServiceMonths !== undefined) {
      const months = differenceInMonths(new Date(), parseISO(employee.startDate));
      if (months < eligibility.minimumServiceMonths) return false;
    }

    return true;
  }

  getEligiblePolicies(employeeId: string): LeavePolicy[] {
    const empService = new EmployeeService();
    const employee = empService.getById(employeeId);
    const policies = this.getPolicies();

    if (!employee) {
      return policies.filter((p) => p.isEnabled && !p.eligibility);
    }

    return policies.filter((p) => p.isEnabled && this.isEmployeeEligibleForPolicy(employee, p));
  }

  getPolicies(): LeavePolicy[] {
    return this.policyRepo.list();
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

    const updated = this.policyRepo.update(id, updates, context);
    if (
      current.scope === "Annual" &&
      updated.scope === "Annual" &&
      current.baseEntitlementDays !== updated.baseEntitlementDays
    ) {
      this.applyCurrentYearEntitlementChange(current, updated, context);
    }
    return updated;
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
      .getEmployees()
      .filter((employee) => !["Inactive", "Archived"].includes(employee.status));

    for (const employee of employees) {
      if (!this.isEmployeeEligibleForPolicy(employee, updated)) continue;

      const currentYearEntitlement = this.getTransactionsForEmployee(employee.id, updated.id).find(
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

  getTransactionsForEmployee(employeeId: string, policyId?: string): LeaveTransaction[] {
    const list = this.transactionRepo.list().filter((t) => t.employeeId === employeeId);
    if (policyId) return list.filter((t) => t.policyId === policyId);
    return list;
  }

  getAllRequests(): LeaveRequest[] {
    return this.requestRepo.list();
  }

  getRequests(): LeaveRequest[] {
    return this.getAllRequests();
  }

  getLeaveRequestsForEmployee(employeeId: string): LeaveRequest[] {
    return this.requestRepo.list().filter((r) => r.employeeId === employeeId);
  }

  getPendingRequestsForManager(managerUserId: string): LeaveRequest[] {
    const empService = new EmployeeService();
    const allEmployees = empService.getEmployees();

    // Find employees who report directly to this manager
    const directReports = allEmployees.filter((e) => e.lineManagerId === managerUserId);
    const reportIds = new Set(directReports.map((e) => e.id));

    return this.requestRepo
      .list()
      .filter((r) => r.status === "Pending Line Manager" && reportIds.has(r.employeeId));
  }

  getPendingRequestsForHr(): LeaveRequest[] {
    return this.requestRepo
      .list()
      .filter(
        (r) =>
          r.status === "Pending HR" ||
          r.status === "Pending Super Admin" ||
          r.status === "Cancellation Pending",
      );
  }

  /** Compatibility alias for older dashboard code and browser records. */
  getPendingRequestsForSuperAdmin(): LeaveRequest[] {
    return this.getPendingRequestsForHr();
  }

  getTeamOverlaps(departmentId: string, startDate: string, endDate: string): LeaveRequest[] {
    const start = parseISO(startDate);
    const end = parseISO(endDate);

    const empService = new EmployeeService();
    const allEmployees = empService.getEmployees();
    const deptEmployees = new Set(
      allEmployees.filter((e) => e.department === departmentId).map((e) => e.id),
    );

    return this.requestRepo.list().filter((r) => {
      if (!deptEmployees.has(r.employeeId)) return false;
      if (
        r.status !== "Approved" &&
        r.status !== "Pending Line Manager" &&
        r.status !== "Pending HR" &&
        r.status !== "Pending Super Admin"
      )
        return false;

      const rStart = parseISO(r.startDate);
      const rEnd = parseISO(r.endDate);

      // Check for date overlap
      return start <= rEnd && end >= rStart;
    });
  }

  approveRequest(requestId: string, context: ActorContext): LeaveRequest {
    const req = this.requestRepo.getById(requestId);
    if (!req) throw new Error("Request not found");

    if (req.status === "Pending Line Manager") {
      const employee = new EmployeeService().getById(req.employeeId);
      if (!context.actor.employeeId || employee?.lineManagerId !== context.actor.employeeId) {
        this.denyAccess(
          "Leave approval denied",
          req.id,
          "Only the employee’s assigned line manager can complete this approval.",
          context,
        );
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

    if (req.status === "Pending Line Manager") {
      const employee = new EmployeeService().getById(req.employeeId);
      if (!context.actor.employeeId || employee?.lineManagerId !== context.actor.employeeId) {
        this.denyAccess(
          "Leave rejection denied",
          req.id,
          "Only the employee’s assigned line manager can decline this request at this stage.",
          context,
        );
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
      const requester = empService.getById(req.employeeId);
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
    const employees = new EmployeeService().getEmployees();
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

    const workingDaysOfWeek = new SettingsService().getAppSettings().workingDays;
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

  async submitLeaveRequest(payload: Partial<LeaveRequest>, context: ActorContext): Promise<LeaveRequest> {
    if (
      !payload.employeeId ||
      !payload.policyId ||
      !payload.startDate ||
      !payload.endDate ||
      !payload.reason?.trim() ||
      !payload.handoverContactId
    ) {
      throw new Error("Missing required fields for leave request, including Covering Colleague.");
    }

    if (!context.actor.employeeId || context.actor.employeeId !== payload.employeeId) {
      this.denyAccess(
        "Leave request submission denied",
        payload.employeeId,
        "You can only submit a leave request for yourself.",
        context,
      );
    }

    const policy = this.policyRepo.getById(payload.policyId);
    if (!policy) throw new Error("Policy not found.");
    if (policy.requiresAttachment && !payload.attachmentFileId) {
      throw new Error(`Supporting evidence is required for ${policy.name}.`);
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
    const employeeForEligibility = empServiceForEligibility.getById(payload.employeeId);

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
        const monthsOfService = differenceInMonths(
          new Date(),
          parseISO(employeeForEligibility.startDate),
        );
        if (monthsOfService < eligibility.minimumServiceMonths) {
          throw new Error(
            `${policy.name} requires at least ${eligibility.minimumServiceMonths} months of continuous service${basis}. This employee currently has ${monthsOfService} months of service.`,
          );
        }
      }
    }

    // Scope-aware balance/cap validation
    if (policy.consumesBalance) {
      if (policy.scope === "Once Per Service") {
        const activeStatuses: LeaveRequestStatus[] = [
          "Pending Line Manager",
          "Pending HR",
          "Pending Super Admin",
          "Approved",
          "Taken",
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
        if (workingDays > policy.baseEntitlementDays) {
          const basis = policy.legalBasis ? ` (${policy.legalBasis})` : "";
          throw new Error(
            `${policy.name} is capped at ${policy.baseEntitlementDays} days per occurrence${basis}. You requested ${workingDays} days.`,
          );
        }
      } else if (policy.scope === "Per Event") {
        if (workingDays > policy.baseEntitlementDays) {
          const basis = policy.legalBasis ? ` (${policy.legalBasis})` : "";
          throw new Error(
            `${policy.name} is capped at ${policy.baseEntitlementDays} days per occurrence${basis}. You requested ${workingDays} days.`,
          );
        }
      } else {
        // Annual or Ledger: balance-ledger check, unchanged.
        const balance = this.calculateBalance(payload.employeeId, payload.policyId);
        if (!policy.allowNegativeBalance && balance.projectedAvailable < workingDays) {
          throw new Error(
            `Insufficient balance. You requested ${workingDays} days, but only have ${balance.projectedAvailable} days available.`,
          );
        }
      }
    }

    // Leave Notice Rules
    const chainIncludesManager = policy.approvalChain.some(isManagerRoleName);
    const chainStartsWithManager = chainIncludesManager && isManagerRoleName(policy.approvalChain[0] ?? "");
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
    const requester = empService.getById(payload.employeeId);

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
        ? this.getSickLeavePayBreakdown(payload.employeeId, workingDays)
        : undefined;

    const request: NewRecord<LeaveRequest> = {
      employeeId: payload.employeeId,
      policyId: payload.policyId,
      startDate: payload.startDate,
      endDate: payload.endDate,
      isHalfDay: !!payload.isHalfDay,
      workingDaysRequested: workingDays,
      reason: payload.reason,
      handoverContactId: payload.handoverContactId,
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
    const requester = new EmployeeService().getById(request.employeeId);
    const requesterName = requester
      ? `${requester.preferredName} ${requester.legalName}`
      : "An employee";

    if (request.status === "Pending Line Manager" && requester?.lineManagerId) {
      const managerUser = storage
        .readCollection<User>("users")
        .find((user) => user.employeeId === requester.lineManagerId && user.status === "Active");
      if (managerUser) {
        notifications.create(
          {
            recipientUserId: managerUser.id,
            type: "Approval",
            title: "Leave request awaiting your approval",
            message: `${requesterName} requested ${request.workingDaysRequested} day(s) of ${request.policySnapshot.name} from ${request.startDate} to ${request.endDate}.`,
            priority: "High",
            status: "Unread",
            deduplicationKey: `leave-submitted-manager-${request.id}`,
            link: { entityType: "leave-request", entityId: request.id, path: "/staff/leave-approvals" },
          },
          context,
        );
      }
    } else if (request.status === "Pending HR") {
      const hrUsers = storage
        .readCollection<User>("users")
        .filter((user) => user.status === "Active" && user.roles.includes("HR"));
      for (const hrUser of hrUsers) {
        notifications.create(
          {
            recipientUserId: hrUser.id,
            type: "Approval",
            title: "Leave request awaiting HR approval",
            message: `${requesterName} requested ${request.workingDaysRequested} day(s) of ${request.policySnapshot.name} from ${request.startDate} to ${request.endDate}.`,
            priority: "High",
            status: "Unread",
            deduplicationKey: `leave-submitted-hr-${request.id}-${hrUser.id}`,
            link: { entityType: "leave-request", entityId: request.id, path: "/staff/leave-approvals" },
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

  // Not exposed outside this class - every legitimate way to move a leave balance goes through
  // a method here that carries its own authorization check first (approveRequest,
  // setEmployeeAvailableBalance, creditCompensationLeave, runAnnualRollover, etc.). Keeping this
  // private closes off a path that let any caller mutate balances with no check at all.
  private recordTransaction(payload: Partial<LeaveTransaction>, context: ActorContext): LeaveTransaction {
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
  ): LeaveTransaction {
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

    const employee = new EmployeeService().getById(employeeId);
    if (!employee) throw new Error("The employee record was not found.");
    const policy = this.policyRepo.getById(policyId);
    if (!policy || !policy.isEnabled) throw new Error("The leave policy is not available.");
    if (!this.isEmployeeEligibleForPolicy(employee, policy)) {
      throw new Error(`${employee.preferredName} is not eligible for ${policy.name}.`);
    }
    if (policy.scope !== "Annual" && policy.scope !== "Ledger") {
      throw new Error(
        `${policy.name} is controlled per event and does not have an editable balance.`,
      );
    }

    const minimumBalance = policy.allowNegativeBalance ? -(policy.maxNegativeBalance ?? 0) : 0;
    if (newAvailableBalance < minimumBalance) {
      throw new Error(
        policy.allowNegativeBalance
          ? `The lowest permitted balance for ${policy.name} is ${minimumBalance} days.`
          : `${policy.name} cannot have a negative balance.`,
      );
    }

    const current = this.calculateBalance(employeeId, policyId);
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

  calculateBalance(employeeId: string, policyId: string): LeaveBalanceReport {
    const txs = this.getTransactionsForEmployee(employeeId, policyId);

    let entitlement = 0;
    let carriedForward = 0;
    let accrued = 0;
    let adjustments = 0;
    let taken = 0;
    let approvedFuture = 0;
    let pending = 0;

    // Get all requests for this policy
    const requests = this.getLeaveRequestsForEmployee(employeeId).filter(
      (r) => r.policyId === policyId,
    );
    for (const req of requests) {
      if (
        req.status === "Pending Line Manager" ||
        req.status === "Pending HR" ||
        req.status === "Pending Super Admin"
      ) {
        pending += req.workingDaysRequested;
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const tx of txs) {
      if (tx.transactionType === "Entitlement") entitlement += tx.days;
      else if (tx.transactionType === "Carry-Forward") carriedForward += tx.days;
      else if (tx.transactionType === "Accrual") accrued += tx.days;
      else if (tx.transactionType === "Manual Adjustment") adjustments += tx.days;
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

  getAllBalancesForEmployee(employeeId: string): LeaveBalanceReport[] {
    return this.getEligiblePolicies(employeeId).map((p) => this.calculateBalance(employeeId, p.id));
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
    const employees = empService.getEmployees();
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

        const balanceBeforeRollover = this.calculateBalance(emp.id, policy.id);
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
        reason: error instanceof Error ? error.message : "Unknown error running automatic annual rollover",
        riskLevel: "Medium",
      });
    }
  }

  getSickLeavePayBreakdown(employeeId: string, additionalDays: number): SickPayTierBreakdown[] {
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
    ];
    const currentYear = new Date().getFullYear();

    const alreadyTaken = this.getLeaveRequestsForEmployee(employeeId)
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
