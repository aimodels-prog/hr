import "@tanstack/react-start/server-only";

import { hostname } from "node:os";

import { and, eq, lt, sql } from "drizzle-orm";

import { getDatabaseClient } from "../client.ts";
import { deleteObjectFile } from "../object-storage.server.ts";
import { fileMetadata } from "../schema/documents.ts";
import { auditEvents, workerInstances, workerSchedules, workerTaskRuns } from "../schema/system.ts";

export interface WorkerTaskDefinition {
  name: string;
  intervalSeconds: number;
  leaseSeconds?: number;
  suppressFalseResult?: boolean;
}

export interface WorkerHealthSnapshot {
  healthy: boolean;
  checkedAt: string;
  activeWorkers: number;
  staleWorkers: number;
  queuedJobs: number;
  retryJobs: number;
  failedJobs: number;
  overdueSchedules: number;
  lastHeartbeatAt?: string;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[database connection redacted]")
    .slice(0, 2000);
}

export async function registerWorkerInstance(input: {
  id: string;
  workerId: string;
  buildVersion: string;
}): Promise<void> {
  const db = getDatabaseClient();
  await db.insert(workerInstances).values({
    id: input.id,
    workerId: input.workerId,
    hostname: hostname().slice(0, 255),
    buildVersion: input.buildVersion.slice(0, 120),
    status: "Running",
  });
}

export async function heartbeatWorker(instanceId: string, lastError?: string): Promise<void> {
  const db = getDatabaseClient();
  await db
    .update(workerInstances)
    .set({
      status: "Running",
      heartbeatAt: new Date(),
      ...(lastError === undefined ? {} : { lastError: lastError.slice(0, 2000) || null }),
    })
    .where(eq(workerInstances.id, instanceId));
}

export async function stopWorkerInstance(instanceId: string): Promise<void> {
  const db = getDatabaseClient();
  await db
    .update(workerInstances)
    .set({ status: "Stopped", stoppedAt: new Date(), heartbeatAt: new Date() })
    .where(eq(workerInstances.id, instanceId));
}

export async function ensureWorkerSchedules(definitions: WorkerTaskDefinition[]): Promise<void> {
  const db = getDatabaseClient();
  for (const definition of definitions) {
    if (!definition.name.trim() || definition.intervalSeconds < 1) {
      throw new Error("Worker schedule definition is invalid.");
    }
    await db
      .insert(workerSchedules)
      .values({ taskName: definition.name, intervalSeconds: definition.intervalSeconds })
      .onConflictDoUpdate({
        target: workerSchedules.taskName,
        set: { intervalSeconds: definition.intervalSeconds },
      });
  }
}

async function claimSchedule(definition: WorkerTaskDefinition, workerId: string): Promise<boolean> {
  const db = getDatabaseClient();
  const leaseSeconds = Math.max(30, definition.leaseSeconds ?? 15 * 60);
  const claimed = await db.execute(sql`
    UPDATE worker_schedules
    SET locked_by=${workerId},
        lease_expires_at=now() + make_interval(secs => ${leaseSeconds}),
        last_started_at=now()
    WHERE task_name=${definition.name}
      AND next_run_at <= now()
      AND (lease_expires_at IS NULL OR lease_expires_at < now())
    RETURNING task_name
  `);
  return claimed.length === 1;
}

