import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PerformanceService } from "@/lib/data/performance-service";
import { EmployeeService } from "@/lib/data/employee-service";
import { PerformanceTemplatesPanel } from "@/components/settings/performance-templates-panel";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { Plus, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/staff/performance/cycles/")({
  component: PerformanceCyclesRoute,
});

function PerformanceCyclesRoute() {
  return (
    <RequirePermission permission="performance:manage_all" resourceName="Performance Cycles">
      <PerformanceCyclesPage />
    </RequirePermission>
  );
}

function PerformanceCyclesPage() {
  const [perfService] = useState(() => new PerformanceService());
  const [employeeService] = useState(() => new EmployeeService());
  const navigate = useNavigate();
  const context = useCurrentUser().getActorContext();
  const [version, setVersion] = useState(0);
  void version;

  const cycles = perfService.getCycles(context);
  const templates = perfService.getTemplates(context);
  const reviews = perfService.getReviews(context);
  const employees = employeeService.getEmployees(context);
  const hrQueue = reviews.filter((review) =>
    ["Moderation Pending", "Acknowledged"].includes(review.status),
  );

  return (
    <div className="flex flex-col gap-6 max-w-[1200px] mx-auto pb-10">
      <PageHeader
        title="Performance Cycles"
        description="Manage review cycles and monitor organization-wide completion."
        actions={
          <Button
            onClick={() =>
              navigate({ to: "/staff/performance/cycles/new", search: { edit: undefined } })
            }
          >
            <Plus className="w-4 h-4 mr-2" /> Launch New Cycle
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>All Cycles</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cycle Name</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Population</TableHead>
                <TableHead>Deadlines</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cycles.map((c) => {
                const tmpl = templates.find((t) => t.id === c.templateId);
                const cycleReviews = reviews.filter((review) => review.cycleId === c.id);
                const completedReviews = cycleReviews.filter(
                  (review) => review.status === "Locked",
                ).length;

                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{tmpl?.name || "Unknown Template"}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          c.status === "Active"
                            ? "default"
                            : c.status === "Completed"
                              ? "secondary"
                              : "outline"
                        }
                        className={
                          c.status === "Active" ? "bg-emerald-500 hover:bg-emerald-600" : ""
                        }
                      >
                        {c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {cycleReviews.length} employees
                      </span>
                      <br />
                      Depts: {c.departments.length > 0 ? c.departments.join(", ") : "All"}
                      <br />
                      Types: {c.employmentTypes.length > 0 ? c.employmentTypes.join(", ") : "All"}
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="grid grid-cols-[auto_1fr] gap-x-2">
                        <span className="text-muted-foreground text-right">Self:</span>{" "}
                        <span>{c.selfAssessmentDeadline}</span>
                        <span className="text-muted-foreground text-right">Manager:</span>{" "}
                        <span>{c.managerReviewDeadline}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {c.status !== "Completed" && (
                        <div className="flex justify-end gap-2">
                          {c.status === "Draft" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                navigate({
                                  to: "/staff/performance/cycles/new",
                                  search: { edit: c.id },
                                })
                              }
                            >
                              Edit
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              try {
                                perfService.updateCycleStatus(
                                  c.id,
                                  c.status === "Draft" ? "Active" : "Completed",
                                  context,
                                );
                                setVersion((value) => value + 1);
                                toast.success(
                                  c.status === "Draft"
                                    ? "Review cycle launched"
                                    : "Review cycle completed",
                                );
                              } catch (error) {
                                toast.error(
                                  error instanceof Error
                                    ? error.message
                                    : "The cycle could not be updated.",
                                );
                              }
                            }}
                          >
                            {c.status === "Draft" ? (
                              <>
                                <PlayCircle className="mr-2 h-4 w-4" />
                                Launch
                              </>
                            ) : (
                              `Complete (${completedReviews}/${cycleReviews.length})`
                            )}
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {cycles.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No review cycles created yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Reviews needing HR action</CardTitle>
          <CardDescription>
            Moderate submitted assessments and finalise acknowledged reviews.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Cycle</TableHead>
                <TableHead>Next action</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {hrQueue.map((review) => (
                <TableRow key={review.id}>
                  <TableCell className="font-medium">
                    {employees.find((employee) => employee.id === review.employeeId)?.legalName ??
                      "Employee"}
                  </TableCell>
                  <TableCell>
                    {cycles.find((cycle) => cycle.id === review.cycleId)?.name ?? "Review cycle"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {review.status === "Moderation Pending"
                        ? "Moderate review"
                        : "Finalise review"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigate({ to: `/staff/performance/reviews/${review.id}` })}
                    >
                      Open review
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {hrQueue.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    No reviews currently need HR action.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <PerformanceTemplatesPanel />
    </div>
  );
}
