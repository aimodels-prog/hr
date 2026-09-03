import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, not, or, sql } from "drizzle-orm";

import type { TravelRequest } from "../../data/travel-types.ts";
import { getDatabaseClient } from "../client.ts";
import { readObjectFile } from "../object-storage.server.ts";
import { fileMetadata } from "../schema/documents.ts";
import { employees, roles, userRoles, users } from "../schema/employee.ts";
import { costCentres, currencies, projects } from "../schema/master-data.ts";
import { auditEvents, notifications } from "../schema/system.ts";
import {
  expenseItems,
  payrollPeriods,
  reimbursements,
  travelApprovals,
  travelRequests,
} from "../schema/travel-payroll.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

type Tx = Parameters<Parameters<ReturnType<typeof getDatabaseClient>["transaction"]>[0]>[0];
type MasterTable = typeof projects | typeof costCentres | typeof currencies;

function role(actor: AuditActorContext) {
  return actor.activeRole ?? actor.roles?.[0] ?? "Employee";
}
function auditActor(actor: AuditActorContext) {
  return {
    actorUserId: actor.userId,
    actorEmployeeId: actor.employeeId,
    actorDisplayName: actor.displayName,
    activeRole: role(actor),
    actorRoles: actor.roles ?? [],
  };
}
async function activeReference(tx: Tx, table: MasterTable, org: string, id: string, label: string) {
  const [record] = await tx
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.organisationId, org), eq(table.id, id), eq(table.isActive, true)))
    .limit(1);
  if (!record) throw new Error(`Select an active ${label}.`);
}
async function userForEmployee(tx: Tx, org: string, employeeId: string) {
  const [user] = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.organisationId, org),
        eq(users.employeeId, employeeId),
        eq(users.status, "Active"),
      ),
    )
    .limit(1);
  return user?.id;
}
async function usersForRoles(tx: Tx, org: string, codes: string[]) {
  if (!codes.length) return [];
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(
      and(
        eq(users.organisationId, org),
        eq(users.status, "Active"),
        inArray(roles.code, codes as (typeof roles.code.enumValues)[number][]),
      ),
    );
  return [...new Set(rows.map((item) => item.id))];
}
async function notify(
  tx: Tx,
  org: string,
  recipients: string[],
  requestId: string,
  input: {
    title: string;
    message: string;
    key: string;
    path: string;
    priority?: "Normal" | "High";
  },
  actorUserId: string,
) {
  for (const recipientUserId of recipients)
    await tx
      .insert(notifications)
      .values({
        organisationId: org,
        recipientUserId,
        type: "Travel",
        title: input.title,
        message: input.message,
        priority: input.priority ?? "Normal",
        status: "Unread",
        deduplicationKey: input.key,
        link: { entityType: "travel-request", entityId: requestId, path: input.path },
        createdBy: actorUserId,
        updatedBy: actorUserId,
      } as typeof notifications.$inferInsert)
      .onConflictDoNothing();
}

