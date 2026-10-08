import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { getMyTasksFn } from "@/lib/server-functions/task.server";
import { Button } from "@/components/ui/button";
import { AttentionQueue } from "./dashboard-kit";

/** The same verified task list as Tasks & Reminders, without waiting for dashboard modules. */
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
  return (
    <section aria-label="Needs attention" className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Needs attention</h2>
        <Link to="/staff/my-tasks" className="text-sm text-primary underline">
          View all{tasks.data ? ` (${tasks.data.length})` : ""}
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
          items={(tasks.data ?? []).slice(0, 5).map((task) => ({
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
