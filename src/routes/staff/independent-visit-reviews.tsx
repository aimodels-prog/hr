import { createFileRoute, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { useCurrentUser } from "@/lib/auth";
import {
  decideSiteVisitFn,
  listAssignedIndependentSiteVisitsFn,
} from "@/lib/server-functions/attendance.server";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/staff/independent-visit-reviews")({
  component: IndependentVisitReviews,
});

function IndependentVisitReviews() {
  const user = useCurrentUser();
  const location = useLocation();
  const actor = {
    actorId: user.id,
    ...(user.workspaceEmail ? { actorEmail: user.workspaceEmail } : {}),
    activeRole: user.activeRole,
  };
  const query = useQuery({
    queryKey: ["independent-visit-reviews", user.id, user.activeRole],
    queryFn: () => listAssignedIndependentSiteVisitsFn({ data: actor }),
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const focusedId = new URLSearchParams(location.hash.replace(/^#/, "")).get("review");
  useEffect(() => {
    if (focusedId && query.data?.some((item) => item.id === focusedId)) {
      setSelectedId(focusedId);
      document.getElementById(`visit-${focusedId}`)?.scrollIntoView({ block: "center" });
    }
  }, [focusedId, query.data]);
  const rows = query.data ?? [];
  const pending = rows.filter(
    (row) =>
      row.status === "Pending HR" ||
      (row.details.extension?.status === "Pending" &&
        ["Approved", "Completed"].includes(row.status)),
  );
  const history = rows.filter((row) => !pending.includes(row));
  const decide = async (id: string, decision: "approve" | "reject") => {
    if (busy) return;
    if (decision === "reject" && !note.trim()) {
      toast.error("Explain why the visit cannot be approved.");
      return;
    }
    setBusy(true);
    try {
      await decideSiteVisitFn({
        data: { actor, visitId: id, decision, ...(note.trim() ? { notes: note.trim() } : {}) },
      });
      setSelectedId(null);
      setRejecting(false);
      setNote("");
      await query.refetch();
      toast.success(decision === "approve" ? "Visit approved" : "Visit declined");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The decision could not be saved.");
      await query.refetch();
    } finally {
      setBusy(false);
    }
  };
  const card = (row: (typeof rows)[number], actionable: boolean) => {
    const extension = row.details.extension;
    const isOpen = selectedId === row.id;
    return (
      <article
        key={row.id}
        id={`visit-${row.id}`}
        className="rounded-xl border bg-card p-5 shadow-sm space-y-3"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold">{row.employeeName}</h3>
            <p className="text-sm text-muted-foreground">
              {row.date} · {row.startTime}–{row.endTime} · From {row.origin}
            </p>
          </div>
          <span className="rounded-full bg-muted px-3 py-1 text-xs">
            {extension?.status === "Pending" ? "Extension awaiting review" : row.status}
          </span>
        </div>
        <p className="text-sm">
          <span className="font-medium">Destination:</span> {row.destination}
        </p>
        <p className="text-sm">
          <span className="font-medium">Purpose:</span> {row.purpose}
        </p>
        {extension && (
          <p className="rounded-lg bg-muted p-3 text-sm">
            Extension to {extension.endTime}: {extension.reason} · {extension.status}. This does not
            approve overtime.
          </p>
        )}
        {row.hrNotes && !actionable && <p className="text-sm">Review note: {row.hrNotes}</p>}
        {actionable && !isOpen && (
          <Button
            onClick={() => {
              setSelectedId(row.id);
              setRejecting(false);
              setNote("");
            }}
          >
            Review visit
          </Button>
        )}
        {actionable && isOpen && (
          <div className="space-y-3 border-t pt-3">
            {rejecting && (
              <Textarea
                aria-label="Reason for declining"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Explain the decision to the employee"
                maxLength={2000}
              />
            )}
            <div className="flex flex-wrap gap-2">
              {!rejecting && (
                <Button disabled={busy} onClick={() => void decide(row.id, "approve")}>
                  Approve
                </Button>
              )}
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (rejecting) void decide(row.id, "reject");
                  else setRejecting(true);
                }}
              >
                {rejecting ? "Confirm decline" : "Decline"}
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setSelectedId(null);
                  setRejecting(false);
                  setNote("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </article>
    );
  };
  return (
    <main className="mx-auto max-w-4xl space-y-6 pb-12">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Visits to review</h1>
        <p className="text-sm text-muted-foreground">Only visits assigned to you appear here.</p>
      </header>
      {query.isPending && <p role="status">Loading visits…</p>}
      {query.isError && <p role="alert">Visits could not be loaded. Please refresh.</p>}
      {query.data && (
        <>
          <section className="space-y-3" aria-label="Awaiting your decision">
            <h2 className="text-lg font-semibold">Awaiting your decision · {pending.length}</h2>
            {pending.length ? (
              pending.map((row) => card(row, true))
            ) : (
              <p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
                Nothing needs your decision.
              </p>
            )}
          </section>
          {history.length > 0 && (
            <section className="space-y-3" aria-label="Reviewed visits">
              <h2 className="text-lg font-semibold">Earlier visits</h2>
              {history.map((row) => card(row, false))}
            </section>
          )}
        </>
      )}
    </main>
  );
}
