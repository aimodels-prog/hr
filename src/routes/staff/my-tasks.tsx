import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  ListChecks,
  RefreshCcw,
  Search,
  ShieldAlert,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCurrentUser } from "@/lib/auth";
import { TaskService, type AppTask, type TaskState } from "@/lib/data/task-service";

export const Route = createFileRoute("/staff/my-tasks")({
  component: MyTasksRoute,
});

type TaskView = "All" | TaskState;

const stateStyles: Record<TaskState, string> = {
  Open: "border-border bg-muted/40 text-muted-foreground",
  "Due Soon": "border-amber-200 bg-amber-50 text-amber-800",
  Overdue: "border-rose-200 bg-rose-50 text-rose-800",
  Blocked: "border-slate-200 bg-slate-100 text-slate-700",
};

function MyTasksRoute() {
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const [taskService] = useState(() => new TaskService());
  const [tasks, setTasks] = useState<AppTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [moduleFilter, setModuleFilter] = useState("All");
  const [view, setView] = useState<TaskView>("All");
  const actorContext = useMemo(() => currentUser.getActorContext(), [currentUser]);

  const loadTasks = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setTasks(await taskService.getMyTasksAsync(actorContext));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Tasks could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, [actorContext, taskService]);

  useEffect(() => {
    void loadTasks();
    const refreshOnFocus = () => void loadTasks();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadTasks();
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadTasks]);

  const modules = useMemo(
    () => ["All", ...new Set(tasks.map((task) => task.module).sort())],
    [tasks],
  );
  const filteredTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return tasks.filter((task) => {
      if (moduleFilter !== "All" && task.module !== moduleFilter) return false;
      if (view !== "All" && task.state !== view) return false;
      if (!normalizedQuery) return true;
      const searchableValues = [task.title, task.description, task.module];
      if (currentUser.activeRole !== "Employee") searchableValues.push(task.subjectName ?? "");
      return searchableValues
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalizedQuery));
    });
  }, [currentUser.activeRole, moduleFilter, query, tasks, view]);

  const totals = {
    all: tasks.length,
    overdue: tasks.filter((task) => task.state === "Overdue").length,
    dueSoon: tasks.filter((task) => task.state === "Due Soon").length,
    blocked: tasks.filter((task) => task.state === "Blocked").length,
  };

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-6 pb-10">
      <PageHeader
        title="My Tasks"
        description={
          currentUser.activeRole === "Employee"
            ? "Your personal actions and deadlines in one place."
            : `Approvals and actions assigned to you while working as ${currentUser.activeRole === "Line Manager" ? "Supervisor" : currentUser.activeRole}.`
        }
        actions={
          <Button variant="outline" onClick={() => void loadTasks()} disabled={isLoading}>
            <RefreshCcw className={isLoading ? "animate-spin" : ""} /> Refresh
          </Button>
        }
      />

      <section aria-label="Task summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="All open tasks"
          value={totals.all}
          icon={<ListChecks className="h-4 w-4" />}
          selected={view === "All"}
          onClick={() => setView("All")}
        />
        <SummaryCard
          label="Overdue"
          value={totals.overdue}
          icon={<ShieldAlert className="h-4 w-4" />}
          tone="danger"
          selected={view === "Overdue"}
          onClick={() => setView("Overdue")}
        />
        <SummaryCard
          label="Due within 7 days"
          value={totals.dueSoon}
          icon={<Clock3 className="h-4 w-4" />}
          tone="warning"
          selected={view === "Due Soon"}
          onClick={() => setView("Due Soon")}
        />
        <SummaryCard
          label="Waiting on another task"
          value={totals.blocked}
          icon={<AlertCircle className="h-4 w-4" />}
          selected={view === "Blocked"}
          onClick={() => setView("Blocked")}
        />
      </section>

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_220px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                currentUser.activeRole === "Employee"
                  ? "Search my tasks"
                  : "Search tasks or employee names"
              }
              aria-label="Search tasks"
              className="pl-9"
            />
          </div>
          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger aria-label="Filter tasks by area">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {modules.map((module) => (
                <SelectItem key={module} value={module}>
                  {module === "All" ? "All areas" : module}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="grid gap-3" aria-label="Loading tasks">
          {[0, 1, 2].map((item) => (
            <Card key={item} className="animate-pulse">
              <CardContent className="h-28 p-5" />
            </Card>
          ))}
        </div>
      ) : error ? (
        <Card className="border-rose-200 bg-rose-50/60">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <AlertCircle className="h-9 w-9 text-rose-600" />
            <div>
              <h2 className="font-semibold">Tasks could not be loaded</h2>
              <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            </div>
            <Button onClick={() => void loadTasks()}>Try again</Button>
          </CardContent>
        </Card>
      ) : filteredTasks.length === 0 ? (
        <Card className="border-dashed bg-muted/20">
          <CardContent className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
            <CheckCircle2 className="mb-4 h-12 w-12 text-emerald-500 opacity-70" />
            <h2 className="text-lg font-semibold text-foreground">
              {tasks.length === 0 ? "You’re all caught up" : "No tasks match these filters"}
            </h2>
            <p className="mt-1 max-w-md text-sm">
              {tasks.length === 0
                ? "There are no approvals or actions waiting for you in this role."
                : "Clear the search or choose another task area to see more work."}
            </p>
            {tasks.length > 0 && (
              <Button
                className="mt-4"
                variant="outline"
                onClick={() => {
                  setQuery("");
                  setModuleFilter("All");
                  setView("All");
                }}
              >
                Clear filters
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1 text-sm text-muted-foreground">
            <span>
              {filteredTasks.length} task{filteredTasks.length === 1 ? "" : "s"}
            </span>
            {view !== "All" && (
              <Button variant="ghost" size="sm" onClick={() => setView("All")}>
                Show all
              </Button>
            )}
          </div>
          {filteredTasks.map((task) => (
            <Card key={task.id} className="overflow-hidden transition-shadow hover:shadow-md">
              <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{task.module}</Badge>
                    <Badge variant="outline" className={stateStyles[task.state]}>
                      {task.state}
                    </Badge>
                    {(task.priority === "High" || task.priority === "Critical") && (
                      <Badge variant="destructive">
                        {task.priority === "Critical" ? "Urgent" : "Important"}
                      </Badge>
                    )}
                  </div>
                  <h2 className="font-semibold text-foreground">{task.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                    {task.subjectName && currentUser.activeRole !== "Employee" && (
                      <span>For {task.subjectName}</span>
                    )}
                    {task.dueDate && (
                      <span
                        className={task.state === "Overdue" ? "font-semibold text-rose-700" : ""}
                      >
                        Due {format(parseISO(task.dueDate), "d MMM yyyy")}
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  className="w-full shrink-0 sm:w-auto"
                  variant={task.state === "Blocked" ? "outline" : "default"}
                  onClick={() => navigate({ to: task.actionUrl })}
                >
                  {task.actionLabel} <ArrowRight className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  selected,
  onClick,
  tone = "default",
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  selected: boolean;
  onClick: () => void;
  tone?: "default" | "warning" | "danger";
}) {
  const toneClass =
    tone === "danger" ? "text-rose-700" : tone === "warning" ? "text-amber-700" : "text-primary";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-2xl border bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-primary ring-1 ring-primary/20" : "border-border/80"}`}
    >
      <span className={`flex items-center gap-2 text-sm font-medium ${toneClass}`}>
        {icon} {label}
      </span>
      <span className="mt-2 block text-2xl font-bold text-foreground">{value}</span>
    </button>
  );
}
