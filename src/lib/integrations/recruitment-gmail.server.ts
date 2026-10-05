import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";

export const RECRUITMENT_GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export function recruitmentGmailConfig() {
  const clientId = process.env["GOOGLE_RECRUITMENT_CLIENT_ID"]?.trim();
  const clientSecret = process.env["GOOGLE_RECRUITMENT_CLIENT_SECRET"]?.trim();
  const origin = new URL(process.env["APP_ORIGIN"] || "http://invalid");
  if (
    !clientId ||
    !clientSecret ||
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password
  )
    throw new Error("Recruitment email connection is not configured.");
  return {
    clientId,
    clientSecret,
    origin: origin.origin,
    redirectUri: `${origin.origin}/auth/recruitment-email/callback`,
  };
}

export function recruitmentGmailAuthorisation(state: string, verifier: string, email: string) {
  const config = recruitmentGmailConfig();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: `openid email ${RECRUITMENT_GMAIL_SCOPE}`,
    access_type: "offline",
    prompt: "consent",
    login_hint: email,
    state,
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  }).toString();
  return url.toString();
}

async function tokenRequest(parameters: Record<string, string>): Promise<Record<string, unknown>> {
  const config = recruitmentGmailConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...parameters,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("Reconnect this mailbox to Google and try again.");
  return (await response.json()) as Record<string, unknown>;
}

export async function exchangeRecruitmentGmailCode(
  code: string,
  verifier: string,
  expectedEmail: string,
) {
  const result = await tokenRequest({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: recruitmentGmailConfig().redirectUri,
  });
  if (
    typeof result["refresh_token"] !== "string" ||
    typeof result["access_token"] !== "string" ||
    !String(result["scope"]).split(" ").includes(RECRUITMENT_GMAIL_SCOPE)
  )
    throw new Error("Approve read access to the recruitment mailbox.");
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${result["access_token"]}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("Google could not confirm the mailbox account.");
  const identity = (await response.json()) as { email?: string; email_verified?: boolean };
  if (!identity.email_verified || identity.email?.toLowerCase() !== expectedEmail.toLowerCase())
    throw new Error("Sign in with the mailbox email entered in VIA HR.");
  return result["refresh_token"];
}

export async function recruitmentGmailAccessToken(refreshToken: string): Promise<string> {
  const result = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  if (typeof result["access_token"] !== "string")
    throw new Error("Reconnect this mailbox to Google.");
  return result["access_token"];
}

export async function gmailGet<T>(
  token: string,
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`);
  url.search = new URLSearchParams(params).toString();
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new Error(
      "Google could not read the selected mailbox. Check its connection and selected label.",
    );
  return (await response.json()) as T;
}

export interface GmailPart {
  partId?: string;
  filename?: string;
  mimeType?: string;
  body?: { attachmentId?: string; data?: string; size?: number };
  parts?: GmailPart[];
}

export function cvAttachments(part: GmailPart): GmailPart[] {
  const result: GmailPart[] = [];
  const visit = (value: GmailPart, depth: number) => {
    if (depth > 20) throw new Error("Email contains too many nested attachments.");
    if (value.filename && /\.(pdf|docx?|DOCX?)$/i.test(value.filename)) result.push(value);
    for (const child of value.parts ?? []) visit(child, depth + 1);
  };
  visit(part, 0);
  if (result.length > 25)
    throw new Error("Email has more than 25 CV attachments; upload these manually.");
  return result;
}

// Stable per attachment, not per filename: a retry after a crash reuses the saved intake.
export function mailboxCvId(mailboxId: string, messageId: string, partId: string): string {
  const h = createHash("sha256")
    .update(JSON.stringify([mailboxId, messageId, partId]))
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
