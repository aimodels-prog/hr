export interface StaffEmailContent {
  heading: string;
  message: string;
  category: string;
  action: string;
  url: string;
  origin: string;
  note?: string;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

/** Inline styles and presentation tables also work without images or media-query support. */
export function staffEmailTemplate(content: StaffEmailContent) {
  const safe = (value: string) => escapeHtml(value);
  const origin = new URL(content.origin);
  const destination = new URL(content.url);
  if (
    !["https:", "http:"].includes(origin.protocol) ||
    destination.origin !== origin.origin ||
    destination.username ||
    destination.password
  )
    throw new Error("Email actions must point to the HR application.");
  const heading = safe(content.heading);
  const message = safe(content.message).replace(/\r?\n/g, "<br>");
  const url = safe(destination.toString());
  const logo = safe(`${origin.origin}/email-via-logo.png`);
  const note =
    content.note ??
    "Sign in to VIA HR Application to view the latest status and complete any action securely.";
  const text = `${content.heading}\r\n\r\n${content.message}\r\n\r\n${content.action}:\r\n${destination}\r\n\r\n${note}\r\n\r\nVIA HR Application · Your workplace, connected\r\nThis update is for your VIA HR Application account.\r\n`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${heading}</title>
<style>@media only screen and (max-width:600px){.outer{padding:16px 8px!important}.content{padding:28px 22px!important}.heading{font-size:24px!important}.button{display:block!important;text-align:center!important}}</style></head>
<body style="margin:0;padding:0;background-color:#f3f6fa;color:#162b40;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;">${safe(content.message.slice(0, 150))}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f3f6fa"><tr><td class="outer" align="center" style="padding:36px 16px;">
<!--[if mso]><table role="presentation" width="600" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;">
<tr><td style="padding:0 8px 22px;"><img src="${logo}" alt="VIA International" width="112" height="43" style="display:block;border:0;width:112px;height:43px;"></td></tr>
<tr><td bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #dce5ef;border-radius:16px;border-top:5px solid #095790;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td class="content" style="padding:36px;">
<p style="margin:0 0 16px;font-size:12px;line-height:18px;font-weight:bold;letter-spacing:1px;color:#095790;">VIA HR Application &nbsp; / &nbsp; ${safe(content.category)}</p>
<h1 class="heading" style="margin:0 0 20px;font-size:28px;line-height:1.3;font-weight:700;color:#132b43;">${heading}</h1>
<p style="margin:0 0 28px;font-size:16px;line-height:26px;color:#42566b;overflow-wrap:anywhere;word-break:break-word;">${message}</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="#095790" style="border-radius:8px;background-color:#095790;text-align:center;mso-padding-alt:15px 24px;">
<a class="button" href="${url}" style="display:inline-block;padding:15px 24px;border:1px solid #095790;border-radius:8px;font-size:16px;line-height:22px;font-weight:bold;color:#ffffff;text-decoration:none;">${safe(content.action)}</a>
</td></tr></table>
<p style="margin:24px 0 0;font-size:13px;line-height:21px;color:#65758a;">${safe(note)}</p>
</td></tr></table></td></tr>
<tr><td style="padding:22px 12px 0;text-align:center;font-size:12px;line-height:20px;color:#65758a;">
<p style="margin:0;font-weight:bold;color:#42566b;">VIA HR Application · Your workplace, connected</p>
<p style="margin:4px 0 0;">This update is for your VIA HR Application account.</p>
<p style="margin:12px 0 0;">Button not working? <a href="${url}" style="color:#095790;text-decoration:underline;">Open in VIA HR Application</a></p>
</td></tr></table><!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
  return { text, html };
}

/** RFC 2045 base64 lines stay below the 76-character limit. */
export function emailBase64(value: string): string {
  return (
    Buffer.from(value, "utf8")
      .toString("base64")
      .match(/.{1,76}/g)
      ?.join("\r\n") ?? ""
  );
}
