import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("production bootstrap never seeds business records or resumes CV work in the browser", async () => {
  const [applicationData, root] = await Promise.all([
    source("src/lib/data/application-data.ts"),
    source("src/routes/__root.tsx"),
  ]);
  assert.match(applicationData, /if \(import\.meta\.env\.PROD\) return null/);
  assert.doesNotMatch(root, /resumePendingRuns|CandidatePreparationService/);
});

test("candidate conversion and employee-profile offboarding use PostgreSQL server workflows", async () => {
  const [conversion, employeeProfile] = await Promise.all([
    source("src/lib/data/conversion-service.ts"),
    source("src/routes/staff/employees/-profile/employee-profile-view.tsx"),
  ]);
  assert.match(conversion, /convertAcceptedJobOfferFn/);
  assert.match(employeeProfile, /await offboardingService\.startCaseAsync\(/);
  assert.doesNotMatch(employeeProfile, /offboardingService\.startCase\(/);
});

test("on-behalf overtime sends evidence to secure server storage without IndexedDB", async () => {
  const dialog = await source("src/components/overtime/overtime-on-behalf-dialog.tsx");
  assert.match(dialog, /context,\s*evidence \?\? undefined/);
  assert.doesNotMatch(dialog, /getApplicationDataServices\(\)\.files/);
});

test("missing-day attendance corrections are created by the PostgreSQL transaction", async () => {
  const [page, repository] = await Promise.all([
    source("src/routes/staff/me/attendance.tsx"),
    source("src/lib/db/repositories/attendance.repository.server.ts"),
  ]);
  assert.doesNotMatch(page, /ensureRecordForDate\(/);
  assert.match(repository, /\.insert\(attendanceRecords\)/);
  assert.match(repository, /\.insert\(attendanceCorrections\)/);
});
