import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";

import postgres from "postgres";

import {
  finaliseCandidateCvIntakeInDatabase,
  processNextCandidateCvJob,
  uploadCandidateCvIntakeToDatabase,
} from "../src/lib/db/repositories/candidate-cv-intake.repository.server.ts";

const testDatabaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
const hasObjectStorage = Boolean(process.env["VIA_HR_OBJECT_STORAGE_ENDPOINT"]?.trim());
const hasCvProcessor = Boolean(process.env["VIA_HR_CV_PROCESSOR_URL"]?.trim());
if (testDatabaseUrl) process.env["DATABASE_URL"] = testDatabaseUrl;

function testPdf(): Uint8Array {
  const text = [
    "Worker Test worker.test@example.test +971501234567",
    "4 years of experience in logistics and supply chain operations",
    ...Array.from({ length: 24 }, () => "logistics supply chain customs clearance operations"),
  ].join(" ");
  const lines = text.match(/.{1,75}(?:\s|$)/g)?.map((line) => line.trim()) ?? [text];
  const stream = `BT /F1 9 Tf 40 760 Td ${lines
    .map((line, index) => `${index ? "0 -13 Td " : ""}(${line.replace(/([\\()])/g, "\\$1")}) Tj`)
    .join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

test(
  "direct CV intake is encrypted, durable and moved to HR review by the worker",
  { skip: !testDatabaseUrl || !hasObjectStorage || !hasCvProcessor },
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
      const pdf = testPdf();
      const pdfChecksum = createHash("sha256").update(pdf).digest("hex");
      const result = await uploadCandidateCvIntakeToDatabase(
        String(hr.organisation_id),
        {
          fileName: `direct-${randomUUID()}.pdf`,
          mimeType: "application/pdf",
          bytes: pdf,
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
      const repeated = await uploadCandidateCvIntakeToDatabase(
        String(hr.organisation_id),
        {
          fileName: `same-cv-${randomUUID()}.pdf`,
          mimeType: "application/pdf",
          bytes: pdf,
          source: "Direct Email",
          receivedAt: new Date().toISOString(),
          consentStatus: "Confirmed",
          isRecommended: false,
        },
        actor,
      );
      assert.equal(await processNextCandidateCvJob(`test:${randomUUID()}`, repeated.jobId), true);
      const [cache] = await sql`
        SELECT count(*)::int AS count
        FROM candidate_cv_extractions
        WHERE organisation_id = ${String(hr.organisation_id)}
          AND checksum = ${pdfChecksum}
      `;
      assert.equal(cache.count, 1, "identical CV bytes should reuse one extraction");
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
