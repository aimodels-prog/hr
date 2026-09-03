import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, CheckCircle2, ShieldAlert, Award, FileText } from "lucide-react";
import { OfferService, DecisionRecommendationResult } from "@/lib/data/offer-service";
import { CandidateService } from "@/lib/data/candidate-service";
import type { Candidate, HiringDecisionSnapshot } from "@/lib/data/types";
import { useCurrentUser } from "@/lib/auth";
import { toast } from "sonner";
import { OfferDialog } from "./offer-dialog";

interface DecisionPanelProps {
  vacancyId: string;
}

export function DecisionPanel({ vacancyId }: DecisionPanelProps) {
  const currentUser = useCurrentUser();
  const offerService = useMemo(() => new OfferService(), []);
  const candidateService = useMemo(() => new CandidateService(), []);

  const [recommendation, setRecommendation] = useState<DecisionRecommendationResult | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [decision, setDecision] = useState<HiringDecisionSnapshot | null>(null);

  const [selectedCandidateId, setSelectedCandidateId] = useState<string>("");
  const [overrideReason, setOverrideReason] = useState("");
  const [waiverReason, setWaiverReason] = useState("");

  const [isOfferDialogOpen, setIsOfferDialogOpen] = useState(false);
  const [offerCandidateId, setOfferCandidateId] = useState("");

  const refreshData = useCallback(() => {
    try {
      const context = currentUser.getActorContext();
      const rec = offerService.calculateDecisionRecommendation(vacancyId, context);
      setRecommendation(rec);
      if (rec.recommendedCandidateId) {
        setSelectedCandidateId(rec.recommendedCandidateId);
      }

      const allCands = candidateService.getDetailedCandidates(context);
      setCandidates(allCands);

      const decisions = offerService.getDecisionsForVacancy(vacancyId, context);
      if (decisions.length > 0) {
        setDecision(decisions[decisions.length - 1] ?? null);
      }
    } catch (e) {
      console.error(e);
    }
  }, [candidateService, currentUser, offerService, vacancyId]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  if (!recommendation) return null;

  const handleFinalize = async () => {
    if (recommendation.hasMissingInterviews && waiverReason.trim().length < 5) {
      toast.error("Waiver reason is required because interview data is incomplete.");
      return;
    }

    if (
      selectedCandidateId !== recommendation.recommendedCandidateId &&
      overrideReason.trim().length < 5
    ) {
      toast.error("Override reason is required when deviating from the system recommendation.");
      return;
    }

    try {
      await offerService.finalizeDecisionAsync(
        vacancyId,
        selectedCandidateId,
        overrideReason,
        waiverReason,
        currentUser!.getActorContext(),
      );
      toast.success("Hiring decision confirmed");
      refreshData();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to finalize decision");
    }
  };

  const isOverride = selectedCandidateId !== recommendation.recommendedCandidateId;

  if (decision) {
    const finalCand = candidates.find((c) => c.id === decision.finalSelectedCandidateId);
    return (
      <div className="space-y-6">
        <Card className="border-emerald-200">
          <CardHeader className="bg-emerald-50 border-b border-emerald-100">
            <CardTitle className="flex items-center gap-2 text-emerald-800">
              <CheckCircle2 className="h-5 w-5" /> Decision Finalized
            </CardTitle>
            <CardDescription className="text-emerald-700">
              The hiring decision has been locked in.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground">Selected Candidate</Label>
                <div className="text-lg font-medium">
                  {finalCand?.firstName} {finalCand?.lastName}
                </div>
              </div>
              <div>
                <Label className="text-muted-foreground">Status</Label>
                <div>
                  <Badge>Finalized</Badge>
                </div>
              </div>
            </div>

            {decision.overrideReason && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
                <strong>System Override Reason:</strong> {decision.overrideReason}
              </div>
            )}
            {decision.waiverReason && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
                <strong>Interview Waiver:</strong> {decision.waiverReason}
              </div>
            )}

            <div className="pt-4 border-t flex justify-end">
              <Button
                onClick={() => {
                  setOfferCandidateId(decision.finalSelectedCandidateId);
                  setIsOfferDialogOpen(true);
                }}
              >
                <FileText className="h-4 w-4 mr-2" /> Draft Job Offer
              </Button>
            </div>
          </CardContent>
        </Card>

        {isOfferDialogOpen && (
          <OfferDialog
            open={isOfferDialogOpen}
            onOpenChange={setIsOfferDialogOpen}
            vacancyId={vacancyId}
            candidateId={offerCandidateId}
          />
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_350px] gap-6">
      <div className="space-y-6">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Award className="h-5 w-5" /> Recommendation Matrix
        </h3>

        {recommendation.candidatesData.length === 0 ? (
          <div className="text-center p-8 bg-muted/30 rounded-lg text-muted-foreground">
            No candidates available in the shortlist for decision making.
          </div>
        ) : (
          <div className="space-y-4">
            {recommendation.candidatesData.map((data, idx) => {
              const cand = candidates.find((c) => c.id === data.candidateId);
              const isRecommended = data.candidateId === recommendation.recommendedCandidateId;
              const isSelected = data.candidateId === selectedCandidateId;

              return (
                <Card
                  key={data.candidateId}
                  className={`transition-all ${isSelected ? "ring-2 ring-primary border-primary" : ""}`}
                >
                  <CardContent className="p-5">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold text-lg">
                            {cand?.firstName} {cand?.lastName}
                          </h4>
                          {isRecommended && (
                            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">
                              System Recommendation
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground mt-1 flex gap-4">
                          <span>
                            Overall Score: <strong>{data.overallScore.toFixed(1)}</strong>
                          </span>
                          <span>
                            AI: <strong>{data.aiScore.toFixed(1)}</strong>
                          </span>
                          <span>
                            Interview Avg: <strong>{data.interviewScore.toFixed(1)}/5</strong>
                          </span>
                        </div>
                      </div>
                      <Button
                        variant={isSelected ? "default" : "outline"}
                        onClick={() => setSelectedCandidateId(data.candidateId)}
                      >
                        {isSelected ? "Selected" : "Select Candidate"}
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
                      <div>
                        <strong className="block text-muted-foreground mb-1">
                          Interview Recommendations
                        </strong>
                        {data.recommendations.length > 0 ? (
                          <div className="flex gap-1 flex-wrap">
                            {data.recommendations.map((r, i) => (
                              <Badge key={i} variant="secondary">
                                {r}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground italic">None</span>
                        )}
                      </div>
                      <div>
                        <strong className="block text-muted-foreground mb-1">
                          Risks / Watch-outs
                        </strong>
                        {data.risks.length > 0 ? (
                          <ul className="list-disc pl-4 text-amber-700">
                            {data.risks.map((r, i) => (
                              <li key={i}>{r}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-emerald-700">No major risks identified.</span>
                        )}
                      </div>
                    </div>

                    {data.missingInterviews && (
                      <div className="mt-3 p-2 bg-amber-50 text-amber-800 text-xs rounded border border-amber-200 flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        Incomplete interview data. Proceeding requires a waiver.
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-6">
        <Card className="sticky top-6">
          <CardHeader>
            <CardTitle>Finalize Decision</CardTitle>
            <CardDescription>
              Lock in your hiring choice and proceed to offer generation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {recommendation.hasMissingInterviews && (
              <Alert variant="destructive">
                <ShieldAlert className="h-4 w-4" />
                <AlertTitle>Missing Data</AlertTitle>
                <AlertDescription>
                  One or more candidates have incomplete interview data. You must provide a waiver
                  reason to proceed.
                </AlertDescription>
              </Alert>
            )}

            {recommendation.hasMissingInterviews && (
              <div className="space-y-2">
                <Label>
                  Waiver Reason <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  value={waiverReason}
                  onChange={(e) => setWaiverReason(e.target.value)}
                  placeholder="e.g. Candidate withdrew, or executive override..."
                />
              </div>
            )}

            {isOverride && (
              <div className="space-y-2">
                <Label>
                  Override Reason <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Why was the system recommendation bypassed?"
                />
              </div>
            )}

            <div className="pt-2">
              <Button
                className="w-full"
                onClick={handleFinalize}
                disabled={
                  !selectedCandidateId ||
                  (recommendation.hasMissingInterviews && waiverReason.length < 5) ||
                  (isOverride && overrideReason.length < 5)
                }
              >
                Confirm Hiring Decision
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
