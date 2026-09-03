import "@tanstack/react-start/server-only";

import { and, eq } from "drizzle-orm";

import { getDatabaseClient } from "./client.ts";
import { organisations } from "./schema/organisation.ts";

let cachedDefaultOrgId: string | null = null;

export async function resolveDefaultOrganisationId(): Promise<string> {
  if (cachedDefaultOrgId) return cachedDefaultOrgId;
  const db = getDatabaseClient();
  const configuredId = process.env["VIA_HR_ORGANISATION_ID"]?.trim();
  if (configuredId) {
    const [configured] = await db
      .select({ id: organisations.id })
      .from(organisations)
      .where(and(eq(organisations.id, configuredId), eq(organisations.isActive, true)))
      .limit(1);
    if (!configured) {
      throw new Error("VIA_HR_ORGANISATION_ID does not identify an active organisation.");
    }
    cachedDefaultOrgId = configured.id;
    return configured.id;
  }

  const activeOrganisations = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(eq(organisations.isActive, true))
    .limit(2);
  if (activeOrganisations.length === 0) throw new Error("No active organisation found.");
  if (activeOrganisations.length > 1) {
    throw new Error(
      "More than one active organisation exists. Set VIA_HR_ORGANISATION_ID explicitly.",
    );
  }
  cachedDefaultOrgId = activeOrganisations[0]!.id;
  return cachedDefaultOrgId;
}

export function clearDefaultOrganisationCacheForTests(): void {
  cachedDefaultOrgId = null;
}
