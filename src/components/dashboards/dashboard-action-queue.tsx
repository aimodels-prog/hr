import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  ClipboardCheck,
  Clock3,
  FileUp,
  Landmark,
  Search,
  UserRound,
} from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { isApprovalTask } from "@/lib/data/request-tracking";
import type { AppTask } from "@/lib/data/task-service";
import { getMyTasksFn } from "@/lib/server-functions/task.server";
import { getDashboardMissingDocumentsFn } from "@/lib/server-functions/dashboard-document-checklist.server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function taskVisual(task: AppTask) {
  const title = task.title.toLowerCase();
  if (task.actionLabel.toLowerCase().includes("upload")) {
    return { icon: FileUp, color: "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300" };
  }
  if (title.includes("bank") || title.includes("salary")) {
    return {
      icon: Landmark,
      color: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
    };
  }
  if (title.includes("personal") || title.includes("emergency") || title.includes("profile")) {
    return {
      icon: UserRound,
      color: "bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300",
    };
  }
  if (task.module === "Timesheets" || task.module === "Attendance") {
    return {
      icon: Clock3,
      color: "bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300",
    };
  }
  return { icon: ClipboardCheck, color: "bg-primary/10 text-primary" };
}

function taskActionLabel(task: AppTask) {
  if (task.actionLabel !== "Open task") return task.actionLabel;
  if (task.title.toLowerCase().includes("bank")) return "Add bank details";
  if (task.title.toLowerCase().includes("personal")) return "Complete details";
  return task.actionLabel;
}

