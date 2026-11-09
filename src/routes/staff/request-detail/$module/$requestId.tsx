import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, Clock3, FileText } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { REQUEST_MODULES } from "@/lib/data/request-tracking";
import { getTrackedRequestDetailFn } from "@/lib/server-functions/request-tracking.server";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/staff/request-detail/$module/$requestId")({
  component: RequestDetailPage,
});

function RequestDetailPage() {
  const { module, requestId } = Route.useParams();
  const user = useCurrentUser();
  const validModule = REQUEST_MODULES.find((item) => item === module);
  const query = useQuery({
    queryKey: ["request-detail", module, requestId, user?.id, user?.activeRole],
    queryFn: () =>
      getTrackedRequestDetailFn({
        data: {
          actor: {
            actorId: user!.id,
            ...(user!.workspaceEmail ? { actorEmail: user!.workspaceEmail } : {}),
            activeRole: user!.activeRole,
          },
          module: validModule!,
          requestId,
        },
      }),
    enabled: Boolean(user && validModule && typeof window !== "undefined"),
    staleTime: 15_000,
  });

  if (!validModule)
    return (
      <p role="alert" className="mx-auto max-w-3xl p-6">
        Unknown request type.
      </p>
    );
  if (query.isPending)
    return <p className="mx-auto max-w-3xl p-6 text-muted-foreground">Loading request…</p>;
  if (query.isError || !query.data)
    return (
      <p role="alert" className="mx-auto max-w-3xl p-6 text-destructive">
        This request could not be opened. It may no longer be available to your account.
      </p>
    );

  const { request, canOpenOriginal } = query.data;
  const details = Object.entries(request.details).filter(
    ([, value]) => typeof value === "string" && value.trim().length > 0,
  );
  return (
    <main className="mx-auto max-w-4xl space-y-5 pb-10">
      <Button asChild variant="ghost" size="sm">
        <Link to="/staff/requests">
          <ArrowLeft aria-hidden="true" /> Back to requests
        </Link>
      </Button>
      <header className="rounded-2xl border bg-card p-5 sm:p-7">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          {request.module}
        </p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{request.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">For {request.employeeName}</p>
          </div>
          <span className="rounded-full border bg-muted px-3 py-1 text-sm font-medium">
            {request.status}
          </span>
        </div>
        <div className="mt-5 grid gap-3 border-t pt-4 text-sm sm:grid-cols-2">
          <p>
            <span className="text-muted-foreground">Submitted by</span>
            <br />
            {request.submittedByName ?? "Not separately recorded"}
          </p>
          <p>
            <span className="text-muted-foreground">Record made by</span>
            <br />
            {request.createdByName ?? "Original creator not recorded"}
          </p>
          <p>
            <span className="text-muted-foreground">Next step</span>
            <br />
            {request.waitingFor}
          </p>
          {request.archivedAt && (
            <p>
              <span className="text-muted-foreground">Archived on</span>
              <br />
              {new Date(request.archivedAt).toLocaleString()}
            </p>
          )}
        </div>
      </header>

      <section
        className="rounded-2xl border bg-card p-5 sm:p-7"
        aria-labelledby="request-details-title"
      >
        <div className="flex items-center gap-2">
          <FileText className="size-5 text-primary" aria-hidden="true" />
          <h2 id="request-details-title" className="text-lg font-semibold">
            Request details
          </h2>
        </div>
        {details.length ? (
          <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {details.map(([label, value]) => (
              <div key={label} className="min-w-0 border-t pt-3">
                <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                <dd className="mt-1 whitespace-pre-wrap break-words text-sm">{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            No further details were saved for this record.
          </p>
        )}
        {canOpenOriginal && (
          <Button asChild variant="outline" className="mt-5">
            <Link to={request.actionUrl}>
              Open in {request.module} <ArrowUpRight aria-hidden="true" />
            </Link>
          </Button>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          These are the current saved details. The timeline below preserves recorded decisions and
          their dates.
        </p>
      </section>

      <section
        className="rounded-2xl border bg-card p-5 sm:p-7"
        aria-labelledby="decision-history-title"
      >
        <div className="flex items-center gap-2">
          <Clock3 className="size-5 text-primary" aria-hidden="true" />
          <h2 id="decision-history-title" className="text-lg font-semibold">
            Approval history
          </h2>
        </div>
        <ol className="mt-5 space-y-4 border-l pl-5">
          {request.events.map((event, index) => (
            <li key={`${event.at}-${index}`}>
              <p className="text-sm font-medium">{event.label}</p>
              <time dateTime={event.at} className="text-xs text-muted-foreground">
                {new Date(event.at).toLocaleString()}
              </time>
              {event.comment && <p className="mt-1 whitespace-pre-wrap text-sm">{event.comment}</p>}
              {event.statusAfter && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Status after decision: {event.statusAfter}
                </p>
              )}
            </li>
          ))}
        </ol>
        {request.events.length <= 1 && (
          <p className="mt-4 text-sm text-muted-foreground">
            No original decision details were recorded for this request. Older imported records may
            not include an approver or decision date.
          </p>
        )}
      </section>
    </main>
  );
}
