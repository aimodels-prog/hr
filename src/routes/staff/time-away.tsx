import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { useCurrentUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  listTimeAwayFn,
  recordTimeAwayFn,
  decideTimeAwayFn,
} from "@/lib/server-functions/time-away.server";
import {
  TIME_AWAY_CATEGORIES,
  TIME_AWAY_TREATMENTS,
  timeAwayDate,
  timeAwayMinutes,
} from "@/lib/data/time-away";

export const Route = createFileRoute("/staff/time-away")({
  validateSearch: (search: Record<string, unknown>): { date?: string } => {
    const result = timeAwayDate.safeParse(search["date"]);
    return result.success ? { date: result.data } : {};
  },
  component: TimeAwayScope,
});
function TimeAwayScope() {
  const user = useCurrentUser();
  const { date } = Route.useSearch();
  return <TimeAwayPage key={`${user.id}:${user.activeRole}:${date}`} initialDate={date} />;
}
type Row = Awaited<ReturnType<typeof listTimeAwayFn>>["rows"][number];
function TimeAwayPage({ initialDate }: { initialDate: string | undefined }) {
  const user = useCurrentUser();
  const actor = {
    actorId: user.id,
    ...(user.workspaceEmail ? { actorEmail: user.workspaceEmail } : {}),
    activeRole: user.activeRole,
  };
  const [date, setDate] = useState(initialDate ?? format(new Date(), "yyyy-MM-dd"));
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [category, setCategory] =
    useState<(typeof TIME_AWAY_CATEGORIES)[number]>("Medical appointment");
  const [note, setNote] = useState("");
  const [review, setReview] = useState<Row | null>(null);
  const [action, setAction] = useState<"Approve" | "Reject" | "Cancel">("Approve");
  const [treatment, setTreatment] = useState<(typeof TIME_AWAY_TREATMENTS)[number]>("Paid time");
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ["time-away", user.id, user.activeRole, date],
    queryFn: () => listTimeAwayFn({ data: { actor, date } }),
    enabled: timeAwayDate.safeParse(date).success,
  });
  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await task();
      await query.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Time away during work</h1>
          <p className="text-sm text-muted-foreground">
            Appointments and personal absences. Use Quick visit for official duties.
          </p>
        </div>
        <Button
          disabled={!query.data}
          onClick={() => {
            setEmployeeId(query.data?.selfId ?? "");
            setStartTime("");
            setEndTime("");
            setNote("");
            setOpen(true);
          }}
        >
          Record time away
        </Button>
      </header>
      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor="away-date">Date</Label>
        <Input
          id="away-date"
          type="date"
          className="w-auto"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <Button variant="outline" onClick={() => query.refetch()}>
          Refresh
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Clock-in/out stays unchanged. Time away is recorded separately; pay and leave balances are
        not automatically deducted.
      </p>
      {query.isPending && <p role="status">Loading time away…</p>}
      {query.isError && <p role="alert">Records could not be loaded. Please refresh.</p>}
      {query.data && !query.data.rows.length && (
        <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          No time away recorded for this date.
        </div>
      )}
      {query.data?.rows.map((row) => (
        <article key={row.id} className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap justify-between gap-2">
            <h2 className="font-semibold">{row.name}</h2>
            <span className="rounded-full bg-muted px-3 py-1 text-xs">{row.status}</span>
          </div>
          <p className="text-sm">
            {row.startTime}–{row.endTime} · {timeAwayMinutes(row.startTime, row.endTime)} minutes
            away · {row.category}
          </p>
          {row.note && <p className="text-sm">{row.note}</p>}
          {row.treatment && (
            <p className="text-sm font-medium">
              HR decision: {row.treatment}
              {row.treatment !== "Paid time"
                ? " — HR must process any leave or payroll adjustment separately."
                : ""}
            </p>
          )}
          {row.reviewNote && <p className="text-sm">HR note: {row.reviewNote}</p>}
          {row.status === "Pending HR" && (
            <div className="flex flex-wrap gap-2">
              {query.data.canReview &&
                row.employeeId !== query.data.selfId &&
                row.createdBy !== user.id && (
                  <Button
                    onClick={() => {
                      setReview(row);
                      setAction("Approve");
                      setTreatment("Paid time");
                      setReviewNote("");
                    }}
                  >
                    Review
                  </Button>
                )}
              {(query.data.canReview ||
                row.employeeId === query.data.selfId ||
                row.createdBy === user.id) && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setReview(row);
                    setAction("Cancel");
                    setReviewNote("");
                  }}
                >
                  Cancel record
                </Button>
              )}
            </div>
          )}
        </article>
      ))}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record time away</DialogTitle>
            <DialogDescription>
              For {date}. Enter the actual or planned departure and return times. HR will review it.
            </DialogDescription>
          </DialogHeader>
          <Label>Employee</Label>
          <SearchableSelect
            value={employeeId}
            onValueChange={setEmployeeId}
            options={(query.data?.people ?? []).map((person) => ({
              value: person.id,
              label: person.name,
              keywords: [person.email],
            }))}
            placeholder="Search employee"
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="away-start">Departure</Label>
              <Input
                id="away-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="away-end">Return</Label>
              <Input
                id="away-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>
          <Label htmlFor="away-category">Category</Label>
          <select
            id="away-category"
            className="h-11 rounded-md border bg-background px-3"
            value={category}
            onChange={(e) => setCategory(e.target.value as typeof category)}
          >
            {TIME_AWAY_CATEGORIES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <Label htmlFor="away-note">Note (optional)</Label>
          <Textarea
            id="away-note"
            maxLength={500}
            placeholder="No medical details needed."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            disabled={busy || !employeeId || !startTime || !endTime || endTime <= startTime}
            onClick={() =>
              void run(async () => {
                await recordTimeAwayFn({
                  data: { actor, record: { employeeId, date, startTime, endTime, category, note } },
                });
                setOpen(false);
                toast.success("Recorded — awaiting HR review");
              })
            }
          >
            {busy ? "Saving…" : "Submit for HR review"}
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!review}
        onOpenChange={(value) => {
          if (!value && !busy) setReview(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{action === "Cancel" ? "Cancel this record?" : "HR review"}</DialogTitle>
            <DialogDescription>
              {review?.name}: {review?.startTime}–{review?.endTime}. No automatic salary or leave
              deduction.
            </DialogDescription>
          </DialogHeader>
          {action !== "Cancel" && (
            <>
              <Label htmlFor="away-decision">Decision</Label>
              <select
                id="away-decision"
                className="h-11 rounded-md border bg-background px-3"
                value={action}
                onChange={(e) => setAction(e.target.value as "Approve" | "Reject")}
              >
                <option value="Approve">Approve</option>
                <option value="Reject">Reject — needs correction</option>
              </select>
              {action === "Approve" && (
                <>
                  <Label htmlFor="away-treatment">Treat as</Label>
                  <select
                    id="away-treatment"
                    className="h-11 rounded-md border bg-background px-3"
                    value={treatment}
                    onChange={(e) => setTreatment(e.target.value as typeof treatment)}
                  >
                    {TIME_AWAY_TREATMENTS.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                  {treatment !== "Paid time" && (
                    <p className="text-sm text-muted-foreground">
                      This records HR's decision. Complete any leave request or payroll adjustment
                      through the normal approval process.
                    </p>
                  )}
                </>
              )}
              <Label htmlFor="away-review-note">
                {action === "Reject" ? "What needs correcting?" : "Note (optional)"}
              </Label>
              <Textarea
                id="away-review-note"
                maxLength={500}
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
              />
            </>
          )}
          <Button
            disabled={busy || (action === "Reject" && !reviewNote.trim())}
            onClick={() =>
              void run(async () => {
                if (!review) return;
                await decideTimeAwayFn({
                  data: {
                    actor,
                    id: review.id,
                    version: review.recordVersion,
                    action,
                    ...(action === "Approve" ? { treatment } : {}),
                    note: reviewNote,
                  },
                });
                setReview(null);
                toast.success("Record updated");
              })
            }
          >
            {busy ? "Saving…" : action === "Cancel" ? "Confirm cancellation" : "Save decision"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
