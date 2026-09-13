import "@tanstack/react-start/server-only";
import { eq } from "drizzle-orm";
import { getDatabaseClient } from "../client.ts";
import { appSettings } from "../schema/organisation.ts";
import { leaveYearForDate } from "../../data/leave-year.ts";

export async function organisationLeaveYear(
  organisationId: string,
  date?: string,
  db: Pick<ReturnType<typeof getDatabaseClient>, "select"> = getDatabaseClient(),
) {
  const [settings] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.organisationId, organisationId))
    .limit(1);
  if (!settings) throw new Error("Organisation leave-year settings are unavailable.");
  const localDate =
    date ??
    new Intl.DateTimeFormat("en-CA", {
      timeZone: settings.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  return leaveYearForDate(localDate, settings.leaveYearStart);
}
