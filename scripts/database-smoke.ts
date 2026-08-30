import {
  checkDatabaseConnection,
  closeDatabaseConnection,
  DatabaseConfigurationError,
} from "../src/lib/db/client.ts";

try {
  const result = await checkDatabaseConnection();
  console.log(`PostgreSQL is reachable (${result.latencyMs} ms).`);
} catch (error) {
  if (error instanceof DatabaseConfigurationError) {
    console.error(error.message);
  } else {
    console.error("PostgreSQL connection failed.", error);
  }
  process.exitCode = 1;
} finally {
  await closeDatabaseConnection();
}
