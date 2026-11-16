import assert from "node:assert/strict";
import { test } from "node:test";

import { missingRequiredDocuments } from "../src/lib/data/dashboard-document-checklist.ts";
import { defaultDocumentRequirements } from "../src/lib/data/document-requirements.ts";

const employee = {
  id: "employee-1",
  departmentId: "design",
  positionId: "engineer",
  locationId: "head-office",
};
const required = defaultDocumentRequirements()
  .filter((item) => ["passport", "national_id"].includes(item.id))
  .map((item) => ({ ...item, required: true }));

test("dashboard includes every required document not yet uploaded", () => {
  assert.deepEqual(
    missingRequiredDocuments(required, employee, [], "2026-11-16").map((item) => item.id),
    ["passport", "national_id"],
  );
});

test("pending verification counts as uploaded; rejected, expired and dependant files do not", () => {
  const missing = missingRequiredDocuments(
    required,
    employee,
    [
      {
        type: "passport",
        requirementSnapshot: { id: "passport" },
        status: "Pending Verification" as const,
        expiryDate: null,
        dependantId: null,
        waiverReason: null,
      },
      {
        type: "national_id",
        requirementSnapshot: { id: "national_id" },
        status: "Valid" as const,
        expiryDate: "2026-11-15",
        dependantId: null,
        waiverReason: null,
      },
    ],
    "2026-11-16",
  );
  assert.deepEqual(
    missing.map((item) => item.id),
    ["national_id"],
  );
  const rejected = missingRequiredDocuments(
    required,
    employee,
    [
      {
        type: "passport",
        requirementSnapshot: { id: "passport" },
        status: "Rejected" as const,
        expiryDate: null,
        dependantId: null,
        waiverReason: null,
      },
      {
        type: "national_id",
        requirementSnapshot: { id: "national_id" },
        status: "Valid" as const,
        expiryDate: null,
        dependantId: "child-1",
        waiverReason: null,
      },
    ],
    "2026-11-16",
  );
  assert.deepEqual(
    rejected.map((item) => item.id),
    ["passport", "national_id"],
  );
});

test("requirements not assigned to this employee stay off the dashboard", () => {
  const locationOnly = {
    ...required[0]!,
    audience: "Location" as const,
    audienceIds: ["salalah"],
  };
  assert.deepEqual(missingRequiredDocuments([locationOnly], employee, [], "2026-11-16"), []);
});
