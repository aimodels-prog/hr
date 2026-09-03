import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Building2,
  Calendar,
  FileText,
  AlertTriangle,
  ShieldAlert,
  Plus,
  MessageSquare,
  UserPlus,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CandidateService } from "@/lib/data/candidate-service";
import { CandidatePoolService } from "@/lib/data/candidate-pool-service";
import { VacancyService } from "@/lib/data/vacancy-service";
import { InterviewService } from "@/lib/data/interview-service";
import { ScorecardService } from "@/lib/data/scorecard-service";
import { OfferService } from "@/lib/data/offer-service";
import { EmployeeService } from "@/lib/data/employee-service";
import { InterviewDialog } from "@/components/interviews/interview-dialog";
import { ManualInterviewDialog } from "@/components/interviews/manual-interview-dialog";
import { ManualInterviewActions } from "@/components/interviews/manual-interview-actions";
import { CandidateInterviewRecommendationDialog } from "@/components/interviews/candidate-interview-recommendation-dialog";
import { InterviewDispositionActions } from "@/components/interviews/interview-disposition-actions";
import { ScorecardForm } from "@/components/interviews/scorecard-form";
import { AuditViewer } from "@/components/audit-viewer";
import { ScoreBadge } from "@/components/score-badge";
import { getApplicationDataServices } from "@/lib/data/application-data";
import { getProjectRepository } from "@/lib/data/master-data";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  VISA_STATUS_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  type ActorContext,
  type Role,
} from "@/lib/data/types";
import { RequirePermission, useCurrentUser } from "@/lib/auth";

const contactFormSchema = z.object({
  channel: z.enum(["Email", "Phone", "LinkedIn", "In-Person", "Other"]),
  outcome: z.enum([
    "No Answer",
    "Interested",
    "Not Interested",
    "Follow-up Required",
    "Interview Arranged",
    "Unavailable",
    "Invalid Contact",
    "Do Not Contact",
  ]),
  vacancyId: z.string().optional(),
  occurredAt: z.string().min(1, "Contact date and time are required"),
  notes: z.string().min(1, "Notes are required"),
  nextFollowUpDate: z.string().optional(),
});

const recruitmentDetailsSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  phone: z.string().min(1, "Contact number is required"),
  currentTitle: z.string().optional(),
  currentCompany: z.string().optional(),
  yearsOfExperience: z.coerce.number().min(0, "Experience cannot be negative"),
  nationality: z.string().optional(),
  location: z.string().min(1, "Location is required"),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  projectType: z.string().optional(),
  shortlistStatus: z.string().optional(),
  trackerStatus: z.string().optional(),
  visaStatus: z.enum(VISA_STATUS_OPTIONS).optional(),
  maritalStatus: z.enum(MARITAL_STATUS_OPTIONS).optional(),
  noticePeriod: z.string().optional(),
  currentSalary: z.string().optional(),
  expectedSalary: z.string().optional(),
  acceptedSalary: z.string().optional(),
  interviewDate: z.string().optional(),
  remarks: z.string().optional(),
});

