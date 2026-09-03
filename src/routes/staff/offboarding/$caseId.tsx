import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  Clock3,
  FileUp,
  Lock,
  ShieldCheck,
  Wallet,
} from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { EmployeeService } from "@/lib/data/employee-service";
import { LifecycleTaskService } from "@/lib/data/lifecycle-task-service";
import { OffboardingService } from "@/lib/data/offboarding-service";
import type { OffboardingTask, OffboardingTaskGroup } from "@/lib/data/offboarding-types";
import { toast } from "sonner";

export const Route = createFileRoute("/staff/offboarding/$caseId")({
  component: OffboardingCaseRoute,
});

const GROUPS: OffboardingTaskGroup[] = [
  "Manager Handover",
  "Project Reassignment",
  "IT & Assets",
  "Access & Security",
  "Visa & Work Permit Cancellation",
  "Leave & Attendance Reconciliation",
  "Expenses & Advances",
  "Final Payroll Input",
  "Exit Interview",
  "Service Documents",
];

function OffboardingCaseRoute() {
  const { caseId } = Route.useParams();
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const [offboardingService] = useState(() => new OffboardingService());
  const [employeeService] = useState(() => new EmployeeService());
  const [taskActions] = useState(() => new LifecycleTaskService());
  // getCaseForViewer confirms case access AND strips confidentialNotes before the case ever
  // reaches component state - a render path that hides confidential fields behind a permission
  // check still leaves them sitting in state/devtools if the unredacted object was fetched
  // first. caseExists is tracked separately (existence only, never stored as a full case) so
  // "not found" and "access denied" can still show distinct messages below.
  const [offboardingCase, setOffboardingCase] = useState(() =>
    offboardingService.getCaseForViewer(caseId, currentUser.getActorContext()),
  );
  const caseExists = offboardingCase !== undefined;
  const [selectedTask, setSelectedTask] = useState<OffboardingTask | null>(null);
  const [waiverReason, setWaiverReason] = useState("");
  const [evidenceFiles, setEvidenceFiles] = useState<Record<string, File>>({});
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const actorContext = useMemo(() => currentUser.getActorContext(), [currentUser]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    void Promise.all([
      employeeService.hydrateCompatibilityCache(actorContext),
      offboardingService.hydrateCompatibilityCache(actorContext),
    ])
      .then(() => {
        if (active) setOffboardingCase(offboardingService.getCaseForViewer(caseId, actorContext));
      })
      .catch((error) => {
        if (active)
          setLoadError(error instanceof Error ? error.message : "Offboarding could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [actorContext, caseId, employeeService, offboardingService]);
  const hasAccess = caseExists && offboardingCase !== undefined;

  // Every mutating service call returns the full, unredacted case - route every update through
  // this so a viewer who cannot see confidentialNotes never has it land in state afterward.
  const applyCaseUpdate = (updated: NonNullable<typeof offboardingCase>) => {
    setOffboardingCase(offboardingService.redactCaseForViewer(updated, actorContext));
  };

  const employee = offboardingCase
    ? employeeService
        .getDirectoryEmployees(actorContext, { includeArchived: true })
        .find((item) => item.id === offboardingCase.employeeId)
    : null;
  const visibleTasks = useMemo(
    () =>
      offboardingCase && hasAccess
        ? offboardingService.getTasksForContext(offboardingCase, actorContext)
        : [],
    [actorContext, hasAccess, offboardingCase, offboardingService],
  );

  if (loading) {
    return (
      <SafeMessage
        title="Loading offboarding"
        message="Retrieving the latest clearance checklist..."
      />
    );
  }
  if (loadError) {
    return <SafeMessage title="Offboarding could not be loaded" message={loadError} />;
  }
  if (!caseExists) {
    return (
      <SafeMessage
        title="Offboarding case not found"
        message="This case may have been removed or the link is no longer valid."
      />
    );
  }
  if (!hasAccess || !offboardingCase) {
    return (
      <SafeMessage
        title="You cannot open this case"
        message="This offboarding work is not assigned to you or the role you are currently using."
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
  const canFinance =
    currentUser.activeRole === "Accounts" || currentUser.activeRole === "Super Admin";
  const canLegal = currentUser.activeRole === "HR" || currentUser.activeRole === "Super Admin";
  const canFinalize = currentUser.activeRole === "Super Admin";
  const canSeeConfidential =
    currentUser.activeRole === "HR" || currentUser.activeRole === "Super Admin";
  const canSeeAudit = currentUser.can("system:audit_view");

  const canComplete = (task: OffboardingTask) => {
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

  const handleComplete = async (task: OffboardingTask) => {
    setBusyTaskId(task.id);
    try {
      const updated = await taskActions.complete(
        "offboarding",
        offboardingCase.id,
        task.id,
        currentUser.getActorContext(),
        evidenceFiles[task.id],
      );
      applyCaseUpdate(updated);
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
        "offboarding",
        offboardingCase.id,
        selectedTask.id,
        waiverReason,
        currentUser.getActorContext(),
      );
      applyCaseUpdate(updated);
      setSelectedTask(null);
      setWaiverReason("");
      toast.success("Task waived");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Task could not be waived");
    }
  };

  const activeUsers = employeeService.getUsers(actorContext).filter((u) => u.status === "Active");

  const handleAssign = async (task: OffboardingTask, userId: string) => {
    try {
      const updated = await offboardingService.assignTaskOwnerAsync(
        offboardingCase.id,
        task.id,
        userId === "role" ? undefined : userId,
        currentUser.getActorContext(),
      );
      applyCaseUpdate(updated);
      toast.success(userId === "role" ? "Task reassignment cleared" : "Task reassigned");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Task could not be reassigned");
    }
  };

  const updateCase = async (
    action: () => Promise<NonNullable<typeof offboardingCase>>,
    message: string,
  ) => {
    try {
      applyCaseUpdate(await action());
      toast.success(message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The case could not be updated");
    }
  };

  const handleCancel = async () => {
    try {
      const updated = await offboardingService.cancelCaseAsync(offboardingCase.id, cancelReason, {
        ...currentUser.getActorContext(),
        reason: cancelReason,
      });
      applyCaseUpdate(updated);
      setCancelOpen(false);
      setCancelReason("");
      toast.success("Offboarding cancelled and the employee is Active again");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Offboarding could not be cancelled");
    }
  };

  const backDestination = canSeeConfidential ? "/staff/offboarding" : "/staff/my-tasks";

  return (
    <RequirePermission permission="employee:view_self" resourceName="Offboarding Case">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 pb-10">
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={() => navigate({ to: backDestination })}
        >
          <ArrowLeft /> {canSeeConfidential ? "Back to Offboarding" : "Back to My Tasks"}
        </Button>

        <PageHeader
          title={`Offboarding: ${employee.legalName}`}
          description={`${employee.position} · ${employee.department} · Last working day ${format(parseISO(offboardingCase.lastWorkingDate), "d MMM yyyy")}`}
          actions={
            <div className="flex items-center gap-3">
              <div className="h-2 w-28 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: `${offboardingCase.progressPercentage}%` }}
                />
              </div>
              <span className="text-sm font-semibold">{offboardingCase.progressPercentage}%</span>
              <Badge variant="outline">{offboardingCase.status}</Badge>
              {canSeeConfidential && offboardingCase.confidentialityLevel === "Restricted" && (
                <Badge variant="destructive" className="gap-1">
                  <Lock className="h-3 w-3" /> Restricted
                </Badge>
              )}
              {canLegal &&
                offboardingCase.status !== "Completed" &&
                offboardingCase.status !== "Cancelled" && (
                  <Button variant="outline" size="sm" onClick={() => setCancelOpen(true)}>
                    <Ban className="h-4 w-4" /> Cancel offboarding
                  </Button>
                )}
            </div>
          }
        />

        {canSeeConfidential && offboardingCase.confidentialNotes && (
          <Card className="border-amber-200 bg-amber-50/60">
            <CardContent className="p-4 text-sm">
              <span className="font-semibold text-amber-900">Private HR note: </span>
              {offboardingCase.confidentialNotes}
            </CardContent>
          </Card>
        )}

        {(canFinance || canLegal || canFinalize) && (
          <Card>
            <CardContent className="grid gap-4 p-5 lg:grid-cols-3">
              <ClearanceItem
                icon={<Wallet />}
                title="Financial clearance"
                complete={Boolean(offboardingCase.financialClearanceAt)}
                detail={
                  offboardingCase.financialClearanceAt
                    ? `Confirmed ${format(new Date(offboardingCase.financialClearanceAt), "d MMM yyyy")}`
                    : "Waiting for Accounts"
                }
                action={
                  canFinance && !offboardingCase.financialClearanceAt ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={offboardingCase.progressPercentage < 100}
                      onClick={() =>
                        void updateCase(
                          () =>
                            offboardingService.applyActionAsync(
                              offboardingCase.id,
                              "financial-clearance",
                              currentUser.getActorContext(),
                            ),
                          "Financial clearance confirmed",
                        )
                      }
                    >
                      Confirm
                    </Button>
                  ) : null
                }
              />
              <ClearanceItem
                icon={<ShieldCheck />}
                title="HR and document clearance"
                complete={Boolean(offboardingCase.legalClearanceAt)}
                detail={
                  offboardingCase.legalClearanceAt
                    ? `Confirmed ${format(new Date(offboardingCase.legalClearanceAt), "d MMM yyyy")}`
                    : "Waiting for HR"
                }
                action={
                  canLegal && !offboardingCase.legalClearanceAt ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={offboardingCase.progressPercentage < 100}
                      onClick={() =>
                        void updateCase(
                          () =>
                            offboardingService.applyActionAsync(
                              offboardingCase.id,
                              "legal-clearance",
                              currentUser.getActorContext(),
                            ),
                          "HR and document clearance confirmed",
                        )
                      }
                    >
                      Confirm
                    </Button>
                  ) : null
                }
              />
              <ClearanceItem
                icon={<Lock />}
                title="Final completion"
                complete={offboardingCase.status === "Completed"}
                detail={
                  offboardingCase.status === "Completed"
                    ? "Employee access is inactive"
                    : "Waiting for all clearances"
                }
                action={
                  canFinalize && offboardingCase.status !== "Completed" ? (
                    <Button
                      size="sm"
                      disabled={
                        offboardingCase.progressPercentage < 100 ||
                        !offboardingCase.financialClearanceAt ||
                        !offboardingCase.legalClearanceAt
                      }
                      onClick={() =>
                        void updateCase(
                          () =>
                            offboardingService.applyActionAsync(
                              offboardingCase.id,
                              "finalise",
                              currentUser.getActorContext(),
                            ),
                          "Offboarding completed and employee access made inactive",
                        )
                      }
                    >
                      Complete offboarding
                    </Button>
                  ) : null
                }
              />
            </CardContent>
          </Card>
        )}

        <div className="space-y-8">
          {GROUPS.map((group) => {
            const groupTasks = visibleTasks.filter((task) => task.group === group);
            if (groupTasks.length === 0) return null;
            return (
              <section key={group} className="space-y-3" aria-labelledby={`group-${group}`}>
                <div className="flex items-center gap-2 border-b pb-2">
                  <h2 id={`group-${group}`} className="text-lg font-semibold">
                    {group}
                  </h2>
                  <Badge variant="secondary">{groupTasks.length}</Badge>
                </div>
                {groupTasks.map((task) => {
                  const done = task.status === "Completed" || task.status === "Waived";
                  const overdue = !done && task.dueDate < new Date().toISOString().slice(0, 10);
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
                            <span>
                              Owner: {task.ownerRole}
                              {task.assignedUserId &&
                                ` (${activeUsers.find((u) => u.id === task.assignedUserId)?.displayName ?? "Unknown"})`}
                            </span>
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
                        </div>
                        {canWaive && !done && (
                          <div className="w-full md:w-56">
                            <label className="text-xs font-medium">
                              Named owner
                              <Select
                                value={task.assignedUserId ?? "role"}
                                onValueChange={(value) => handleAssign(task, value)}
                              >
                                <SelectTrigger className="mt-1">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="role">
                                    Anyone with this responsibility
                                  </SelectItem>
                                  {activeUsers
                                    .filter((u) => u.roles.includes(task.ownerRole))
                                    .map((u) => (
                                      <SelectItem key={u.id} value={u.id}>
                                        {u.displayName}
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                            </label>
                          </div>
                        )}
                        {task.status === "Pending" && canComplete(task) && (
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
                        )}
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
              No offboarding tasks are assigned to you in this case.
            </CardContent>
          </Card>
        )}
        {canSeeAudit && <AuditViewer entityId={offboardingCase.id} entityType="offboarding-case" />}

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
              <DialogTitle>Cancel this offboarding?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Open tasks will close and the employee will be moved back to Active status. The
              history will remain available.
            </p>
            <Textarea
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="Explain why this offboarding is being cancelled"
              rows={4}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setCancelOpen(false)}>
                Keep offboarding
              </Button>
              <Button
                variant="destructive"
                disabled={cancelReason.trim().length < 5}
                onClick={handleCancel}
              >
                Cancel offboarding
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </RequirePermission>
  );
}

function ClearanceItem({
  icon,
  title,
  detail,
  complete,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  complete: boolean;
  action: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border p-3">
      <span className={complete ? "text-emerald-600" : "text-muted-foreground"}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
      {action}
    </div>
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
