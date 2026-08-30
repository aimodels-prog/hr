import { LocalRepository } from "./repository.ts";
import { getApplicationDataServices } from "./application-data.ts";
import type {
  TravelRequest,
  TravelRequestStatus,
  TravelApprovalState,
  ExpenseLine,
} from "./travel-types.ts";
import { SYSTEM_CONTEXT, type ActorContext } from "./types.ts";
import { getProjectRepository, getMasterDataRepository } from "./master-data.ts";
import { NotificationService } from "./notification-service.ts";
import { EmployeeService } from "./employee-service.ts";
import { parseISO, isAfter, isBefore, isValid } from "date-fns";

const LEGACY_SUPPORTED_CURRENCIES = new Set(["OMR", "GBP", "USD", "EUR"]);

export function calculateTravelVariancePercent(estimate: number, actual: number): number {
  if (estimate > 0) return ((actual - estimate) / estimate) * 100;
  return actual > 0 ? 100 : 0;
}

export class TravelService {
  private repo: LocalRepository<TravelRequest>;

  constructor() {
    const { storage, audit } = getApplicationDataServices();
    this.repo = new LocalRepository<TravelRequest>("travelRequests", storage, audit, {
      module: "travel",
      entityType: "request",
    });
  }

  private deny(action: string, entityId: string, reason: string, context: ActorContext): never {
    getApplicationDataServices().audit.record({
      context,
      action: "travel_access_denied",
      module: "travel",
      entityType: "request",
      entityId,
      reason: `${action}: ${reason}`,
      riskLevel: "High",
    });
    throw new Error(reason);
  }

  // Self-service actions (submit, withdraw, submit expenses) are for the traveller's own
  // request, or HR/Super Admin acting on their behalf - never an arbitrary other employee.
  private requireSelfOrHr(
    req: { employeeId: string },
    context: ActorContext,
    action: string,
    entityId: string,
  ): void {
    const isSelf = context.actor.employeeId === req.employeeId;
    const isHr = context.actor.activeRole === "HR" || context.actor.activeRole === "Super Admin";
    if (!isSelf && !isHr) {
      this.deny(action, entityId, `You are not authorised to ${action}.`, context);
    }
  }

  // The three review stages are independent checkpoints held by different departments - HR
  // reviews policy/dates, Accounts reviews budget, Super Admin closes reimbursement - and none
  // of them may be exercised by the traveller reviewing their own request.
  private requireReviewerRole(
    req: { employeeId: string },
    context: ActorContext,
    allowedRoles: readonly string[],
    action: string,
    entityId: string,
  ): void {
    if (context.actor.employeeId === req.employeeId) {
      this.deny(action, entityId, "You cannot review your own travel request.", context);
    }
    if (!context.actor.activeRole || !allowedRoles.includes(context.actor.activeRole)) {
      this.deny(action, entityId, `Only ${allowedRoles.join(" or ")} can ${action}.`, context);
    }
  }

  private isReviewerRole(context: ActorContext): boolean {
    return (
      context.actor.activeRole === "HR" ||
      context.actor.activeRole === "Accounts" ||
      context.actor.activeRole === "Super Admin"
    );
  }

  private requireValidDate(value: string, label: string): Date {
    const parsed = parseISO(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !isValid(parsed)) {
      throw new Error(`${label} must be a valid calendar date.`);
    }
    return parsed;
  }

  private requireActiveCurrency(value: string): string {
    const currency = value.trim().toUpperCase();
    const configured = getMasterDataRepository("currencies").list();
    const isConfigured = configured.some(
      (item) => item.isActive && (item.code === currency || item.name === currency),
    );
    if (
      (configured.length > 0 && !isConfigured) ||
      (configured.length === 0 && !LEGACY_SUPPORTED_CURRENCIES.has(currency))
    ) {
      throw new Error("Select an active currency from VIA's currency list.");
    }
    return currency;
  }

