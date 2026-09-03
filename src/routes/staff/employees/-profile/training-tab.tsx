import { useMemo, useState } from "react";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import {
  Award,
  CalendarClock,
  CheckCircle2,
  Eye,
  GraduationCap,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { useCurrentUser } from "@/lib/auth";
import { TrainingService } from "@/lib/data/training-service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const emptyForm = { title: "", provider: "", completionDate: "", expiryDate: "" };
const MAX_CERTIFICATE_SIZE = 10 * 1024 * 1024;
const CERTIFICATE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

export function TrainingTab({ employeeId }: { employeeId: string }) {
  const currentUser = useCurrentUser();
  const trainingService = useMemo(() => new TrainingService(), []);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [certificate, setCertificate] = useState<File | null>(null);

  const [records, setRecords] = useState(() =>
    trainingService
      .getRecordsForUser(employeeId, currentUser.getActorContext())
      .sort((a, b) => b.completionDate.localeCompare(a.completionDate)),
  );
  const today = new Date();
  const expiringSoon = records.filter(
    (record) =>
      record.expiryDate &&
      differenceInCalendarDays(parseISO(record.expiryDate), today) <= 60 &&
      differenceInCalendarDays(parseISO(record.expiryDate), today) >= 0,
  );
  const expired = records.filter(
    (record) =>
      record.expiryDate && differenceInCalendarDays(parseISO(record.expiryDate), today) < 0,
  );
  const verified = records.filter((record) => record.hrVerified);
  const isSelf = currentUser.employeeId === employeeId;
  const canManageTraining =
    currentUser.activeRole === "HR" || currentUser.activeRole === "Super Admin";
  const canAdd = isSelf || canManageTraining;
  const actorContext = (reason: string) => ({
    actor: {
      userId: currentUser.userId,
      employeeId: currentUser.employeeId,
      displayName: currentUser.displayName,
      roles: currentUser.assignedRoles,
      activeRole: currentUser.activeRole,
    },
    reason,
  });

  const saveRecord = async () => {
    if (!form.title.trim() || !form.provider.trim() || !form.completionDate || !certificate) {
      toast.error("Complete the required fields", {
        description: "Course title, provider, completion date and certificate are required.",
      });
      return;
    }
    if (!CERTIFICATE_TYPES.has(certificate.type) || certificate.size > MAX_CERTIFICATE_SIZE) {
      toast.error("Choose a PDF, JPG or PNG certificate up to 10 MB.");
      return;
    }
    setSaving(true);
    try {
      await trainingService.addRecordWithCertificate(
        {
          employeeId,
          title: form.title.trim(),
          provider: form.provider.trim(),
          completionDate: form.completionDate,
          ...(form.expiryDate ? { expiryDate: form.expiryDate } : {}),
        },
        { blob: certificate, name: certificate.name },
        actorContext("Training or certification record added from employee profile"),
      );
      setRecords(
        trainingService
          .getRecordsForUser(employeeId, currentUser.getActorContext())
          .sort((a, b) => b.completionDate.localeCompare(a.completionDate)),
      );
      setForm(emptyForm);
      setCertificate(null);
      setOpen(false);
      toast.success("Certification added", {
        description: "The record is saved and awaiting HR verification.",
      });
    } catch (error) {
      toast.error("Unable to add certification", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  const verifyRecord = async (recordId: string) => {
    try {
      const context = actorContext("Training evidence verified");
      await trainingService.decideRecordAsync(
        recordId,
        "Verify",
        "Certificate checked against the uploaded evidence",
        context,
      );
      setRecords(
        trainingService
          .getRecordsForUser(employeeId, currentUser.getActorContext())
          .sort((a, b) => b.completionDate.localeCompare(a.completionDate)),
      );
      toast.success("Training record verified");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to verify this record");
    }
  };

  const previewCertificate = async (recordId: string) => {
    try {
      const { blob } = await trainingService.getCertificateFile(
        recordId,
        actorContext("Training certificate viewed"),
      );
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to open the certificate");
    }
  };

  const addDialog = canAdd ? (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setForm(emptyForm);
          setCertificate(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus /> Add certification
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add training or certification</DialogTitle>
          <DialogDescription>
            Record a completed course. HR can verify the supporting certificate separately.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="training-title">Course or certification *</Label>
            <Input
              id="training-title"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="e.g. FIATA Diploma in Freight Forwarding"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="training-provider">Training provider *</Label>
            <Input
              id="training-provider"
              value={form.provider}
              onChange={(event) => setForm({ ...form, provider: event.target.value })}
              placeholder="Provider or awarding body"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="training-completed">Completed *</Label>
              <Input
                id="training-completed"
                type="date"
                value={form.completionDate}
                onChange={(event) => setForm({ ...form, completionDate: event.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="training-expires">Expiry date</Label>
              <Input
                id="training-expires"
                type="date"
                value={form.expiryDate}
                onChange={(event) => setForm({ ...form, expiryDate: event.target.value })}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="training-certificate">Certificate *</Label>
            <Input
              id="training-certificate"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              onChange={(event) => setCertificate(event.target.files?.[0] || null)}
            />
            <p className="text-xs text-muted-foreground">PDF, JPG or PNG, up to 10 MB.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={saveRecord} disabled={saving}>
            {saving ? "Saving..." : "Save certification"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;

  return (
    <section className="space-y-5" aria-labelledby="training-heading">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Development</p>
          <h2
            id="training-heading"
            className="mt-2 font-display text-2xl font-bold tracking-[-0.035em]"
          >
            Training & certifications
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Keep professional qualifications current and give HR a clear verification trail.
          </p>
        </div>
        {records.length > 0 && addDialog}
      </div>

      {records.length === 0 ? (
        <Card className="overflow-hidden border-primary/15">
          <CardContent className="grid min-h-[390px] p-0 lg:grid-cols-[1.15fr_.85fr]">
            <div className="flex flex-col justify-center p-8 sm:p-12">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/8 text-primary">
                <GraduationCap className="h-7 w-7" />
              </span>
              <h3 className="mt-7 text-2xl font-bold tracking-[-0.03em]">
                Build your professional record
              </h3>
              <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground">
                Add completed courses, licences and professional certifications here. Expiry
                monitoring will remind you and HR before credentials need renewal.
              </p>
              {addDialog ? (
                <div className="mt-7">{addDialog}</div>
              ) : (
                <p className="mt-7 text-sm text-muted-foreground">
                  No training or certification records are on file.
                </p>
              )}
            </div>
            <div className="relative hidden overflow-hidden bg-[linear-gradient(145deg,#07345e,#0c649d)] p-9 text-white lg:flex lg:flex-col lg:justify-end">
              <Award className="absolute right-8 top-8 h-24 w-24 text-white/8" />
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-emerald-200">
                What belongs here
              </p>
              <ul className="mt-5 space-y-4 text-sm text-blue-50/85">
                <li className="flex gap-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                  Professional licences and memberships
                </li>
                <li className="flex gap-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                  Safety, compliance and technical training
                </li>
                <li className="flex gap-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                  Leadership and role-development courses
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="grid gap-px bg-border p-0 sm:grid-cols-4">
              {[
                {
                  label: "On file",
                  value: records.length,
                  icon: GraduationCap,
                  tone: "text-primary bg-primary/8",
                },
                {
                  label: "HR verified",
                  value: verified.length,
                  icon: ShieldCheck,
                  tone: "text-success bg-success/10",
                },
                {
                  label: "Renew within 60 days",
                  value: expiringSoon.length,
                  icon: CalendarClock,
                  tone: "text-warning bg-warning/10",
                },
                {
                  label: "Expired",
                  value: expired.length,
                  icon: Award,
                  tone: "text-destructive bg-destructive/8",
                },
              ].map(({ label, value, icon: Icon, tone }) => (
                <div key={label} className="flex items-center gap-3 bg-card p-5">
                  <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-2xl font-bold tabular-nums">{value}</p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Qualification</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead>Renewal</TableHead>
                  <TableHead>Verification</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => {
                  const days = record.expiryDate
                    ? differenceInCalendarDays(parseISO(record.expiryDate), today)
                    : undefined;
                  return (
                    <TableRow key={record.id}>
                      <TableCell className="font-semibold">{record.title}</TableCell>
                      <TableCell className="text-muted-foreground">{record.provider}</TableCell>
                      <TableCell>
                        {format(parseISO(record.completionDate), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        {record.expiryDate ? (
                          <span
                            className={
                              days !== undefined && days < 0
                                ? "font-semibold text-destructive"
                                : days !== undefined && days <= 60
                                  ? "font-semibold text-warning"
                                  : ""
                            }
                          >
                            {format(parseISO(record.expiryDate), "MMM d, yyyy")}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">No expiry</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={record.hrVerified ? "default" : "secondary"}
                            className="rounded-full"
                          >
                            {record.hrVerified ? "Verified" : "Awaiting HR"}
                          </Badge>
                          {record.certificateFileId && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => previewCertificate(record.id)}
                            >
                              <Eye /> Certificate
                            </Button>
                          )}
                          {canManageTraining && !record.hrVerified && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => verifyRecord(record.id)}
                            >
                              <ShieldCheck /> Verify
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </section>
  );
}
