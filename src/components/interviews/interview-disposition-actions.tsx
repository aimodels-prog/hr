import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useCurrentUser } from "@/lib/auth";
import { InterviewService } from "@/lib/data/interview-service";
import { VacancyService } from "@/lib/data/vacancy-service";
import type { InterviewDispositionOutcome, InterviewEvent } from "@/lib/data/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const OUTCOMES: InterviewDispositionOutcome[] = [
  "Proceed to Next Interview",
  "Recommend for Offer",
  "Future Consideration",
  "Recommend for Another Role",
  "Place on Hold",
  "Do Not Proceed",
  "Candidate Withdrew",
  "No Show",
];

export function InterviewDispositionActions({
  interview,
  onSuccess,
}: {
  interview: InterviewEvent;
  onSuccess: () => void;
}) {
  const currentUser = useCurrentUser();
  const service = useMemo(() => new InterviewService(), []);
  const existing = service.getDispositionForInterview(interview.id, currentUser.getActorContext());
  const openVacancies = useMemo(
    () =>
      new VacancyService()
        .getVacancyRepository()
        .list()
        .filter((vacancy) => vacancy.status === "Open" && vacancy.id !== interview.vacancyId),
    [interview.vacancyId],
  );
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<InterviewDispositionOutcome>(
    existing?.outcome || "Future Consideration",
  );
  const [reason, setReason] = useState(existing?.reason || "");
  const [roles, setRoles] = useState(existing?.suggestedRoleTitles.join(", ") || "");
  const [futureVacancyId, setFutureVacancyId] = useState(existing?.futureVacancyIds[0] || "none");
  const [saving, setSaving] = useState(false);

  if (interview.status !== "Completed" && interview.status !== "No Show") return null;

  const save = async () => {
    setSaving(true);
    try {
      await service.recordDispositionAsync(
        interview.id,
        {
          outcome,
          reason,
          futureVacancyIds: futureVacancyId === "none" ? [] : [futureVacancyId],
          suggestedRoleTitles: roles
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        },
        { ...currentUser.getActorContext(), reason },
      );
      toast.success("Interview recommendation saved to the candidate's history.");
      setOpen(false);
      onSuccess();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The recommendation could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
      <div>
        <div className="text-sm font-medium">Interview recommendation</div>
        {existing ? (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">{existing.outcome}</Badge>
            <span>{existing.reason}</span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Record what should happen next.</p>
        )}
      </div>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {existing ? "Update Recommendation" : "Record Recommendation"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Interview Recommendation</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>What happens next?</Label>
              <Select
                value={outcome}
                onValueChange={(value) => setOutcome(value as InterviewDispositionOutcome)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OUTCOMES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {outcome === "Recommend for Another Role" && (
              <div className="space-y-4 rounded-lg border p-3">
                <div className="space-y-2">
                  <Label>Open vacancy (if already available)</Label>
                  <Select value={futureVacancyId} onValueChange={setFutureVacancyId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No open vacancy selected</SelectItem>
                      {openVacancies.map((vacancy) => (
                        <SelectItem key={vacancy.id} value={vacancy.id}>
                          {vacancy.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Suggested role or roles</Label>
                  <Input
                    value={roles}
                    onChange={(event) => setRoles(event.target.value)}
                    placeholder="Operations Coordinator, Customer Success"
                  />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>Panel recommendation</Label>
              <Textarea
                rows={4}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Summarise the panel's evidence and decision."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || reason.trim().length < 5}>
              {saving ? "Saving..." : "Save Recommendation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