  /** Requires HR/Accounts/Super Admin - reviewer dashboards, payroll reconciliation, reports. */
  getAllRequests(context: ActorContext): TravelRequest[] {
    if (!this.isReviewerRole(context)) {
      this.deny(
        "view all travel requests",
        "all-requests",
        "You are not authorised to view all travel requests.",
        context,
      );
    }
    return this.repo.list();
  }

  getRequestsForEmployee(employeeId: string, context: ActorContext): TravelRequest[] {
    const isSelf = context.actor.employeeId === employeeId;
    const isDirectManager =
      context.actor.activeRole === "Line Manager" &&
      Boolean(context.actor.employeeId) &&
      new EmployeeService().getById(employeeId, SYSTEM_CONTEXT)?.lineManagerId ===
        context.actor.employeeId;
    if (!isSelf && !isDirectManager && !this.isReviewerRole(context)) {
      this.deny(
        "view this employee's travel requests",
        employeeId,
        "You are not authorised to view this employee's travel requests.",
        context,
      );
    }
    return this.repo.list().filter((r) => r.employeeId === employeeId);
  }

  // context is mandatory - a request ID alone must never be enough to read someone else's trip.
  getRequestById(id: string, context: ActorContext): TravelRequest | null {
    const req = this.repo.getById(id);
    if (!req) return null;
    const isSelf = context.actor.employeeId === req.employeeId;
    if (!isSelf && !this.isReviewerRole(context)) {
      this.deny(
        "view this travel request",
        id,
        "You are not authorised to view this travel request.",
        context,
      );
    }
    return req;
  }

  async getEvidenceBlob(
    requestId: string,
    context: ActorContext,
  ): Promise<{ blob: Blob; fileName: string }> {
    const req = this.repo.getById(requestId);
    if (!req) throw new Error("Request not found");
    if (!req.evidenceFileId) throw new Error("This request has no supporting evidence.");
    const isSelf = context.actor.employeeId === req.employeeId;
    if (!isSelf && !this.isReviewerRole(context)) {
      this.deny(
        "view this request's evidence",
        requestId,
        "You are not authorised to view this request's evidence.",
        context,
      );
    }
    const { files } = getApplicationDataServices();
    const [metadata, blob] = await Promise.all([
      files.getMetadata(req.evidenceFileId),
      files.getBlob(req.evidenceFileId),
    ]);
    if (!metadata || !blob) throw new Error("The supporting file could not be found.");
    getApplicationDataServices().audit.record({
      context,
      action: "travel_evidence_accessed",
      module: "travel",
      entityType: "request",
      entityId: requestId,
      reason: `Viewed supporting evidence for travel request ${requestId}.`,
      riskLevel: "Medium",
    });
    return { blob, fileName: metadata.name ?? "evidence" };
  }

  async getReceiptBlob(
    requestId: string,
    lineId: string,
    context: ActorContext,
  ): Promise<{ blob: Blob; fileName: string }> {
    const req = this.repo.getById(requestId);
    if (!req) throw new Error("Request not found");
    const line = req.expenses?.find((e) => e.id === lineId);
    if (!line?.receiptFileId) throw new Error("This expense line has no receipt on file.");
    const isSelf = context.actor.employeeId === req.employeeId;
    if (!isSelf && !this.isReviewerRole(context)) {
      this.deny(
        "view this expense receipt",
        requestId,
        "You are not authorised to view this expense receipt.",
        context,
      );
    }
    const { files } = getApplicationDataServices();
    const [metadata, blob] = await Promise.all([
      files.getMetadata(line.receiptFileId),
      files.getBlob(line.receiptFileId),
    ]);
    if (!metadata || !blob) throw new Error("The receipt file could not be found.");
    getApplicationDataServices().audit.record({
      context,
      action: "travel_receipt_accessed",
      module: "travel",
      entityType: "request",
      entityId: requestId,
      reason: `Viewed expense receipt ${lineId} for travel request ${requestId}.`,
      riskLevel: "Medium",
    });
    return { blob, fileName: metadata.name ?? "receipt" };
  }

