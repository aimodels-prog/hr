import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { isApprovalTask } from "@/lib/data/request-tracking";
import { getMyTasksFn } from "@/lib/server-functions/task.server";
import { Button } from "@/components/ui/button";
import { AttentionQueue } from "./dashboard-kit";

/** Personal tasks and reminders only; decisions live in the approvals inbox. */
export function DashboardActionQueue() {
  const user = useCurrentUser();
  const actor = {
    actorId: user.id,
    activeRole: user.activeRole,
    ...(user.workspaceEmail ? { actorEmail: user.workspaceEmail } : {}),
  };
  const tasks = useQuery({
    queryKey: ["dashboard-action-queue", actor],
    queryFn: () => getMyTasksFn({ data: { actor } }),
    enabled: typeof window !== "undefined",
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
  const reminderTasks = (tasks.data ?? []).filter((task) => !isApprovalTask(task));
  if (tasks.isSuccess && reminderTasks.length === 0) return null;
  return (
    <section aria-label="Tasks and reminders" className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Tasks & reminders</h2>
        <Link to="/staff/my-tasks" className="text-sm text-primary underline">
          View tasks{tasks.data ? ` (${reminderTasks.length})` : ""}
        </Link>
      </div>
      {tasks.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Checking tasks…
        </p>
      ) : tasks.isError ? (
        <div role="alert" className="flex items-center gap-3 text-sm">
          Tasks could not be loaded.
          <Button size="sm" variant="outline" onClick={() => tasks.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <AttentionQueue
          items={reminderTasks.slice(0, 5).map((task) => ({
            id: task.id,
            severity:
              task.state === "Overdue" || task.priority === "High" || task.priority === "Critical"
                ? "warning"
                : "info",
            icon: ClipboardCheck,
            title: task.title,
            meta: task.subjectName || task.description,
            actionLabel: task.actionLabel,
            actionTo: task.actionUrl,
          }))}
        />
      )}
    </section>
  );
}
