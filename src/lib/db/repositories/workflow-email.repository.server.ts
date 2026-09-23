import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";
import { getDatabaseClient } from "../client.ts";
import { decryptSensitiveJson } from "../encryption.server.ts";
import { calendarAccessToken } from "../../integrations/google-calendar.server.ts";
import { sendWorkflowEmail, WorkflowEmailError } from "../../integrations/workflow-email.server.ts";

/** Mirrors durable workflow notifications; does not send historic backlog on first connection. */
export async function enqueueWorkflowEmails() {
  const db = getDatabaseClient();
  const rows =
    await db.execute(sql`INSERT INTO workflow_notification_emails(notification_id,organisation_id)
    SELECT n.id,n.organisation_id FROM notifications n
    JOIN google_calendar_connections c ON c.organisation_id=n.organisation_id AND c.email_enabled_at IS NOT NULL
    JOIN users u ON u.id=n.recipient_user_id AND u.organisation_id=n.organisation_id AND u.status='Active' AND u.archived_at IS NULL
    WHERE n.archived_at IS NULL AND n.created_at>=c.email_enabled_at
      AND (n.type='workflow.request_update' OR NOT EXISTS (
        SELECT 1 FROM notifications receipt WHERE receipt.type='workflow.request_update'
        AND receipt.organisation_id=n.organisation_id AND receipt.recipient_user_id=n.recipient_user_id
        AND receipt.link->>'entityId'=n.link->>'entityId' AND receipt.created_at=n.created_at))
      AND (n.type ~* 'request|approv|reject|return|declin|reminder|decision|submit|cancel|withdraw'
        OR n.link->>'entityType' IN ('leave-request','timesheet','overtime-claim','attendance-correction','site-visit-request','travel-request','training-request','profile-change-request','employee-goal','performance-review','offer','candidate-recommendation','employee-document','onboarding-task','offboarding-task'))
    ON CONFLICT(notification_id) DO NOTHING RETURNING notification_id`);
  return rows.length;
}
export async function processWorkflowEmails() {
  const db = getDatabaseClient();
  const queued = await enqueueWorkflowEmails();
  // A crashed process may have sent its message already. Never blindly re-send an uncertain send.
  await db.execute(
    sql`UPDATE workflow_notification_emails SET status='Uncertain',last_error='The sending worker stopped before acknowledgement. Check Sent mail before resending.',updated_at=now() WHERE status='Sending' AND updated_at<now()-interval '10 minutes'`,
  );
  let sent = 0;
  for (let index = 0; index < 10; index++) {
    const [claimed] = await db.execute(sql`WITH candidate AS (
      SELECT q.notification_id FROM workflow_notification_emails q
      JOIN google_calendar_connections c ON c.organisation_id=q.organisation_id AND c.email_enabled_at IS NOT NULL
      WHERE q.status IN ('Queued','Blocked') AND q.next_attempt_at<=now() AND q.attempts<5
      ORDER BY q.next_attempt_at,q.notification_id FOR UPDATE OF q SKIP LOCKED LIMIT 1
    ) UPDATE workflow_notification_emails q SET status='Sending',attempts=q.attempts+1,updated_at=now()
      FROM candidate WHERE q.notification_id=candidate.notification_id RETURNING q.notification_id,q.organisation_id,q.attempts`);
    if (!claimed) break;
    const id = String(claimed["notification_id"]);
    const org = String(claimed["organisation_id"]);
    try {
      const [recipient] =
        await db.execute(sql`SELECT u.workspace_email,c.refresh_token_encrypted FROM notifications n
        JOIN users u ON u.id=n.recipient_user_id AND u.organisation_id=n.organisation_id AND u.status='Active' AND u.archived_at IS NULL
        JOIN google_calendar_connections c ON c.organisation_id=n.organisation_id AND c.email_enabled_at IS NOT NULL
        WHERE n.id=${id}::uuid AND n.organisation_id=${org}::uuid AND n.archived_at IS NULL`);
      if (!recipient) {
        await db.execute(
          sql`UPDATE workflow_notification_emails SET status='Skipped',last_error='Recipient or authorised sender is no longer available.',updated_at=now() WHERE notification_id=${id}::uuid`,
        );
        continue;
      }
      let token: string;
      try {
        token = await calendarAccessToken(
          decryptSensitiveJson<string>(String(recipient["refresh_token_encrypted"])),
        );
      } catch {
        throw new WorkflowEmailError(
          "Blocked",
          "The Google sender connection needs administrator review or reconnection.",
        );
      }
      const reference = await sendWorkflowEmail(token, String(recipient["workspace_email"]), id);
      await db.execute(
        sql`UPDATE workflow_notification_emails SET status='Sent',provider_message_id=${reference},sent_at=now(),last_error=NULL,updated_at=now() WHERE notification_id=${id}::uuid`,
      );
      sent++;
    } catch (error) {
      // Unexpected exceptions can include a successful send followed by a database failure.
      const initialOutcome = error instanceof WorkflowEmailError ? error.outcome : "Uncertain";
      const outcome =
        initialOutcome === "Queued" && Number(claimed["attempts"]) >= 5 ? "Failed" : initialOutcome;
      const message =
        error instanceof WorkflowEmailError
          ? error.message
          : "The send outcome needs administrator review. It will not be resent automatically.";
      await db.execute(
        sql`UPDATE workflow_notification_emails SET status=${outcome},last_error=${message},next_attempt_at=now()+interval '15 minutes',updated_at=now() WHERE notification_id=${id}::uuid`,
      );
    }
  }
  return { queued, sent };
}
