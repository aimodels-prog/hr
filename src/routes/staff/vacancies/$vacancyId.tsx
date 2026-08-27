import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { RequirePermission, getRouteActorContext, useCurrentUser } from "@/lib/auth";
import { VacancyService } from "@/lib/data/vacancy-service";
import { CandidateService } from "@/lib/data/candidate-service";
import { ShortlistService } from "@/lib/data/shortlist-service";
import type {
  CandidateAssessmentBatch,
  CandidateAssessmentInclusion,
  CandidatePreparationRun,
  CandidateScoreRun,
  ShortlistOverride,
  ShortlistSnapshot,
  VacancyStatus,
} from "@/lib/data/types";
import { Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  MapPin,
  Building2,
  Copy,
  PauseCircle,
  PlayCircle,
  XCircle,
  Archive,
  Globe,
} from "lucide-react";
import { AuditViewer } from "@/components/audit-viewer";
import { DecisionPanel } from "@/components/offers/decision-panel";
import { InterviewService } from "@/lib/data/interview-service";
import { CandidatePreparationService } from "@/lib/data/candidate-preparation-service";
import { CandidatePoolService } from "@/lib/data/candidate-pool-service";

export const Route = createFileRoute("/staff/vacancies/$vacancyId")({
  loader: ({ params }) => {
    const vacancyService = new VacancyService();
    const vacancy = vacancyService.getVacancyRepository().getById(params.vacancyId);
    if (!vacancy) throw notFound();

    const candidateService = new CandidateService();
    const context = getRouteActorContext();
    const scores = candidateService.getLatestScoresForVacancy(vacancy.id, context);
    const candidates = candidateService.getDetailedCandidates(context);
    const applications = candidateService
      .getApplicationRepository()
      .list()
      .filter((application) => application.vacancyId === vacancy.id);
    const interviews = new InterviewService().getInterviewsForVacancy(vacancy.id, context);
    const shortlistService = new ShortlistService();
    const shortlist =
      shortlistService.getDraftForVacancy(vacancy.id) ||
      shortlistService.getFinalizedForVacancy(vacancy.id);

    return { vacancy, scores, candidates, applications, interviews, shortlist };
  },
  component: VacancyDetailRoute,
});

const transitionSchema = z.object({
  reason: z.string().min(3),
});