const recommendationFormSchema = z
  .object({
    recommenderType: z.enum([
      "Agency",
      "Employee Referral",
      "External Person",
      "Client",
      "Supplier",
      "Company",
    ]),
    recommenderName: z.string().min(1, "Name is required"),
    recommenderCompany: z.string().optional(),
    recommenderPosition: z.string().optional(),
    recommenderEmail: z.union([z.literal(""), z.string().email("Enter a valid email")]),
    recommenderPhone: z.string().optional(),
    relationship: z.string().optional(),
    notes: z.string().optional(),
    commercialTerms: z.string().optional(),
    vacancyId: z.string().optional(),
  })
  .refine((values) => values.recommenderEmail.trim() || values.recommenderPhone?.trim(), {
    path: ["recommenderPhone"],
    message: "Enter the recommender's email or phone number",
  });

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function ProfileList({ label, values }: { label: string; values?: string[] | undefined }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {values && values.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {values.map((value) => (
            <Badge key={value} variant="secondary">
              {value}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">Not recorded</p>
      )}
    </div>
  );
}

export const Route = createFileRoute("/staff/candidates/$candidateId")({
  loader: ({ params }) => ({ candidateId: params.candidateId }),
  component: CandidateProfileWrapper,
});

type DetailedCandidate = ReturnType<CandidateService["getDetailedCandidates"]>[number];

function CandidateProfileWrapper() {
  const { candidateId } = Route.useLoaderData();
  const currentUser = useCurrentUser();
  const [candidateService] = useState(() => new CandidateService());
  const [candidate, setCandidate] = useState<DetailedCandidate | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const { userId, employeeId, displayName, workspaceEmail, activeRole, assignedRoles } =
    currentUser;
  const assignedRolesKey = assignedRoles.join("|");
  const actorContext = useMemo<ActorContext>(
    () => ({
      actor: {
        userId,
        employeeId,
        displayName,
        workspaceEmail,
        activeRole,
        roles: assignedRolesKey.split("|") as Role[],
      },
    }),
    [userId, employeeId, displayName, workspaceEmail, activeRole, assignedRolesKey],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadCandidate() {
      setLoading(true);
      setLoadError(null);
      try {
        await candidateService.hydrateCompatibilityCache(actorContext);
        if (cancelled) return;
        const match = candidateService
          .getDetailedCandidates(actorContext)
          .find((item) => item.id === candidateId);
        setCandidate(match ?? null);
      } catch (error) {
        if (!cancelled) {
          setCandidate(null);
          setLoadError(errorMessage(error, "The candidate profile could not be loaded."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadCandidate();
    return () => {
      cancelled = true;
    };
  }, [actorContext, candidateId, candidateService, reloadToken]);

  return (
    <RequirePermission permission="recruitment:view_candidates" resourceName="Candidate Profile">
      {loading ? (
        <div className="mx-auto max-w-7xl px-4 py-10 text-sm text-muted-foreground">
          Loading candidate profile...
        </div>
      ) : candidate ? (
        <CandidateProfile
          candidate={candidate}
          onRefresh={() => setReloadToken((value) => value + 1)}
        />
      ) : (
        <div className="mx-auto max-w-3xl px-4 py-10">
          <Card>
            <CardHeader>
              <CardTitle>Candidate profile unavailable</CardTitle>
              <CardDescription>
                {loadError ?? "This candidate does not exist or you do not have access to it."}
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button asChild variant="outline">
                <Link to="/staff/candidates">Back to Candidate Pool</Link>
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}
    </RequirePermission>
  );
}

function CandidateProfile({
  candidate,
  onRefresh,
}: {
  candidate: DetailedCandidate;
  onRefresh: () => void;
}) {
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const refresh = onRefresh;
  const [vacancyService] = useState(() => new VacancyService());
  const [candidateService] = useState(() => new CandidateService());
  const [candidatePoolService] = useState(() => new CandidatePoolService());
  const [interviewService] = useState(() => new InterviewService());
  const [scorecardService] = useState(() => new ScorecardService());
  const [offerService] = useState(() => new OfferService());
  const [empService] = useState(() => new EmployeeService());

  const vacancies = useMemo(() => vacancyService.getVacancyRepository().list(), [vacancyService]);
  const interviews = interviewService.getInterviewsForCandidate(
    candidate.id,
    currentUser.getActorContext(),
  );
  const candidateScores = useMemo(
    () => candidateService.getScoresForCandidate(candidate.id, currentUser.getActorContext()),
    [candidateService, candidate.id, currentUser],
  );
  const offers = useMemo(
    () => offerService.getOffersForCandidate(candidate.id, currentUser.getActorContext()),
    [offerService, candidate.id, currentUser],
  );
  const hasAcceptedOffer = offers.some((o) => o.status === "Accepted");
  const projects = useMemo(() => getProjectRepository().list(), []);
  const currentProject = projects.find((p) => p.id === candidate.projectId);
  const visibleRecommendations = candidateService.getRecommendationsForCandidate(
    candidate.id,
    currentUser.getActorContext(),
  );
  const cvRecords = candidatePoolService.getCandidateCvs(
    candidate.id,
    currentUser.getActorContext(),
  );
  const interviewRecommendations = candidatePoolService.getInterviewRecommendations(
    candidate.id,
    currentUser.getActorContext(),
  );

  type ActivityEntry = { date: string; label: string; detail: string; kind: string };
  const activityTimeline = useMemo<ActivityEntry[]>(() => {
    const entries: ActivityEntry[] = [];
    for (const app of candidate.applications) {
      const vacancy = vacancies.find((v) => v.id === app.vacancyId);
      entries.push({
        date: app.createdAt,
        kind: "Application",
        label: `Applied to ${vacancy?.title || "a vacancy"}`,
        detail: `Reference ${app.referenceId} - status ${app.status}`,
      });
    }
    for (const contact of candidate.contacts) {
      entries.push({
        date: contact.date,
        kind: "Contact",
        label: `Contacted via ${contact.channel}`,
        detail: `${contact.outcome}${contact.notes ? ` - ${contact.notes}` : ""}`,
      });
    }
    for (const interview of interviews) {
      for (const event of interview.history) {
        entries.push({
          date: event.date,
          kind: "Interview",
          label: `${interview.stageName}: ${event.action}`,
          detail: event.details,
        });
      }
    }
    for (const offer of offers) {
      for (const event of offer.history) {
        entries.push({
          date: event.date,
          kind: "Offer",
          label: `Offer ${event.action}`,
          detail: event.details,
        });
      }
    }
    for (const recommendation of visibleRecommendations) {
      entries.push({
        date: recommendation.date,
        kind: "Recommendation",
        label: `Recommended by ${recommendation.recommenderName} (${recommendation.recommenderType})`,
        detail: recommendation.notes,
      });
    }
    for (const recommendation of interviewRecommendations) {
      const vacancy = vacancies.find((item) => item.id === recommendation.vacancyId);
      const assessment = candidateScores.find(
        (score) => score.id === recommendation.assessmentScoreId,
      );
      entries.push({
        date: recommendation.createdAt,
        kind: "Interview Recommendation",
        label: `Recommended for ${vacancy?.title || "interview"}`,
        detail: assessment
          ? `Assessment ${assessment.overallScore}/100 - ${recommendation.reason}`
          : recommendation.reason,
      });
    }
    return entries.sort((a, b) => b.date.localeCompare(a.date));
  }, [
    candidate.applications,
    candidate.contacts,
    interviews,
    offers,
    visibleRecommendations,
    interviewRecommendations,
    candidateScores,
    vacancies,
  ]);

  const hrUsers = useMemo(
    () =>
      empService
        .getUsers(currentUser.getActorContext())
        .filter((u) => u.roles.includes("HR") || u.roles.includes("Super Admin")),
    [empService, currentUser],
  );
  const allOtherCandidates = useMemo(
    () =>
      candidateService
        .getCandidateRepository()
        .list()
        .filter((c) => c.id !== candidate.id && !c.mergedIntoId),
    [candidateService, candidate],
  );

  const [isReassignOpen, setIsReassignOpen] = useState(false);
  const [reassignTarget, setReassignTarget] = useState("");
  const submitReassign = async () => {
    if (!reassignTarget) return;
    try {
      await candidateService.reassignOwnerAsync(
        candidate.id,
        reassignTarget,
        currentUser.getActorContext(),
      );
      toast.success("Ownership reassigned");
      setIsReassignOpen(false);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reassign owner");
    }
  };

  const [isMergeOpen, setIsMergeOpen] = useState(false);
  const [mergeSearch, setMergeSearch] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const mergeCandidateOptions = useMemo(() => {
    if (!mergeSearch.trim()) return [];
    const q = mergeSearch.toLowerCase();
    return allOtherCandidates
      .filter((c) => `${c.firstName} ${c.lastName} ${c.email} ${c.phone}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [allOtherCandidates, mergeSearch]);
  const submitMerge = async () => {
    if (!mergeTargetId) return;
    try {
      await candidateService.mergeCandidatesAsync(
        candidate.id,
        mergeTargetId,
        currentUser.getActorContext(),
      );
      toast.success("Candidates merged");
      setIsMergeOpen(false);
      setMergeSearch("");
      setMergeTargetId("");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to merge candidates");
    }
  };

  const [isContactDialogOpen, setIsContactDialogOpen] = useState(false);
  const [isInterviewDialogOpen, setIsInterviewDialogOpen] = useState(false);
  const [isInterviewRecommendationOpen, setIsInterviewRecommendationOpen] = useState(false);
  const [interviewVacancyId, setInterviewVacancyId] = useState(
    candidate.applications[0]?.vacancyId || "",
  );
  const [isManualInterviewDialogOpen, setIsManualInterviewDialogOpen] = useState(false);
  const [isRecruitmentDialogOpen, setIsRecruitmentDialogOpen] = useState(false);

  const [selectedInterviewId, setSelectedInterviewId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedPanelUserId, setSelectedPanelUserId] = useState<string | null>(null);
  const [isScorecardOpen, setIsScorecardOpen] = useState(false);

  const form = useForm<z.infer<typeof contactFormSchema>>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      channel: "Phone",
      outcome: "Follow-up Required",
      vacancyId: "",
      occurredAt: new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16),
      notes: "",
      nextFollowUpDate: "",
    },
  });

  const recruitmentForm = useForm<z.infer<typeof recruitmentDetailsSchema>>({
    resolver: zodResolver(recruitmentDetailsSchema),
    defaultValues: {
      email: candidate.email,
      phone: candidate.phone,
      currentTitle: candidate.currentTitle || "",
      currentCompany: candidate.currentCompany || "",
      yearsOfExperience: candidate.yearsOfExperience,
      nationality: candidate.nationality || "",
      location: candidate.location,
      projectId: candidate.projectId || "",
      projectName: candidate.projectName || "",
      projectType: candidate.projectType || "",
      shortlistStatus: candidate.shortlistStatus || "",
      trackerStatus: candidate.trackerStatus || "",
      visaStatus: candidate.visaStatus,
      maritalStatus: candidate.maritalStatus,
      noticePeriod: candidate.noticePeriod || "",
      currentSalary: candidate.currentSalary || "",
      expectedSalary: candidate.expectedSalary || "",
      acceptedSalary: candidate.acceptedSalary || "",
      interviewDate: candidate.interviewDate || "",
      remarks: candidate.remarks || "",
    },
  });

  const [isRecDialogOpen, setIsRecDialogOpen] = useState(false);
  const recForm = useForm<z.infer<typeof recommendationFormSchema>>({
    resolver: zodResolver(recommendationFormSchema),
    defaultValues: {
      recommenderType: "Agency",
      recommenderName: "",
      recommenderEmail: "",
      recommenderCompany: "",
      recommenderPosition: "",
      recommenderPhone: "",
      relationship: "",
      notes: "",
      commercialTerms: "",
      vacancyId: "",
    },
  });

  const onSubmitContact = async (values: z.infer<typeof contactFormSchema>) => {
    try {
      const payload: Parameters<CandidateService["logContact"]>[0] = {
        candidateId: candidate.id,
        channel: values.channel,
        outcome: values.outcome,
        occurredAt: values.occurredAt,
        notes: values.notes,
      };
      if (values.vacancyId) payload.vacancyId = values.vacancyId;
      if (values.nextFollowUpDate) payload.nextFollowUpDate = values.nextFollowUpDate;

      await candidateService.logContactAsync(payload, currentUser.getActorContext());

      toast.success("Contact saved");
      setIsContactDialogOpen(false);
      form.reset();
      navigate({ to: `/staff/candidates/${candidate.id}`, hash: "contact", replace: true });
    } catch (error: unknown) {
      toast.error(errorMessage(error, "Failed to log contact"));
    }
  };

  const onSubmitRecruitmentDetails = async (values: z.infer<typeof recruitmentDetailsSchema>) => {
    try {
      await candidateService.updateCandidateDetailsAsync(
        candidate.id,
        {
          email: values.email,
          phone: values.phone,
          currentTitle: values.currentTitle || undefined,
          currentCompany: values.currentCompany || undefined,
          yearsOfExperience: values.yearsOfExperience,
          nationality: values.nationality || undefined,
          location: values.location,
          projectId: values.projectId || undefined,
          projectName: values.projectName || undefined,
          projectType: values.projectType || undefined,
          shortlistStatus: values.shortlistStatus || undefined,
          trackerStatus: values.trackerStatus || undefined,
          visaStatus: values.visaStatus,
          maritalStatus: values.maritalStatus,
          noticePeriod: values.noticePeriod || undefined,
          currentSalary: values.currentSalary || undefined,
          expectedSalary: values.expectedSalary || undefined,
          acceptedSalary: values.acceptedSalary || undefined,
          interviewDate: values.interviewDate || undefined,
          remarks: values.remarks || undefined,
        },
        currentUser.getActorContext(),
      );

      toast.success("Recruitment details updated");
      setIsRecruitmentDialogOpen(false);
      navigate({ to: `/staff/candidates/${candidate.id}`, replace: true });
    } catch (error: unknown) {
      toast.error(errorMessage(error, "Failed to update recruitment details"));
    }
  };

  const onSubmitRecommendation = async (values: z.infer<typeof recommendationFormSchema>) => {
    try {
      await candidateService.addRecommendationAsync(
        {
          candidateId: candidate.id,
          vacancyId: values.vacancyId || undefined,
          recommenderType: values.recommenderType,
          recommenderName: values.recommenderName,
          recommenderCompany: values.recommenderCompany || undefined,
          recommenderPosition: values.recommenderPosition || undefined,
          recommenderEmail: values.recommenderEmail,
          recommenderPhone: values.recommenderPhone || undefined,
          relationship: values.relationship || undefined,
          date: new Date().toISOString(),
          notes: values.notes || "",
          hrOwnerId: currentUser.userId,
          commercialTerms: values.commercialTerms || undefined,
          sourceOutcome: candidate.stage,
        },
        currentUser.getActorContext(),
      );

      toast.success("Recommendation added");
      setIsRecDialogOpen(false);
      recForm.reset();
      navigate({ to: `/staff/candidates/${candidate.id}`, hash: "recommendations", replace: true });
    } catch {
      toast.error("Failed to save recommendation");
    }
  };

  const latestContact = candidate.contacts[0];
  const pendingFollowUp = latestContact?.nextFollowUpDate ? latestContact : undefined;
  const pendingByOther =
    pendingFollowUp && pendingFollowUp.contactedByUserId !== currentUser.userId;
  const recentlyContactedByOther =
    latestContact &&
    latestContact.contactedByUserId !== currentUser.userId &&
    Date.now() - new Date(latestContact.date).getTime() < 48 * 60 * 60 * 1000;

  const downloadCv = async (fileId: string) => {
    try {
      const { files } = getApplicationDataServices();
      const meta = await files.getMetadata(fileId);
      const blob = await files.getBlob(fileId);
      if (!meta || !blob) {
        toast.error("File not found");
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = meta.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast.error("Failed to download CV");
    }
  };

  const downloadCandidateCv = async (cvRecordId: string) => {
    try {
      const { metadata, blob } = await candidatePoolService.getCvFile(cvRecordId, {
        ...currentUser.getActorContext(),
        reason: "Downloaded a candidate CV from the Candidate Pool",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = metadata.name;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The CV could not be downloaded.");
    }
  };

  const confirmCvExtraction = (cvRecordId: string) => {
    try {
      candidatePoolService.confirmCandidateCvExtraction(cvRecordId, {
        ...currentUser.getActorContext(),
        reason: "Reviewed and confirmed CV-extracted candidate information",
      });
      toast.success("CV information confirmed and added to the Candidate Pool profile.");
      refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The CV information could not be confirmed.",
      );
    }
  };

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary">
            {candidate.firstName.charAt(0)}
            {candidate.lastName.charAt(0)}
          </div>
          <div>
            <h1 className="font-display text-3xl font-semibold flex items-center gap-2">
              {candidate.firstName} {candidate.lastName}
              {candidate.doNotContact && <ShieldAlert className="h-5 w-5 text-destructive" />}
              {visibleRecommendations.length > 0 && (
                <Badge
                  variant="outline"
                  className="ml-2 bg-blue-500/10 text-blue-700 border-blue-200"
                >
                  Recommended
                </Badge>
              )}
            </h1>
            <p className="text-lg text-muted-foreground">
              {candidate.currentTitle || "Candidate"} at {candidate.currentCompany || "Unknown"}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {hasAcceptedOffer && !candidate.convertedToEmployeeId && (
            <Button asChild className="bg-emerald-600 hover:bg-emerald-700">
              <Link
                to="/staff/candidates/$candidateId/convert"
                params={{ candidateId: candidate.id }}
              >
                <UserPlus className="h-4 w-4 mr-2" /> Convert to Employee
              </Link>
            </Button>
          )}
          {(currentUser.activeRole === "HR" || currentUser.activeRole === "Super Admin") && (
            <>
              <Button variant="outline" onClick={() => setIsReassignOpen(true)}>
                Reassign Owner
              </Button>
              <Button variant="outline" onClick={() => setIsMergeOpen(true)}>
                Merge Duplicate
              </Button>
            </>
          )}
          <Button asChild variant="ghost" size="icon">
            <Link to="/staff/candidates">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
        <aside className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Canonical Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex items-center gap-3 text-muted-foreground">
                <Mail className="h-4 w-4" />
                <span
                  className={
                    candidate.doNotContact ? "line-through text-destructive" : "text-foreground"
                  }
                >
                  {candidate.email}
                </span>
              </div>
              <div className="flex items-center gap-3 text-muted-foreground">
                <Phone className="h-4 w-4" />
                <span
                  className={
                    candidate.doNotContact ? "line-through text-destructive" : "text-foreground"
                  }
                >
                  {candidate.phone}
                </span>
              </div>
              <div className="flex items-center gap-3 text-muted-foreground">
                <MapPin className="h-4 w-4" />
                <span className="text-foreground">{candidate.location}</span>
              </div>
              <div className="flex items-center gap-3 text-muted-foreground">
                <Building2 className="h-4 w-4" />
                <span className="text-foreground">
                  {candidate.yearsOfExperience} years experience
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Metadata</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <p className="text-muted-foreground mb-1">Global Stage</p>
                <Badge variant="outline">{candidate.stage}</Badge>
              </div>
              <div>
                <p className="text-muted-foreground mb-1">Source</p>
                <p className="font-medium">{candidate.source || "Unknown"}</p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1">Joined</p>
                <p className="font-medium">{new Date(candidate.createdAt).toLocaleDateString()}</p>
              </div>
            </CardContent>
          </Card>
        </aside>

        <div className="flex-1 min-w-0">
          <Tabs defaultValue="overview">
            <TabsList className="mb-4 flex-wrap w-full justify-start h-auto">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="applications">
                Applications ({candidate.applications.length})
              </TabsTrigger>
              <TabsTrigger value="documents">CV / Documents</TabsTrigger>
              <TabsTrigger value="contact">Contact History</TabsTrigger>
              <TabsTrigger value="interviews">Interviews ({interviews.length})</TabsTrigger>
              <TabsTrigger value="offers">Offers ({offers.length})</TabsTrigger>
              <TabsTrigger value="recommendations">Recommendations</TabsTrigger>
              <TabsTrigger value="scores">AI Scores</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="audit">Audit Log</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {candidate.firstName} is currently in the <strong>{candidate.stage}</strong>{" "}
                    stage. They have <strong>{candidate.yearsOfExperience}</strong> years of
                    experience.
                  </p>
                  {candidate.doNotContact && (
                    <div className="mt-4 p-4 border border-destructive/50 bg-destructive/10 rounded-md flex items-start gap-3">
                      <ShieldAlert className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-destructive text-sm">Do Not Contact</p>
                        <p className="text-sm text-destructive/80 mt-1">
                          This candidate has been marked as Do Not Contact. Ensure you comply with
                          internal HR policies before overriding.
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Candidate Pool Profile</CardTitle>
                  <CardDescription>
                    Confirmed information used to find this candidate for suitable opportunities.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-5 sm:grid-cols-2">
                  <ProfileList label="Skills" values={candidate.skills} />
                  <ProfileList label="Languages" values={candidate.languages} />
                  <ProfileList label="Education" values={candidate.education} />
                  <ProfileList label="Certifications" values={candidate.certifications} />
                  <ProfileList label="Talent Pools" values={candidate.talentPools} />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Availability & work eligibility
                    </p>
                    <p className="mt-1 text-sm font-medium">
                      {[candidate.availability, candidate.workEligibility]
                        .filter(Boolean)
                        .join(" / ") || "Not recorded"}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <CardTitle>Recruitment Details</CardTitle>
                  <Dialog open={isRecruitmentDialogOpen} onOpenChange={setIsRecruitmentDialogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        Edit
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
                      <DialogHeader>
                        <DialogTitle>Edit HR Candidate Record</DialogTitle>
                      </DialogHeader>
                      <Form {...recruitmentForm}>
                        <form
                          onSubmit={recruitmentForm.handleSubmit(onSubmitRecruitmentDetails)}
                          className="space-y-4"
                        >
                          <div className="grid gap-4 sm:grid-cols-2">
                            <FormField
                              control={recruitmentForm.control}
                              name="email"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Email</FormLabel>
                                  <FormControl>
                                    <Input type="email" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={recruitmentForm.control}
                              name="phone"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Contact Number</FormLabel>
                                  <FormControl>
                                    <Input type="tel" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={recruitmentForm.control}
                              name="currentTitle"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Position</FormLabel>
                                  <FormControl>
                                    <Input placeholder="e.g. Senior Architect" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={recruitmentForm.control}
                              name="currentCompany"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Company</FormLabel>
                                  <FormControl>
                                    <Input placeholder="Current company" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={recruitmentForm.control}
                              name="yearsOfExperience"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Experience (Years)</FormLabel>
                                  <FormControl>
                                    <Input type="number" min="0" step="0.5" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={recruitmentForm.control}
                              name="nationality"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Nationality</FormLabel>
                                  <FormControl>
                                    <Input {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={recruitmentForm.control}
                              name="location"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Location</FormLabel>
                                  <FormControl>
                                    <Input {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={recruitmentForm.control}
                              name="shortlistStatus"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Shortlisted</FormLabel>
                                  <FormControl>
                                    <Input placeholder="HR shortlist marker" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={recruitmentForm.control}
                              name="trackerStatus"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>HR Tracker Status</FormLabel>
                                  <FormControl>
                                    <Input placeholder="Current HR status" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={recruitmentForm.control}
                              name="projectName"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Project Name</FormLabel>
                                  <FormControl>
                                    <Input placeholder="As recorded by HR" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={recruitmentForm.control}
                              name="projectType"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Project Type</FormLabel>
                                  <FormControl>
                                    <Input placeholder="e.g. Design" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                          <FormField
                            control={recruitmentForm.control}
                            name="projectId"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Project</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value ?? ""}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select a project" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {projects.map((p) => (
                                      <SelectItem key={p.id} value={p.id}>
                                        {p.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={recruitmentForm.control}
                            name="visaStatus"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Visa Status</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value ?? ""}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select visa status" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {VISA_STATUS_OPTIONS.map((v) => (
                                      <SelectItem key={v} value={v}>
                                        {v}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={recruitmentForm.control}
                            name="maritalStatus"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Marital / Family Status</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value ?? ""}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select status" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {MARITAL_STATUS_OPTIONS.map((v) => (
                                      <SelectItem key={v} value={v}>
                                        {v}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={recruitmentForm.control}
                            name="noticePeriod"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Notice Period</FormLabel>
                                <FormControl>
                                  <Input placeholder="e.g. 1 month, 2 weeks" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <div className="grid grid-cols-3 gap-3">
                            <FormField
                              control={recruitmentForm.control}
                              name="currentSalary"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Current</FormLabel>
                                  <FormControl>
                                    <Input placeholder="OMR" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={recruitmentForm.control}
                              name="expectedSalary"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Expected</FormLabel>
                                  <FormControl>
                                    <Input placeholder="OMR" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={recruitmentForm.control}
                              name="acceptedSalary"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Accepted</FormLabel>
                                  <FormControl>
                                    <Input placeholder="OMR" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                          <FormField
                            control={recruitmentForm.control}
                            name="interviewDate"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Interview Date</FormLabel>
                                <FormControl>
                                  <Input placeholder="Date recorded in HR tracker" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={recruitmentForm.control}
                            name="remarks"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>HR Remarks</FormLabel>
                                <FormControl>
                                  <Textarea
                                    rows={4}
                                    placeholder="Candidate-specific notes from HR"
                                    {...field}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <Button type="submit" className="w-full">
                            Save candidate record
                          </Button>
                        </form>
                      </Form>
                    </DialogContent>
                  </Dialog>
                </CardHeader>
                <CardContent className="grid gap-x-6 gap-y-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <span className="text-muted-foreground block mb-1">Project</span>
                    <span className="font-medium">
                      {currentProject?.name || candidate.projectName || "Not assigned"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">Project Type</span>
                    <span className="font-medium">{candidate.projectType || "Not specified"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">HR Tracker Status</span>
                    <span className="font-medium">
                      {candidate.trackerStatus || "Not specified"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">Shortlisted</span>
                    <span className="font-medium">
                      {candidate.shortlistStatus || "Not specified"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">Company</span>
                    <span className="font-medium">
                      {candidate.currentCompany || "Not specified"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">Experience</span>
                    <span className="font-medium">{candidate.yearsOfExperience} years</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">Nationality</span>
                    <span className="font-medium">{candidate.nationality || "Not specified"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">Location</span>
                    <span className="font-medium">{candidate.location}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">Visa Status</span>
                    <span className="font-medium">{candidate.visaStatus || "Not specified"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">
                      Marital / Family Status
                    </span>
                    <span className="font-medium">
                      {candidate.maritalStatus || "Not specified"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">Notice Period</span>
                    <span className="font-medium">{candidate.noticePeriod || "Not specified"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">Current Salary</span>
                    <span className="font-medium">{candidate.currentSalary || "—"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">Expected Salary</span>
                    <span className="font-medium">{candidate.expectedSalary || "—"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">Last Contacted</span>
                    <span className="font-medium">{candidate.lastContactAt || "Not recorded"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">Interview Date</span>
                    <span className="font-medium">{candidate.interviewDate || "Not recorded"}</span>
                  </div>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <span className="text-muted-foreground block mb-1">HR Remarks</span>
                    <p className="font-medium whitespace-pre-wrap">
                      {candidate.remarks || "No remarks recorded."}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">Accepted Salary</span>
                    <span className="font-medium">{candidate.acceptedSalary || "—"}</span>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="applications" className="space-y-4">
              {candidate.applications.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-muted-foreground">
                    No applications found.
                  </CardContent>
                </Card>
              ) : (
                candidate.applications.map((app) => {
                  const vacancy = vacancies.find((v) => v.id === app.vacancyId);
                  return (
                    <Card key={app.id}>
                      <CardHeader className="pb-3 flex flex-row items-start justify-between space-y-0">
                        <div>
                          <CardTitle className="text-lg">
                            {vacancy?.title || "Unknown Role"}
                          </CardTitle>
                          <CardDescription>
                            Applied on {new Date(app.createdAt).toLocaleDateString()}
                          </CardDescription>
                        </div>
                        <Badge>{app.status}</Badge>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                          <div>
                            <span className="text-muted-foreground block mb-1">Reference</span>
                            <span className="font-mono font-medium">{app.referenceId}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block mb-1">Notice Period</span>
                            <span className="font-medium">{app.noticePeriod}</span>
                          </div>
                        </div>
                        <Button variant="outline" size="sm" asChild>
                          <Link
                            to="/staff/vacancies/$vacancyId"
                            params={{ vacancyId: app.vacancyId }}
                          >
                            View Vacancy
                          </Link>
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </TabsContent>

            <TabsContent value="documents" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>CV History</CardTitle>
                  <CardDescription>
                    Every submitted or directly received CV remains connected to this person.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {cvRecords.map((record) => (
                      <div
                        key={record.id}
                        className="flex items-center justify-between p-3 border rounded-lg bg-muted/30"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-primary/10 rounded text-primary">
                            <FileText className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">{record.originalFileName}</p>
                            <p className="text-xs text-muted-foreground">
                              {record.source} · Received{" "}
                              {new Date(record.receivedAt).toLocaleDateString()} ·{" "}
                              {record.processingStatus}
                            </p>
                            {record.extractedFields.skills &&
                              record.extractedFields.skills.length > 0 && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Proposed skills: {record.extractedFields.skills.join(", ")}
                                </p>
                              )}
                          </div>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                          {record.processingStatus === "Awaiting HR Review" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => confirmCvExtraction(record.id)}
                            >
                              Confirm Information
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void downloadCandidateCv(record.id)}
                          >
                            <ArrowLeft className="mr-2 h-4 w-4 rotate-[270deg]" /> Download
                          </Button>
                        </div>
                      </div>
                    ))}
                    {cvRecords.length === 0 &&
                      candidate.applications.map((app) => (
                        <div
                          key={app.cvFileId}
                          className="flex items-center justify-between p-3 border rounded-lg bg-muted/30"
                        >
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-primary/10 rounded text-primary">
                              <FileText className="h-5 w-5" />
                            </div>
                            <div>
                              <p className="text-sm font-medium">
                                Application CV ({app.referenceId})
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Legacy CV · Attached {new Date(app.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void downloadCv(app.cvFileId)}
                          >
                            <ArrowLeft className="mr-2 h-4 w-4 rotate-[270deg]" /> Download
                          </Button>
                        </div>
                      ))}
                    {cvRecords.length === 0 && candidate.applications.length === 0 && (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        No CV has been added for this candidate.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="contact" className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Contact History</h3>
                <Dialog open={isContactDialogOpen} onOpenChange={setIsContactDialogOpen}>
                  <DialogTrigger asChild>
                    <Button disabled={candidate.doNotContact}>
                      <Plus className="mr-2 h-4 w-4" /> Log Contact
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                      <DialogTitle>Log Contact Event</DialogTitle>
                    </DialogHeader>
                    <Form {...form}>
                      <form onSubmit={form.handleSubmit(onSubmitContact)} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name="channel"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Channel</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select channel" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {["Email", "Phone", "LinkedIn", "In-Person", "Other"].map(
                                      (ch) => (
                                        <SelectItem key={ch} value={ch}>
                                          {ch}
                                        </SelectItem>
                                      ),
                                    )}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="outcome"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Outcome</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select outcome" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {[
                                      "No Answer",
                                      "Interested",
                                      "Not Interested",
                                      "Follow-up Required",
                                      "Interview Arranged",
                                      "Unavailable",
                                      "Invalid Contact",
                                      "Do Not Contact",
                                    ].map((o) => (
                                      <SelectItem key={o} value={o}>
                                        {o}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="occurredAt"
                            render={({ field }) => (
                              <FormItem className="col-span-2">
                                <FormLabel>Contact Date and Time</FormLabel>
                                <FormControl>
                                  <Input type="datetime-local" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <FormField
                          control={form.control}
                          name="vacancyId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Related Vacancy (Optional)</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value || ""}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select vacancy..." />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="">None</SelectItem>
                                  {candidate.applications.map((app) => {
                                    const vac = vacancies.find((v) => v.id === app.vacancyId);
                                    return vac ? (
                                      <SelectItem key={vac.id} value={vac.id}>
                                        {vac.title}
                                      </SelectItem>
                                    ) : null;
                                  })}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="notes"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Notes</FormLabel>
                              <FormControl>
                                <Textarea {...field} placeholder="Summary of the conversation..." />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="nextFollowUpDate"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Next Follow-Up Date (Optional)</FormLabel>
                              <FormControl>
                                <Input type="date" {...field} value={field.value || ""} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <div className="flex justify-end pt-4">
                          <Button type="submit">Save Contact</Button>
                        </div>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </div>

              {pendingByOther && (
                <div className="mb-4 p-4 border border-amber-500/50 bg-amber-500/10 rounded-md flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-amber-700 text-sm">
                      Pending Follow-Up by Another User
                    </p>
                    <p className="text-sm text-amber-700/80 mt-1">
                      Another HR member has a follow-up scheduled for this candidate on{" "}
                      {new Date(pendingFollowUp.nextFollowUpDate!).toLocaleDateString()}. Coordinate
                      before contacting.
                    </p>
                  </div>
                </div>
              )}

              {recentlyContactedByOther && !pendingByOther && (
                <div className="mb-4 flex items-start gap-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-4">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                  <div>
                    <p className="text-sm font-semibold text-amber-700">
                      Recently Contacted by Another HR User
                    </p>
                    <p className="mt-1 text-sm text-amber-700/80">
                      This candidate was contacted on{" "}
                      {new Date(latestContact.date).toLocaleString()}. Review the notes before
                      reaching out again.
                    </p>
                  </div>
                </div>
              )}

              {candidate.contacts.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-muted-foreground">
                    No contact history recorded.
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {candidate.contacts.map((contact) => {
                    const vac = vacancies.find((v) => v.id === contact.vacancyId);
                    return (
                      <Card key={contact.id}>
                        <CardHeader className="pb-3 flex flex-row items-start justify-between space-y-0">
                          <div>
                            <CardTitle className="text-sm font-medium flex items-center gap-2">
                              {contact.channel === "Phone" && (
                                <Phone className="h-4 w-4 text-muted-foreground" />
                              )}
                              {contact.channel === "Email" && (
                                <Mail className="h-4 w-4 text-muted-foreground" />
                              )}
                              {contact.channel === "LinkedIn" && (
                                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                              )}
                              {contact.channel} - {contact.outcome}
                            </CardTitle>
                            <CardDescription>
                              {new Date(contact.date).toLocaleString()} by User{" "}
                              {contact.contactedByUserId.slice(0, 8)}
                            </CardDescription>
                          </div>
                          <Badge
                            variant={
                              contact.outcome === "Do Not Contact" ||
                              contact.outcome === "Invalid Contact"
                                ? "destructive"
                                : contact.outcome === "Interested" ||
                                    contact.outcome === "Interview Arranged"
                                  ? "default"
                                  : "secondary"
                            }
                          >
                            {contact.outcome}
                          </Badge>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-foreground whitespace-pre-wrap mb-3">
                            {contact.notes}
                          </p>
                          {(contact.vacancyId || contact.nextFollowUpDate) && (
                            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mt-4 pt-4 border-t">
                              {contact.vacancyId && vac && (
                                <span>
                                  <strong>Vacancy:</strong> {vac.title}
                                </span>
                              )}
                              {contact.nextFollowUpDate && (
                                <span>
                                  <strong>Next Follow-up:</strong>{" "}
                                  {new Date(contact.nextFollowUpDate).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="interviews" className="space-y-4">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-semibold">Interviews</h3>
                  <p className="text-sm text-muted-foreground">
                    Schedule through recruitment or record an interview that already happened.
                  </p>
                </div>
                {currentUser.can("recruitment:manage_interviews") && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setIsInterviewRecommendationOpen(true)}
                    >
                      <Sparkles className="mr-2 h-4 w-4" /> Recommend for Interview
                    </Button>
                    <Button variant="outline" onClick={() => setIsManualInterviewDialogOpen(true)}>
                      <FileText className="mr-2 h-4 w-4" /> Record Manual Interview
                    </Button>
                    <Button
                      onClick={() => {
                        setInterviewVacancyId(candidate.applications[0]?.vacancyId || "");
                        setIsInterviewDialogOpen(true);
                      }}
                      disabled={candidate.applications.length === 0}
                      title={
                        candidate.applications.length === 0
                          ? "Scheduled interviews require a vacancy application. Use Record Manual Interview."
                          : undefined
                      }
                    >
                      <Plus className="mr-2 h-4 w-4" /> Schedule Interview
                    </Button>
                  </div>
                )}
              </div>

              {interviewRecommendations.length > 0 && (
                <Card className="border-primary/20 bg-primary/5">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">HR Interview Recommendations</CardTitle>
                    <CardDescription>
                      Each recommendation is connected to the assessment used for that vacancy.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {interviewRecommendations.map((recommendation) => {
                      const vacancy = vacancies.find(
                        (item) => item.id === recommendation.vacancyId,
                      );
                      const assessment = candidateScores.find(
                        (score) => score.id === recommendation.assessmentScoreId,
                      );
                      return (
                        <div key={recommendation.id} className="rounded-lg border bg-card p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-medium">{vacancy?.title || "Vacancy"}</p>
                            <Badge variant="outline">{recommendation.status}</Badge>
                          </div>
                          <p className="mt-2 text-sm">{recommendation.reason}</p>
                          <p className="mt-2 text-xs text-muted-foreground">
                            {assessment
                              ? `Assessment: ${assessment.overallScore}/100 · ${
                                  recommendation.assessmentSource === "Existing Assessment"
                                    ? "Existing assessment used"
                                    : "Completed automatically"
                                } · `
                              : "Legacy recommendation · "}
                            {new Date(recommendation.createdAt).toLocaleString()}
                          </p>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              )}

              {interviews.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-muted-foreground">
                    No interviews scheduled.
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {interviews.map((interview) => {
                    const vac = vacancies.find((v) => v.id === interview.vacancyId);
                    const metrics = interview.templateId
                      ? scorecardService.calculateInterviewMetrics(
                          interview.id,
                          interview.panelUserIds,
                        )
                      : null;
                    return (
                      <Card key={interview.id}>
                        <CardHeader className="pb-3 flex flex-row items-start justify-between space-y-0">
                          <div>
                            <CardTitle className="text-lg flex items-center gap-2">
                              <Calendar className="h-5 w-5 text-muted-foreground" />
                              {interview.stageName}
                              {interview.source === "Manual / Offline" && (
                                <Badge variant="outline">Manual / Offline</Badge>
                              )}
                            </CardTitle>
                            <CardDescription className="mt-1">
                              {vac
                                ? `Vacancy: ${vac.title}`
                                : interview.positionTitle
                                  ? `Position: ${interview.positionTitle}`
                                  : "No vacancy linked"}{" "}
                              • {interview.durationMinutes} mins
                            </CardDescription>
                            {interview.source === "Manual / Offline" && interview.projectName && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Project: {interview.projectName}
                              </p>
                            )}
                          </div>
                          <Badge
                            variant={
                              interview.status === "Cancelled" || interview.status === "No Show"
                                ? "destructive"
                                : interview.status === "Completed"
                                  ? "default"
                                  : interview.status === "Scheduled"
                                    ? "secondary"
                                    : "outline"
                            }
                          >
                            {interview.status}
                          </Badge>
                        </CardHeader>
                        <CardContent>
                          <div className="text-sm space-y-2 mb-4">
                            <div className="flex gap-2">
                              <span className="font-medium">When:</span>
                              <span className="text-muted-foreground">
                                {interview.confirmedSlot
                                  ? `${new Date(interview.confirmedSlot.startTime).toLocaleString()} (${interview.confirmedSlot.timezone})`
                                  : "Pending Confirmation"}
                              </span>
                            </div>
                            <div className="flex gap-2">
                              <span className="font-medium">Location:</span>
                              <span className="text-muted-foreground">{interview.location}</span>
                            </div>
                            {interview.source === "Manual / Offline" && (
                              <div className="flex items-center gap-2">
                                <span className="font-medium">Outcome:</span>
                                <Badge variant="secondary">
                                  {interview.manualOutcome || "Pending"}
                                </Badge>
                              </div>
                            )}
                            {interview.notes && (
                              <div className="flex gap-2">
                                <span className="font-medium">Notes:</span>
                                <span className="text-muted-foreground">{interview.notes}</span>
                              </div>
                            )}
                          </div>

                          {interview.templateId && metrics && (
                            <div className="mt-4 pt-4 border-t space-y-3">
                              <div className="flex justify-between items-center">
                                <h4 className="font-semibold text-sm flex items-center gap-2">
                                  Scorecards ({metrics.completedCount}/{metrics.totalExpected}{" "}
                                  completed)
                                </h4>
                                {metrics.hasDisagreement && (
                                  <Badge
                                    variant="outline"
                                    className="text-amber-600 border-amber-300 bg-amber-50"
                                  >
                                    Disagreement Detected
                                  </Badge>
                                )}
                              </div>
                              <div className="flex gap-2 flex-wrap">
                                {interview.panelUserIds.map((uid) => (
                                  <Button
                                    key={uid}
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      setSelectedInterviewId(interview.id);
                                      setSelectedTemplateId(interview.templateId || null);
                                      setSelectedPanelUserId(uid);
                                      setIsScorecardOpen(true);
                                    }}
                                  >
                                    View User {uid.slice(0, 5)}'s Scorecard
                                  </Button>
                                ))}
                              </div>
                              <div className="text-xs text-muted-foreground mt-2">
                                Average Score: {metrics.averageScore.toFixed(1)} / 5
                              </div>
                            </div>
                          )}
                          {interview.source === "Manual / Offline" &&
                            currentUser.can("recruitment:manage_interviews") && (
                              <div className="mt-4 border-t pt-4">
                                <ManualInterviewActions
                                  interview={interview}
                                  candidate={candidate}
                                  onSuccess={refresh}
                                />
                              </div>
                            )}
                          <InterviewDispositionActions interview={interview} onSuccess={refresh} />
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="offers" className="space-y-4">
              {offers.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-muted-foreground">
                    No offers have been created for this candidate yet.
                  </CardContent>
                </Card>
              ) : (
                offers.map((offer) => {
                  const vacancy = vacancies.find((v) => v.id === offer.vacancyId);
                  return (
                    <Card key={offer.id}>
                      <CardHeader className="pb-3 flex flex-row items-start justify-between space-y-0">
                        <div>
                          <CardTitle className="text-lg">
                            {vacancy?.title || offer.position}
                          </CardTitle>
                          <CardDescription>
                            {offer.grade} - Start date {offer.startDate || "TBD"}
                          </CardDescription>
                        </div>
                        <Badge>{offer.status}</Badge>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                          <div>
                            <span className="text-muted-foreground block mb-1">Salary</span>
                            <span className="font-medium">
                              {offer.salary > 0
                                ? `${offer.salary.toLocaleString()} ${offer.currency}`
                                : "Restricted"}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block mb-1">
                              Response Deadline
                            </span>
                            <span className="font-medium">{offer.responseDeadline || "-"}</span>
                          </div>
                        </div>
                        <Button variant="outline" size="sm" asChild>
                          <Link
                            to="/staff/vacancies/$vacancyId"
                            params={{ vacancyId: offer.vacancyId }}
                          >
                            Manage in Vacancy
                          </Link>
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </TabsContent>

            <TabsContent value="activity" className="space-y-4">
              {activityTimeline.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-muted-foreground">
                    No recorded activity yet.
                  </CardContent>
                </Card>
              ) : (
                <div className="relative space-y-4 border-l pl-6">
                  {activityTimeline.map((entry, index) => (
                    <div key={`${entry.date}-${index}`} className="relative">
                      <div className="absolute -left-[29px] top-1 h-2.5 w-2.5 rounded-full bg-primary" />
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{entry.kind}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(entry.date).toLocaleString()}
                        </span>
                      </div>
                      <div className="font-medium text-sm mt-1">{entry.label}</div>
                      {entry.detail && (
                        <div className="text-sm text-muted-foreground">{entry.detail}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="recommendations" className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Recommendations</h3>
                <Dialog open={isRecDialogOpen} onOpenChange={setIsRecDialogOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="mr-2 h-4 w-4" /> Add Recommendation
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Add Recommendation Source</DialogTitle>
                    </DialogHeader>
                    <Form {...recForm}>
                      <form
                        onSubmit={recForm.handleSubmit(onSubmitRecommendation)}
                        className="space-y-4"
                      >
                        <div className="grid grid-cols-2 gap-4">
                          <FormField
                            control={recForm.control}
                            name="recommenderType"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Source Type</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select type" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="Agency">Agency</SelectItem>
                                    <SelectItem value="Employee Referral">
                                      Employee Referral
                                    </SelectItem>
                                    <SelectItem value="External Person">External Person</SelectItem>
                                    <SelectItem value="Client">Client</SelectItem>
                                    <SelectItem value="Supplier">Supplier</SelectItem>
                                    <SelectItem value="Company">Company</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={recForm.control}
                            name="vacancyId"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Related Vacancy (Optional)</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value || ""}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="None" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="">None</SelectItem>
                                    {candidate.applications.map((app) => {
                                      const vac = vacancies.find((v) => v.id === app.vacancyId);
                                      return vac ? (
                                        <SelectItem key={vac.id} value={vac.id}>
                                          {vac.title}
                                        </SelectItem>
                                      ) : null;
                                    })}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <FormField
                            control={recForm.control}
                            name="recommenderName"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Recommender Name</FormLabel>
                                <FormControl>
                                  <Input {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={recForm.control}
                            name="recommenderEmail"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Recommender Email</FormLabel>
                                <FormControl>
                                  <Input type="email" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <FormField
                            control={recForm.control}
                            name="recommenderCompany"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Company (Optional)</FormLabel>
                                <FormControl>
                                  <Input {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={recForm.control}
                            name="recommenderPosition"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Position (Optional)</FormLabel>
                                <FormControl>
                                  <Input {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <FormField
                            control={recForm.control}
                            name="recommenderPhone"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Recommender Phone</FormLabel>
                                <FormControl>
                                  <Input {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={recForm.control}
                            name="relationship"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Relationship (Optional)</FormLabel>
                                <FormControl>
                                  <Input {...field} placeholder="e.g. Former Manager" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <FormField
                          control={recForm.control}
                          name="notes"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Notes (Optional)</FormLabel>
                              <FormControl>
                                <Textarea {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {["HR", "Accounts", "Super Admin"].includes(currentUser.activeRole) && (
                          <FormField
                            control={recForm.control}
                            name="commercialTerms"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Commercial Terms (Accounts Only)</FormLabel>
                                <FormControl>
                                  <Textarea
                                    {...field}
                                    className="bg-amber-500/5 border-amber-500/20"
                                    placeholder="Fee structure, payment terms..."
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}

                        <div className="flex justify-end pt-4">
                          <Button type="submit">Add Recommendation</Button>
                        </div>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </div>

              {visibleRecommendations.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-muted-foreground">
                    No recommendations recorded.
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {visibleRecommendations.map((rec) => (
                    <Card key={rec.id}>
                      <CardHeader className="pb-3 flex flex-row items-start justify-between space-y-0">
                        <div>
                          <CardTitle className="text-sm font-medium flex items-center gap-2">
                            {rec.recommenderName}
                          </CardTitle>
                          <CardDescription>
                            {rec.recommenderType} • {new Date(rec.date).toLocaleDateString()}
                          </CardDescription>
                        </div>
                        {(rec.recommenderEmail || rec.recommenderPhone) && (
                          <Badge variant="outline">
                            {rec.recommenderEmail || rec.recommenderPhone}
                          </Badge>
                        )}
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 gap-y-2 text-sm mb-4">
                          {rec.recommenderCompany && (
                            <div>
                              <span className="text-muted-foreground">Company:</span>{" "}
                              {rec.recommenderCompany}
                            </div>
                          )}
                          {rec.recommenderPosition && (
                            <div>
                              <span className="text-muted-foreground">Position:</span>{" "}
                              {rec.recommenderPosition}
                            </div>
                          )}
                          {rec.recommenderPhone && (
                            <div>
                              <span className="text-muted-foreground">Phone:</span>{" "}
                              {rec.recommenderPhone}
                            </div>
                          )}
                          {rec.relationship && (
                            <div>
                              <span className="text-muted-foreground">Relationship:</span>{" "}
                              {rec.relationship}
                            </div>
                          )}
                        </div>
                        {rec.notes && (
                          <p className="text-sm border-t pt-3 whitespace-pre-wrap">{rec.notes}</p>
                        )}

                        {["HR", "Accounts", "Super Admin"].includes(currentUser.activeRole) &&
                          rec.commercialTerms && (
                            <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-md">
                              <p className="text-xs font-semibold text-amber-700 uppercase mb-1">
                                Commercial Terms (Restricted)
                              </p>
                              <p className="text-sm text-amber-900/80 whitespace-pre-wrap">
                                {rec.commercialTerms}
                              </p>
                            </div>
                          )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
            <TabsContent value="scores" className="space-y-4">
              {candidateScores.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-muted-foreground">
                    No AI score has been generated for this candidate yet. Scores are produced by
                    running a candidate scan against a specific vacancy from the Vacancies module.
                  </CardContent>
                </Card>
              ) : (
                candidateScores.map((run) => {
                  const vac = vacancies.find((v) => v.id === run.vacancyId);
                  return (
                    <Card key={run.id}>
                      <CardHeader className="flex flex-row items-start justify-between gap-4">
                        <div>
                          <CardTitle className="text-base">
                            {vac ? vac.title : "Vacancy no longer available"}
                          </CardTitle>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Scored {new Date(run.timestamp).toLocaleString()} · model{" "}
                            {run.modelRulesVersion}
                          </p>
                        </div>
                        <ScoreBadge score={run.overallScore} />
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                          {Object.entries(run.categoryScores).map(([category, score]) => (
                            <div key={category} className="rounded-md border p-2.5 text-center">
                              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                {category}
                              </p>
                              <p className="text-lg font-semibold tabular-nums">{score}</p>
                            </div>
                          ))}
                        </div>

                        {run.strengths.length > 0 && (
                          <div>
                            <p className="mb-1 text-xs font-semibold text-success">Strengths</p>
                            <ul className="list-inside list-disc text-sm text-muted-foreground">
                              {run.strengths.map((s, i) => (
                                <li key={i}>{s}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {run.risks.length > 0 && (
                          <div>
                            <p className="mb-1 text-xs font-semibold text-destructive">Risks</p>
                            <ul className="list-inside list-disc text-sm text-muted-foreground">
                              {run.risks.map((r, i) => (
                                <li key={i}>{r}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {run.missingData.length > 0 && (
                          <div>
                            <p className="mb-1 text-xs font-semibold text-warning">Missing Data</p>
                            <ul className="list-inside list-disc text-sm text-muted-foreground">
                              {run.missingData.map((m, i) => (
                                <li key={i}>{m}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {run.evidence && (
                          <div>
                            <p className="mb-1 text-xs font-semibold">Evidence</p>
                            <p className="text-sm text-muted-foreground">{run.evidence}</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </TabsContent>
            <TabsContent value="audit" className="min-h-[500px]">
              <AuditViewer entityId={candidate.id} entityType="candidate" />
            </TabsContent>
          </Tabs>
        </div>
      </div>
      <InterviewDialog
        open={isInterviewDialogOpen}
        onOpenChange={setIsInterviewDialogOpen}
        vacancyId={interviewVacancyId}
        candidateId={candidate.id}
        onSuccess={refresh}
      />
      <CandidateInterviewRecommendationDialog
        open={isInterviewRecommendationOpen}
        onOpenChange={setIsInterviewRecommendationOpen}
        candidate={candidate}
        onSuccess={() => {
          refresh();
        }}
      />
      <ManualInterviewDialog
        open={isManualInterviewDialogOpen}
        onOpenChange={setIsManualInterviewDialogOpen}
        candidateId={candidate.id}
        defaultPosition={candidate.currentTitle}
        defaultProject={currentProject?.name || candidate.projectName}
        onSuccess={refresh}
      />

      {selectedInterviewId && selectedTemplateId && selectedPanelUserId && (
        <ScorecardForm
          open={isScorecardOpen}
          onOpenChange={setIsScorecardOpen}
          interviewId={selectedInterviewId}
          templateId={selectedTemplateId}
          targetPanelUserId={selectedPanelUserId}
          onSuccess={refresh}
        />
      )}

      <Dialog open={isReassignOpen} onOpenChange={setIsReassignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reassign HR Owner</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>New owner</Label>
            <Select value={reassignTarget} onValueChange={setReassignTarget}>
              <SelectTrigger>
                <SelectValue placeholder="Select HR owner" />
              </SelectTrigger>
              <SelectContent>
                {hrUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsReassignOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!reassignTarget} onClick={submitReassign}>
              Reassign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isMergeOpen} onOpenChange={setIsMergeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge Duplicate Candidate</DialogTitle>
            <DialogDescription>
              Search for the duplicate record. All of its applications, contacts, interviews,
              offers, recommendations and scores move onto this profile, and the duplicate is
              archived with a pointer back to this record.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Search by name, email or phone</Label>
            <Input
              value={mergeSearch}
              onChange={(e) => {
                setMergeSearch(e.target.value);
                setMergeTargetId("");
              }}
              placeholder="Start typing to search candidates..."
            />
            {mergeCandidateOptions.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-md border divide-y">
                {mergeCandidateOptions.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setMergeTargetId(c.id)}
                    className={`w-full px-3 py-2 text-left text-sm hover:bg-muted/50 ${
                      mergeTargetId === c.id ? "bg-muted" : ""
                    }`}
                  >
                    <div className="font-medium">
                      {c.firstName} {c.lastName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {c.email} · {c.phone}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsMergeOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={!mergeTargetId} onClick={submitMerge}>
              Merge into this profile
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
