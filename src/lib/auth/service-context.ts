import { getApplicationDataServices } from "../data/application-data.ts";
import { getBrowserStorageDriver } from "../data/storage-driver.ts";
import type { ActorContext, Role, User } from "../data/types.ts";

const DEV_PREVIEW_STORAGE_KEY = "via_hr:dev_preview_state";

/**
 * Resolves the browser prototype identity for route loaders that run outside React context.
 * The requested role is accepted only when it is actually assigned to the stored user record.
 * Production authentication will replace this adapter with the server-verified Workspace actor.
 */
export function getRouteActorContext(): ActorContext {
  const users = getApplicationDataServices().storage.readCollection<User>("users");
  let requestedUserId = "user-rana";
  let requestedRole: Role | undefined;
  try {
    const saved = getBrowserStorageDriver().getItem(DEV_PREVIEW_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as { userId?: string; activeRole?: Role };
      if (parsed.userId) requestedUserId = parsed.userId;
      requestedRole = parsed.activeRole;
    }
  } catch {
    // Use the deterministic HR preview identity if the development preference is unreadable.
  }
  const user = users.find((item) => item.id === requestedUserId) ?? users[0];
  if (!user) throw new Error("No development user is available.");
  const activeRole =
    requestedRole && user.roles.includes(requestedRole)
      ? requestedRole
      : user.roles.find((role) => role !== "Employee") || user.roles[0] || "Employee";
  return {
    actor: {
      userId: user.id,
      employeeId: user.employeeId,
      displayName: user.displayName,
      roles: user.roles,
      activeRole,
    },
  };
}
