import { checkDatabaseConnection, type DatabaseHealth } from "./db/client.ts";
import {
  getWorkerHealthSnapshot,
  type WorkerHealthSnapshot,
} from "./db/repositories/worker.repository.server.ts";

type DatabaseHealthCheck = () => Promise<DatabaseHealth>;
type WorkerHealthCheck = () => Promise<WorkerHealthSnapshot>;

const HEALTH_PATHS = new Set(["/health/live", "/health/ready", "/health/worker"]);

function jsonResponse(payload: unknown, status: number, method: string): Response {
  return new Response(method === "HEAD" ? null : JSON.stringify(payload), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * Resolves infrastructure health endpoints before application routing. It never
 * exposes credentials, connection strings, hostnames or raw database errors.
 */
export async function resolveHealthRequest(
  request: Request,
  databaseCheck: DatabaseHealthCheck = checkDatabaseConnection,
  workerCheck: WorkerHealthCheck = getWorkerHealthSnapshot,
): Promise<Response | undefined> {
  const path = new URL(request.url).pathname;
  if (!HEALTH_PATHS.has(path)) return undefined;

  if (request.method !== "GET" && request.method !== "HEAD") {
    const response = jsonResponse(
      { status: "method_not_allowed", checkedAt: new Date().toISOString() },
      405,
      request.method,
    );
    response.headers.set("allow", "GET, HEAD");
    return response;
  }

  const checkedAt = new Date().toISOString();
  if (path === "/health/live") {
    return jsonResponse({ status: "ok", service: "via-hr-system", checkedAt }, 200, request.method);
  }

  if (path === "/health/worker") {
    try {
      const worker = await workerCheck();
      return jsonResponse(
        {
          status: worker.healthy ? "healthy" : "unhealthy",
          service: "via-hr-background-worker",
          activeWorkers: worker.activeWorkers,
          staleWorkers: worker.staleWorkers,
          queuedJobs: worker.queuedJobs,
          retryJobs: worker.retryJobs,
          failedJobs: worker.failedJobs,
          overdueSchedules: worker.overdueSchedules,
          checkedAt: worker.checkedAt,
        },
        worker.healthy ? 200 : 503,
        request.method,
      );
    } catch {
      return jsonResponse(
        {
          status: "unavailable",
          service: "via-hr-background-worker",
          checkedAt,
        },
        503,
        request.method,
      );
    }
  }

  try {
    const database = await databaseCheck();
    return jsonResponse(
      {
        status: "ready",
        service: "via-hr-system",
        database: "ok",
        databaseLatencyMs: database.latencyMs,
        checkedAt,
      },
      200,
      request.method,
    );
  } catch {
    return jsonResponse(
      {
        status: "not_ready",
        service: "via-hr-system",
        database: "unavailable",
        checkedAt,
      },
      503,
      request.method,
    );
  }
}
