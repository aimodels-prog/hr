import { useState, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OnboardingService } from "@/lib/data/onboarding-service";
import { OffboardingService } from "@/lib/data/offboarding-service";
import { useCurrentUser } from "@/lib/auth";
import { format } from "date-fns";
import { ArrowRight, UserMinus, UserPlus } from "lucide-react";

export function OnboardingOffboardingTab({ employeeId }: { employeeId: string }) {
  const currentUser = useCurrentUser();
  const { can } = currentUser;
  const [obService] = useState(() => new OnboardingService());
  const [offbService] = useState(() => new OffboardingService());

  const onboardingCase = useMemo(
    () => obService.getCaseByEmployeeId(employeeId),
    [obService, employeeId],
  );
  const offboardingCase = useMemo(
    () => offbService.getCaseByEmployeeId(employeeId),
    [offbService, employeeId],
  );

  const canManageOffboarding = can("offboarding:manage_all");
  const offboardingDestination =
    currentUser.activeRole === "Line Manager"
      ? "/staff/my-tasks"
      : canManageOffboarding && offboardingCase
        ? `/staff/offboarding/${offboardingCase.id}`
        : null;
  const onboardingDestination =
    currentUser.employeeId === employeeId && !["HR", "Super Admin"].includes(currentUser.activeRole)
      ? "/staff/me/onboarding"
      : currentUser.activeRole === "Line Manager"
        ? "/staff/my-tasks"
        : onboardingCase
          ? `/staff/onboarding/${onboardingCase.id}`
          : "/staff/onboarding";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <UserPlus className="w-4 h-4" /> Onboarding
          </CardTitle>
        </CardHeader>
        <CardContent>
          {onboardingCase ? (
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Badge variant={onboardingCase.status === "Completed" ? "default" : "outline"}>
                    {onboardingCase.status}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {onboardingCase.progressPercentage}% complete
                  </span>
                </div>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link to={onboardingDestination}>
                  Open Case <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No onboarding case on record for this employee.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <UserMinus className="w-4 h-4" /> Offboarding
          </CardTitle>
        </CardHeader>
        <CardContent>
          {offboardingCase ? (
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant={offboardingCase.status === "Completed" ? "default" : "outline"}>
                    {offboardingCase.status}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {offboardingCase.progressPercentage}% complete
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {offboardingCase.reasonCategory} &middot; Last working day{" "}
                  {format(new Date(offboardingCase.lastWorkingDate), "MMM d, yyyy")}
                </div>
              </div>
              {offboardingDestination && (
                <Button variant="outline" size="sm" asChild>
                  <Link to={offboardingDestination}>
                    {currentUser.activeRole === "Line Manager" ? "View My Tasks" : "Open Case"}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Link>
                </Button>
              )}
            </div>
          ) : canManageOffboarding ? (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">No active offboarding case.</p>
              <Button variant="outline" size="sm" asChild>
                <Link to="/staff/offboarding">
                  Start Offboarding <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No active offboarding case.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
