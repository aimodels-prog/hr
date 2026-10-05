import "@tanstack/react-start/server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, lt } from "drizzle-orm";
import { z } from "zod";
import { getPortalPrincipalForRequest } from "../auth/portal-auth-http.server.ts";
import { getDatabaseClient } from "../db/client.ts";
import { encryptSensitiveJson, decryptSensitiveJson } from "../db/encryption.server.ts";
import {
  recruitmentMailboxes as boxes,
  recruitmentMailboxStates as states,
  recruitmentMailboxMessages as messages,
} from "../db/schema/recruitment-mailboxes.ts";
import { vacancies } from "../db/schema/recruitment.ts";
import { auditEvents } from "../db/schema/system.ts";
import { googleAuthorisationPage } from "./google-authorisation-page.ts";
import {
  exchangeRecruitmentGmailCode,
  gmailGet,
  recruitmentGmailAccessToken,
  recruitmentGmailAuthorisation,
  recruitmentGmailConfig,
} from "./recruitment-gmail.server.ts";

const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer" };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const configSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  labelId: z.string().trim().min(1).max(200),
  sinceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((v) => !Number.isNaN(Date.parse(v))),
  vacancyId: z.string().uuid().nullable().optional(),
});

export async function resolveRecruitmentMailboxRequest(
  request: Request,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const callback = url.pathname === "/auth/recruitment-email/callback";
  if (!callback && url.pathname !== "/api/integrations/recruitment-mailboxes") return undefined;
  const redirect = (result: string) =>
    new Response(null, {
      status: 303,
      headers: { ...headers, location: `/staff/candidates/intake?mailbox=${result}` },
    });
  try {
    const principal = await getPortalPrincipalForRequest(request);
    if (!principal)
      return callback
        ? redirect("session-expired")
        : Response.json({ error: "Sign in again." }, { status: 401, headers });
    if (!principal.user.roles.some((r) => r === "HR" || r === "Super Admin"))
      return Response.json(
        { error: "Only HR can manage recruitment mailboxes." },
        { status: 403, headers },
      );
    const db = getDatabaseClient();
    const org = principal.organisationId;
    const audit = async (id: string, action: string) => {
      await db.insert(auditEvents).values({
        organisationId: org,
        actorUserId: principal.user.id,
        actorEmployeeId: principal.employee.id,
        actorDisplayName: principal.user.displayName,
        activeRole: principal.user.roles.includes("HR") ? "HR" : "Super Admin",
        actorRoles: principal.user.roles,
        action,
        module: "recruitment",
        entityType: "recruitment-mailbox",
        entityId: id,
        afterSummary: { operation: action },
        reason: "HR managed a recruitment mailbox",
        riskLevel: "Medium",
      });
    };
    if (callback) {
      if (request.method !== "GET") return new Response(null, { status: 405 });
      const state = url.searchParams.get("state") ?? "";
      if (!/^[A-Za-z0-9_-]{43}$/.test(state)) return redirect("connection-failed");
      const [pending] = await db
        .delete(states)
        .where(
          and(
            eq(states.stateHash, digest(state)),
            eq(states.userId, principal.user.id),
            eq(states.sessionId, principal.sessionId),
            gt(states.expiresAt, new Date()),
          ),
        )
        .returning();
      if (!pending || url.searchParams.has("error")) return redirect("connection-failed");
      const code = url.searchParams.get("code");
      if (!code || code.length > 8192) return redirect("connection-failed");
      const [mailbox] = await db
        .select()
        .from(boxes)
        .where(and(eq(boxes.id, pending.mailboxId), eq(boxes.organisationId, org)));
      if (!mailbox) return redirect("connection-failed");
      const token = await exchangeRecruitmentGmailCode(
        code,
        decryptSensitiveJson<string>(pending.verifierEncrypted),
        mailbox.email,
      );
      await db
        .update(boxes)
        .set({
          refreshTokenEncrypted: encryptSensitiveJson(token),
          connectedBy: principal.user.id,
          paused: true,
          lastError: null,
        })
        .where(and(eq(boxes.id, mailbox.id), eq(boxes.organisationId, org)));
      await audit(mailbox.id, "connect");
      return redirect("connected");
    }
    if (request.method === "GET" && !url.searchParams.has("id")) {
      let configured = false;
      try {
        recruitmentGmailConfig();
        configured = true;
      } catch {
        /* No secrets returned. */
      }
      const records = await db
        .select({
          id: boxes.id,
          email: boxes.email,
          labelId: boxes.labelId,
          sinceDate: boxes.sinceDate,
          vacancyId: boxes.vacancyId,
          paused: boxes.paused,
          lastSyncAt: boxes.lastSyncAt,
          lastError: boxes.lastError,
        })
        .from(boxes)
        .where(eq(boxes.organisationId, org))
        .orderBy(boxes.email);
      const statuses = await db
        .select({ id: boxes.id, token: boxes.refreshTokenEncrypted })
        .from(boxes)
        .where(eq(boxes.organisationId, org));
      const recent = await db
        .select({
          id: messages.id,
          mailboxId: messages.mailboxId,
          status: messages.status,
          importedCount: messages.importedCount,
          error: messages.error,
          updatedAt: messages.updatedAt,
        })
        .from(messages)
        .innerJoin(boxes, eq(boxes.id, messages.mailboxId))
        .where(eq(boxes.organisationId, org))
        .orderBy(desc(messages.updatedAt))
        .limit(50);
      return Response.json(
        {
          configured,
          mailboxes: records.map((r) => ({
            ...r,
            connected: !!statuses.find((s) => s.id === r.id)?.token,
          })),
          recent,
        },
        { headers },
      );
    }
    if (request.method !== "GET") {
      const origin = process.env["APP_ORIGIN"];
      if (!origin || request.headers.get("origin") !== new URL(origin).origin)
        return Response.json({ error: "Invalid request origin." }, { status: 403, headers });
    }
    const action = url.searchParams.get("action");
    if (request.method === "POST" && action === "add") {
      const input = configSchema.parse(await request.json());
      if (input.vacancyId) {
        const [vacancy] = await db
          .select({ id: vacancies.id })
          .from(vacancies)
          .where(
            and(
              eq(vacancies.id, input.vacancyId),
              eq(vacancies.organisationId, org),
              eq(vacancies.status, "Open"),
            ),
          );
        if (!vacancy)
          return Response.json({ error: "Choose an open vacancy." }, { status: 400, headers });
      }
      const [created] = await db
        .insert(boxes)
        .values({ organisationId: org, connectedBy: principal.user.id, ...input })
        .onConflictDoNothing()
        .returning({ id: boxes.id });
      if (created) await audit(created.id, "create");
      return Response.json(created ?? { error: "This mailbox is already added." }, {
        status: created ? 201 : 409,
        headers,
      });
    }
    const id = z.string().uuid().parse(url.searchParams.get("id"));
    const [mailbox] = await db
      .select()
      .from(boxes)
      .where(and(eq(boxes.id, id), eq(boxes.organisationId, org)));
    if (!mailbox) return Response.json({ error: "Mailbox not found." }, { status: 404, headers });
    if (request.method === "GET" && action === "labels") {
      if (!mailbox.refreshTokenEncrypted)
        return Response.json({ error: "Connect the mailbox first." }, { status: 409, headers });
      const token = await recruitmentGmailAccessToken(
        decryptSensitiveJson<string>(mailbox.refreshTokenEncrypted),
      );
      const result = await gmailGet<{ labels?: { id: string; name: string }[] }>(token, "labels");
      return Response.json({ labels: result.labels ?? [] }, { headers });
    }
    if (request.method !== "POST") return new Response(null, { status: 405 });
    if (action === "connect") {
      const state = randomBytes(32).toString("base64url");
      const verifier = randomBytes(32).toString("base64url");
      const target = recruitmentGmailAuthorisation(state, verifier, mailbox.email);
      await db.delete(states).where(lt(states.expiresAt, new Date()));
      await db.insert(states).values({
        stateHash: digest(state),
        mailboxId: id,
        userId: principal.user.id,
        sessionId: principal.sessionId,
        verifierEncrypted: encryptSensitiveJson(verifier),
        expiresAt: new Date(Date.now() + 10 * 60_000),
      });
      return googleAuthorisationPage(target);
    }
    if (action === "settings") {
      const input = configSchema.parse({ ...(await request.json()), email: mailbox.email });
      if (input.vacancyId) {
        const [vacancy] = await db
          .select({ id: vacancies.id })
          .from(vacancies)
          .where(
            and(
              eq(vacancies.id, input.vacancyId),
              eq(vacancies.organisationId, org),
              eq(vacancies.status, "Open"),
            ),
          );
        if (!vacancy)
          return Response.json({ error: "Choose an open vacancy." }, { status: 400, headers });
      }
      if (!mailbox.refreshTokenEncrypted)
        return Response.json({ error: "Connect the mailbox first." }, { status: 409, headers });
      const token = await recruitmentGmailAccessToken(
        decryptSensitiveJson<string>(mailbox.refreshTokenEncrypted),
      );
      await gmailGet(token, `labels/${encodeURIComponent(input.labelId)}`);
      await db
        .update(boxes)
        .set({
          labelId: input.labelId,
          sinceDate: input.sinceDate,
          vacancyId: input.vacancyId ?? null,
          pageToken: null,
          nextSyncAt: new Date(),
        })
        .where(eq(boxes.id, id));
    } else if (action === "disconnect") {
      // Remove only this app's saved credential; revoking a shared Google grant could break Calendar.
      await db.transaction(async (tx) => {
        await tx.delete(states).where(eq(states.mailboxId, id));
        await tx
          .update(boxes)
          .set({ paused: true, refreshTokenEncrypted: null, pageToken: null })
          .where(eq(boxes.id, id));
      });
    } else if (action === "pause") {
      await db.update(boxes).set({ paused: true }).where(eq(boxes.id, id));
    } else if (action === "resume" || action === "retry") {
      if (!mailbox.refreshTokenEncrypted)
        return Response.json({ error: "Connect the mailbox first." }, { status: 409, headers });
      if (action === "retry")
        await db
          .update(messages)
          .set({ attempts: 0 })
          .where(and(eq(messages.mailboxId, id), eq(messages.status, "Failed")));
      await db
        .update(boxes)
        .set({ paused: false, nextSyncAt: new Date(), pageToken: null })
        .where(eq(boxes.id, id));
    } else return Response.json({ error: "Unknown action." }, { status: 400, headers });
    await audit(id, action!);
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    if (callback) return redirect("connection-failed");
    return Response.json(
      {
        error:
          error instanceof z.ZodError
            ? "Check the email, date and selected label."
            : "Mailbox operation failed. Check Google setup and try again.",
      },
      { status: 400, headers },
    );
  }
}
