import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { UserPlus } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { CandidateService } from "@/lib/data/candidate-service";
import { CandidatePoolService } from "@/lib/data/candidate-pool-service";
import { VacancyService } from "@/lib/data/vacancy-service";
import type { Candidate, CandidateCvRecord } from "@/lib/data/types";
import { toast } from "sonner";

export const Route = createFileRoute("/staff/candidates/recommend")({
  validateSearch: (search: Record<string, unknown>) =>
    typeof search["cvIntakeId"] === "string" ? { cvIntakeId: search["cvIntakeId"] } : {},
  component: RecommendCandidateWrapper,
});

function RecommendCandidateWrapper() {
  return (
    <RequirePermission
      permission="recruitment:manage_candidates"
      resourceName="Add Recommended Candidate"
    >
      <RecommendCandidate />
    </RequirePermission>
  );
}

const formSchema = z
  .object({
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    email: z.string().email("Invalid email"),
    phone: z.string().min(1, "Phone is required"),
    location: z.string().min(1, "Location is required"),
    currentCompany: z.string().optional(),
    currentTitle: z.string().optional(),
    yearsOfExperience: z.coerce.number().min(0, "Must be zero or more"),
    recommenderType: z.enum([
      "Agency",
      "Employee Referral",
      "External Person",
      "Client",
      "Supplier",
      "Company",
    ]),
    recommenderName: z.string().min(1, "Recommender name is required"),
    recommenderCompany: z.string().optional(),
    recommenderPosition: z.string().optional(),
    recommenderEmail: z.union([z.literal(""), z.string().email("Enter a valid email")]),
    recommenderPhone: z.string().optional(),
    relationship: z.string().optional(),
    notes: z.string().optional(),
    commercialTerms: z.string().optional(),
    vacancyId: z.string().min(1, "Select the vacancy"),
  })
  .refine((values) => values.recommenderEmail.trim() || values.recommenderPhone?.trim(), {
    path: ["recommenderPhone"],
    message: "Enter the recommender's email or phone number",
  });

type FormValues = z.infer<typeof formSchema>;

