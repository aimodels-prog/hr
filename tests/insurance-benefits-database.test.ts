import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import {
  libraryList,
  libraryDownload,
  libraryUpload,
  libraryEmployeeOptions,
} from "../src/lib/db/repositories/company-library.repository.server.ts";
import { closeDatabaseConnection } from "../src/lib/db/client.ts";

const url = process.env["VIA_HR_TEST_DATABASE_URL"];
test(
  "shared benefits respect employee selection, publication, organisation and HR ownership",
  { skip: !url },
  async () => {
    assert.match(new URL(url!).pathname, /test|scratch/);
    process.env["DATABASE_URL"] = url;
    const db = postgres(url!, { max: 1 });
    const org = randomUUID(),
      user = randomUUID(),
      selected = randomUUID(),
      other = randomUUID(),
      file = randomUUID();
    const ids = Array.from({ length: 5 }, () => randomUUID());
    const actor = {
      userId: user,
      employeeId: selected,
      displayName: "Employee",
      activeRole: "Employee" as const,
    };
    try {
      await db`INSERT INTO organisations(id,name,slug,created_by,updated_by) VALUES(${org},'Insurance test',${org},${user},${user})`;
      await db`INSERT INTO file_metadata(id,organisation_id,name,mime_type,size,storage_status,owner_entity_type,owner_entity_id,created_by,updated_by) VALUES(${file},${org},'benefits.pdf','application/pdf',10,'Available','company-library',${ids[0]!},${user},${user})`;
      for (const [index, id] of ids.entries()) {
        const audience = index === 0 ? "All staff" : "Selected employees";
        const status =
          index === 2
            ? "Draft"
            : index === 3
              ? "Withdrawn"
              : index === 4
                ? "Superseded"
                : "Published";
        await db`INSERT INTO company_library(id,organisation_id,family_id,version,title,category,kind,audience,employee_ids,status,file_id,created_by,updated_by) VALUES(${id},${org},${id},1,'Health plan','Benefits','Insurance',${audience},${[selected]}::uuid[],${status},${file},${user},${user})`;
      }
      const own = await libraryList(org, actor);
      assert.equal(own.length, 2);
      assert.ok(
        own.every((doc) => doc.employeeIds.length === 0),
        "colleagues' selections must not leak",
      );
      assert.equal((await libraryList(org, { ...actor, employeeId: other })).length, 1);
      assert.equal(
        (await libraryList(org, { ...actor, activeRole: "Accounts", employeeId: other })).length,
        1,
      );
      assert.equal((await libraryList(randomUUID(), actor)).length, 0);
      assert.equal((await libraryList(org, { ...actor, activeRole: "HR" })).length, 5);
      for (const index of [1, 2, 3, 4])
        await assert.rejects(
          libraryDownload(org, ids[index]!, { ...actor, employeeId: other }),
          /not available/,
        );
      await assert.rejects(libraryEmployeeOptions(org, actor), /Only HR/);
      const input = {
        title: "Benefits",
        category: "Benefits",
        kind: "Insurance" as const,
        audience: "Selected employees" as const,
        employeeIds: [other],
        name: "benefits.pdf",
        bytes: new TextEncoder().encode("%PDF-1.4"),
      };
      await assert.rejects(libraryUpload(org, input, actor), /Only HR/);
      await assert.rejects(
        libraryUpload(org, input, { ...actor, activeRole: "HR" }),
        /your organisation/,
      );
      await assert.rejects(
        libraryUpload(org, { ...input, employeeIds: [] }, { ...actor, activeRole: "HR" }),
        /at least one/,
      );
    } finally {
      await db`DELETE FROM company_library WHERE organisation_id=${org}`;
      await db`DELETE FROM file_metadata WHERE id=${file}`;
      await db`DELETE FROM organisations WHERE id=${org}`;
      await db.end();
      await closeDatabaseConnection();
    }
  },
);
