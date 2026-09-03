import { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info, AlertTriangle } from "lucide-react";
import { ScorecardService } from "@/lib/data/scorecard-service";
import type {
  InterviewScorecard,
  InterviewTemplate,
  CriterionScore,
  ScorecardRecommendation,
} from "@/lib/data/types";
import { useCurrentUser } from "@/lib/auth";
import { toast } from "sonner";

interface ScorecardFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  interviewId: string;
  templateId: string;
  targetPanelUserId?: string; // If an admin is viewing someone else's scorecard
  onSuccess?: () => void;
}

export function ScorecardForm({
  open,
  onOpenChange,
  interviewId,
  templateId,
  targetPanelUserId,
  onSuccess,
}: ScorecardFormProps) {
  const currentUser = useCurrentUser();
  const scorecardService = useMemo(() => new ScorecardService(), []);

  const [template, setTemplate] = useState<InterviewTemplate | null>(null);
  const [scorecard, setScorecard] = useState<InterviewScorecard | null>(null);
  const [scores, setScores] = useState<Record<string, { score: number; evidence: string }>>({});
  const [recommendation, setRecommendation] = useState<ScorecardRecommendation | "">("");

  const [reopenReason, setReopenReason] = useState("");
  const [isReopening, setIsReopening] = useState(false);

  const panelUserId = targetPanelUserId || currentUser!.userId;
  const isAdmin = currentUser?.role === "Super Admin" || currentUser?.role === "HR";
  const isReadOnly = scorecard?.status === "Submitted";

  // Actually, if we are viewing someone else's scorecard that isn't ours, we can only read it or reopen it if admin.
  // We can only edit if it's our scorecard AND it's draft.
  const canEdit = scorecard?.status === "Draft" && currentUser!.userId === panelUserId;

  useEffect(() => {
    if (open && templateId) {
      const tpl = scorecardService.getTemplateById(templateId);
      setTemplate(tpl || null);

      const actorContext = currentUser!.getActorContext();

      // We only auto-create if it's the current user's scorecard.
      // If an admin is just viewing a missing scorecard, they shouldn't auto-create it for that user.
      if (currentUser!.userId === panelUserId) {
        const sc = scorecardService.getOrCreateScorecard(interviewId, panelUserId, actorContext);
        setScorecard(sc);
      } else {
        // Just fetch
        const scs = scorecardService.getScorecardsForInterview(interviewId);
        const sc = scs.find((s) => s.panelUserId === panelUserId);
        if (sc) setScorecard(sc);
        else setScorecard(null);
      }
    }
  }, [open, interviewId, templateId, panelUserId, currentUser, scorecardService]);

  useEffect(() => {
    if (scorecard) {
      const initialScores: Record<string, { score: number; evidence: string }> = {};
      for (const s of scorecard.scores) {
        initialScores[s.criterionId] = { score: s.score, evidence: s.evidence };
      }
      setScores(initialScores);
      setRecommendation(scorecard.overallRecommendation || "");
    } else {
      setScores({});
      setRecommendation("");
    }
    setReopenReason("");
    setIsReopening(false);
  }, [scorecard]);

  if (!template) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Scorecard</DialogTitle>
          </DialogHeader>
          <div>Template not found or not assigned.</div>
        </DialogContent>
      </Dialog>
    );
  }

  const handleScoreChange = (criterionId: string, score: number) => {
    if (!canEdit) return;
    setScores((prev) => ({
      ...prev,
      [criterionId]: { ...prev[criterionId], score, evidence: prev[criterionId]?.evidence || "" },
    }));
  };

  const handleEvidenceChange = (criterionId: string, evidence: string) => {
    if (!canEdit) return;
    setScores((prev) => ({
      ...prev,
      [criterionId]: { ...prev[criterionId], score: prev[criterionId]?.score || 0, evidence },
    }));
  };

  const buildScoresArray = (): CriterionScore[] => {
    return Object.entries(scores).map(([criterionId, data]) => ({
      criterionId,
      score: data.score,
      evidence: data.evidence,
    }));
  };

  const handleSaveDraft = async () => {
    if (!scorecard) return;
    try {
      await scorecardService.saveScorecardAsync(
        scorecard.id,
        buildScoresArray(),
        (recommendation as ScorecardRecommendation) || null,
        false,
        currentUser!.getActorContext(),
      );
      toast.success("Draft saved");
      onSuccess?.();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to save draft");
    }
  };

  const handleSubmit = async () => {
    if (!scorecard) return;

    // Validate
    if (!recommendation) {
      toast.error("Overall recommendation is required to submit");
      return;
    }

    for (const c of template.criteria) {
      const s = scores[c.id];
      if (!s || s.score === 0) {
        toast.error(`Score for ${c.name} is required`);
        return;
      }
      if (c.requiresEvidence && (!s.evidence || s.evidence.trim() === "")) {
        toast.error(`Evidence for ${c.name} is required`);
        return;
      }
    }

    try {
      await scorecardService.saveScorecardAsync(
        scorecard.id,
        buildScoresArray(),
        recommendation as ScorecardRecommendation,
        true,
        currentUser!.getActorContext(),
      );
      toast.success("Scorecard submitted");
      onOpenChange(false);
      onSuccess?.();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to submit");
    }
  };

  const handleReopen = async () => {
    if (!scorecard) return;
    if (reopenReason.trim().length < 5) {
      toast.error("Please provide a valid reason for reopening");
      return;
    }
    try {
      await scorecardService.reopenScorecardAsync(
        scorecard.id,
        reopenReason,
        currentUser!.getActorContext(),
      );
      toast.success("Scorecard reopened");
      setIsReopening(false);
      onSuccess?.();
      onOpenChange(false);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to reopen");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex justify-between items-start">
            <div>
              <DialogTitle>Interview Scorecard</DialogTitle>
              <DialogDescription>{template.name}</DialogDescription>
            </div>
            {scorecard?.status === "Submitted" && (
              <Badge className="bg-emerald-500">Submitted</Badge>
            )}
            {scorecard?.status === "Draft" && <Badge variant="outline">Draft</Badge>}
          </div>
        </DialogHeader>

        {!scorecard && currentUser!.userId !== panelUserId ? (
          <div className="py-8 text-center text-muted-foreground">
            This panel member has not started their scorecard yet.
          </div>
        ) : (
          <div className="space-y-6 my-4">
            {template.blindScoring && canEdit && (
              <Alert className="bg-blue-50 text-blue-900 border-blue-200">
                <Info className="h-4 w-4" color="blue" />
                <AlertDescription>
                  <strong>Blind Scoring:</strong> Your scores are hidden from other panel members
                  until everyone has submitted.
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-8">
              {template.criteria.map((c) => (
                <div key={c.id} className="p-4 border rounded-md bg-muted/20">
                  <div className="mb-4">
                    <h4 className="font-semibold">{c.name}</h4>
                    <p className="text-sm text-muted-foreground">{c.description}</p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <Label className="mb-2 block">Score (1-5)</Label>
                      <div className="flex gap-2">
                        {[1, 2, 3, 4, 5].map((val) => (
                          <Button
                            key={val}
                            variant={scores[c.id]?.score === val ? "default" : "outline"}
                            className="w-12 h-12 rounded-full"
                            onClick={() => handleScoreChange(c.id, val)}
                            disabled={!canEdit}
                          >
                            {val}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <Label className="mb-2 block">
                        Evidence {c.requiresEvidence && <span className="text-destructive">*</span>}
                      </Label>
                      <Textarea
                        value={scores[c.id]?.evidence || ""}
                        onChange={(e) => handleEvidenceChange(c.id, e.target.value)}
                        placeholder={
                          c.requiresEvidence ? "Required evidence..." : "Optional notes..."
                        }
                        disabled={!canEdit}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 border rounded-md bg-primary/5 border-primary/20">
              <Label className="text-lg mb-4 block">
                Overall Recommendation <span className="text-destructive">*</span>
              </Label>
              <div className="flex gap-3">
                {["Strong Yes", "Yes", "Unsure", "No"].map((rec) => (
                  <Button
                    key={rec}
                    variant={recommendation === rec ? "default" : "outline"}
                    onClick={() => canEdit && setRecommendation(rec as ScorecardRecommendation)}
                    disabled={!canEdit}
                    className={
                      recommendation === rec
                        ? rec.includes("Yes")
                          ? "bg-emerald-600 hover:bg-emerald-700"
                          : rec === "No"
                            ? "bg-destructive hover:bg-destructive/90"
                            : "bg-amber-600 hover:bg-amber-700"
                        : ""
                    }
                  >
                    {rec}
                  </Button>
                ))}
              </div>
            </div>

            {scorecard?.revisionHistory && scorecard.revisionHistory.length > 0 && (
              <div className="mt-8 space-y-4">
                <h4 className="font-semibold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" /> Revision History
                </h4>
                {scorecard.revisionHistory.map((rev, idx) => (
                  <div key={idx} className="p-3 border rounded text-sm bg-muted/30">
                    <div className="flex justify-between text-muted-foreground mb-1">
                      <span>
                        {new Date(rev.date).toLocaleString()} by {rev.actor}
                      </span>
                    </div>
                    <div>
                      <strong>Reason:</strong> {rev.reason}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {isReadOnly && isAdmin && (
              <div className="border-t pt-6 mt-6">
                {!isReopening ? (
                  <Button variant="destructive" onClick={() => setIsReopening(true)}>
                    Reopen for Correction
                  </Button>
                ) : (
                  <div className="space-y-4 p-4 border border-destructive/20 bg-destructive/5 rounded-md">
                    <Label className="text-destructive">Reason for Reopening</Label>
                    <Input
                      value={reopenReason}
                      onChange={(e) => setReopenReason(e.target.value)}
                      placeholder="Must provide a reason for audit log..."
                    />
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => setIsReopening(false)}>
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={handleReopen}
                        disabled={reopenReason.trim().length < 5}
                      >
                        Confirm Reopen
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {canEdit && (
          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={handleSaveDraft}>
              Save Draft
            </Button>
            <Button onClick={handleSubmit}>Submit Scorecard</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