/** A single dashboard home for personal tasks and missing required documents. */
export function DashboardActionQueue() {
  const user = useCurrentUser();
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");
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
  const documents = useQuery({
    queryKey: ["dashboard-missing-documents", actor],
    queryFn: () => getDashboardMissingDocumentsFn({ data: { actor } }),
    enabled: typeof window !== "undefined",
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const reminders = (tasks.data ?? []).filter((task) => !isApprovalTask(task));
  const missing = documents.data ?? [];
  const actionableMissing = missing.filter((item) =>
    user.activeRole === "HR" ? item.uploadBy === "HR" : item.uploadBy === "Employee",
  ).length;
  const matches = search.trim()
    ? missing.filter((item) =>
        `${item.employeeName} ${item.requirementName}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
      )
    : missing;
  const shown = expanded ? matches : matches.slice(0, 6);
  if (tasks.isSuccess && documents.isSuccess && !reminders.length && !missing.length) return null;

  return (
    <div aria-label="Outstanding actions" className="space-y-4">
      {(missing.length > 0 || documents.isPending || documents.isError) && (
        <section
          aria-label="Documents to upload"
          className="rounded-2xl border border-amber-300/70 bg-gradient-to-br from-amber-50 via-card to-card p-5 shadow-[0_12px_28px_rgba(154,92,16,0.08)] dark:border-amber-700/60 dark:from-amber-950/30"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                <FileUp className="size-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.13em] text-amber-800 dark:text-amber-200">
                  {actionableMissing > 0 ? "Action needed" : "Document status"}
                </p>
                <h2 className="mt-0.5 text-lg font-semibold">
                  {user.activeRole === "HR" ? "Missing staff documents" : "Documents to upload"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {user.activeRole === "HR"
                    ? "See what is missing and who should provide it."
                    : "Complete your employee file."}
                </p>
              </div>
            </div>
            {missing.length > 0 && (
              <span className="rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900 dark:border-amber-700 dark:bg-amber-900/50 dark:text-amber-100">
                {missing.length} missing
              </span>
            )}
          </div>
          {documents.isPending ? (
            <p role="status" className="mt-5 text-sm text-muted-foreground">
              Checking required documents…
            </p>
          ) : documents.isError ? (
            <div role="alert" className="mt-5 flex items-center gap-3 text-sm">
              Missing documents could not be loaded.
              <Button size="sm" variant="outline" onClick={() => void documents.refetch()}>
                Try again
              </Button>
            </div>
          ) : (
            <>
              {expanded && missing.length > 12 && (
                <div className="relative mt-5 max-w-sm">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="bg-card pl-9"
                    placeholder="Find a person or document"
                    aria-label="Find a person or document"
                  />
                </div>
              )}
              <div
                className={`mt-5 grid gap-2 lg:grid-cols-2 ${expanded ? "max-h-[30rem] overflow-y-auto pr-1" : ""}`}
              >
                {shown.map((item) => {
                  const self = user.activeRole !== "HR" || item.employeeId === user.employeeId;
                  const canUpload = user.activeRole === "HR" || item.uploadBy === "Employee";
                  const hash = `section=documents&upload=${encodeURIComponent(item.requirementId)}`;
                  return (
                    <div
                      key={`${item.employeeId}-${item.requirementId}`}
                      className="flex min-w-0 items-center gap-3 rounded-xl border border-amber-200/80 bg-card p-3 shadow-sm dark:border-amber-800/60"
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-amber-100/80 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                        <FileUp className="size-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{item.requirementName}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {user.activeRole === "HR"
                            ? `${item.employeeName} · ${item.uploadBy === "HR" ? "HR upload" : "Staff upload"}`
                            : item.uploadBy === "HR"
                              ? "HR will upload this"
                              : "Required for your profile"}
                        </p>
                      </div>
                      {canUpload && (
                        <Button
                          asChild
                          size="sm"
                          variant="outline"
                          className="shrink-0 border-amber-300 bg-card"
                        >
                          {self ? (
                            <Link to="/staff/me/profile" hash={hash}>
                              Upload <ArrowUpRight className="ml-1 size-3.5" />
                            </Link>
                          ) : (
                            <Link
                              to="/staff/employees/$employeeId"
                              params={{ employeeId: item.employeeId }}
                              hash={hash}
                            >
                              Upload <ArrowUpRight className="ml-1 size-3.5" />
                            </Link>
                          )}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
              {expanded && !shown.length && (
                <p className="mt-4 text-sm text-muted-foreground">
                  No documents match that search.
                </p>
              )}
              {missing.length > 6 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-3 text-amber-900 dark:text-amber-100"
                  onClick={() => setExpanded((value) => !value)}
                >
                  {expanded ? "Show fewer" : `Show all ${missing.length} documents`}
                </Button>
              )}
            </>
          )}
        </section>
      )}
      {(reminders.length > 0 || tasks.isPending || tasks.isError) && (
        <section
          aria-label="Tasks and reminders"
          className="relative overflow-hidden rounded-2xl border border-border/80 bg-card p-4 shadow-[0_12px_32px_rgba(15,50,90,0.06)] sm:p-5"
        >
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-sky-500 to-emerald-400"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <ClipboardCheck className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Your next steps</h2>
                {reminders.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {reminders.length} {reminders.length === 1 ? "task" : "tasks"} to complete
                  </p>
                )}
              </div>
            </div>
            <Link
              to="/staff/my-tasks"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              All tasks <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
          {tasks.isPending ? (
            <p role="status" className="mt-4 text-sm text-muted-foreground">
              Checking tasks…
            </p>
          ) : tasks.isError ? (
            <div role="alert" className="mt-4 flex items-center gap-3 text-sm">
              Tasks could not be loaded.
              <Button size="sm" variant="outline" onClick={() => void tasks.refetch()}>
                Try again
              </Button>
            </div>
          ) : (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {reminders.slice(0, 4).map((task) => {
                const visual = taskVisual(task);
                const Icon = visual.icon;
                const subject =
                  task.subjectEmployeeId && task.subjectEmployeeId !== user.employeeId
                    ? task.subjectName
                    : undefined;
                return (
                  <Link
                    key={task.id}
                    to={task.actionUrl}
                    className="group flex min-h-16 min-w-0 items-center gap-2.5 rounded-xl border border-border/80 bg-muted/20 px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-primary/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span
                      className={`grid size-8 shrink-0 place-items-center rounded-lg ${visual.color}`}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold leading-tight text-foreground">
                        {task.title}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {subject ? `${subject} · ` : ""}
                        {task.state !== "Open" ? task.state : taskActionLabel(task)}
                      </span>
                    </div>
                    <ArrowRight
                      className="size-4 shrink-0 text-primary transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </Link>
                );
              })}
              {reminders.length > 4 && (
                <Link
                  to="/staff/my-tasks"
                  className="flex min-h-16 items-center justify-center rounded-xl border border-dashed border-primary/30 bg-primary/[0.025] px-3 text-sm font-semibold text-primary hover:bg-primary/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  View {reminders.length - 4} more {reminders.length - 4 === 1 ? "task" : "tasks"}
                  <ArrowRight className="ml-2 size-4" aria-hidden="true" />
                </Link>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
