import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GoalService } from "@/lib/data/goal-service";
import { PerformanceService } from "@/lib/data/performance-service";
import { useCurrentUser } from "@/lib/auth";

export function PerformanceTab({ employeeId }: { employeeId: string }) {
  const performanceService = useMemo(() => new PerformanceService(), []);
  const goalService = useMemo(() => new GoalService(), []);
  const currentUser = useCurrentUser();
  const performanceDestination =
    currentUser.activeRole === "Line Manager" ||
    currentUser.activeRole === "HR" ||
    currentUser.activeRole === "Super Admin"
      ? "/staff/performance/team"
      : "/staff/me/performance";
  const performanceDestinationLabel =
    currentUser.activeRole === "Line Manager" ||
    currentUser.activeRole === "HR" ||
    currentUser.activeRole === "Super Admin"
      ? "Open Team Performance"
      : "Open My Performance";

  const reviews = useMemo(
    () =>
      performanceService
        .getReviewsForEmployee(employeeId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [performanceService, employeeId],
  );
  const cycles = useMemo(() => performanceService.getCycles(), [performanceService]);
  const goals = useMemo(
    () => goalService.getGoalsForEmployee(employeeId),
    [goalService, employeeId],
  );
  const activeGoals = goals.filter((g) => g.status === "Active");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Reviews Completed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {reviews.filter((r) => r.status === "Acknowledged" || r.status === "Locked").length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Goals
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeGoals.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Latest Manager Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {reviews[0]?.overallManagerScore?.toFixed(1) ?? "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Review History</CardTitle>
          <Link to={performanceDestination} className="text-sm text-primary hover:underline">
            {performanceDestinationLabel}
          </Link>
        </CardHeader>
        <CardContent className="space-y-3">
          {reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No performance reviews on record.
            </p>
          ) : (
            reviews.map((r) => {
              const cycle = cycles.find((c) => c.id === r.cycleId);
              return (
                <Link
                  key={r.id}
                  to="/staff/performance/reviews/$reviewId"
                  params={{ reviewId: r.id }}
                  className="flex items-center justify-between p-3 border rounded-md hover:bg-muted/50 text-sm"
                >
                  <div>
                    <div className="font-medium">{cycle?.name || "Review Cycle"}</div>
                    <div className="text-xs text-muted-foreground">
                      Self: {r.overallSelfScore?.toFixed(1) ?? "-"} &middot; Manager:{" "}
                      {r.overallManagerScore?.toFixed(1) ?? "-"}
                    </div>
                  </div>
                  <Badge
                    variant={
                      r.status === "Acknowledged" || r.status === "Locked" ? "default" : "secondary"
                    }
                  >
                    {r.status}
                  </Badge>
                </Link>
              );
            })
          )}
        </CardContent>
      </Card>

      {activeGoals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Active Goals</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {activeGoals.map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between p-2 border rounded-md text-sm"
              >
                <div>
                  <div className="font-medium">{g.title}</div>
                  <div className="text-xs text-muted-foreground">{g.description}</div>
                </div>
                <Badge variant="outline">{g.weight}%</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
