import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  FileText,
  FileUp,
  Pencil,
  Plus,
  Send,
  Target,
  Trash2,
} from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentUser } from "@/lib/auth";
import { getApplicationDataServices } from "@/lib/data/application-data";
import { GoalService, type EmployeeGoal, type GoalDraftInput } from "@/lib/data/goal-service";
import { PerformanceService } from "@/lib/data/performance-service";

type GoalForm = Omit<GoalDraftInput, "employeeId" | "cycleId">;

const emptyGoal = (): GoalForm => ({
  title: "",
  description: "",
  successMeasure: "",
  targetValue: "",
  startDate: new Date().toISOString().slice(0, 10),
  dueDate: "",
  weight: 25,
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The objective could not be saved.";
}

function statusTone(status: EmployeeGoal["status"]): string {
  if (status === "Active" || status === "Completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "Pending Approval" || status === "Completion Pending") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (status === "Changes Requested") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export function ObjectivesWorkspace() {
  const currentUser = useCurrentUser();
  const context = useMemo(() => currentUser.getActorContext(), [currentUser]);
  const employeeId = currentUser.employeeId ?? "";
  const goalService = useMemo(() => new GoalService(), []);
  const performanceService = useMemo(() => new PerformanceService(), []);
  const cycles = useMemo(
    () =>
      employeeId
        ? performanceService
            .getCyclesForEmployee(employeeId, context)
            .filter((cycle) => cycle.status === "Active")
        : [],
    [context, employeeId, performanceService],
  );
  const [cycleId, setCycleId] = useState("");
  const [goals, setGoals] = useState<EmployeeGoal[]>([]);
  const [editing, setEditing] = useState<EmployeeGoal | null>(null);
  const [form, setForm] = useState<GoalForm>(emptyGoal);
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [progressGoal, setProgressGoal] = useState<EmployeeGoal | null>(null);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressComment, setProgressComment] = useState("");
  const [evidence, setEvidence] = useState<File | null>(null);
  const [deleteGoal, setDeleteGoal] = useState<EmployeeGoal | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!cycleId && cycles[0]) setCycleId(cycles[0].id);
  }, [cycleId, cycles]);

  const refresh = () => {
    if (!employeeId || !cycleId) return setGoals([]);
    setGoals(goalService.getGoalsForEmployee(employeeId, context, cycleId));
  };

  useEffect(refresh, [cycleId, context, employeeId, goalService]);

  const selectedCycle = cycles.find((cycle) => cycle.id === cycleId);
  const totalWeight = goals
    .filter((goal) => goal.status !== "Cancelled")
    .reduce((total, goal) => total + goal.weight, 0);
  const canSubmit =
    goals.length > 0 &&
    totalWeight === 100 &&
    goals.some((goal) => goal.status === "Draft" || goal.status === "Changes Requested") &&
    goals.every((goal) => ["Draft", "Changes Requested", "Active"].includes(goal.status));

  const openCreate = () => {
    setEditing(null);
    setForm({
      ...emptyGoal(),
      dueDate: selectedCycle?.selfAssessmentDeadline ?? "",
    });
    setGoalDialogOpen(true);
  };

  const openEdit = (goal: EmployeeGoal) => {
    setEditing(goal);
    setForm({
      title: goal.title,
      description: goal.description,
      successMeasure: goal.successMeasure,
      targetValue: goal.targetValue,
      startDate: goal.startDate,
      dueDate: goal.dueDate,
      weight: goal.weight,
    });
    setGoalDialogOpen(true);
  };

  const saveGoal = () => {
    if (!employeeId || !cycleId) return;
    try {
      if (editing) goalService.updateGoal(editing.id, form, context);
      else goalService.createGoal({ ...form, employeeId, cycleId }, context);
      setGoalDialogOpen(false);
      refresh();
      toast.success(editing ? "Objective updated" : "Objective saved as a draft");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const submitObjectives = () => {
    try {
      goalService.submitCycleGoalsForApproval(employeeId, cycleId, context);
      refresh();
      toast.success("Objectives sent to your supervisor");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const saveProgress = async () => {
    if (!progressGoal) return;
    setBusy(true);
    let uploadedId: string | undefined;
    try {
      if (evidence) {
        const metadata = await getApplicationDataServices().files.save(
          {
            blob: evidence,
            name: evidence.name,
            mimeType: evidence.type,
            owner: { entityType: "performance-goal", entityId: progressGoal.id },
          },
          context,
        );
        uploadedId = metadata.id;
      }
      await goalService.recordProgress(
        progressGoal.id,
        progressPercent,
        progressComment,
        uploadedId,
        context,
      );
      setProgressGoal(null);
      setProgressComment("");
      setEvidence(null);
      refresh();
      toast.success(
        progressPercent === 100 ? "Completion sent to your supervisor" : "Progress update recorded",
      );
    } catch (error) {
      if (uploadedId) {
        await getApplicationDataServices().files.delete(uploadedId, {
          ...context,
          reason: "Removed objective evidence after the progress update failed",
        });
      }
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const viewEvidence = async (goalId: string, checkInId: string) => {
    try {
      const result = await goalService.getEvidenceFile(goalId, checkInId, {
        ...context,
        reason: "Employee viewed objective progress evidence",
      });
      const url = URL.createObjectURL(result.blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (cycles.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center py-12 text-center">
          <Target className="mb-3 h-10 w-10 text-muted-foreground" />
          <h3 className="font-semibold">No objective-setting cycle is open</h3>
          <p className="mt-1 max-w-lg text-sm text-muted-foreground">
            HR will open the relevant performance cycle before objectives can be drafted.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center">
        <div>
          <p className="font-medium">Performance cycle</p>
          <p className="text-sm text-muted-foreground">
            Create measurable objectives whose combined weight equals 100%.
          </p>
        </div>
        <Select value={cycleId} onValueChange={setCycleId}>
          <SelectTrigger className="w-full sm:w-72">
            <SelectValue placeholder="Select cycle" />
          </SelectTrigger>
          <SelectContent>
            {cycles.map((cycle) => (
              <SelectItem key={cycle.id} value={cycle.id}>
                {cycle.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Objectives</p>
            <p className="mt-1 text-2xl font-semibold">{goals.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Combined weight</p>
            <p
              className={
                totalWeight === 100
                  ? "mt-1 text-2xl font-semibold text-emerald-600"
                  : "mt-1 text-2xl font-semibold"
              }
            >
              {totalWeight}%
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Objective deadline</p>
            <p className="mt-1 font-semibold">
              {selectedCycle?.objectiveSettingDeadline ?? "Set by HR"}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={openCreate} disabled={totalWeight >= 100}>
          <Plus className="mr-2 h-4 w-4" /> Add objective
        </Button>
        <Button onClick={submitObjectives} disabled={!canSubmit}>
          <Send className="mr-2 h-4 w-4" /> Submit objectives
        </Button>
      </div>

      {goals.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground">
            No objectives have been drafted for this cycle.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {goals.map((goal) => (
            <Card key={goal.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div>
                    <CardTitle className="text-lg">{goal.title}</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {goal.startDate} to {goal.dueDate} · {goal.weight}% weight
                    </p>
                  </div>
                  <Badge variant="outline" className={statusTone(goal.status)}>
                    {goal.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm">{goal.description}</p>
                <div className="grid gap-3 rounded-lg bg-muted/40 p-3 text-sm md:grid-cols-2">
                  <div>
                    <p className="text-muted-foreground">How success is measured</p>
                    <p className="font-medium">{goal.successMeasure}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Expected result</p>
                    <p className="font-medium">{goal.targetValue}</p>
                  </div>
                </div>
                {goal.managerFeedback && goal.status === "Changes Requested" && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                    <strong>Supervisor feedback:</strong> {goal.managerFeedback}
                  </div>
                )}
                {(goal.status === "Active" ||
                  goal.status === "Completion Pending" ||
                  goal.status === "Completed") && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Progress</span>
                      <strong>{goal.progressPercent}%</strong>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${goal.progressPercent}%` }}
                      />
                    </div>
                    {goal.checkIns.length > 0 && (
                      <div className="space-y-2 pt-2">
                        {goal.checkIns
                          .slice()
                          .reverse()
                          .slice(0, 3)
                          .map((checkIn) => (
                            <div
                              key={checkIn.id}
                              className="flex items-start justify-between gap-2 text-xs text-muted-foreground"
                            >
                              <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              <span>
                                {checkIn.progressPercent}% · {checkIn.progressComment} ·{" "}
                                {new Date(checkIn.createdAt).toLocaleDateString()}
                              </span>
                              {checkIn.evidenceFileId && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 shrink-0 px-2"
                                  onClick={() => void viewEvidence(goal.id, checkIn.id)}
                                >
                                  <FileText className="mr-1 h-3.5 w-3.5" /> Evidence
                                </Button>
                              )}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
                  {(goal.status === "Draft" || goal.status === "Changes Requested") && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setDeleteGoal(goal)}>
                        <Trash2 className="mr-2 h-4 w-4" /> Remove
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openEdit(goal)}>
                        <Pencil className="mr-2 h-4 w-4" /> Edit
                      </Button>
                    </>
                  )}
                  {goal.status === "Active" && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setProgressGoal(goal);
                        setProgressPercent(goal.progressPercent);
                      }}
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" /> Record progress
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={goalDialogOpen} onOpenChange={setGoalDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit objective" : "Create objective"}</DialogTitle>
            <DialogDescription>
              Define the result, measurement, timing and relative importance.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="goal-title">Objective</Label>
              <Input
                id="goal-title"
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="goal-description">What will be delivered?</Label>
              <Textarea
                id="goal-description"
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="goal-measure">How will success be measured?</Label>
                <Textarea
                  id="goal-measure"
                  value={form.successMeasure}
                  onChange={(event) => setForm({ ...form, successMeasure: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="goal-target">Expected target or result</Label>
                <Textarea
                  id="goal-target"
                  value={form.targetValue}
                  onChange={(event) => setForm({ ...form, targetValue: event.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="goal-start">Start date</Label>
                <Input
                  id="goal-start"
                  type="date"
                  value={form.startDate}
                  onChange={(event) => setForm({ ...form, startDate: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="goal-due">Due date</Label>
                <Input
                  id="goal-due"
                  type="date"
                  value={form.dueDate}
                  onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="goal-weight">Weight (%)</Label>
                <Input
                  id="goal-weight"
                  type="number"
                  min={1}
                  max={100}
                  value={form.weight}
                  onChange={(event) => setForm({ ...form, weight: Number(event.target.value) })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGoalDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveGoal}>{editing ? "Save changes" : "Save draft"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(progressGoal)} onOpenChange={(open) => !open && setProgressGoal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record objective progress</DialogTitle>
            <DialogDescription>{progressGoal?.title}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="progress-percent">Progress (%)</Label>
              <Input
                id="progress-percent"
                type="number"
                min={progressGoal?.progressPercent ?? 0}
                max={100}
                value={progressPercent}
                onChange={(event) => setProgressPercent(Number(event.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="progress-comment">Result, evidence or blocker</Label>
              <Textarea
                id="progress-comment"
                value={progressComment}
                onChange={(event) => setProgressComment(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="progress-evidence">Supporting file (optional)</Label>
              <Input
                id="progress-evidence"
                type="file"
                onChange={(event) => setEvidence(event.target.files?.[0] ?? null)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProgressGoal(null)}>
              Cancel
            </Button>
            <Button onClick={saveProgress} disabled={busy}>
              <FileUp className="mr-2 h-4 w-4" /> {busy ? "Saving…" : "Save update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteGoal)} onOpenChange={(open) => !open && setDeleteGoal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this objective?</DialogTitle>
            <DialogDescription>
              The draft will be archived and remain available in the audit history.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteGoal(null)}>
              Keep objective
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!deleteGoal) return;
                try {
                  goalService.deleteGoal(deleteGoal.id, context);
                  setDeleteGoal(null);
                  refresh();
                  toast.success("Objective removed");
                } catch (error) {
                  toast.error(errorMessage(error));
                }
              }}
            >
              Remove objective
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
