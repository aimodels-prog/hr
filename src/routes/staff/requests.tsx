import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, ClipboardList, Clock3, RotateCw, Search, X } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import {
  REQUEST_GROUPS,
  REQUEST_MODULES,
  type RequestGroup,
  type TrackedRequest,
} from "@/lib/data/request-tracking";
import {
  getTrackedRequestsFn,
  getApprovalInboxFn,
} from "@/lib/server-functions/request-tracking.server";
import { Button } from "@/components/ui/button";
import { PageSections, SectionNavigation, SectionLink } from "@/components/ui/page-sections";
import { approvalActionUrl } from "@/lib/data/approval-links";
import { cn } from "@/lib/utils";
import { DecisionSnapshot } from "@/components/requests/decision-snapshot";

export const Route = createFileRoute("/staff/requests")({
  component: RequestCentre,
  validateSearch: (
    search: Record<string, unknown>,
  ): { view?: "my" | "approvals" | "organisation" | "reviewed" | undefined } => ({
    view:
      search["view"] === "approvals"
        ? "approvals"
        : search["view"] === "organisation"
          ? "organisation"
          : search["view"] === "my"
            ? "my"
            : search["view"] === "reviewed"
              ? "reviewed"
              : undefined,
  }),
});
const date = (value: string) => new Date(value).toLocaleString();
const shortDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const statusTone: Record<Exclude<RequestGroup, "All">, string> = {
  Waiting: "border-amber-200 bg-amber-50 text-amber-800",
  Returned: "border-rose-200 bg-rose-50 text-rose-800",
  Draft: "border-slate-200 bg-slate-100 text-slate-700",
  Approved: "border-emerald-200 bg-emerald-50 text-emerald-800",
  Closed: "border-slate-200 bg-slate-50 text-slate-600",
  Rejected: "border-rose-200 bg-rose-50 text-rose-800",
  "In progress": "border-sky-200 bg-sky-50 text-sky-800",
};
const APPROVAL_PAGE_SIZE = 20;

function TrackedRequestRow({
  row,
  view,
}: {
  row: TrackedRequest;
  view: "my" | "organisation" | "reviewed";
}) {
  const nextStep =
    view === "organisation" && ["Draft", "Returned"].includes(row.group)
      ? "The employee needs to complete or correct this request before submitting it."
      : row.nextStep;
  return (
    <article className="px-4 py-4 transition-colors hover:bg-muted/25 sm:px-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(12rem,0.65fr)_auto] lg:items-center">
        <div className="flex min-w-0 gap-3">
          <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ClipboardList className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span className="font-semibold uppercase tracking-wide text-primary">
                {row.module}
              </span>
              <span aria-hidden="true">·</span>
              <time dateTime={row.updatedAt}>Updated {shortDate(row.updatedAt)}</time>
            </div>
            <h3 className="mt-1 truncate text-base font-semibold text-foreground">
              {view === "my" ? row.title : row.employeeName}
            </h3>
            {view !== "my" && row.title !== row.module && (
              <p className="truncate text-sm text-muted-foreground">{row.title}</p>
            )}
            {row.approvedBy.length > 0 && (
              <p
                className={cn(
                  "mt-1 text-sm font-medium",
                  row.group === "Approved" || row.group === "Waiting"
                    ? "text-emerald-700"
                    : "text-muted-foreground",
                )}
              >
                {row.group === "Approved"
                  ? "Approved by "
                  : row.group === "Waiting"
                    ? "Approved so far by "
                    : "Earlier approval by "}
                {row.approvedBy.join(", ")}
              </p>
            )}
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{nextStep}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:block">
          <span
            className={cn(
              "inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
              statusTone[row.group],
            )}
          >
            {row.status}
          </span>
          {row.group === "Waiting" ? (
            <p className="text-xs text-muted-foreground lg:mt-2">Next: {row.waitingFor}</p>
          ) : row.waitingFor !== "No approval pending" ? (
            <p className="text-xs text-muted-foreground lg:mt-2">With {row.waitingFor}</p>
          ) : null}
        </div>
        <Button asChild variant="outline" size="sm" className="w-full sm:w-auto">
          <Link
            to="/staff/request-detail/$module/$requestId"
            params={{ module: row.module, requestId: row.id }}
            search={{ from: view }}
          >
            View request <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
      <details className="group mt-3 border-t border-border/60 pt-2 lg:ml-[3.25rem]">
        <summary className="flex min-h-9 w-fit cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted-foreground hover:text-primary [&::-webkit-details-marker]:hidden">
          <Clock3 className="size-3.5" aria-hidden="true" />
          Approval history and next step
          <ChevronDown
            className="size-3.5 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <ol className="ml-1 mt-2 space-y-3 border-l border-border pl-4 pb-1">
          {row.events.map((event, index) => (
            <li key={`${event.at}-${index}`} className="text-sm">
              <p className="font-medium">{event.label}</p>
              <time dateTime={event.at} className="text-xs text-muted-foreground">
                {date(event.at)}
              </time>
              {event.comment && <p className="mt-1 whitespace-pre-wrap">{event.comment}</p>}
              {event.statusAfter && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Status after decision: {event.statusAfter}
                </p>
              )}
              <DecisionSnapshot snapshot={event.snapshot} unavailable={event.snapshotUnavailable} />
            </li>
          ))}
          <li className="text-sm font-medium">
            Current: {row.status} · {row.waitingFor}
          </li>
        </ol>
        <p className="mt-2 text-xs text-muted-foreground">
          Older imported records may not include the original approver or decision date.
        </p>
      </details>
    </article>
  );
}

