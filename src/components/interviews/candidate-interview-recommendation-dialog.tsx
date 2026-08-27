import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";

import { useCurrentUser } from "@/lib/auth";
import { CandidatePoolService } from "@/lib/data/candidate-pool-service";
import type { Candidate } from "@/lib/data/types";
import { VacancyService } from "@/lib/data/vacancy-service";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function CandidateInterviewRecommendationDialog({
  open,
  onOpenChange,
  candidate,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidate: Candidate;
  onSuccess: (vacancyId: string) => void;
}) {
  const currentUser = useCurrentUser();
  const poolService = useMemo(() => new CandidatePoolService(), []);
  const vacancies = useMemo(
    () =>
      new VacancyService()
        .getVacancyRepository()
        .list()
        .filter((vacancy) => vacancy.status === "Open")
        .sort((a, b) => a.title.localeCompare(b.title)),
    [],
  );
  const cvRecords = useMemo(
    () => poolService.getCandidateCvs(candidate.id, currentUser.getActorContext()),
    [candidate.id, currentUser, poolService],
  );
  const [vacancyId, setVacancyId] = useState("");
  const [cvRecordId, setCvRecordId] = useState(candidate.latestCvRecordId || "latest");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await poolService.recommendForInterview(
        {
          candidateId: candidate.id,
          vacancyId,
          reason,
          ...(cvRecordId !== "latest" ? { cvRecordId } : {}),
        },
        { ...currentUser.getActorContext(), reason },
      );
      toast.success("Candidate recommended and included in vacancy screening.");
      onOpenChange(false);
      onSuccess(vacancyId);
      setReason("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The recommendation could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Recommend {candidate.firstName} for Interview</DialogTitle>
          <DialogDescription>
            Connect this Candidate Pool profile to a vacancy and record why HR is progressing the
            person.
          </DialogDescription>
        </DialogHeader>
        <Alert>
          <Sparkles className="h-4 w-4" />
          <AlertDescription>
            This person will be pinned into HR's chosen assessment group. They receive the same
            evidence-based score as every other candidate, and the recommendation remains visible.
          </AlertDescription>
        </Alert>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Open vacancy</Label>
            <Select value={vacancyId} onValueChange={setVacancyId}>
              <SelectTrigger>
                <SelectValue placeholder="Select the role" />
              </SelectTrigger>
              <SelectContent>
                {vacancies.map((vacancy) => (
                  <SelectItem key={vacancy.id} value={vacancy.id}>
                    {vacancy.title} · {vacancy.location}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>CV used for this recommendation</Label>
            <Select value={cvRecordId} onValueChange={setCvRecordId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="latest">Latest CV on the candidate profile</SelectItem>
                {cvRecords.map((record) => (
                  <SelectItem key={record.id} value={record.id}>
                    {record.originalFileName} · {new Date(record.receivedAt).toLocaleDateString()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="interview-recommendation-reason">
              Why should this candidate be interviewed?
            </Label>
            <Textarea
              id="interview-recommendation-reason"
              rows={5}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Describe the relevant experience, skills or prior discussion supporting this recommendation."
            />
            <p className="text-xs text-muted-foreground">
              At least 10 characters. This becomes part of the audit history.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !vacancyId || reason.trim().length < 10}>
            {saving ? "Saving recommendation..." : "Add to Screening"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