function RecommendCandidate() {
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const { cvIntakeId } = Route.useSearch();
  const [candidateService] = useState(() => new CandidateService());
  const [poolService] = useState(() => new CandidatePoolService());
  const linkedIntake = useMemo(
    () =>
      cvIntakeId
        ? poolService.getCvIntakeById(cvIntakeId, currentUser.getActorContext())
        : undefined,
    [currentUser, cvIntakeId, poolService],
  );
  const vacancies = useMemo(
    () =>
      new VacancyService()
        .getVacancyRepository()
        .list()
        .filter((vacancy) => vacancy.status === "Open")
        .sort((a, b) => a.title.localeCompare(b.title)),
    [],
  );
  const [duplicates, setDuplicates] = useState<Candidate[] | null>(null);
  const [pendingValues, setPendingValues] = useState<FormValues | null>(null);
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [cvIntake, setCvIntake] = useState<CandidateCvRecord | null>(linkedIntake || null);
  const [readingCv, setReadingCv] = useState(false);
  const [saving, setSaving] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName: linkedIntake?.extractedFields.firstName || "",
      lastName: linkedIntake?.extractedFields.lastName || "",
      email: linkedIntake?.extractedFields.email || "",
      phone: linkedIntake?.extractedFields.phone || "",
      location: linkedIntake?.extractedFields.location || "",
      currentCompany: linkedIntake?.extractedFields.currentCompany || "",
      currentTitle: linkedIntake?.extractedFields.currentTitle || "",
      yearsOfExperience: linkedIntake?.extractedFields.yearsOfExperience || 0,
      recommenderType: "Employee Referral",
      recommenderName: "",
      recommenderCompany: "",
      recommenderPosition: "",
      recommenderEmail: "",
      recommenderPhone: "",
      relationship: "",
      notes: "",
      commercialTerms: "",
      vacancyId: linkedIntake?.vacancyId || "",
    },
  });

  const readCv = async (): Promise<CandidateCvRecord> => {
    if (cvIntake) return cvIntake;
    if (!cvFile) throw new Error("Upload the candidate's original CV.");
    setReadingCv(true);
    try {
      const recommenderType = form.getValues("recommenderType");
      const record = await poolService.uploadDirectCv(
        {
          file: cvFile,
          fileName: cvFile.name,
          source: recommenderType === "Agency" ? "Agency" : "Employee Referral",
          receivedAt: new Date().toISOString(),
          consentStatus: "Confirmed",
          ...(form.getValues("vacancyId") ? { vacancyId: form.getValues("vacancyId") } : {}),
          notes: "CV received with a candidate recommendation.",
          isRecommended: true,
        },
        { ...currentUser.getActorContext(), reason: "Uploaded a recommended candidate's CV" },
      );
      setCvIntake(record);
      const fields = record.extractedFields;
      if (fields.firstName) form.setValue("firstName", fields.firstName);
      if (fields.lastName) form.setValue("lastName", fields.lastName);
      if (fields.email) form.setValue("email", fields.email);
      if (fields.phone) form.setValue("phone", fields.phone);
      if (fields.location) form.setValue("location", fields.location);
      if (fields.currentCompany) form.setValue("currentCompany", fields.currentCompany);
      if (fields.currentTitle) form.setValue("currentTitle", fields.currentTitle);
      if (fields.yearsOfExperience !== undefined) {
        form.setValue("yearsOfExperience", fields.yearsOfExperience);
      }
      toast.success("CV prepared. Review the extracted details before continuing.");
      return record;
    } finally {
      setReadingCv(false);
    }
  };

  const submit = async (
    values: FormValues,
    linkToCandidateId?: string,
    forceCreateNew?: boolean,
  ) => {
    setSaving(true);
    try {
      const intake = await readCv();
      const context = currentUser.getActorContext();
      const result = await poolService.finaliseRecommendedCvIntake(
        {
          cvRecordId: intake.id,
          candidate: {
            firstName: values.firstName,
            lastName: values.lastName,
            email: values.email,
            phone: values.phone,
            location: values.location,
            ...(values.currentCompany ? { currentCompany: values.currentCompany } : {}),
            ...(values.currentTitle ? { currentTitle: values.currentTitle } : {}),
            yearsOfExperience: values.yearsOfExperience,
            ...(intake.extractedFields.skills ? { skills: intake.extractedFields.skills } : {}),
            ...(intake.extractedFields.education
              ? { education: intake.extractedFields.education }
              : {}),
            ...(intake.extractedFields.certifications
              ? { certifications: intake.extractedFields.certifications }
              : {}),
            ...(intake.extractedFields.languages
              ? { languages: intake.extractedFields.languages }
              : {}),
          },
          vacancyId: values.vacancyId,
          consentStatus: "Confirmed",
          ...(linkToCandidateId ? { existingCandidateId: linkToCandidateId } : {}),
          ...(forceCreateNew !== undefined ? { forceCreateNew } : {}),
        },
        {
          recommenderType: values.recommenderType,
          recommenderName: values.recommenderName,
          ...(values.recommenderCompany ? { recommenderCompany: values.recommenderCompany } : {}),
          ...(values.recommenderPosition
            ? { recommenderPosition: values.recommenderPosition }
            : {}),
          recommenderEmail: values.recommenderEmail,
          ...(values.recommenderPhone ? { recommenderPhone: values.recommenderPhone } : {}),
          ...(values.relationship ? { relationship: values.relationship } : {}),
          date: new Date().toISOString(),
          notes: values.notes || "",
          hrOwnerId: currentUser.userId,
          ...(values.commercialTerms ? { commercialTerms: values.commercialTerms } : {}),
          sourceOutcome: "Sourced",
        },
        context,
      );
      toast.success(
        linkToCandidateId
          ? "Recommendation and CV linked to the existing candidate"
          : "Candidate, CV and recommendation added to vacancy screening",
      );
      navigate({
        to: "/staff/candidates/$candidateId",
        params: { candidateId: result.candidate.id },
        hash: "recommendations",
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("DUPLICATE_CANDIDATE_MATCH_FOUND")) {
        setDuplicates(
          candidateService.findDuplicateCandidates(
            values.email,
            values.phone,
            currentUser.getActorContext(),
          ),
        );
        setPendingValues(values);
        return;
      }
      toast.error(error instanceof Error ? error.message : "Failed to save recommendation");
    } finally {
      setSaving(false);
    }
  };

  if (duplicates && pendingValues) {
    return (
      <div className="flex flex-col gap-6 max-w-3xl mx-auto pb-10">
        <PageHeader
          title="Possible Duplicate Found"
          description="This person may already be in the candidate database. Choose how to proceed."
        />
        <div className="space-y-3">
          {duplicates.map((candidate) => (
            <Card key={candidate.id}>
              <CardContent className="py-4 flex items-center justify-between">
                <div>
                  <div className="font-medium">
                    {candidate.firstName} {candidate.lastName}
                    <Badge variant="outline" className="ml-2">
                      {candidate.stage}
                    </Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {candidate.email} &middot; {candidate.phone}
                  </div>
                </div>
                <Button onClick={() => submit(pendingValues, candidate.id)}>
                  Link Recommendation Here
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="flex items-center justify-between border-t pt-4">
          <Button
            variant="ghost"
            onClick={() => {
              setDuplicates(null);
              setPendingValues(null);
            }}
          >
            Back to Form
          </Button>
          <Button variant="outline" onClick={() => submit(pendingValues, undefined, true)}>
            This Is a Different Person - Create New Candidate
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto pb-10">
      <PageHeader
        title="Add Recommended Candidate"
        description="Record a candidate someone has recommended, along with who recommended them."
      />
      <Form {...form}>
        <form onSubmit={form.handleSubmit((values) => submit(values))} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">CV & Vacancy</CardTitle>
              <CardDescription>
                Keep the original CV, prepare its information, and include this person in the same
                screening used for portal applicants.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="vacancyId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vacancy</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select the role" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {vacancies.map((vacancy) => (
                          <SelectItem key={vacancy.id} value={vacancy.id}>
                            {vacancy.title} · {vacancy.location}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="space-y-2">
                <FormLabel htmlFor="recommended-cv">Original CV</FormLabel>
                {cvIntake ? (
                  <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3">
                    <div>
                      <p className="text-sm font-medium">{cvIntake.originalFileName}</p>
                      <p className="text-xs text-muted-foreground">
                        CV already saved · complete the recommender details below
                      </p>
                    </div>
                    <Badge variant="outline">Saved</Badge>
                  </div>
                ) : (
                  <Input
                    id="recommended-cv"
                    type="file"
                    accept=".pdf,.doc,.docx"
                    onChange={(event) => {
                      setCvFile(event.target.files?.[0] || null);
                      setCvIntake(null);
                    }}
                  />
                )}
                <p className="text-xs text-muted-foreground">
                  The PDF or Word file is retained exactly as received. Text is read directly where
                  possible; scanned files are marked for OCR.
                </p>
              </div>
              {!cvIntake && (
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      readCv().catch((error) =>
                        toast.error(
                          error instanceof Error ? error.message : "CV could not be read.",
                        ),
                      )
                    }
                    disabled={readingCv || !cvFile || !form.watch("vacancyId")}
                  >
                    {readingCv ? "Reading CV..." : "Read CV & Fill Details"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Candidate Details</CardTitle>
              <CardDescription>Who is being recommended.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First Name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last Name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
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
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
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
                control={form.control}
                name="yearsOfExperience"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Years of Experience</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="currentCompany"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Current Company</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="currentTitle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Current Title</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recommender Details</CardTitle>
              <CardDescription>Who is making the recommendation.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="recommenderType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Recommender Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Agency">Agency</SelectItem>
                        <SelectItem value="Employee Referral">Employee Referral</SelectItem>
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
                control={form.control}
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
                control={form.control}
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
              <FormField
                control={form.control}
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
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Enter at least one reliable contact: email or phone number.
              </p>
              <FormField
                control={form.control}
                name="recommenderCompany"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Recommender Company</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="relationship"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Relationship to Candidate</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="commercialTerms"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Commercial Terms (if any)</FormLabel>
                    <FormControl>
                      <Textarea {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button
              type="submit"
              className="gap-2"
              disabled={saving || readingCv || (!cvFile && !cvIntake)}
            >
              <UserPlus className="h-4 w-4" /> Continue
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
