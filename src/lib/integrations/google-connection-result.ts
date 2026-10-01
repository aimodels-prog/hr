export class GoogleConnectionError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "GoogleConnectionError";
  }
}

const messages: Record<string, string> = {
  connected: "Your Google account is connected. You can return to VIA HR.",
  "session-expired":
    "Your VIA HR session expired. Sign in again, then start the Google connection again.",
  "not-authorised": "Only HR or a Super Admin can connect the organising account.",
  "approval-expired":
    "This approval has expired or was already used. Start a new connection from VIA HR and complete it in the same browser.",
  "permission-declined":
    "Google approval was cancelled or not granted. Try again and allow the requested permissions.",
  "code-rejected":
    "Google could not accept this approval. Start a fresh connection from VIA HR; do not reload an old Google callback link.",
  "client-rejected":
    "Google rejected the app credentials. Your administrator must check the Google connection settings.",
  "calendar-permission-missing":
    "Calendar permission was not granted. Connect again and select the permission to view and edit calendar events.",
  "offline-access-missing":
    "Google did not provide ongoing access. Start the connection again and approve access. If this repeats, ask your administrator to review the Google authorisation.",
  "identity-failed": "Google could not verify the organising account. Please try again.",
  "account-mismatch":
    "The approved Google account does not match the organising email saved in VIA HR. Choose the organising account shown in connection settings.",
  "google-unavailable": "Google did not respond successfully. Please try again shortly.",
  "invalid-response":
    "Google returned an incomplete approval response. Please start the connection again.",
  "account-changed":
    "The organising email changed during approval. Start a new connection using the current organising account.",
  "connection-failed":
    "VIA HR could not finish saving the Google connection. Ask your administrator to check the connection logs before trying again.",
};

export function googleConnectionResult(reason: string): Response {
  const safeReason = Object.hasOwn(messages, reason) ? reason : "connection-failed";
  const success = safeReason === "connected";
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Google connection — VIA HR</title><style>body{margin:0;background:#f5f7fa;color:#102333;font:16px/1.6 system-ui,sans-serif;padding:24px}main{max-width:560px;margin:10vh auto;padding:28px;background:white;border:1px solid #dce3ea;border-radius:16px}h1{font-size:24px}a{display:inline-block;background:#075694;color:white;padding:10px 18px;border-radius:8px;text-decoration:none}small{display:block;margin-top:20px;color:#526578}</style></head><body><main><h1>${success ? "Google connected" : "Google connection not completed"}</h1><p>${messages[safeReason]}</p><a href="/staff/requests?view=organisation">Return to VIA HR</a>${success ? "" : `<small>Reference: ${safeReason}</small>`}</main></body></html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    },
  );
}
