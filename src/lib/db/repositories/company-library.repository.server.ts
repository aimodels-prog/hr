import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { getDatabaseClient } from "../client.ts";
import { companyLibrary as docs } from "../schema/company-library.ts";
import { users, userRoles, roles } from "../schema/employee.ts";
import { notifications, auditEvents } from "../schema/system.ts";
import { decryptSensitiveJson, encryptSensitiveJson } from "../encryption.server.ts";
import { saveObjectFile, readObjectFile, deleteObjectFile } from "../object-storage.server.ts";
import {
  extractPolicyPdf,
  answerPolicyQuestion,
  Pages,
} from "../../integrations/policy-ai.server.ts";
import { selectPolicySources, type PolicySource } from "../../data/policy-answers.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

export function libraryHr(actor: AuditActorContext) {
  return ["HR", "Super Admin"].includes(actor.activeRole ?? "");
}
function requireHr(actor: AuditActorContext) {
  if (!libraryHr(actor) || !actor.userId) throw new Error("Only HR can manage company documents.");
}
async function audit(org: string, actor: AuditActorContext, id: string, action: string) {
  await getDatabaseClient()
    .insert(auditEvents)
    .values({
      organisationId: org,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action,
      module: "documents",
      entityType: "company-library",
      entityId: id,
      reason: action,
      riskLevel: "Medium",
    });
}
export async function libraryList(org: string, actor: AuditActorContext) {
  const rows = await getDatabaseClient()
    .select({
      id: docs.id,
      familyId: docs.familyId,
      version: docs.version,
      title: docs.title,
      category: docs.category,
      kind: docs.kind,
      audience: docs.audience,
      status: docs.status,
      processing: docs.processing,
      issueDate: docs.issueDate,
      expiryDate: docs.expiryDate,
    })
    .from(docs)
    .where(
      and(
        eq(docs.organisationId, org),
        ...(libraryHr(actor)
          ? []
          : [
              eq(docs.kind, "Library"),
              eq(docs.audience, "All staff"),
              eq(docs.status, "Published"),
            ]),
      ),
    )
    .orderBy(desc(docs.createdAt));
  return rows;
}
async function accessible(org: string, id: string, actor: AuditActorContext) {
  const [doc] = await getDatabaseClient()
    .select()
    .from(docs)
    .where(and(eq(docs.organisationId, org), eq(docs.id, id)))
    .limit(1);
  if (
    !doc ||
    (!libraryHr(actor) &&
      (doc.kind !== "Library" || doc.audience !== "All staff" || doc.status !== "Published"))
  )
    throw new Error("This document is not available to you.");
  return doc;
}
export async function libraryDownload(org: string, id: string, actor: AuditActorContext) {
  const doc = await accessible(org, id, actor);
  return readObjectFile(org, doc.fileId, actor, `Downloaded ${doc.title} version ${doc.version}`);
}
export async function libraryUpload(
  org: string,
  input: {
    title: string;
    category: string;
    kind: "Library" | "Company";
    audience: "All staff" | "HR only";
    familyId?: string | undefined;
    issueDate?: string | undefined;
    expiryDate?: string | undefined;
    name: string;
    bytes: Uint8Array;
  },
  actor: AuditActorContext,
) {
  requireHr(actor);
  if (input.expiryDate && input.issueDate && input.expiryDate < input.issueDate)
    throw new Error("Expiry must not precede issue date.");
  if (Buffer.from(input.bytes.subarray(0, 5)).toString() !== "%PDF-")
    throw new Error("Upload a valid PDF.");
  const familyId = input.familyId || randomUUID();
  const id = randomUUID();
  const file = await saveObjectFile({
    organisationId: org,
    bytes: input.bytes,
    name: input.name,
    mimeType: "application/pdf",
    owner: { entityType: "company-library", entityId: id },
    actor,
  });
  try {
    await getDatabaseClient().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${org + familyId}))`);
      const previous = await tx
        .select()
        .from(docs)
        .where(and(eq(docs.organisationId, org), eq(docs.familyId, familyId)))
        .orderBy(desc(docs.version))
        .limit(1);
      if (input.familyId && (!previous[0] || previous[0].kind !== input.kind))
        throw new Error("Choose an existing document of the same kind.");
      await tx.insert(docs).values({
        id,
        organisationId: org,
        familyId,
        version: (previous[0]?.version ?? 0) + 1,
        title: input.title,
        category: input.category,
        kind: input.kind,
        audience: input.kind === "Company" ? "HR only" : input.audience,
        issueDate: input.issueDate,
        expiryDate: input.expiryDate,
        fileId: file.id,
        createdBy: actor.userId!,
        updatedBy: actor.userId!,
      });
      await tx.insert(auditEvents).values({
        organisationId: org,
        actorUserId: actor.userId,
        actorEmployeeId: actor.employeeId,
        actorDisplayName: actor.displayName,
        activeRole: actor.activeRole,
        actorRoles: actor.roles ?? [],
        action: "company-document-uploaded",
        module: "documents",
        entityType: "company-library",
        entityId: id,
        reason: "Uploaded draft document",
        riskLevel: "Medium",
      });
    });
    return id;
  } catch (error) {
    await deleteObjectFile(org, file.id, actor, "Removed file after draft creation failed").catch(
      () => undefined,
    );
    throw error;
  }
}
export async function libraryPrepare(org: string, id: string, actor: AuditActorContext) {
  requireHr(actor);
  const doc = await accessible(org, id, actor);
  if (doc.kind !== "Library" || doc.status !== "Draft")
    throw new Error("Only draft policies can be prepared for AI.");
  const claimed = await getDatabaseClient()
    .update(docs)
    .set({ processing: "Preparing", updatedAt: new Date() })
    .where(
      and(
        eq(docs.id, id),
        eq(docs.status, "Draft"),
        sql`(${docs.processing} <> 'Preparing' OR ${docs.updatedAt} < now()-interval '2 minutes')`,
      ),
    )
    .returning({ id: docs.id });
  if (!claimed.length) throw new Error("This document is already being prepared. Please wait.");
  try {
    const file = await libraryDownload(org, id, actor);
    const pages = await extractPolicyPdf(file.bytes);
    await getDatabaseClient()
      .update(docs)
      .set({
        encryptedPages: encryptSensitiveJson(pages),
        processing: "Needs HR review",
        updatedAt: new Date(),
        updatedBy: actor.userId!,
      })
      .where(and(eq(docs.id, id), eq(docs.status, "Draft")));
    return pages;
  } catch {
    await getDatabaseClient()
      .update(docs)
      .set({ processing: "Preparation failed" })
      .where(and(eq(docs.id, id), eq(docs.status, "Draft")));
    throw new Error(
      "AI preparation failed. Check the AI configuration or upload a clearer PDF. The original document is safe.",
    );
  }
}
export async function libraryPages(org: string, id: string, actor: AuditActorContext) {
  requireHr(actor);
  const doc = await accessible(org, id, actor);
  return doc.encryptedPages ? Pages.parse(decryptSensitiveJson(doc.encryptedPages)) : [];
}
export async function libraryPublish(
  org: string,
  id: string,
  actor: AuditActorContext,
  pages?: { page: number; text: string }[],
) {
  requireHr(actor);
  await getDatabaseClient().transaction(async (tx) => {
    const doc = await accessible(org, id, actor);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${org + doc.familyId}))`);
    const [current] = await tx.select().from(docs).where(eq(docs.id, id)).for("update");
    if (current?.status !== "Draft") throw new Error("Only drafts can be published.");
    if (
      doc.kind === "Library" &&
      (!pages ||
        !pages.some((page) => page.text.trim().length > 30) ||
        new Set(pages.map((page) => page.page)).size !== pages.length)
    )
      throw new Error("Review and confirm readable page text first.");
    await tx
      .update(docs)
      .set({ status: "Superseded", updatedAt: new Date(), updatedBy: actor.userId! })
      .where(
        and(
          eq(docs.organisationId, org),
          eq(docs.familyId, doc.familyId),
          eq(docs.status, "Published"),
        ),
      );
    await tx
      .update(docs)
      .set({
        status: "Published",
        processing: doc.kind === "Library" ? "Ready" : "Not applicable",
        ...(pages && doc.kind === "Library" ? { encryptedPages: encryptSensitiveJson(pages) } : {}),
        updatedAt: new Date(),
        updatedBy: actor.userId!,
      })
      .where(eq(docs.id, id));
    await tx.insert(auditEvents).values({
      organisationId: org,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: "company-document-published",
      module: "documents",
      entityType: "company-library",
      entityId: id,
      reason: "HR reviewed and published this version",
      riskLevel: "Medium",
    });
  });
}
export async function libraryWithdraw(org: string, id: string, actor: AuditActorContext) {
  requireHr(actor);
  await accessible(org, id, actor);
  await getDatabaseClient()
    .update(docs)
    .set({ status: "Withdrawn", updatedAt: new Date(), updatedBy: actor.userId! })
    .where(and(eq(docs.id, id), eq(docs.organisationId, org)));
  await audit(org, actor, id, "company-document-withdrawn");
}
export async function libraryAsk(org: string, question: string, actor: AuditActorContext) {
  const db = getDatabaseClient();
  // A database-backed rate limit avoids unbounded AI spend across server instances.
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${org + actor.userId + "policy-chat"}))`,
    );
    const count = await tx.execute(
      sql`SELECT count(*)::int AS count FROM ${auditEvents} WHERE ${auditEvents.organisationId}=${org} AND ${auditEvents.actorUserId}=${actor.userId} AND ${auditEvents.action}='policy-question' AND ${auditEvents.occurredAt} > now()-interval '1 minute'`,
    );
    if (Number(count[0]?.["count"]) >= 5)
      throw new Error("Please wait a minute before asking another question.");
    await tx.insert(auditEvents).values({
      organisationId: org,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: "policy-question",
      module: "documents",
      entityType: "company-library",
      entityId: org,
      reason: "Asked policy library a question; question text is not logged",
      riskLevel: "Low",
    });
  });
  const rows = await db
    .select()
    .from(docs)
    .where(
      and(
        eq(docs.organisationId, org),
        eq(docs.kind, "Library"),
        eq(docs.status, "Published"),
        eq(docs.processing, "Ready"),
        ...(libraryHr(actor) ? [] : [eq(docs.audience, "All staff")]),
      ),
    );
  const sources: PolicySource[] = rows.flatMap((row) =>
    row.encryptedPages
      ? Pages.parse(decryptSensitiveJson(row.encryptedPages)).map((page) => ({
          id: row.id,
          title: row.title,
          version: row.version,
          ...page,
        }))
      : [],
  );
  const selected = selectPolicySources(question, sources);
  const answers = await answerPolicyQuestion(question, selected);
  // Re-check visibility after the model call, in case HR withdrew/replaced a policy meanwhile.
  const visible = await libraryList(org, actor);
  if (
    answers.some(
      (answer) =>
        !visible.some((doc) => doc.id === answer.documentId && doc.status === "Published"),
    )
  )
    return { answers: [], sources: [] };
  return {
    answers,
    sources: selected
      .filter((source) =>
        answers.some((answer) => answer.documentId === source.id && answer.page === source.page),
      )
      .map(({ text: _text, ...source }) => source),
  };
}
export async function processCompanyDocumentReminders(now = new Date()) {
  const db = getDatabaseClient();
  const rows = await db
    .select()
    .from(docs)
    .where(
      and(
        eq(docs.kind, "Company"),
        eq(docs.status, "Published"),
        sql`${docs.expiryDate} IS NOT NULL`,
      ),
    );
  let sent = 0;
  for (const doc of rows) {
    const days = Math.ceil(
      (new Date(`${doc.expiryDate}T00:00:00Z`).getTime() -
        new Date(now.toISOString().slice(0, 10) + "T00:00:00Z").getTime()) /
        86400000,
    );
    if (days > 90) continue;
    const threshold = days <= 0 ? 0 : days <= 7 ? 7 : days <= 30 ? 30 : days <= 60 ? 60 : 90;
    const recipients = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(
        userRoles,
        and(eq(userRoles.userId, users.id), eq(userRoles.organisationId, doc.organisationId)),
      )
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(
          eq(users.organisationId, doc.organisationId),
          eq(users.status, "Active"),
          inArray(roles.code, ["HR", "Super Admin"]),
        ),
      );
    for (const recipient of recipients) {
      const inserted = await db
        .insert(notifications)
        .values({
          organisationId: doc.organisationId,
          recipientUserId: recipient.id,
          type: "company_document_expiry",
          title:
            days < 0
              ? "Company document expired"
              : days === 0
                ? "Company document expires today"
                : "Company document renewal due",
          message: `${doc.title} expires ${doc.expiryDate}. Please arrange renewal.`,
          priority: days <= 7 ? "High" : "Normal",
          status: "Unread",
          createdBy: doc.updatedBy,
          updatedBy: doc.updatedBy,
          deduplicationKey: `company-expiry-${doc.id}-${doc.expiryDate}-${threshold}-${recipient.id}`,
          link: { entityType: "company-library", entityId: doc.id, path: "/staff/company-library" },
        })
        .onConflictDoNothing()
        .returning({ id: notifications.id });
      sent += inserted.length;
    }
  }
  return { sent };
}
