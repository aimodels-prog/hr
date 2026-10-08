import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";
import { getDatabaseClient } from "../client.ts";
import { decryptSensitiveJson } from "../encryption.server.ts";
import { calendarAccessToken } from "../../integrations/google-calendar.server.ts";
import { missingClockoutEmailDate } from "./missing-clockout.repository.server.ts";
import { dependantCompletionStillMissing } from "./dependant-reminder.repository.server.ts";
import {
  sendWorkflowEmail,
  WorkflowEmailError,
  type WorkflowEmailContext,
} from "../../integrations/workflow-email.server.ts";
import { workflowEmailRecipientPolicy } from "./workflow-email-policy.server.ts";
import { emailDigestTopic } from "../../data/email-digest.ts";

/** Only notifications created after email permission was granted enter the outbox. */
export async function enqueueWorkflowEmails() {
  const rows = await getDatabaseClient()
    .execute(sql`INSERT INTO workflow_notification_emails(notification_id,organisation_id)
    SELECT n.id,n.organisation_id FROM notifications n
    JOIN google_calendar_connections c ON c.organisation_id=n.organisation_id AND c.email_enabled_at IS NOT NULL
    JOIN users u ON u.id=n.recipient_user_id AND u.organisation_id=n.organisation_id AND u.status='Active' AND u.archived_at IS NULL
    WHERE n.archived_at IS NULL AND n.status<>'Dismissed' AND n.created_at>=c.email_enabled_at
      AND ${workflowEmailRecipientPolicy()}
      AND n.type NOT IN ('attendance.sign_out','attendance.sign_out_reminder')
      AND (n.type='workflow.request_update' OR NOT EXISTS (
        SELECT 1 FROM notifications receipt WHERE receipt.type='workflow.request_update'
        AND receipt.organisation_id=n.organisation_id AND receipt.recipient_user_id=n.recipient_user_id
        AND receipt.link->>'entityId'=n.link->>'entityId' AND receipt.created_at=n.created_at))
    ON CONFLICT(notification_id) DO NOTHING RETURNING notification_id`);
  return rows.length;
}

