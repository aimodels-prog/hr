import { useEffect, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ShieldAlert, ArrowLeft, RefreshCw, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getApplicationDataServices } from "../data/application-data.ts";
import type { Role } from "../data/types.ts";
import { PRESET_IDENTITIES } from "./dev-preview-presets.ts";
import { useCurrentUser } from "./dev-preview-hooks.ts";
import type { Permission } from "./permissions.ts";

export interface AccessDeniedProps {
  resourceName?: string | undefined;
  requiredPermission?: Permission | undefined;
  requiredRoles?: Role[] | undefined;
  attemptedPath?: string | undefined;
}

export function AccessDenied({
  resourceName = "this internal page",
  requiredPermission,
  requiredRoles,
  attemptedPath,
}: AccessDeniedProps) {
  const { displayName, activeRole, switchIdentity, userId } = useCurrentUser();

  useEffect(() => {
    try {
      const services = getApplicationDataServices();
      services.audit.record({
        context: {
          actor: {
            userId,
            displayName,
            activeRole,
            roles: [activeRole],
          },
        },
        action: "access_denied",
        module: "security",
        entityType: "route_guard",
        entityId: attemptedPath || window.location.pathname || "unknown",
        reason: `Access denied to ${resourceName}. Required: ${requiredPermission || requiredRoles?.join(", ") || "elevated permissions"}. Active role: ${activeRole}`,
        riskLevel: "Medium",
      });
    } catch {
      // ignore
    }
  }, [
    userId,
    displayName,
    activeRole,
    resourceName,
    requiredPermission,
    requiredRoles,
    attemptedPath,
  ]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <Card className="max-w-lg border-destructive/30 shadow-md">
        <CardHeader className="text-center pb-3">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl">Access Denied</CardTitle>
          <CardDescription>
            You do not have permission to view{" "}
            <span className="font-semibold text-foreground">{resourceName}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="rounded-md border bg-muted/40 p-3 space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Viewing as:</span>
              <span className="font-medium text-foreground">{displayName}</span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Current role:</span>
              <Badge variant="outline" className="text-xs font-semibold">
                {activeRole}
              </Badge>
            </div>
            {requiredRoles && requiredRoles.length > 0 && (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Required role(s):</span>
                <span className="font-medium text-foreground">{requiredRoles.join(" or ")}</span>
              </div>
            )}
          </div>

          <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-900 dark:text-amber-200">
            <p className="font-medium mb-1 flex items-center gap-1.5">
              <RefreshCw className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              Try another assigned role
            </p>
            <p className="text-muted-foreground text-[11px] mb-2">
              Your current role cannot open this area. Choose another assigned role below:
            </p>
            <div className="grid grid-cols-2 gap-1.5 pt-1">
              {PRESET_IDENTITIES.map((preset) => (
                <Button
                  key={preset.key}
                  variant={activeRole === preset.roleName ? "default" : "outline"}
                  size="sm"
                  className="text-xs h-7 justify-start"
                  onClick={() => switchIdentity(preset.userId, preset.roleName)}
                >
                  <UserCheck className="mr-1.5 h-3 w-3" />
                  <span className="truncate">
                    {preset.roleName} ({preset.employeeName.split(" ")[0]})
                  </span>
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-between pt-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/staff">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back to Dashboard
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/">Career Portal</Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

export interface RequirePermissionProps {
  permission: Permission;
  resourceName?: string | undefined;
  fallback?: ReactNode | undefined;
  children: ReactNode;
}

export function RequirePermission({
  permission,
  resourceName,
  fallback,
  children,
}: RequirePermissionProps) {
  const { can: checkCan } = useCurrentUser();

  if (!checkCan(permission)) {
    return fallback ? (
      <>{fallback}</>
    ) : (
      <AccessDenied resourceName={resourceName} requiredPermission={permission} />
    );
  }

  return <>{children}</>;
}

export interface RequireAnyPermissionProps {
  permissions: Permission[];
  resourceName?: string | undefined;
  fallback?: ReactNode | undefined;
  children: ReactNode;
}

// For the handful of pages that are genuinely dual-purpose - e.g. a timesheet register that
// both approving managers and read-only Accounts reviewers legitimately need to open, each for
// a different declared permission - rather than forcing a single permission string to cover two
// unrelated audiences, or falling back to a hardcoded role list that drifts from the permission
// catalog.
export function RequireAnyPermission({
  permissions,
  resourceName,
  fallback,
  children,
}: RequireAnyPermissionProps) {
  const { can: checkCan } = useCurrentUser();

  if (!permissions.some((permission) => checkCan(permission))) {
    return fallback ? (
      <>{fallback}</>
    ) : (
      <AccessDenied resourceName={resourceName} requiredPermission={permissions[0]} />
    );
  }

  return <>{children}</>;
}

export interface RequireRoleProps {
  roles: Role[];
  resourceName?: string | undefined;
  fallback?: ReactNode | undefined;
  children: ReactNode;
}

export function RequireRole({ roles, resourceName, fallback, children }: RequireRoleProps) {
  const { activeRole } = useCurrentUser();

  if (!roles.includes(activeRole)) {
    return fallback ? (
      <>{fallback}</>
    ) : (
      <AccessDenied resourceName={resourceName} requiredRoles={roles} />
    );
  }

  return <>{children}</>;
}
