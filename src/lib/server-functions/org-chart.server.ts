import { createServerFn } from "@tanstack/react-start";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDatabaseClient } from "../db/client";
import { employees } from "../db/schema/employee";
import { appSettings } from "../db/schema/organisation";
import { auditEvents } from "../db/schema/system";
import { resolveOrganisationIdForActor, verifyServerActorRole } from "../db/utils.server";
import { ROLE_VALUES } from "../data/types";

const Actor = z.object({
  actorId: z.string().min(1),
  actorEmail: z.string().email().optional(),
  activeRole: z.enum(ROLE_VALUES),
});
async function verify(input: z.infer<typeof Actor>) {
  const organisationId = await resolveOrganisationIdForActor(input.actorId, input.actorEmail);
  const result = await verifyServerActorRole(
    organisationId,
    input.actorId,
    undefined,
    input.actorEmail,
  );
  if (!result.verified || !result.actor?.roles.includes(input.activeRole))
    throw new Error("Your VIA access could not be verified.");
  return { organisationId, actor: { ...result.actor, activeRole: input.activeRole } };
}
function headId(settings: Record<string, unknown>): string | null {
  return typeof settings["organisationChartHeadId"] === "string"
    ? settings["organisationChartHeadId"]
    : null;
}
export const getOrganisationChartHeadFn = createServerFn({ method: "POST" })
  .validator((input) => Actor.parse(input))
  .handler(async ({ data }) => {
    const { organisationId } = await verify(data);
    const [settings] = await getDatabaseClient()
      .select({ additional: appSettings.additionalSettings })
      .from(appSettings)
      .where(eq(appSettings.organisationId, organisationId))
      .limit(1);
    if (!settings) throw new Error("Organisation settings are unavailable.");
    return { employeeId: headId(settings.additional) };
  });

export const saveOrganisationChartHeadFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        employeeId: z.string().uuid().nullable(),
        previousEmployeeId: z.string().uuid().nullable(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { organisationId, actor } = await verify(data.actor);
    if (!["HR", "Super Admin"].includes(actor.activeRole))
      throw new Error("Only HR can arrange the organisation chart.");
    return getDatabaseClient().transaction(async (tx) => {
      const [settings] = await tx
        .select()
        .from(appSettings)
        .where(eq(appSettings.organisationId, organisationId))
        .for("update")
        .limit(1);
      if (!settings) throw new Error("Organisation settings are unavailable.");
      const previous = headId(settings.additionalSettings);
      if (previous !== data.previousEmployeeId)
        throw new Error("The company head has changed. Refresh the chart and try again.");
      if (data.employeeId) {
        const [employee] = await tx
          .select({ status: employees.status })
          .from(employees)
          .where(
            and(
              eq(employees.organisationId, organisationId),
              eq(employees.id, data.employeeId),
              isNull(employees.archivedAt),
            ),
          )
          .limit(1);
        if (!employee || ["Inactive", "Archived"].includes(employee.status))
          throw new Error("Choose a current employee.");
      }
      if (previous === data.employeeId) return { employeeId: previous };
      await tx
        .update(appSettings)
        .set({
          additionalSettings: {
            ...settings.additionalSettings,
            organisationChartHeadId: data.employeeId,
          },
          updatedAt: new Date(),
          updatedBy: actor.userId ?? settings.updatedBy,
          recordVersion: sql`${appSettings.recordVersion} + 1`,
        })
        .where(eq(appSettings.id, settings.id));
      await tx.insert(auditEvents).values({
        organisationId,
        actorUserId: actor.userId,
        actorEmployeeId: actor.employeeId,
        actorDisplayName: actor.displayName,
        activeRole: actor.activeRole,
        actorRoles: actor.roles,
        action: "update",
        module: "core-hr",
        entityType: "app_settings",
        entityId: settings.id,
        beforeSummary: { organisationChartHeadId: previous },
        afterSummary: { organisationChartHeadId: data.employeeId },
        reason:
          "Organisation chart head changed; reporting and approval responsibilities unchanged.",
        riskLevel: "Low",
      });
      return { employeeId: data.employeeId };
    });
  });
