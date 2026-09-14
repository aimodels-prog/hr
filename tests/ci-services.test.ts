import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Both database quality gates provision pinned MinIO and the required CV processor", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/quality.yml", import.meta.url),
    "utf8",
  );
  const script = readFileSync(new URL("../scripts/start-ci-services.sh", import.meta.url), "utf8");
  assert.equal((workflow.match(/bash scripts\/start-ci-services.sh/g) ?? []).length, 2);
  assert.equal(
    (workflow.match(/VIA_HR_CV_PROCESSOR_URL: http:\/\/127\.0\.0\.1:8080/g) ?? []).length,
    2,
  );
  assert.match(script, /quay\.io\/minio\/minio:RELEASE\.2025-07-23T15-54-02Z@sha256:[a-f0-9]{64}/);
  assert.doesNotMatch(workflow, /\sminio\/minio:/);
  assert.match(script, /trap diagnostics ERR/);
  assert.match(script, /docker build --tag via-hr-ci-cv-processor:local services\/cv-processor/);
  assert.match(script, /wait_ready via-hr-ci-cv-processor/);
  assert.match(workflow, /grep --quiet '\^# skipped 0\$' live-tests\.tap/);
  assert.equal((workflow.match(/ci-services\.log/g) ?? []).length, 4);
  assert.match(
    workflow,
    /Install locked dependencies and Chromium\s+run: \|\s+npm ci --include=dev/,
  );
});