function VacancyDetailRoute() {
  const {
    vacancy,
    scores: initialScores,
    candidates,
    applications,
    interviews,
    shortlist: initialShortlist,
  } = Route.useLoaderData();
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const vacancyService = useMemo(() => new VacancyService(), []);
  const candidateService = useMemo(() => new CandidateService(), []);
  const shortlistService = useMemo(() => new ShortlistService(), []);
  const preparationService = useMemo(() => new CandidatePreparationService(), []);
  const poolService = useMemo(() => new CandidatePoolService(), []);
  const compulsoryCriteria = vacancy.mandatoryCriteria ?? [];
  const compulsoryCriteriaSet = new Set(
    compulsoryCriteria.map((criterion) => criterion.trim().toLowerCase()),
  );
  const otherRequirements = vacancy.requirements.filter(
    (requirement) => !compulsoryCriteriaSet.has(requirement.trim().toLowerCase()),
  );

  const [activeTab, setActiveTab] = useState("overview");
  const [transitionDialog, setTransitionDialog] = useState<{
    open: boolean;
    action: string;
    status: VacancyStatus | null;
  }>({ open: false, action: "", status: null });
  const [scores, setScores] = useState<CandidateScoreRun[]>(initialScores);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isAssessing, setIsAssessing] = useState(false);
  const [selectedScore, setSelectedScore] = useState<CandidateScoreRun | null>(null);
  const [preparationRuns, setPreparationRuns] = useState<CandidatePreparationRun[]>(() =>
    preparationService.getRunsForVacancy(vacancy.id, currentUser.getActorContext()),
  );
  const [inclusions, setInclusions] = useState<CandidateAssessmentInclusion[]>(() =>
    preparationService.getInclusions(vacancy.id, currentUser.getActorContext()),
  );
  const [assessmentBatch, setAssessmentBatch] = useState<CandidateAssessmentBatch | undefined>(() =>
    preparationService.getLatestBatch(vacancy.id, currentUser.getActorContext()),
  );
  const assessmentScores = assessmentBatch
    ? scores.filter((score) => assessmentBatch.detailedScoreIds.includes(score.id))
    : scores;
  const [poolDialogOpen, setPoolDialogOpen] = useState(false);
  const [poolCandidateId, setPoolCandidateId] = useState("");
  const [poolCvRecordId, setPoolCvRecordId] = useState("");
  const [poolReason, setPoolReason] = useState("");
  const [addingFromPool, setAddingFromPool] = useState(false);
  const [editingAssessmentGroup, setEditingAssessmentGroup] = useState(false);
  const [assessmentSelection, setAssessmentSelection] = useState<Set<string>>(
    () => new Set(assessmentBatch?.selectedCandidateIds || []),
  );
  const [assessmentChangeReason, setAssessmentChangeReason] = useState("");

  // Shortlist State
  const [shortlist, setShortlist] = useState<ShortlistSnapshot | undefined>(initialShortlist);
  const [isShortlistMode, setIsShortlistMode] = useState(false);
  const [targetSize, setTargetSize] = useState(
    Math.min(10, Math.max(1, initialShortlist?.targetSize ?? 5)),
  );
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(
    new Set(initialShortlist?.selectedCandidateIds || []),
  );
  const [overrideDialog, setOverrideDialog] = useState<{
    open: boolean;
    candidateId: string;
    type: "excluded_top" | "included_low" | "included_unscored";
    resolve: (reason: string) => void;
    reject: () => void;
  } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [finalizeDialog, setFinalizeDialog] = useState(false);
  const [unselectedAction, setUnselectedAction] = useState<"On Hold" | "Not Selected">("On Hold");

  const [overrides, setOverrides] = useState<ShortlistOverride[]>(
    initialShortlist?.overrides || [],
  );
  const pinnedCandidateIds = new Set([
    ...(assessmentBatch?.recommendedCandidateIds || []),
    ...(assessmentBatch?.hrAddedCandidateIds || []),
  ]);

  const form = useForm<z.infer<typeof transitionSchema>>({
    resolver: zodResolver(transitionSchema),
  });

  const getActorContext = (reason: string) => ({
    actor: {
      userId: currentUser!.userId,
      employeeId: currentUser!.employeeId,
      displayName: currentUser!.displayName,
      roles: currentUser!.assignedRoles,
      activeRole: currentUser!.activeRole,
    },
    reason,
  });

  const onTransition = (values: z.infer<typeof transitionSchema>) => {
    try {
      const act = transitionDialog.action;
      if (act === "Pause")
        vacancyService.pauseVacancy(vacancy.id, values.reason, getActorContext(values.reason));
      else if (act === "Close")
        vacancyService.closeVacancy(vacancy.id, values.reason, getActorContext(values.reason));
      else if (act === "Archive")
        vacancyService.archiveVacancy(vacancy.id, values.reason, getActorContext(values.reason));
      else if (act === "Submit")
        vacancyService.submitForApproval(vacancy.id, getActorContext(values.reason));
      else if (act === "Publish")
        vacancyService.publishVacancy(vacancy.id, getActorContext(values.reason));
      else if (act === "Reopen")
        vacancyService.reopenVacancy(vacancy.id, getActorContext(values.reason));

      toast.success(`Vacancy ${act.toLowerCase()}d`);
      setTransitionDialog({ open: false, action: "", status: null });
      navigate({ to: "/staff/vacancies" }); // Redirect to list or reload
    } catch (e) {
      toast.error("Transition failed");
    }
  };

  const onDuplicate = () => {
    try {
      const newVac = vacancyService.duplicateVacancy(
        vacancy.id,
        getActorContext("Duplicated vacancy"),
      );
      toast.success("Vacancy duplicated");
      navigate({ to: "/staff/vacancies/$vacancyId", params: { vacancyId: newVac.id } });
    } catch (e) {
      toast.error("Duplication failed");
    }
  };

  const refreshScreening = () => {
    const context = currentUser.getActorContext();
    setPreparationRuns(preparationService.getRunsForVacancy(vacancy.id, context));
    setInclusions(preparationService.getInclusions(vacancy.id, context));
    setAssessmentBatch(preparationService.getLatestBatch(vacancy.id, context));
    setScores(candidateService.getLatestScoresForVacancy(vacancy.id, context));
    setShortlist(
      shortlistService.getDraftForVacancy(vacancy.id) ||
        shortlistService.getFinalizedForVacancy(vacancy.id),
    );
  };

  const handlePrepareCandidates = async () => {
    setIsPreparing(true);
    try {
      const prepared = await preparationService.prepareVacancyApplications(
        vacancy.id,
        getActorContext("Prepared vacancy applications for preliminary review"),
      );
      refreshScreening();
      toast.success(`${prepared.length} application${prepared.length === 1 ? "" : "s"} prepared.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Candidate preparation failed.");
    } finally {
      setIsPreparing(false);
    }
  };

  const handleCreateAssessmentGroup = () => {
    try {
      const batch = preparationService.createAssessmentBatch(
        vacancy.id,
        targetSize,
        getActorContext("Selected the group for detailed assessment"),
      );
      setAssessmentBatch(batch);
      setSelectedCandidateIds(new Set(batch.selectedCandidateIds));
      setAssessmentSelection(new Set(batch.selectedCandidateIds));
      toast.success(
        `${batch.selectedCandidateIds.length} candidates selected for detailed assessment.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Assessment group could not be created.",
      );
    }
  };

  const handleRunDetailedAssessment = () => {
    if (!assessmentBatch) return;
    setIsAssessing(true);
    try {
      const completed = preparationService.runDetailedAssessment(
        assessmentBatch.id,
        getActorContext("Completed detailed assessment for the HR-selected group"),
      );
      setAssessmentBatch(completed);
      refreshScreening();
      toast.success("Detailed assessment completed. The shortlist is ready for HR review.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Detailed assessment failed.");
    } finally {
      setIsAssessing(false);
    }
  };

  const saveAssessmentGroupChanges = () => {
    if (!assessmentBatch) return;
    try {
      const updated = preparationService.updateAssessmentSelection(
        assessmentBatch.id,
        Array.from(assessmentSelection),
        assessmentChangeReason,
        getActorContext(assessmentChangeReason),
      );
      setAssessmentBatch(updated);
      setSelectedCandidateIds(new Set(updated.selectedCandidateIds));
      setEditingAssessmentGroup(false);
      setAssessmentChangeReason("");
      toast.success("Assessment group updated.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Assessment group could not be updated.",
      );
    }
  };

  const poolCandidateCvs = poolCandidateId
    ? poolService.getCandidateCvs(poolCandidateId, currentUser.getActorContext())
    : [];

  const handleAddFromPool = async () => {
    setAddingFromPool(true);
    try {
      await preparationService.includeCandidate(
        {
          vacancyId: vacancy.id,
          candidateId: poolCandidateId,
          cvRecordId: poolCvRecordId,
          source: "HR Added",
          reason: poolReason,
        },
        getActorContext(poolReason),
      );
      refreshScreening();
      setPoolDialogOpen(false);
      setPoolCandidateId("");
      setPoolCvRecordId("");
      setPoolReason("");
      toast.success("Candidate added to this vacancy's assessment group.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Candidate could not be added.");
    } finally {
      setAddingFromPool(false);
    }
  };

  const handleToggleShortlistCandidate = async (candidateId: string) => {
    const isCurrentlySelected = selectedCandidateIds.has(candidateId);
    if (isCurrentlySelected && pinnedCandidateIds.has(candidateId)) {
      toast.error("Recommended and HR-added candidates must remain in this assessment group.");
      return;
    }
    const scoreIndex = assessmentScores.findIndex((s) => s.candidateId === candidateId);
    const isTopN = scoreIndex >= 0 && scoreIndex < targetSize;
    const hasScore = scoreIndex >= 0;

    let overrideType: "excluded_top" | "included_low" | "included_unscored" | null = null;

    if (isCurrentlySelected && isTopN) {
      overrideType = "excluded_top";
    } else if (!isCurrentlySelected && !isTopN && hasScore) {
      overrideType = "included_low";
    } else if (!isCurrentlySelected && !hasScore) {
      overrideType = "included_unscored";
    }

    if (overrideType) {
      try {
        const reason = await new Promise<string>((resolve, reject) => {
          setOverrideDialog({
            open: true,
            candidateId,
            type: overrideType,
            resolve,
            reject,
          });
        });
        setOverrides((prev) => [
          ...prev.filter((o) => o.candidateId !== candidateId),
          { candidateId, type: overrideType, reason },
        ]);
      } catch (e) {
        // user cancelled
        return;
      }
    } else {
      // Remove override if they revert
      setOverrides((prev) => prev.filter((o) => o.candidateId !== candidateId));
    }

    setSelectedCandidateIds((prev) => {
      const next = new Set(prev);
      if (isCurrentlySelected) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });
  };

  const startShortlistBuilder = () => {
    setIsShortlistMode(true);
    if (!shortlist) {
      const initialTop =
        assessmentBatch?.selectedCandidateIds ||
        assessmentScores.slice(0, targetSize).map((s) => s.candidateId);
      setSelectedCandidateIds(new Set(initialTop));
      setOverrides([]);
    }
  };

  const saveShortlistDraft = () => {
    const payload = {
      vacancyId: vacancy.id,
      targetSize,
      rankedCandidateIds: assessmentScores.map((s) => s.candidateId),
      selectedCandidateIds: Array.from(selectedCandidateIds),
      pinnedCandidateIds: Array.from(pinnedCandidateIds),
      unselectedAction: null,
      overrides,
      status: "Draft" as const,
    };
    const saved = shortlistService.saveDraft(payload, getActorContext("Saved Shortlist Draft"));
    setShortlist(saved);
    toast.success("Shortlist draft saved");
    setIsShortlistMode(false);
  };

  const confirmFinalizeShortlist = () => {
    if (!shortlist) return; // Should have saved draft first
    try {
      const saved = shortlistService.saveDraft(
        {
          vacancyId: vacancy.id,
          targetSize,
          rankedCandidateIds: assessmentScores.map((s) => s.candidateId),
          selectedCandidateIds: Array.from(selectedCandidateIds),
          pinnedCandidateIds: Array.from(pinnedCandidateIds),
          unselectedAction: null,
          overrides,
          status: "Draft" as const,
        },
        getActorContext("Saved final draft before finalization"),
      );

      const final = shortlistService.finalizeShortlist(
        saved.id,
        unselectedAction,
        getActorContext("Finalized shortlist"),
      );
      setShortlist(final);
      setIsShortlistMode(false);
      setFinalizeDialog(false);
      toast.success("Shortlist confirmed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to finalize shortlist");
    }
  };

  // Recompute Top N if targetSize changes while building without manual edits for those newly in/out bounds?
  // We will leave manual choices untouched when resizing, only affecting future override rules.

  return (
    <RequirePermission permission="recruitment:view_vacancies" resourceName="Vacancy Details">
      <div className="flex flex-col gap-6 max-w-[1400px] mx-auto pb-10">
        <PageHeader
          title={vacancy.title}
          description={`${vacancy.department} • ${vacancy.location}`}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={onDuplicate} title="Duplicate">
                <Copy className="h-4 w-4" />
              </Button>

              <Dialog
                open={transitionDialog.open}
                onOpenChange={(open) => setTransitionDialog((prev) => ({ ...prev, open }))}
              >
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{transitionDialog.action} Vacancy</DialogTitle>
                  </DialogHeader>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onTransition)} className="space-y-4">
                      <FormField
                        control={form.control}
                        name="reason"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Audit Reason</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="e.g. Role put on hold due to budget" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <DialogFooter>
                        <Button type="submit">Confirm</Button>
                      </DialogFooter>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>

              {vacancy.status === "Draft" && (
                <Button
                  onClick={() =>
                    setTransitionDialog({
                      open: true,
                      action: "Submit",
                      status: "Pending Approval",
                    })
                  }
                >
                  Submit
                </Button>
              )}
              {vacancy.status === "Pending Approval" && (
                <Button
                  onClick={() =>
                    setTransitionDialog({ open: true, action: "Publish", status: "Open" })
                  }
                >
                  Publish
                </Button>
              )}
              {vacancy.status === "Open" && (
                <Button
                  variant="outline"
                  onClick={() =>
                    setTransitionDialog({ open: true, action: "Pause", status: "Paused" })
                  }
                >
                  <PauseCircle className="mr-2 h-4 w-4" /> Pause
                </Button>
              )}
              {vacancy.status === "Paused" && (
                <Button
                  onClick={() =>
                    setTransitionDialog({ open: true, action: "Reopen", status: "Open" })
                  }
                >
                  <PlayCircle className="mr-2 h-4 w-4" /> Reopen
                </Button>
              )}
              {["Open", "Paused", "Draft"].includes(vacancy.status) && (
                <Button
                  variant="destructive"
                  onClick={() =>
                    setTransitionDialog({ open: true, action: "Close", status: "Closed" })
                  }
                >
                  <XCircle className="mr-2 h-4 w-4" /> Close
                </Button>
              )}
              {vacancy.status === "Closed" && (
                <Button
                  variant="outline"
                  onClick={() =>
                    setTransitionDialog({ open: true, action: "Archive", status: "Archived" })
                  }
                >
                  <Archive className="mr-2 h-4 w-4" /> Archive
                </Button>
              )}
            </div>
          }
        />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-4 flex-wrap">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="description">Job Description</TabsTrigger>
            <TabsTrigger value="requirements">Requirements</TabsTrigger>
            <TabsTrigger value="applications">Applications ({vacancy.applicantCount})</TabsTrigger>
            <TabsTrigger value="shortlist">Scoring & Shortlist</TabsTrigger>
            <TabsTrigger value="interviews">Interviews</TabsTrigger>
            <TabsTrigger value="decision">Hiring Decision</TabsTrigger>
            <TabsTrigger value="activity">Status History</TabsTrigger>
            <TabsTrigger value="versions">Versions</TabsTrigger>
            <TabsTrigger value="audit">Audit Log</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <Card>
              <CardHeader>
                <CardTitle>Vacancy Overview</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm text-muted-foreground">Title</div>
                    <div className="font-medium">{vacancy.title}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Department</div>
                    <div className="font-medium">{vacancy.department}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Target Start Date</div>
                    <div className="font-medium">{vacancy.targetStartDate || "Not specified"}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Employment Type</div>
                    <div className="font-medium">{vacancy.employmentType}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Status</div>
                    <div className="font-medium mt-1 flex items-center gap-2">
                      <StatusBadge status={vacancy.status} />
                      {vacancy.status === "Open" && (
                        <span className="flex items-center gap-1 text-blue-600 font-medium">
                          <Globe className="h-4 w-4" /> Published externally
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="description">
            <Card>
              <CardHeader>
                <CardTitle>Job Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-6 whitespace-pre-wrap">{vacancy.summary}</p>
                <h3 className="font-semibold text-lg mb-2">Key Responsibilities</h3>
                <ul className="list-disc pl-5 space-y-2">
                  {vacancy.responsibilities.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="requirements">
            <Card>
              <CardHeader>
                <CardTitle>Requirements</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {compulsoryCriteria.length > 0 && (
                  <div className="rounded-lg border border-primary/25 bg-primary/5 p-4">
                    <h3 className="font-medium">Compulsory Criteria</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      These requirements must remain in the published job description.
                    </p>
                    <ul className="mt-3 list-disc space-y-2 pl-5">
                      {compulsoryCriteria.map((criterion) => (
                        <li key={criterion}>{criterion}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {otherRequirements.length > 0 && (
                  <div>
                    {compulsoryCriteria.length > 0 && (
                      <h3 className="mb-3 font-medium">Other Requirements</h3>
                    )}
                    <ul className="list-disc space-y-2 pl-5">
                      {otherRequirements.map((requirement) => (
                        <li key={requirement}>{requirement}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="applications" className="pt-4">
            <Card>
              <CardHeader>
                <CardTitle>Applications</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {applications.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No applications have been submitted for this vacancy.
                  </p>
                ) : (
                  applications.map((application) => {
                    const candidate = candidates.find(
                      (item) => item.id === application.candidateId,
                    );
                    return (
                      <div
                        key={application.id}
                        className="flex flex-col gap-2 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <Link
                            to="/staff/candidates/$candidateId"
                            params={{ candidateId: application.candidateId }}
                            className="font-medium hover:underline"
                          >
                            {candidate
                              ? `${candidate.firstName} ${candidate.lastName}`
                              : application.referenceId}
                          </Link>
                          <p className="text-sm text-muted-foreground">
                            {application.referenceId} · {application.source}
                          </p>
                        </div>
                        <StatusBadge status={application.status} />
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="interviews" className="pt-4">
            <Card>
              <CardHeader>
                <CardTitle>Interviews</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {interviews.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No interviews have been scheduled. Schedule one from a shortlisted candidate
                    profile.
                  </p>
                ) : (
                  interviews.map((interview) => {
                    const candidate = candidates.find((item) => item.id === interview.candidateId);
                    return (
                      <div key={interview.id} className="rounded-md border p-4">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <Link
                              to="/staff/candidates/$candidateId"
                              params={{ candidateId: interview.candidateId }}
                              className="font-medium hover:underline"
                            >
                              {candidate
                                ? `${candidate.firstName} ${candidate.lastName}`
                                : "Candidate"}
                            </Link>
                            <p className="text-sm text-muted-foreground">
                              {interview.stageName}
                              {interview.confirmedSlot
                                ? ` · ${new Date(interview.confirmedSlot.startTime).toLocaleString()}`
                                : " · Time pending"}
                            </p>
                          </div>
                          <StatusBadge status={interview.status} />
                        </div>
                        {interview.meetingJoinUrl && (
                          <a
                            href={interview.meetingJoinUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-block text-sm text-primary hover:underline"
                          >
                            Open meeting details
                          </a>
                        )}
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="decision" className="pt-4">
            <DecisionPanel vacancyId={vacancy.id} />
          </TabsContent>

          <TabsContent value="shortlist" className="pt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Candidate Screening & Shortlist</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    Prepare every application first, then choose how many people receive the
                    detailed assessment.
                  </p>
                </div>
                <div className="flex gap-2">
                  {assessmentBatch?.status === "Assessment Completed" &&
                    shortlist?.status !== "Finalized" &&
                    !isShortlistMode && (
                      <Button variant="outline" onClick={startShortlistBuilder}>
                        Review Shortlist
                      </Button>
                    )}
                  {isShortlistMode && (
                    <>
                      <Button variant="outline" onClick={saveShortlistDraft}>
                        Save Draft
                      </Button>
                      <Button onClick={() => setFinalizeDialog(true)}>Finalize...</Button>
                    </>
                  )}
                  <Button variant="outline" onClick={() => setPoolDialogOpen(true)}>
                    Add from Candidate Pool
                  </Button>
                  <Button
                    onClick={handlePrepareCandidates}
                    disabled={isPreparing || isShortlistMode}
                  >
                    {isPreparing ? "Preparing..." : "Prepare Applications"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  {[
                    ["Applications", applications.length],
                    ["Prepared", preparationRuns.filter((run) => run.status === "Ready").length],
                    [
                      "Needs review",
                      preparationRuns.filter((run) => run.status === "Needs Review").length,
                    ],
                    [
                      "Processing issues",
                      preparationRuns.filter((run) => run.status === "Processing Failed").length,
                    ],
                    ["Pinned", pinnedCandidateIds.size],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border bg-muted/20 p-3">
                      <div className="text-xs text-muted-foreground">{label}</div>
                      <div className="mt-1 text-2xl font-semibold">{value}</div>
                    </div>
                  ))}
                </div>

                <div className="rounded-lg border">
                  <div className="flex flex-col gap-4 border-b p-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <h3 className="font-semibold">Preliminary review</h3>
                      <p className="text-sm text-muted-foreground">
                        CV text is reused where possible. OCR is reserved for scanned documents;
                        detailed AI is not used at this stage.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="w-44">
                        <label className="mb-1 block text-xs font-medium">People to assess</label>
                        <Input
                          type="number"
                          min={1}
                          max={10}
                          value={targetSize}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            setTargetSize(
                              Number.isFinite(value) ? Math.min(10, Math.max(1, value)) : 1,
                            );
                          }}
                        />
                      </div>
                      <Button
                        variant="outline"
                        onClick={handleCreateAssessmentGroup}
                        disabled={preparationRuns.length === 0 || isPreparing}
                      >
                        Choose Assessment Group
                      </Button>
                      <Button
                        onClick={handleRunDetailedAssessment}
                        disabled={
                          !assessmentBatch ||
                          assessmentBatch.status !== "Draft" ||
                          isAssessing ||
                          editingAssessmentGroup
                        }
                      >
                        {isAssessing ? "Assessing..." : "Run Detailed Assessment"}
                      </Button>
                    </div>
                  </div>
                  {preparationRuns.length === 0 ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">
                      Applications are safely stored. Choose Prepare Applications to build the
                      preliminary review.
                    </div>
                  ) : (
                    <div className="divide-y">
                      {preparationRuns.map((run, index) => {
                        const candidate = candidates.find((item) => item.id === run.candidateId);
                        const inclusion = inclusions.find(
                          (item) => item.candidateId === run.candidateId,
                        );
                        const selected = editingAssessmentGroup
                          ? assessmentSelection.has(run.candidateId)
                          : assessmentBatch?.selectedCandidateIds.includes(run.candidateId);
                        return (
                          <div
                            key={run.id}
                            className="grid gap-3 p-4 md:grid-cols-[3rem_1fr_auto_auto] md:items-center"
                          >
                            <span className="text-sm font-semibold text-muted-foreground">
                              #{index + 1}
                            </span>
                            <div>
                              <Link
                                to="/staff/candidates/$candidateId"
                                params={{ candidateId: run.candidateId }}
                                className="font-medium hover:underline"
                              >
                                {candidate
                                  ? `${candidate.firstName} ${candidate.lastName}`
                                  : "Candidate"}
                              </Link>
                              <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                <span>{run.documentRoute}</span>
                                <span>•</span>
                                <span>{run.band || run.status}</span>
                                {inclusion && <Badge variant="outline">{inclusion.source}</Badge>}
                                {selected && <Badge>Selected for assessment</Badge>}
                              </div>
                            </div>
                            <StatusBadge status={run.status} />
                            <div className="flex items-center justify-end gap-3 text-right">
                              {editingAssessmentGroup && assessmentBatch?.status === "Draft" && (
                                <Button
                                  size="sm"
                                  variant={selected ? "secondary" : "outline"}
                                  disabled={selected && pinnedCandidateIds.has(run.candidateId)}
                                  onClick={() =>
                                    setAssessmentSelection((current) => {
                                      const next = new Set(current);
                                      if (next.has(run.candidateId)) next.delete(run.candidateId);
                                      else next.add(run.candidateId);
                                      return next;
                                    })
                                  }
                                >
                                  {selected ? "Remove" : "Select"}
                                </Button>
                              )}
                              <div>
                                <div className="text-xs text-muted-foreground">
                                  Preliminary score
                                </div>
                                <div className="font-semibold">
                                  {run.preliminaryScore ?? "—"}/100
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {assessmentBatch && (
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold">Detailed assessment group</div>
                        <p className="text-sm text-muted-foreground">
                          {assessmentBatch.selectedCandidateIds.length} people selected, including{" "}
                          {assessmentBatch.recommendedCandidateIds.length} recommended and{" "}
                          {assessmentBatch.hrAddedCandidateIds.length} added by HR.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={assessmentBatch.status} />
                        {assessmentBatch.status === "Draft" && !editingAssessmentGroup && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setAssessmentSelection(new Set(assessmentBatch.selectedCandidateIds));
                              setEditingAssessmentGroup(true);
                            }}
                          >
                            Adjust Group
                          </Button>
                        )}
                      </div>
                    </div>
                    {editingAssessmentGroup && (
                      <div className="mt-4 flex flex-col gap-3 border-t border-primary/15 pt-4 md:flex-row md:items-end">
                        <div className="flex-1">
                          <Label>Reason for changing the group</Label>
                          <Input
                            className="mt-1"
                            value={assessmentChangeReason}
                            onChange={(event) => setAssessmentChangeReason(event.target.value)}
                            placeholder="Why is HR replacing or changing the proposed candidates?"
                          />
                        </div>
                        <div className="text-sm font-medium">
                          {assessmentSelection.size} / {assessmentBatch.targetSize} selected
                        </div>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setEditingAssessmentGroup(false);
                            setAssessmentSelection(new Set(assessmentBatch.selectedCandidateIds));
                            setAssessmentChangeReason("");
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={saveAssessmentGroupChanges}
                          disabled={
                            assessmentSelection.size !== assessmentBatch.targetSize ||
                            assessmentChangeReason.trim().length < 5
                          }
                        >
                          Save Changes
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {isShortlistMode && (
                  <div className="mb-6 p-4 bg-muted/30 border rounded-md">
                    <div className="flex items-center justify-between">
                      <div className="w-1/2">
                        <label className="text-sm font-medium mb-2 block">
                          Target Shortlist Size
                        </label>
                        <div className="flex items-center gap-3">
                          <Slider
                            value={[targetSize]}
                            min={1}
                            max={10}
                            step={1}
                            onValueChange={(v) => setTargetSize(v[0] ?? 5)}
                            className="flex-1"
                          />
                          <Input
                            type="number"
                            min={1}
                            max={10}
                            value={targetSize}
                            onChange={(e) => {
                              const n = parseInt(e.target.value, 10);
                              setTargetSize(Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : 1);
                            }}
                            className="w-20 text-center"
                          />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {`Pre-selects the top ${targetSize} scored candidate${targetSize === 1 ? "" : "s"}. You can adjust the selection, but the final shortlist must contain this number and every ranking override needs a reason.`}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-muted-foreground">Currently Selected</div>
                        <div
                          className={`text-2xl font-bold ${selectedCandidateIds.size > targetSize ? "text-amber-600" : ""}`}
                        >
                          {selectedCandidateIds.size}{" "}
                          <span className="text-lg text-muted-foreground font-normal">
                            / {targetSize}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {shortlist?.status === "Finalized" && !isShortlistMode && (
                  <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-md text-emerald-900">
                    <h4 className="font-semibold flex items-center gap-2">
                      <StatusBadge status="Finalized" /> Shortlist Finalized
                    </h4>
                    <p className="text-sm mt-1">
                      This shortlist was confirmed on{" "}
                      {new Date(shortlist.updatedAt).toLocaleString()}. Candidates have been moved
                      to the appropriate stages.
                    </p>
                  </div>
                )}

                {assessmentScores.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground">
                    No detailed assessments yet. Prepare the applications, choose the assessment
                    group and run the detailed assessment.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {assessmentScores.map((score, idx) => {
                      const candidate = candidates.find((c) => c.id === score.candidateId);
                      if (!candidate) return null;

                      const isTopN = idx < targetSize;
                      const isSelected = selectedCandidateIds.has(candidate.id);

                      // Only show outside top N if in Shortlist Builder or if selected
                      if (!isShortlistMode && idx >= 10 && !isSelected) return null;

                      return (
                        <div
                          key={score.id}
                          className={`flex items-center justify-between p-4 border rounded-md transition-colors ${isSelected ? "bg-primary/5 border-primary/20" : ""}`}
                        >
                          <div className="flex items-center gap-4">
                            <div
                              className={`flex h-10 w-10 items-center justify-center rounded-full font-bold ${isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                            >
                              #{idx + 1}
                            </div>
                            <div>
                              <Link
                                to="/staff/candidates/$candidateId"
                                params={{ candidateId: candidate.id }}
                                className="font-medium hover:underline"
                              >
                                {candidate.firstName} {candidate.lastName}
                              </Link>
                              <div className="text-sm text-muted-foreground flex gap-3 mt-1 items-center">
                                <span>{candidate.currentTitle || "No Title"}</span>
                                <span>•</span>
                                <span>
                                  Score:{" "}
                                  <strong
                                    className={
                                      score.overallScore >= 80
                                        ? "text-emerald-600"
                                        : score.overallScore >= 60
                                          ? "text-amber-600"
                                          : "text-red-600"
                                    }
                                  >
                                    {score.overallScore}/100
                                  </strong>
                                </span>
                                {candidate.doNotContact && (
                                  <Badge variant="destructive" className="ml-2">
                                    Do Not Contact
                                  </Badge>
                                )}
                                {score.missingData.length > 0 && (
                                  <span className="text-amber-600 flex items-center gap-1">
                                    <XCircle className="h-3 w-3" /> Incomplete
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2 items-center">
                            {isShortlistMode && (
                              <Button
                                variant={isSelected ? "secondary" : "outline"}
                                onClick={() => handleToggleShortlistCandidate(candidate.id)}
                              >
                                {isSelected ? "Remove" : "Select"}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSelectedScore(score)}
                            >
                              View
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Dialog open={poolDialogOpen} onOpenChange={setPoolDialogOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add from Candidate Pool</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Candidate</Label>
                    <Select
                      value={poolCandidateId}
                      onValueChange={(value) => {
                        setPoolCandidateId(value);
                        const candidate = candidates.find((item) => item.id === value);
                        setPoolCvRecordId(candidate?.latestCvRecordId || "");
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a candidate" />
                      </SelectTrigger>
                      <SelectContent>
                        {candidates
                          .filter(
                            (candidate) =>
                              !candidate.mergedIntoId && candidate.stage !== "Archived",
                          )
                          .map((candidate) => (
                            <SelectItem key={candidate.id} value={candidate.id}>
                              {candidate.firstName} {candidate.lastName} · {candidate.email}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>CV version</Label>
                    <Select value={poolCvRecordId} onValueChange={setPoolCvRecordId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select the CV to use" />
                      </SelectTrigger>
                      <SelectContent>
                        {poolCandidateCvs.map((record) => (
                          <SelectItem key={record.id} value={record.id}>
                            {record.originalFileName} ·{" "}
                            {new Date(record.receivedAt).toLocaleDateString()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Reason for adding this person</Label>
                    <Input
                      value={poolReason}
                      onChange={(event) => setPoolReason(event.target.value)}
                      placeholder="Relevant previous interview or experience"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setPoolDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAddFromPool}
                    disabled={
                      addingFromPool ||
                      !poolCandidateId ||
                      !poolCvRecordId ||
                      poolReason.trim().length < 5
                    }
                  >
                    {addingFromPool ? "Adding..." : "Add to Screening"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Override Intercept Dialog */}
            <Dialog
              open={!!overrideDialog?.open}
              onOpenChange={(open) => {
                if (!open && overrideDialog) {
                  overrideDialog.reject();
                  setOverrideDialog(null);
                  setOverrideReason("");
                }
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Override Required</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <p className="text-sm">
                    {overrideDialog?.type === "excluded_top" &&
                      "You are removing a top-ranked candidate from the shortlist. Please provide a justification."}
                    {overrideDialog?.type === "included_low" &&
                      "You are adding a lower-ranked candidate to the shortlist. Please provide a justification."}
                    {overrideDialog?.type === "included_unscored" &&
                      "You are adding an unscored candidate to the shortlist. Please provide a justification."}
                  </p>
                  <Input
                    placeholder="Enter reason..."
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    autoFocus
                  />
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      overrideDialog?.reject();
                      setOverrideDialog(null);
                      setOverrideReason("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={overrideReason.trim().length < 3}
                    onClick={() => {
                      overrideDialog?.resolve(overrideReason);
                      setOverrideDialog(null);
                      setOverrideReason("");
                    }}
                  >
                    Confirm
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Finalize Dialog */}
            <Dialog open={finalizeDialog} onOpenChange={setFinalizeDialog}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Finalize Shortlist</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <p className="text-sm">
                    You have selected <strong>{selectedCandidateIds.size}</strong> candidates for
                    the shortlist.
                  </p>
                  <div className="space-y-2">
                    <Label>Action for Unselected Candidates</Label>
                    <Select
                      value={unselectedAction}
                      onValueChange={(value: "On Hold" | "Not Selected") =>
                        setUnselectedAction(value)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="On Hold">Place On Hold</SelectItem>
                        <SelectItem value="Not Selected">Mark Not Selected</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Unselected candidates will be moved to this stage. They are never deleted.
                    </p>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setFinalizeDialog(false)}>
                    Cancel
                  </Button>
                  <Button onClick={confirmFinalizeShortlist}>Finalize & Update Stages</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={!!selectedScore} onOpenChange={(open) => !open && setSelectedScore(null)}>
              <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Score Breakdown</DialogTitle>
                </DialogHeader>
                {selectedScore && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-3 gap-4">
                      <div className="p-4 border rounded-md bg-muted/30">
                        <div className="text-sm text-muted-foreground">Overall Score</div>
                        <div className="text-3xl font-bold">{selectedScore.overallScore}</div>
                      </div>
                      <div className="p-4 border rounded-md bg-muted/30 col-span-2">
                        <div className="text-sm text-muted-foreground mb-2">Categories</div>
                        <div className="space-y-1 text-sm">
                          <div className="flex justify-between">
                            <span>Experience (40%)</span>{" "}
                            <strong>{selectedScore.categoryScores.Experience}</strong>
                          </div>
                          <div className="flex justify-between">
                            <span>Profile Match (40%)</span>{" "}
                            <strong>{selectedScore.categoryScores.Profile}</strong>
                          </div>
                          <div className="flex justify-between">
                            <span>Location (20%)</span>{" "}
                            <strong>{selectedScore.categoryScores.Location}</strong>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="p-4 bg-primary/5 border border-primary/20 rounded-md">
                      <h4 className="font-semibold mb-1 text-primary">Evidence & Explanation</h4>
                      <p className="text-sm">{selectedScore.evidence}</p>
                    </div>

                    {selectedScore.strengths.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-emerald-700 mb-2 flex items-center gap-2">
                          <PlayCircle className="h-4 w-4" /> Strengths
                        </h4>
                        <ul className="list-disc pl-5 text-sm space-y-1">
                          {selectedScore.strengths.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {selectedScore.risks.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-amber-700 mb-2 flex items-center gap-2">
                          <PauseCircle className="h-4 w-4" /> Risks & Watch-outs
                        </h4>
                        <ul className="list-disc pl-5 text-sm space-y-1">
                          {selectedScore.risks.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {selectedScore.missingData.length > 0 && (
                      <div className="p-3 bg-muted border rounded-md">
                        <h4 className="font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                          <XCircle className="h-4 w-4" /> Missing Data
                        </h4>
                        <ul className="list-disc pl-5 text-sm space-y-1 text-muted-foreground">
                          {selectedScore.missingData.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ul>
                        <p className="text-xs mt-2 text-muted-foreground italic">
                          Missing data negatively impacts the score. Values are never inferred if
                          absent.
                        </p>
                      </div>
                    )}

                    <div className="text-xs text-muted-foreground pt-4 border-t flex justify-between">
                      <span>Model: {selectedScore.modelRulesVersion}</span>
                      <span>Run Time: {new Date(selectedScore.timestamp).toLocaleString()}</span>
                    </div>
                  </div>
                )}
                <DialogFooter>
                  <Button onClick={() => setSelectedScore(null)}>Close</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </TabsContent>

          <TabsContent value="activity" className="min-h-[500px] pt-4">
            <AuditViewer entityId={vacancy.id} entityType="vacancy" />
          </TabsContent>

          <TabsContent value="versions" className="pt-4">
            <Card>
              <CardHeader>
                <CardTitle>Vacancy Version History</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-4 text-sm text-muted-foreground">
                  Every saved vacancy change appears below. This is revision {vacancy.recordVersion}
                  .
                </p>
                <AuditViewer entityId={vacancy.id} entityType="vacancy" />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audit" className="min-h-[500px]">
            <AuditViewer entityId={vacancy.id} entityType="vacancy" />
          </TabsContent>
        </Tabs>
      </div>
    </RequirePermission>
  );
}
