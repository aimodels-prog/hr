import "@tanstack/react-start/server-only";

import { and, eq } from "drizzle-orm";

import { getDatabaseClient } from "./client.ts";
import { roles, userRoles, users } from "./schema/employee.ts";
import { organisations } from "./schema/organisation.ts";
import type { Role } from "../data/types.ts";

let cachedDefaultOrgId: string | null = null;

export async function resolveDefaultOrganisationId(): Promise<string> {
  if (cachedDefaultOrgId) return cachedDefaultOrgId;
  const db = getDatabaseClient();
  const [org] = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(eq(organisations.isActive, true))
    .limit(1);

  if (!org) throw new Error("No active organisation found.");
  cachedDefaultOrgId = org.id;
  return org.id;
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
): Promise<{ verified: boolean; actor?: VerifiedActor; error?: string }> {
  const db = getDatabaseClient();

  // Find user by ID or fallback by employee ID for system compatibility
  const [user] = await db
    .select()
    .from(users)
    .where(
      and(eq(users.organisationId, orgId), eq(users.status, "Active"), eq(users.id, actorUserId)),
    );

  if (!user) {
    // Try matching if actorUserId is deterministic or employeeId
    const [fallbackUser] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.organisationId, orgId),
          eq(users.status, "Active"),
          eq(users.employeeId, actorUserId),
        ),
      );

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
