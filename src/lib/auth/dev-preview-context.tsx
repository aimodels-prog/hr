import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { getApplicationDataServices } from "../data/application-data.ts";
import type { Employee, Role, User } from "../data/types.ts";
import { DevPreviewContext, type DevPreviewContextValue } from "./dev-preview-hooks.ts";
import {
  can,
  canAll,
  canAny,
  getRolePermissions,
  type CurrentUserContext,
  type Permission,
} from "./permissions.ts";
import { getScopedEmployees } from "./record-scope.ts";
import { ApplicationBootScreen } from "../../components/layout/application-boot-screen.tsx";

const DEV_PREVIEW_STORAGE_KEY = "via_hr:dev_preview_state";

function loadSavedPreviewState(): { userId: string; activeRole?: Role } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DEV_PREVIEW_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function savePreviewState(userId: string, activeRole: Role): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DEV_PREVIEW_STORAGE_KEY, JSON.stringify({ userId, activeRole }));
  } catch {
    // ignore
  }
}

function clearSavedPreviewState(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(DEV_PREVIEW_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const [dataRevision, setDataRevision] = useState(0);
  const [users, setUsers] = useState<User[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("user-rana");
  const [activeRoleOverride, setActiveRoleOverride] = useState<Role | null>(null);
  const [isIdentityReady, setIsIdentityReady] = useState(false);

  // Find active user - a Suspended or Archived user must never become (or remain) the active
  // identity: that would let a revoked account keep fully operating the app under the guise of
  // its role. If the currently selected user is no longer Active, fall back to the first
  // remaining Active user (or null if none exist).
  const currentUser = useMemo<User | null>(() => {
    if (users.length === 0) return null;
    const selected = users.find((u) => u.id === selectedUserId);
    if (selected && selected.status === "Active") return selected;
    return users.find((u) => u.status === "Active") ?? null;
  }, [users, selectedUserId]);

  // Find associated employee
  const currentEmployee = useMemo(() => {
    if (!currentUser?.employeeId || employees.length === 0) return null;
    return employees.find((e) => e.id === currentUser.employeeId) || null;
  }, [currentUser, employees]);

  // Assigned roles
  const assignedRoles = useMemo<Role[]>(() => {
    return currentUser?.roles && currentUser.roles.length > 0 ? currentUser.roles : ["Employee"];
  }, [currentUser]);

  // Active role
  const activeRole = useMemo<Role>(() => {
    if (activeRoleOverride && assignedRoles.includes(activeRoleOverride)) {
      return activeRoleOverride;
    }
    // Prefer non-Employee role if available (e.g. HR, Super Admin, Accounts, Line Manager)
    const primaryRole =
      assignedRoles.find((r) => r !== "Employee") || assignedRoles[0] || "Employee";
    return primaryRole;
  }, [activeRoleOverride, assignedRoles]);

  // Permissions set
  const permissions = useMemo<ReadonlySet<Permission>>(() => {
    return getRolePermissions(activeRole);
  }, [activeRole]);

  // Switch identity with audit logging. Mirrors real authentication: a Suspended/Archived
  // account cannot "log in", so this refuses to switch to one at all - the caller (the dev role
  // switcher UI) is expected to catch the thrown error and surface it to the user.
  const switchIdentity = useCallback(
    (targetUserId: string, targetRole?: Role, pool: User[] = users) => {
      const targetUser = pool.find((u) => u.id === targetUserId);
      if (!targetUser) return;

      if (targetUser.status !== "Active") {
        throw new Error(
          `${targetUser.displayName}'s access is ${targetUser.status.toLowerCase()} and cannot be previewed.`,
        );
      }

      const roles = targetUser.roles || ["Employee"];
      const finalRole =
        targetRole && roles.includes(targetRole)
          ? targetRole
          : roles.find((r) => r !== "Employee") || roles[0] || "Employee";

      setSelectedUserId(targetUserId);
      setActiveRoleOverride(finalRole);
      savePreviewState(targetUserId, finalRole);

      // Log development preview change audit event
      try {
        const services = getApplicationDataServices();
        services.audit.record({
          context: {
            actor: {
              userId: targetUser.id,
              employeeId: targetUser.employeeId,
              displayName: targetUser.displayName,
              activeRole: finalRole,
              roles: targetUser.roles,
            },
          },
          action: "preview_identity_change",
          module: "development-preview",
          entityType: "dev-preview-identity",
          entityId: targetUser.id,
          after: {
            userId: targetUser.id,
            activeRole: finalRole,
            displayName: targetUser.displayName,
          },
          reason: `Development role preview switched to ${targetUser.displayName} (${finalRole})`,
          riskLevel: "Low",
        });
      } catch (err) {
        console.warn("Could not log identity change audit event", err);
      }
    },
    [users],
  );

  // Set active role for current user
  const setActiveRole = useCallback(
    (role: Role) => {
      if (!assignedRoles.includes(role)) return;
      setActiveRoleOverride(role);
      if (currentUser) {
        savePreviewState(currentUser.id, role);
        try {
          const services = getApplicationDataServices();
          services.audit.record({
            context: {
              actor: {
                userId: currentUser.id,
                employeeId: currentUser.employeeId,
                displayName: currentUser.displayName,
                activeRole: role,
                roles: currentUser.roles,
              },
            },
            action: "preview_role_change",
            module: "development-preview",
            entityType: "dev-preview-role",
            entityId: currentUser.id,
            after: {
              userId: currentUser.id,
              activeRole: role,
              displayName: currentUser.displayName,
            },
            reason: `Development active role changed to ${role} for ${currentUser.displayName}`,
            riskLevel: "Low",
          });
        } catch {
          // ignore
        }
      }
    },
    [assignedRoles, currentUser],
  );

  // Falls back to a known-safe Active identity. Used both as the app's initial default and as
  // the forced recovery path when the currently active session turns out to no longer be Active
  // (see refreshRecords below). `pool` lets a caller pass a just-fetched user list straight
  // through instead of relying on the `users` state, which may not have committed yet.
  const resetToDefault = useCallback(
    (pool: User[] = users) => {
      const preferredDefault = pool.find((u) => u.id === "user-rana" && u.status === "Active");
      const fallbackActive = preferredDefault ?? pool.find((u) => u.status === "Active");

      if (!fallbackActive) {
        // No Active user exists at all - there is nothing safe to switch to, so just drop the
        // stale identity rather than leave a Suspended/Archived selection in place.
        setActiveRoleOverride(null);
        clearSavedPreviewState();
        return;
      }

      switchIdentity(fallbackActive.id, "HR", pool);
    },
    [users, switchIdentity],
  );

  // Pure load from storage - no validation side effects beyond refreshing users/employees state.
  const loadUsersAndEmployees = useCallback((): User[] | null => {
    try {
      const services = getApplicationDataServices();
      const loadedUsers = services.storage.readCollection<User>("users");
      const loadedEmployees = services.storage.readCollection<Employee>("employees");
      setUsers(loadedUsers);
      setEmployees(loadedEmployees);
      return loadedUsers;
    } catch {
      // Fallback during initial boot
      return null;
    }
  }, []);

  // If `userId` no longer resolves to an Active user within `pool`, the session must not be
  // allowed to keep operating as that user - force it back to a safe default. Takes an explicit
  // pool (rather than reading the `users` state) so it gives correct answers even immediately
  // after a fresh storage read, before that read has committed to state.
  const validateActiveSelection = useCallback(
    (pool: User[], userId: string) => {
      const selected = pool.find((u) => u.id === userId);
      if (selected && selected.status !== "Active") {
        resetToDefault(pool);
      }
    },
    [resetToDefault],
  );

  // Re-reads users/employees from storage and re-validates the active session against the
  // fresh data: if the identity currently being previewed has been suspended or archived since
  // it was selected (e.g. from another browser tab sharing the same localStorage), this forces
  // it back to a safe default. Exposed so the dev role switcher can call it whenever its
  // dropdown is opened, since re-engaging with the switcher is the natural moment to catch a
  // session that went stale in the background.
  const refreshRecords = useCallback(() => {
    const loadedUsers = loadUsersAndEmployees();
    if (loadedUsers) {
      validateActiveSelection(loadedUsers, selectedUserId);
    }
  }, [loadUsersAndEmployees, validateActiveSelection, selectedUserId]);

  useEffect(() => {
    try {
      const loadedUsers = loadUsersAndEmployees();
      const saved = loadSavedPreviewState();
      let resolvedUserId = selectedUserId;
      if (saved?.userId) {
        const savedUser = loadedUsers?.find((u) => u.id === saved.userId);
        if (savedUser && savedUser.status === "Active") {
          resolvedUserId = saved.userId;
          setSelectedUserId(saved.userId);
          if (saved.activeRole) {
            setActiveRoleOverride(saved.activeRole);
          }
        } else {
          // Saved identity no longer resolves to an Active user (suspended, archived, or
          // deleted since it was saved) - discard the stale preview state instead of
          // resurrecting it.
          clearSavedPreviewState();
        }
      }
      if (loadedUsers) {
        validateActiveSelection(loadedUsers, resolvedUserId);
      }
    } finally {
      setIsIdentityReady(true);
    }
    // Runs once on mount only - refreshRecords is invoked again explicitly (e.g. when the dev
    // role switcher dropdown opens) rather than through this effect re-firing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleDataChange = () => {
      refreshRecords();
      setDataRevision((current) => current + 1);
    };
    window.addEventListener("via_hr:data_changed", handleDataChange);
    return () => window.removeEventListener("via_hr:data_changed", handleDataChange);
  }, [refreshRecords]);

  // Context object
  const contextValue = useMemo<DevPreviewContextValue>(() => {
    const userCtx: CurrentUserContext = {
      userId: currentUser?.id || "user-rana",
      employeeId: currentUser?.employeeId || "employee-rana",
      displayName: currentUser?.displayName || "Rana Nair",
      workspaceEmail: currentUser?.workspaceEmail || "rana.nair@via.example",
      assignedRoles,
      activeRole,
      permissions,
      isDevelopmentPreview: true,
    };

    const scoped = getScopedEmployees(employees, userCtx);

    return {
      ...userCtx,
      id: userCtx.userId,
      role: activeRole,
      roles: assignedRoles,
      getActorContext: () => ({
        actor: {
          userId: userCtx.userId,
          employeeId: userCtx.employeeId,
          displayName: userCtx.displayName,
          activeRole,
          roles: assignedRoles,
        },
      }),
      currentUser,
      currentEmployee,
      allUsers: users,
      allEmployees: employees,
      switchIdentity,
      setActiveRole,
      resetToDefault,
      refreshRecords,
      can: (perm: Permission) => can(perm, userCtx),
      canAny: (perms: Permission[]) => canAny(perms, userCtx),
      canAll: (perms: Permission[]) => canAll(perms, userCtx),
      scopedEmployees: scoped,
    };
  }, [
    currentUser,
    currentEmployee,
    assignedRoles,
    activeRole,
    permissions,
    users,
    employees,
    switchIdentity,
    setActiveRole,
    resetToDefault,
    refreshRecords,
  ]);

  if (!isIdentityReady) return <ApplicationBootScreen />;

  return (
    <DevPreviewContext.Provider value={contextValue}>
      <div key={dataRevision} className="contents">
        {children}
      </div>
    </DevPreviewContext.Provider>
  );
}