  async submitRequest(data: Partial<TravelRequest>, context: ActorContext): Promise<TravelRequest> {
    if (!data.employeeId) {
      throw new Error("Missing required travel information.");
    }
    this.requireSelfOrHr(
      { employeeId: data.employeeId },
      context,
      "submit a travel request",
      "new",
    );
    if (
      !data.startDate ||
      !data.endDate ||
      !data.purpose?.trim() ||
      !data.destination?.trim() ||
      !data.currency?.trim()
    ) {
      throw new Error("Missing required travel information.");
    }
    if (data.evidenceFileId) {
      const { files } = getApplicationDataServices();
      const meta = await files.getMetadata(data.evidenceFileId);
      if (
        !meta ||
        meta.owner.entityType !== "travel-request" ||
        meta.owner.entityId !== data.employeeId
      ) {
        throw new Error("The uploaded evidence file could not be verified. Please re-upload it.");
      }
    }

    const s1 = this.requireValidDate(data.startDate, "Start date");
    const e1 = this.requireValidDate(data.endDate, "End date");
    const currency = this.requireActiveCurrency(data.currency);

    if (isAfter(s1, e1)) {
      throw new Error("End date cannot be before start date.");
    }

    // Overlap validation
    const existing = this.getRequestsForEmployee(data.employeeId!, context).filter(
      (r) => r.status !== "Rejected" && r.status !== "Withdrawn" && r.status !== "Draft",
    );

    const hasOverlap = existing.some((r) => {
      const s2 = parseISO(r.startDate);
      const e2 = parseISO(r.endDate);
      return s1 <= e2 && s2 <= e1;
    });

    if (hasOverlap) {
      throw new Error("These travel dates overlap with an existing active travel request.");
    }

    // Active project validation
    if (data.projectId) {
      const proj = getProjectRepository().getById(data.projectId);
      if (!proj || !proj.isActive) {
        throw new Error("Selected project is invalid or archived.");
      }
    }
    if (data.costCentreId) {
      const cc = getMasterDataRepository("costCentres").getById(data.costCentreId);
      if (!cc || !cc.isActive) {
        throw new Error("Selected cost centre is invalid or inactive.");
      }
    }

    const transport = data.estTransport || 0;
    const accom = data.estAccommodation || 0;
    const perDiem = data.estPerDiem || 0;
    const other = data.estOther || 0;
    if (
      [transport, accom, perDiem, other].some((amount) => !Number.isFinite(amount) || amount < 0)
    ) {
      throw new Error("Estimated costs cannot be negative and must be valid amounts.");
    }

    const payload: Omit<
      TravelRequest,
      "id" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy" | "recordVersion"
    > = {
      employeeId: data.employeeId!,
      purpose: data.purpose.trim(),
      destination: data.destination.trim(),
      startDate: data.startDate,
      endDate: data.endDate,
      ...(data.projectId !== undefined ? { projectId: data.projectId } : {}),
      ...(data.costCentreId !== undefined ? { costCentreId: data.costCentreId } : {}),
      estTransport: transport,
      estAccommodation: accom,
      estPerDiem: perDiem,
      estOther: other,
      totalEstimate: transport + accom + perDiem + other,
      currency,
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
      ...(data.evidenceFileId !== undefined ? { evidenceFileId: data.evidenceFileId } : {}),

      hrApprovalStatus: "Pending",
      accountsApprovalStatus: "Pending",
      status: "Pending HR and Accounts",
    };

    const created = this.repo.create(payload, context);
    this.recordEvent("travel_submitted", created, context);
    this.notifyReviewers(created, context);
    return created;
  }

