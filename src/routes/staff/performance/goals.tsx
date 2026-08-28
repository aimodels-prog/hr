import { useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { GoalService, EmployeeGoal } from "@/lib/data/goal-service";
import { EmployeeService } from "@/lib/data/employee-service";
import { PerformanceService } from "@/lib/data/performance-service";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Target, CheckCircle2, Clock, AlertTriangle, Send, Plus } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/staff/performance/goals")({
  component: GoalsRoute,
});

function GoalsRoute() {
  return (
    <RequirePermission permission="performance:view_self" resourceName="Goals">
      <GoalsPage />
    </RequirePermission>
  );
}

function GoalsPage() {
  const { currentEmployee, activeRole, getActorContext } = useCurrentUser();
  const goalService = useMemo(() => new GoalService(), []);
  const empService = useMemo(() => new EmployeeService(), []);
  const perfService = useMemo(() => new PerformanceService(), []);

  const [refresh, setRefresh] = useState(0);
  const triggerRefresh = () => setRefresh((prev) => prev + 1);

  // My Goals
  const myGoals = useMemo(() => {
    if (!currentEmployee) return [];
    return goalService.getGoalsForEmployee(currentEmployee.id);
  }, [currentEmployee, refresh, goalService]);

  // Team Goals (if manager)
  const isManager = activeRole === "Line Manager" || activeRole === "Super Admin";
  const teamPendingGoals = useMemo(() => {
    if (!isManager || !currentEmployee) return [];
    const reports = empService
      .getEmployees(getActorContext())
      .filter((employee) => employee.lineManagerId === currentEmployee.id);
    const reportIds = new Set(reports.map((e) => e.id));
    return goalService
      .getPendingGoalsForManager(currentEmployee.id)
      .filter((g) => reportIds.has(g.employeeId));
  }, [isManager, currentEmployee, refresh, goalService, empService]);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newWeight, setNewWeight] = useState("25");

  const handleAddGoal = () => {
    if (!currentEmployee) return;
    const activeCycles = perfService
      .getCycles()
      .filter((c) => c.status === "Draft" || c.status === "Active");
    const cycleId = activeCycles[0]?.id ?? "Annual-Default";

    goalService.createGoal(
      {
        employeeId: currentEmployee.id,
        cycleId,
        title: newTitle,
        description: newDesc,
        weight: parseInt(newWeight, 10),
        status: "Draft",
      },
      getActorContext(),
    );
    setIsAddOpen(false);
    setNewTitle("");
    setNewDesc("");
    triggerRefresh();
  };

  const handleSubmit = (id: string) => {
    goalService.submitForApproval(id, getActorContext());
    triggerRefresh();
  };

  const handleApprove = (id: string) => {
    goalService.approveGoal(id, getActorContext());
    triggerRefresh();
  };

  const handleReject = (id: string) => {
    goalService.rejectGoal(id, getActorContext());
    triggerRefresh();
  };

  const handleDelete = (id: string) => {
    goalService.deleteGoal(id, getActorContext());
    triggerRefresh();
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "Active":
        return "bg-emerald-100 text-emerald-800 border-emerald-200";
      case "Pending Approval":
        return "bg-amber-100 text-amber-800 border-amber-200";
      case "Draft":
        return "bg-slate-100 text-slate-800 border-slate-200";
      default:
        return "bg-slate-100 text-slate-800 border-slate-200";
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">My Goals & Objectives</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Define your objectives for the year. Approved goals will automatically feed into your
            end-of-year performance appraisal.
          </p>
        </div>
        <Button onClick={() => setIsAddOpen(true)}>
          <Plus className="w-4 h-4 mr-2" /> New Goal
        </Button>
      </div>

      <div className="space-y-4">
        {myGoals.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed rounded-xl text-muted-foreground">
            <Target className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
            <p className="text-lg font-medium">No goals set yet.</p>
            <p className="text-sm mt-1">Start drafting your objectives for the year.</p>
            <Button variant="outline" className="mt-4" onClick={() => setIsAddOpen(true)}>
              Create First Goal
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {myGoals.map((goal) => (
              <Card key={goal.id} className="flex flex-col">
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start gap-2">
                    <CardTitle className="text-base">{goal.title}</CardTitle>
                    <Badge variant="outline" className={statusColor(goal.status)}>
                      {goal.status}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs">Weight: {goal.weight}%</CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground flex-1">
                  {goal.description}
                </CardContent>
                <CardFooter className="pt-4 border-t gap-2 justify-end">
                  {goal.status === "Draft" && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(goal.id)}>
                        Delete
                      </Button>
                      <Button size="sm" onClick={() => handleSubmit(goal.id)}>
                        <Send className="w-3 h-3 mr-2" /> Submit for Approval
                      </Button>
                    </>
                  )}
                  {goal.status === "Active" && (
                    <div className="text-xs text-emerald-600 flex items-center w-full">
                      <CheckCircle2 className="w-4 h-4 mr-1" /> Approved & Active
                    </div>
                  )}
                  {goal.status === "Pending Approval" && (
                    <div className="text-xs text-amber-600 flex items-center w-full">
                      <Clock className="w-4 h-4 mr-1" /> Awaiting Line Manager
                    </div>
                  )}
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Manager View for Team Goals */}
      {isManager && teamPendingGoals.length > 0 && (
        <div className="mt-12 space-y-4">
          <div>
            <h2 className="text-xl font-semibold flex items-center">
              <Target className="w-5 h-5 mr-2" /> Team Goal Approvals
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Direct reports have submitted goals for your approval.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {teamPendingGoals.map((goal) => {
              const emp = empService.getById(goal.employeeId, getActorContext());
              return (
                <Card key={goal.id} className="border-amber-200 bg-amber-50/30">
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-start gap-2">
                      <CardTitle className="text-base">{goal.title}</CardTitle>
                      <Badge
                        variant="outline"
                        className="bg-amber-100 text-amber-800 border-amber-200"
                      >
                        Pending
                      </Badge>
                    </div>
                    <CardDescription className="text-xs">
                      Employee:{" "}
                      <span className="font-medium text-foreground">{emp?.legalName}</span> &bull;
                      Weight: {goal.weight}%
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    {goal.description}
                  </CardContent>
                  <CardFooter className="pt-4 border-t border-amber-100 gap-2 justify-end">
                    <Button variant="outline" size="sm" onClick={() => handleReject(goal.id)}>
                      Return
                    </Button>
                    <Button
                      size="sm"
                      className="bg-amber-600 hover:bg-amber-700"
                      onClick={() => handleApprove(goal.id)}
                    >
                      Approve
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Add Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Draft New Goal</DialogTitle>
            <DialogDescription>
              Define an objective. You can submit it for your manager's approval later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Goal Title</Label>
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Launch New Product Feature"
              />
            </div>
            <div className="space-y-2">
              <Label>Description & Key Results</Label>
              <Textarea
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="How will success be measured?"
                className="min-h-[100px]"
              />
            </div>
            <div className="space-y-2">
              <Label>Relative Weight (%)</Label>
              <Select value={newWeight} onValueChange={setNewWeight}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10% - Minor</SelectItem>
                  <SelectItem value="25">25% - Standard</SelectItem>
                  <SelectItem value="50">50% - Major</SelectItem>
                  <SelectItem value="75">75% - Critical</SelectItem>
                  <SelectItem value="100">100% - Sole Objective</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddGoal} disabled={!newTitle || !newDesc}>
              Save Draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
