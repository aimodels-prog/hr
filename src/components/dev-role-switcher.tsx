import { useCallback, useMemo, useState } from "react";
import { ChevronDown, Search, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useCurrentUser } from "@/lib/auth";
import type { Role } from "@/lib/data/types";

function initialsFor(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

const ROLE_BADGE_CLASS: Record<Role, string> = {
  "Super Admin":
    "bg-purple-600/15 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800",
  HR: "bg-blue-600/15 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  Accounts:
    "bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
  "Line Manager":
    "bg-amber-600/15 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800",
  IT: "bg-cyan-600/15 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800",
  Employee:
    "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800",
};

export function DevRoleSwitcher() {
  const {
    displayName,
    activeRole,
    assignedRoles,
    userId,
    currentEmployee,
    switchIdentity,
    setActiveRole,
    allUsers,
    allEmployees,
    refreshRecords,
    isDevelopmentPreview,
  } = useCurrentUser();

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const employeeById = useMemo(() => {
    const map = new Map<string, (typeof allEmployees)[number]>();
    for (const e of allEmployees) map.set(e.id, e);
    return map;
  }, [allEmployees]);

  // One flat, searchable list of every real, Active user - not you (there is nothing to
  // "switch to" about yourself) and not anyone whose access has been suspended or archived: a
  // revoked account cannot be "logged into" here any more than through a real auth provider, so
  // it is not offered as a switch target at all. A brand-new hire created through Add Employee
  // is exactly as reachable as the five people this preview was originally seeded with. No
  // separate curated tier.
  const otherUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allUsers
      .filter((u) => u.id !== userId)
      .filter((u) => u.status === "Active")
      .filter((u) => !q || u.displayName.toLowerCase().includes(q))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [allUsers, userId, search]);

  const initials = displayName ? initialsFor(displayName) : "?";

  // Catch a rejected switch (the target's access was revoked between render and click - e.g. a
  // suspension that just landed from another tab) and surface it instead of failing silently.
  const handleSwitchIdentity = useCallback(
    (targetUserId: string) => {
      try {
        switchIdentity(targetUserId);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Unable to switch identity.");
      }
    },
    [switchIdentity],
  );

  // Re-engaging with the switcher is the natural moment to catch a session that went stale in
  // the background (e.g. the active user was suspended from another tab sharing this browser's
  // localStorage) - so re-validate every time the dropdown is opened.
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (nextOpen) {
        refreshRecords();
      }
    },
    [refreshRecords],
  );

  return (
    <div className="flex items-center">
      <DropdownMenu open={open} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            aria-label={`${displayName}, ${activeRole}`}
            className="h-10 gap-2 rounded-full border-border/80 bg-background px-2 pr-3 shadow-sm hover:border-primary/25 hover:bg-primary/5"
          >
            <Avatar className="h-7 w-7 border-2 border-card shadow-sm">
              <AvatarFallback className="bg-primary text-[10px] font-bold text-primary-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="hidden min-w-0 text-left sm:block">
              <span className="block max-w-[110px] truncate text-xs font-semibold leading-none text-foreground">
                {displayName}
              </span>
              <span className="mt-1 block text-[10px] font-medium leading-none text-muted-foreground">
                {isDevelopmentPreview ? "Preview" : "Signed in"} · {activeRole}
              </span>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-0.5" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent className="w-80 p-2" align="end">
          {/* Current identity - the one thing that should never be duplicated further down. */}
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-primary text-xs text-primary-foreground font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate">{displayName}</p>
              <p className="text-xs text-muted-foreground truncate">
                {currentEmployee?.position || "Staff"} ·{" "}
                {currentEmployee?.department || "Operations"}
              </p>
            </div>
          </div>

          {/* Changing your hat while staying the same person - a different action from switching
              identity entirely, so it stays visually attached to the identity block above it. */}
          {assignedRoles.length > 1 && (
            <div className="flex flex-wrap gap-1 px-2 pt-1.5 pb-1">
              {assignedRoles.map((role) => (
                <Button
                  key={role}
                  variant={activeRole === role ? "default" : "outline"}
                  size="sm"
                  className="h-6 text-[11px] px-2"
                  onClick={() => setActiveRole(role)}
                >
                  {activeRole === role && <Check className="mr-1 h-3 w-3" />}
                  {role}
                </Button>
              ))}
            </div>
          )}

          {isDevelopmentPreview && (
            <>
              <DropdownMenuSeparator className="my-1.5" />

              <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground px-2 pt-0.5 pb-1">
                Switch Identity
              </DropdownMenuLabel>
              <div className="px-2 pb-1.5">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder="Find anyone, including new hires..."
                    className="h-7 pl-7 text-xs"
                  />
                </div>
              </div>
              <DropdownMenuGroup className="max-h-64 overflow-y-auto space-y-0.5">
                {otherUsers.length === 0 ? (
                  <p className="px-2 py-3 text-[11px] text-muted-foreground text-center">
                    No matching user.
                  </p>
                ) : (
                  otherUsers.map((u) => {
                    const employee = u.employeeId ? employeeById.get(u.employeeId) : undefined;
                    // Employee is the base role everyone holds, so it is a poor badge to lead with -
                    // show whatever more specific role they also carry, same preference order the
                    // active-identity logic itself uses.
                    const primaryRole =
                      (u.roles?.find((r) => r !== "Employee") as Role | undefined) ?? "Employee";
                    return (
                      <DropdownMenuItem
                        key={u.id}
                        onClick={() => handleSwitchIdentity(u.id)}
                        className="flex items-center gap-2.5 p-2 rounded-md cursor-pointer"
                      >
                        <Avatar className="h-7 w-7 shrink-0">
                          <AvatarFallback className="bg-muted text-[10px] font-semibold">
                            {initialsFor(u.displayName)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{u.displayName}</p>
                          {employee && (
                            <p className="text-[11px] text-muted-foreground truncate">
                              {employee.position}
                            </p>
                          )}
                        </div>
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1 py-0 border shrink-0 ${ROLE_BADGE_CLASS[primaryRole]}`}
                        >
                          {primaryRole}
                        </Badge>
                      </DropdownMenuItem>
                    );
                  })
                )}
              </DropdownMenuGroup>
            </>
          )}

          <DropdownMenuSeparator className="my-1.5" />

          {isDevelopmentPreview ? (
            <p className="px-2 py-1 text-[10.5px] text-muted-foreground">
              Development role preview is active.
            </p>
          ) : (
            <form action="/auth/logout" method="post" className="px-1 py-1">
              <Button type="submit" variant="ghost" size="sm" className="w-full justify-start">
                Sign out of VIA HR
              </Button>
            </form>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