export async function runScheduledWorkerTask(
  definition: WorkerTaskDefinition,
  instance: { id: string; workerId: string },
  handler: () => Promise<unknown>,
): Promise<"not-due" | "idle" | "completed" | "failed"> {
  if (!(await claimSchedule(definition, instance.workerId))) return "not-due";
  const db = getDatabaseClient();
  const [run] = await db
    .insert(workerTaskRuns)
    .values({ workerInstanceId: instance.id, taskName: definition.name })
    .returning({ id: workerTaskRuns.id, startedAt: workerTaskRuns.startedAt });
  if (!run) throw new Error("Worker run could not be recorded.");
  try {
    const result = await handler();
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - run.startedAt.getTime();
    const idle = result === false && definition.suppressFalseResult;
    await db.transaction(async (tx) => {
      if (idle) {
        await tx.delete(workerTaskRuns).where(eq(workerTaskRuns.id, run.id));
      } else {
        await tx
          .update(workerTaskRuns)
          .set({ status: "Completed", completedAt, durationMs, result: result ?? {} })
          .where(eq(workerTaskRuns.id, run.id));
      }
      await tx
        .update(workerSchedules)
        .set({
          nextRunAt: new Date(completedAt.getTime() + definition.intervalSeconds * 1000),
          lockedBy: null,
          leaseExpiresAt: null,
          lastCompletedAt: completedAt,
          lastStatus: "Completed",
          lastResult: result ?? {},
          lastError: null,
          consecutiveFailures: 0,
        })
        .where(
          and(
            eq(workerSchedules.taskName, definition.name),
            eq(workerSchedules.lockedBy, instance.workerId),
          ),
        );
    });
    return idle ? "idle" : "completed";
  } catch (error) {
    const completedAt = new Date();
    const message = errorMessage(error);
    const durationMs = completedAt.getTime() - run.startedAt.getTime();
    await db.transaction(async (tx) => {
      const [state] = await tx
        .select({ consecutiveFailures: workerSchedules.consecutiveFailures })
        .from(workerSchedules)
        .where(eq(workerSchedules.taskName, definition.name))
        .limit(1);
      const failures = (state?.consecutiveFailures ?? 0) + 1;
      const retrySeconds = Math.min(
        definition.intervalSeconds,
        Math.max(30, 30 * 2 ** Math.min(failures, 8)),
      );
      await tx
        .update(workerTaskRuns)
        .set({ status: "Failed", completedAt, durationMs, error: message })
        .where(eq(workerTaskRuns.id, run.id));
      await tx
        .update(workerSchedules)
        .set({
          nextRunAt: new Date(completedAt.getTime() + retrySeconds * 1000),
          lockedBy: null,
          leaseExpiresAt: null,
          lastCompletedAt: completedAt,
          lastStatus: "Failed",
          lastError: message,
          consecutiveFailures: failures,
        })
        .where(eq(workerSchedules.taskName, definition.name));
      await tx
        .update(workerInstances)
        .set({ lastError: `${definition.name}: ${message}`.slice(0, 2000) })
        .where(eq(workerInstances.id, instance.id));
    });
    return "failed";
  }
}

/** Recover abandoned generic queue leases and expose exhausted work as a dead-letter failure. */
export async function recoverBackgroundJobLeases(
  now = new Date(),
): Promise<{ recovered: number; deadLetters: number }> {
  const db = getDatabaseClient();
  const nowIso = now.toISOString();
  const staleIso = new Date(now.getTime() - 15 * 60_000).toISOString();
  const recovered = await db.execute(sql`
    UPDATE background_jobs
    SET status=CASE WHEN attempts >= max_attempts THEN 'Failed'::background_job_status ELSE 'Retry Scheduled'::background_job_status END,
        next_attempt_at=${nowIso}, locked_at=NULL, locked_by=NULL,
        last_error=CASE WHEN attempts >= max_attempts THEN coalesce(last_error,'Worker lease expired after final attempt') ELSE coalesce(last_error,'Worker lease expired; scheduled for recovery') END,
        updated_at=${nowIso}, record_version=record_version+1
    WHERE status='Running' AND locked_at < ${staleIso}
    RETURNING status
  `);
  return {
    recovered: recovered.filter((row) => row["status"] === "Retry Scheduled").length,
    deadLetters: recovered.filter((row) => row["status"] === "Failed").length,
  };
}

export async function pruneWorkerRunHistory(now = new Date()): Promise<{ deletedRuns: number }> {
  const db = getDatabaseClient();
  const cutoff = new Date(now.getTime() - 35 * 86_400_000);
  const deleted = await db
    .delete(workerTaskRuns)
    .where(and(lt(workerTaskRuns.startedAt, cutoff), sql`${workerTaskRuns.status} <> 'Running'`))
    .returning({ id: workerTaskRuns.id });
  await db
    .update(workerInstances)
    .set({ status: "Stale" })
    .where(
      and(
        eq(workerInstances.status, "Running"),
        lt(workerInstances.heartbeatAt, new Date(now.getTime() - 2 * 60_000)),
      ),
    );
  return { deletedRuns: deleted.length };
}

