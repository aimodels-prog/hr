import "@tanstack/react-start/server-only";

import { getRequest } from "@tanstack/react-start/server";
import { and, eq } from "drizzle-orm";

import { getPortalPrincipalForRequest } from "../auth/portal-auth-http.server.ts";
import { isPortalSsoEnabled } from "../auth/portal-sso-config.server.ts";
import { getDatabaseClient } from "./client.ts";
import { roles, userRoles, users } from "./schema/employee.ts";
import type { Role } from "../data/types.ts";
export {
  clearDefaultOrganisationCacheForTests,
  resolveDefaultOrganisationId,
} from "./organisation.server.ts";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function authenticatedPortalActor(
  actorUserId: string,
  workspaceEmail?: string,
): Promise<{ userId: string; employeeId: string; organisationId: string } | null> {
  if (!isPortalSsoEnabled()) return null;
  let request: Request;
  try {
    request = getRequest();
  } catch {
    throw new Error("An authenticated VIA Portal request is required.");
  }
  const principal = await getPortalPrincipalForRequest(request);
  if (!principal) throw new Error("Your VIA HR session is missing or has expired.");
  const actorMatches = actorUserId === principal.user.id || actorUserId === principal.employee.id;
  const emailMatches =
    !workspaceEmail || workspaceEmail.trim().toLowerCase() === principal.user.workspaceEmail;
  if (!actorMatches || !emailMatches) {
    throw new Error("The requested actor does not match the authenticated VIA Portal session.");
  }
  return {
    userId: principal.user.id,
    employeeId: principal.employee.id,
    organisationId: principal.organisationId,
  };
}

export async function resolveOrganisationIdForActor(
  actorUserId: string,
  workspaceEmail?: string,
): Promise<string> {
  const authenticated = await authenticatedPortalActor(actorUserId, workspaceEmail);
  if (authenticated) return authenticated.organisationId;
  const db = getDatabaseClient();
  if (isUuid(actorUserId)) {
    const [user] = await db
      .select({ organisationId: users.organisationId })
      .from(users)
      .where(and(eq(users.status, "Active"), eq(users.id, actorUserId)))
      .limit(1);
    if (user) return user.organisationId;

    const [employeeUser] = await db
      .select({ organisationId: users.organisationId })
      .from(users)
      .where(and(eq(users.status, "Active"), eq(users.employeeId, actorUserId)))
      .limit(1);
    if (employeeUser) return employeeUser.organisationId;
  }

  if (workspaceEmail) {
    const [emailUser] = await db
      .select({ organisationId: users.organisationId })
      .from(users)
      .where(
        and(
          eq(users.status, "Active"),
          eq(users.workspaceEmail, workspaceEmail.trim().toLowerCase()),
        ),
      )
      .limit(1);
    if (emailUser) return emailUser.organisationId;
  }

  throw new Error("Actor is not linked to an active VIA HR user.");
}

export interface VerifiedActor {
  userId: string;
  employeeId: string;
  displayName: string;
  workspaceEmail: string;
  organisationId: string;
  roles: Role[];
  activeRole: Role;
}

export async function verifyServerActorRole(
  orgId: string,
  actorUserId: string,
  requiredRole?: Role | Role[],
  workspaceEmail?: string,
): Promise<{ verified: boolean; actor?: VerifiedActor; error?: string }> {
  try {
    const authenticated = await authenticatedPortalActor(actorUserId, workspaceEmail);
    if (authenticated && authenticated.organisationId !== orgId) {
      return { verified: false, error: "The authenticated user is outside this organisation." };
    }
  } catch (error) {
    return {
      verified: false,
      error: error instanceof Error ? error.message : "VIA Portal authentication failed.",
    };
  }
  const db = getDatabaseClient();

  let user: typeof users.$inferSelect | undefined;
  if (isUuid(actorUserId)) {
    [user] = await db
      .select()
      .from(users)
      .where(
        and(eq(users.organisationId, orgId), eq(users.status, "Active"), eq(users.id, actorUserId)),
      );
  }

  if (!user) {
    let fallbackUser: typeof users.$inferSelect | undefined;
    if (isUuid(actorUserId)) {
      [fallbackUser] = await db
        .select()
        .from(users)
        .where(
          and(
            eq(users.organisationId, orgId),
            eq(users.status, "Active"),
            eq(users.employeeId, actorUserId),
          ),
        );
    }

    if (!fallbackUser && workspaceEmail) {
      [fallbackUser] = await db
        .select()
        .from(users)
        .where(
          and(
            eq(users.organisationId, orgId),
            eq(users.status, "Active"),
            eq(users.workspaceEmail, workspaceEmail.trim().toLowerCase()),
          ),
        );
    }

    if (!fallbackUser) {
      return { verified: false, error: `Actor user ${actorUserId} not found or inactive.` };
    }

    return checkUserRoles(db, orgId, fallbackUser, requiredRole);
  }

  return checkUserRoles(db, orgId, user, requiredRole);
}

async function checkUserRoles(
  db: ReturnType<typeof getDatabaseClient>,
  orgId: string,
  user: typeof users.$inferSelect,
  requiredRole?: Role | Role[],
): Promise<{ verified: boolean; actor?: VerifiedActor; error?: string }> {
  const userRoleRows = await db
    .select({ code: roles.code })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(eq(userRoles.organisationId, orgId), eq(userRoles.userId, user.id)));

  const assignedRoles = userRoleRows.map((r) => r.code as Role);

  if (requiredRole) {
    const requiredList = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
    const hasRole = requiredList.some((req) => assignedRoles.includes(req));
    if (!hasRole) {
      return {
        verified: false,
        error: `User does not hold required role (${requiredList.join(", ")}). Assigned: ${assignedRoles.join(", ")}`,
      };
    }
  }

  const primaryRole: Role =
    (requiredRole
      ? Array.isArray(requiredRole)
        ? requiredRole[0]
        : requiredRole
      : assignedRoles[0]) ?? "Employee";

  return {
    verified: true,
    actor: {
      userId: user.id,
      employeeId: user.employeeId,
      displayName: user.displayName,
      workspaceEmail: user.workspaceEmail,
      organisationId: user.organisationId,
      roles: assignedRoles,
      activeRole: primaryRole,
    },
  };
}
