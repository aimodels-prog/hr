import "@tanstack/react-start/server-only";
import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import { getDatabaseClient } from "../client.ts";
import { decryptSensitiveJson } from "../encryption.server.ts";
import {
  recruitmentMailboxes as mailboxes,
  recruitmentMailboxMessages as messages,
} from "../schema/recruitment-mailboxes.ts";
import { users, userRoles, roles } from "../schema/employee.ts";
import { vacancies } from "../schema/recruitment.ts";
import { uploadCandidateCvIntakeToDatabase } from "./candidate-cv-intake.repository.server.ts";
import {
  cvAttachments,
  gmailGet,
  mailboxCvId,
  recruitmentGmailAccessToken,
  type GmailPart,
} from "../../integrations/recruitment-gmail.server.ts";

/** A locked mailbox processes one small page. Separate workers cannot import it concurrently. */
export async function processRecruitmentMailbox(
  importCv: typeof uploadCandidateCvIntakeToDatabase = uploadCandidateCvIntakeToDatabase,
): Promise<boolean> {
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [mailbox] = await tx
      .select()
      .from(mailboxes)
      .where(and(eq(mailboxes.paused, false), lte(mailboxes.nextSyncAt, new Date())))
      .orderBy(mailboxes.nextSyncAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!mailbox) return false;
    try {
      const [owner] = await tx
        .select()
        .from(users)
        .where(
          and(
            eq(users.id, mailbox.connectedBy),
            eq(users.organisationId, mailbox.organisationId),
            eq(users.status, "Active"),
            isNull(users.archivedAt),
          ),
        );
      const [role] = await tx
        .select()
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(
          and(
            eq(userRoles.userId, mailbox.connectedBy),
            eq(userRoles.organisationId, mailbox.organisationId),
            inArray(roles.code, ["HR", "Super Admin"]),
          ),
        );
      if (!owner || !role || !mailbox.refreshTokenEncrypted) {
        await tx
          .update(mailboxes)
          .set({
            paused: true,
            lastError: "An active HR administrator must reconnect this mailbox.",
          })
          .where(eq(mailboxes.id, mailbox.id));
        return true;
      }
      const token = await recruitmentGmailAccessToken(
        decryptSensitiveJson<string>(mailbox.refreshTokenEncrypted),
      );
      // Re-scan the selected label after each complete pass. The ledger skips previously saved
      // messages, including messages labelled later whose original received date is old.
      const page = await gmailGet<{ messages?: { id: string }[]; nextPageToken?: string }>(
        token,
        "messages",
        {
          labelIds: mailbox.labelId,
          q: `after:${Math.floor(Date.parse(mailbox.sinceDate + "T00:00:00Z") / 1000) - 1} has:attachment`,
          maxResults: "5",
          ...(mailbox.pageToken ? { pageToken: mailbox.pageToken } : {}),
        },
      );
      let vacancyId: string | undefined;
      if (mailbox.vacancyId) {
        const [vacancy] = await tx
          .select({ id: vacancies.id })
          .from(vacancies)
          .where(
            and(
              eq(vacancies.id, mailbox.vacancyId),
              eq(vacancies.organisationId, mailbox.organisationId),
              eq(vacancies.status, "Open"),
            ),
          );
        vacancyId = vacancy?.id;
      }
      for (const message of page.messages ?? []) {
        const [previous] = await tx
          .select()
          .from(messages)
          .where(and(eq(messages.mailboxId, mailbox.id), eq(messages.messageId, message.id)));
        if (previous && (previous.status !== "Failed" || previous.attempts >= 3)) continue;
        let count = 0;
        let error: string | null = null;
        try {
          const mail = await gmailGet<{ payload?: GmailPart; internalDate?: string }>(
            token,
            `messages/${encodeURIComponent(message.id)}`,
            { format: "full" },
          );
          const parts = cvAttachments(mail.payload ?? {});
          for (let index = 0; index < parts.length; index++) {
            const part = parts[index]!;
            const maximum = Math.min(
              Number(process.env["VIA_HR_MAX_FILE_BYTES"] || 10 * 1024 * 1024),
              10 * 1024 * 1024,
            );
            if (!part.body?.size || part.body.size > maximum)
              throw new Error("Attachment is empty or too large. Upload the CV manually.");
            const body = part.body.attachmentId
              ? await gmailGet<{ data?: string }>(
                  token,
                  `messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(part.body.attachmentId)}`,
                )
              : part.body;
            if (!body.data || body.data.length > Math.ceil((maximum * 4) / 3) + 8)
              throw new Error("Attachment could not be downloaded safely.");
            const bytes = Buffer.from(body.data, "base64url");
            if (!bytes.length || bytes.length > maximum)
              throw new Error("Attachment is empty or too large.");
            const received = Number(mail.internalDate);
            await importCv(
              mailbox.organisationId,
              {
                intakeId: mailboxCvId(mailbox.id, message.id, part.partId ?? String(index)),
                fileName: (part.filename ?? "CV.pdf")
                  // Strip paths and control characters from email-provided filenames.
                  // eslint-disable-next-line no-control-regex
                  .replace(/[\\/\u0000-\u001f]/g, "_")
                  .slice(0, 255),
                mimeType: part.mimeType ?? "application/octet-stream",
                bytes,
                source: "Direct Email",
                receivedAt: new Date(
                  Number.isFinite(received) ? received : Date.now(),
                ).toISOString(),
                consentStatus: "Awaiting Confirmation",
                ...(vacancyId ? { vacancyId } : {}),
                notes: `Imported from ${mailbox.email}. HR must confirm candidate details and permission to retain the CV.`,
                isRecommended: false,
              },
              {
                userId: owner.id,
                employeeId: owner.employeeId,
                displayName: owner.displayName,
                activeRole: "HR",
                roles: ["HR"],
              },
            );
            count++;
          }
        } catch {
          // Provider responses, email body and tokens must never reach logs or the browser.
          error =
            "One or more attachments could not be imported. Check the original email or upload the CV manually, then retry.";
        }
        await tx
          .insert(messages)
          .values({
            mailboxId: mailbox.id,
            messageId: message.id,
            status: error ? "Failed" : count ? "Imported" : "No CV attachment",
            importedCount: count,
            attempts: (previous?.attempts ?? 0) + 1,
            error,
          })
          .onConflictDoUpdate({
            target: [messages.mailboxId, messages.messageId],
            set: {
              status: error ? "Failed" : count ? "Imported" : "No CV attachment",
              importedCount: count,
              attempts: (previous?.attempts ?? 0) + 1,
              error,
              updatedAt: new Date(),
            },
          });
      }
      await tx
        .update(mailboxes)
        .set({
          pageToken: page.nextPageToken ?? null,
          lastSyncAt: new Date(),
          lastError: null,
          nextSyncAt: new Date(Date.now() + (page.nextPageToken ? 5_000 : 5 * 60_000)),
        })
        .where(eq(mailboxes.id, mailbox.id));
    } catch {
      await tx
        .update(mailboxes)
        .set({
          pageToken: null,
          lastError: "Sync failed. Check the Google connection and label, then retry.",
          nextSyncAt: new Date(Date.now() + 5 * 60_000),
        })
        .where(eq(mailboxes.id, mailbox.id));
    }
    return true;
  });
}