  withdrawRequest(id: string, context: ActorContext): TravelRequest {
    const req = this.repo.getById(id);
    if (!req) throw new Error("Not found");
    this.requireSelfOrHr(req, context, "withdraw this travel request", id);

    if (req.hrApprovalStatus !== "Pending" || req.accountsApprovalStatus !== "Pending") {
      throw new Error("Cannot withdraw request after an approval process has started.");
    }

    req.status = "Withdrawn";
    return this.repo.update(req.id, req, context);
  }

  hrApprove(id: string, approve: boolean, notes: string, context: ActorContext): TravelRequest {
    const req = this.repo.getById(id);
    if (!req) throw new Error("Not found");
    this.requireReviewerRole(
      req,
      context,
      ["HR", "Super Admin"],
      "review this travel request for HR",
      id,
    );
    if (req.status !== "Pending HR and Accounts") throw new Error("Invalid state for approval.");
    if (!approve && (!notes || notes.trim().length < 3)) {
      throw new Error("Rejection requires a detailed reason.");
    }

    req.hrApprovalStatus = approve ? "Approved" : "Rejected";
    req.hrNotes = notes;
    if (approve) {
      req.hrApprovedAt = new Date().toISOString();
      req.hrApprovedBy = context.actor.userId;
    }

    req.status = this.calculateFinalStatus(req);
    this.capturePreAuthorisation(req);
    const updated = this.repo.update(req.id, req, context);
    this.recordEvent(approve ? "travel_hr_approved" : "travel_hr_rejected", updated, context);
    this.notifyStatusChange(updated, context);
    return updated;
  }

  accountsApprove(
    id: string,
    approve: boolean,
    notes: string,
    context: ActorContext,
  ): TravelRequest {
    const req = this.repo.getById(id);
    if (!req) throw new Error("Not found");
    this.requireReviewerRole(
      req,
      context,
      ["Accounts", "Super Admin"],
      "review this travel request for budget",
      id,
    );
    if (req.status !== "Pending HR and Accounts") throw new Error("Invalid state for approval.");
    if (!approve && (!notes || notes.trim().length < 3)) {
      throw new Error("Rejection requires a detailed reason.");
    }

    req.accountsApprovalStatus = approve ? "Approved" : "Rejected";
    req.accountsNotes = notes;
    if (approve) {
      req.accountsApprovedAt = new Date().toISOString();
      req.accountsApprovedBy = context.actor.userId;
    }

    req.status = this.calculateFinalStatus(req);
    this.capturePreAuthorisation(req);
    const updated = this.repo.update(req.id, req, context);
    this.recordEvent(
      approve ? "travel_accounts_approved" : "travel_accounts_rejected",
      updated,
      context,
    );
    this.notifyStatusChange(updated, context);
    return updated;
  }

  async submitExpenses(
    id: string,
    expenses: ExpenseLine[],
    varianceExplanation: string,
    context: ActorContext,
  ): Promise<TravelRequest> {
    const req = this.repo.getById(id);
    if (!req) throw new Error("Not found");
    this.requireSelfOrHr(req, context, "submit expenses for this trip", id);
    if (req.status !== "Pre-authorised")
      throw new Error("Only pre-authorised trips can submit expenses.");

    const endDate = this.requireValidDate(req.endDate, "Trip end date");
    const today = new Date();
    // Reset times to compare strictly calendar days
    endDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);

    if (today <= endDate) {
      throw new Error(
        "Expenses cannot be submitted until the calendar day after the trip has officially concluded.",
      );
    }
    if (expenses.length === 0) {
      throw new Error("At least one expense line is required.");
    }

