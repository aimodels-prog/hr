import "@tanstack/react-start/server-only";
import * as z from "zod";
import { googleCalendarConfig } from "./google-calendar.server.ts";

export class WorkflowEmailError extends Error {
  constructor(
    public outcome: "Blocked" | "Failed" | "Uncertain" | "Queued",
    message: string,
  ) {
    super(message);
  }
}
export function workflowEmailRaw(recipient: string, notificationId: string) {
  z.string().email().parse(recipient);
  z.string().uuid().parse(notificationId);
  const { accountEmail, origin } = googleCalendarConfig();
  // Keep personal, medical, compensation and candidate information inside the authenticated app.
  const body = `You have an approval-related update or reminder in VIA HR.\r\n\r\nOpen VIA HR to view your requests, decisions and tasks:\r\n${origin}/staff/requests\r\n\r\nAn email notification is not an approval. Sign in to see the current status.\r\n`;
  return Buffer.from(
    [
      `From: VIA HR <${accountEmail}>`,
      `To: ${recipient}`,
      "Subject: VIA HR - request update or reminder",
      `Message-ID: <via-notification-${notificationId}@via-int.com>`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(body).toString("base64"),
    ].join("\r\n"),
  ).toString("base64url");
}
export async function sendWorkflowEmail(
  accessToken: string,
  recipient: string,
  notificationId: string,
) {
  const raw = workflowEmailRaw(recipient, notificationId);
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
      "Enable Gmail API and reconnect hr@via-int.com with email-sending permission.",
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
