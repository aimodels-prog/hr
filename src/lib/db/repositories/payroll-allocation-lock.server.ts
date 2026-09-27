import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";
import type { getDatabaseClient } from "../client.ts";

type Transaction = Parameters<
  Parameters<ReturnType<typeof getDatabaseClient>["transaction"]>[0]
>[0];

/**
 * A period row lock cannot protect unallocated claims shared by DIFFERENT periods.
 * All collectors and manual source assignments take this organisation-scoped lock
 * BEFORE locking periods or claims. PostgreSQL releases it on commit or rollback,
 * including across application workers; other organisations remain independent.
 */
export async function lockPayrollSourceAllocation(tx: Transaction, organisationId: string) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`via-hr:payroll-allocation:${organisationId}`}, 0))`,
  );
}
