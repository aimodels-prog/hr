import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowRight, CalendarCheck, ClipboardList, Target } from "lucide-react";

import { ObjectivesWorkspace } from "@/components/performance/objectives-workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { GoalService } from "@/lib/data/goal-service";
import { PerformanceService } from "@/lib/data/performance-service";

export const Route = createFileRoute("/staff/me/performance")({ component: MyPerformanceRoute });

function MyPerformanceRoute() {
  return (
    <RequirePermission permission="performance:view_self" resourceName="My Performance">
      <MyPerformancePage />
    </RequirePermission>
  );
}

function MyPerformancePage() {
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const context = currentUser.getActorContext();
  const employeeId = currentUser.employeeId ?? "";
  const service = useMemo(() => new PerformanceService(), []);
  const goalService = useMemo(() => new GoalService(), []);
  const [tab, setTab] = useState("objectives");
  const cycles = employeeId ? service.getCyclesForEmployee(employeeId, context) : [];
  const reviews = employeeId ? service.getReviewsForEmployee(employeeId, context) : [];
  const goals = employeeId ? goalService.getGoalsForEmployee(employeeId, context) : [];
  const checkIns = goals
    .flatMap((goal) => goal.checkIns.map((entry) => ({ ...entry, goalTitle: goal.title })))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latestPlan = [...reviews]
    .filter((review) => review.developmentPlan?.trim())
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6 pb-10">
      <PageHeader
        title="My Performance"
        description="Set objectives, record progress and complete your performance reviews."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-xl bg-muted/60 p-1">
          <TabsTrigger value="objectives">Objectives</TabsTrigger>
          <TabsTrigger value="reviews">Reviews</TabsTrigger>
          <TabsTrigger value="check-ins">Check-ins</TabsTrigger>
          <TabsTrigger value="development">Development plan</TabsTrigger>
        </TabsList>
        <TabsContent value="objectives" className="mt-6">
          <ObjectivesWorkspace />
        </TabsContent>
        <TabsContent value="reviews" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Performance reviews</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Review cycle</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Self-assessment due</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reviews.map((review) => {
                    const cycle = cycles.find((item) => item.id === review.cycleId);
                    return cycle ? (
                      <TableRow key={review.id}>
                        <TableCell className="font-medium">{cycle.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{review.status}</Badge>
                        </TableCell>
                        <TableCell>{cycle.selfAssessmentDeadline}</TableCell>
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
                    ) : null;
                  })}
                  {reviews.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                        <ClipboardList className="mx-auto mb-2 h-8 w-8" />
                        No review has been assigned yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="check-ins" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Objective check-ins</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {checkIns.map((entry) => (
                  <div key={entry.id} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{entry.goalTitle}</p>
                      <Badge variant="secondary">{entry.progressPercent}%</Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{entry.progressComment}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))}
                {checkIns.length === 0 && (
                  <div className="py-12 text-center text-muted-foreground">
                    <CalendarCheck className="mx-auto mb-3 h-9 w-9" />
                    <p className="font-medium text-foreground">No check-ins yet</p>
                    <p className="text-sm">
                      Progress updates recorded against your objectives will appear here.
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="development" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Development plan</CardTitle>
            </CardHeader>
            <CardContent>
              {latestPlan ? (
                <div className="rounded-xl border bg-muted/20 p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <Target className="h-5 w-5 text-primary" />
                    <p className="font-medium">Agreed development priorities</p>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-6">
                    {latestPlan.developmentPlan}
                  </p>
                </div>
              ) : (
                <div className="py-12 text-center text-muted-foreground">
                  <Target className="mx-auto mb-3 h-9 w-9" />
                  <p className="font-medium text-foreground">No development plan yet</p>
                  <p className="text-sm">
                    Your manager's agreed development actions will appear after the review.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
