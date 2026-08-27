import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, MapPin, Building2, Upload, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useForm, useFieldArray } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { VacancyService } from "@/lib/data/vacancy-service";
import { CandidateService } from "@/lib/data/candidate-service";
import { getApplicationDataServices, initializeApplicationData } from "@/lib/data/application-data";
import type { Vacancy } from "@/lib/data/types";
import { SYSTEM_ACTOR } from "@/lib/data/types";
import { getSupportedCvMimeType } from "@/lib/data/cv-file-validation";

export const Route = createFileRoute("/jobs/$jobId")({
  head: ({ params }) => {
    const vacancyService = new VacancyService();
    const job = vacancyService.getVacancyRepository().getById(params.jobId);
    const title = job ? `${job.title} — Careers at VIA International` : "Role — VIA International";
    const description = job?.summary ?? "Open role at VIA International.";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
      ],
    };
  },
  component: JobDetail,
});

const formSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(5, "Valid phone number is required"),
  nationality: z.string().optional(),
  location: z.string().min(1, "Current location is required"),
  currentCompany: z.string().optional(),
  currentTitle: z.string().optional(),
  yearsOfExperience: z.number().min(0),
  noticePeriod: z.string().min(1, "Notice period is required"),
  salaryExpectation: z.string().optional(),
  coverNote: z.string().optional(),
  screeningAnswers: z.array(
    z.object({
      question: z.string(),
      answer: z.string().min(1, "This question requires an answer"),
    }),
  ),
  consent: z.literal(true, {
    errorMap: () => ({ message: "You must agree to the privacy policy" }),
  }),
});

type FormValues = z.infer<typeof formSchema>;

