import "@tanstack/react-start/server-only";

import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import * as schema from "./schema/index.ts";

export type ViaHrDatabase = PostgresJsDatabase<typeof schema>;

export interface DatabaseHealth {
  ok: true;
  checkedAt: string;
  latencyMs: number;
}

interface DatabaseRuntime {
  connectionString: string;
  database: ViaHrDatabase;
  queryClient: Sql;
}

let runtime: DatabaseRuntime | undefined;

export class DatabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigurationError";
  }
}

function readDatabaseUrl(): string {
  const value = process.env["DATABASE_URL"]?.trim();
  if (!value) {
    throw new DatabaseConfigurationError(
      "DATABASE_URL is not configured. Set it in the server environment before using PostgreSQL.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new DatabaseConfigurationError("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new DatabaseConfigurationError(
      "DATABASE_URL must use the postgres or postgresql protocol.",
    );
  }

  return value;
}

function readPoolSize(): number {
  const configured = Number(process.env["DATABASE_POOL_SIZE"] ?? "5");
  if (!Number.isInteger(configured) || configured < 1 || configured > 20) {
    throw new DatabaseConfigurationError(
      "DATABASE_POOL_SIZE must be a whole number between 1 and 20.",
    );
  }
  return configured;
}

/**
 * Returns the one lazy PostgreSQL/Drizzle client for the current server runtime.
 * Environment variables are read when this function is called, never at module
 * load, so secrets are not included in the browser bundle and edge runtimes can
 * supply request-time environment bindings.
 */
export function getDatabaseClient(): ViaHrDatabase {
  const connectionString = readDatabaseUrl();
  if (runtime?.connectionString === connectionString) return runtime.database;

  if (runtime) {
    void runtime.queryClient.end({ timeout: 5 });
  }

  const queryClient = postgres(connectionString, {
    max: readPoolSize(),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  const database = drizzle(queryClient, { schema });
  runtime = { connectionString, database, queryClient };
  return database;
}

export async function checkDatabaseConnection(): Promise<DatabaseHealth> {
  const startedAt = Date.now();
  await getDatabaseClient().execute(sql`select 1 as connected`);
  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    latencyMs: Date.now() - startedAt,
  };
}

export async function closeDatabaseConnection(): Promise<void> {
  const current = runtime;
  runtime = undefined;
  if (current) await current.queryClient.end({ timeout: 5 });
}
