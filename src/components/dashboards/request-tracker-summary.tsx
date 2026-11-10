import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ClipboardCheck } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { getApprovalInboxFn } from "@/lib/server-functions/request-tracking.server";
import { Button } from "@/components/ui/button";

/** One decision entry point; personal and organisation history live inside Requests. */
export function RequestTrackerSummary() {
  const user = useCurrentUser();
  const canDecide = ["HR", "Line Manager", "Accounts"].includes(user.activeRole);
  const actor = {
    actorId: user.id,
    ...(user.workspaceEmail ? { actorEmail: user.workspaceEmail } : {}),
    activeRole: user.activeRole,
  };
  const inbox = useQuery({
    queryKey: ["approval-inbox", actor],
    queryFn: () => getApprovalInboxFn({ data: { actor } }),
    enabled: typeof window !== "undefined" && canDecide,
    refetchOnMount: "always",
    staleTime: 15_000,
    refetchInterval: 60_000,
  });

  if (!canDecide) return null;

  const count = inbox.data?.length;
  return (
    <section
      aria-label="Decisions waiting for you"
      className="flex flex-col gap-4 rounded-2xl border border-primary/20 bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ClipboardCheck className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {inbox.isError
              ? "Approvals could not be checked"
              : count === undefined
                ? "Checking approvals"
                : count === 0
                  ? "No decisions waiting"
                  : `${count} ${count === 1 ? "decision" : "decisions"} waiting for you`}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {inbox.isError
              ? "Try again to see the latest requests."
              : "Leave, visits, timesheets and other requests are together here."}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link
              to="/staff/requests"
              search={{ view: "reviewed" }}
              className="text-primary hover:underline"
            >
              Decisions made
            </Link>
            {user.activeRole === "HR" && (
              <Link
                to="/staff/requests"
                search={{ view: "organisation" }}
                className="text-primary hover:underline"
              >
                All employee requests
              </Link>
            )}
          </div>
        </div>
      </div>
      {inbox.isError ? (
        <Button variant="outline" onClick={() => void inbox.refetch()}>
          Try again
        </Button>
      ) : (
        <Button asChild className="w-full shrink-0 sm:w-auto">
          <Link to="/staff/requests" search={{ view: "approvals" }}>
            Review approvals <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </Button>
      )}
    </section>
  );
}
