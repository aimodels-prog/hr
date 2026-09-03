import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, FileText, Target, Users } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { EmployeeService } from "@/lib/data/employee-service";
import { GoalService, type EmployeeGoal } from "@/lib/data/goal-service";
import { PerformanceService } from "@/lib/data/performance-service";

export const Route = createFileRoute("/staff/performance/team")({
  component: TeamPerformanceRoute,
});

function TeamPerformanceRoute() {
  return (
    <RequirePermission permission="performance:view_direct_reports" resourceName="Team Performance">
      <TeamPerformancePage />
    </RequirePermission>
  );
}

function TeamPerformancePage() {
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const context = currentUser.getActorContext();
  const performanceService = useMemo(() => new PerformanceService(), []);
  const goalService = useMemo(() => new GoalService(), []);
  const employeeService = useMemo(() => new EmployeeService(), []);
  const [version, setVersion] = useState(0);
  const [returning, setReturning] = useState<EmployeeGoal | null>(null);
  const [returnReason, setReturnReason] = useState("");
  void version;
  const isManager = currentUser.activeRole === "Line Manager";
  const reviews = performanceService.getReviewsForTeam(context);
  const cycles = performanceService.getCyclesForTeam(context);
  const employees = employeeService.getEmployees(context);
  const pendingGoals = goalService.getPendingGoalsForTeam(context);
  const allTeamGoals = goalService.getGoalsForTeam(context);
  const refresh = () => setVersion((value) => value + 1);
  const employeeName = (id: string) =>
    employees.find((employee) => employee.id === id)?.preferredName ||
    employees.find((employee) => employee.id === id)?.legalName ||
    "Employee";
  const perform = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      refresh();
      toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The action could not be completed.");
    }
  };
  const viewEvidence = async (goalId: string, checkInId: string) => {
    try {
      const file = await goalService.getEvidenceFile(goalId, checkInId, {
        ...context,
        reason: "Viewed objective progress evidence",
      });
      const url = URL.createObjectURL(file.blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The supporting file could not be opened.",
      );
    }
  };

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6 pb-10">
      <PageHeader
        title="Team Performance"
        description={
          isManager
            ? "Approve objectives, review progress and complete assessments for your direct reports."
            : "Monitor objectives and reviews across VIA. Supervisors remain responsible for employee decisions."
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">People in view</p>
            <p className="mt-1 text-2xl font-semibold">
              {
                new Set([
                  ...reviews.map((item) => item.employeeId),
                  ...allTeamGoals.map((item) => item.employeeId),
                ]).size
              }
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Open reviews</p>
            <p className="mt-1 text-2xl font-semibold">
              {reviews.filter((item) => !["Locked", "Corrected"].includes(item.status)).length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Objective decisions due</p>
            <p className="mt-1 text-2xl font-semibold">{pendingGoals.length}</p>
          </CardContent>
        </Card>
      </div>
      <Tabs defaultValue="approvals">
        <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-xl bg-muted/60 p-1">
          <TabsTrigger value="approvals">Objective approvals</TabsTrigger>
          <TabsTrigger value="reviews">Performance reviews</TabsTrigger>
          <TabsTrigger value="progress">Team progress</TabsTrigger>
        </TabsList>
        <TabsContent value="approvals" className="mt-6">
          <div className="grid gap-4 lg:grid-cols-2">
            {pendingGoals.map((goal) => (
              <Card key={goal.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">{goal.title}</CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {employeeName(goal.employeeId)} · {goal.weight}%
                      </p>
                    </div>
                    <Badge variant="outline">{goal.status}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm">{goal.description}</p>
                  <div className="rounded-lg bg-muted/50 p-3 text-sm">
                    <p className="font-medium">Measure of success</p>
                    <p className="text-muted-foreground">{goal.successMeasure}</p>
                    <p className="mt-2 font-medium">Target</p>
                    <p className="text-muted-foreground">{goal.targetValue}</p>
                  </div>
                  {isManager ? (
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setReturning(goal);
                          setReturnReason("");
                        }}
                      >
                        Return for changes
                      </Button>
                      <Button
                        onClick={() =>
                          void perform(
                            () =>
                              goal.status === "Completion Pending"
                                ? goalService.decideGoalAsync(
                                    goal.id,
                                    "complete",
                                    undefined,
                                    context,
                                  )
                                : goalService.decideGoalAsync(
                                    goal.id,
                                    "approve",
                                    undefined,
                                    context,
                                  ),
                            goal.status === "Completion Pending"
                              ? "Completion confirmed"
                              : "Objective approved",
                          )
                        }
                      >
                        {goal.status === "Completion Pending" ? "Confirm completion" : "Approve"}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Awaiting action from the employee's assigned supervisor.
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
            {pendingGoals.length === 0 && (
              <Card className="lg:col-span-2">
                <CardContent className="py-14 text-center text-muted-foreground">
                  <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-600" />
                  <p className="font-medium text-foreground">No objectives need your attention</p>
                  <p className="text-sm">
                    New submissions and completion requests will appear here.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
        <TabsContent value="reviews" className="mt-6">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Review cycle</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Manager review due</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reviews.map((review) => {
                    const cycle = cycles.find((item) => item.id === review.cycleId);
                    return (
                      <TableRow key={review.id}>
                        <TableCell className="font-medium">
                          {employeeName(review.employeeId)}
                        </TableCell>
                        <TableCell>{cycle?.name ?? "Review cycle"}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{review.status}</Badge>
                        </TableCell>
                        <TableCell>{cycle?.managerReviewDeadline ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              navigate({ to: `/staff/performance/reviews/${review.id}` })
                            }
                          >
                            Open <ArrowRight className="ml-2 h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {reviews.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                        <Users className="mx-auto mb-2 h-8 w-8" />
                        No team reviews are available.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="progress" className="mt-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {allTeamGoals.map((goal) => (
              <Card key={goal.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{goal.title}</CardTitle>
                    <Badge variant="outline">{goal.progressPercent}%</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{employeeName(goal.employeeId)}</p>
                </CardHeader>
                <CardContent>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${goal.progressPercent}%` }}
                    />
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{goal.status}</span>
                    <span>Due {goal.dueDate}</span>
                  </div>
                  {goal.checkIns.some((item) => item.evidenceFileId) && (
                    <div className="mt-4 space-y-2 border-t pt-3">
                      {goal.checkIns
                        .filter((item) => item.evidenceFileId)
                        .slice()
                        .reverse()
                        .map((item) => (
                          <Button
                            key={item.id}
                            variant="ghost"
                            size="sm"
                            className="h-auto w-full justify-start px-0"
                            onClick={() => void viewEvidence(goal.id, item.id)}
                          >
                            <FileText className="mr-2 h-4 w-4" /> View evidence from{" "}
                            {new Date(item.createdAt).toLocaleDateString()}
                          </Button>
                        ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
            {allTeamGoals.length === 0 && (
              <Card className="md:col-span-2 xl:col-span-3">
                <CardContent className="py-14 text-center text-muted-foreground">
                  <Target className="mx-auto mb-3 h-10 w-10" />
                  No team objectives have been created.
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>
      <Dialog open={Boolean(returning)} onOpenChange={(open) => !open && setReturning(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return objective for changes</DialogTitle>
            <DialogDescription>Tell the employee exactly what should be revised.</DialogDescription>
          </DialogHeader>
          <Textarea
            value={returnReason}
            onChange={(event) => setReturnReason(event.target.value)}
            placeholder="Explain the change required…"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturning(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!returning) return;
                void perform(
                  () => goalService.decideGoalAsync(returning.id, "return", returnReason, context),
                  "Objective returned to the employee",
                );
                setReturning(null);
              }}
            >
              Return objective
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
