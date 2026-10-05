import assert from "node:assert/strict";
import test from "node:test";
import {
  cvAttachments,
  mailboxCvId,
  recruitmentGmailAuthorisation,
  exchangeRecruitmentGmailCode,
  RECRUITMENT_GMAIL_SCOPE,
} from "../src/lib/integrations/recruitment-gmail.server.ts";
import { sourcesForCvFilter } from "../src/lib/recruitment/cv-source-filter.ts";
function configure(t: import("node:test").TestContext) {
  const values = {
    GOOGLE_RECRUITMENT_CLIENT_ID: "test-client",
    GOOGLE_RECRUITMENT_CLIENT_SECRET: "test-secret",
    APP_ORIGIN: "https://hr.example.com",
  };
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
}

test("mailbox attachment identity is stable and separated across accounts, messages and parts", () => {
  const id = mailboxCvId("one", "message", "0");
  assert.match(id, /^[a-f0-9-]{36}$/);
  assert.equal(id, mailboxCvId("one", "message", "0"));
  assert.notEqual(id, mailboxCvId("two", "message", "0"));
  assert.notEqual(id, mailboxCvId("one", "message2", "0"));
  assert.notEqual(id, mailboxCvId("one", "message", "1"));
});
test("nested CV attachments are found without importing body text and inline images", () => {
  assert.deepEqual(
    cvAttachments({
      parts: [
        { filename: "logo.png" },
        {
          parts: [
            { filename: "Emma.CV.PDF", partId: "1" },
            { filename: "CV.docx", partId: "2" },
          ],
        },
      ],
    }).map((p) => p.partId),
    ["1", "2"],
  );
  assert.throws(
    () => cvAttachments({ parts: Array.from({ length: 26 }, () => ({ filename: "CV.pdf" })) }),
    /25/,
  );
});
test("source filters keep portal, email, manual and referral channels distinct", () => {
  assert.deepEqual(sourcesForCvFilter("email"), ["Direct Email"]);
  assert.deepEqual(sourcesForCvFilter("portal"), ["Careers Portal", "Internal Application"]);
  assert.equal(sourcesForCvFilter("all"), undefined);
  assert.ok(!sourcesForCvFilter("manual")!.includes("Careers Portal"));
});
test("recruitment OAuth is separate, read-only, offline and protected by PKCE", (t) => {
  configure(t);
  const url = new URL(recruitmentGmailAuthorisation("state", "verifier", "hr@example.com"));
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://hr.example.com/auth/recruitment-email/callback",
  );
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("scope"), `openid email ${RECRUITMENT_GMAIL_SCOPE}`);
});
test("OAuth refuses a different Google identity and missing mailbox permission", async (t) => {
  configure(t);
  t.mock.method(globalThis, "fetch", async (url: string) =>
    String(url).includes("/token")
      ? Response.json({
          refresh_token: "refresh",
          access_token: "access",
          scope: RECRUITMENT_GMAIL_SCOPE,
        })
      : Response.json({ email: "wrong@example.com", email_verified: true }),
  );
  await assert.rejects(
    exchangeRecruitmentGmailCode("code", "verifier", "hr@example.com"),
    /Sign in with/,
  );
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ refresh_token: "refresh", access_token: "access", scope: "openid email" }),
  );
  await assert.rejects(
    exchangeRecruitmentGmailCode("code", "verifier", "hr@example.com"),
    /read access/,
  );
});
