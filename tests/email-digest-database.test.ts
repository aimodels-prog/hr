import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { closeDatabaseConnection } from "../src/lib/db/client.ts";
import {
  enqueueWorkflowEmails,
  claimDailyEmailDigest,
  processWorkflowEmails,
} from "../src/lib/db/repositories/workflow-email.repository.server.ts";
import { encryptSensitiveJson } from "../src/lib/db/encryption.server.ts";

const url = process.env["VIA_HR_TEST_DATABASE_URL"];
test(
  "daily summaries are timezone-aware, complete, role-scoped and safe under concurrent claims",
  { skip: !url },
  async (t) => {
    assert.match(new URL(url!).pathname, /test|scratch/);
    process.env["DATABASE_URL"] = url;
    const sql = postgres(url!, { max: 2 });
    const org = randomUUID(),
      user = randomUUID(),
      employee = randomUUID();
    const department = randomUUID(),
      position = randomUUID(),
      employment = randomUUID(),
      location = randomUUID();
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const before = new Date(`${day}T05:59:00Z`),
      after = new Date(`${day}T06:01:00Z`);
    // next_attempt_at below is explicitly controlled, independent of the test runner's wall clock.
    const notice = async (type: string) => {
      const id = randomUUID();
      await sql`INSERT INTO notifications(id,organisation_id,recipient_user_id,type,title,message,link,created_by,updated_by)
      VALUES(${id},${org},${user},${type},'Review item','An item needs attention',${sql.json({ entityType: type === "document_expiry" ? "employee-document" : "leave-request", entityId: randomUUID(), path: "/staff/my-tasks" })},${user},${user})`;
      return id;
    };
    const enqueue = async () => {
      await enqueueWorkflowEmails();
      await sql`UPDATE workflow_notification_emails SET next_attempt_at=${before} WHERE organisation_id=${org}`;
    };
    try {
      await sql`INSERT INTO organisations(id,name,slug,created_by,updated_by) VALUES(${org},'Digest test',${org},${user},${user})`;
      for (const [table, id] of [
        ["departments", department],
        ["positions", position],
        ["employment_types", employment],
        ["locations", location],
      ])
        await sql.unsafe(
          `INSERT INTO ${table}(id,organisation_id,name,code,created_by,updated_by) VALUES($1,$2,'Digest','DG',$3,$3)`,
          [id!, org, user],
        );
      await sql`INSERT INTO employees(id,organisation_id,employee_number,legal_name,preferred_name,work_email,department_id,position_id,employment_type_id,location_id,status,start_date,created_by,updated_by)
      VALUES(${employee},${org},'DG1','Digest employee','Digest',${user + "@example.test"},${department},${position},${employment},${location},'Active','2020-01-01',${user},${user})`;
      await sql`INSERT INTO users(id,organisation_id,employee_id,display_name,workspace_email,created_by,updated_by) VALUES(${user},${org},${employee},'Digest',${user + "@example.test"},${user},${user})`;
      await sql`INSERT INTO app_settings(organisation_id,timezone,base_currency,working_days,standard_daily_hours,standard_weekly_hours,leave_year_start,leave_year_end,document_reminder_days,employee_number_format,candidate_reference_format,created_by,updated_by)
      VALUES(${org},'Asia/Muscat','OMR',ARRAY[0,1,2,3,4],8,40,'01-01','12-31',ARRAY[30,7],'EMP-{0000}','CAN-{0000}',${user},${user})`;
      await sql`INSERT INTO google_calendar_connections(organisation_id,account_email,refresh_token_encrypted,connected_by,email_enabled_at) VALUES(${org},'hr@example.test','not-a-token',${user},now())`;
      for (let i = 0; i < 10; i++) await notice("document_expiry");
      await notice("leave.approved");
      await enqueue();
      assert.equal(
        await claimDailyEmailDigest(before),
        null,
        "Do not send before 10am company time",
      );
      const claims = await Promise.all(
        Array.from({ length: 5 }, () => claimDailyEmailDigest(after)),
      );
      const claimed = claims.filter((value) => value !== null);
      assert.equal(claimed.length, 1);
      assert.equal(claimed[0]!.ids.length, 11);
      assert.equal(claimed[0]!.topic, "Your daily updates");
      await sql`UPDATE workflow_notification_emails SET status='Blocked',next_attempt_at=${before} WHERE digest_id=${claimed[0]!.id}`;
      const retry = await claimDailyEmailDigest(after);
      assert.equal(
        retry?.id,
        claimed[0]!.id,
        "Confirmed non-delivery retries the same daily summary",
      );
      assert.equal(retry?.ids.length, 11);
      await notice("leave.approved");
      await enqueue();
      assert.equal(
        await claimDailyEmailDigest(after),
        null,
        "New items cannot trigger a second daily message",
      );
      const tomorrow = new Date(after.getTime() + 86400000);
      assert.equal(
        (await claimDailyEmailDigest(tomorrow))?.ids.length,
        1,
        "Late items are carried forward",
      );
      await sql`INSERT INTO user_roles(organisation_id,user_id,role_id,assigned_by) SELECT ${org},${user},id,${user} FROM roles WHERE code='HR'`;
      for (let i = 0; i < 10; i++) await notice("document_expiry");
      await notice("leave_submitted");
      await enqueue();
      const hr1 = await claimDailyEmailDigest(tomorrow),
        hr2 = await claimDailyEmailDigest(tomorrow);
      assert.equal(hr1?.topic, "Expiring documents");
      assert.equal(hr1?.ids.length, 10);
      assert.equal(hr2?.topic, "Leave requests");
      assert.equal(await claimDailyEmailDigest(tomorrow), null);
      // Exercise the actual sender, with Google completely mocked: no email leaves this test.
      await sql`UPDATE workflow_notification_emails SET status='Skipped',digest_id=NULL WHERE organisation_id=${org}`;
      await sql`DELETE FROM workflow_email_digests WHERE organisation_id=${org}`;
      await sql`UPDATE app_settings SET additional_settings='{"reminderRules":{"dailyEmailTime":"00:00"}}' WHERE organisation_id=${org}`;
      const env = {
        GOOGLE_CALENDAR_CLIENT_ID: "test-client",
        GOOGLE_CALENDAR_CLIENT_SECRET: "test-secret",
        APP_ORIGIN: "https://hr.example.test",
        VIA_HR_ACTIVE_FIELD_ENCRYPTION_KEY_ID: "test",
        VIA_HR_FIELD_ENCRYPTION_KEYS: JSON.stringify({ test: Buffer.alloc(32).toString("base64") }),
      };
      const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
      Object.assign(process.env, env);
      try {
        await sql`UPDATE google_calendar_connections SET refresh_token_encrypted=${encryptSensitiveJson("test-refresh")} WHERE organisation_id=${org}`;
        for (let i = 0; i < 10; i++) await notice("document_expiry");
        let sends = 0;
        t.mock.method(
          globalThis,
          "fetch",
          async (input: string | URL | Request, init?: RequestInit) => {
            if (String(input) === "https://oauth2.googleapis.com/token")
              return new Response(JSON.stringify({ access_token: "test-access" }));
            assert.equal(
              String(input),
              "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
            );
            sends++;
            const mime = Buffer.from(JSON.parse(String(init?.body)).raw, "base64url").toString();
            const html = Buffer.from(
              mime.split("Content-Transfer-Encoding: base64\r\n\r\n")[2]!.split("\r\n--")[0]!,
              "base64",
            ).toString();
            assert.equal((html.match(/View details/g) ?? []).length, 10);
            return new Response(JSON.stringify({ id: "digest-accepted" }));
          },
        );
        assert.equal((await processWorkflowEmails()).sent, 1);
        assert.equal((await processWorkflowEmails()).sent, 0);
        assert.equal(sends, 1);
        const delivered =
          await sql`SELECT notification_id FROM workflow_notification_emails WHERE organisation_id=${org} AND status='Sent' AND provider_message_id='digest-accepted'`;
        assert.equal(delivered.length, 10);
      } finally {
        for (const key of Object.keys(env)) {
          if (previous[key] === undefined) delete process.env[key];
          else process.env[key] = previous[key];
        }
      }
    } finally {
      await sql`DELETE FROM workflow_notification_emails WHERE organisation_id=${org}`;
      await sql`DELETE FROM workflow_email_digests WHERE organisation_id=${org}`;
      await sql`DELETE FROM google_calendar_connections WHERE organisation_id=${org}`;
      await sql.end();
      await closeDatabaseConnection();
    }
  },
);