function RequestCentre() {
  const user = useCurrentUser();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const hr = user.activeRole === "HR";
  const canViewOrganisation = ["HR", "Super Admin"].includes(user.activeRole);
  const canViewReviewed = ["HR", "Line Manager", "Accounts", "Travel Admin", "Employee"].includes(
    user.activeRole,
  );
  const view =
    search.view ??
    (["Employee", "Travel Admin", "IT"].includes(user.activeRole)
      ? "my"
      : user.activeRole === "Super Admin"
        ? "organisation"
        : "approvals");
  useEffect(() => {
    if (hr && !search.view) {
      void navigate({ search: { view: "approvals" }, replace: true });
    }
  }, [hr, navigate, search.view]);
  const actor = {
    actorId: user.id,
    ...(user.workspaceEmail ? { actorEmail: user.workspaceEmail } : {}),
    activeRole: user.activeRole,
  };
  const [query, setQuery] = useState("");
  const [serverQuery, setServerQuery] = useState("");
  const [module, setModule] = useState<"All" | (typeof REQUEST_MODULES)[number]>("All");
  const [group, setGroup] = useState<RequestGroup>(view === "organisation" ? "Waiting" : "All");
  const [page, setPage] = useState(1);
  const [approvalModule, setApprovalModule] = useState("All");
  useEffect(() => {
    const timeout = window.setTimeout(() => setServerQuery(query), 250);
    return () => window.clearTimeout(timeout);
  }, [query]);
  useEffect(() => {
    setPage(1);
    setQuery("");
    setModule("All");
    setGroup(view === "organisation" ? "Waiting" : "All");
    setApprovalModule("All");
  }, [view, user.activeRole]);
  const requestQuery = useQuery({
    queryKey: ["request-tracker", actor, view, serverQuery, module, group, page],
    queryFn: () =>
      getTrackedRequestsFn({
        data: {
          actor,
          scope: view === "organisation" ? "organisation" : view === "reviewed" ? "reviewed" : "my",
          page,
          query: serverQuery,
          module,
          group,
        },
      }),
    enabled:
      typeof window !== "undefined" &&
      view !== "approvals" &&
      (view !== "organisation" || canViewOrganisation) &&
      (view !== "reviewed" || canViewReviewed),
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
  const inbox = useQuery({
    queryKey: ["approval-inbox", actor],
    queryFn: () => getApprovalInboxFn({ data: { actor } }),
    enabled: typeof window !== "undefined" && user.activeRole !== "Super Admin",
    refetchOnMount: "always",
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
  const active = view === "approvals" ? inbox : requestQuery;
  const visibleApprovals = (inbox.data ?? []).filter(
    (task) =>
      (approvalModule === "All" || task.module === approvalModule) &&
      [task.title, task.description, task.subjectName ?? "", task.module]
        .join(" ")
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const approvalPageCount = Math.max(1, Math.ceil(visibleApprovals.length / APPROVAL_PAGE_SIZE));
  const approvalPage = Math.min(page, approvalPageCount);
  const pagedApprovals = visibleApprovals.slice(
    (approvalPage - 1) * APPROVAL_PAGE_SIZE,
    approvalPage * APPROVAL_PAGE_SIZE,
  );
  const hasFilters =
    query.trim().length > 0 ||
    (view === "approvals" ? approvalModule !== "All" : module !== "All" || group !== "All");
  const clearFilters = () => {
    setQuery("");
    setModule("All");
    setGroup("All");
    setApprovalModule("All");
    setPage(1);
  };
  const resultCount = view === "approvals" ? visibleApprovals.length : requestQuery.data?.total;
  const approvalCounts = new Map<string, number>();
  for (const task of inbox.data ?? [])
    approvalCounts.set(task.module, (approvalCounts.get(task.module) ?? 0) + 1);
  const featuredApprovalTypes = ["Leave", "Attendance", "Timesheets", "Documents"];
  const approvalTypes = [
    "All",
    ...new Set([
      ...featuredApprovalTypes.filter((name) => (approvalCounts.get(name) ?? 0) > 0),
      ...[...approvalCounts.keys()].filter((name) => !featuredApprovalTypes.includes(name)).sort(),
    ]),
  ];
  return (
    <main className="mx-auto min-w-0 max-w-[1440px] space-y-6 pb-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Requests centre
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            {view === "approvals"
              ? hr
                ? "HR Approvals"
                : "Approvals"
              : view === "reviewed"
                ? "My decisions"
                : view === "organisation"
                  ? "Employee Requests"
                  : "My Requests"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {view === "approvals"
              ? "Decisions waiting for you."
              : view === "reviewed"
                ? "See decisions you made, including requests still waiting for someone else."
                : view === "organisation"
                  ? "Find a request and see who needs to act next."
                  : "Follow your requests from submission to decision."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={active.isFetching}
            onClick={() => active.refetch()}
          >
            <RotateCw className={cn(active.isFetching && "animate-spin")} aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </header>
      <PageSections
        value={view}
        onValueChange={(value) => {
          void navigate({
            search: { view: value as "my" | "approvals" | "organisation" | "reviewed" },
          });
        }}
      >
        <SectionNavigation restoreHash={false}>
          {(
            [
              ...(["HR", "Line Manager", "Accounts"].includes(user.activeRole) ||
              Boolean(inbox.data?.length) ||
              view === "approvals"
                ? [["approvals", `Waiting for me${inbox.data ? ` (${inbox.data.length})` : ""}`]]
                : []),
              ...(canViewReviewed ? [["reviewed", "My decisions"]] : []),
              ...(canViewOrganisation ? [["organisation", "All employee requests"]] : []),
              ["my", "My requests"],
            ] as Array<["my" | "approvals" | "organisation" | "reviewed", string]>
          ).map(([value, label]) => (
            <SectionLink key={value} value={value} onClick={(event) => event.preventDefault()}>
              {label}
            </SectionLink>
          ))}
        </SectionNavigation>
        <div className="min-w-0 space-y-4">
          {(view === "approvals" && user.activeRole === "Super Admin") ||
          (view === "organisation" && !canViewOrganisation) ||
          (view === "reviewed" && !canViewReviewed) ? (
            <p role="alert" className="rounded-xl border bg-card p-5 text-sm">
              This request view is not available in your current role.
            </p>
          ) : (
            <>
              <section
                aria-label="Filter requests"
                className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5"
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold">Find a request</h2>
                  {hasFilters && (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X className="size-3.5" aria-hidden="true" /> Clear filters
                    </button>
                  )}
                </div>
                <div
                  className={cn(
                    "grid gap-3",
                    view === "approvals" ? "sm:grid-cols-2" : "sm:grid-cols-3",
                  )}
                >
                  <label className="min-w-0 text-xs font-medium text-muted-foreground">
                    Search
                    <span className="relative mt-1.5 block">
                      <Search
                        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <input
                        type="search"
                        maxLength={160}
                        value={query}
                        onChange={(event) => {
                          setQuery(event.target.value);
                          setPage(1);
                        }}
                        placeholder={
                          view === "approvals" ? "Employee or request" : "Name, email or reference"
                        }
                        className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
                      />
                    </span>
                  </label>
                  <label className="min-w-0 text-xs font-medium text-muted-foreground">
                    Request type
                    <select
                      value={view === "approvals" ? approvalModule : module}
                      onChange={(event) => {
                        if (view === "approvals") setApprovalModule(event.target.value);
                        else setModule(event.target.value as typeof module);
                        setPage(1);
                      }}
                      className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
                    >
                      {view === "approvals" ? (
                        <>
                          <option value="All">All types</option>
                          {[...new Set([...featuredApprovalTypes, ...approvalCounts.keys()])]
                            .sort()
                            .map((name) => (
                              <option key={name} value={name}>
                                {name.replaceAll("-", " ")} ({approvalCounts.get(name) ?? 0})
                              </option>
                            ))}
                        </>
                      ) : (
                        [
                          "All",
                          ...REQUEST_MODULES.filter(
                            (value) => value !== "Payroll" || user.activeRole === "Accounts",
                          ),
                        ].map((value) => (
                          <option key={value} value={value}>
                            {value === "All" ? "All types" : value}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                  {view !== "approvals" && (
                    <label className="min-w-0 text-xs font-medium text-muted-foreground">
                      Status
                      <select
                        value={group}
                        onChange={(event) => {
                          setGroup(event.target.value as RequestGroup);
                          setPage(1);
                        }}
                        className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
                      >
                        {REQUEST_GROUPS.map((value) => (
                          <option key={value} value={value}>
                            {value === "All" ? "All statuses" : value}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              </section>
              {view === "approvals" && hr && (
                <nav
                  aria-label="HR approval types"
                  className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap"
                >
                  {approvalTypes.map((name) => {
                    const count =
                      name === "All" ? (inbox.data ?? []).length : (approvalCounts.get(name) ?? 0);
                    return (
                      <button
                        key={name}
                        type="button"
                        aria-pressed={approvalModule === name}
                        onClick={() => {
                          setApprovalModule(name);
                          setPage(1);
                        }}
                        className={cn(
                          "min-h-10 shrink-0 rounded-lg border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          approvalModule === name
                            ? "border-primary bg-primary text-primary-foreground"
                            : "bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
                        )}
                      >
                        {name === "All"
                          ? "All approvals"
                          : name === "Attendance"
                            ? "Visits & attendance"
                            : name}{" "}
                        <span className="ml-1 tabular-nums">{count}</span>
                      </button>
                    );
                  })}
                </nav>
              )}
              {active.isPending && (
                <p
                  role="status"
                  className="rounded-xl border bg-card p-4 text-sm text-muted-foreground"
                >
                  Loading requests…
                </p>
              )}
              {active.isError && (
                <p
                  role="alert"
                  className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
                >
                  Requests could not be refreshed. Please try again. Previously loaded information
                  may be out of date.
                </p>
              )}
              <section
                aria-label={view === "approvals" ? "Approval queue" : "Request results"}
                className="overflow-hidden rounded-2xl border bg-card shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-4 sm:px-5">
                  <div>
                    <h2 className="text-base font-semibold">
                      {view === "approvals"
                        ? "Waiting for your decision"
                        : view === "reviewed"
                          ? "Decisions you made"
                          : "Requests"}
                    </h2>
                    {resultCount !== undefined && !active.isPending && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {resultCount} {hasFilters ? "matching" : "total"}{" "}
                        {resultCount === 1 ? "item" : "items"}
                      </p>
                    )}
                  </div>
                  {active.isFetching && !active.isPending && (
                    <span className="text-xs text-muted-foreground">Updating…</span>
                  )}
                </div>
                <div className="divide-y">
                  {view === "approvals" ? (
                    visibleApprovals.length ? (
                      pagedApprovals.map((task) => (
                        <article
                          key={task.id}
                          className="px-4 py-4 transition-colors hover:bg-muted/25 sm:px-5"
                        >
                          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(12rem,0.65fr)_auto] lg:items-center">
                            <div className="flex min-w-0 gap-3">
                              <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                <ClipboardList className="size-5" aria-hidden="true" />
                              </span>
                              <div className="min-w-0">
                                <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                                  {task.module.replaceAll("-", " ")}
                                  {task.subjectName && (
                                    <span className="font-normal normal-case tracking-normal text-muted-foreground">
                                      {" · "}
                                      {task.subjectName}
                                    </span>
                                  )}
                                </p>
                                <h3 className="mt-1 text-base font-semibold">{task.title}</h3>
                                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                                  {task.description}
                                </p>
                              </div>
                            </div>
                            <div>
                              <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                                {task.state}
                              </span>
                              {task.dueDate && (
                                <p className="mt-2 text-xs text-muted-foreground">
                                  Review due {task.dueDate}
                                </p>
                              )}
                            </div>
                            <Button asChild size="sm" className="w-full sm:w-auto">
                              <Link to={approvalActionUrl(task)}>
                                {task.actionLabel} <ArrowRight aria-hidden="true" />
                              </Link>
                            </Button>
                          </div>
                        </article>
                      ))
                    ) : (
                      !inbox.isPending &&
                      !inbox.isError && (
                        <div className="px-5 py-12 text-center">
                          <ClipboardList
                            className="mx-auto mb-3 size-8 text-muted-foreground/60"
                            aria-hidden="true"
                          />
                          <p className="font-medium">
                            {inbox.data?.length
                              ? "No approvals match your search"
                              : "Nothing waiting for your decision"}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {inbox.data?.length
                              ? "Try a different name or request type."
                              : "New requests will appear here when they need you."}
                          </p>
                        </div>
                      )
                    )
                  ) : (
                    <>
                      {requestQuery.data?.rows.map((row) => (
                        <TrackedRequestRow key={`${row.module}:${row.id}`} row={row} view={view} />
                      ))}
                      {requestQuery.data && !requestQuery.data.total && (
                        <div className="px-5 py-12 text-center">
                          <Search
                            className="mx-auto mb-3 size-8 text-muted-foreground/60"
                            aria-hidden="true"
                          />
                          <p className="font-medium">No requests found</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {hasFilters
                              ? "Try clearing a filter or searching for another name."
                              : "Requests will appear here as they are created."}
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>
                {view === "approvals" && visibleApprovals.length > APPROVAL_PAGE_SIZE && (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 sm:px-5">
                    <p className="text-sm text-muted-foreground">
                      Showing {(approvalPage - 1) * APPROVAL_PAGE_SIZE + 1}–
                      {Math.min(approvalPage * APPROVAL_PAGE_SIZE, visibleApprovals.length)} of{" "}
                      {visibleApprovals.length}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={approvalPage === 1}
                        onClick={() => setPage(approvalPage - 1)}
                      >
                        Previous
                      </Button>
                      <span className="min-w-16 text-center text-sm tabular-nums">
                        {approvalPage} of {approvalPageCount}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={approvalPage === approvalPageCount}
                        onClick={() => setPage(approvalPage + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
                {view !== "approvals" && requestQuery.data && requestQuery.data.total > 30 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 sm:px-5">
                    <p className="text-sm text-muted-foreground">
                      Showing {(page - 1) * 30 + 1}–{Math.min(page * 30, requestQuery.data.total)}{" "}
                      of {requestQuery.data.total}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page === 1 || requestQuery.isFetching}
                        onClick={() => setPage(page - 1)}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page * 30 >= requestQuery.data.total || requestQuery.isFetching}
                        onClick={() => setPage(page + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </PageSections>
    </main>
  );
}