function mapTravel(
  row: typeof travelRequests.$inferSelect,
  lines: (typeof expenseItems.$inferSelect)[],
): TravelRequest {
  return {
    id: row.id,
    databaseId: row.id,
    employeeId: row.employeeId,
    purpose: row.purpose,
    destination: row.destination,
    startDate: row.startDate,
    endDate: row.endDate,
    ...(row.projectId ? { projectId: row.projectId } : {}),
    ...(row.costCentreId ? { costCentreId: row.costCentreId } : {}),
    estTransport: Number(row.estTransport),
    estAccommodation: Number(row.estAccommodation),
    estPerDiem: Number(row.estPerDiem),
    estOther: Number(row.estOther),
    totalEstimate: Number(row.totalEstimate),
    currency: row.currency,
    ...(row.notes ? { notes: row.notes } : {}),
    ...(row.evidenceFileId ? { evidenceFileId: row.evidenceFileId } : {}),
    hrApprovalStatus: row.hrApprovalStatus,
    accountsApprovalStatus: row.accountsApprovalStatus,
    ...(row.hrNotes ? { hrNotes: row.hrNotes } : {}),
    ...(row.accountsNotes ? { accountsNotes: row.accountsNotes } : {}),
    ...(row.hrApprovedAt ? { hrApprovedAt: row.hrApprovedAt } : {}),
    ...(row.hrApprovedBy ? { hrApprovedBy: row.hrApprovedBy } : {}),
    ...(row.accountsApprovedAt ? { accountsApprovedAt: row.accountsApprovedAt } : {}),
    ...(row.accountsApprovedBy ? { accountsApprovedBy: row.accountsApprovedBy } : {}),
    ...(row.preAuthorisedAt ? { preAuthorisedAt: row.preAuthorisedAt } : {}),
    ...(row.authorisedBudget
      ? { authorisedBudget: row.authorisedBudget as NonNullable<TravelRequest["authorisedBudget"]> }
      : {}),
    expenses: lines.map((line) => ({
      id: line.id,
      category: line.category as "Transport" | "Accommodation" | "Per Diem" | "Other",
      amount: Number(line.amount),
      currency: line.currency,
      ...(line.exchangeRate ? { exchangeRate: Number(line.exchangeRate) } : {}),
      reference: line.reference,
      date: line.date,
      ...(line.notes ? { notes: line.notes } : {}),
      ...(line.receiptFileId ? { receiptFileId: line.receiptFileId } : {}),
    })),
    ...(row.actualTotal !== null ? { actualTotal: Number(row.actualTotal) } : {}),
    ...(row.actualTotalOmr !== null ? { actualTotalOmr: Number(row.actualTotalOmr) } : {}),
    ...(row.varianceExplanation ? { varianceExplanation: row.varianceExplanation } : {}),
    ...(row.closureNotes ? { closureNotes: row.closureNotes } : {}),
    ...(row.closedAt ? { closedAt: row.closedAt } : {}),
    ...(row.closedBy ? { closedBy: row.closedBy } : {}),
    ...(row.payrollPeriodId ? { payrollPeriodId: row.payrollPeriodId } : {}),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    ...(row.archivedAt ? { archivedAt: row.archivedAt.toISOString() } : {}),
    recordVersion: row.recordVersion,
  };
}

export async function listTravelRequestsForActor(org: string, actor: AuditActorContext) {
  if (!actor.employeeId) throw new Error("A verified employee is required.");
  const db = getDatabaseClient();
  const canReview = ["HR", "Accounts", "Super Admin"].includes(role(actor));
  const rows = await db
    .select()
    .from(travelRequests)
    .where(
      and(
        eq(travelRequests.organisationId, org),
        isNull(travelRequests.archivedAt),
        ...(canReview ? [] : [eq(travelRequests.employeeId, actor.employeeId)]),
      ),
    )
    .orderBy(desc(travelRequests.createdAt));
  const ids = rows.map((item) => item.id);
  const lines = ids.length
    ? await db
        .select()
        .from(expenseItems)
        .where(
          and(
            eq(expenseItems.organisationId, org),
            inArray(expenseItems.travelRequestId, ids),
            isNull(expenseItems.archivedAt),
          ),
        )
        .orderBy(expenseItems.date, expenseItems.createdAt)
    : [];
  return rows.map((item) =>
    mapTravel(
      item,
      lines.filter((line) => line.travelRequestId === item.id),
    ),
  );
}

