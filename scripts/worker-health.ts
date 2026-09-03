import { closeDatabaseConnection } from "../src/lib/db/client.ts";
import { getWorkerHealthSnapshot } from "../src/lib/db/repositories/worker.repository.server.ts";

try {
  const health = await getWorkerHealthSnapshot();
  process.stdout.write(`${JSON.stringify(health)}\n`);
  if (!health.healthy) process.exitCode = 1;
} catch {
  process.stderr.write("Worker health is unavailable.\n");
  process.exitCode = 1;
} finally {
  await closeDatabaseConnection().catch(() => undefined);
}
