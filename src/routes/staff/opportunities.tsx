import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BriefcaseBusiness, FileText, HeartHandshake, Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentUser } from "@/lib/auth";
import { getSupportedCvMimeType } from "@/lib/data/cv-file-validation";
import type { EmployeeOpportunitySnapshot } from "@/lib/db/repositories/employee-opportunities.repository.server";
import {
  getEmployeeOpportunitiesFn,
  submitEmployeeReferralFn,
  submitInternalApplicationFn,
} from "@/lib/server-functions/employee-opportunities.server";

type DialogAction = "apply" | "refer" | null;

export const Route = createFileRoute("/staff/opportunities")({
  validateSearch: (search: Record<string, unknown>) => ({
    action:
      search["action"] === "apply" || search["action"] === "refer" ? search["action"] : undefined,
    vacancyId: typeof search["vacancyId"] === "string" ? search["vacancyId"] : undefined,
  }),
  component: OpportunitiesPage,
});

function toBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    return btoa(binary);
  });
}

function publicApplicationStatus(status: string): string {
  if (status === "New") return "Under review";
  if (status === "Shortlisted" || status === "Interviewing") return "Interview stage";
  if (status === "Offered") return "Decision in progress";
  if (status === "On Hold") return "Being considered";
  if (["Hired", "Rejected", "Withdrawn"].includes(status)) return "Process completed";
  return "Submitted";
}

function publicReferralStatus(status: string): string {
  if (["Submitted", "In Progress"].includes(status)) return "HR reviewing";
  if (["Hired", "Rejected", "Closed", "Not Selected"].includes(status)) return "Process completed";
  return status || "Submitted";
}

function validateCv(file: File | null): string | undefined {
  if (!file) return "Upload a PDF, DOC or DOCX CV.";
  if (file.size > 10 * 1024 * 1024) return "CV must be no larger than 10 MB.";
  if (!getSupportedCvMimeType(file)) return "Upload a PDF, DOC or DOCX CV.";
  return undefined;
}