/** Deletes only old file records that have no reference in any production workflow table. */
export async function cleanupOrphanedFiles(
  now = new Date(),
): Promise<{ pendingMetadata: number; storedObjects: number }> {
  const db = getDatabaseClient();
  const cutoff = new Date(now.getTime() - 24 * 60 * 60_000);
  const nowIso = now.toISOString();
  const cutoffIso = cutoff.toISOString();
  const pending = await db.transaction(async (tx) => {
    const rows = await tx.execute(sql`
      UPDATE file_metadata
      SET storage_status='Deleted', archived_at=${nowIso}, updated_at=${nowIso}, record_version=record_version+1
      WHERE storage_status='Pending Upload' AND created_at < ${cutoffIso}
        AND NOT EXISTS (SELECT 1 FROM recruitment_documents x WHERE x.id=file_metadata.id)
        AND NOT EXISTS (SELECT 1 FROM employee_documents x WHERE x.file_id=file_metadata.id)
        AND NOT EXISTS (SELECT 1 FROM document_versions x WHERE x.file_id=file_metadata.id)
        AND NOT EXISTS (SELECT 1 FROM import_batches x WHERE x.file_id=file_metadata.id)
        AND NOT EXISTS (SELECT 1 FROM leave_requests x WHERE x.attachment_file_id=file_metadata.id)
        AND NOT EXISTS (SELECT 1 FROM onboarding_tasks x WHERE x.evidence_file_id=file_metadata.id)
        AND NOT EXISTS (SELECT 1 FROM offboarding_tasks x WHERE x.evidence_file_id=file_metadata.id)
        AND NOT EXISTS (SELECT 1 FROM attendance_corrections x WHERE x.evidence_file_id=file_metadata.id)
        AND NOT EXISTS (SELECT 1 FROM overtime_claims x WHERE x.evidence_file_id=file_metadata.id)
        AND NOT EXISTS (SELECT 1 FROM travel_requests x WHERE x.evidence_file_id=file_metadata.id)
        AND NOT EXISTS (SELECT 1 FROM expense_items x WHERE x.receipt_file_id=file_metadata.id)
        AND NOT EXISTS (SELECT 1 FROM payroll_manual_adjustments x WHERE x.evidence_file_id=file_metadata.id)
        AND NOT EXISTS (SELECT 1 FROM goal_check_ins x WHERE x.evidence_file_id=file_metadata.id)
        AND NOT EXISTS (SELECT 1 FROM training_records x WHERE x.certificate_file_id=file_metadata.id)
      RETURNING id, organisation_id, owner_entity_id
    `);
    for (const row of rows) {
      await tx.insert(auditEvents).values({
        organisationId: String(row["organisation_id"]),
        actorDisplayName: "VIA background worker",
        activeRole: "Super Admin",
        actorRoles: ["Super Admin"],
        action: "delete-orphan",
        module: "files",
        entityType: "file",
        entityId: String(row["id"]),
        reason: "Removed incomplete file metadata left without a completed upload.",
        riskLevel: "Medium",
      });
    }
    return rows;
  });
  const candidates = await db.execute(sql`
    SELECT f.id, f.organisation_id
    FROM file_metadata f
    WHERE f.storage_status='Available' AND f.created_at < ${cutoffIso}
      AND NOT EXISTS (SELECT 1 FROM recruitment_documents x WHERE x.id=f.id)
      AND NOT EXISTS (SELECT 1 FROM employee_documents x WHERE x.file_id=f.id)
      AND NOT EXISTS (SELECT 1 FROM document_versions x WHERE x.file_id=f.id)
      AND NOT EXISTS (SELECT 1 FROM import_batches x WHERE x.file_id=f.id)
      AND NOT EXISTS (SELECT 1 FROM leave_requests x WHERE x.attachment_file_id=f.id)
      AND NOT EXISTS (SELECT 1 FROM onboarding_tasks x WHERE x.evidence_file_id=f.id)
      AND NOT EXISTS (SELECT 1 FROM offboarding_tasks x WHERE x.evidence_file_id=f.id)
      AND NOT EXISTS (SELECT 1 FROM attendance_corrections x WHERE x.evidence_file_id=f.id)
      AND NOT EXISTS (SELECT 1 FROM overtime_claims x WHERE x.evidence_file_id=f.id)
      AND NOT EXISTS (SELECT 1 FROM travel_requests x WHERE x.evidence_file_id=f.id)
      AND NOT EXISTS (SELECT 1 FROM expense_items x WHERE x.receipt_file_id=f.id)
      AND NOT EXISTS (SELECT 1 FROM payroll_manual_adjustments x WHERE x.evidence_file_id=f.id)
      AND NOT EXISTS (SELECT 1 FROM goal_check_ins x WHERE x.evidence_file_id=f.id)
      AND NOT EXISTS (SELECT 1 FROM training_records x WHERE x.certificate_file_id=f.id)
    ORDER BY f.created_at
    LIMIT 100
  `);
  let storedObjects = 0;
  for (const candidate of candidates) {
    await deleteObjectFile(
      String(candidate["organisation_id"]),
      String(candidate["id"]),
      { displayName: "VIA background worker", activeRole: "Super Admin", roles: ["Super Admin"] },
      "Removed encrypted object with no linked production record after the safety window.",
    );
    storedObjects += 1;
  }
  return { pendingMetadata: pending.length, storedObjects };
}

