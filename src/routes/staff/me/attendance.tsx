import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { eachDayOfInterval, endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  LocateFixed,
  MapPin,
  Navigation,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { getApplicationDataServices } from "@/lib/data/application-data";
import { AttendanceService } from "@/lib/data/attendance-service";
import type {
  AttendanceRecord,
  GeoReading,
  SiteVisitOrigin,
  SiteVisitRequest,
} from "@/lib/data/attendance-types";
import { getProjectRepository } from "@/lib/data/master-data";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/staff/me/attendance")({
  component: MyAttendanceRoute,
});

function getBrowserLocation(): Promise<GeoReading> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Location services are unavailable in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          capturedAt: new Date(position.timestamp).toISOString(),
        }),
      (error) => {
        const message =
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied. Enable location access in your browser and retry."
            : "Your location could not be confirmed. Move near a window and retry.";
        reject(new Error(message));
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (["Present", "Corrected", "Approved", "Completed"].includes(status)) return "default";
  if (["Absent", "Missing Punch", "Rejected"].includes(status)) return "destructive";
  if (["On Leave", "Holiday", "Rest Day", "Cancelled"].includes(status)) return "outline";
  return "secondary";
}

function MyAttendanceRoute() {
  const currentUser = useCurrentUser();
  const attendanceService = useMemo(() => new AttendanceService(), []);
  const projects = useMemo(
    () =>
      getProjectRepository()
        .list()
        .filter((item) => item.isActive),
    [],
  );
  const [revision, setRevision] = useState(0);
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date()));
  const [locating, setLocating] = useState(false);
  const [correctionRecord, setCorrectionRecord] = useState<AttendanceRecord | null>(null);
  const [correctionDate, setCorrectionDate] = useState("");
  const [proposedIn, setProposedIn] = useState("");
  const [proposedOut, setProposedOut] = useState("");
  const [explanation, setExplanation] = useState("");
  const [evidence, setEvidence] = useState<File | null>(null);
  const [submittingCorrection, setSubmittingCorrection] = useState(false);
  const [siteVisitOpen, setSiteVisitOpen] = useState(false);
  const [visitDate, setVisitDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [visitStart, setVisitStart] = useState("09:00");
  const [visitEnd, setVisitEnd] = useState("17:00");
  const [visitOrigin, setVisitOrigin] = useState<SiteVisitOrigin>("Office");
  const [visitDestination, setVisitDestination] = useState("");
  const [visitPurpose, setVisitPurpose] = useState("");
  const [visitProjectId, setVisitProjectId] = useState("");
  const [cancellingVisit, setCancellingVisit] = useState<SiteVisitRequest | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  const actorContext = useMemo(() => currentUser.getActorContext(), [currentUser]);
  const employeeId = currentUser.employeeId;

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        await attendanceService.hydrateFromDatabase(actorContext);
        if (active) setRevision((value) => value + 1);
      } catch (error) {
        if (active)
          toast.error(
            error instanceof Error ? error.message : "Attendance could not be refreshed.",
          );
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [actorContext, attendanceService]);

  if (!employeeId) return <div className="p-6">Employee profile required.</div>;

  const records = attendanceService.getRecordsForEmployee(employeeId, actorContext);
  const openRecord = attendanceService.getOpenRecord(employeeId, actorContext);
  const todayKey = format(new Date(), "yyyy-MM-dd");
  const todayOpenRecord = openRecord?.date === todayKey ? openRecord : null;
  const missedOpenRecord = attendanceService.getMissedOpenRecord(employeeId, actorContext);
  const siteVisits = attendanceService.getSiteVisitsForEmployee(employeeId, actorContext);
  const policy = attendanceService.getPolicy();
  const locations = attendanceService.getClockInLocations();
  const monthPrefix = format(currentMonth, "yyyy-MM");
  const summary = attendanceService.getMonthlySummary(employeeId, monthPrefix, actorContext);
  const corrections = attendanceService.getCorrectionsForEmployee(employeeId, actorContext);
  const correctionByRecord = new Map(corrections.map((item) => [item.attendanceRecordId, item]));
  const monthDays = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });
  const monthlyRows = monthDays
    .filter((day) => day <= new Date())
    .map((day) => {
      const date = format(day, "yyyy-MM-dd");
      const record = records.find((item) => item.date === date);
      if (record) return { ...record, virtual: false };
      const reconciled = attendanceService.reconcileDailyStatus(employeeId, date, actorContext);
      return {
        id: `virtual-${date}`,
        employeeId,
        date,
        status: reconciled?.status ?? "Absent",
        clockIn: undefined,
        clockOut: undefined,
        breakMinutes: 0,
        workMode: undefined,
        source: "Manual Entry" as const,
        calculatedHours: 0,
        isLate: false,
        isEarlyDeparture: false,
        virtual: true,
      };
    })
    .reverse();

  const performClockAction = async (action: "in" | "out") => {
    setLocating(true);
    try {
      const reading = await getBrowserLocation();
      const record = await attendanceService.clockAsync(employeeId, action, reading, actorContext);
      setRevision((value) => value + 1);
      toast.success(
        action === "in" ? `Clocked in at ${record.clockIn}.` : `Clocked out at ${record.clockOut}.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Attendance action failed.");
    } finally {
      setLocating(false);
    }
  };

  const openCorrection = (row: (typeof monthlyRows)[number]) => {
    const timestamp = new Date().toISOString();
    const record = row.virtual
      ? ({
          ...row,
          createdAt: timestamp,
          createdBy: currentUser.userId,
          updatedAt: timestamp,
          updatedBy: currentUser.userId,
          recordVersion: 0,
        } as AttendanceRecord)
      : (row as AttendanceRecord);
    setCorrectionRecord(record);
    setCorrectionDate(record.date);
    setProposedIn(record.clockIn ?? policy.expectedClockIn);
    setProposedOut(record.clockOut ?? policy.expectedClockOut);
    setExplanation("");
    setEvidence(null);
  };

  const submitCorrection = async () => {
    if (!correctionRecord) return;
    setSubmittingCorrection(true);
    let uploadedFileId: string | undefined;
    try {
      const persistedRecord = correctionRecord.id.startsWith("virtual-")
        ? attendanceService.ensureRecordForDate(employeeId, correctionRecord.date, actorContext)
        : correctionRecord;
      let evidenceFileId: string | undefined;
      if (evidence) {
        const metadata = await getApplicationDataServices().files.save(
          {
            blob: evidence,
            name: evidence.name,
            mimeType: evidence.type,
            owner: { entityType: "attendance-record", entityId: persistedRecord.id },
          },
          actorContext,
        );
        evidenceFileId = metadata.id;
        uploadedFileId = metadata.id;
      }
      await attendanceService.requestCorrectionAsync(
        persistedRecord.id,
        proposedIn,
        proposedOut,
        explanation,
        actorContext,
        evidenceFileId,
      );
      uploadedFileId = undefined;
      setCorrectionRecord(null);
      setRevision((value) => value + 1);
      toast.success("Correction submitted to your line manager.");
    } catch (error) {
      if (uploadedFileId) {
        await getApplicationDataServices().files.delete(uploadedFileId, {
          ...actorContext,
          reason: "Attendance correction failed before the evidence was attached",
        });
      }
      toast.error(error instanceof Error ? error.message : "Correction could not be submitted.");
    } finally {
      setSubmittingCorrection(false);
    }
  };

  const submitSiteVisit = async () => {
    try {
      await attendanceService.requestSiteVisitAsync(
        {
          employeeId,
          date: visitDate,
          startTime: visitStart,
          endTime: visitEnd,
          origin: visitOrigin,
          destination: visitDestination,
          purpose: visitPurpose,
          projectId: visitProjectId || undefined,
        },
        actorContext,
      );
      setSiteVisitOpen(false);
      setVisitDestination("");
      setVisitPurpose("");
      setRevision((value) => value + 1);
      toast.success("Site visit sent to HR for approval.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Site visit could not be submitted.");
    }
  };

  const cancelVisit = async () => {
    if (!cancellingVisit) return;
    setCancelling(true);
    try {
      await attendanceService.cancelSiteVisitAsync(
        cancellingVisit.id,
        cancellationReason,
        actorContext,
      );
      setCancellingVisit(null);
      setCancellationReason("");
      setRevision((value) => value + 1);
      toast.success("Site visit cancelled.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Site visit could not be cancelled.");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <RequirePermission permission="attendance:view_self" resourceName="My Attendance">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 pb-10" data-revision={revision}>
        <PageHeader
          title="My Attendance"
          description="Office-verified attendance, corrections and approved site visits."
          actions={
            <Button variant="outline" onClick={() => setSiteVisitOpen(true)}>
              <Navigation className="mr-2 h-4 w-4" /> Request Site Visit
            </Button>
          }
        />

        {locations.length === 0 && (
          <Alert variant="destructive">
            <MapPin className="h-4 w-4" />
            <AlertTitle>Office attendance is not configured</AlertTitle>
            <AlertDescription>
              HR must capture the office location before staff can clock in or out.
            </AlertDescription>
          </Alert>
        )}

        <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/[0.08] to-background">
          <CardContent className="grid gap-6 p-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant={todayOpenRecord ? "default" : "outline"}>
                  {todayOpenRecord ? "Attendance open" : "Not clocked in today"}
                </Badge>
                {todayOpenRecord?.workMode && (
                  <Badge variant="secondary">{todayOpenRecord.workMode}</Badge>
                )}
              </div>
              <h2 className="text-2xl font-semibold">
                {todayOpenRecord
                  ? `Clocked in at ${todayOpenRecord.clockIn}`
                  : "Verify your office location to begin"}
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                {todayOpenRecord
                  ? `The system will issue three reminders after ${policy.standardDailyHours} worked hours while this record remains open.`
                  : `Clocking is allowed only inside an active VIA office zone with browser accuracy of ${policy.maximumLocationAccuracyMeters} metres or better.`}
              </p>
              {missedOpenRecord && (
                <Alert className="mt-4 border-amber-300 bg-amber-50 text-amber-950">
                  <Clock className="h-4 w-4" />
                  <AlertTitle>Sign-out was missed</AlertTitle>
                  <AlertDescription>
                    Provide the correct time and justification. Your manager and HR must approve it.
                  </AlertDescription>
                </Alert>
              )}
            </div>
            <div className="flex flex-col gap-2 sm:min-w-52">
              {!todayOpenRecord ? (
                <Button
                  size="lg"
                  disabled={locating || locations.length === 0}
                  onClick={() => void performClockAction("in")}
                >
                  <LocateFixed className="mr-2 h-5 w-5" />
                  {locating ? "Verifying…" : "Clock In"}
                </Button>
              ) : (
                <Button
                  size="lg"
                  disabled={locating}
                  onClick={() => void performClockAction("out")}
                >
                  <CheckCircle2 className="mr-2 h-5 w-5" />
                  {locating ? "Verifying…" : "Clock Out"}
                </Button>
              )}
              {missedOpenRecord && (
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => openCorrection({ ...missedOpenRecord, virtual: false })}
                >
                  <Clock className="mr-2 h-5 w-5" /> Submit Missed Sign-out
                </Button>
              )}
              <span className="text-center text-xs text-muted-foreground">
                High-accuracy browser location required
              </span>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="attendance">
          <TabsList>
            <TabsTrigger value="attendance">Attendance</TabsTrigger>
            <TabsTrigger value="site-visits">Site Visits ({siteVisits.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="attendance" className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              {[
                ["Present", summary.present],
                ["Worked Hours", summary.hours],
                ["Late", summary.late],
                ["Absent", summary.absent],
                ["Missing Punch", summary.missingPunch],
              ].map(([label, value]) => (
                <Card key={String(label)}>
                  <CardContent className="p-4">
                    <p className="text-sm text-muted-foreground">{label}</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <h3 className="text-lg font-semibold">{format(currentMonth, "MMMM yyyy")}</h3>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    setCurrentMonth(
                      startOfMonth(
                        new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1),
                      ),
                    )
                  }
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  disabled={format(currentMonth, "yyyy-MM") >= format(new Date(), "yyyy-MM")}
                  onClick={() =>
                    setCurrentMonth(
                      startOfMonth(
                        new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1),
                      ),
                    )
                  }
                >
                  Next
                </Button>
              </div>
            </div>

            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Clock In</TableHead>
                      <TableHead>Clock Out</TableHead>
                      <TableHead>Hours</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {monthlyRows.map((row) => {
                      const correction = correctionByRecord.get(row.id);
                      const canCorrect = ["Absent", "Late", "Missing Punch"].includes(row.status);
                      return (
                        <TableRow key={row.date}>
                          <TableCell>
                            <span className="font-medium">
                              {format(parseISO(row.date), "dd MMM")}
                            </span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {format(parseISO(row.date), "EEE")}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                          </TableCell>
                          <TableCell>{row.clockIn ?? "—"}</TableCell>
                          <TableCell>{row.clockOut ?? "—"}</TableCell>
                          <TableCell>
                            {row.calculatedHours ? `${row.calculatedHours}h` : "—"}
                          </TableCell>
                          <TableCell>{row.workMode ?? "—"}</TableCell>
                          <TableCell className="text-right">
                            {correction ? (
                              <Badge variant="secondary">{correction.status}</Badge>
                            ) : canCorrect ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openCorrection(row)}
                              >
                                Correct
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="site-visits" className="space-y-4">
            <Alert>
              <Navigation className="h-4 w-4" />
              <AlertTitle>How site attendance works</AlertTitle>
              <AlertDescription>
                Office-origin visits require a verified office clock-in. Home-origin visits are
                automatically clocked in and out at the HR-approved times.
              </AlertDescription>
            </Alert>
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date and Time</TableHead>
                      <TableHead>Destination</TableHead>
                      <TableHead>Origin</TableHead>
                      <TableHead>Purpose</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {siteVisits.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="h-28 text-center text-muted-foreground">
                          No site visits requested.
                        </TableCell>
                      </TableRow>
                    ) : (
                      siteVisits.map((visit) => (
                        <TableRow key={visit.id}>
                          <TableCell>
                            <span className="block font-medium">{visit.date}</span>
                            <span className="text-xs text-muted-foreground">
                              {visit.startTime}–{visit.endTime}
                            </span>
                          </TableCell>
                          <TableCell>{visit.destination}</TableCell>
                          <TableCell>{visit.origin}</TableCell>
                          <TableCell className="max-w-80 truncate" title={visit.purpose}>
                            {visit.purpose}
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusVariant(visit.status)}>{visit.status}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {(visit.status === "Pending HR" || visit.status === "Approved") &&
                            visit.date >= format(new Date(), "yyyy-MM-dd") ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setCancellingVisit(visit)}
                              >
                                Cancel visit
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">No action</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog
          open={Boolean(correctionRecord)}
          onOpenChange={(open) => !open && setCorrectionRecord(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {correctionRecord &&
                !correctionRecord.clockOut &&
                correctionDate < format(new Date(), "yyyy-MM-dd")
                  ? "Missed Sign-out Justification"
                  : "Request Attendance Correction"}
              </DialogTitle>
              <DialogDescription>
                Original punches are preserved. Your line manager reviews first, followed by HR.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="proposed-in" className="text-sm font-medium">
                  Clock In
                </label>
                <Input
                  id="proposed-in"
                  type="time"
                  value={proposedIn}
                  onChange={(event) => setProposedIn(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="proposed-out" className="text-sm font-medium">
                  Clock Out
                </label>
                <Input
                  id="proposed-out"
                  type="time"
                  value={proposedOut}
                  onChange={(event) => setProposedOut(event.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label htmlFor="correction-explanation" className="text-sm font-medium">
                  Justification
                </label>
                <Textarea
                  id="correction-explanation"
                  value={explanation}
                  onChange={(event) => setExplanation(event.target.value)}
                  placeholder="Explain what happened and confirm the actual working times."
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label htmlFor="correction-evidence" className="text-sm font-medium">
                  Evidence (optional)
                </label>
                <Input
                  id="correction-evidence"
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(event) => setEvidence(event.target.files?.[0] ?? null)}
                />
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Upload className="h-3 w-3" /> Images and PDF evidence are stored securely with
                  this request.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCorrectionRecord(null)}>
                Cancel
              </Button>
              <Button
                disabled={
                  submittingCorrection ||
                  !proposedIn ||
                  !proposedOut ||
                  explanation.trim().length < 5
                }
                onClick={() => void submitCorrection()}
              >
                {submittingCorrection ? "Submitting…" : "Submit for Approval"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog
          open={Boolean(cancellingVisit)}
          onOpenChange={(open) => {
            if (!open && !cancelling) {
              setCancellingVisit(null);
              setCancellationReason("");
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel this site visit?</AlertDialogTitle>
              <AlertDialogDescription>
                HR will see that the request was cancelled. Enter a short reason for the record.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Textarea
              aria-label="Cancellation reason"
              value={cancellationReason}
              onChange={(event) => setCancellationReason(event.target.value)}
              placeholder="Why is this visit no longer required?"
            />
            <AlertDialogFooter>
              <AlertDialogCancel disabled={cancelling}>Keep visit</AlertDialogCancel>
              <AlertDialogAction
                disabled={cancelling || cancellationReason.trim().length < 5}
                onClick={(event) => {
                  event.preventDefault();
                  void cancelVisit();
                }}
              >
                {cancelling ? "Cancelling..." : "Cancel visit"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog open={siteVisitOpen} onOpenChange={setSiteVisitOpen}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Request Site Visit</DialogTitle>
              <DialogDescription>
                HR approval is required before the visit can affect attendance.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="visit-date" className="text-sm font-medium">
                  Date
                </label>
                <Input
                  id="visit-date"
                  type="date"
                  min={format(new Date(), "yyyy-MM-dd")}
                  value={visitDate}
                  onChange={(event) => setVisitDate(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Starting From</label>
                <Select
                  value={visitOrigin}
                  onValueChange={(value) => setVisitOrigin(value as SiteVisitOrigin)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Office">Office — I will clock in</SelectItem>
                    <SelectItem value="Home">Home — automatic attendance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label htmlFor="visit-start" className="text-sm font-medium">
                  Start Time
                </label>
                <Input
                  id="visit-start"
                  type="time"
                  value={visitStart}
                  onChange={(event) => setVisitStart(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="visit-end" className="text-sm font-medium">
                  End Time
                </label>
                <Input
                  id="visit-end"
                  type="time"
                  value={visitEnd}
                  onChange={(event) => setVisitEnd(event.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label htmlFor="visit-destination" className="text-sm font-medium">
                  Site / Destination
                </label>
                <Input
                  id="visit-destination"
                  value={visitDestination}
                  onChange={(event) => setVisitDestination(event.target.value)}
                  placeholder="e.g. Al Mouj project site"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">Project (optional)</label>
                <Select
                  value={visitProjectId || "none"}
                  onValueChange={(value) => setVisitProjectId(value === "none" ? "" : value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No project</SelectItem>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label htmlFor="visit-purpose" className="text-sm font-medium">
                  Business Purpose
                </label>
                <Textarea
                  id="visit-purpose"
                  value={visitPurpose}
                  onChange={(event) => setVisitPurpose(event.target.value)}
                  placeholder="Explain why the site visit is required."
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSiteVisitOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={!visitDate || !visitDestination.trim() || visitPurpose.trim().length < 5}
                onClick={submitSiteVisit}
              >
                <CalendarDays className="mr-2 h-4 w-4" /> Send to HR
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </RequirePermission>
  );
}
