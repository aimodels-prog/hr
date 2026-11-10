import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";
import { ROLE_VALUES } from "../data/types.ts";
import { REQUEST_GROUPS, REQUEST_MODULES, isApprovalTask } from "../data/request-tracking.ts";
import { resolveOrganisationIdForActor, verifyServerActorRole } from "../db/utils.server.ts";
import { listTrackedRequests } from "../db/repositories/request-tracking.repository.server.ts";
import { listTasksForActorInDatabase } from "../db/repositories/task.repository.server.ts";
import { listTravelRequestsForActor } from "../db/repositories/travel.repository.server.ts";
import { and, eq, isNull } from "drizzle-orm";
import { getDatabaseClient } from "../db/client.ts";
import { hrIndependentReviewAssignments } from "../db/schema/hr-independent-review.ts";
const Actor = z.object({
  actorId: z.string().min(1),
  actorEmail: z.string().email().optional(),
  activeRole: z.enum(ROLE_VALUES),
});
async function verify(actor: z.infer<typeof Actor>) {
  const organisationId = await resolveOrganisationIdForActor(actor.actorId, actor.actorEmail);
  const verified = await verifyServerActorRole(
    organisationId,
    actor.actorId,
    undefined,
    actor.actorEmail,
  );
  if (!verified.verified || !verified.actor?.roles.includes(actor.activeRole))
    throw new Error("Your VIA access could not be verified.");
  return { organisationId, actor: { ...verified.actor, activeRole: actor.activeRole } };
}
export const getTrackedRequestsFn = createServerFn({ method: "GET" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        scope: z.enum(["my", "organisation", "reviewed"]),
        page: z.number().int().min(1).max(100000),
        query: z.string().max(160).optional(),
        module: z.enum(["All", ...REQUEST_MODULES]).optional(),
        group: z.enum(REQUEST_GROUPS).optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    return listTrackedRequests(verified.organisationId, verified.actor, data);
  });

export const getTrackedRequestDetailFn = createServerFn({ method: "GET" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        module: z.enum(REQUEST_MODULES),
        requestId: z.uuid(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    const common = {
      page: 1,
      module: data.module,
      requestId: data.requestId,
      includeDetails: true,
    };
    const scopes: Array<"my" | "reviewed" | "organisation"> = [
      ...(verified.actor.employeeId ? (["my"] as const) : []),
      ...(["HR", "Line Manager", "Accounts", "Travel Admin", "Employee"].includes(
        verified.actor.activeRole ?? "",
      )
        ? (["reviewed"] as const)
        : []),
      ...(["HR", "Super Admin"].includes(verified.actor.activeRole ?? "")
        ? (["organisation"] as const)
        : []),
    ];
    for (const scope of scopes) {
      const result = await listTrackedRequests(verified.organisationId, verified.actor, {
        ...common,
        scope,
      });
      const request = result.rows[0];
      if (request) {
        // A reviewer may reopen the full trip only while the travel repository
        // independently confirms their access. A historical decision alone does
        // not grant access to a trip after its reviewer is reassigned.
        const canReadOriginalTravel =
          !request.archivedAt &&
          scope === "reviewed" &&
          request.module === "Travel" &&
          (await listTravelRequestsForActor(verified.organisationId, verified.actor)).some(
            (trip) => trip.id === request.id,
          );
        const sensitiveModule = request.actionUrl.startsWith("/staff/independent-record-reviews")
          ? request.module === "Documents"
            ? "Document"
            : request.module === "Training certificates"
              ? "Training Certificate"
              : request.module === "Profile updates"
                ? "Employment Confirmation"
                : null
          : null;
        const canReadAssignedSensitive =
          !request.archivedAt &&
          scope === "reviewed" &&
          verified.actor.activeRole === "Employee" &&
          !!verified.actor.employeeId &&
          !!sensitiveModule &&
          !!(
            await getDatabaseClient()
              .select({ id: hrIndependentReviewAssignments.id })
              .from(hrIndependentReviewAssignments)
              .where(
                and(
                  eq(hrIndependentReviewAssignments.organisationId, verified.organisationId),
                  eq(hrIndependentReviewAssignments.module, sensitiveModule),
                  eq(hrIndependentReviewAssignments.requestId, request.id),
                  eq(hrIndependentReviewAssignments.reviewerEmployeeId, verified.actor.employeeId),
                  isNull(hrIndependentReviewAssignments.archivedAt),
                ),
              )
              .limit(1)
          )[0];
        return {
          request,
          canOpenOriginal:
            !request.archivedAt &&
            (scope !== "reviewed" ||
              verified.actor.activeRole === "HR" ||
              canReadOriginalTravel ||
              canReadAssignedSensitive),
        };
      }
    }
    throw new Error("This request is not available to your account.");
  });
export const getApprovalInboxFn = createServerFn({ method: "GET" })
  .validator((input) => z.object({ actor: Actor }).strict().parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    if (verified.actor.activeRole === "Super Admin") return [];
    return (await listTasksForActorInDatabase(verified.organisationId, verified.actor)).filter(
      (task) =>
        isApprovalTask(task) &&
        (!task.subjectEmployeeId || task.subjectEmployeeId !== verified.actor.employeeId),
    );
  });
