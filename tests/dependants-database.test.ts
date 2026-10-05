import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { processDependantCompletionNotices } from "../src/lib/db/repositories/dependant-reminder.repository.server.ts";
import {
  listEmployeeDocumentsForActor,
  readEmployeeDocumentInDatabase,
} from "../src/lib/db/repositories/employee-document.repository.server.ts";
import { closeDatabaseConnection } from "../src/lib/db/client.ts";

const url = process.env["VIA_HR_TEST_DATABASE_URL"];
test(
  "dependant notices are deduplicated, resolve when complete, and family documents stay private",
  { skip: !url },
  async () => {
    assert.match(new URL(url!).pathname, /test|scratch/);
    process.env["DATABASE_URL"] = url;
    const sql = postgres(url!, { max: 1 });
    const org = randomUUID(),
      user = randomUUID(),
      employee = randomUUID(),
      dep = randomUUID(),
      doc = randomUUID(),
      file = randomUUID();
    const dept = randomUUID(),
      position = randomUUID(),
      employment = randomUUID(),
      location = randomUUID();
    const dependant = {
      id: dep,
      name: "Family member",
      relationship: "Child",
      dateOfBirth: "2020-01-01",
    };
    try {
      await sql`INSERT INTO organisations(id,name,slug,created_by,updated_by) VALUES(${org},'Dependants test',${org},${user},${user})`;
      for (const [table, id] of [
        ["departments", dept],
        ["positions", position],
        ["employment_types", employment],
        ["locations", location],
      ])
        await sql.unsafe(
          `INSERT INTO ${table}(id,organisation_id,name,code,created_by,updated_by) VALUES($1,$2,'Family test','FT',$3,$3)`,
          [id!, org, user],
        );
      await sql`INSERT INTO employees(id,organisation_id,employee_number,legal_name,preferred_name,work_email,department_id,position_id,employment_type_id,location_id,status,start_date,dependants,created_by,updated_by)
      VALUES(${employee},${org},'FAMILY-1','Employee','Employee',${user + "@example.com"},${dept},${position},${employment},${location},'Active','2020-01-01',${sql.json([dependant])},${user},${user})`;
      await sql`INSERT INTO users(id,organisation_id,employee_id,display_name,workspace_email,status,created_by,updated_by) VALUES(${user},${org},${employee},'Employee',${user + "@example.com"},'Active',${user},${user})`;
      await processDependantCompletionNotices();
      await processDependantCompletionNotices();
      const notices = await sql`SELECT * FROM notifications WHERE organisation_id=${org}`;
      assert.equal(notices.length, 1);
      assert.match(notices[0]!.message, /contact phone/);
      await sql`INSERT INTO file_metadata(id,organisation_id,name,mime_type,size,storage_status,owner_entity_type,owner_entity_id,created_by,updated_by) VALUES(${file},${org},'id.pdf','application/pdf',10,'Available','employee-document',${doc},${user},${user})`;
      await sql`INSERT INTO employee_documents(id,organisation_id,employee_id,type,dependant_id,dependant_document_kind,file_id,status,visibility,created_by,updated_by) VALUES(${doc},${org},${employee},'other',${dep},'national_id',${file},'Pending Verification','Restricted',${user},${user})`;
      const own = await listEmployeeDocumentsForActor(org, {
        userId: user,
        employeeId: employee,
        displayName: "Employee",
        activeRole: "Employee",
      });
      assert.equal(own[0]?.dependantId, dep);
      for (const activeRole of ["Employee", "Line Manager", "Accounts"] as const) {
        const actor = {
          userId: randomUUID(),
          employeeId: randomUUID(),
          displayName: "Colleague",
          activeRole,
        };
        assert.deepEqual(await listEmployeeDocumentsForActor(org, actor), []);
        await assert.rejects(
          readEmployeeDocumentInDatabase(org, file, actor, "View document"),
          /permission/,
        );
      }
      assert.equal(
        (await listEmployeeDocumentsForActor(org, { displayName: "HR", activeRole: "HR" })).length,
        1,
      );
      await sql`UPDATE employees SET dependants=${sql.json([{ ...dependant, phone: "Guardian number", nationality: "Omani", visaRequired: "No" }])} WHERE id=${employee}`;
      await processDependantCompletionNotices();
      const [notice] = await sql`SELECT status FROM notifications WHERE organisation_id=${org}`;
      assert.equal(notice!.status, "Dismissed");
    } finally {
      await sql`DELETE FROM notifications WHERE organisation_id=${org}`;
      await sql`DELETE FROM employee_documents WHERE id=${doc}`;
      await sql`DELETE FROM file_metadata WHERE id=${file}`;
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
