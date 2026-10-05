import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { processRecruitmentMailbox } from "../src/lib/db/repositories/recruitment-mailbox.repository.server.ts";
import { encryptSensitiveJson } from "../src/lib/db/encryption.server.ts";
import { closeDatabaseConnection } from "../src/lib/db/client.ts";

const databaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"];
test(
  "mailbox worker respects pause, persists its ledger and stops when HR access is removed",
  { skip: !databaseUrl },
  async (t) => {
    assert.match(new URL(databaseUrl!).pathname, /test|scratch/);
    const settings = {
      DATABASE_URL: databaseUrl!,
      GOOGLE_RECRUITMENT_CLIENT_ID: "test",
      GOOGLE_RECRUITMENT_CLIENT_SECRET: "test",
      APP_ORIGIN: "https://hr.example.com",
      VIA_HR_ACTIVE_FIELD_ENCRYPTION_KEY_ID: "test",
      VIA_HR_FIELD_ENCRYPTION_KEYS: JSON.stringify({
        test: Buffer.alloc(32, 3).toString("base64"),
      }),
    };
    for (const [key, value] of Object.entries(settings)) {
      const previous = process.env[key];
      process.env[key] = value;
      t.after(() => {
        if (previous === undefined) delete process.env[key];
        else process.env[key] = previous;
      });
    }
    const sql = postgres(databaseUrl!, { max: 2 });
    const org = randomUUID(),
      user = randomUUID(),
      employee = randomUUID(),
      mailbox = randomUUID();
    const dept = randomUUID(),
      position = randomUUID(),
      location = randomUUID(),
      employment = randomUUID();
    let messageReads = 0;
    let includeCv = false;
    const original = Buffer.from("%PDF-1.7\nOriginal CV bytes, unchanged\n%%EOF");
    t.mock.method(globalThis, "fetch", async (value: string | URL | Request) => {
      const url = String(value);
      if (url.includes("oauth2.googleapis.com"))
        return Response.json({ access_token: "test-access" });
      if (url.includes("/messages?"))
        return Response.json({ messages: [{ id: includeCv ? "mail-cv" : "mail-one" }] });
      if (url.includes("/messages/mail-cv"))
        return Response.json({
          internalDate: String(Date.now()),
          payload: {
            parts: [
              {
                partId: "0",
                filename: "candidate.pdf",
                mimeType: "application/pdf",
                body: { size: original.length, data: original.toString("base64url") },
              },
            ],
          },
        });
      if (url.includes("/messages/mail-one")) {
        messageReads++;
        return Response.json({ payload: { parts: [{ filename: "logo.png" }] } });
      }
      throw new Error("Unexpected provider request");
    });
    try {
      await sql`INSERT INTO organisations(id,name,slug,created_by,updated_by) VALUES(${org},'Mailbox test',${org},${user},${user})`;
      for (const [table, id] of [
        ["departments", dept],
        ["positions", position],
        ["employment_types", employment],
        ["locations", location],
      ])
        await sql.unsafe(
          `INSERT INTO ${table} (id,organisation_id,name,code,created_by,updated_by) VALUES($1,$2,'Mailbox test','MB',$3,$3)`,
          [id!, org, user],
        );
      await sql`INSERT INTO employees(id,organisation_id,employee_number,legal_name,preferred_name,work_email,department_id,position_id,location_id,employment_type_id,status,start_date,created_by,updated_by)
      VALUES(${employee},${org},'MAIL-1','HR','HR',${user + "@example.com"},${dept},${position},${location},${employment},'Active','2026-01-01',${user},${user})`;
      await sql`INSERT INTO users(id,organisation_id,employee_id,display_name,workspace_email,status,created_by,updated_by) VALUES(${user},${org},${employee},'HR',${user + "@example.com"},'Active',${user},${user})`;
      await sql`INSERT INTO user_roles(organisation_id,user_id,role_id,assigned_by) SELECT ${org},${user},id,${user} FROM roles WHERE code='HR'`;
      await sql`INSERT INTO recruitment_mailboxes(id,organisation_id,email,refresh_token_encrypted,connected_by,label_id,since_date,paused) VALUES(${mailbox},${org},'hr@example.com',${encryptSensitiveJson("test-refresh")},${user},'Label_CVs','2026-01-01',true)`;
      assert.equal(await processRecruitmentMailbox(), false);
      await sql`UPDATE recruitment_mailboxes SET paused=false WHERE id=${mailbox}`;
      assert.equal(await processRecruitmentMailbox(), true);
      assert.equal(messageReads, 1);
      const [entry] =
        await sql`SELECT status FROM recruitment_mailbox_messages WHERE mailbox_id=${mailbox}`;
      assert.equal(entry!.status, "No CV attachment");
      await sql`UPDATE recruitment_mailboxes SET next_sync_at=now() WHERE id=${mailbox}`;
      await processRecruitmentMailbox();
      assert.equal(messageReads, 1, "the saved message is not downloaded again");
      includeCv = true;
      let imports = 0;
      const importer: Parameters<typeof processRecruitmentMailbox>[0] = async (
        organisationId,
        input,
        actor,
      ) => {
        imports++;
        assert.equal(organisationId, org);
        assert.equal(actor.userId, user);
        assert.deepEqual(Buffer.from(input.bytes), original);
        assert.equal(input.source, "Direct Email");
        assert.equal(input.consentStatus, "Awaiting Confirmation");
        assert.equal(input.isRecommended, false);
        return { cvRecordId: input.intakeId!, jobId: randomUUID() };
      };
      await sql`UPDATE recruitment_mailboxes SET next_sync_at=now() WHERE id=${mailbox}`;
      await processRecruitmentMailbox(importer);
      await sql`UPDATE recruitment_mailboxes SET next_sync_at=now() WHERE id=${mailbox}`;
      await processRecruitmentMailbox(importer);
      assert.equal(imports, 1, "original CV delivered once to the intake pipeline");
      await sql`DELETE FROM user_roles WHERE user_id=${user}`;
      await sql`UPDATE recruitment_mailboxes SET next_sync_at=now() WHERE id=${mailbox}`;
      await processRecruitmentMailbox();
      const [paused] =
        await sql`SELECT paused,last_error FROM recruitment_mailboxes WHERE id=${mailbox}`;
      assert.equal(paused!.paused, true);
      assert.match(paused!.last_error, /active HR/);
    } finally {
      await sql`DELETE FROM recruitment_mailbox_messages WHERE mailbox_id=${mailbox}`;
      await sql`DELETE FROM recruitment_mailboxes WHERE id=${mailbox}`;
      await sql`DELETE FROM user_roles WHERE user_id=${user}`;
      await sql`DELETE FROM users WHERE id=${user}`;
      await sql`DELETE FROM employees WHERE id=${employee}`;
      for (const table of ["departments", "positions", "employment_types", "locations"])
        await sql.unsafe(`DELETE FROM ${table} WHERE organisation_id=$1`, [org]);
      await sql`DELETE FROM organisations WHERE id=${org}`;
      await sql.end();
      await closeDatabaseConnection();
    }
  },
);
