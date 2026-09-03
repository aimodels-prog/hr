import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  BookOpen,
  CalendarDays,
  CheckCircle2,
  FileText,
  GraduationCap,
  Send,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { TrainingService } from "@/lib/data/training-service";
import type { TrainingCourse, TrainingRequest } from "@/lib/data/training-types";

export const Route = createFileRoute("/staff/me/training")({ component: MyTrainingRoute });

function MyTrainingRoute() {
  return (
    <RequirePermission permission="training:view_self" resourceName="My Training">
      <MyTrainingPage />
    </RequirePermission>
  );
}

function MyTrainingPage() {
  const currentUser = useCurrentUser();
  const context = currentUser.getActorContext();
  const employeeId = currentUser.employeeId ?? "";
  const service = useMemo(() => new TrainingService(), []);
  const [version, setVersion] = useState(0);
  const [certificateOpen, setCertificateOpen] = useState(false);
  const [requestCourse, setRequestCourse] = useState<TrainingCourse | null>(null);
  const [requestReason, setRequestReason] = useState("");
  const [withdrawRequest, setWithdrawRequest] = useState<TrainingRequest | null>(null);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ title: "", provider: "", completionDate: "", expiryDate: "" });
  void version;

  const records = employeeId
    ? service
        .getRecordsForEmployee(employeeId, context)
        .sort((a, b) => b.completionDate.localeCompare(a.completionDate))
    : [];
  const courses = service.getCourses(context);
  const requests = service
    .getRequests(context)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const enrollments = service.getEnrollments(context);
  const sessions = service.getSessions(context);
  const courseName = (id: string) =>
    courses.find((course) => course.id === id)?.title || "Training course";
  const refresh = () => setVersion((value) => value + 1);
  const run = async (action: () => unknown | Promise<unknown>, success: string) => {
    try {
      await action();
      refresh();
      toast.success(success);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The action could not be completed.");
      return false;
    }
  };

  const viewCertificate = async (recordId: string) => {
    try {
      const result = await service.getCertificateFile(recordId, {
        ...context,
        reason: "Employee viewed their training certificate",
      });
      const url = URL.createObjectURL(result.blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The certificate could not be opened.");
    }
  };
  const saveCertificate = async () => {
    if (!employeeId || !file) {
      toast.error("Attach the certificate before saving.");
      return;
    }
    setSaving(true);
    try {
      await service.addRecordWithCertificate(
        {
          employeeId,
          title: form.title,
          provider: form.provider,
          completionDate: form.completionDate,
          ...(form.expiryDate ? { expiryDate: form.expiryDate } : {}),
        },
        { blob: file, name: file.name },
        context,
      );
      setForm({ title: "", provider: "", completionDate: "", expiryDate: "" });
      setFile(null);
      setCertificateOpen(false);
      refresh();
      toast.success("Certification saved and sent to HR for verification");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The certification could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-6 pb-10">
      <PageHeader
        title="My Learning"
        description="Request development, follow assigned training and keep your certifications together."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Summary
          label="Training in progress"
          value={
            enrollments.filter(
              (item) => !["Completed", "Cancelled", "No Show"].includes(item.status),
            ).length
          }
          icon={<BookOpen className="h-5 w-5" />}
        />
        <Summary
          label="Upcoming sessions"
          value={enrollments.filter((item) => item.status === "Scheduled").length}
          icon={<CalendarDays className="h-5 w-5" />}
        />
        <Summary
          label="Verified certificates"
          value={records.filter((item) => item.hrVerified).length}
          icon={<CheckCircle2 className="h-5 w-5" />}
        />
      </div>
      <Tabs defaultValue="plan">
        <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-xl bg-muted/60 p-1">
          <TabsTrigger value="plan">My training plan</TabsTrigger>
          <TabsTrigger value="catalogue">Browse courses</TabsTrigger>
          <TabsTrigger value="certificates">Certifications</TabsTrigger>
        </TabsList>
        <TabsContent value="plan" className="mt-6 space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Assigned and scheduled training</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {enrollments.map((enrollment) => {
                const course = courses.find((item) => item.id === enrollment.courseId);
                const session = sessions.find((item) => item.id === enrollment.sessionId);
                return (
                  <div
                    key={enrollment.id}
                    className="flex flex-col justify-between gap-3 rounded-xl border p-4 sm:flex-row sm:items-center"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{course?.title || "Training course"}</p>
                        <Badge variant="outline">{enrollment.status}</Badge>
                        {course?.isMandatory && <Badge>Required</Badge>}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {session
                          ? `${new Date(session.startAt).toLocaleString()} · ${session.location}`
                          : "HR will confirm the session date."}
                      </p>
                      {enrollment.result && (
                        <p className="mt-1 text-sm">Result: {enrollment.result}</p>
                      )}
                    </div>
                  </div>
                );
              })}
              {enrollments.length === 0 && (
                <Empty
                  title="No training assigned"
                  detail="Approved requests and training assigned by your supervisor or HR will appear here."
                />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">My requests</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {requests.map((request) => (
                <div
                  key={request.id}
                  className="flex flex-col justify-between gap-3 rounded-xl border p-4 sm:flex-row sm:items-center"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{courseName(request.courseId)}</p>
                      <Badge variant="outline">{request.status}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{request.reason}</p>
                    {request.rejectionReason && (
                      <p className="mt-2 text-sm text-rose-700">
                        Decision: {request.rejectionReason}
                      </p>
                    )}
                  </div>
                  {["Pending Supervisor", "Pending HR"].includes(request.status) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setWithdrawRequest(request);
                        setWithdrawReason("");
                      }}
                    >
                      Withdraw
                    </Button>
                  )}
                </div>
              ))}
              {requests.length === 0 && (
                <Empty
                  title="No training requests"
                  detail="Choose a course from the catalogue when you find a useful development opportunity."
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="catalogue" className="mt-6">
          <div className="grid gap-4 md:grid-cols-2">
            {courses.map((course) => {
              const alreadyRequested = requests.some(
                (request) =>
                  request.courseId === course.id &&
                  !["Rejected", "Withdrawn"].includes(request.status),
              );
              return (
                <Card key={course.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">{course.title}</CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {course.provider} · {course.deliveryType}
                        </p>
                      </div>
                      {course.isMandatory && <Badge>Required</Badge>}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm">{course.description}</p>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground">Duration</p>
                        <p className="font-medium">{course.durationHours} hours</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Cost</p>
                        <p className="font-medium">
                          {course.cost === 0
                            ? "No cost"
                            : `${course.currency} ${course.cost.toLocaleString()}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        disabled={alreadyRequested}
                        onClick={() => {
                          setRequestCourse(course);
                          setRequestReason("");
                        }}
                      >
                        {alreadyRequested ? "Already in your plan" : "Request this course"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {courses.length === 0 && (
              <Card className="md:col-span-2">
                <CardContent>
                  <Empty
                    title="No courses available"
                    detail="HR has not published any training courses yet."
                  />
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
        <TabsContent value="certificates" className="mt-6 space-y-4">
          <div className="flex justify-end">
            <Dialog open={certificateOpen} onOpenChange={setCertificateOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Upload className="mr-2 h-4 w-4" /> Add certification
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add training or certification</DialogTitle>
                  <DialogDescription>
                    Upload the original certificate for HR to verify.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <Field label="Training title">
                    <Input
                      value={form.title}
                      onChange={(event) => setForm({ ...form, title: event.target.value })}
                      placeholder="First Aid at Work"
                    />
                  </Field>
                  <Field label="Provider or institution">
                    <Input
                      value={form.provider}
                      onChange={(event) => setForm({ ...form, provider: event.target.value })}
                      placeholder="VIA Academy"
                    />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Completion date">
                      <Input
                        type="date"
                        max={new Date().toISOString().slice(0, 10)}
                        value={form.completionDate}
                        onChange={(event) =>
                          setForm({ ...form, completionDate: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Expiry date (if applicable)">
                      <Input
                        type="date"
                        min={form.completionDate}
                        value={form.expiryDate}
                        onChange={(event) => setForm({ ...form, expiryDate: event.target.value })}
                      />
                    </Field>
                  </div>
                  <Field label="Certificate (PDF, JPG or PNG, up to 10 MB)">
                    <Input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                      onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                    />
                    {file && <p className="text-sm text-emerald-700">Selected: {file.name}</p>}
                  </Field>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCertificateOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    disabled={
                      saving ||
                      !form.title.trim() ||
                      !form.provider.trim() ||
                      !form.completionDate ||
                      !file
                    }
                    onClick={() => void saveCertificate()}
                  >
                    {saving ? "Saving..." : "Save certification"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <div className="grid gap-4">
            {records.map((record) => (
              <Card key={record.id}>
                <CardContent className="flex flex-col justify-between gap-5 p-6 sm:flex-row sm:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{record.title}</h3>
                      <Badge variant={record.hrVerified ? "secondary" : "outline"}>
                        {record.hrVerified
                          ? "Verified"
                          : record.rejectedAt
                            ? "Needs correction"
                            : "Awaiting HR verification"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {record.provider} · Completed{" "}
                      {new Date(record.completionDate).toLocaleDateString()}
                    </p>
                    {record.expiryDate && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        Expires {new Date(record.expiryDate).toLocaleDateString()}
                      </p>
                    )}
                    {record.rejectionReason && (
                      <p className="mt-2 text-sm text-rose-700">
                        HR feedback: {record.rejectionReason}
                      </p>
                    )}
                  </div>
                  {record.certificateFileId && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void viewCertificate(record.id)}
                    >
                      <FileText className="mr-2 h-4 w-4" /> View certificate
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
            {records.length === 0 && (
              <Card className="border-dashed">
                <CardContent>
                  <Empty
                    title="No certifications recorded"
                    detail="Add completed training and attach the original certificate."
                  />
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog
        open={Boolean(requestCourse)}
        onOpenChange={(open) => !open && setRequestCourse(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request {requestCourse?.title}</DialogTitle>
            <DialogDescription>
              Explain how this course supports your current role or development plan.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={requestReason}
            onChange={(event) => setRequestReason(event.target.value)}
            placeholder="Why this training would be valuable"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRequestCourse(null)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!requestCourse) return;
                const ok = await run(
                  () => service.submitRequestAsync(requestCourse.id, requestReason, context),
                  requestCourse.cost === 0
                    ? "Training added to your plan"
                    : "Training request submitted",
                );
                if (ok) setRequestCourse(null);
              }}
            >
              <Send className="mr-2 h-4 w-4" /> Submit request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(withdrawRequest)}
        onOpenChange={(open) => !open && setWithdrawRequest(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw training request</DialogTitle>
            <DialogDescription>
              Tell your supervisor and HR why the request is no longer needed.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={withdrawReason}
            onChange={(event) => setWithdrawReason(event.target.value)}
            placeholder="Reason for withdrawing"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setWithdrawRequest(null)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!withdrawRequest) return;
                const ok = await run(
                  () => service.withdrawRequestAsync(withdrawRequest.id, withdrawReason, context),
                  "Training request withdrawn",
                );
                if (ok) setWithdrawRequest(null);
              }}
            >
              Withdraw request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Summary({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
        </div>
        <div className="rounded-xl bg-primary/10 p-3 text-primary">{icon}</div>
      </CardContent>
    </Card>
  );
}
function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="py-10 text-center text-muted-foreground">
      <GraduationCap className="mx-auto mb-3 h-9 w-9" />
      <p className="font-medium text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-lg text-sm">{detail}</p>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Label className="flex flex-col gap-2">
      <span>{label}</span>
      {children}
    </Label>
  );
}
