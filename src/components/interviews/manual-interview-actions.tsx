import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { OfferDialog } from "@/components/offers/offer-dialog";
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
import { useCurrentUser } from "@/lib/auth";
import { InterviewService } from "@/lib/data/interview-service";
import { OfferService } from "@/lib/data/offer-service";
import { MasterDataService, type MasterDataCollection } from "@/lib/data/master-data";
import type { Candidate, InterviewEvent, ManualInterviewOutcome } from "@/lib/data/types";

interface ManualInterviewActionsProps {
  interview: InterviewEvent;
  candidate: Candidate;
  onSuccess: () => void;
}

type DecidedOutcome = Exclude<ManualInterviewOutcome, "Pending">;

export function ManualInterviewActions({
  interview,
  candidate,
  onSuccess,
}: ManualInterviewActionsProps) {
  const currentUser = useCurrentUser();
  const interviewService = useMemo(() => new InterviewService(), []);
  const offerService = useMemo(() => new OfferService(), []);
  const preparedDecision = offerService.getDecisionForInterview(
    interview.id,
    currentUser.getActorContext(),
  );

  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [outcome, setOutcome] = useState<DecidedOutcome>(
    interview.manualOutcome && interview.manualOutcome !== "Pending"
      ? interview.manualOutcome
      : "Proceed",
  );
  const [outcomeReason, setOutcomeReason] = useState(interview.manualDecisionReason || "");
  const [hireOpen, setHireOpen] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [preparedVacancyId, setPreparedVacancyId] = useState(preparedDecision?.vacancyId || "");
  const [position, setPosition] = useState(interview.positionTitle || candidate.currentTitle || "");
  const [department, setDepartment] = useState("");
  const [location, setLocation] = useState(candidate.location || "");
  const [employmentType, setEmploymentType] = useState("Full-time");
  const [grade, setGrade] = useState("");
  const [hireReason, setHireReason] = useState(
    "Selected following documented manual interview and completed panel scoring.",
  );
  const [saving, setSaving] = useState(false);
  const [masterOptions, setMasterOptions] = useState<Record<string, string[]>>({});
  const [loadingOptions, setLoadingOptions] = useState(false);

  useEffect(() => {
    if (!hireOpen) return;
    let cancelled = false;
    const collections: MasterDataCollection[] = [
      "positions",
      "departments",
      "locations",
      "grades",
      "employmentTypes",
    ];
    setLoadingOptions(true);
    const service = new MasterDataService();
    void Promise.all(collections.map((collection) => service.listAsync(collection, false)))
      .then((results) => {
        if (cancelled) return;
        const options = Object.fromEntries(
          collections.map((collection, index) => [
            collection,
            (results[index] ?? []).filter((item) => item.isActive).map((item) => item.name),
          ]),
        ) as Record<string, string[]>;
        setMasterOptions(options);
        setPosition((value) =>
          options["positions"]?.includes(value) ? value : (options["positions"]?.[0] ?? ""),
        );
        setDepartment((value) =>
          options["departments"]?.includes(value) ? value : (options["departments"]?.[0] ?? ""),
        );
        setLocation((value) =>
          options["locations"]?.includes(value) ? value : (options["locations"]?.[0] ?? ""),
        );
        setGrade((value) =>
          options["grades"]?.includes(value) ? value : (options["grades"]?.[0] ?? ""),
        );
        setEmploymentType((value) =>
          options["employmentTypes"]?.includes(value)
            ? value
            : (options["employmentTypes"]?.[0] ?? ""),
        );
      })
      .catch((error: unknown) => {
        if (!cancelled)
          toast.error(error instanceof Error ? error.message : "Could not load hiring options");
      })
      .finally(() => {
        if (!cancelled) setLoadingOptions(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hireOpen]);

  const saveOutcome = async () => {
    setSaving(true);
    try {
      await interviewService.recordManualOutcomeAsync(interview.id, outcome, outcomeReason, {
        ...currentUser.getActorContext(),
        reason: outcomeReason,
      });
      toast.success(`Manual interview outcome recorded as ${outcome}`);
      setOutcomeOpen(false);
      onSuccess();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save interview outcome");
    } finally {
      setSaving(false);
    }
  };

  const prepareHire = async () => {
    setSaving(true);
    try {
      const result = await offerService.prepareManualInterviewHireAsync(
        interview.id,
        { position, department, location, employmentType, grade },
        hireReason,
        { ...currentUser.getActorContext(), reason: hireReason },
      );
      setPreparedVacancyId(result.vacancy.id);
      setHireOpen(false);
      setOfferOpen(true);
      toast.success("Direct-hire record prepared. Complete the standard offer details.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not prepare direct hire");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setOutcomeOpen(true)}>
          {interview.manualOutcome && interview.manualOutcome !== "Pending"
            ? "Update outcome"
            : "Record outcome"}
        </Button>
        {interview.manualOutcome === "Selected" && (
          <Button
            size="sm"
            onClick={() => {
              if (preparedDecision) {
                setPreparedVacancyId(preparedDecision.vacancyId);
                setOfferOpen(true);
              } else {
                setHireOpen(true);
              }
            }}
          >
            <ArrowRight className="mr-1.5 h-4 w-4" />
            {preparedDecision ? "Create job offer" : "Proceed to hire"}
          </Button>
        )}
      </div>

      <Dialog open={outcomeOpen} onOpenChange={setOutcomeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Manual Interview Outcome</DialogTitle>
            <DialogDescription>
              Selection requires every assigned interviewer to submit their scorecard. Other
              outcomes can be recorded immediately with a reason.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Outcome</Label>
              <Select
                value={outcome}
                onValueChange={(value) => setOutcome(value as DecidedOutcome)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Proceed">Proceed for further consideration</SelectItem>
                  <SelectItem value="Hold">Place on hold</SelectItem>
                  <SelectItem value="Reject">Reject</SelectItem>
                  <SelectItem value="Selected">Selected for hire</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`manual-outcome-reason-${interview.id}`}>Decision reason</Label>
              <Textarea
                id={`manual-outcome-reason-${interview.id}`}
                rows={4}
                value={outcomeReason}
                onChange={(event) => setOutcomeReason(event.target.value)}
                placeholder="Summarise the evidence and reason for this decision"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOutcomeOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={saving || outcomeReason.trim().length < 5}
              onClick={() => void saveOutcome()}
            >
              Save outcome
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={hireOpen} onOpenChange={setHireOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Confirm Direct-Hire Details</DialogTitle>
            <DialogDescription>
              This does not create an application or shortlist. It creates a closed administrative
              hiring record so the standard controlled offer and onboarding workflow can continue.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Position</Label>
              <Select value={position} onValueChange={setPosition} disabled={loadingOptions}>
                <SelectTrigger>
                  <SelectValue placeholder="Select position" />
                </SelectTrigger>
                <SelectContent>
                  {(masterOptions["positions"] ?? []).map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Department</Label>
              <Select value={department} onValueChange={setDepartment} disabled={loadingOptions}>
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {(masterOptions["departments"] ?? []).map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Select value={location} onValueChange={setLocation} disabled={loadingOptions}>
                <SelectTrigger>
                  <SelectValue placeholder="Select location" />
                </SelectTrigger>
                <SelectContent>
                  {(masterOptions["locations"] ?? []).map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Grade</Label>
              <Select value={grade} onValueChange={setGrade} disabled={loadingOptions}>
                <SelectTrigger>
                  <SelectValue placeholder="Select grade" />
                </SelectTrigger>
                <SelectContent>
                  {(masterOptions["grades"] ?? []).map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Employment type</Label>
              <Select
                value={employmentType}
                onValueChange={setEmploymentType}
                disabled={loadingOptions}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(masterOptions["employmentTypes"] ?? []).map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="direct-reason">Why should this candidate move forward?</Label>
              <Textarea
                id="direct-reason"
                rows={3}
                value={hireReason}
                onChange={(event) => setHireReason(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHireOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                saving ||
                !position.trim() ||
                !department.trim() ||
                !location.trim() ||
                !grade.trim() ||
                hireReason.trim().length < 5
              }
              onClick={() => void prepareHire()}
            >
              <CheckCircle2 className="mr-1.5 h-4 w-4" /> Confirm and continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {preparedVacancyId && (
        <OfferDialog
          open={offerOpen}
          onOpenChange={setOfferOpen}
          vacancyId={preparedVacancyId}
          candidateId={candidate.id}
        />
      )}
    </>
  );
}
