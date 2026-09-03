import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, MapPin, Building2, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useForm, useFieldArray } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";

import {
  PublicCareersFooter,
  PublicCareersHeader,
  PublicCareersPage,
} from "@/components/public-careers-shell";
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
import { initializeApplicationData } from "@/lib/data/application-data";
import type { Vacancy } from "@/lib/data/types";
import { getSupportedCvMimeType } from "@/lib/data/cv-file-validation";

export const Route = createFileRoute("/jobs/$jobId")({
  head: ({ params }) => {
    const vacancyService = new VacancyService();
    const job = vacancyService.getVacancyRepository().getById(params.jobId);
    const title = job ? `${job.title} | Careers at VIA International` : "Role | VIA International";
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
  consent: z.boolean().refine((value) => value, "You must agree to the privacy policy"),
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
    let cancelled = false;
    const service = new VacancyService();
    service
      .hydrateCompatibilityCache()
      .then(() => {
        if (cancelled) return;
        const vacancy = service.getVacancyRepository().getById(jobId);
        setJob(vacancy?.status === "Open" ? vacancy : null);
      })
      .catch(() => {
        if (!cancelled) setJob(null);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
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
      consent: false,
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
      <PublicCareersPage>
        <PublicCareersHeader compact />
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[#0a5d9c]" aria-label="Loading position" />
        </div>
      </PublicCareersPage>
    );
  }

  if (job === null) {
    return (
      <PublicCareersPage>
        <PublicCareersHeader compact />
        <div className="flex min-h-[60vh] items-center justify-center bg-[#f5f6f6] px-5">
          <div className="max-w-xl text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#0a5d9c]">
              Careers at VIA
            </p>
            <h1 className="mt-4 text-4xl font-normal">This position is no longer available</h1>
            <p className="mt-4 leading-7 text-slate-600">
              It may have closed or been removed. You can still explore VIA's current positions.
            </p>
            <Button asChild className="mt-7 rounded-none bg-[#07558e] hover:bg-[#064875]">
              <Link to="/">View open positions</Link>
            </Button>
          </div>
        </div>
        <PublicCareersFooter />
      </PublicCareersPage>
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
      const buffer = await cvFile.arrayBuffer();
      const resolvedMimeType = getSupportedCvMimeType(cvFile);
      if (!resolvedMimeType) throw new Error("Unsupported CV file type.");
      if (!job.databaseId) throw new Error("This vacancy is temporarily unavailable.");
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      try {
        const response = await fetch("/api/public/applications", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            vacancyId: job.databaseId,
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
            consent: values.consent,
            fileName: cvFile.name,
            mimeType: resolvedMimeType,
            fileBase64: btoa(binary),
          }),
        });
        const result = (await response.json()) as {
          referenceId?: string;
          error?: string;
        };
        if (!response.ok || !result.referenceId) {
          throw new Error(result.error || "Your application could not be submitted.");
        }
        navigate({ to: "/jobs/applied", search: { ref: result.referenceId } });
      } catch (error: unknown) {
        if (error instanceof Error && error.message === "DUPLICATE_APPLICATION") {
          // Safe rule: Don't leak existing record, just pretend it worked or softly warn.
          // The prompt says "prevent accidental repeated submissions" and "show a safe message without exposing existing private data."
          navigate({ to: "/jobs/applied", search: { ref: "DUPLICATE" } });
        } else {
          toast.error("Application failed", {
            description: error instanceof Error ? error.message : "Please try again.",
          });
        }
      }
    } catch {
      toast.error("Error processing application", { description: "Please try again." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PublicCareersPage>
      <PublicCareersHeader compact />
      <section className="bg-[#07558e] text-white">
        <div className="mx-auto max-w-[1280px] px-5 py-14 sm:px-8 sm:py-20 lg:px-10">
          <Link
            to="/"
            hash="openings"
            className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-blue-100 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" /> All positions
          </Link>
          <Badge className="mt-10 block w-fit rounded-none bg-white text-[#07558e] hover:bg-white">
            {job.department}
          </Badge>
          <h1 className="mt-5 max-w-4xl text-4xl font-normal leading-tight tracking-[-0.04em] sm:text-6xl lg:text-7xl">
            {job.title}
          </h1>
          <div className="mt-7 flex flex-wrap gap-x-7 gap-y-3 text-sm text-blue-50/85">
            <span className="inline-flex items-center gap-2">
              <MapPin className="h-4 w-4" /> {job.location}
            </span>
            <span className="inline-flex items-center gap-2">
              <Building2 className="h-4 w-4" /> {job.employmentType}
            </span>
            {job.salaryRange?.visibleToPublic && (
              <span className="font-medium text-white">
                {job.salaryRange.currency} {job.salaryRange.min} – {job.salaryRange.max}
              </span>
            )}
          </div>
        </div>
      </section>

      <div className="bg-[#f5f6f6]">
        <div className="mx-auto grid max-w-[1280px] gap-10 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[minmax(0,1fr)_420px] lg:px-10">
          <article className="bg-white p-7 sm:p-10">
            <p className="text-base leading-8 whitespace-pre-wrap text-slate-700">{job.summary}</p>

            <h2 className="mt-10 border-t border-slate-200 pt-8 text-2xl font-medium">The role</h2>
            <ul className="mt-5 space-y-3 text-sm leading-6 text-slate-600">
              {job.responsibilities.map((item: string) => (
                <li key={item} className="flex gap-3">
                  <span className="mt-2.5 h-1.5 w-1.5 shrink-0 bg-[#0a5d9c]" />
                  {item}
                </li>
              ))}
            </ul>

            <h2 className="mt-10 border-t border-slate-200 pt-8 text-2xl font-medium">
              What we are looking for
            </h2>
            <ul className="mt-5 space-y-3 text-sm leading-6 text-slate-600">
              {job.requirements.map((item: string) => (
                <li key={item} className="flex gap-3">
                  <span className="mt-2.5 h-1.5 w-1.5 shrink-0 bg-[#0a5d9c]" />
                  {item}
                </li>
              ))}
            </ul>

            {job.skills?.preferred?.length > 0 && (
              <>
                <h2 className="mt-10 border-t border-slate-200 pt-8 text-2xl font-medium">
                  Additional experience
                </h2>
                <ul className="mt-5 space-y-3 text-sm leading-6 text-slate-600">
                  {job.skills.preferred.map((item: string) => (
                    <li key={item} className="flex gap-3">
                      <span className="mt-2.5 h-1.5 w-1.5 shrink-0 bg-[#0a5d9c]" />
                      {item}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </article>

          <aside className="h-fit border-t-4 border-[#07558e] bg-white p-6 shadow-sm lg:sticky lg:top-6 sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#0a5d9c]">
              Application
            </p>
            <h2 className="mb-6 mt-2 text-2xl font-medium">Apply for this position</h2>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
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
                    control={form.control}
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
                  control={form.control}
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
                  control={form.control}
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
                  control={form.control}
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
                    control={form.control}
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
                    control={form.control}
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
                </div>

                <FormField
                  control={form.control}
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
                    control={form.control}
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
                  control={form.control}
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
                  control={form.control}
                  name="consent"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 p-4 border rounded-md bg-muted/50">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>Privacy Consent</FormLabel>
                        <p className="text-xs text-muted-foreground">
                          I agree to the collection and processing of my data for recruitment
                          purposes in accordance with VIA International's privacy policy.
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
      <PublicCareersFooter />
    </PublicCareersPage>
  );
}