export async function getWorkerHealthSnapshot(now = new Date()): Promise<WorkerHealthSnapshot> {
  const db = getDatabaseClient();
  const staleCutoff = new Date(now.getTime() - 2 * 60_000);
  const staleIso = staleCutoff.toISOString();
  const nowIso = now.toISOString();
  const [workerRows, queueRows, overdueRows] = await Promise.all([
    db.execute(sql`
      SELECT
        count(*) FILTER (WHERE status='Running' AND heartbeat_at >= ${staleIso})::int AS active,
        count(*) FILTER (WHERE status IN ('Running','Stale') AND heartbeat_at < ${staleIso})::int AS stale,
        max(heartbeat_at) AS last_heartbeat
      FROM worker_instances
    `),
    db.execute(sql`
      SELECT
        count(*) FILTER (WHERE status='Queued')::int AS queued,
        count(*) FILTER (WHERE status='Retry Scheduled')::int AS retry,
        count(*) FILTER (WHERE status='Failed')::int AS failed
      FROM background_jobs
    `),
    db.execute(sql`
      SELECT count(*)::int AS overdue FROM worker_schedules
      WHERE next_run_at < ${new Date(now.getTime() - 5 * 60_000).toISOString()}
        AND (lease_expires_at IS NULL OR lease_expires_at < ${nowIso})
    `),
  ]);
  const workers = workerRows[0] as Record<string, unknown> | undefined;
  const queues = queueRows[0] as Record<string, unknown> | undefined;
  const overdue = Number((overdueRows[0] as Record<string, unknown> | undefined)?.["overdue"] ?? 0);
  const activeWorkers = Number(workers?.["active"] ?? 0);
  const staleWorkers = Number(workers?.["stale"] ?? 0);
  return {
    healthy: activeWorkers > 0 && overdue === 0,
    checkedAt: now.toISOString(),
    activeWorkers,
    staleWorkers,
    queuedJobs: Number(queues?.["queued"] ?? 0),
    retryJobs: Number(queues?.["retry"] ?? 0),
    failedJobs: Number(queues?.["failed"] ?? 0),
    overdueSchedules: overdue,
    ...(workers?.["last_heartbeat"]
      ? { lastHeartbeatAt: new Date(String(workers["last_heartbeat"])).toISOString() }
      : {}),
  };
}
