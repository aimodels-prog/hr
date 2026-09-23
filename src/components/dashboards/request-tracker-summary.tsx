import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/lib/auth";
import { getApprovalInboxFn } from "@/lib/server-functions/request-tracking.server";
export function RequestTrackerSummary() {
  const user = useCurrentUser();
  const actor = {
    actorId: user.id,
    ...(user.workspaceEmail ? { actorEmail: user.workspaceEmail } : {}),
    activeRole: user.activeRole,
  };
  const inbox = useQuery({
    queryKey: ["approval-inbox", actor],
    queryFn: () => getApprovalInboxFn({ data: { actor } }),
    enabled: typeof window !== "undefined",
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
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
        className="rounded-lg border px-4 py-3 text-sm font-medium"
      >
        Needs My Approval{" "}
        {inbox.data ? `(${inbox.data.length})` : inbox.isError ? "(unavailable)" : "(loading…)"}
      </Link>
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