export async function createTravelRequestInDatabase(
  org: string,
  input: {
    employeeId: string;
    purpose: string;
    destination: string;
    startDate: string;
    endDate: string;
    estTransport: number;
    estAccommodation: number;
    estPerDiem: number;
    estOther: number;
    currencyId: string;
    projectId?: string;
    costCentreId?: string;
    notes?: string;
    evidenceFileId?: string;
  },
  actor: AuditActorContext,
) {
  if (!actor.employeeId || actor.employeeId !== input.employeeId)
    throw new Error("You can only request travel for yourself.");
  if (!input.purpose.trim() || !input.destination.trim())
    throw new Error("Enter the business purpose and destination.");
  if (input.endDate < input.startDate)
    throw new Error("The end date cannot be before the start date.");
  const estimates = [input.estTransport, input.estAccommodation, input.estPerDiem, input.estOther];
  if (estimates.some((value) => !Number.isFinite(value) || value < 0))
    throw new Error("Estimated costs must be valid non-negative amounts.");
  const db = getDatabaseClient();
  const id = randomUUID();
  await db.transaction(async (tx) => {
    const [employee] = await tx
      .select({
        id: employees.id,
        status: employees.status,
        preferredName: employees.preferredName,
      })
      .from(employees)
      .where(and(eq(employees.organisationId, org), eq(employees.id, input.employeeId)))
      .limit(1);
    if (!employee || !["Active", "Probation", "Notice"].includes(employee.status))
      throw new Error("An active employee profile is required.");
    await activeReference(tx, currencies, org, input.currencyId, "currency");
    const [currency] = await tx
      .select({ code: currencies.code })
      .from(currencies)
      .where(eq(currencies.id, input.currencyId));
    if (!currency?.code) throw new Error("The selected currency has no ISO code.");
    if (input.projectId) await activeReference(tx, projects, org, input.projectId, "project");
    if (input.costCentreId)
      await activeReference(tx, costCentres, org, input.costCentreId, "cost centre");
    const [overlap] = await tx
      .select({ id: travelRequests.id })
      .from(travelRequests)
      .where(
        and(
          eq(travelRequests.organisationId, org),
          eq(travelRequests.employeeId, input.employeeId),
          isNull(travelRequests.archivedAt),
          not(inArray(travelRequests.status, ["Rejected", "Withdrawn"])),
          sql`${travelRequests.startDate} <= ${input.endDate}`,
          sql`${travelRequests.endDate} >= ${input.startDate}`,
        ),
      )
      .limit(1);
    if (overlap) throw new Error("These dates overlap an existing active travel request.");
    if (input.evidenceFileId) {
      const [file] = await tx
        .select()
        .from(fileMetadata)
        .where(and(eq(fileMetadata.organisationId, org), eq(fileMetadata.id, input.evidenceFileId)))
        .limit(1);
      if (
        !file ||
        file.storageStatus !== "Available" ||
        file.ownerEntityType !== "travel-request-evidence" ||
        file.ownerEntityId !== input.employeeId
      )
        throw new Error("The supporting file does not belong to this employee.");
    }
    const total = estimates.reduce((sum, value) => sum + value, 0);
    await tx.insert(travelRequests).values({
      id,
      organisationId: org,
      employeeId: input.employeeId,
      purpose: input.purpose.trim(),
      destination: input.destination.trim(),
      startDate: input.startDate,
      endDate: input.endDate,
      estTransport: String(input.estTransport),
      estAccommodation: String(input.estAccommodation),
      estPerDiem: String(input.estPerDiem),
      estOther: String(input.estOther),
      totalEstimate: String(total),
      currency: currency.code,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.costCentreId ? { costCentreId: input.costCentreId } : {}),
      ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
      ...(input.evidenceFileId ? { evidenceFileId: input.evidenceFileId } : {}),
      status: "Pending HR and Accounts",
      createdBy: actor.userId,
      updatedBy: actor.userId,
    } as typeof travelRequests.$inferInsert);
    const reviewers = await usersForRoles(tx, org, ["HR", "Accounts", "Super Admin"]);
    await notify(
      tx,
      org,
      reviewers,
      id,
      {
        title: "Travel request awaiting review",
        message: `${employee.preferredName} requested travel to ${input.destination.trim()}.`,
        key: `travel-submitted-${id}`,
        path: "/staff/travel-hr-approvals",
        priority: "High",
      },
      actor.userId!,
    );
    await tx.insert(auditEvents).values({
      organisationId: org,
      ...auditActor(actor),
      action: "submit",
      module: "travel",
      entityType: "travel-request",
      entityId: id,
      afterSummary: {
        status: "Pending HR and Accounts",
        totalEstimate: total,
        currency: currency.code,
      },
      reason: "Submitted a travel pre-authorisation request",
      riskLevel: "Medium",
    } as typeof auditEvents.$inferInsert);
  });
  return id;
}

