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
import { DashboardCharts } from "@/components/dashboards/dashboard-charts";

import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { getApplicationDataServices } from "@/lib/data/application-data";
import { AttendanceService } from "@/lib/data/attendance-service";
import {
  siteVisitLocalNow,
  siteVisitReturnLabel,
  type SiteVisitReturnPlan,
} from "@/lib/data/site-visit";
import { SettingsService } from "@/lib/data/settings-service";
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
  validateSearch: (search: Record<string, unknown>): { action?: "site-visit" } =>
    search["action"] === "site-visit" ? { action: "site-visit" } : {},
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
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const currentUser = useCurrentUser();
  const attendanceService = useMemo(() => new AttendanceService(), []);
  const officeTimezone =
    attendanceService
      .getLocations()
      .find((location) => location.name === currentUser.currentEmployee?.location)?.timezone ||
    new SettingsService().getAppSettingsSync().timezone;
  const localNow = siteVisitLocalNow(officeTimezone);
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
  const [siteVisitOpen, setSiteVisitOpen] = useState(search.action === "site-visit");
  const [visitDate, setVisitDate] = useState(localNow.date);
  const [visitStart, setVisitStart] = useState(localNow.time);
  const [visitEnd, setVisitEnd] = useState("17:00");
  const [visitOrigin, setVisitOrigin] = useState<SiteVisitOrigin>("Home");
  const [returnPlan, setReturnPlan] = useState<SiteVisitReturnPlan>("Unknown");
  const [submittingVisit, setSubmittingVisit] = useState(false);
  const [progressVisit, setProgressVisit] = useState<SiteVisitRequest | null>(null);
  const [progressAction, setProgressAction] = useState<"finish" | "extend">("finish");
  const [extensionEnd, setExtensionEnd] = useState("18:00");
  const [extensionReason, setExtensionReason] = useState("");
  const [savingProgress, setSavingProgress] = useState(false);
  const [visitDestination, setVisitDestination] = useState("");
  const [visitPurpose, setVisitPurpose] = useState("");
  const [visitKind, setVisitKind] = useState("Site visit");
  const [visitOptionsOpen, setVisitOptionsOpen] = useState(false);
  const [visitTimeAdjusted, setVisitTimeAdjusted] = useState(false);
  const [visitProjectId, setVisitProjectId] = useState("");
  const [cancellingVisit, setCancellingVisit] = useState<SiteVisitRequest | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  const actorContext = useMemo(() => currentUser.getActorContext(), [currentUser]);
  const employeeId = currentUser.employeeId;

  useEffect(() => {
    if (search.action === "site-visit") setSiteVisitOpen(true);
  }, [search.action]);
  const closeSiteVisit = () => {
    setSiteVisitOpen(false);
    setVisitOptionsOpen(false);
    setVisitTimeAdjusted(false);
    setReturnPlan("Unknown");
    setVisitProjectId("");
    if (search.action) void navigate({ search: {}, replace: true });
  };

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
  const todayKey = localNow.date;
  const todayOpenRecord = openRecord?.date === todayKey ? openRecord : null;
  const missedOpenRecord = attendanceService.getMissedOpenRecord(employeeId, actorContext);
  const siteVisits = attendanceService.getSiteVisitsForEmployee(employeeId, actorContext);
  const todayVisits = siteVisits.filter(
    (visit) =>
      visit.date === todayKey &&
      ["Pending HR", "Approved"].includes(visit.status) &&
      visit.startTime <= localNow.time,
  );
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
        status: siteVisits.some((visit) => visit.date === date && visit.status === "Pending HR")
          ? "Site visit — awaiting HR"
          : (reconciled?.status ?? "Absent"),
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

  const performClockAction = async (action: "in" | "out", returning = false) => {
    setLocating(true);
    try {
      const reading = await getBrowserLocation();
      const record = await attendanceService.clockAsync(
        employeeId,
        action,
        reading,
        actorContext,
        returning,
      );
      setRevision((value) => value + 1);
      toast.success(
        returning
          ? "Return to office recorded. Clock out normally when you finish."
          : action === "in"
            ? `Clocked in at ${record.clockIn}.`
            : `Clocked out at ${record.clockOut}.`,
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
      const isMissingRecord = correctionRecord.id.startsWith("virtual-");
      let evidenceFileId: string | undefined;
      if (evidence) {
        const metadata = await getApplicationDataServices().files.save(
          {
            blob: evidence,
            name: evidence.name,
            mimeType: evidence.type,
            owner: { entityType: "attendance-record", entityId: correctionRecord.id },
          },
          actorContext,
        );
        evidenceFileId = metadata.id;
        uploadedFileId = metadata.id;
      }
      await attendanceService.requestCorrectionAsync(
        correctionRecord.id,
        proposedIn,
        proposedOut,
        explanation,
        actorContext,
        evidenceFileId,
        isMissingRecord ? { employeeId, date: correctionRecord.date } : undefined,
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
    if (submittingVisit) return;
    setSubmittingVisit(true);
    try {
      await attendanceService.requestSiteVisitAsync(
        {
          employeeId,
          date: visitTimeAdjusted ? visitDate : siteVisitLocalNow(officeTimezone).date,
          startTime: visitTimeAdjusted ? visitStart : siteVisitLocalNow(officeTimezone).time,
          endTime: "17:00",
          details: {
            returnPlan,
            ...(returnPlan === "Time" ? { expectedReturnTime: visitEnd } : {}),
          },
          origin: visitOrigin,
          destination: visitDestination,
          purpose: `${visitKind}${visitPurpose.trim() ? `: ${visitPurpose.trim()}` : " — official duty"}`,
          projectId: visitProjectId || undefined,
        },
        actorContext,
      );
      closeSiteVisit();
      setVisitDestination("");
      setVisitPurpose("");
      setRevision((value) => value + 1);
      toast.success(
        "Site visit recorded. HR and your supervisor have been notified; attendance awaits HR confirmation.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Site visit could not be submitted.");
    } finally {
      setSubmittingVisit(false);
    }
  };

  const saveProgress = async () => {
    if (!progressVisit || savingProgress) return;
    setSavingProgress(true);
    try {
      await attendanceService.updateSiteVisitProgressAsync(
        progressVisit.id,
        progressAction,
        actorContext,
        progressAction === "extend" ? extensionEnd : undefined,
        progressAction === "extend" ? extensionReason : undefined,
      );
      setProgressVisit(null);
      setExtensionReason("");
      setRevision((value) => value + 1);
      toast.success(
        progressAction === "finish"
          ? "Duty finish recorded. Attendance is updated after HR confirmation."
          : "Extension sent to HR. Overtime is not automatically approved.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update visit.");
    } finally {
      setSavingProgress(false);
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
              <Navigation className="mr-2 h-4 w-4" /> Quick visit
            </Button>
          }
        />

        {todayVisits.map((visit) => (
          <Alert key={visit.id}>
            <Navigation className="h-4 w-4" />
            <AlertTitle>
              {visit.details?.finishedAt
                ? "Site duty finished"
                : visit.details?.returnedAt
                  ? "Returned from site"
                  : "On site"}
              {visit.status === "Pending HR" ? " — awaiting HR confirmation" : " — approved"}
            </AlertTitle>
            <AlertDescription>
              {visit.destination} · {siteVisitReturnLabel(visit.details)}.{" "}
              {visit.status === "Pending HR"
                ? "This is provisional; attendance will be finalised after HR confirmation."
                : `Attendance close: ${visit.endTime}, unless you finish earlier or return to the office.`}
            </AlertDescription>
          </Alert>
        ))}

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
              {siteVisits.some(
                (visit) =>
                  visit.date === todayKey &&
                  !visit.details?.finishedAt &&
                  !visit.details?.returnedAt &&
                  ["Pending HR", "Approved"].includes(visit.status),
              ) && (
                <>
                  <Button
                    variant="outline"
                    disabled={locating}
                    onClick={() => void performClockAction("in", true)}
                  >
                    Back at office
                  </Button>
                  <p className="max-w-64 text-xs text-muted-foreground">
                    Confirm your return using office location verification. Normal office clock-out
                    then applies.
                  </p>
                </>
              )}
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

        <DashboardCharts scope="self" />

        <Tabs defaultValue="attendance">
          <TabsList>
            <TabsTrigger value="attendance">Attendance</TabsTrigger>
            <TabsTrigger value="site-visits">Visits ({siteVisits.length})</TabsTrigger>
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
                Record same-day visits even if your return time is uncertain. HR confirms
                attendance; your supervisor is notified. Expected return is only an estimate.
                Attendance closes at 5 PM unless you finish earlier, return to the office, or HR
                approves an extension.
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
                            <Badge variant={statusVariant(visit.status)}>
                              {visit.status === "Pending HR"
                                ? "Awaiting HR confirmation"
                                : visit.status}
                            </Badge>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {siteVisitReturnLabel(visit.details)}
                            </p>
                            {visit.details?.finishedAt && (
                              <p className="text-xs">
                                Duty finished {format(parseISO(visit.details.finishedAt), "HH:mm")}
                              </p>
                            )}
                            {visit.details?.returnedAt && (
                              <p className="text-xs">Returned to office</p>
                            )}
                            {visit.details?.attendanceClosedAt && (
                              <p className="text-xs">
                                {visit.details.attendanceCloseKind} clock-out:{" "}
                                {
                                  siteVisitLocalNow(
                                    officeTimezone,
                                    new Date(visit.details.attendanceClosedAt),
                                  ).time
                                }
                              </p>
                            )}
                            {visit.details?.extension && (
                              <p className="text-xs">
                                Extension to {visit.details.extension.endTime}:{" "}
                                {visit.details.extension.status}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {visit.details?.returnPlan &&
                              visit.date === todayKey &&
                              ["Pending HR", "Approved"].includes(visit.status) &&
                              !visit.details.finishedAt &&
                              !visit.details.returnedAt && (
                                <div className="mb-2 flex flex-wrap justify-end gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setProgressVisit(visit);
                                      setProgressAction("finish");
                                    }}
                                  >
                                    Finish duty
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={visit.details.extension?.status === "Pending"}
                                    onClick={() => {
                                      setProgressVisit(visit);
                                      setProgressAction("extend");
                                    }}
                                  >
                                    Request extension
                                  </Button>
                                </div>
                              )}
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

        <Dialog
          open={Boolean(progressVisit)}
          onOpenChange={(open) => !open && !savingProgress && setProgressVisit(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {progressAction === "finish" ? "Finish site duty" : "Request a later finish"}
              </DialogTitle>
              <DialogDescription>
                {progressAction === "finish"
                  ? "Record your actual finish now. If you are returning to work in the office, use Back at office instead. Attendance still requires HR confirmation."
                  : "HR must confirm the extension. Until then, the existing attendance close remains in place. This is not overtime approval."}
              </DialogDescription>
            </DialogHeader>
            {progressAction === "extend" && (
              <div className="space-y-3">
                <label htmlFor="extension-end">Requested finish time</label>
                <Input
                  id="extension-end"
                  type="time"
                  value={extensionEnd}
                  onChange={(event) => setExtensionEnd(event.target.value)}
                />
                <label htmlFor="extension-reason">Reason</label>
                <Textarea
                  id="extension-reason"
                  value={extensionReason}
                  onChange={(event) => setExtensionReason(event.target.value)}
                />
              </div>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={savingProgress}
                onClick={() => setProgressVisit(null)}
              >
                Cancel
              </Button>
              <Button
                disabled={
                  savingProgress ||
                  (progressAction === "extend" && extensionReason.trim().length < 5)
                }
                onClick={() => void saveProgress()}
              >
                {savingProgress
                  ? "Saving…"
                  : progressAction === "finish"
                    ? "Finish duty now"
                    : "Send extension to HR"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={siteVisitOpen}
          onOpenChange={(open) => (open ? setSiteVisitOpen(true) : closeSiteVisit())}
        >
          <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Quick visit</DialogTitle>
              <DialogDescription>
                Heading to a site, ministry or client? Choose the type, enter the destination and
                go. HR and your supervisor are notified. Planned trips belong in Requests.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Visit type</legend>
                <div className="flex flex-wrap gap-2">
                  {["Site visit", "Ministry visit", "Client visit", "Other duty"].map((kind) => (
                    <Button
                      key={kind}
                      type="button"
                      size="sm"
                      variant={visitKind === kind ? "default" : "outline"}
                      aria-pressed={visitKind === kind}
                      onClick={() => setVisitKind(kind)}
                    >
                      {kind}
                    </Button>
                  ))}
                </div>
              </fieldset>
              <div className="space-y-2">
                <label htmlFor="visit-destination" className="text-sm font-medium">
                  Site / Destination
                </label>
                <Input
                  id="visit-destination"
                  value={visitDestination}
                  onChange={(event) => setVisitDestination(event.target.value)}
                  placeholder="e.g. Ministry of Labour or Al Mouj site"
                />
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Starting from</legend>
                <div className="flex gap-2">
                  {(["Home", "Office"] as const).map((origin) => (
                    <Button
                      key={origin}
                      type="button"
                      size="sm"
                      variant={visitOrigin === origin ? "default" : "outline"}
                      aria-pressed={visitOrigin === origin}
                      onClick={() => setVisitOrigin(origin)}
                    >
                      {origin}
                    </Button>
                  ))}
                </div>
              </fieldset>
              <p className="text-xs text-muted-foreground">
                {visitTimeAdjusted ? `${visitDate} · ${visitStart}` : "Today · starting now"} ·{" "}
                {siteVisitReturnLabel({ returnPlan, expectedReturnTime: visitEnd })}. Default close
                is 5 PM after HR confirmation. From the office, clock in normally first.
              </p>
            </div>
            <details
              open={visitOptionsOpen}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                if (open && !visitOptionsOpen && !visitTimeAdjusted) {
                  const now = siteVisitLocalNow(officeTimezone);
                  setVisitDate(now.date);
                  setVisitStart(now.time);
                }
                setVisitOptionsOpen(open);
              }}
            >
              <summary className="cursor-pointer text-sm font-medium">
                Change time, return or add details (optional)
              </summary>
              <div className="grid gap-4 py-2 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="visit-date" className="text-sm font-medium">
                    Date
                  </label>
                  <Input
                    id="visit-date"
                    type="date"
                    min={todayKey}
                    value={visitDate}
                    onChange={(event) => {
                      setVisitDate(event.target.value);
                      setVisitTimeAdjusted(true);
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="visit-start" className="text-sm font-medium">
                    Start Time
                  </label>
                  <Input
                    id="visit-start"
                    type="time"
                    value={visitStart}
                    onChange={(event) => {
                      setVisitStart(event.target.value);
                      setVisitTimeAdjusted(true);
                    }}
                  />
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    onClick={() => setVisitStart(siteVisitLocalNow(officeTimezone).time)}
                  >
                    Use current time
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    You can enter an earlier time today. HR confirms the actual duty start. Times
                    use {officeTimezone}.
                  </p>
                </div>
                <div className="space-y-2">
                  <label htmlFor="visit-return" className="text-sm font-medium">
                    Expected return
                  </label>
                  <Select
                    value={returnPlan}
                    onValueChange={(value) => setReturnPlan(value as SiteVisitReturnPlan)}
                  >
                    <SelectTrigger id="visit-return">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Unknown">Not sure</SelectItem>
                      <SelectItem value="Not returning">Not returning today</SelectItem>
                      <SelectItem value="Time">I expect to return at…</SelectItem>
                    </SelectContent>
                  </Select>
                  {returnPlan === "Time" && (
                    <Input
                      id="visit-end"
                      type="time"
                      value={visitEnd}
                      onChange={(event) => setVisitEnd(event.target.value)}
                    />
                  )}
                  <p className="text-xs text-muted-foreground">
                    An estimate only. Default attendance close: 5 PM, not the estimated return time.
                  </p>
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
                    Business Purpose (optional)
                  </label>
                  <Textarea
                    id="visit-purpose"
                    value={visitPurpose}
                    onChange={(event) => setVisitPurpose(event.target.value)}
                    placeholder="Explain why the site visit is required."
                  />
                </div>
              </div>
            </details>
            <DialogFooter>
              <Button variant="outline" onClick={closeSiteVisit}>
                Cancel
              </Button>
              <Button
                disabled={submittingVisit || !visitDate || visitDestination.trim().length < 3}
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
