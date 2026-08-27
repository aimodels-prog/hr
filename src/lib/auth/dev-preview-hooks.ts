import { createContext, useContext } from "react";
import type { ActorContext, Employee, Role, User } from "../data/types.ts";
import type { CurrentUserContext, Permission } from "./permissions.ts";

export interface DevPreviewContextValue extends CurrentUserContext {
  /** Alias for userId - the current user's ID. Kept for call-site ergonomics (`{ id } = useCurrentUser()`). */
  id: string;
  /** Alias for activeRole - the single role currently in effect. */
  role: Role;
  /** Alias for assignedRoles - every role assigned to the current user. */
  roles: Role[];
  currentUser: User | null;
  currentEmployee: Employee | null;
  allUsers: User[];
  allEmployees: Employee[];
  switchIdentity: (userId: string, targetRole?: Role) => void;
  setActiveRole: (role: Role) => void;
  resetToDefault: () => void;
  /**
   * Re-reads users/employees from storage and re-validates the active session: if the
   * currently previewed user is no longer Active (e.g. suspended from another tab), forces a
   * reset to a safe default identity. Call this whenever the user re-engages with identity
   * controls (e.g. opening the dev role switcher) to catch a session gone stale in the background.
   */
  refreshRecords: () => void;
  can: (permission: Permission) => boolean;
  canAny: (permissions: Permission[]) => boolean;
  canAll: (permissions: Permission[]) => boolean;
  scopedEmployees: Employee[];
  /** Builds an ActorContext for the current identity, ready to pass straight into any service mutation call. */
  getActorContext: () => ActorContext;
}

export const DevPreviewContext = createContext<DevPreviewContextValue | null>(null);

export function useCurrentUser(): DevPreviewContextValue {
  const context = useContext(DevPreviewContext);
  if (!context) {
    throw new Error("useCurrentUser must be used within a CurrentUserProvider");
  }
  return context;
}

export const useDevRolePreview = useCurrentUser;

export function useCan(permission: Permission): boolean {
  const { can: checkCan } = useCurrentUser();
  return checkCan(permission);
}

export function useScopedEmployees(): Employee[] {
  const { scopedEmployees } = useCurrentUser();
  return scopedEmployees;
}
