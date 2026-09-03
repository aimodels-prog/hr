import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import postgres from "postgres";

import { closeDatabaseConnection } from "../src/lib/db/client.ts";
import { processRecruitmentDeadlines } from "../src/lib/db/repositories/recruitment-deadline.repository.server.ts";
import {
  cleanupOrphanedFiles,
  ensureWorkerSchedules,
  getWorkerHealthSnapshot,
  heartbeatWorker,
  recoverBackgroundJobLeases,
  registerWorkerInstance,
  runScheduledWorkerTask,
} from "../src/lib/db/repositories/worker.repository.server.ts";

const testDatabaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (testDatabaseUrl) process.env["DATABASE_URL"] = testDatabaseUrl;

test(
  "worker leases, recovery, monitoring and orphan cleanup are durable",
  { skip: !testDatabaseUrl },
  async () => {
    assert.match(new URL(testDatabaseUrl!).pathname, /(test|scratch)/i);
    const query = postgres(testDatabaseUrl!, { max: 3, prepare: false });
    const suffix = randomUUID();
    const first = { id: randomUUID(), workerId: `worker-first-${suffix}` };
    const second = { id: randomUUID(), workerId: `worker-second-${suffix}` };
    const completedTask = `lease-test-${suffix}`;
    const failedTask = `failure-test-${suffix}`;
    let handlerCalls = 0;
    try {
      await registerWorkerInstance({ ...first, buildVersion: "test" });
      await registerWorkerInstance({ ...second, buildVersion: "test" });
      await heartbeatWorker(first.id);
      await heartbeatWorker(second.id);
      await ensureWorkerSchedules([
        { name: completedTask, intervalSeconds: 60 },
        { name: failedTask, intervalSeconds: 60 },
      ]);

      const outcomes = await Promise.all([
        runScheduledWorkerTask({ name: completedTask, intervalSeconds: 60 }, first, async () => {
          handlerCalls += 1;
          return { handled: true };
        }),
        runScheduledWorkerTask({ name: completedTask, intervalSeconds: 60 }, second, async () => {
          handlerCalls += 1;
          return { handled: true };
        }),
      ]);
      assert.equal(handlerCalls, 1, "only one replica may hold a scheduled-task lease");
      assert.deepEqual(outcomes.sort(), ["completed", "not-due"]);

      assert.equal(
        await runScheduledWorkerTask({ name: failedTask, intervalSeconds: 60 }, first, async () => {
          throw new Error("controlled worker failure");
        }),
        "failed",
      );
      const [failedState] = await query<
        { last_status: string; consecutive_failures: number; last_error: string }[]
      >`select last_status,consecutive_failures,last_error from worker_schedules where task_name=${failedTask}`;
      assert.equal(failedState?.last_status, "Failed");
      assert.equal(failedState?.consecutive_failures, 1);
      assert.match(failedState?.last_error ?? "", /controlled worker failure/);

      const [organisation] = await query<{ id: string; user_id: string }[]>`
      select o.id, u.id as user_id from organisations o join users u on u.organisation_id=o.id
      where o.is_active=true limit 1
    `;
      assert.ok(organisation);
      const recoverableJob = randomUUID();
      const deadJob = randomUUID();
      const staleAt = new Date(Date.now() - 30 * 60_000).toISOString();
      for (const [id, attempts, maxAttempts] of [
        [recoverableJob, 1, 5],
        [deadJob, 2, 2],
      ] as const) {
        await query`
        insert into background_jobs (
          id,organisation_id,module,job_type,entity_type,entity_id,status,attempts,max_attempts,
          next_attempt_at,locked_at,locked_by,created_by,updated_by
        ) values (
          ${id},${organisation.id},'test','worker-recovery-test','test-record',${randomUUID()},
          'Running',${attempts},${maxAttempts},now(),${staleAt},'stale-worker',
          ${organisation.user_id},${organisation.user_id}
        )
      `;
      }
      assert.deepEqual(await recoverBackgroundJobLeases(), { recovered: 1, deadLetters: 1 });
      const recovered = await query<{ id: string; status: string }[]>`
      select id,status from background_jobs where id in (${recoverableJob},${deadJob}) order by id
    `;
      assert.equal(recovered.find((item) => item.id === recoverableJob)?.status, "Retry Scheduled");
      assert.equal(recovered.find((item) => item.id === deadJob)?.status, "Failed");

      const orphanFile = randomUUID();
      const linkedFile = randomUUID();
      const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
      for (const id of [orphanFile, linkedFile]) {
        await query`
        insert into file_metadata (
          id,organisation_id,name,mime_type,size,storage_status,owner_entity_type,owner_entity_id,
          created_at,updated_at,created_by,updated_by
        ) values (
          ${id},${organisation.id},${`${id}.pdf`},'application/pdf',10,'Pending Upload','test',
          ${randomUUID()},${old},${old},${organisation.user_id},${organisation.user_id}
        )
      `;
      }
      await query`
      insert into import_batches (
        organisation_id,module,file_id,status,created_by,updated_by
      ) values (${organisation.id},'test',${linkedFile},'Uploaded',${organisation.user_id},${organisation.user_id})
    `;
      const cleanup = await cleanupOrphanedFiles();
      assert.ok(cleanup.pendingMetadata >= 1);
      const files = await query<{ id: string; storage_status: string }[]>`
      select id,storage_status from file_metadata where id in (${orphanFile},${linkedFile})
    `;
      assert.equal(files.find((item) => item.id === orphanFile)?.storage_status, "Deleted");
      assert.equal(files.find((item) => item.id === linkedFile)?.storage_status, "Pending Upload");
      const [cleanupAudit] = await query<{ count: string }[]>`
      select count(*)::text as count from audit_events where entity_id=${orphanFile} and action='delete-orphan'
    `;
      assert.equal(cleanupAudit?.count, "1");

      const health = await getWorkerHealthSnapshot();
      assert.ok(health.activeWorkers >= 2);
      assert.ok(health.failedJobs >= 1);
    } finally {
      await query.end();
      await closeDatabaseConnection();
    }
  },
);

