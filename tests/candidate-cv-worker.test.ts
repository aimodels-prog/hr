import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import postgres from "postgres";

import {
  finaliseCandidateCvIntakeInDatabase,
  processNextCandidateCvJob,
  uploadCandidateCvIntakeToDatabase,
} from "../src/lib/db/repositories/candidate-cv-intake.repository.server.ts";

const testDatabaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
const hasObjectStorage = Boolean(process.env["VIA_HR_OBJECT_STORAGE_ENDPOINT"]?.trim());
if (testDatabaseUrl) process.env["DATABASE_URL"] = testDatabaseUrl;

test(
  "direct CV intake is encrypted, durable and moved to HR review by the worker",
  { skip: !testDatabaseUrl || !hasObjectStorage },
  async () => {
    assert.match(new URL(testDatabaseUrl!).pathname.slice(1).toLowerCase(), /(test|scratch)/);
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    try {
      const [hr] = await sql`
        SELECT u.id, u.employee_id, u.display_name, u.organisation_id
        FROM users u
        JOIN user_roles ur ON ur.user_id = u.id
        JOIN roles r ON r.id = ur.role_id AND r.code = 'HR'
        WHERE u.status = 'Active' ORDER BY u.created_at LIMIT 1
      `;
      assert.ok(hr);
      const actor = {
        userId: String(hr.id),
        employeeId: String(hr.employee_id),
        displayName: String(hr.display_name),
        activeRole: "HR" as const,
        roles: ["Employee", "HR"] as const,
      };
      const result = await uploadCandidateCvIntakeToDatabase(
        String(hr.organisation_id),
        {
          fileName: `direct-${randomUUID()}.pdf`,
          mimeType: "application/pdf",
          bytes: new TextEncoder().encode(
            "%PDF-1.7\nCandidate: Worker Test\nworker.test@example.test\n%%EOF",
          ),
          source: "Direct Email",
          receivedAt: new Date().toISOString(),
          consentStatus: "Confirmed",
          isRecommended: true,
        },
        actor,
      );
      const [queued] = await sql`
        SELECT status FROM background_jobs WHERE id = ${result.jobId}
      `;
      assert.equal(queued.status, "Queued");
      assert.equal(await processNextCandidateCvJob(`test:${randomUUID()}`, result.jobId), true);
      const [processed] = await sql`
        SELECT
          (SELECT processing_status FROM candidate_cv_records WHERE id = ${result.cvRecordId}) AS cv_status,
          (SELECT status FROM background_jobs WHERE id = ${result.jobId}) AS job_status,
          (SELECT count(*)::int FROM audit_events WHERE entity_id = ${result.cvRecordId} AND action = 'upload') AS audit_count
      `;
      assert.deepEqual(
        [processed.cv_status, processed.job_status, processed.audit_count],
        ["Awaiting HR Review", "Completed", 1],
      );
      const finalised = await finaliseCandidateCvIntakeInDatabase(
        String(hr.organisation_id),
        {
          cvRecordId: result.cvRecordId,
          candidate: {
            firstName: "Worker",
            lastName: "Test",
            email: `worker.test.${randomUUID()}@example.test`,
            phone: `+97150${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
            location: "Dubai",
            yearsOfExperience: 4,
          },
          consentStatus: "Confirmed",
        },
        actor,
      );
      const [confirmed] = await sql`
        SELECT candidate_id, processing_status FROM candidate_cv_records WHERE id = ${result.cvRecordId}
      `;
      assert.equal(String(confirmed.candidate_id), finalised.candidateId);
      assert.equal(confirmed.processing_status, "Ready");
    } finally {
      await sql.end();
    }
  },
);
