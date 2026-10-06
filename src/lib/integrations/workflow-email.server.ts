import "@tanstack/react-start/server-only";
import * as z from "zod";
import { googleCalendarConfig } from "./google-calendar.server.ts";
import { staffEmailTemplate, emailBase64 } from "./staff-email-template.ts";

export class WorkflowEmailError extends Error {
  constructor(
    public outcome: "Blocked" | "Failed" | "Uncertain" | "Queued",
    message: string,
  ) {
    super(message);
  }
}
export interface WorkflowEmailContext {
  title: string;
  message: string;
  path?: string | undefined;
  type?: string;
}
export function workflowEmailDestination(origin: string, path?: string): string {
  if (!path || !path.startsWith("/staff/") || path.includes("\\") || /[\r\n]/.test(path))
    return `${origin}/staff/requests`;
  const target = new URL(path, origin);
  return target.origin === origin ? target.toString() : `${origin}/staff/requests`;
}
export function workflowEmailRaw(
  recipient: string,
  notificationId: string,
  accountEmail: string,
  missingClockoutDate?: string,
  context?: WorkflowEmailContext,
) {
  z.string().email().parse(recipient);
  z.string().uuid().parse(notificationId);
  z.string().email().parse(accountEmail);
  const { origin } = googleCalendarConfig();
  // No attachments or identity numbers are copied into emails. Family details stay in the app.
  if (missingClockoutDate)
    z.string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .parse(missingClockoutDate);
  const family = context?.type === "dependants.missing_information_reminder";
  const approval = context?.type === "approval.reminder";
  const documentReview = approval && /verify employee document/i.test(context?.message ?? "");
  const body = staffEmailTemplate({
    origin,
    heading: missingClockoutDate
      ? "A clock-out needs your attention"
      : family
        ? "Complete your family record"
        : documentReview
          ? "Employee document awaiting review"
          : context?.title.slice(0, 200) || "You have an update",
    message: missingClockoutDate
      ? `Your clock-in was recorded on ${missingClockoutDate}, but no clock-out was received. Please enter the time you left for HR to confirm.`
      : family
        ? "Your family record is missing required details or documents. Open your profile to see the checklist for each dependant."
        : context?.message.slice(0, 2000) ||
          "There is an update to your request. Open VIA HR Application to see the details.",
    category: missingClockoutDate
      ? "ATTENDANCE"
      : approval
        ? "REVIEW NEEDED"
        : context?.type?.includes("reminder")
          ? "REMINDER"
          : "WORKPLACE UPDATE",
    action: missingClockoutDate
      ? "Correct clock-out"
      : family
        ? "Complete my profile"
        : documentReview
          ? "Review document"
          : approval
            ? "Review request"
            : "View update",
    url: missingClockoutDate
      ? `${origin}/staff/me/attendance?correct=${missingClockoutDate}`
      : workflowEmailDestination(origin, context?.path),
    ...(missingClockoutDate
      ? {
          note: "If you have already corrected this record, no action is needed. Sign in to see the current status.",
        }
      : {}),
  });
  const subject = context
    ? `Subject: =?UTF-8?B?${Buffer.from(`VIA HR Application - ${context.title.replace(/[\r\n]/g, " ").slice(0, 160)}`).toString("base64")}?=`
    : "Subject: VIA HR Application - request update or reminder";
  const boundary = `via-alternative-${notificationId}`;
  return Buffer.from(
    [
      `From: VIA HR Application <${accountEmail}>`,
      `To: ${recipient}`,
      missingClockoutDate
        ? "Subject: VIA HR Application - Missing clock-out for yesterday"
        : subject,
      `Message-ID: <via-notification-${notificationId}@via-int.com>`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      emailBase64(body.text),
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      emailBase64(body.html),
      `--${boundary}--`,
      "",
    ].join("\r\n"),
  ).toString("base64url");
}
export async function sendWorkflowEmail(
  accessToken: string,
  recipient: string,
  notificationId: string,
  accountEmail: string,
  missingClockoutDate?: string,
  context?: WorkflowEmailContext,
) {
  const raw = workflowEmailRaw(
    recipient,
    notificationId,
    accountEmail,
    missingClockoutDate,
    context,
  );
  let response: Response;
  try {
    response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new WorkflowEmailError(
      "Uncertain",
      "Google’s response was not received. Check the sender’s Sent folder before resending.",
    );
  }
  if (response.status === 429)
    throw new WorkflowEmailError("Queued", "Google rate limited sending; a retry is scheduled.");
  if ([401, 403].includes(response.status))
    throw new WorkflowEmailError(
      "Blocked",
      "Enable Gmail API and reconnect the configured organising account with email-sending permission.",
    );
  if (response.status >= 500)
    throw new WorkflowEmailError(
      "Uncertain",
      "Google reported a server error. Delivery must be checked before resending.",
    );
  if (!response.ok)
    throw new WorkflowEmailError(
      "Failed",
      "Google rejected this email. Administrator review is required.",
    );
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new WorkflowEmailError("Uncertain", "Google’s send acknowledgement could not be read.");
  }
  const message = z.object({ id: z.string().min(1) }).safeParse(data);
  if (!message.success)
    throw new WorkflowEmailError("Uncertain", "Google did not return a message reference.");
  return message.data.id;
}