export async function withdrawTravelRequestInDatabase(
  org: string,
  requestId: string,
  actor: AuditActorContext,
) {
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from travel_requests where organisation_id=${org} and id=${requestId} for update`,
    );
    const [request] = await tx
      .select()
      .from(travelRequests)
      .where(and(eq(travelRequests.organisationId, org), eq(travelRequests.id, requestId)))
      .limit(1);
    if (!request || request.employeeId !== actor.employeeId)
      throw new Error("You can only withdraw your own travel request.");
    if (
      request.status !== "Pending HR and Accounts" ||
      request.hrApprovalStatus !== "Pending" ||
      request.accountsApprovalStatus !== "Pending"
    )
      throw new Error("This request can no longer be withdrawn.");
    await tx
      .update(travelRequests)
      .set({
        status: "Withdrawn",
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${travelRequests.recordVersion} + 1`,
      })
      .where(eq(travelRequests.id, requestId));
    await tx.insert(auditEvents).values({
      organisationId: org,
      ...auditActor(actor),
      action: "withdraw",
      module: "travel",
      entityType: "travel-request",
      entityId: requestId,
      beforeSummary: { status: request.status },
      afterSummary: { status: "Withdrawn" },
      reason: "Employee withdrew the travel request",
      riskLevel: "Medium",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function decideTravelRequestInDatabase(
  org: string,
  requestId: string,
  stage: "HR" | "Accounts",
  decision: "approve" | "reject",
  reason: string | undefined,
  actor: AuditActorContext,
) {
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from travel_requests where organisation_id=${org} and id=${requestId} for update`,
    );
    const [request] = await tx
      .select()
      .from(travelRequests)
      .where(and(eq(travelRequests.organisationId, org), eq(travelRequests.id, requestId)))
      .limit(1);
    if (!request) throw new Error("Travel request not found.");
    if (request.employeeId === actor.employeeId)
      throw new Error("You cannot approve your own travel request.");
    if (request.status !== "Pending HR and Accounts")
      throw new Error("This request is no longer awaiting approval.");
    if (stage === "HR" && !["HR", "Super Admin"].includes(role(actor)))
      throw new Error("Only HR can complete the HR review.");
    if (stage === "Accounts" && !["Accounts", "Super Admin"].includes(role(actor)))
      throw new Error("Only Accounts can complete the budget review.");
    if (decision === "reject" && (reason?.trim().length ?? 0) < 3)
      throw new Error("A clear rejection reason is required.");
    const current = stage === "HR" ? request.hrApprovalStatus : request.accountsApprovalStatus;
    if (current !== "Pending") throw new Error(`${stage} has already decided this request.`);
    const nextHr =
      stage === "HR"
        ? decision === "approve"
          ? "Approved"
          : "Rejected"
        : request.hrApprovalStatus;
    const nextAccounts =
      stage === "Accounts"
        ? decision === "approve"
          ? "Approved"
          : "Rejected"
        : request.accountsApprovalStatus;
    const nextStatus =
      decision === "reject"
        ? "Rejected"
        : nextHr === "Approved" && nextAccounts === "Approved"
          ? "Pre-authorised"
          : "Pending HR and Accounts";
    const decidedAt = new Date().toISOString();
    const authorisedBudget =
      nextStatus === "Pre-authorised"
        ? {
            estTransport: Number(request.estTransport),
            estAccommodation: Number(request.estAccommodation),
            estPerDiem: Number(request.estPerDiem),
            estOther: Number(request.estOther),
            totalEstimate: Number(request.totalEstimate),
            currency: request.currency,
            capturedAt: decidedAt,
          }
        : request.authorisedBudget;
    await tx
      .update(travelRequests)
      .set({
        ...(stage === "HR"
          ? {
              hrApprovalStatus: nextHr,
              hrNotes: reason?.trim() ?? null,
              hrApprovedAt: decision === "approve" ? decidedAt : null,
              hrApprovedBy: decision === "approve" ? actor.userId : null,
            }
          : {}),
        ...(stage === "Accounts"
          ? {
              accountsApprovalStatus: nextAccounts,
              accountsNotes: reason?.trim() ?? null,
              accountsApprovedAt: decision === "approve" ? decidedAt : null,
              accountsApprovedBy: decision === "approve" ? actor.userId : null,
            }
          : {}),
        status: nextStatus,
        ...(nextStatus === "Pre-authorised"
          ? { preAuthorisedAt: decidedAt, authorisedBudget }
          : {}),
        updatedAt: new Date(),
        updatedBy: actor.userId!,
        recordVersion: sql`${travelRequests.recordVersion} + 1`,
      } as unknown as typeof travelRequests.$inferInsert)
      .where(eq(travelRequests.id, requestId));
    await tx.insert(travelApprovals).values({
      id: randomUUID(),
      organisationId: org,
      travelRequestId: requestId,
      stage,
      state: decision === "approve" ? "Approved" : "Rejected",
      decidedBy: actor.userId,
      reason: reason?.trim(),
    } as typeof travelApprovals.$inferInsert);
    const traveller = await userForEmployee(tx, org, request.employeeId);
    if (traveller)
      await notify(
        tx,
        org,
        [traveller],
        requestId,
        {
          title:
            nextStatus === "Pre-authorised"
              ? "Travel request pre-authorised"
              : decision === "reject"
                ? "Travel request rejected"
                : `${stage} review completed`,
          message:
            nextStatus === "Pre-authorised"
              ? `Your trip to ${request.destination} is pre-authorised by HR and Accounts.`
              : decision === "reject"
                ? `Your trip to ${request.destination} was rejected. ${reason?.trim()}`
                : `${stage} completed its review. The other approval is still required.`,
          key: `travel-decision-${requestId}-${stage}`,
          path: `/staff/travel/${requestId}`,
          priority: decision === "reject" ? "High" : "Normal",
        },
        actor.userId!,
      );
    await tx.insert(auditEvents).values({
      organisationId: org,
      ...auditActor(actor),
      action:
        decision === "approve" ? `approve-${stage.toLowerCase()}` : `reject-${stage.toLowerCase()}`,
      module: "travel",
      entityType: "travel-request",
      entityId: requestId,
      beforeSummary: {
        status: request.status,
        hr: request.hrApprovalStatus,
        accounts: request.accountsApprovalStatus,
      },
      afterSummary: { status: nextStatus, hr: nextHr, accounts: nextAccounts },
      reason: reason?.trim() ?? `${stage} approved the travel request`,
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
  });
}

export interface TravelExpenseInput {
  id: string;
  category: "Transport" | "Accommodation" | "Per Diem" | "Other";
  amount: number;
  currencyId: string;
  exchangeRate?: number;
  reference: string;
  date: string;
  notes?: string;
  receiptFileId: string;
}

export async function submitTravelExpensesInDatabase(
  org: string,
  requestId: string,
  lines: TravelExpenseInput[],
  varianceExplanation: string,
  actor: AuditActorContext,
) {
  if (!lines.length) throw new Error("Add at least one expense line.");
  if (new Set(lines.map((line) => line.id)).size !== lines.length)
    throw new Error("Expense lines must have unique IDs.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from travel_requests where organisation_id=${org} and id=${requestId} for update`,
    );
    const [request] = await tx
      .select()
      .from(travelRequests)
      .where(and(eq(travelRequests.organisationId, org), eq(travelRequests.id, requestId)))
      .limit(1);
    if (!request || request.employeeId !== actor.employeeId)
      throw new Error("You can only submit expenses for your own trip.");
    if (request.status !== "Pre-authorised")
      throw new Error("Only a pre-authorised trip can submit expenses.");
    if (new Date().toISOString().slice(0, 10) <= request.endDate)
      throw new Error("Expenses can be submitted from the day after the trip ends.");
    let actualTotal = 0;
    let actualTotalOmr = 0;
    const inserts: (typeof expenseItems.$inferInsert)[] = [];
    for (const line of lines) {
      if (!Number.isFinite(line.amount) || line.amount <= 0)
        throw new Error("Every expense amount must be greater than zero.");
      if (!line.reference.trim())
        throw new Error("Every expense needs a bill or invoice reference.");
      if (line.date < request.startDate || line.date > request.endDate)
        throw new Error("Every expense date must fall within the trip dates.");
      if (
        line.exchangeRate !== undefined &&
        (!Number.isFinite(line.exchangeRate) || line.exchangeRate <= 0)
      )
        throw new Error("Exchange rates must be greater than zero.");
      await activeReference(tx, currencies, org, line.currencyId, "currency");
      const [currency] = await tx
        .select({ code: currencies.code })
        .from(currencies)
        .where(eq(currencies.id, line.currencyId));
      if (!currency?.code) throw new Error("An expense currency is invalid.");
      const rate = currency.code === "OMR" ? 1 : line.exchangeRate;
      if (!rate)
        throw new Error(`Enter the exchange rate to OMR for the ${currency.code} expense.`);
      const [file] = await tx
        .select()
        .from(fileMetadata)
        .where(and(eq(fileMetadata.organisationId, org), eq(fileMetadata.id, line.receiptFileId)))
        .limit(1);
      if (
        !file ||
        file.storageStatus !== "Available" ||
        file.ownerEntityType !== "travel-expense-receipt" ||
        file.ownerEntityId !== line.id
      )
        throw new Error("Each receipt must exist and belong to its expense line.");
      actualTotal += line.amount;
      actualTotalOmr += line.amount * rate;
      inserts.push({
        id: line.id,
        organisationId: org,
        travelRequestId: requestId,
        category: line.category,
        amount: String(line.amount),
        currency: currency.code,
        exchangeRate: String(rate),
        reference: line.reference.trim(),
        date: line.date,
        notes: line.notes?.trim(),
        receiptFileId: line.receiptFileId,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      } as typeof expenseItems.$inferInsert);
    }
    const budget =
      (request.authorisedBudget as { totalEstimate?: number } | null)?.totalEstimate ??
      Number(request.totalEstimate);
    if (actualTotal > budget * 1.1 && varianceExplanation.trim().length < 5)
      throw new Error(
        "Explain why actual expenses exceed the authorised estimate by more than 10%.",
      );
    await tx
      .delete(expenseItems)
      .where(
        and(eq(expenseItems.organisationId, org), eq(expenseItems.travelRequestId, requestId)),
      );
    await tx.insert(expenseItems).values(inserts);
    await tx
      .update(travelRequests)
      .set({
        actualTotal: String(actualTotal),
        actualTotalOmr: String(actualTotalOmr),
        varianceExplanation: varianceExplanation.trim() || null,
        status: "Pending Super Admin Closure",
        closureNotes: null,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${travelRequests.recordVersion} + 1`,
      })
      .where(eq(travelRequests.id, requestId));
    const admins = await usersForRoles(tx, org, ["Super Admin"]);
    await notify(
      tx,
      org,
      admins,
      requestId,
      {
        title: "Reimbursement awaiting closure",
        message: `Expenses for ${request.destination} are ready for final review.`,
        key: `travel-closure-${requestId}-${request.recordVersion + 1}`,
        path: "/staff/travel-closures",
        priority: "High",
      },
      actor.userId!,
    );
    await tx.insert(auditEvents).values({
      organisationId: org,
      ...auditActor(actor),
      action: "submit-expenses",
      module: "travel",
      entityType: "travel-request",
      entityId: requestId,
      afterSummary: {
        status: "Pending Super Admin Closure",
        lineCount: lines.length,
        actualTotal,
        actualTotalOmr,
      },
      reason: "Submitted post-trip expenses and receipts",
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function closeTravelReimbursementInDatabase(
  org: string,
  requestId: string,
  decision: "close" | "reject",
  notes: string | undefined,
  actor: AuditActorContext,
) {
  if (role(actor) !== "Super Admin")
    throw new Error("Only Super Admin can close or return reimbursements.");
  if (decision === "reject" && (notes?.trim().length ?? 0) < 3)
    throw new Error("A clear return reason is required.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from travel_requests where organisation_id=${org} and id=${requestId} for update`,
    );
    const [request] = await tx
      .select()
      .from(travelRequests)
      .where(and(eq(travelRequests.organisationId, org), eq(travelRequests.id, requestId)))
      .limit(1);
    if (!request) throw new Error("Travel request not found.");
    if (request.employeeId === actor.employeeId)
      throw new Error("You cannot close your own reimbursement.");
    if (request.status !== "Pending Super Admin Closure")
      throw new Error("This reimbursement is no longer awaiting closure.");
    const traveller = await userForEmployee(tx, org, request.employeeId);
    if (decision === "close") {
      if (request.actualTotalOmr === null)
        throw new Error("The reimbursement has no verified OMR total.");
      const closedAt = new Date().toISOString();
      await tx
        .update(travelRequests)
        .set({
          status: "Closed",
          closureNotes: notes?.trim() ?? null,
          closedAt,
          closedBy: actor.userId,
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${travelRequests.recordVersion} + 1`,
        })
        .where(eq(travelRequests.id, requestId));
      await tx
        .insert(reimbursements)
        .values({
          organisationId: org,
          travelRequestId: requestId,
          employeeId: request.employeeId,
          amount: request.actualTotalOmr,
          currency: "OMR",
          status: "Ready for Payroll",
          closedAt,
          closedBy: actor.userId,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        } as typeof reimbursements.$inferInsert)
        .onConflictDoUpdate({
          target: reimbursements.travelRequestId,
          set: {
            amount: request.actualTotalOmr,
            currency: "OMR",
            status: "Ready for Payroll",
            closedAt,
            closedBy: actor.userId,
            rejectionReason: null,
            updatedAt: new Date(),
            updatedBy: actor.userId,
            recordVersion: sql`${reimbursements.recordVersion} + 1`,
          },
        });
    } else {
      await tx
        .delete(expenseItems)
        .where(
          and(eq(expenseItems.organisationId, org), eq(expenseItems.travelRequestId, requestId)),
        );
      await tx
        .update(travelRequests)
        .set({
          status: "Pre-authorised",
          actualTotal: null,
          actualTotalOmr: null,
          varianceExplanation: null,
          closureNotes: notes!.trim(),
          closedAt: null,
          closedBy: null,
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${travelRequests.recordVersion} + 1`,
        })
        .where(eq(travelRequests.id, requestId));
      await tx
        .delete(reimbursements)
        .where(
          and(
            eq(reimbursements.organisationId, org),
            eq(reimbursements.travelRequestId, requestId),
          ),
        );
    }
    if (traveller)
      await notify(
        tx,
        org,
        [traveller],
        requestId,
        {
          title: decision === "close" ? "Reimbursement closed" : "Expense claim returned",
          message:
            decision === "close"
              ? `Your ${request.destination} reimbursement is ready for payroll.`
              : `Correct and resubmit the expenses for ${request.destination}. ${notes!.trim()}`,
          key: `travel-final-${requestId}-${request.recordVersion + 1}`,
          path: `/staff/travel/${requestId}`,
          priority: decision === "reject" ? "High" : "Normal",
        },
        actor.userId!,
      );
    await tx.insert(auditEvents).values({
      organisationId: org,
      ...auditActor(actor),
      action: decision,
      module: "travel",
      entityType: "travel-request",
      entityId: requestId,
      beforeSummary: { status: request.status, actualTotalOmr: request.actualTotalOmr },
      afterSummary: {
        status: decision === "close" ? "Closed" : "Pre-authorised",
        actualsCleared: decision === "reject",
      },
      reason: notes?.trim() ?? "Closed the reimbursement",
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function readTravelFileInDatabase(
  org: string,
  requestId: string,
  expenseLineId: string | undefined,
  actor: AuditActorContext,
) {
  const db = getDatabaseClient();
  const [request] = await db
    .select()
    .from(travelRequests)
    .where(and(eq(travelRequests.organisationId, org), eq(travelRequests.id, requestId)))
    .limit(1);
  if (!request) throw new Error("Travel request not found.");
  if (
    request.employeeId !== actor.employeeId &&
    !["HR", "Accounts", "Super Admin"].includes(role(actor))
  )
    throw new Error("You are not authorised to view this travel file.");
  let fileId: string | null = request.evidenceFileId;
  if (expenseLineId) {
    const [line] = await db
      .select({ receiptFileId: expenseItems.receiptFileId })
      .from(expenseItems)
      .where(
        and(
          eq(expenseItems.organisationId, org),
          eq(expenseItems.travelRequestId, requestId),
          eq(expenseItems.id, expenseLineId),
        ),
      )
      .limit(1);
    fileId = line?.receiptFileId ?? null;
  }
  if (!fileId) throw new Error("The requested travel file is not available.");
  return readObjectFile(
    org,
    fileId,
    {
      ...(actor.userId ? { userId: actor.userId } : {}),
      ...(actor.employeeId ? { employeeId: actor.employeeId } : {}),
      displayName: actor.displayName,
      activeRole: role(actor),
      ...(actor.roles ? { roles: actor.roles } : {}),
    },
    expenseLineId
      ? `Viewed receipt for travel expense ${expenseLineId}`
      : `Viewed supporting evidence for travel request ${requestId}`,
  );
}

export async function assignTravelReimbursementsToPayrollInDatabase(
  org: string,
  requestIds: string[],
  payrollPeriodId: string,
  actor: AuditActorContext,
) {
  if (!["Accounts", "Super Admin"].includes(role(actor)))
    throw new Error("Only Accounts or Super Admin can assign reimbursements to payroll.");
  const uniqueIds = [...new Set(requestIds)];
  if (!uniqueIds.length) throw new Error("Select at least one reimbursement.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [period] = await tx
      .select()
      .from(payrollPeriods)
      .where(and(eq(payrollPeriods.organisationId, org), eq(payrollPeriods.id, payrollPeriodId)))
      .limit(1);
    if (!period || ["Locked", "Exported"].includes(period.status))
      throw new Error("Select an open payroll period.");
    await tx.execute(
      sql`select id from travel_requests where organisation_id=${org} and id in ${uniqueIds} for update`,
    );
    const rows = await tx
      .select()
      .from(travelRequests)
      .where(and(eq(travelRequests.organisationId, org), inArray(travelRequests.id, uniqueIds)));
    if (rows.length !== uniqueIds.length)
      throw new Error("A selected reimbursement was not found.");
    for (const request of rows) {
      if (request.status !== "Closed" || request.actualTotalOmr === null)
        throw new Error("Only closed reimbursements with a verified OMR total can enter payroll.");
      if (request.payrollPeriodId && request.payrollPeriodId !== payrollPeriodId)
        throw new Error("A reimbursement is already assigned to another payroll period.");
    }
    await tx
      .update(travelRequests)
      .set({
        payrollPeriodId,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${travelRequests.recordVersion} + 1`,
      })
      .where(
        and(
          eq(travelRequests.organisationId, org),
          inArray(travelRequests.id, uniqueIds),
          isNull(travelRequests.payrollPeriodId),
        ),
      );
    await tx
      .update(reimbursements)
      .set({
        status: "Included in Payroll",
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${reimbursements.recordVersion} + 1`,
      })
      .where(
        and(
          eq(reimbursements.organisationId, org),
          inArray(reimbursements.travelRequestId, uniqueIds),
        ),
      );
    await tx.insert(auditEvents).values({
      organisationId: org,
      ...auditActor(actor),
      action: "assign-payroll",
      module: "travel",
      entityType: "travel-reimbursement-batch",
      entityId: payrollPeriodId,
      afterSummary: { requestIds: uniqueIds, count: uniqueIds.length },
      reason: "Assigned closed reimbursements to payroll",
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function processTravelWorker(now = new Date()) {
  const db = getDatabaseClient();
  const cutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const pending = await db
    .select()
    .from(travelRequests)
    .where(
      and(
        isNull(travelRequests.archivedAt),
        or(
          and(
            eq(travelRequests.status, "Pending HR and Accounts"),
            lt(travelRequests.createdAt, cutoff),
          ),
          and(
            eq(travelRequests.status, "Pending Super Admin Closure"),
            lt(travelRequests.updatedAt, cutoff),
          ),
        ),
      ),
    );
  let reminders = 0;
  for (const request of pending) {
    await db.transaction(async (tx) => {
      const roleCodes =
        request.status === "Pending Super Admin Closure"
          ? ["Super Admin"]
          : [
              request.hrApprovalStatus === "Pending" ? "HR" : "",
              request.accountsApprovalStatus === "Pending" ? "Accounts" : "",
            ].filter(Boolean);
      const recipients = await usersForRoles(tx, request.organisationId, roleCodes);
      const key = `travel-worker-${request.id}-${request.status}-${request.recordVersion}`;
      const existing = await tx
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.organisationId, request.organisationId),
            eq(notifications.deduplicationKey, key),
          ),
        )
        .limit(1);
      await notify(
        tx,
        request.organisationId,
        recipients,
        request.id,
        {
          title: "Travel action overdue",
          message:
            request.status === "Pending Super Admin Closure"
              ? `The ${request.destination} reimbursement is awaiting closure.`
              : `The ${request.destination} travel request is awaiting approval.`,
          key,
          path:
            request.status === "Pending Super Admin Closure"
              ? "/staff/travel-closures"
              : "/staff/travel-hr-approvals",
          priority: "High",
        },
        request.updatedBy,
      );
      if (!existing.length) reminders += recipients.length;
    });
  }
  const completedTrips = await db
    .select()
    .from(travelRequests)
    .where(
      and(
        eq(travelRequests.status, "Pre-authorised"),
        lt(travelRequests.endDate, now.toISOString().slice(0, 10)),
        isNull(travelRequests.archivedAt),
      ),
    );
  for (const request of completedTrips) {
    await db.transaction(async (tx) => {
      const traveller = await userForEmployee(tx, request.organisationId, request.employeeId);
      if (!traveller) return;
      const key = `travel-expenses-due-${request.id}`;
      const existing = await tx
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.organisationId, request.organisationId),
            eq(notifications.deduplicationKey, key),
          ),
        )
        .limit(1);
      await notify(
        tx,
        request.organisationId,
        [traveller],
        request.id,
        {
          title: "Submit your travel expenses",
          message: `Your trip to ${request.destination} has ended. Add bills and receipts for reimbursement.`,
          key,
          path: `/staff/travel/${request.id}`,
        },
        request.updatedBy,
      );
      if (!existing.length) reminders += 1;
    });
  }
  return { reviewed: pending.length + completedTrips.length, reminders };
}
