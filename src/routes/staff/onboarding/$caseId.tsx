import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  Clock3,
  Eye,
  Lock,
  RefreshCcw,
} from "lucide-react";
import { toast } from "sonner";
import { AuditViewer } from "@/components/audit-viewer";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { EmployeeService } from "@/lib/data/employee-service";
import { LifecycleTaskService } from "@/lib/data/lifecycle-task-service";
import { OnboardingService } from "@/lib/data/onboarding-service";
import type { OnboardingTask, TaskCheckpoint } from "@/lib/data/onboarding-types";

export const Route = createFileRoute("/staff/onboarding/$caseId")({
  component: OnboardingCaseRoute,
});

const CHECKPOINTS: TaskCheckpoint[] = [
  "Pre-Arrival",
  "Day 1",
  "Week 1",
  "Day 30",
  "Day 60",
  "Day 90",
];

function OnboardingCaseRoute() {
  const { caseId } = Route.useParams();
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const [onboardingService] = useState(() => new OnboardingService());
  const [employeeService] = useState(() => new EmployeeService());
  const [taskActions] = useState(() => new LifecycleTaskService());
  const [onboardingCase, setOnboardingCase] = useState(() =>
    onboardingService.getCaseForViewer(caseId, currentUser.getActorContext()),
  );
  const [selectedTask, setSelectedTask] = useState<OnboardingTask | null>(null);
  const [waiverReason, setWaiverReason] = useState("");
  const [evidenceFiles, setEvidenceFiles] = useState<Record<string, File>>({});
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const actorContext = currentUser.getActorContext();
  const hasAccess = onboardingCase
    ? onboardingService.canAccessCase(onboardingCase, actorContext)
    : true;
  useEffect(() => {
    if (!onboardingCase || hasAccess) return;
    try {
      onboardingService.requireCaseAccess(onboardingCase, actorContext);
    } catch {
      // The service records the denied attempt. The page shows the safe state below.
    }
  }, [actorContext, hasAccess, onboardingCase, onboardingService]);

  const employee = onboardingCase
    ? employeeService
        .getDirectoryEmployees(actorContext)
        .find((item) => item.id === onboardingCase.employeeId)
    : null;
  const visibleTasks = useMemo(
    () =>
      onboardingCase && hasAccess
        ? onboardingService.getTasksForContext(onboardingCase, actorContext)
        : [],
    [actorContext, hasAccess, onboardingCase, onboardingService],
  );

  if (!onboardingCase) {
    return (
      <SafeMessage
        title="Onboarding case not found"
        message="This case may have been removed or the link is no longer valid."
      />
    );
  }
  if (!hasAccess) {
    return (
      <SafeMessage
        title="You cannot open this case"
        message="This onboarding work is not assigned to you or the role you are currently using."
      />
    );
  }
  if (!employee) {
    return (
      <SafeMessage
        title="Employee record not found"
        message="The employee linked to this case is unavailable."
      />
    );
  }

  const canWaive = currentUser.activeRole === "HR" || currentUser.activeRole === "Super Admin";
  const canSeeAudit = currentUser.can("system:audit_view");
  const canManageCases =
    currentUser.activeRole === "HR" || currentUser.activeRole === "Super Admin";
  const canComplete = (task: OnboardingTask) => {
    if (currentUser.activeRole === "Super Admin") return true;
    if (
      task.assignedUserId === currentUser.userId ||
      task.assignedUserId === currentUser.employeeId
    ) {
      return true;
    }
    if (task.ownerRole === "Employee") return currentUser.employeeId === employee.id;
    if (task.ownerRole === "Line Manager") {
      return (
        currentUser.activeRole === "Line Manager" &&
        employee.lineManagerId === currentUser.employeeId
      );
    }
    return task.ownerRole === currentUser.activeRole;
  };

  const handleComplete = async (task: OnboardingTask) => {
    setBusyTaskId(task.id);
    try {
      const updated = await taskActions.complete(
        "onboarding",
        onboardingCase.id,
        task.id,
        currentUser.getActorContext(),
        evidenceFiles[task.id],
      );
      setOnboardingCase(updated);
      setEvidenceFiles((current) => {
        const next = { ...current };
        delete next[task.id];
        return next;
      });
      toast.success("Task completed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Task could not be completed");
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleWaive = async () => {
    if (!selectedTask) return;
    try {
      const updated = await taskActions.waive(
        "onboarding",
        onboardingCase.id,
        selectedTask.id,
        waiverReason,
        currentUser.getActorContext(),
      );
      setOnboardingCase(updated);
      setSelectedTask(null);
      setWaiverReason("");
      toast.success("Task waived");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Task could not be waived");
    }
  };

  const handleReschedule = () => {
    try {
      const updated = onboardingService.rescheduleCase(onboardingCase.id, {
        ...currentUser.getActorContext(),
        reason: "Aligned onboarding dates after a start-date change",
      });
      setOnboardingCase(updated);
      toast.success("Open task dates updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Task dates could not be updated");
    }
  };

  const handleCancel = () => {
    try {
      const updated = onboardingService.cancelCase(onboardingCase.id, cancelReason, {
        ...currentUser.getActorContext(),
        reason: cancelReason,
      });
      setOnboardingCase(updated);
      setCancelOpen(false);
      setCancelReason("");
      toast.success("Onboarding cancelled and portal access suspended");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Onboarding could not be cancelled");
    }
  };

  const viewEvidence = async (task: OnboardingTask) => {
    try {
      const evidence = await taskActions.openEvidence("onboarding", onboardingCase.id, task.id, {
        ...currentUser.getActorContext(),
        reason: "Viewed onboarding evidence",
      });
      const url = URL.createObjectURL(evidence.blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Evidence could not be opened");
    }
  };

  return (
    <RequirePermission permission="employee:view_self" resourceName="Onboarding Case">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 pb-10">
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={() => navigate({ to: canManageCases ? "/staff/onboarding" : "/staff/my-tasks" })}
        >
          <ArrowLeft /> {canManageCases ? "Back to Onboarding" : "Back to My Tasks"}
        </Button>

        <PageHeader
          title={`Onboarding: ${employee.legalName}`}
          description={`${employee.position} · ${employee.department} · Starts ${format(parseISO(employee.startDate), "d MMM yyyy")}`}
          actions={
            <div className="flex flex-wrap items-center gap-3">
              <div className="h-2 w-28 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: `${onboardingCase.progressPercentage}%` }}
                />
              </div>
              <span className="text-sm font-semibold">{onboardingCase.progressPercentage}%</span>
              <Badge variant={onboardingCase.isReadyForStartDate ? "default" : "outline"}>
                {onboardingCase.isReadyForStartDate
                  ? "Ready for start date"
                  : "Start preparation pending"}
              </Badge>
              {canManageCases && onboardingCase.status === "In Progress" && (
                <>
                  <Button variant="outline" size="sm" onClick={handleReschedule}>
                    <RefreshCcw className="h-4 w-4" /> Update dates
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setCancelOpen(true)}>
                    <Ban className="h-4 w-4" /> Cancel onboarding
                  </Button>
                </>
              )}
            </div>
          }
        />

        {onboardingCase.status !== "In Progress" && (
          <Card
            className={
              onboardingCase.status === "Cancelled"
                ? "border-rose-200 bg-rose-50/50"
                : "border-emerald-200 bg-emerald-50/50"
            }
          >
            <CardContent className="p-4 text-sm font-medium">
              {onboardingCase.status === "Cancelled"
                ? "This onboarding process was cancelled. Its history remains available, but tasks can no longer be changed."
                : "This onboarding process is complete. All required work was completed or formally waived."}
            </CardContent>
          </Card>
        )}

        {canManageCases &&
          !employee.lineManagerId &&
          onboardingCase.tasks.some(
            (task) => task.isMandatory && task.ownerRole === "Line Manager",
          ) && (
            <Card className="border-amber-200 bg-amber-50/50">
              <CardContent className="flex items-start gap-3 p-4 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <div>
                  <div className="font-medium">A line manager is still needed</div>
                  <div className="text-muted-foreground">
                    Assign a line manager on the employee profile so manager-owned onboarding tasks
                    reach the right person.
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

        <div className="space-y-8">
          {CHECKPOINTS.map((checkpoint) => {
            const checkpointTasks = visibleTasks.filter((task) => task.checkpoint === checkpoint);
            if (checkpointTasks.length === 0) return null;
            return (
              <section
                key={checkpoint}
                className="space-y-3"
                aria-labelledby={`checkpoint-${checkpoint}`}
              >
                <div className="flex items-center gap-2 border-b pb-2">
                  <h2 id={`checkpoint-${checkpoint}`} className="text-lg font-semibold">
                    {checkpoint}
                  </h2>
                  <Badge variant="secondary">{checkpointTasks.length}</Badge>
                </div>
                {checkpointTasks.map((task) => {
                  const done = task.status === "Completed" || task.status === "Waived";
                  const overdue = !done && task.dueDate < new Date().toISOString().slice(0, 10);
                  const selfServiceTask =
                    task.ownerRole === "Employee" &&
                    employee.id === currentUser.employeeId &&
                    Boolean(task.selfServiceFormKey);
                  return (
                    <Card key={task.id} className={overdue ? "border-rose-200" : ""}>
                      <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {done && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                            {task.status === "Blocked" && (
                              <AlertTriangle className="h-4 w-4 text-amber-600" />
                            )}
                            <h3 className={done ? "font-semibold line-through" : "font-semibold"}>
                              {task.title}
                            </h3>
                            {task.isMandatory && <Badge variant="destructive">Required</Badge>}
                            {task.requiresEvidence && (
                              <Badge variant="outline">Evidence needed</Badge>
                            )}
                          </div>
                          {task.instructions && (
                            <p className="mt-2 text-sm text-muted-foreground">
                              {task.instructions}
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
                            <span className={overdue ? "font-semibold text-rose-700" : ""}>
                              <Clock3 className="mr-1 inline h-3 w-3" /> Due{" "}
                              {format(parseISO(task.dueDate), "d MMM yyyy")}
                            </span>
                            <span>Owner: {task.ownerRole}</span>
                            <span>{task.status}</span>
                          </div>
                          {task.status === "Blocked" && (
                            <p className="mt-2 text-xs font-medium text-amber-700">
                              Complete the earlier required task before this one.
                            </p>
                          )}
                          {task.waiverReason && (
                            <p className="mt-2 text-xs text-muted-foreground">
                              Waiver reason: {task.waiverReason}
                            </p>
                          )}
                          {task.requiresBankDetails &&
                            (currentUser.activeRole === "Accounts" ||
                              currentUser.activeRole === "Super Admin") && (
                              <p className="mt-2 text-xs text-muted-foreground">
                                {employee.bankDetails?.bankName && employee.bankDetails.iban
                                  ? `Bank details received: ${employee.bankDetails.bankName} · IBAN ending ${employee.bankDetails.iban.slice(-4)}`
                                  : "Bank details have not been submitted yet."}
                              </p>
                            )}
                          {task.verificationDocumentType && canManageCases && (
                            <Button asChild variant="link" size="sm" className="mt-1 h-auto p-0">
                              <Link
                                to="/staff/employees/$employeeId"
                                params={{ employeeId: employee.id }}
                              >
                                Review {task.verificationDocumentType.replaceAll("_", " ")} in
                                employee documents
                              </Link>
                            </Button>
                          )}
                        </div>
                        {task.status === "Pending" && selfServiceTask ? (
                          <Button asChild className="w-full md:w-auto">
                            <Link to="/staff/me/onboarding">Complete my details</Link>
                          </Button>
                        ) : task.status === "Pending" && canComplete(task) ? (
                          <div className="flex w-full flex-col gap-2 md:w-72">
                            {task.requiresEvidence && (
                              <label className="text-xs font-medium">
                                Supporting evidence
                                <Input
                                  className="mt-1"
                                  type="file"
                                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                                  onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file) {
                                      setEvidenceFiles((current) => ({
                                        ...current,
                                        [task.id]: file,
                                      }));
                                    }
                                  }}
                                />
                              </label>
                            )}
                            <div className="flex gap-2 md:justify-end">
                              {canWaive && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setSelectedTask(task);
                                    setWaiverReason("");
                                  }}
                                >
                                  Waive
                                </Button>
                              )}
                              <Button
                                size="sm"
                                disabled={busyTaskId === task.id}
                                onClick={() => void handleComplete(task)}
                              >
                                {busyTaskId === task.id ? "Saving..." : "Mark complete"}
                              </Button>
                            </div>
                          </div>
                        ) : task.evidenceFileId ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void viewEvidence(task)}
                          >
                            <Eye className="h-4 w-4" /> View evidence
                          </Button>
                        ) : null}
                      </CardContent>
                    </Card>
                  );
                })}
              </section>
            );
          })}
        </div>

        {visibleTasks.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="p-10 text-center text-sm text-muted-foreground">
              No onboarding tasks are assigned to you in this case.
            </CardContent>
          </Card>
        )}
        {canSeeAudit && <AuditViewer entityId={onboardingCase.id} entityType="onboarding-case" />}

        <Dialog
          open={Boolean(selectedTask)}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedTask(null);
              setWaiverReason("");
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Waive this task?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              The task will count as resolved, and your reason will remain in the case history.
            </p>
            <Textarea
              value={waiverReason}
              onChange={(event) => setWaiverReason(event.target.value)}
              placeholder="Explain why this task does not apply"
              rows={4}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedTask(null)}>
                Cancel
              </Button>
              <Button onClick={handleWaive} disabled={waiverReason.trim().length < 5}>
                Confirm waiver
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={cancelOpen}
          onOpenChange={(open) => {
            setCancelOpen(open);
            if (!open) setCancelReason("");
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cancel this onboarding?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Open tasks will close, the employee record will become inactive and their VIA portal
              access will be suspended. The history will remain available.
            </p>
            <Textarea
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="Explain why this onboarding is being cancelled"
              rows={4}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setCancelOpen(false)}>
                Keep onboarding
              </Button>
              <Button
                variant="destructive"
                disabled={cancelReason.trim().length < 5}
                onClick={handleCancel}
              >
                Cancel onboarding
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </RequirePermission>
  );
}

function SafeMessage({ title, message }: { title: string; message: string }) {
  return (
    <div className="mx-auto max-w-xl p-8">
      <Card>
        <CardContent className="p-10 text-center">
          <Lock className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <h1 className="font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        </CardContent>
      </Card>
    </div>
  );
}
