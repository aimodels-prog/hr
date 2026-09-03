import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, FileSearch, RotateCcw, Upload } from "lucide-react";

import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { CandidatePoolService } from "@/lib/data/candidate-pool-service";
import type { CandidateCvRecord, CandidateCvSource, RecommenderType } from "@/lib/data/types";
import { VacancyService } from "@/lib/data/vacancy-service";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/staff/candidates/intake")({
  component: CandidateIntakeRoute,
});

const SOURCES: CandidateCvSource[] = [
  "Direct Email",
  "WhatsApp",
  "Employee Referral",
  "Agency",
  "Walk-in",
  "HR Upload",
  "Other",
];

const RECOMMENDER_TYPES: RecommenderType[] = [
  "Employee Referral",
  "External Person",
  "Agency",
  "Client",
  "Supplier",
  "Company",
];

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function CandidateIntakeRoute() {
  return (
    <RequirePermission permission="recruitment:manage_candidates" resourceName="Candidate Intake">
      <CandidateIntakePage />
    </RequirePermission>
  );
}

function CandidateIntakePage() {
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
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

  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<CandidateCvSource>("Direct Email");
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10));
  const [vacancyId, setVacancyId] = useState("none");
  const [isRecommended, setIsRecommended] = useState(false);
  const [notes, setNotes] = useState("");
  const [recommenderType, setRecommenderType] = useState<RecommenderType>("Employee Referral");
  const [recommenderName, setRecommenderName] = useState("");
  const [recommenderCompany, setRecommenderCompany] = useState("");
  const [recommenderPosition, setRecommenderPosition] = useState("");
  const [recommenderRelationship, setRecommenderRelationship] = useState("");
  const [recommenderEmail, setRecommenderEmail] = useState("");
  const [recommenderPhone, setRecommenderPhone] = useState("");
  const [recommendationNotes, setRecommendationNotes] = useState("");
  const [commercialTerms, setCommercialTerms] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [intake, setIntake] = useState<CandidateCvRecord | null>(null);
  const [savedIntakes, setSavedIntakes] = useState(() =>
    poolService
      .getCvIntakes(currentUser.getActorContext())
      .filter((record) => !record.candidateId && !record.archivedAt),
  );

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [currentCompany, setCurrentCompany] = useState("");
  const [currentTitle, setCurrentTitle] = useState("");
  const [experience, setExperience] = useState("0");
  const [skills, setSkills] = useState("");
  const [education, setEducation] = useState("");
  const [certifications, setCertifications] = useState("");
  const [languages, setLanguages] = useState("");
  const [availability, setAvailability] = useState("");
  const [workEligibility, setWorkEligibility] = useState("");
  const [talentPools, setTalentPools] = useState("");
  const [candidateResolution, setCandidateResolution] = useState("new");
  const [isSaving, setIsSaving] = useState(false);

  const duplicateMatches = useMemo(
    () => (email || phone ? poolService.findPossibleMatches(email, phone) : []),
    [email, phone, poolService],
  );

  const refreshSavedIntakes = () => {
    setSavedIntakes(
      poolService
        .getCvIntakes(currentUser.getActorContext())
        .filter((record) => !record.candidateId && !record.archivedAt),
    );
  };

  const reviewSavedIntake = (record: CandidateCvRecord) => {
    const extracted = record.extractedFields;
    setIntake(record);
    setFile(null);
    setSource(record.source);
    setReceivedDate(record.receivedAt.slice(0, 10));
    setVacancyId(record.vacancyId || "none");
    setIsRecommended(Boolean(record.recommendationPending));
    setNotes(record.notes || "");
    setFirstName(extracted.firstName || "");
    setLastName(extracted.lastName || "");
    setEmail(extracted.email || "");
    setPhone(extracted.phone || "");
    setLocation(extracted.location || "");
    setCurrentCompany(extracted.currentCompany || "");
    setCurrentTitle(extracted.currentTitle || "");
    setExperience(String(extracted.yearsOfExperience ?? 0));
    setSkills((extracted.skills || []).join(", "));
    setEducation((extracted.education || []).join(", "));
    setCertifications((extracted.certifications || []).join(", "));
    setLanguages((extracted.languages || []).join(", "));
    setAvailability("");
    setWorkEligibility("");
    setTalentPools("");
    setCandidateResolution("new");
    setRecommenderType("Employee Referral");
    setRecommenderName("");
    setRecommenderCompany("");
    setRecommenderPosition("");
    setRecommenderRelationship("");
    setRecommenderEmail("");
    setRecommenderPhone("");
    setRecommendationNotes("");
    setCommercialTerms("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const startAnotherIntake = () => {
    setIntake(null);
    setFile(null);
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setLocation("");
    setCurrentCompany("");
    setCurrentTitle("");
    setExperience("0");
    setSkills("");
    setEducation("");
    setCertifications("");
    setLanguages("");
    setAvailability("");
    setWorkEligibility("");
    setTalentPools("");
    setCandidateResolution("new");
    setIsRecommended(false);
    setRecommenderType("Employee Referral");
    setRecommenderName("");
    setRecommenderCompany("");
    setRecommenderPosition("");
    setRecommenderRelationship("");
    setRecommenderEmail("");
    setRecommenderPhone("");
    setRecommendationNotes("");
    setCommercialTerms("");
  };

  const upload = async () => {
    if (!file) {
      toast.error("Choose a CV to upload");
      return;
    }
    setIsUploading(true);
    try {
      const record = await poolService.uploadDirectCv(
        {
          file,
          fileName: file.name,
          source,
          receivedAt:
            receivedDate === new Date().toISOString().slice(0, 10)
              ? new Date().toISOString()
              : `${receivedDate}T12:00:00`,
          consentStatus: "Confirmed",
          ...(vacancyId !== "none" ? { vacancyId } : {}),
          ...(notes.trim() ? { notes } : {}),
          ...(isRecommended ? { isRecommended: true } : {}),
        },
        { ...currentUser.getActorContext(), reason: `Received CV through ${source}` },
      );
      setIntake(record);
      const extracted = record.extractedFields;
      setFirstName(extracted.firstName || "");
      setLastName(extracted.lastName || "");
      setEmail(extracted.email || "");
      setPhone(extracted.phone || "");
      setLocation(extracted.location || "");
      setCurrentCompany(extracted.currentCompany || "");
      setCurrentTitle(extracted.currentTitle || "");
      setExperience(String(extracted.yearsOfExperience ?? 0));
      setSkills((extracted.skills || []).join(", "));
      setEducation((extracted.education || []).join(", "));
      setCertifications((extracted.certifications || []).join(", "));
      setLanguages((extracted.languages || []).join(", "));
      refreshSavedIntakes();
      toast.success("CV saved. Review the extracted information before adding the candidate.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The CV could not be uploaded.");
    } finally {
      setIsUploading(false);
    }
  };

  const saveCandidate = async () => {
    if (!intake) return;
    if (duplicateMatches.length > 0 && candidateResolution === "new") {
      toast.error("Review the possible existing candidate before creating a separate profile.");
      return;
    }
    setIsSaving(true);
    try {
      const result = await poolService.finaliseCvIntake(
        {
          cvRecordId: intake.id,
          ...(candidateResolution.startsWith("existing:")
            ? { existingCandidateId: candidateResolution.slice("existing:".length) }
            : {}),
          ...(candidateResolution === "new-separate" ? { forceCreateNew: true } : {}),
          candidate: {
            firstName,
            lastName,
            email,
            phone,
            location,
            currentCompany,
            currentTitle,
            yearsOfExperience: Number(experience),
            skills: splitList(skills),
            education: splitList(education),
            certifications: splitList(certifications),
            languages: splitList(languages),
            availability,
            workEligibility,
            talentPools: splitList(talentPools),
          },
          ...(vacancyId !== "none" ? { vacancyId } : {}),
          consentStatus: "Confirmed",
        },
        { ...currentUser.getActorContext(), reason: "Confirmed a directly received CV" },
      );
      toast.success(
        result.application
          ? "Candidate and vacancy application created"
          : "Candidate added to the Candidate Pool",
      );
      void navigate({ to: `/staff/candidates/${result.candidate.id}` });
    } catch (error) {
      toast.error(
        error instanceof Error && error.message === "DUPLICATE_CANDIDATE_MATCH_FOUND"
          ? "A matching candidate already exists. Select that profile or confirm a separate person."
          : error instanceof Error
            ? error.message
            : "The candidate could not be saved.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const saveRecommendedCandidate = async () => {
    if (!intake || vacancyId === "none") return;
    if (duplicateMatches.length > 0 && candidateResolution === "new") {
      toast.error("Review the possible existing candidate before creating a separate profile.");
      return;
    }
    if (!recommenderName.trim()) {
      toast.error("Enter the name of the person who recommended this candidate.");
      return;
    }
    if (!recommenderEmail.trim() && !recommenderPhone.trim()) {
      toast.error("Enter the recommender's email or phone number.");
      return;
    }
    if (recommenderEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recommenderEmail.trim())) {
      toast.error("Enter a valid recommender email address.");
      return;
    }
    setIsSaving(true);
    try {
      const result = await poolService.finaliseRecommendedCvIntake(
        {
          cvRecordId: intake.id,
          ...(candidateResolution.startsWith("existing:")
            ? { existingCandidateId: candidateResolution.slice("existing:".length) }
            : {}),
          ...(candidateResolution === "new-separate" ? { forceCreateNew: true } : {}),
          candidate: {
            firstName,
            lastName,
            email,
            phone,
            location,
            currentCompany,
            currentTitle,
            yearsOfExperience: Number(experience),
            skills: splitList(skills),
            education: splitList(education),
            certifications: splitList(certifications),
            languages: splitList(languages),
            availability,
            workEligibility,
            talentPools: splitList(talentPools),
          },
          vacancyId,
          consentStatus: "Confirmed",
        },
        {
          recommenderType,
          recommenderName: recommenderName.trim(),
          ...(recommenderCompany.trim() ? { recommenderCompany: recommenderCompany.trim() } : {}),
          ...(recommenderPosition.trim()
            ? { recommenderPosition: recommenderPosition.trim() }
            : {}),
          recommenderEmail: recommenderEmail.trim(),
          ...(recommenderPhone.trim() ? { recommenderPhone: recommenderPhone.trim() } : {}),
          ...(recommenderRelationship.trim()
            ? { relationship: recommenderRelationship.trim() }
            : {}),
          date: new Date().toISOString(),
          notes: recommendationNotes.trim(),
          hrOwnerId: currentUser.userId,
          ...(commercialTerms.trim() ? { commercialTerms: commercialTerms.trim() } : {}),
          sourceOutcome: "Sourced",
        },
        {
          ...currentUser.getActorContext(),
          reason: `Recorded recommendation from ${recommenderName.trim()}`,
        },
      );
      toast.success("Candidate, CV and recommender added to vacancy screening");
      void navigate({
        to: "/staff/candidates/$candidateId",
        params: { candidateId: result.candidate.id },
        hash: "recommendations",
      });
    } catch (error) {
      toast.error(
        error instanceof Error && error.message === "DUPLICATE_CANDIDATE_MATCH_FOUND"
          ? "A matching candidate already exists. Select that profile or confirm a separate person."
          : error instanceof Error
            ? error.message
            : "The recommended candidate could not be saved.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <PageHeader
        title="Add a CV to the Candidate Pool"
        description="Save a directly received CV, review the extracted details and connect the person to a vacancy or future talent pool."
      />

      {savedIntakes.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>CVs waiting for review</CardTitle>
            <CardDescription>
              Uploaded CVs remain here after refresh until HR confirms the candidate profile.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {savedIntakes.map((record) => (
              <div
                key={record.id}
                className="flex items-center justify-between gap-4 rounded-lg border bg-background p-4"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{record.originalFileName}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {record.source} · {new Date(record.receivedAt).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  type="button"
                  variant={intake?.id === record.id ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => reviewSavedIntake(record)}
                >
                  {intake?.id === record.id ? "Reviewing" : "Continue review"}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>1. CV and vacancy details</CardTitle>
            <CardDescription>
              Add the original CV and record how it reached VIA before preparing the candidate
              profile.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="candidate-cv">CV file</Label>
              <Input
                id="candidate-cv"
                type="file"
                accept=".pdf,.doc,.docx"
                disabled={Boolean(intake)}
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
              <p className="text-xs text-muted-foreground">PDF, Word or text, up to 10 MB.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>How it was received</Label>
                <Select
                  value={source}
                  onValueChange={(value) => setSource(value as CandidateCvSource)}
                  disabled={Boolean(intake)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="received-date">Date received</Label>
                <Input
                  id="received-date"
                  type="date"
                  max={new Date().toISOString().slice(0, 10)}
                  value={receivedDate}
                  onChange={(event) => setReceivedDate(event.target.value)}
                  disabled={Boolean(intake)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Was this candidate recommended to VIA?</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={!isRecommended ? "secondary" : "outline"}
                  onClick={() => setIsRecommended(false)}
                  disabled={Boolean(intake)}
                >
                  No, general CV
                </Button>
                <Button
                  type="button"
                  variant={isRecommended ? "secondary" : "outline"}
                  onClick={() => setIsRecommended(true)}
                  disabled={Boolean(intake)}
                >
                  Yes, recommended
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Choose Yes to record who introduced the candidate on this page.
              </p>
              {isRecommended && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                  <p className="font-medium text-foreground">Recommender details required</p>
                  <p className="mt-1 text-muted-foreground">
                    Complete the recommender section below. VIA will save the candidate, CV, vacancy
                    and recommender together.
                  </p>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>Vacancy</Label>
              <Select value={vacancyId} onValueChange={setVacancyId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Candidate Pool only</SelectItem>
                  {vacancies.map((vacancy) => (
                    <SelectItem key={vacancy.id} value={vacancy.id}>
                      {vacancy.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isRecommended && vacancyId === "none" && (
                <p className="text-xs text-amber-700">
                  Select the vacancy this person was recommended for.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="intake-notes">Source notes</Label>
              <Textarea
                id="intake-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Sender, email subject, recommender or other useful context"
                disabled={Boolean(intake)}
              />
            </div>
            {!isRecommended && (
              <Button
                className="w-full"
                onClick={() => void upload()}
                disabled={!file || isUploading || Boolean(intake)}
              >
                <Upload className="mr-2 h-4 w-4" />{" "}
                {isUploading
                  ? "Uploading and preparing details..."
                  : intake
                    ? "CV uploaded"
                    : "Upload CV and prepare candidate details"}
              </Button>
            )}
          </CardContent>
        </Card>

        {isRecommended && (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>Who recommended this candidate?</CardTitle>
                  <CardDescription className="mt-1">
                    This information will appear in Recommendations and on the candidate's history.
                  </CardDescription>
                </div>
                <Badge>Recommended</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2">
                  <Label>Recommender type</Label>
                  <Select
                    value={recommenderType}
                    onValueChange={(value) => setRecommenderType(value as RecommenderType)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RECOMMENDER_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Field
                  label="Recommender name"
                  value={recommenderName}
                  onChange={setRecommenderName}
                  required
                />
                <Field
                  label="Company"
                  value={recommenderCompany}
                  onChange={setRecommenderCompany}
                />
                <Field
                  label="Position"
                  value={recommenderPosition}
                  onChange={setRecommenderPosition}
                />
                <Field
                  label="Relationship to candidate"
                  value={recommenderRelationship}
                  onChange={setRecommenderRelationship}
                  placeholder="Former manager, colleague, agency contact"
                />
                <div className="hidden lg:block" />
                <Field
                  label="Recommender email"
                  type="email"
                  value={recommenderEmail}
                  onChange={setRecommenderEmail}
                />
                <Field
                  label="Recommender phone"
                  value={recommenderPhone}
                  onChange={setRecommenderPhone}
                />
                <div className="flex items-end">
                  <p className="pb-2 text-xs text-muted-foreground">
                    Enter at least one reliable contact: email or phone number.
                  </p>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="candidate-intake-recommendation-notes">
                    Recommendation notes
                  </Label>
                  <Textarea
                    id="candidate-intake-recommendation-notes"
                    value={recommendationNotes}
                    onChange={(event) => setRecommendationNotes(event.target.value)}
                    placeholder="Why the person was recommended and any useful context"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="candidate-intake-commercial-terms">
                    Agency or commercial terms (if any)
                  </Label>
                  <Textarea
                    id="candidate-intake-commercial-terms"
                    value={commercialTerms}
                    onChange={(event) => setCommercialTerms(event.target.value)}
                    placeholder="Fee or payment terms. Leave blank when not applicable."
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Next, VIA will prepare the candidate details from the CV for HR to review.
                </p>
                <Button
                  onClick={() => void upload()}
                  disabled={
                    !file ||
                    isUploading ||
                    Boolean(intake) ||
                    vacancyId === "none" ||
                    !recommenderName.trim() ||
                    (!recommenderEmail.trim() && !recommenderPhone.trim())
                  }
                >
                  <Upload className="mr-2 h-4 w-4" />
                  {isUploading
                    ? "Uploading and preparing details..."
                    : intake
                      ? "CV uploaded"
                      : "Upload CV and prepare candidate details"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className={!intake ? "opacity-70" : undefined}>
          <CardHeader>
            <CardTitle>2. Confirm the candidate profile</CardTitle>
            <CardDescription>
              Only confirmed values are added to the Candidate Pool.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {!intake ? (
              <div className="flex min-h-64 flex-col items-center justify-center text-center text-muted-foreground">
                <FileSearch className="mb-3 h-10 w-10" />
                <p className="font-medium text-foreground">Upload the CV first</p>
                <p className="mt-1 max-w-sm text-sm">
                  The extracted information and any processing warnings will appear here for HR
                  review.
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{intake.processingStatus}</Badge>
                  <Badge variant="secondary">{intake.extractionMethod}</Badge>
                  {intake.recommendationPending && <Badge>Recommended</Badge>}
                  <span className="text-xs text-muted-foreground">{intake.originalFileName}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    onClick={startAnotherIntake}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" /> Start another
                  </Button>
                </div>
                {intake.extractionWarnings.map((warning) => (
                  <Alert key={warning}>
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Review needed</AlertTitle>
                    <AlertDescription>{warning}</AlertDescription>
                  </Alert>
                ))}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="First name" value={firstName} onChange={setFirstName} required />
                  <Field label="Last name" value={lastName} onChange={setLastName} required />
                  <Field label="Email" type="email" value={email} onChange={setEmail} required />
                  <Field label="Phone" value={phone} onChange={setPhone} required />
                  <Field label="Location" value={location} onChange={setLocation} required />
                  <Field
                    label="Years of experience"
                    type="number"
                    value={experience}
                    onChange={setExperience}
                  />
                  <Field label="Current position" value={currentTitle} onChange={setCurrentTitle} />
                  <Field
                    label="Current company"
                    value={currentCompany}
                    onChange={setCurrentCompany}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Skills"
                    value={skills}
                    onChange={setSkills}
                    placeholder="Logistics, Excel, SAP"
                  />
                  <Field
                    label="Languages"
                    value={languages}
                    onChange={setLanguages}
                    placeholder="English, Arabic"
                  />
                  <Field
                    label="Education"
                    value={education}
                    onChange={setEducation}
                    placeholder="Degree or qualification"
                  />
                  <Field
                    label="Certifications"
                    value={certifications}
                    onChange={setCertifications}
                    placeholder="PMP, NEBOSH"
                  />
                  <Field
                    label="Availability"
                    value={availability}
                    onChange={setAvailability}
                    placeholder="Immediate, 30 days"
                  />
                  <Field
                    label="Work eligibility"
                    value={workEligibility}
                    onChange={setWorkEligibility}
                    placeholder="Own visa, sponsorship required"
                  />
                </div>
                <Field
                  label="Talent pools"
                  value={talentPools}
                  onChange={setTalentPools}
                  placeholder="Operations, Logistics, Future Opportunities"
                />

                {duplicateMatches.length > 0 && (
                  <Alert className="border-amber-300 bg-amber-50">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Possible existing candidate</AlertTitle>
                    <AlertDescription>
                      Select the existing person unless you have confirmed this is someone else.
                    </AlertDescription>
                  </Alert>
                )}
                <div className="space-y-2">
                  <Label>Candidate record</Label>
                  <Select value={candidateResolution} onValueChange={setCandidateResolution}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {duplicateMatches.length === 0 && (
                        <SelectItem value="new">Create a new candidate profile</SelectItem>
                      )}
                      {duplicateMatches.map((candidate) => (
                        <SelectItem key={candidate.id} value={`existing:${candidate.id}`}>
                          Use {candidate.firstName} {candidate.lastName} · {candidate.email}
                        </SelectItem>
                      ))}
                      {duplicateMatches.length > 0 && (
                        <SelectItem value="new-separate">
                          Confirmed different person · create separately
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                {intake.recommendationPending ? (
                  vacancyId === "none" ? (
                    <Button className="w-full" disabled>
                      Select a vacancy to save this recommendation
                    </Button>
                  ) : (
                    <Button
                      className="w-full"
                      onClick={() => void saveRecommendedCandidate()}
                      disabled={
                        isSaving ||
                        !firstName ||
                        !lastName ||
                        !email ||
                        !phone ||
                        !location ||
                        !recommenderName.trim() ||
                        (!recommenderEmail.trim() && !recommenderPhone.trim())
                      }
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      {isSaving
                        ? "Saving candidate and recommendation..."
                        : "Add candidate and recommendation"}
                    </Button>
                  )
                ) : (
                  <Button
                    className="w-full"
                    onClick={saveCandidate}
                    disabled={isSaving || !firstName || !lastName || !email || !phone || !location}
                  >
                    <CheckCircle2 className="mr-2 h-4 w-4" />{" "}
                    {isSaving
                      ? "Adding candidate..."
                      : vacancyId === "none"
                        ? "Add to Candidate Pool"
                        : "Add candidate and application"}
                  </Button>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  const id = `candidate-intake-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label}
        {required ? " *" : ""}
      </Label>
      <Input
        id={id}
        type={type}
        min={type === "number" ? 0 : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
      />
    </div>
  );
}
