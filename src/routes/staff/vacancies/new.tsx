import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import {
  Sparkles,
  Loader2,
  Save,
  Globe,
  Eye,
  Plus,
  X,
  CheckCircle2,
  CircleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { useForm, useFieldArray } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { VacancyService } from "@/lib/data/vacancy-service";
import { EmployeeService } from "@/lib/data/employee-service";
import { generateDraftJobDescription } from "@/lib/data/ai-provider";
import {
  cleanMandatoryCriteria,
  findMissingMandatoryCriteria,
} from "@/lib/data/job-description-criteria";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/staff/vacancies/new")({
  head: () => ({
    meta: [{ title: "New Vacancy — VIA HR System" }],
  }),
  component: NewVacancyWrapper,
});

function NewVacancyWrapper() {
  return (
    <RequirePermission permission="recruitment:manage_vacancies" resourceName="Vacancy Creation">
      <NewVacancy />
    </RequirePermission>
  );
}

const formSchema = z.object({
  // 1. Business Request
  hiringReason: z.string().min(1, "Hiring reason is required"),
  headcount: z.number().min(1),
  targetStartDate: z.string().min(1, "Target date is required"),
  hiringManagerId: z.string().optional(),
  assignedOwnerId: z.string().optional(),
  projectId: z.string().optional(),

  // 2. Role Facts
  title: z.string().min(1, "Title is required"),
  department: z.string().min(1, "Department is required"),
  location: z.string().min(1, "Location is required"),
  employmentType: z.string().min(1, "Type is required"),

  // 3. Requirements
  education: z.string().min(1, "Education is required"),
  minimumExperience: z.string().min(1, "Experience is required"),
  skillsRequired: z.string(),
  skillsPreferred: z.string(),
  certifications: z.string(),
  languages: z.string(),
  mandatoryCriteria: z.string().min(1, "Add at least one compulsory criterion"),

  // 4. Compensation Visibility
  salaryMin: z.number().optional(),
  salaryMax: z.number().optional(),
  salaryCurrency: z.string(),
  salaryVisible: z.boolean(),

  // 5. Screening
  screeningQuestions: z.array(z.object({ question: z.string().min(1) })),
  notes: z.string().optional(),

  // 6. Job Description (AI Drafted)
  summary: z.string().optional(),
  responsibilities: z.string().optional(),
  requirementsText: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

function NewVacancy() {
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const vacancyService = useMemo(() => new VacancyService(), []);
  const employeeService = useMemo(() => new EmployeeService(), []);
  const employees = employeeService.getEmployees(currentUser.getActorContext(), {
    includeArchived: false,
  });

  const [generating, setGenerating] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      hiringReason: "",
      headcount: 1,
      targetStartDate: "",
      hiringManagerId: "",
      assignedOwnerId: "",
      projectId: "",
      title: "",
      department: "",
      location: "",
      employmentType: "Full-time",
      education: "",
      minimumExperience: "",
      skillsRequired: "",
      skillsPreferred: "",
      certifications: "",
      languages: "",
      mandatoryCriteria: "",
      salaryCurrency: "AED",
      salaryVisible: false,
      screeningQuestions: [],
      notes: "",
      summary: "",
      responsibilities: "",
      requirementsText: "",
    },
  });

  const {
    fields: screeningFields,
    append: appendQuestion,
    remove: removeQuestion,
  } = useFieldArray({
    name: "screeningQuestions",
    control: form.control,
  });

  const compulsoryCriteria = cleanMandatoryCriteria(form.watch("mandatoryCriteria").split("\n"));
  const finalRequirements = (form.watch("requirementsText") || "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
  const missingCompulsoryCriteria = findMissingMandatoryCriteria(
    compulsoryCriteria,
    finalRequirements,
  );

  const handleGenerate = async () => {
    const values = form.getValues();
    if (!values.title || !values.department) {
      toast.error("Missing fields", { description: "Please fill out title and department first." });
      return;
    }
    const mandatoryCriteria = cleanMandatoryCriteria(values.mandatoryCriteria.split("\n"));
    if (mandatoryCriteria.length === 0) {
      toast.error("Add the compulsory criteria", {
        description: "Enter each requirement the generated description must include.",
      });
      return;
    }

    setGenerating(true);
    try {
      const draft = await generateDraftJobDescription(
        {
          title: values.title,
          department: values.department,
          location: values.location,
          employmentType: values.employmentType,
          education: values.education,
          minimumExperience: values.minimumExperience,
          skills: {
            required: values.skillsRequired
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            preferred: values.skillsPreferred
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          },
          languages: values.languages
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          mandatoryCriteria,
        },
        {
          context: getActorContext("Generated a job-description draft"),
          relatedEntityType: "vacancy-draft",
          relatedEntityId: `new-${values.title
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")}`,
        },
      );

      form.setValue("summary", draft.summary);
      form.setValue("responsibilities", draft.responsibilities.join("\n"));
      form.setValue("requirementsText", draft.requirements.join("\n"));
      toast.success("AI Draft generated", {
        description: "Review and edit the generated description below.",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The description could not be generated.");
    } finally {
      setGenerating(false);
    }
  };

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

  const mapFormToVacancyPayload = (values: FormValues) => {
    return {
      title: values.title,
      department: values.department,
      location: values.location,
      employmentType: values.employmentType,
      headcount: values.headcount,
      targetStartDate: values.targetStartDate,
      hiringManagerId: values.hiringManagerId || undefined,
      assignedOwnerId: values.assignedOwnerId || undefined,
      projectId: values.projectId || undefined,
      hiringReason: values.hiringReason,
      education: values.education,
      minimumExperience: values.minimumExperience,
      skills: {
        required: values.skillsRequired
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        preferred: values.skillsPreferred
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      },
      certifications: values.certifications
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      languages: values.languages
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      mandatoryCriteria: cleanMandatoryCriteria(values.mandatoryCriteria.split("\n")),
      salaryRange:
        values.salaryMin && values.salaryMax
          ? {
              min: values.salaryMin,
              max: values.salaryMax,
              currency: values.salaryCurrency,
              visibleToPublic: values.salaryVisible,
            }
          : undefined,
      screeningQuestions: values.screeningQuestions.map((q) => q.question),
      notes: values.notes || "",
      summary: values.summary || "",
      responsibilities: values.responsibilities?.split("\n").filter(Boolean) || [],
      requirements: values.requirementsText?.split("\n").filter(Boolean) || [],
    };
  };

  const onSaveDraft = async () => {
    const values = form.getValues();
    try {
      const payload = mapFormToVacancyPayload(values);
      const vacancy = await vacancyService.saveDraftAsync(payload, getActorContext("Saved draft"));
      toast.success("Draft saved");
      navigate({ to: "/staff/vacancies/$vacancyId", params: { vacancyId: vacancy.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save draft");
    }
  };

  const onSubmitForm = async (values: FormValues) => {
    try {
      const payload = mapFormToVacancyPayload(values);
      const vacancy = await vacancyService.saveDraftAsync(
        payload,
        getActorContext("Initial draft creation"),
      );
      await vacancyService.transitionStatusAsync(
        vacancy.id,
        "Pending Approval",
        "Confirmed vacancy details for publication",
        getActorContext("Confirmed vacancy details for publication"),
      );
      await vacancyService.transitionStatusAsync(
        vacancy.id,
        "Open",
        "Published vacancy",
        getActorContext("Published vacancy"),
      );
      toast.success("Vacancy published");
      navigate({ to: "/staff/vacancies/$vacancyId", params: { vacancyId: vacancy.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to publish vacancy");
    }
  };

  return (
    <div className="flex flex-col max-w-5xl mx-auto pb-32">
      <PageHeader
        title="New Vacancy"
        description="Define core facts, generate a draft description with AI, and publish."
      />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmitForm)} className="space-y-8 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>1. Business Request</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-2">
              <FormField
                control={form.control}
                name="hiringReason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hiring Reason</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g. Expansion, Replacement" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="headcount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Headcount</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
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
                name="targetStartDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Target Start Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="hiringManagerId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hiring Manager</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ""}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select manager" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {employees.map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.preferredName} {e.legalName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. Role Facts</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-2">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Job Title</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="department"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Department</FormLabel>
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
                name="employmentType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Employment Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Full-time">Full-time</SelectItem>
                        <SelectItem value="Part-time">Part-time</SelectItem>
                        <SelectItem value="Contract">Contract</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>3. Requirements</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-2">
              <FormField
                control={form.control}
                name="education"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Education</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="minimumExperience"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Minimum Experience</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g. 5+ years" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="skillsRequired"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Required Skills (comma separated)</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="skillsPreferred"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Preferred Skills (comma separated)</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="languages"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Languages (comma separated)</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="certifications"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Certifications (comma separated)</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="mandatoryCriteria"
                render={({ field }) => (
                  <FormItem className="rounded-lg border-2 border-primary/30 bg-primary/5 p-4 md:col-span-2">
                    <FormLabel>Compulsory Criteria</FormLabel>
                    <p className="text-sm text-muted-foreground">
                      Enter one requirement per line. Every item must appear in the generated job
                      description and remain there before the vacancy can be published.
                    </p>
                    <FormControl>
                      <Textarea
                        {...field}
                        className="min-h-32 bg-background"
                        placeholder={
                          "Valid UAE driving licence\nFluent written and spoken Arabic\nWilling to travel across GCC sites"
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>4. Compensation & Visibility</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-3">
              <FormField
                control={form.control}
                name="salaryMin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Min Salary</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value))}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="salaryMax"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max Salary</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value))}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="salaryCurrency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Currency</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="salaryVisible"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 md:col-span-3">
                    <div className="space-y-0.5">
                      <FormLabel>Public Visibility</FormLabel>
                      <p className="text-sm text-muted-foreground">
                        Show salary range on the public careers portal.
                      </p>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>5. Screening Questions</CardTitle>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => appendQuestion({ question: "" })}
                >
                  <Plus className="mr-2 h-4 w-4" /> Add Question
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {screeningFields.map((f, i) => (
                <div key={f.id} className="flex items-center gap-4">
                  <FormField
                    control={form.control}
                    name={`screeningQuestions.${i}.question`}
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormControl>
                          <Input {...field} placeholder="Question..." />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeQuestion(i)}
                  >
                    <X className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
              {screeningFields.length === 0 && (
                <p className="text-sm text-muted-foreground">No screening questions added.</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-primary/50 shadow-sm bg-primary/5">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    6. Job Description Editor <Sparkles className="h-4 w-4 text-primary" />
                  </CardTitle>
                  <CardDescription>
                    Generate a draft using the facts above, then edit manually.
                  </CardDescription>
                </div>
                <Button type="button" onClick={handleGenerate} disabled={generating}>
                  {generating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  Generate AI Draft
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div
                className={`flex items-start gap-3 rounded-lg border p-4 ${
                  compulsoryCriteria.length > 0 && missingCompulsoryCriteria.length === 0
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-amber-200 bg-amber-50 text-amber-900"
                }`}
              >
                {compulsoryCriteria.length > 0 && missingCompulsoryCriteria.length === 0 ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                ) : (
                  <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
                )}
                <div>
                  <p className="font-medium">
                    {compulsoryCriteria.length === 0
                      ? "Add the compulsory criteria before generating"
                      : missingCompulsoryCriteria.length === 0
                        ? `All ${compulsoryCriteria.length} compulsory ${
                            compulsoryCriteria.length === 1 ? "criterion is" : "criteria are"
                          } included`
                        : `${missingCompulsoryCriteria.length} compulsory ${
                            missingCompulsoryCriteria.length === 1 ? "criterion is" : "criteria are"
                          } missing`}
                  </p>
                  {missingCompulsoryCriteria.length > 0 && (
                    <p className="mt-1 text-sm">
                      Regenerate the description or restore: {missingCompulsoryCriteria.join("; ")}
                    </p>
                  )}
                </div>
              </div>
              <FormField
                control={form.control}
                name="summary"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role Summary</FormLabel>
                    <FormControl>
                      <Textarea className="min-h-[100px] bg-background" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="responsibilities"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Responsibilities (one per line)</FormLabel>
                    <FormControl>
                      <Textarea className="min-h-[150px] bg-background" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="requirementsText"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Requirements (one per line)</FormLabel>
                    <FormControl>
                      <Textarea className="min-h-[150px] bg-background" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Sticky Footer */}
          <div className="fixed bottom-0 left-0 md:pl-64 right-0 p-4 bg-background border-t flex justify-between items-center z-10">
            <Button type="button" variant="outline" onClick={() => setPreviewOpen(true)}>
              <Eye className="mr-2 h-4 w-4" /> Preview Public Listing
            </Button>
            <div className="flex items-center gap-3">
              <Button type="button" variant="secondary" onClick={onSaveDraft}>
                <Save className="mr-2 h-4 w-4" /> Save Draft
              </Button>
              <Button type="submit">
                <Globe className="mr-2 h-4 w-4" /> Publish
              </Button>
            </div>
          </div>
        </form>
      </Form>

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Public Listing Preview</DialogTitle>
          </DialogHeader>
          <div className="mt-4 space-y-6">
            <div>
              <h1 className="text-3xl font-semibold">{form.watch("title") || "Job Title"}</h1>
              <div className="mt-2 text-muted-foreground flex gap-3 text-sm">
                <span>{form.watch("department") || "Department"}</span> •
                <span>{form.watch("location") || "Location"}</span> •
                <span>{form.watch("employmentType") || "Employment Type"}</span>
              </div>
            </div>
            {form.watch("salaryVisible") && form.watch("salaryMin") && (
              <div className="text-lg font-medium text-green-600">
                {form.watch("salaryCurrency")} {form.watch("salaryMin")} - {form.watch("salaryMax")}
              </div>
            )}
            <div>
              <p className="whitespace-pre-wrap">{form.watch("summary")}</p>
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-3">Key Responsibilities</h2>
              <ul className="list-disc pl-5 space-y-2">
                {(form.watch("responsibilities")?.split("\n").filter(Boolean) || []).map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-3">Requirements</h2>
              <ul className="list-disc pl-5 space-y-2">
                {(form.watch("requirementsText")?.split("\n").filter(Boolean) || []).map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
