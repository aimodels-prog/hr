import { randomUUID } from "node:crypto";

import { processNextCandidateCvJob } from "../src/lib/db/repositories/candidate-cv-intake.repository.server.ts";
import { processAttendanceScheduledWork } from "../src/lib/db/repositories/attendance.repository.server.ts";
import { processCoreHrScheduledReminders } from "../src/lib/db/repositories/core-hr-reminder.repository.server.ts";
import { processScheduledLeaveRollover } from "../src/lib/db/repositories/leave.repository.server.ts";
import { processTimesheetWorker } from "../src/lib/db/repositories/timesheet.repository.server.ts";
import { processOvertimeWorker } from "../src/lib/db/repositories/overtime.repository.server.ts";
import { processTravelWorker } from "../src/lib/db/repositories/travel.repository.server.ts";
import { processTrainingWorker } from "../src/lib/db/repositories/training.repository.server.ts";
import { processTaskWorker } from "../src/lib/db/repositories/task.repository.server.ts";
import { processRecruitmentDeadlines } from "../src/lib/db/repositories/recruitment-deadline.repository.server.ts";
import {
  cleanupOrphanedFiles,
  ensureWorkerSchedules,
  heartbeatWorker,
  pruneWorkerRunHistory,
  recoverBackgroundJobLeases,
  registerWorkerInstance,
  runScheduledWorkerTask,
  stopWorkerInstance,
  type WorkerTaskDefinition,
} from "../src/lib/db/repositories/worker.repository.server.ts";
import { closeDatabaseConnection } from "../src/lib/db/client.ts";

const instanceId = randomUUID();
const workerId = `via-background-worker:${process.pid}:${instanceId}`;
const buildVersion = process.env["VIA_HR_IMAGE_TAG"]?.trim() || "development";
let stopping = false;

const tasks: Array<WorkerTaskDefinition & { run: () => Promise<unknown> }> = [
  {
    name: "candidate-cv-processing",
    intervalSeconds: 2,
    leaseSeconds: 15 * 60,
    suppressFalseResult: true,
    run: () => processNextCandidateCvJob(workerId),
  },
  {
    name: "attendance-reminders-and-site-visits",
    intervalSeconds: 60,
    run: () => processAttendanceScheduledWork(),
  },
  {
    name: "core-hr-document-and-anniversary-reminders",
    intervalSeconds: 60 * 60,
    run: () => processCoreHrScheduledReminders(),
  },
  { name: "leave-rollover", intervalSeconds: 60 * 60, run: () => processScheduledLeaveRollover() },
  {
    name: "timesheet-reminders-and-reconciliation",
    intervalSeconds: 15 * 60,
    run: () => processTimesheetWorker(),
  },
  { name: "overtime-reminders", intervalSeconds: 15 * 60, run: () => processOvertimeWorker() },
  { name: "travel-reminders", intervalSeconds: 15 * 60, run: () => processTravelWorker() },
  {
    name: "training-assignments-and-reminders",
    intervalSeconds: 60 * 60,
    run: () => processTrainingWorker(),
  },
  {
    name: "offer-and-response-deadlines",
    intervalSeconds: 5 * 60,
    run: () => processRecruitmentDeadlines(),
  },
  {
    name: "workflow-task-projection-and-escalation",
    intervalSeconds: 5 * 60,
    run: () => processTaskWorker(),
  },
  { name: "abandoned-job-recovery", intervalSeconds: 60, run: () => recoverBackgroundJobLeases() },
  { name: "orphan-file-cleanup", intervalSeconds: 60 * 60, run: () => cleanupOrphanedFiles() },
  {
    name: "worker-history-retention",
    intervalSeconds: 24 * 60 * 60,
    run: () => pruneWorkerRunHistory(),
  },
];

process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function run(): Promise<void> {
  await registerWorkerInstance({ id: instanceId, workerId, buildVersion });
  await ensureWorkerSchedules(tasks);
  process.stdout.write(`[${workerId}] started ${buildVersion}\n`);
  let nextHeartbeat = 0;
  let lastError = "";
  try {
    while (!stopping) {
      if (Date.now() >= nextHeartbeat) {
        await heartbeatWorker(instanceId, lastError);
        nextHeartbeat = Date.now() + 15_000;
        lastError = "";
      }
      for (const task of tasks) {
        if (stopping) break;
        const status = await runScheduledWorkerTask(task, { id: instanceId, workerId }, task.run);
        if (status !== "not-due" && status !== "idle")
          process.stdout.write(`[${workerId}] ${task.name} ${status}\n`);
        if (status === "failed") lastError = `${task.name} failed; review worker task history.`;
      }
      await wait(1_000);
    }
  } finally {
    await stopWorkerInstance(instanceId).catch(() => undefined);
    await closeDatabaseConnection();
    process.stdout.write(`[${workerId}] stopped\n`);
  }
}

await run().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[${workerId}] fatal: ${message}\n`);
  await heartbeatWorker(instanceId, message).catch(() => undefined);
  await closeDatabaseConnection().catch(() => undefined);
  process.exitCode = 1;
});