function JobDetail() {
  const { jobId } = Route.useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState<Vacancy | null | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [cvFile, setCvFile] = useState<File | null>(null);

  useEffect(() => {
    initializeApplicationData();
    const vacancy = new VacancyService().getVacancyRepository().getById(jobId);
    setJob(vacancy?.status === "Open" ? vacancy : null);
  }, [jobId]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema) as any,
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      nationality: "",
      location: "",
      currentCompany: "",
      currentTitle: "",
      yearsOfExperience: 0,
      noticePeriod: "",
      salaryExpectation: "",
      coverNote: "",
      screeningAnswers: [],
      // Consent must be an affirmative, unprompted action - defaulting it to checked defeats the
      // entire point of asking for consent, since most applicants would never notice or uncheck it.
      consent: false as any,
    },
  });

  const { fields: screeningFields } = useFieldArray({
    name: "screeningAnswers",
    control: form.control,
  });

  useEffect(() => {
    if (!job) return;
    form.setValue(
      "screeningAnswers",
      job.screeningQuestions?.map((question) => ({ question, answer: "" })) || [],
    );
  }, [form, job]);

  if (job === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading role" />
      </div>
    );
  }

  if (job === null) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold">This role is no longer available</h1>
          <p className="mt-2 text-muted-foreground">
            It may have closed or been removed. You can still explore VIA's current opportunities.
          </p>
          <Button asChild className="mt-6">
            <Link to="/">View open roles</Link>
          </Button>
        </div>
      </div>
    );
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) {
        toast.error("File is too large", { description: "CV must be smaller than 10MB." });
        return;
      }
      if (!getSupportedCvMimeType(file)) {
        toast.error("Invalid file type", { description: "Please upload a PDF, DOC or DOCX file." });
        e.target.value = "";
        return;
      }
      setCvFile(file);
    }
  };

  const onSubmit = async (values: FormValues) => {
    if (!cvFile) {
      toast.error("CV Required", { description: "Please upload your resume to apply." });
      return;
    }

    setSubmitting(true);
    try {
      // Process file to array buffer
      const buffer = await cvFile.arrayBuffer();

      const { files } = getApplicationDataServices();
      const resolvedMimeType = getSupportedCvMimeType(cvFile);
      if (!resolvedMimeType) throw new Error("Unsupported CV file type.");
      const fileRecord = await files.save(
        {
          blob: new Blob([buffer], { type: resolvedMimeType }),
          name: cvFile.name,
          mimeType: resolvedMimeType,
          owner: { entityType: "CandidateApplication", entityId: "pending" },
        },
        { actor: SYSTEM_ACTOR },
      );

      const candidateService = new CandidateService();

      let applicationSaved = false;
      try {
        const result = await candidateService.submitApplication({
          firstName: values.firstName,
          lastName: values.lastName,
          email: values.email,
          phone: values.phone,
          nationality: values.nationality || undefined,
          location: values.location,
          currentCompany: values.currentCompany || undefined,
          currentTitle: values.currentTitle || undefined,
          yearsOfExperience: values.yearsOfExperience,
          noticePeriod: values.noticePeriod,
          salaryExpectation: values.salaryExpectation || undefined,
          coverNote: values.coverNote || undefined,
          screeningAnswers: values.screeningAnswers,
          cvFileId: fileRecord.id,
          vacancyId: job.id,
          consent: values.consent,
        });
        applicationSaved = true;
        navigate({ to: "/jobs/applied", search: { ref: result.referenceId } });
      } catch (err: any) {
        if (!applicationSaved) {
          try {
            await files.delete(fileRecord.id, {
              actor: SYSTEM_ACTOR,
              reason: "Removed an unattached CV after application submission did not complete",
            });
          } catch {
            // Preserve the original application error. A later file-maintenance pass can still
            // identify the pending owner if IndexedDB itself is unavailable during cleanup.
          }
        }
        if (err.message === "DUPLICATE_APPLICATION") {
          // Safe rule: Don't leak existing record, just pretend it worked or softly warn.
          // The prompt says "prevent accidental repeated submissions" and "show a safe message without exposing existing private data."
          navigate({ to: "/jobs/applied", search: { ref: "DUPLICATE" } });
        } else {
          toast.error("Application failed", { description: err.message });
        }
      }
    } catch (err: any) {
      toast.error("Error processing application", { description: "Please try again." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <BrandLogo />
          <Button asChild variant="ghost" size="sm">
            <Link to="/">
              <ArrowLeft className="mr-2 h-4 w-4" /> All roles
            </Link>
          </Button>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 lg:grid-cols-[1.6fr_1fr]">
        <article>
          <Badge variant="secondary">{job.department}</Badge>
          <h1 className="mt-3 text-3xl font-semibold">{job.title}</h1>
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-4 w-4" /> {job.location}
            </span>
            <span className="inline-flex items-center gap-1">
              <Building2 className="h-4 w-4" /> {job.employmentType}
            </span>
            {job.salaryRange?.visibleToPublic && (
              <span className="inline-flex items-center gap-1 font-medium text-green-700">
                {job.salaryRange.currency} {job.salaryRange.min} - {job.salaryRange.max}
              </span>
            )}
          </div>

          <p className="mt-6 text-base leading-relaxed whitespace-pre-wrap">{job.summary}</p>

          <h2 className="mt-8 text-lg font-semibold">What you'll do</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {job.responsibilities.map((item: string) => (
              <li key={item} className="flex gap-3">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                {item}
              </li>
            ))}
          </ul>

          <h2 className="mt-8 text-lg font-semibold">Minimum Requirements</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {job.requirements.map((item: string) => (
              <li key={item} className="flex gap-3">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
                {item}
              </li>
            ))}
          </ul>

          {job.skills?.preferred?.length > 0 && (
            <>
              <h2 className="mt-8 text-lg font-semibold">Preferred Skills</h2>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                {job.skills.preferred.map((item: string) => (
                  <li key={item} className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </>
          )}
        </article>

        <aside className="surface-panel h-fit p-6 lg:sticky lg:top-6 rounded-xl border bg-card text-card-foreground shadow">
          <h2 className="font-display text-lg font-semibold mb-5">Apply for this role</h2>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit as any)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control as any}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        First Name <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control as any}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Last Name <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control as any}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Email <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input type="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control as any}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Phone <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control as any}
                name="location"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Current Location <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control as any}
                  name="yearsOfExperience"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Years Experience <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          {...field}
                          onChange={(e) => field.onChange(parseInt(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control as any}
                  name="noticePeriod"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Notice Period <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g. 30 days" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control as any}
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
                  control={form.control as any}
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
              </div>

              <FormField
                control={form.control as any}
                name="salaryExpectation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Salary Expectation (Monthly)</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {screeningFields.map((field, index) => (
                <FormField
                  key={field.id}
                  control={form.control as any}
                  name={`screeningAnswers.${index}.answer`}
                  render={({ field: f }) => (
                    <FormItem>
                      <FormLabel>
                        {field.question} <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <Textarea {...f} className="min-h-[80px]" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}

              <div className="space-y-2 pt-2 border-t mt-4">
                <Label>
                  Resume/CV (PDF or DOCX) <span className="text-destructive">*</span>
                </Label>
                <div className="flex items-center gap-4">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full relative"
                    onClick={() => document.getElementById("cv-upload")?.click()}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    {cvFile ? cvFile.name : "Choose File"}
                    <input
                      id="cv-upload"
                      type="file"
                      className="hidden"
                      accept=".pdf,.doc,.docx"
                      onChange={handleFileChange}
                    />
                  </Button>
                </div>
              </div>

              <FormField
                control={form.control as any}
                name="coverNote"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cover Note</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="Tell us why you're a great fit..."
                        className="min-h-[100px]"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control as any}
                name="consent"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 p-4 border rounded-md bg-muted/50">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Privacy Consent</FormLabel>
                      <p className="text-xs text-muted-foreground">
                        I agree to the collection and processing of my data for recruitment purposes
                        in accordance with VIA International's privacy policy.
                      </p>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full h-11 text-base font-semibold"
                disabled={submitting}
              >
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Submit Application
              </Button>
            </form>
          </Form>
        </aside>
      </div>
    </div>
  );
}
