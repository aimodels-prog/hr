import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";

import { useCurrentUser } from "@/lib/auth";
import {
  listLeaveAttendanceOverlapReviewsFn,
  previewExistingApprovedLeaveOfficeOverlapsFn,
  resolveLeaveAttendanceOverlapReviewFn,
  stageExistingApprovedLeaveOfficeOverlapFn,
} from "@/lib/server-functions/leave.server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Review = Awaited<ReturnType<typeof listLeaveAttendanceOverlapReviewsFn>>[number];
type Decision = "remove-leave" | "keep-leave";

export function LeaveAttendanceReview({
  onOpenRequest,
  onChanged,
}: {
  onOpenRequest: (requestId: string) => void;
  onChanged: () => void;
}) {
  const user = useCurrentUser();
  const cache = useQueryClient();
  const actor = {
    actorId: user.id,
    activeRole: user.activeRole,
    ...(user.workspaceEmail ? { actorEmail: user.workspaceEmail } : {}),
  };
  const query = useQuery({
    queryKey: ["leave-attendance-overlap-reviews", user.id, user.activeRole],
    queryFn: () => listLeaveAttendanceOverlapReviewsFn({ data: { actor } }),
    enabled: user.activeRole === "HR",
  });
  const historicalQuery = useQuery({
    queryKey: ["leave-attendance-existing-overlaps", user.id, user.activeRole],
    queryFn: () => previewExistingApprovedLeaveOfficeOverlapsFn({ data: { actor } }),
    enabled: user.activeRole === "HR",
  });
  const [selected, setSelected] = useState<Review | null>(null);
  const [decision, setDecision] = useState<Decision>("remove-leave");
  const [reason, setReason] = useState("");
  const [allocation, setAllocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [stagingId, setStagingId] = useState<string | null>(null);

  const reviews = query.data ?? [];
  const pending = reviews.filter((review) => review.status === "Pending");
  const previous = reviews.filter((review) => review.status !== "Pending");
  const historical = (historicalQuery.data ?? []).filter((row) => !row.hasReview);

  const stageHistorical = async (row: (typeof historical)[number]) => {
    setStagingId(`${row.requestId}:${row.date}`);
    try {
      const result = await stageExistingApprovedLeaveOfficeOverlapFn({
        data: {
          actor,
          requestId: row.requestId,
          date: row.date,
          attendanceRecordId: row.attendanceRecordId,
        },
      });
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["leave-attendance-overlap-reviews"] }),
        cache.invalidateQueries({ queryKey: ["leave-attendance-existing-overlaps"] }),
      ]);
      toast.success(
        result.kind === "already-reconciled"
          ? "This date has already been reviewed."
          : "Added to HR review. No leave or balance was changed yet.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open this review.");
    } finally {
      setStagingId(null);
    }
  };

  const openDecision = (review: Review, nextDecision: Decision) => {
    setSelected(review);
    setDecision(nextDecision);
    setReason(
      nextDecision === "remove-leave" ? "Office attendance verified" : "Leave remains valid",
    );
    setAllocation("");
  };

  const submit = async () => {
    if (!selected || reason.trim().length < 3) return;
    const selectedAllocation = selected.allocationOptions?.find(
      (option) => `${option.policyId}:${option.leaveYear}` === allocation,
    );
    if (
      decision === "remove-leave" &&
      (selected.allocationOptions?.length ?? 0) > 1 &&
      !selectedAllocation
    ) {
      toast.error("Choose the leave balance to restore.");
      return;
    }
    setBusy(true);
    try {
      const result = await resolveLeaveAttendanceOverlapReviewFn({
        data: {
          actor,
          reviewId: selected.reviewId,
          decision,
          reason: reason.trim(),
          ...(selectedAllocation
            ? {
                allocationPolicyId: selectedAllocation.policyId,
                allocationLeaveYear: selectedAllocation.leaveYear,
              }
            : {}),
        },
      });
      if (result.kind === "needs-review") {
        toast.error(result.reason ?? "This leave day still needs HR review.");
        return;
      }
      toast.success(
        result.kind === "changed"
          ? "Leave corrected for this workday."
          : result.kind === "kept"
            ? "Leave kept for this date."
            : "This date was already corrected.",
      );
      setSelected(null);
      await cache.invalidateQueries({ queryKey: ["leave-attendance-overlap-reviews"] });
      await cache.invalidateQueries({ queryKey: ["leave-attendance-existing-overlaps"] });
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The leave review could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Office work during leave</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Check days when office attendance and approved leave overlap. Correct only the date
              worked; the original leave decision remains in the history.
            </p>
          </div>
          <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {query.isLoading && <p className="text-sm text-muted-foreground">Loading reviews…</p>}
          {query.isError && (
            <p className="text-sm text-destructive">
              Reviews could not be loaded. Please refresh and try again.
            </p>
          )}
          {!query.isLoading && !query.isError && pending.length === 0 && (
            <p className="rounded-lg border p-5 text-sm text-muted-foreground">
              No office-work and leave overlaps need a decision.
            </p>
          )}
          {pending.map((review) => (
            <div
              key={review.reviewId}
              className="flex flex-col gap-3 rounded-xl border bg-background p-4 lg:flex-row lg:items-center lg:justify-between"
            >
              <div className="space-y-1">
                <div className="font-medium">{review.employeeName}</div>
                <div className="text-sm">
                  {format(parseISO(review.date), "d MMM yyyy")} · {review.leaveType} ·{" "}
                  {review.observedWorkHours.toFixed(1)} office hours
                </div>
                <p className="text-xs text-muted-foreground">{review.reason}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => onOpenRequest(review.requestId)}>
                  Leave history
                </Button>
                <Button variant="outline" onClick={() => openDecision(review, "keep-leave")}>
                  Keep leave
                </Button>
                <Button onClick={() => openDecision(review, "remove-leave")}>Count as work</Button>
              </div>
            </div>
          ))}
          {previous.length > 0 && (
            <details className="rounded-xl border p-4">
              <summary className="cursor-pointer font-medium">
                Previous decisions ({previous.length})
              </summary>
              <div className="mt-3 space-y-2">
                {previous.map((review) => (
                  <div
                    key={review.reviewId}
                    className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm"
                  >
                    <span>
                      {review.employeeName} · {format(parseISO(review.date), "d MMM yyyy")} ·{" "}
                      {review.leaveType}
                    </span>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{review.status}</Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onOpenRequest(review.requestId)}
                      >
                        Leave history
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
          <details className="rounded-xl border p-4">
            <summary className="cursor-pointer font-medium">
              Check earlier office and leave overlaps
              {historical.length > 0 ? ` (${historical.length})` : ""}
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              Older records are not changed automatically. Open each one for HR review before
              correcting its leave day.
            </p>
            {historicalQuery.isLoading && (
              <p className="mt-3 text-sm text-muted-foreground">Checking earlier records…</p>
            )}
            {historicalQuery.isError && (
              <p className="mt-3 text-sm text-destructive">
                Earlier records could not be checked. Please refresh and try again.
              </p>
            )}
            {!historicalQuery.isLoading && !historicalQuery.isError && historical.length === 0 && (
              <p className="mt-3 text-sm text-muted-foreground">
                No unreviewed earlier overlaps were found.
              </p>
            )}
            <div className="mt-3 space-y-2">
              {historical.map((row) => (
                <div
                  key={`${row.requestId}:${row.date}`}
                  className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm"
                >
                  <span>
                    <strong>{row.employeeName}</strong> · {format(parseISO(row.date), "d MMM yyyy")}
                    {" · "}
                    {row.leaveType} · {row.observedWorkHours.toFixed(1)} office hours
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={stagingId === `${row.requestId}:${row.date}`}
                    onClick={() => stageHistorical(row)}
                  >
                    {stagingId === `${row.requestId}:${row.date}` ? "Opening…" : "Review this day"}
                  </Button>
                </div>
              ))}
            </div>
          </details>
        </CardContent>
      </Card>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decision === "remove-leave"
                ? "Count this date as work?"
                : "Keep leave for this date?"}
            </DialogTitle>
            <DialogDescription>
              {selected?.employeeName} · {selected?.date}. This decision affects only this day and
              is recorded for the employee and HR to see.
            </DialogDescription>
          </DialogHeader>
          {decision === "remove-leave" && (selected?.allocationOptions?.length ?? 0) > 1 && (
            <div className="space-y-2">
              <Label htmlFor="leave-balance-source">Balance to restore</Label>
              <select
                id="leave-balance-source"
                className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={allocation}
                onChange={(event) => setAllocation(event.target.value)}
              >
                <option value="">Select a balance</option>
                {selected?.allocationOptions?.map((option) => (
                  <option
                    key={`${option.policyId}:${option.leaveYear}`}
                    value={`${option.policyId}:${option.leaveYear}`}
                  >
                    {option.policyName} · {option.leaveYear} · {option.days} day(s) used
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="leave-work-decision-note">Decision note</Label>
            <Textarea
              id="leave-work-decision-note"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={1000}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy || reason.trim().length < 3}>
              {busy ? "Saving…" : "Confirm decision"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
