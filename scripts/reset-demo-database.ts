import { databaseConnectionArgument, databaseEnvironment, runCommand } from "./backup-support.ts";

async function main(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"]?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
  if (process.env["NODE_ENV"] === "production")
    throw new Error("Demo reset is disabled in production.");
  if (process.env["VIA_HR_ALLOW_DEMO_RESET"] !== "true") {
    throw new Error("Set VIA_HR_ALLOW_DEMO_RESET=true for an intentional non-production reset.");
  }
  if (!/(demo|test|dev|scratch|local)/i.test(databaseName)) {
    throw new Error("Demo reset database name must contain demo, test, dev, scratch or local.");
  }
  if (process.env["VIA_HR_DEMO_RESET_CONFIRM"] !== databaseName) {
    throw new Error(`Set VIA_HR_DEMO_RESET_CONFIRM=${databaseName} to confirm the exact target.`);
  }
  const environment = databaseEnvironment(databaseUrl);
  await runCommand(
    "psql",
    [
      databaseConnectionArgument(databaseUrl),
      "--set=ON_ERROR_STOP=1",
      "--command=DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;",
    ],
    environment,
  );
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  await runCommand(npmCommand, ["run", "db:migrate"], environment);
  await runCommand(npmCommand, ["run", "db:seed:import"], environment);
  await runCommand(npmCommand, ["run", "db:seed:verify"], environment);
  console.log(JSON.stringify({ status: "completed", database: databaseName }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Demo reset failed.");
  process.exitCode = 1;
});