    const { files } = getApplicationDataServices();
    const tripStart = parseISO(req.startDate);
    const tripEnd = parseISO(req.endDate);
    if (new Set(expenses.map((line) => line.id)).size !== expenses.length) {
      throw new Error("Every expense line must have a unique reference ID.");
    }
    for (const line of expenses) {
      if (!line.id?.trim()) throw new Error("Every expense line requires a unique reference ID.");
      if (
        !(["Transport", "Accommodation", "Per Diem", "Other"] as string[]).includes(line.category)
      ) {
        throw new Error("Select a valid expense category.");
      }
      const lineCurrency = this.requireActiveCurrency(line.currency);
      if (lineCurrency !== req.currency) {
        throw new Error(
          `Expense lines must use the pre-authorised trip currency (${req.currency}).`,
        );
      }
      if (!Number.isFinite(line.amount) || line.amount <= 0) {
        throw new Error(`Expense line "${line.category}" must have a positive amount.`);
      }
      if (!line.reference || !line.reference.trim()) {
        throw new Error(
          `Expense line "${line.category}" dated ${line.date} requires a bill/receipt reference.`,
        );
      }
      const lineDate = this.requireValidDate(line.date, "Expense date");
      if (isBefore(lineDate, tripStart) || isAfter(lineDate, tripEnd)) {
        throw new Error(
          `Expense line "${line.category}" is dated ${line.date}, which is outside the trip's travel period (${req.startDate} to ${req.endDate}).`,
        );
      }
      if (!line.receiptFileId) {
        throw new Error(`Upload the receipt or invoice for "${line.category}" dated ${line.date}.`);
      }
      if (line.receiptFileId) {
        const meta = await files.getMetadata(line.receiptFileId);
        if (
          !meta ||
          meta.owner.entityType !== "travel-expense-line" ||
          meta.owner.entityId !== line.id
        ) {
          throw new Error(
            `The receipt uploaded for "${line.category}" (${line.date}) could not be verified. Please re-upload it.`,
          );
        }
      }
    }

    const actualTotal = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    // Variance check (10%)
    const authorisedEstimate = req.authorisedBudget?.totalEstimate ?? req.totalEstimate;
    if (
      actualTotal > authorisedEstimate * 1.1 &&
      (!varianceExplanation || varianceExplanation.trim().length < 5)
    ) {
      throw new Error(
        "Actual expenses exceed the authorised estimate by more than 10%. A detailed explanation is required.",
      );
    }

    // OMR-equivalent total: this is what payroll/finance must consume, since actualTotal above
    // is a raw sum that silently mixes currencies with no conversion when the trip's expense
    // lines aren't all in OMR. Throws if a non-OMR line is missing its exchange rate.
    const actualTotalOmr = this.computeActualTotalOmr(expenses);

    req.expenses = expenses;
    req.actualTotal = actualTotal;
    req.actualTotalOmr = actualTotalOmr;
    req.varianceExplanation = varianceExplanation;
    req.status = "Pending Super Admin Closure";

