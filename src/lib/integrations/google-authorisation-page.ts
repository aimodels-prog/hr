/** Finish the same-origin form submission before navigating to Google.
 * Chromium applies CSP form-action to HTTP redirect chains, so a direct
 * cross-origin 303 from the connection form is blocked by form-action 'self'.
 */
export function googleAuthorisationPage(authorisationUrl: string): Response {
  const url = new URL(authorisationUrl);
  if (
    url.origin !== "https://accounts.google.com" ||
    url.pathname !== "/o/oauth2/v2/auth" ||
    url.username ||
    url.password
  )
    throw new Error("Invalid Google authorisation destination.");
  const escaped = url
    .toString()
    .replace(
      /[&<>"']/g,
      (character) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
    );
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=${escaped}"><title>Connect Google</title></head><body><p>Opening Google approval…</p><a href="${escaped}" rel="noreferrer">Continue to Google</a></body></html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    },
  );
}