function OpportunitiesPage() {
  const current = useCurrentUser();
  const search = Route.useSearch();
  const [snapshot, setSnapshot] = useState<EmployeeOpportunitySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogAction>(
    search.action === "apply" || search.action === "refer" ? search.action : null,
  );
  const [selectedVacancyId, setSelectedVacancyId] = useState(search.vacancyId ?? "");
  const [saving, setSaving] = useState(false);

  const actor = useMemo(
    () => ({
      actorId: current.currentUser?.id ?? current.id,
      ...(current.currentUser?.workspaceEmail
        ? { actorEmail: current.currentUser.workspaceEmail }
        : {}),
      activeRole: current.activeRole,
    }),
    [current.activeRole, current.currentUser, current.id],
  );

  const load = async () => {
    setError(null);
    try {
      setSnapshot(await getEmployeeOpportunitiesFn({ data: { actor } }));
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Opportunities could not be loaded.",
      );
    }
  };

  useEffect(() => {
    void load();
    // Actor identity and role are the only values that should reload this scoped page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor.actorId, actor.actorEmail, actor.activeRole]);

  const openDialog = (action: Exclude<DialogAction, null>, vacancyId = "") => {
    setSelectedVacancyId(vacancyId);
    setDialog(action);
  };

  if (!snapshot && !error) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading opportunities…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-10">
      <PageHeader
        title="Opportunities"
        description="Explore open positions, apply within VIA, or recommend someone to the Candidate Pool."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => openDialog("refer")}>
              <HeartHandshake className="mr-2 h-4 w-4" /> Recommend someone
            </Button>
            <Button onClick={() => openDialog("apply")}>
              <BriefcaseBusiness className="mr-2 h-4 w-4" /> Apply for a position
            </Button>
          </div>
        }
      />

      {error ? (
        <Card className="border-destructive/30">
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <p className="font-medium">Opportunities are temporarily unavailable</p>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {snapshot ? (
        <Tabs defaultValue="positions">
          <TabsList className="h-auto w-full justify-start overflow-x-auto">
            <TabsTrigger value="positions">
              Open Positions ({snapshot.vacancies.length})
            </TabsTrigger>
            <TabsTrigger value="applications">
              My Applications ({snapshot.applications.length})
            </TabsTrigger>
            <TabsTrigger value="referrals">My Referrals ({snapshot.referrals.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="positions" className="mt-5">
            {snapshot.vacancies.length ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {snapshot.vacancies.map((vacancy) => (
                  <Card key={vacancy.id} className="flex flex-col">
                    <CardHeader>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <CardTitle>{vacancy.title}</CardTitle>
                          <CardDescription className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                            <span>{vacancy.department}</span>
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="h-3.5 w-3.5" />
                              {vacancy.location}
                            </span>
                            <span>{vacancy.employmentType}</span>
                          </CardDescription>
                        </div>
                        <Badge variant="outline">Open</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="flex flex-1 flex-col gap-4">
                      <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">
                        {vacancy.summary}
                      </p>
                      {vacancy.mandatoryCriteria.length ? (
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Key requirements
                          </p>
                          <ul className="mt-2 space-y-1 text-sm">
                            {vacancy.mandatoryCriteria.slice(0, 3).map((criterion) => (
                              <li key={criterion}>• {criterion}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      <div className="mt-auto flex flex-wrap gap-2 pt-2">
                        {vacancy.acceptsInternalApplications ? (
                          <Button onClick={() => openDialog("apply", vacancy.id)}>
                            Apply internally
                          </Button>
                        ) : null}
                        {vacancy.acceptsEmployeeReferrals ? (
                          <Button variant="outline" onClick={() => openDialog("refer", vacancy.id)}>
                            Recommend someone
                          </Button>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="p-10 text-center text-sm text-muted-foreground">
                  There are no staff opportunities available right now.
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="applications" className="mt-5">
            <HistoryTable
              empty="You have not submitted an internal application."
              rows={snapshot.applications.map((item) => ({
                id: item.id,
                primary: item.vacancyTitle,
                secondary: item.referenceId,
                date: item.submittedAt,
                status: publicApplicationStatus(item.status),
              }))}
            />
          </TabsContent>

          <TabsContent value="referrals" className="mt-5">
            <HistoryTable
              empty="You have not recommended anyone yet."
              rows={snapshot.referrals.map((item) => ({
                id: item.id,
                primary: item.candidateName,
                secondary: item.vacancyTitle ?? "Candidate Pool – future opportunities",
                date: item.submittedAt,
                status: publicReferralStatus(item.status),
              }))}
            />
          </TabsContent>
        </Tabs>
      ) : null}

      {snapshot ? (
        <ApplicationDialog
          open={dialog === "apply"}
          onOpenChange={(open) => !open && setDialog(null)}
          vacancies={snapshot.vacancies.filter((item) => item.acceptsInternalApplications)}
          selectedVacancyId={selectedVacancyId}
          setSelectedVacancyId={setSelectedVacancyId}
          saving={saving}
          onSubmit={async (values) => {
            setSaving(true);
            try {
              const result = await submitInternalApplicationFn({ data: { actor, ...values } });
              toast.success(`Application submitted. Reference ${result.referenceId}.`);
              setDialog(null);
              await load();
            } catch (submitError) {
              toast.error(
                submitError instanceof Error
                  ? submitError.message
                  : "Application could not be submitted.",
              );
            } finally {
              setSaving(false);
            }
          }}
        />
      ) : null}

      {snapshot ? (
        <ReferralDialog
          open={dialog === "refer"}
          onOpenChange={(open) => !open && setDialog(null)}
          vacancies={snapshot.vacancies.filter((item) => item.acceptsEmployeeReferrals)}
          selectedVacancyId={selectedVacancyId}
          setSelectedVacancyId={setSelectedVacancyId}
          saving={saving}
          onSubmit={async (values) => {
            setSaving(true);
            try {
              await submitEmployeeReferralFn({ data: { actor, ...values } });
              toast.success("Your recommendation was sent to HR.");
              setDialog(null);
              await load();
            } catch (submitError) {
              toast.error(
                submitError instanceof Error
                  ? submitError.message
                  : "Referral could not be submitted.",
              );
            } finally {
              setSaving(false);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function HistoryTable({
  rows,
  empty,
}: {
  rows: Array<{ id: string; primary: string; secondary: string; date: string; status: string }>;
  empty: string;
}) {
  if (!rows.length)
    return (
      <Card>
        <CardContent className="p-10 text-center text-sm text-muted-foreground">
          {empty}
        </CardContent>
      </Card>
    );
  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="p-4">Person or position</th>
              <th className="p-4">Details</th>
              <th className="p-4">Submitted</th>
              <th className="p-4">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b last:border-0">
                <td className="p-4 font-medium">{row.primary}</td>
                <td className="p-4 text-muted-foreground">{row.secondary}</td>
                <td className="p-4">
                  {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(
                    new Date(row.date),
                  )}
                </td>
                <td className="p-4">
                  <Badge variant="outline">{row.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

type VacancyOption = EmployeeOpportunitySnapshot["vacancies"][number];

function CvField({ file, setFile }: { file: File | null; setFile: (file: File | null) => void }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="opportunity-cv">CV (PDF, DOC or DOCX; maximum 10 MB)</Label>
      <Input
        id="opportunity-cv"
        type="file"
        accept=".pdf,.doc,.docx"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      {file ? (
        <p className="text-xs text-muted-foreground">
          <FileText className="mr-1 inline h-3.5 w-3.5" />
          {file.name}
        </p>
      ) : null}
    </div>
  );
}

function ApplicationDialog({
  open,
  onOpenChange,
  vacancies,
  selectedVacancyId,
  setSelectedVacancyId,
  saving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vacancies: VacancyOption[];
  selectedVacancyId: string;
  setSelectedVacancyId: (value: string) => void;
  saving: boolean;
  onSubmit: (values: {
    vacancyId: string;
    noticePeriod: string;
    coverNote?: string;
    screeningAnswers: Array<{ question: string; answer: string }>;
    cv: { fileName: string; mimeType: string; fileBase64: string };
  }) => Promise<void>;
}) {
  const vacancy = vacancies.find((item) => item.id === selectedVacancyId);
  const [noticePeriod, setNoticePeriod] = useState("");
  const [coverNote, setCoverNote] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const submit = async () => {
    const fileError = validateCv(file);
    if (!selectedVacancyId) {
      toast.error("Select a position.");
      return;
    }
    if (!noticePeriod.trim()) {
      toast.error("Enter your availability or notice period.");
      return;
    }
    if (fileError || !file) {
      toast.error(fileError);
      return;
    }
    if (vacancy?.screeningQuestions.some((question) => !answers[question]?.trim())) {
      toast.error("Answer every vacancy question.");
      return;
    }
    const mimeType = getSupportedCvMimeType(file)!;
    await onSubmit({
      vacancyId: selectedVacancyId,
      noticePeriod: noticePeriod.trim(),
      ...(coverNote.trim() ? { coverNote: coverNote.trim() } : {}),
      screeningAnswers: (vacancy?.screeningQuestions ?? []).map((question) => ({
        question,
        answer: answers[question]!.trim(),
      })),
      cv: { fileName: file.name, mimeType, fileBase64: await toBase64(file) },
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Apply for a position</DialogTitle>
          <DialogDescription>
            Your VIA identity and employment details are supplied from your employee profile. Upload
            the CV you want HR to review for this role.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Position</Label>
            <Select
              value={selectedVacancyId}
              onValueChange={(value) => {
                setSelectedVacancyId(value);
                setAnswers({});
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select an open position" />
              </SelectTrigger>
              <SelectContent>
                {vacancies.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.title} · {item.location}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="internal-notice">Availability or notice period</Label>
            <Input
              id="internal-notice"
              value={noticePeriod}
              onChange={(event) => setNoticePeriod(event.target.value)}
              placeholder="For example: available after four weeks"
            />
          </div>
          {vacancy?.screeningQuestions.map((question) => (
            <div key={question} className="space-y-2">
              <Label>{question}</Label>
              <Textarea
                value={answers[question] ?? ""}
                onChange={(event) =>
                  setAnswers((current) => ({ ...current, [question]: event.target.value }))
                }
              />
            </div>
          ))}
          <div className="space-y-2">
            <Label htmlFor="internal-cover">Why are you interested? (optional)</Label>
            <Textarea
              id="internal-cover"
              value={coverNote}
              onChange={(event) => setCoverNote(event.target.value)}
              rows={4}
            />
          </div>
          <CvField file={file} setFile={setFile} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting…
              </>
            ) : (
              "Submit application"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReferralDialog({
  open,
  onOpenChange,
  vacancies,
  selectedVacancyId,
  setSelectedVacancyId,
  saving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vacancies: VacancyOption[];
  selectedVacancyId: string;
  setSelectedVacancyId: (value: string) => void;
  saving: boolean;
  onSubmit: (values: {
    vacancyId?: string;
    candidate: {
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      location: string;
      currentCompany?: string;
      currentTitle?: string;
    };
    relationship: string;
    yearsKnown?: number;
    notes: string;
    candidateAware: true;
    cv: { fileName: string; mimeType: string; fileBase64: string };
  }) => Promise<void>;
}) {
  const [candidate, setCandidate] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    location: "",
    currentCompany: "",
    currentTitle: "",
  });
  const [relationship, setRelationship] = useState("");
  const [yearsKnown, setYearsKnown] = useState("");
  const [notes, setNotes] = useState("");
  const [candidateAware, setCandidateAware] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const update = (field: keyof typeof candidate, value: string) =>
    setCandidate((current) => ({ ...current, [field]: value }));
  const submit = async () => {
    if (!candidate.firstName.trim() || !candidate.lastName.trim()) {
      toast.error("Enter the candidate’s name.");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(candidate.email.trim())) {
      toast.error("Enter a valid candidate email address.");
      return;
    }
    if (candidate.phone.trim().length < 5 || !candidate.location.trim()) {
      toast.error("Enter the candidate’s phone number and location.");
      return;
    }
    if (relationship.trim().length < 2) {
      toast.error("Explain how you know the candidate.");
      return;
    }
    if (notes.trim().length < 10) {
      toast.error("Add a short reason for your recommendation.");
      return;
    }
    if (!candidateAware) {
      toast.error("Confirm that the candidate knows their CV is being shared.");
      return;
    }
    const fileError = validateCv(file);
    if (fileError || !file) {
      toast.error(fileError);
      return;
    }
    const mimeType = getSupportedCvMimeType(file)!;
    await onSubmit({
      ...(selectedVacancyId && selectedVacancyId !== "future"
        ? { vacancyId: selectedVacancyId }
        : {}),
      candidate: {
        firstName: candidate.firstName.trim(),
        lastName: candidate.lastName.trim(),
        email: candidate.email.trim(),
        phone: candidate.phone.trim(),
        location: candidate.location.trim(),
        ...(candidate.currentCompany.trim()
          ? { currentCompany: candidate.currentCompany.trim() }
          : {}),
        ...(candidate.currentTitle.trim() ? { currentTitle: candidate.currentTitle.trim() } : {}),
      },
      relationship: relationship.trim(),
      ...(yearsKnown ? { yearsKnown: Number(yearsKnown) } : {}),
      notes: notes.trim(),
      candidateAware: true,
      cv: { fileName: file.name, mimeType, fileBase64: await toBase64(file) },
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Recommend someone</DialogTitle>
          <DialogDescription>
            Your name, VIA email, department and position will be recorded automatically as the
            recommender.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>Opportunity</Label>
            <Select value={selectedVacancyId || "future"} onValueChange={setSelectedVacancyId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="future">Candidate Pool · future opportunities</SelectItem>
                {vacancies.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.title} · {item.location}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(
            [
              ["firstName", "First name"],
              ["lastName", "Last name"],
              ["email", "Email"],
              ["phone", "Phone"],
              ["location", "Current location"],
              ["currentCompany", "Current company"],
              ["currentTitle", "Current position"],
            ] as Array<[keyof typeof candidate, string]>
          ).map(([field, label]) => (
            <div key={field} className="space-y-2">
              <Label htmlFor={`referral-${field}`}>{label}</Label>
              <Input
                id={`referral-${field}`}
                type={field === "email" ? "email" : "text"}
                value={candidate[field]}
                onChange={(event) => update(field, event.target.value)}
              />
            </div>
          ))}
          <div className="space-y-2">
            <Label htmlFor="referral-relationship">How do you know them?</Label>
            <Input
              id="referral-relationship"
              value={relationship}
              onChange={(event) => setRelationship(event.target.value)}
              placeholder="Former colleague, professional contact…"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="referral-years">Years known (optional)</Label>
            <Input
              id="referral-years"
              type="number"
              min="0"
              max="80"
              value={yearsKnown}
              onChange={(event) => setYearsKnown(event.target.value)}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="referral-notes">Why do you recommend them?</Label>
            <Textarea
              id="referral-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
            />
          </div>
          <div className="sm:col-span-2">
            <CvField file={file} setFile={setFile} />
          </div>
          <div className="flex items-start gap-3 rounded-lg border p-4 sm:col-span-2">
            <Checkbox
              id="candidate-aware"
              checked={candidateAware}
              onCheckedChange={(checked) => setCandidateAware(checked === true)}
            />
            <Label htmlFor="candidate-aware" className="font-normal leading-5">
              The candidate knows I am sharing their CV with VIA for recruitment.
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting…
              </>
            ) : (
              "Send recommendation"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
