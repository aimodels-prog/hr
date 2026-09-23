import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/lib/auth";
import { REQUEST_GROUPS, REQUEST_MODULES, type RequestGroup } from "@/lib/data/request-tracking";
import {
  getTrackedRequestsFn,
  getApprovalInboxFn,
} from "@/lib/server-functions/request-tracking.server";
import { Button } from "@/components/ui/button";
import { GoogleCalendarConnection } from "@/components/interviews/google-calendar-connection";

export const Route = createFileRoute("/staff/requests")({
  component: RequestCentre,
  validateSearch: (
    search: Record<string, unknown>,
  ): { view?: "my" | "approvals" | "organisation" | undefined } => ({
    view:
      search["view"] === "approvals"
        ? "approvals"
        : search["view"] === "organisation"
          ? "organisation"
          : "my",
  }),
});
const date = (value: string) => new Date(value).toLocaleString();
function RequestCentre() {
  const user = useCurrentUser();
  const { view = "my" } = Route.useSearch();
  const hr = ["HR", "Super Admin"].includes(user.activeRole);
  const actor = {
    actorId: user.id,
    ...(user.workspaceEmail ? { actorEmail: user.workspaceEmail } : {}),
    activeRole: user.activeRole,
  };
  const [query, setQuery] = useState("");
  const [module, setModule] = useState<"All" | (typeof REQUEST_MODULES)[number]>("All");
  const [group, setGroup] = useState<RequestGroup>("All");
  const [page, setPage] = useState(1);
  const requestQuery = useQuery({
    queryKey: ["request-tracker", actor, view, query, module, group, page],
    queryFn: () =>
      getTrackedRequestsFn({
        data: {
          actor,
          scope: view === "organisation" ? "organisation" : "my",
          page,
          query,
          module,
          group,
        },
      }),
    enabled:
      typeof window !== "undefined" && view !== "approvals" && (view !== "organisation" || hr),
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
  const inbox = useQuery({
    queryKey: ["approval-inbox", actor],
    queryFn: () => getApprovalInboxFn({ data: { actor } }),
    enabled: typeof window !== "undefined",
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
  const active = view === "approvals" ? inbox : requestQuery;
  return (
    <main className="space-y-5 min-w-0">
      <header>
        <h1 className="text-2xl font-bold">Requests & approvals</h1>
        <p className="text-sm text-muted-foreground">
          See what was submitted, who is responsible and what happens next. Notifications are not
          approval decisions.
        </p>
      </header>
      <div className="grid gap-5 lg:grid-cols-[210px_minmax(0,1fr)]">
        <nav
          aria-label="Request centre sections"
          className="flex flex-col gap-2 rounded-xl border bg-card p-3 h-fit"
        >
          {(
            [
              ["my", "My Requests"],
              ["approvals", `Needs My Approval${inbox.data ? ` (${inbox.data.length})` : ""}`],
              ...(hr ? [["organisation", "Organisation Tracker"]] : []),
            ] as Array<["my" | "approvals" | "organisation", string]>
          ).map(([value, label]) => (
            <Link
              key={value}
              to="/staff/requests"
              search={{ view: value }}
              onClick={() => setPage(1)}
              aria-current={view === value ? "page" : undefined}
              className={`rounded-lg px-3 py-3 text-sm ${view === value ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              {label}
            </Link>
          ))}
          <Link to="/staff/my-tasks" className="px-3 py-3 text-sm underline">
            All tasks & reminders
          </Link>
        </nav>
        <div className="space-y-4 min-w-0">
          {view === "organisation" && !hr ? (
            <p role="alert">Only HR can access the organisation tracker.</p>
          ) : (
            <>
              <div className="flex flex-wrap justify-between items-center gap-3">
                <h2 className="text-lg font-semibold">
                  {view === "my"
                    ? "My Requests"
                    : view === "approvals"
                      ? "Needs My Approval"
                      : "Organisation Tracker"}
                </h2>
                <Button
                  variant="outline"
                  disabled={active.isFetching}
                  onClick={() => void active.refetch()}
                >
                  Refresh
                </Button>
              </div>
              {view === "approvals" ? (
                <p className="text-sm text-muted-foreground">
                  Decisions assigned to you while working as{" "}
                  {user.activeRole === "Accounts" ? "Finance" : user.activeRole}. Open the record to
                  review; existing approval and independent-review rules still apply.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="text-sm">
                    Search
                    <input
                      type="search"
                      maxLength={160}
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setPage(1);
                      }}
                      placeholder="Name, email or request reference"
                      className="mt-1 w-full rounded-lg border bg-background p-3"
                    />
                  </label>
                  <label className="text-sm">
                    Module
                    <select
                      value={module}
                      onChange={(e) => {
                        setModule(e.target.value as typeof module);
                        setPage(1);
                      }}
                      className="mt-1 w-full rounded-lg border bg-background p-3"
                    >
                      {["All", ...REQUEST_MODULES].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    Status
                    <select
                      value={group}
                      onChange={(e) => {
                        setGroup(e.target.value as RequestGroup);
                        setPage(1);
                      }}
                      className="mt-1 w-full rounded-lg border bg-background p-3"
                    >
                      {REQUEST_GROUPS.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              {active.isPending && <p role="status">Loading requests…</p>}
              {active.isError && (
                <p role="alert">
                  Requests could not be refreshed. Please try again. Previously loaded information
                  may be out of date.
                </p>
              )}
              {view === "approvals" ? (
                inbox.data?.length ? (
                  inbox.data.map((task) => (
                    <article key={task.id} className="space-y-2 rounded-xl border bg-card p-4">
                      <div className="flex justify-between gap-3">
                        <h3 className="font-semibold">{task.title}</h3>
                        <span className="text-sm">{task.state}</span>
                      </div>
                      <p className="text-sm">{task.description}</p>
                      {task.dueDate && (
                        <p className="text-xs text-muted-foreground">Review due: {task.dueDate}</p>
                      )}
                      <Link
                        to={task.actionUrl}
                        className="inline-block py-2 text-sm text-primary underline"
                      >
                        {task.actionLabel}
                      </Link>
                    </article>
                  ))
                ) : (
                  !inbox.isPending &&
                  !inbox.isError && <p>No decisions are currently waiting for you in this role.</p>
                )
              ) : (
                <>
                  {requestQuery.data?.rows.map((row) => (
                    <article
                      key={`${row.module}:${row.id}`}
                      className="rounded-xl border bg-card p-4 space-y-3"
                    >
                      <div className="flex flex-wrap justify-between gap-2">
                        <div>
                          <h3 className="font-semibold">{row.title}</h3>
                          <p className="text-xs text-muted-foreground">
                            {row.module} · {row.employeeName} · Ref {row.id}
                          </p>
                        </div>
                        <span className="text-sm font-medium">{row.status}</span>
                      </div>
                      <p className="text-sm">
                        <strong>Waiting for:</strong> {row.waitingFor}
                      </p>
                      <p className="text-sm text-muted-foreground">{row.nextStep}</p>
                      <p className="text-xs text-muted-foreground">
                        Created: {date(row.createdAt)} · Last updated: {date(row.updatedAt)}
                      </p>
                      <details>
                        <summary className="min-h-10 cursor-pointer text-sm font-medium">
                          Progress timeline
                        </summary>
                        <ol className="ml-2 border-l pl-4 space-y-3">
                          {row.events.map((event, index) => (
                            <li key={index} className="text-sm">
                              <p>{event.label}</p>
                              <time className="text-xs text-muted-foreground">
                                {date(event.at)}
                              </time>
                              {event.comment && (
                                <p className="whitespace-pre-wrap">{event.comment}</p>
                              )}
                            </li>
                          ))}
                          <li className="text-sm font-medium">
                            Current: {row.status} · {row.waitingFor}
                          </li>
                        </ol>
                        <p className="mt-3 text-xs text-muted-foreground">
                          Only recorded timestamps are shown. Older records may not contain every
                          historical step. Open the source record for full decision details.
                        </p>
                      </details>
                      <Link
                        to={row.actionUrl}
                        className="inline-block py-2 text-sm text-primary underline"
                      >
                        Open request / details
                      </Link>
                    </article>
                  ))}
                  {requestQuery.data && !requestQuery.data.total && (
                    <p>No requests match these filters.</p>
                  )}
                  {requestQuery.data && (
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        variant="outline"
                        disabled={page === 1 || requestQuery.isFetching}
                        onClick={() => setPage(page - 1)}
                      >
                        Previous
                      </Button>
                      <span className="text-sm">
                        Page {page} · {requestQuery.data.total} records
                      </span>
                      <Button
                        variant="outline"
                        disabled={page * 30 >= requestQuery.data.total || requestQuery.isFetching}
                        onClick={() => setPage(page + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
          {view === "organisation" && hr && <GoogleCalendarConnection />}
        </div>
      </div>
    </main>
  );
}