test(
  "offer deadlines expire safely and reminders are idempotent",
  { skip: !testDatabaseUrl },
  async () => {
    const query = postgres(testDatabaseUrl!, { max: 3, prepare: false });
    const now = new Date("2026-09-02T08:00:00.000Z");
    const candidateId = randomUUID();
    const expiredOfferId = randomUUID();
    const dueOfferId = randomUUID();
    try {
      const [context] = await query<
        { organisation_id: string; user_id: string; vacancy_id: string }[]
      >`
      select o.id as organisation_id,u.id as user_id,v.id as vacancy_id
      from organisations o join users u on u.organisation_id=o.id
      join vacancies v on v.organisation_id=o.id
      where o.is_active=true limit 1
    `;
      assert.ok(context);
      await query`
      insert into candidates (
        id,organisation_id,first_name,last_name,email,phone,location,stage,created_by,updated_by
      ) values (
        ${candidateId},${context.organisation_id},'Deadline','Candidate',
        ${`deadline-${candidateId}@example.test`},${`+9715${candidateId.replaceAll("-", "").slice(0, 8)}`},
        'Dubai','Offer',${context.user_id},${context.user_id}
      )
    `;
      for (const [id, deadline] of [
        [expiredOfferId, "2026-09-02T07:59:00.000Z"],
        [dueOfferId, "2026-09-03T08:00:00.000Z"],
      ] as const) {
        await query`
        insert into job_offers (
          id,organisation_id,candidate_id,vacancy_id,status,template,position,grade,
          salary_encrypted,currency_encrypted,allowances_encrypted,benefits_encrypted,
          start_date,probation,location,conditions,sent_date,response_deadline,created_by,updated_by
        ) values (
          ${id},${context.organisation_id},${candidateId},${context.vacancy_id},'Sent','Standard',
          'Operations Specialist','G5','encrypted-salary','encrypted-currency','encrypted-allowances',
          'encrypted-benefits','2026-10-01','Six months','Dubai','Subject to references',
          '2026-09-01T08:00:00.000Z',${deadline},${context.user_id},${context.user_id}
        )
      `;
      }
      const first = await processRecruitmentDeadlines(now);
      assert.equal(first.expiredOffers, 1);
      assert.ok(first.reminders >= 2);
      const second = await processRecruitmentDeadlines(now);
      assert.equal(second.expiredOffers, 0);
      assert.equal(second.reminders, 0);
      const [expired] = await query<{ status: string }[]>`
      select status from job_offers where id=${expiredOfferId}
    `;
      assert.equal(expired?.status, "Expired");
      const [audit] = await query<{ count: string }[]>`
      select count(*)::text as count from audit_events where entity_id=${expiredOfferId} and action='expire'
    `;
      assert.equal(audit?.count, "1");
    } finally {
      await query.end();
      await closeDatabaseConnection();
    }
  },
);