    const updated = this.repo.update(req.id, req, context);
    this.recordEvent("travel_expenses_submitted", updated, context);
    this.notifyStatusChange(updated, context);
    return updated;
  }

  /**
   * Converts a set of expense lines to their OMR-equivalent total.
   * - A line already in OMR uses a rate of 1.
   * - Any other currency requires a positive exchangeRate captured on the line; if it is
   *   missing (or non-positive), this throws rather than silently treating the raw foreign
   *   amount as if it were OMR - that mistake is exactly what causes payroll overpayment.
   */
  private computeActualTotalOmr(expenses: ExpenseLine[]): number {
    return expenses.reduce((sum, line) => {
      const amount = Number(line.amount) || 0;
      let rate: number;

      if (line.currency === "OMR") {
        rate = 1;
      } else if (typeof line.exchangeRate === "number" && line.exchangeRate > 0) {
        rate = line.exchangeRate;
      } else {
        throw new Error(
          `Expense line "${line.category}" dated ${line.date} is in ${line.currency} but has no exchange rate to OMR recorded. Enter the exchange rate for this expense before submitting.`,
        );
      }

      return sum + amount * rate;
    }, 0);
  }

  superAdminClose(
    id: string,
    approve: boolean,
    notes: string,
    context: ActorContext,
  ): TravelRequest {
    const req = this.repo.getById(id);
    if (!req) throw new Error("Not found");
    this.requireReviewerRole(req, context, ["Super Admin"], "close this travel reimbursement", id);
    if (req.status !== "Pending Super Admin Closure") throw new Error("Invalid state for closure.");
    if (!approve && (!notes || notes.trim().length < 3)) {
      throw new Error("Rejection requires a detailed reason.");
    }

    // The repository merges `changes` onto the stored record key-by-key - a key that is simply
    // absent from `changes` (e.g. via `delete`) leaves the OLD stored value untouched. Clearing
    // a field for real means the key must be present in `changes` with an explicit `undefined`,
    // which is why this is built as its own object (cast past RecordChanges' Partial<T>, which
    // exactOptionalPropertyTypes otherwise refuses to let hold an explicit undefined) rather than
    // mutating and re-submitting the fetched record.
    const changes: Record<string, unknown> = { closureNotes: notes };
    if (approve) {
      changes["status"] = "Closed";
      changes["closedAt"] = new Date().toISOString();
      changes["closedBy"] = context.actor.userId;
    } else {
      // Rejecting the *expenses*, not the *trip* itself. Send it back to Pre-authorised so they
      // can fix and resubmit - and clear every actuals field, not just the expense lines, so a
      // resubmission can't be evaluated against stale totals left over from the rejected pass.
      changes["status"] = "Pre-authorised";
      changes["expenses"] = [];
      changes["actualTotal"] = undefined;
      changes["actualTotalOmr"] = undefined;
      changes["varianceExplanation"] = undefined;
    }

    const updated = this.repo.update(req.id, changes as never, context);
    this.recordEvent(approve ? "travel_closed" : "travel_expenses_rejected", updated, context);
    if (approve) {
      this.notifyStatusChange(updated, context);
    } else {
      this.notifyTraveller(
        updated,
        context,
        "Expense claim returned",
        `Your expense claim for ${updated.destination} was returned for correction. ${notes}`.trim(),
        "Warning",
      );
    }
    return updated;
  }

  markIncludedInPayroll(
    requestIds: string[],
    payrollPeriodId: string,
    context: ActorContext,
  ): void {
    if (!["Accounts", "Super Admin"].includes(context.actor.activeRole ?? "")) {
      this.deny(
        "include travel reimbursements in payroll",
        payrollPeriodId,
        "Only Accounts or Super Admin can include reimbursements in payroll.",
        context,
      );
    }
    const requests = [...new Set(requestIds)].map((id) => {
      const request = this.repo.getById(id);
      if (!request) throw new Error("A reimbursement selected for payroll could not be found.");
      if (request.status !== "Closed") {
        throw new Error("Only closed reimbursements can be included in payroll.");
      }
      if (request.payrollPeriodId && request.payrollPeriodId !== payrollPeriodId) {
        throw new Error("A reimbursement is already included in another payroll period.");
      }
      if (request.actualTotalOmr === undefined) {
        throw new Error("A reimbursement has no verified OMR total and cannot enter payroll.");
      }
      return request;
    });
    for (const request of requests) {
      if (request.payrollPeriodId === payrollPeriodId) continue;
      this.repo.update(request.id, { payrollPeriodId }, context);
    }
  }

  private capturePreAuthorisation(request: TravelRequest): void {
    if (request.status !== "Pre-authorised" || request.authorisedBudget) return;
    const capturedAt = new Date().toISOString();
    request.preAuthorisedAt = capturedAt;
    request.authorisedBudget = {
      estTransport: request.estTransport,
      estAccommodation: request.estAccommodation,
      estPerDiem: request.estPerDiem,
      estOther: request.estOther,
      totalEstimate: request.totalEstimate,
      currency: request.currency,
      capturedAt,
    };
  }

  // A single, explicit audit action per decision (rather than relying on LocalRepository's
  // generic "update" entry) so the audit trail actually names what happened to a travel request -
  // submitted, approved by which department, rejected, closed - instead of an undifferentiated
  // stream of updates that all look the same.
  private recordEvent(action: string, req: TravelRequest, context: ActorContext): void {
    getApplicationDataServices().audit.record({
      context,
      action,
      module: "travel",
      entityType: "request",
      entityId: req.id,
      after: { status: req.status },
    });
  }

  private notifyReviewers(req: TravelRequest, context: ActorContext): void {
    const { storage, audit } = getApplicationDataServices();
    const notifService = new NotificationService(storage, audit);
    const employee = new EmployeeService().getById(req.employeeId, SYSTEM_CONTEXT);
    const reviewerRoles = ["HR", "Accounts"];
    const reviewers = storage
      .readCollection<{ id: string; roles: string[]; status: string }>("users")
      .filter(
        (user) => user.status === "Active" && user.roles.some((r) => reviewerRoles.includes(r)),
      );
    for (const reviewer of reviewers) {
      notifService.create(
        {
          recipientUserId: reviewer.id,
          type: "Info",
          title: "Travel request awaiting review",
          message: `${employee?.preferredName ?? "An employee"} requested travel to ${req.destination} (${req.startDate} - ${req.endDate}).`,
          priority: "Normal",
          status: "Unread",
          deduplicationKey: `travel-submitted-${req.id}`,
        },
        context,
      );
    }
  }

  // Notifies the traveller of every status change on their own request - pre-authorised,
  // rejected at either review stage, or closed - so they aren't left checking the portal to
  // find out what happened to a request they submitted. Only called for statuses where the
  // status alone unambiguously describes what happened (a "Pre-authorised" bounce-back after a
  // rejected expense claim is handled separately in superAdminClose, since the status alone
  // would read as approval there, not correction).
  private notifyStatusChange(req: TravelRequest, context: ActorContext): void {
    const messages: Partial<
      Record<
        TravelRequestStatus,
        { title: string; message: string; type: "Success" | "Warning" | "Info" }
      >
    > = {
      "Pre-authorised": {
        title: "Travel request pre-authorised",
        message: `Your trip to ${req.destination} was pre-authorised by both HR and Accounts.`,
        type: "Success",
      },
      Rejected: {
        title: "Travel request rejected",
        message:
          `Your trip to ${req.destination} was rejected. ${req.hrNotes || req.accountsNotes || ""}`.trim(),
        type: "Warning",
      },
      Closed: {
        title: "Travel reimbursement closed",
        message: `Your expense claim for ${req.destination} was closed and is ready for payroll processing.`,
        type: "Success",
      },
      "Pending Super Admin Closure": {
        title: "Expenses submitted for closure",
        message: `Your expense claim for ${req.destination} was submitted and is awaiting final closure.`,
        type: "Info",
      },
    };
    const notice = messages[req.status];
    if (!notice) return;
    this.notifyTraveller(req, context, notice.title, notice.message, notice.type);
  }

  private notifyTraveller(
    req: TravelRequest,
    context: ActorContext,
    title: string,
    message: string,
    type: "Success" | "Warning" | "Info",
  ): void {
    const { storage, audit } = getApplicationDataServices();
    const notifService = new NotificationService(storage, audit);
    const travellerUser = storage
      .readCollection<{ id: string; employeeId?: string; status: string }>("users")
      .find((user) => user.employeeId === req.employeeId && user.status === "Active");
    if (!travellerUser) return;
    notifService.create(
      {
        recipientUserId: travellerUser.id,
        type,
        title,
        message,
        priority: "Normal",
        status: "Unread",
        deduplicationKey: `travel-status-${req.id}-${req.status}-${req.updatedAt}`,
      },
      context,
    );
  }

  private calculateFinalStatus(req: TravelRequest): TravelRequestStatus {
    if (req.hrApprovalStatus === "Rejected" || req.accountsApprovalStatus === "Rejected") {
      return "Rejected";
    }
    if (req.hrApprovalStatus === "Approved" && req.accountsApprovalStatus === "Approved") {
      return "Pre-authorised";
    }
    return "Pending HR and Accounts";
  }
}
