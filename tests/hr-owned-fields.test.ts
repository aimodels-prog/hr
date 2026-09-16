import assert from "node:assert/strict";
import { test } from "node:test";
import { uploadEmployeeDocumentToDatabase } from "../src/lib/db/repositories/employee-document.repository.server.ts";
import {
  assertHrDocumentWrite,
  canSeeEmploymentDetails,
  isHrOwnedSetupTask,
} from "../src/lib/data/hr-owned-fields.ts";

test("HR-owned tasks are not employee setup requirements", () => {
  assert.equal(isHrOwnedSetupTask({ selfServiceFormKey: "employment_details" }), true);
  assert.equal(isHrOwnedSetupTask({ documentType: "visa" }), true);
  assert.equal(isHrOwnedSetupTask({ documentType: "work_permit" }), true);
  assert.equal(isHrOwnedSetupTask({ selfServiceFormKey: "personal_details" }), false);
  assert.equal(isHrOwnedSetupTask({ documentType: "passport" }), false);
});

test("direct employee immigration uploads are rejected before any storage or database write", async () => {
  for (const type of ["visa", "work_permit"]) {
    await assert.rejects(
      uploadEmployeeDocumentToDatabase(
        "test-org",
        {
          employeeId: "self",
          type,
          fileName: "document.pdf",
          mimeType: "application/pdf",
          bytes: new TextEncoder().encode("%PDF-1.4"),
        },
        {
          userId: "self-user",
          employeeId: "self",
          displayName: "Employee",
          roles: ["Employee"],
          activeRole: "Employee",
        },
      ),
      /Only HR/,
    );
  }
});
test("employment visibility follows confirmation and immigration writes are HR-only", () => {
  for (const role of ["Employee", "Accounts", "Line Manager", "IT"]) {
    assert.equal(canSeeEmploymentDetails("Pending HR Review", role), false);
    assert.equal(canSeeEmploymentDetails("Confirmed", role), true);
    assert.throws(() => assertHrDocumentWrite("visa", role), /Only HR/);
    assert.throws(() => assertHrDocumentWrite("work_permit", role), /Only HR/);
    assert.doesNotThrow(() => assertHrDocumentWrite("passport", role));
  }
  for (const role of ["HR", "Super Admin"]) {
    assert.equal(canSeeEmploymentDetails("Pending HR Review", role), true);
    assert.doesNotThrow(() => assertHrDocumentWrite("visa", role));
  }
});
