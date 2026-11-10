import "@tanstack/react-start/server-only";

import { eq } from "drizzle-orm";
import { getDatabaseClient, type ViaHrDatabase } from "../client.ts";
import { appSettings } from "../schema/organisation.ts";
import {
  parseApprovalRoutingSettings,
  type ApprovalRoutingSettings,
} from "../../data/approval-routing-settings.ts";

type Transaction = Parameters<Parameters<ViaHrDatabase["transaction"]>[0]>[0];

/** Read the current organisation policy inside the caller's decision transaction. */
export async function getApprovalRoutingSettingsInDatabase(
  organisationId: string,
  tx?: Transaction,
): Promise<ApprovalRoutingSettings> {
  const reader = tx ?? getDatabaseClient();
  const [row] = await reader
    .select({ additionalSettings: appSettings.additionalSettings })
    .from(appSettings)
    .where(eq(appSettings.organisationId, organisationId))
    .limit(1);
  if (!row) throw new Error("Application settings have not been initialised.");
  return parseApprovalRoutingSettings(row.additionalSettings["approvalRouting"]);
}
