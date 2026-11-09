import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { getApprovalInboxFn } from "@/lib/server-functions/request-tracking.server";
export function RequestTrackerSummary() {
  const user = useCurrentUser();
  const canApprove = user.activeRole !== "Employee";
  const actor = {
    actorId: user.id,
    ...(user.workspaceEmail ? { actorEmail: user.workspaceEmail } : {}),
    activeRole: user.activeRole,
  };
  const inbox = useQuery({
    queryKey: ["approval-inbox", actor],
    queryFn: () => getApprovalInboxFn({ data: { actor } }),
    enabled: typeof window !== "undefined" && canApprove,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
  const pendingVisitCount = (inbox.data ?? []).filter(
    (task) => task.sourceType === "site-visit-request",
  ).length;
  return (
    <nav
      aria-label="Requests and approvals"
      className="flex flex-wrap gap-3 rounded-xl border bg-card p-4"
    >
      <Link
        to="/staff/requests"
        search={{ view: "my" }}
        className="rounded-lg border px-4 py-3 text-sm font-medium"
      >
        Track My Requests
      </Link>
      <Link
        to="/staff/requests"
        search={{ view: "approvals" }}
        hidden={!canApprove}
        className="rounded-lg border px-4 py-3 text-sm font-medium"
      >
        Needs My Approval{" "}
        {inbox.data ? `(${inbox.data.length})` : inbox.isError ? "(unavailable)" : "(loading…)"}
      </Link>
      {user.activeRole === "HR" && (
        <Link
          to="/staff/attendance"
          hash="section=site-visits"
          className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 py-3 text-sm font-semibold transition-colors ${
            pendingVisitCount > 0
              ? "border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100"
              : "hover:bg-muted"
          }`}
        >
          <MapPin className="size-4" aria-hidden="true" />
          Visit approvals{inbox.data ? ` (${pendingVisitCount})` : ""}
        </Link>
      )}
      {["HR", "Super Admin"].includes(user.activeRole) && (
        <Link
          to="/staff/requests"
          search={{ view: "organisation" }}
          className="rounded-lg border px-4 py-3 text-sm font-medium"
        >
          Organisation Tracker
        </Link>
      )}
    </nav>
  );
}