/** Short transaction only: never hold database locks while calling Google. */
export async function claimDailyEmailDigest(at = new Date()) {
  return getDatabaseClient().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('workflow-daily-email-claim'))`);
    const rows =
      await tx.execute(sql`SELECT q.notification_id,n.organisation_id,n.recipient_user_id,n.type,n.link,
      ((${at.toISOString()}::timestamptz AT TIME ZONE s.timezone)::date)::text AS delivery_day,
      EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id
        WHERE ur.user_id=u.id AND ur.organisation_id=n.organisation_id AND r.code='HR') AS is_hr
      FROM workflow_notification_emails q JOIN notifications n ON n.id=q.notification_id
      JOIN users u ON u.id=n.recipient_user_id AND u.organisation_id=n.organisation_id
      JOIN app_settings s ON s.organisation_id=n.organisation_id
      JOIN google_calendar_connections c ON c.organisation_id=n.organisation_id AND c.email_enabled_at IS NOT NULL
      WHERE q.status IN ('Queued','Blocked') AND q.attempts<5 AND q.next_attempt_at<=${at.toISOString()}::timestamptz
        AND u.status='Active' AND u.archived_at IS NULL AND n.archived_at IS NULL AND n.status<>'Dismissed'
        AND ${workflowEmailRecipientPolicy()}
        AND (${at.toISOString()}::timestamptz AT TIME ZONE s.timezone)::time >=
          coalesce(s.additional_settings->'reminderRules'->>'dailyEmailTime','10:00')::time
      ORDER BY n.created_at,n.id FOR UPDATE OF q`);
    const groups = new Map<
      string,
      { org: string; recipient: string; day: string; topic: string; ids: string[] }
    >();
    for (const row of rows) {
      const org = String(row["organisation_id"]);
      const recipient = String(row["recipient_user_id"]);
      const day = String(row["delivery_day"]);
      const topic = emailDigestTopic(
        row["is_hr"] === true,
        String(row["type"]),
        (row["link"] as { entityType?: string } | null)?.entityType,
      );
      const key = JSON.stringify([org, recipient, day, topic]);
      const group = groups.get(key) ?? { org, recipient, day, topic, ids: [] };
      group.ids.push(String(row["notification_id"]));
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      let [digest] =
        await tx.execute(sql`INSERT INTO workflow_email_digests(organisation_id,recipient_user_id,delivery_day,topic)
        VALUES(${group.org}::uuid,${group.recipient}::uuid,${group.day}::date,${group.topic})
        ON CONFLICT DO NOTHING RETURNING id`);
      if (!digest) {
        // Retry only a confirmed non-delivery. A sent, in-flight or uncertain digest
        // permanently occupies today's slot, including when new alerts arrive.
        [digest] = await tx.execute(sql`SELECT d.id FROM workflow_email_digests d
          WHERE d.organisation_id=${group.org}::uuid AND d.recipient_user_id=${group.recipient}::uuid
            AND d.delivery_day=${group.day}::date AND d.topic=${group.topic}
            AND EXISTS(SELECT 1 FROM workflow_notification_emails q WHERE q.digest_id=d.id
              AND q.status IN ('Queued','Blocked') AND q.attempts<5 AND q.next_attempt_at<=${at.toISOString()}::timestamptz)
            AND NOT EXISTS(SELECT 1 FROM workflow_notification_emails q WHERE q.digest_id=d.id
              AND q.status IN ('Sending','Sent','Uncertain','Failed'))`);
      }
      if (!digest) continue;
      const id = String(digest["id"]);
      await tx.execute(sql`UPDATE workflow_notification_emails SET digest_id=${id}::uuid,status='Sending',attempts=attempts+1,updated_at=now()
        WHERE notification_id IN (${sql.join(
          group.ids.map((item) => sql`${item}::uuid`),
          sql`,`,
        )})`);
      return { ...group, id };
    }
    return null;
  });
}

export async function processWorkflowEmails() {
  const db = getDatabaseClient();
  const queued = await enqueueWorkflowEmails();
  // Never automatically resend when Google may have accepted a message before a crash.
  await db.execute(sql`UPDATE workflow_notification_emails SET status='Uncertain',last_error='The sending worker stopped before acknowledgement. Check Sent mail before resending.',updated_at=now()
    WHERE status='Sending' AND updated_at<now()-interval '10 minutes'`);
  let sent = 0;
  for (let index = 0; index < 10; index++) {
    const digest = await claimDailyEmailDigest();
    if (!digest) break;
    try {
      const rows =
        await db.execute(sql`SELECT n.id,n.type,n.title,n.message,n.link,u.workspace_email,c.refresh_token_encrypted,c.account_email
        FROM workflow_notification_emails q JOIN notifications n ON n.id=q.notification_id
        JOIN users u ON u.id=n.recipient_user_id AND u.organisation_id=n.organisation_id AND u.status='Active' AND u.archived_at IS NULL
        JOIN google_calendar_connections c ON c.organisation_id=n.organisation_id AND c.email_enabled_at IS NOT NULL
        WHERE q.digest_id=${digest.id}::uuid AND q.status='Sending' AND n.archived_at IS NULL AND n.status<>'Dismissed'
          AND ${workflowEmailRecipientPolicy()} ORDER BY n.created_at,n.id`);
      const items: NonNullable<WorkflowEmailContext["items"]> = [];
      const eligibleIds: string[] = [];
      for (const row of rows) {
        const id = String(row["id"]);
        const type = String(row["type"]);
        if (["attendance.sign_out", "attendance.sign_out_reminder"].includes(type)) continue;
        if (
          type === "dependants.missing_information_reminder" &&
          !(await dependantCompletionStillMissing(digest.org, digest.recipient))
        )
          continue;
        const date =
          type === "attendance.missing_clockout_reminder"
            ? await missingClockoutEmailDate(id)
            : null;
        if (type === "attendance.missing_clockout_reminder" && !date) continue;
        eligibleIds.push(id);
        items.push({
          title: String(row["title"]),
          message: String(row["message"]),
          path: date
            ? `/staff/me/attendance?correct=${date}`
            : (row["link"] as { path?: string } | null)?.path,
        });
      }
      await db.execute(sql`UPDATE workflow_notification_emails SET status='Skipped',last_error='No longer applicable or authorised.',updated_at=now()
        WHERE digest_id=${digest.id}::uuid ${
          eligibleIds.length
            ? sql`AND notification_id NOT IN (${sql.join(
                eligibleIds.map((id) => sql`${id}::uuid`),
                sql`,`,
              )})`
            : sql``
        }`);
      const recipient = rows[0];
      if (!items.length || !recipient) continue;
      let token: string;
      try {
        token = await calendarAccessToken(
          decryptSensitiveJson<string>(String(recipient["refresh_token_encrypted"])),
        );
      } catch {
        throw new WorkflowEmailError(
          "Blocked",
          "The Google sender connection needs review or reconnection. The summary will be retried after the connection is restored.",
        );
      }
      const reference = await sendWorkflowEmail(
        token,
        String(recipient["workspace_email"]),
        digest.id,
        String(recipient["account_email"]),
        undefined,
        {
          title: digest.topic,
          message: `${items.length} update${items.length === 1 ? "" : "s"} in your daily summary. Open an item to see its current status and any action needed.`,
          path: "/staff/my-tasks",
          items,
        },
      );
      await db.execute(sql`UPDATE workflow_notification_emails SET status='Sent',provider_message_id=${reference},sent_at=now(),last_error=NULL,updated_at=now()
        WHERE digest_id=${digest.id}::uuid AND status='Sending'`);
      sent++;
    } catch (error) {
      const outcome = error instanceof WorkflowEmailError ? error.outcome : "Uncertain";
      const message =
        error instanceof WorkflowEmailError
          ? error.message
          : "The send outcome needs review. It will not be resent automatically.";
      await db.execute(sql`UPDATE workflow_notification_emails SET status=CASE WHEN attempts>=5 AND ${outcome} IN ('Queued','Blocked') THEN 'Failed' ELSE ${outcome} END,
        last_error=${message},next_attempt_at=now()+interval '15 minutes',updated_at=now()
        WHERE digest_id=${digest.id}::uuid AND status='Sending'`);
    }
  }
  return { queued, sent };
}
