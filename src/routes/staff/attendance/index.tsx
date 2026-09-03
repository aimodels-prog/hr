import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  CheckCircle2,
  Download,
  FileUp,
  LocateFixed,
  MapPin,
  PencilLine,
  Settings2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { LocationMap } from "@/components/attendance/location-map";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { AttendanceService } from "@/lib/data/attendance-service";
import type {
  AttendanceExceptionCase,
  AttendanceImportPreview,
  AttendanceLocation,
  AttendanceSource,
  GeoReading,
  SiteVisitRequest,
} from "@/lib/data/attendance-types";
import { EmployeeService } from "@/lib/data/employee-service";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

export const Route = createFileRoute("/staff/attendance/")({
  component: AttendanceAdminRoute,
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
        }),
      () =>
        reject(
          new Error("Location could not be captured. Allow browser location access and retry."),
        ),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });
}

function downloadText(filename: string, content: string, mimeType: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function AttendanceAdminRoute() {
  return (
    <RequirePermission permission="attendance:manage_all" resourceName="Attendance Administration">
      <AttendanceAdminContent />
    </RequirePermission>
  );
}

function AttendanceAdminContent() {
  const currentUser = useCurrentUser();
  const attendanceService = useMemo(() => new AttendanceService(), []);
  const employeeService = useMemo(() => new EmployeeService(), []);
  const [revision, setRevision] = useState(0);
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [statusFilter, setStatusFilter] = useState("All");
  const [manualOpen, setManualOpen] = useState(false);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [manualEmployeeId, setManualEmployeeId] = useState("");
  const [manualClockIn, setManualClockIn] = useState("09:00");
  const [manualClockOut, setManualClockOut] = useState("18:00");
  const [manualBreak, setManualBreak] = useState("60");
  const [manualShiftId, setManualShiftId] = useState("Standard Day");
  const [manualLocation, setManualLocation] = useState("");
  const [manualSource, setManualSource] =
    useState<Extract<AttendanceSource, "Hardware Terminal" | "Manual Entry">>("Manual Entry");
  const [csvPreview, setCsvPreview] = useState<AttendanceImportPreview | null>(null);
  const [reviewVisit, setReviewVisit] = useState<SiteVisitRequest | null>(null);
  const [decisionNotes, setDecisionNotes] = useState("");
  const [caseDialog, setCaseDialog] = useState<AttendanceExceptionCase | null>(null);
  const [caseNotes, setCaseNotes] = useState("");
  const [officeLocationId, setOfficeLocationId] = useState("");
  const [officeRadius, setOfficeRadius] = useState("150");
  const [capturingOffice, setCapturingOffice] = useState(false);
  const [officePreview, setOfficePreview] = useState<GeoReading | null>(null);
  const policy = attendanceService.getPolicy();
  const [standardHours, setStandardHours] = useState(String(policy.standardDailyHours));
  const [expectedIn, setExpectedIn] = useState(policy.expectedClockIn);
  const [expectedOut, setExpectedOut] = useState(policy.expectedClockOut);
  const [defaultBreak, setDefaultBreak] = useState(String(policy.defaultBreakMinutes));
  const [lateGrace, setLateGrace] = useState(String(policy.lateGraceMinutes));
  const [maxAccuracy, setMaxAccuracy] = useState(String(policy.maximumLocationAccuracyMeters));
  const [approvedNetworks, setApprovedNetworks] = useState(
    policy.approvedNetworkCidrs?.join(", ") ?? "",
  );
  const [policyReason, setPolicyReason] = useState("");
  const actorContext = useMemo(() => currentUser.getActorContext(), [currentUser]);

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
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [actorContext, attendanceService]);

  const employees = employeeService
    .getEmployees(actorContext)
    .filter((employee) => !["Archived", "Inactive"].includes(employee.status));
  const allRecords = attendanceService.getAllRecords(actorContext);
  const locations = attendanceService.getLocations();
  const clockInLocations = attendanceService.getClockInLocations();
  const siteVisits = attendanceService.getAllSiteVisits(actorContext);
  const pendingSiteVisits = siteVisits.filter((visit) => visit.status === "Pending HR");
  const exceptionCases = attendanceService.getExceptionCases(actorContext);
  const openExceptionCases = exceptionCases.filter((item) => item.status !== "Resolved");
  const currentRows = employees
    .map((employee) => {
      const record = allRecords.find(
        (item) => item.employeeId === employee.id && item.date === date,
      );
      if (record) return { employee, ...record };
      const reconciled = attendanceService.reconcileDailyStatus(employee.id, date, actorContext);
      return {
        employee,
        id: `virtual-${employee.id}-${date}`,
        date,
        status: reconciled?.status ?? "Absent",
        clockIn: undefined,
        clockOut: undefined,
        calculatedHours: 0,
        source: "Updated automatically",
      };
    })
    .filter((row) => {
      if (statusFilter === "All") return true;
      if (statusFilter === "Exceptions") {
        return ["Late", "Absent", "Missing Punch", "Correction Pending"].includes(row.status);
      }
      return row.status === statusFilter;
    });

  const saveManualRecord = async () => {
    try {
      const recordData: Parameters<AttendanceService["saveRecord"]>[0] = {
        employeeId: manualEmployeeId,
        date,
        shiftId: manualShiftId || undefined,
        expectedClockIn: expectedIn,
        expectedClockOut: expectedOut,
        clockIn: manualClockIn || undefined,
        clockOut: manualClockOut || undefined,
        breakMinutes: Number(manualBreak),
        location: manualLocation || undefined,
        source: manualSource,
        workMode: "Office",
        status: "Present",
        calculatedHours: 0,
        isLate: false,
        isEarlyDeparture: false,
      };
      await attendanceService.saveRecordAsync(
        recordData,
        {
          ...actorContext,
          reason: editingRecordId
            ? "HR corrected an attendance record"
            : "HR manual attendance entry",
        },
        editingRecordId ?? undefined,
      );
      setManualOpen(false);
      setEditingRecordId(null);
      setRevision((value) => value + 1);
      toast.success("Attendance record saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Attendance record could not be saved.");
    }
  };

  const loadCsv = async (file: File | undefined) => {
    if (!file) return;
    try {
      setCsvPreview(attendanceService.previewCsv(await file.text()));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "CSV could not be read.");
    }
  };

  const commitCsv = async () => {
    if (!csvPreview || csvPreview.errors.length > 0) return;
    try {
      const imported = await attendanceService.importRowsAsync(csvPreview.validRows, {
        ...actorContext,
        reason: "Validated attendance CSV import",
      });
      setCsvPreview(null);
      setRevision((value) => value + 1);
      toast.success(`${imported} attendance records imported.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed.");
    }
  };

  const locateOffice = async () => {
    setCapturingOffice(true);
    try {
      const reading = await getBrowserLocation();
      setOfficePreview(reading);
      toast.success("Current location found. Confirm the point on the map before saving.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Current location could not be captured.",
      );
    } finally {
      setCapturingOffice(false);
    }
  };

  const captureOffice = async () => {
    if (!officeLocationId) {
      toast.error("Select the office location first.");
      return;
    }
    if (!officePreview) {
      toast.error("Show your current location on the map first.");
      return;
    }
    try {
      const location = await attendanceService.configureOfficeLocation(
        officeLocationId,
        officePreview,
        Number(officeRadius),
        actorContext,
      );
      setRevision((value) => value + 1);
      toast.success(`${location.name} is now the verified office attendance zone.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Office location could not be captured.",
      );
    }
  };

  const savePolicy = async () => {
    try {
      await attendanceService.savePolicyAsync(
        {
          standardDailyHours: Number(standardHours),
          expectedClockIn: expectedIn,
          expectedClockOut: expectedOut,
          defaultBreakMinutes: Number(defaultBreak),
          lateGraceMinutes: Number(lateGrace),
          maximumLocationAccuracyMeters: Number(maxAccuracy),
          signOutReminderOffsetsMinutes: [0, 15, 30],
        },
        approvedNetworks
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        policyReason,
        actorContext,
      );
      setPolicyReason("");
      setRevision((value) => value + 1);
      toast.success("Attendance policy updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Policy could not be saved.");
    }
  };

  const decideVisit = async (approve: boolean) => {
    if (!reviewVisit) return;
    try {
      await attendanceService.reviewSiteVisitAsync(
        reviewVisit.id,
        approve,
        decisionNotes,
        actorContext,
      );
      setReviewVisit(null);
      setDecisionNotes("");
      setRevision((value) => value + 1);
      toast.success(approve ? "Site visit approved." : "Site visit rejected.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Decision could not be saved.");
    }
  };

  const assignCaseToMe = async (item: AttendanceExceptionCase) => {
    try {
      await attendanceService.investigateExceptionCaseAsync(
        item.id,
        { assignToMe: true },
        actorContext,
      );
      setRevision((value) => value + 1);
      toast.success("Case assigned to you.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not assign case.");
    }
  };

  const saveCaseNotes = async () => {
    if (!caseDialog) return;
    try {
      await attendanceService.investigateExceptionCaseAsync(
        caseDialog.id,
        { notes: caseNotes },
        actorContext,
      );
      setCaseDialog(null);
      setCaseNotes("");
      setRevision((value) => value + 1);
      toast.success("Investigation notes saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save notes.");
    }
  };

  const resolveCase = async () => {
    if (!caseDialog) return;
    try {
      await attendanceService.resolveExceptionCaseAsync(caseDialog.id, caseNotes, actorContext);
      setCaseDialog(null);
      setCaseNotes("");
      setRevision((value) => value + 1);
      toast.success("Case resolved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not resolve case.");
    }
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 pb-10" data-revision={revision}>
      <PageHeader
        title="Attendance Administration"
        description="Control office attendance, exceptions, site visits and geofence policy."
        actions={
          <Button asChild variant="outline">
            <Link to="/staff/attendance/corrections">Review Corrections</Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Staff roster", employees.length],
          [
            "Today’s records",
            allRecords.filter((item) => item.date === format(new Date(), "yyyy-MM-dd")).length,
          ],
          ["Pending site visits", pendingSiteVisits.length],
          ["Active office zones", clockInLocations.length],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="daily">
        <div className="overflow-x-auto pb-2">
          <TabsList>
            <TabsTrigger value="daily">Daily Roster</TabsTrigger>
            <TabsTrigger value="site-visits">Site Visits ({pendingSiteVisits.length})</TabsTrigger>
            <TabsTrigger value="exceptions">
              Exception Cases ({openExceptionCases.length})
            </TabsTrigger>
            <TabsTrigger value="import">Import & Manual Entry</TabsTrigger>
            <TabsTrigger value="setup">Office Setup</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="daily" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                className="sm:w-48"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    "All",
                    "Exceptions",
                    "Present",
                    "Late",
                    "Absent",
                    "Missing Punch",
                    "On Leave",
                    "Holiday",
                    "Rest Day",
                  ].map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  downloadText(
                    `via-attendance-${date}.csv`,
                    await attendanceService.exportCsvAsync(date, actorContext),
                    "text/csv",
                  );
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : "Could not export attendance.",
                  );
                }
              }}
            >
              <Download className="mr-2 h-4 w-4" /> Export Date
            </Button>
          </div>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Clock In</TableHead>
                    <TableHead>Clock Out</TableHead>
                    <TableHead>Hours</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {currentRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <span className="font-medium">{row.employee.preferredName}</span>
                        <span className="block text-xs text-muted-foreground">
                          {row.employee.position}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            ["Absent", "Missing Punch"].includes(row.status)
                              ? "destructive"
                              : row.status === "Late"
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{row.clockIn ?? "—"}</TableCell>
                      <TableCell>{row.clockOut ?? "—"}</TableCell>
                      <TableCell>{row.calculatedHours ? `${row.calculatedHours}h` : "—"}</TableCell>
                      <TableCell>{"location" in row ? (row.location ?? "—") : "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.source}</TableCell>
                      <TableCell className="text-right">
                        {!row.id.startsWith("virtual-") && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const storedRecord = allRecords.find(
                                (record) => record.id === row.id,
                              );
                              if (!storedRecord) return;
                              setEditingRecordId(row.id);
                              setManualEmployeeId(row.employee.id);
                              setManualClockIn(row.clockIn ?? "");
                              setManualClockOut(row.clockOut ?? "");
                              setManualBreak(String(storedRecord.breakMinutes ?? 0));
                              setManualShiftId(storedRecord.shiftId ?? "Standard Day");
                              setManualLocation(storedRecord.location ?? "");
                              setManualSource(
                                row.source === "Hardware Terminal"
                                  ? "Hardware Terminal"
                                  : "Manual Entry",
                              );
                              setManualOpen(true);
                            }}
                          >
                            <PencilLine className="mr-1 h-3.5 w-3.5" /> Edit
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="site-visits" className="space-y-4">
          <Alert>
            <MapPin className="h-4 w-4" />
            <AlertTitle>HR-controlled exception</AlertTitle>
            <AlertDescription>
              Only approved visits change attendance. Home-origin visits use scheduled automatic
              punches; office-origin visits require a verified office clock-in.
            </AlertDescription>
          </Alert>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Date / Time</TableHead>
                    <TableHead>Origin</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead>Purpose</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {siteVisits.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-28 text-center text-muted-foreground">
                        No site visits recorded.
                      </TableCell>
                    </TableRow>
                  ) : (
                    siteVisits.map((visit) => {
                      const employee = employees.find((item) => item.id === visit.employeeId);
                      return (
                        <TableRow key={visit.id}>
                          <TableCell className="font-medium">
                            {employee?.preferredName ?? visit.employeeId}
                          </TableCell>
                          <TableCell>
                            {visit.date}
                            <span className="block text-xs text-muted-foreground">
                              {visit.startTime}–{visit.endTime}
                            </span>
                          </TableCell>
                          <TableCell>{visit.origin}</TableCell>
                          <TableCell>{visit.destination}</TableCell>
                          <TableCell className="max-w-72 truncate" title={visit.purpose}>
                            {visit.purpose}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                visit.status === "Rejected"
                                  ? "destructive"
                                  : visit.status === "Approved" || visit.status === "Completed"
                                    ? "default"
                                    : "secondary"
                              }
                            >
                              {visit.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {visit.status === "Pending HR" && (
                              <Button
                                size="sm"
                                onClick={() => {
                                  setReviewVisit(visit);
                                  setDecisionNotes("");
                                }}
                              >
                                Review
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="exceptions" className="space-y-4">
          <Alert>
            <MapPin className="h-4 w-4" />
            <AlertTitle>Exception cases</AlertTitle>
            <AlertDescription>
              An office-origin site visit that ended without a clock-in opens a persistent case here
              instead of only sending a notification - assign it, add investigation notes, and close
              it once resolved.
            </AlertDescription>
          </Alert>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exceptionCases.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-28 text-center text-muted-foreground">
                        No exception cases recorded.
                      </TableCell>
                    </TableRow>
                  ) : (
                    exceptionCases.map((item) => {
                      const emp = employees.find((e) => e.id === item.employeeId);
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">
                            {emp?.preferredName ?? item.employeeId}
                          </TableCell>
                          <TableCell>{item.date}</TableCell>
                          <TableCell>{item.destination}</TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                item.status === "Resolved"
                                  ? "default"
                                  : item.status === "Investigating"
                                    ? "secondary"
                                    : "destructive"
                              }
                            >
                              {item.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {item.ownerId ?? "Unassigned"}
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            {item.status !== "Resolved" && !item.ownerId && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => assignCaseToMe(item)}
                              >
                                Assign to me
                              </Button>
                            )}
                            {item.status !== "Resolved" && (
                              <Button
                                size="sm"
                                onClick={() => {
                                  setCaseDialog(item);
                                  setCaseNotes(item.investigationNotes ?? "");
                                }}
                              >
                                Investigate
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="import" className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileUp className="h-4 w-4" /> Validated CSV Import
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Required columns: Employee ID/Number/Email and Date. Optional: Clock In, Clock Out,
                Break Minutes and Location.
              </p>
              <Input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => void loadCsv(event.target.files?.[0])}
              />
              {csvPreview && (
                <div className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">{csvPreview.validRows.length} valid rows</p>
                  <p className={csvPreview.errors.length ? "text-destructive" : "text-emerald-600"}>
                    {csvPreview.errors.length} errors
                  </p>
                  {csvPreview.errors.slice(0, 5).map((error) => (
                    <p
                      key={`${error.row}-${error.message}`}
                      className="mt-1 text-xs text-destructive"
                    >
                      Row {error.row}: {error.message}
                    </p>
                  ))}
                  <Button
                    className="mt-3"
                    disabled={csvPreview.errors.length > 0 || csvPreview.validRows.length === 0}
                    onClick={commitCsv}
                  >
                    Import Validated Rows
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <PencilLine className="h-4 w-4" /> Manual Attendance Entry
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Create a single audited attendance record for hardware or HR-supplied punches.
              </p>
              <Button
                onClick={() => {
                  setEditingRecordId(null);
                  setManualEmployeeId("");
                  setManualClockIn("09:00");
                  setManualClockOut("18:00");
                  setManualBreak("60");
                  setManualOpen(true);
                }}
              >
                New Manual Record
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="setup" className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <LocateFixed className="h-4 w-4" /> Capture Current Office
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Stand at the VIA office, select its location record, then capture this device’s
                current position. This becomes the mandatory attendance zone.
              </p>
              <LocationMap reading={officePreview} title="Current office location preview" />
              <Select value={officeLocationId} onValueChange={setOfficeLocationId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select office location" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((location) => (
                    <SelectItem key={location.id} value={location.id}>
                      {location.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="space-y-2">
                <label htmlFor="office-radius" className="text-sm font-medium">
                  Allowed radius (metres)
                </label>
                <Input
                  id="office-radius"
                  type="number"
                  min="20"
                  max="10000"
                  value={officeRadius}
                  onChange={(event) => setOfficeRadius(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  disabled={capturingOffice}
                  onClick={() => void locateOffice()}
                >
                  <MapPin className="mr-2 h-4 w-4" />
                  {capturingOffice ? "Finding location…" : "Show My Location"}
                </Button>
                <Button disabled={!officeLocationId || !officePreview} onClick={captureOffice}>
                  <LocateFixed className="mr-2 h-4 w-4" />
                  Save as Office Location
                </Button>
              </div>
              {clockInLocations.map((location: AttendanceLocation) => (
                <div
                  key={location.id}
                  className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"
                >
                  <strong>{location.name}</strong>
                  <span className="block">
                    {location.latitude?.toFixed(6)}, {location.longitude?.toFixed(6)} ·{" "}
                    {location.radiusMeters}m radius
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Settings2 className="h-4 w-4" /> Attendance Policy
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Standard hours</label>
                <Input
                  type="number"
                  min="1"
                  max="24"
                  step="0.25"
                  value={standardHours}
                  onChange={(event) => setStandardHours(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Default break minutes</label>
                <Input
                  type="number"
                  min="0"
                  max="360"
                  value={defaultBreak}
                  onChange={(event) => setDefaultBreak(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Expected clock-in</label>
                <Input
                  type="time"
                  value={expectedIn}
                  onChange={(event) => setExpectedIn(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Expected clock-out</label>
                <Input
                  type="time"
                  value={expectedOut}
                  onChange={(event) => setExpectedOut(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Late grace minutes</label>
                <Input
                  type="number"
                  min="0"
                  value={lateGrace}
                  onChange={(event) => setLateGrace(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Maximum GPS uncertainty</label>
                <Input
                  type="number"
                  min="10"
                  value={maxAccuracy}
                  onChange={(event) => setMaxAccuracy(event.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">Approved office networks</label>
                <Input
                  value={approvedNetworks}
                  onChange={(event) => setApprovedNetworks(event.target.value)}
                  placeholder="Example: 203.0.113.24/32"
                />
                <p className="text-xs text-muted-foreground">
                  Enter the public IP address or network used by each VIA office, separated by
                  commas. Attendance requires both this network and the office location.
                </p>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">Reason for change</label>
                <Input
                  value={policyReason}
                  onChange={(event) => setPolicyReason(event.target.value)}
                  placeholder="Why is the attendance policy changing?"
                />
              </div>
              <Alert className="sm:col-span-2">
                <Settings2 className="h-4 w-4" />
                <AlertTitle>Three daily reminders</AlertTitle>
                <AlertDescription>
                  Sent when standard working hours are completed, then 15 and 30 minutes later while
                  attendance remains open.
                </AlertDescription>
              </Alert>
              <Button className="sm:col-span-2" onClick={savePolicy}>
                Save Attendance Policy
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingRecordId ? "Edit Attendance Record" : "Manual Attendance Entry"}
            </DialogTitle>
            <DialogDescription>
              This action is stored with your identity and reason in the audit history.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-medium">Employee</label>
              <Select value={manualEmployeeId} onValueChange={setManualEmployeeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.preferredName} · {employee.employeeNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-medium">Shift / Roster Code</label>
              <Input
                value={manualShiftId}
                onChange={(event) => setManualShiftId(event.target.value)}
                placeholder="e.g. Standard Day"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Clock In</label>
              <Input
                type="time"
                value={manualClockIn}
                onChange={(event) => setManualClockIn(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Clock Out</label>
              <Input
                type="time"
                value={manualClockOut}
                onChange={(event) => setManualClockOut(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Break Minutes</label>
              <Input
                type="number"
                value={manualBreak}
                onChange={(event) => setManualBreak(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Source</label>
              <Select
                value={manualSource}
                onValueChange={(value) => setManualSource(value as typeof manualSource)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Manual Entry">Manual Entry</SelectItem>
                  <SelectItem value="Hardware Terminal">Hardware Terminal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-medium">Location</label>
              <Input
                value={manualLocation}
                onChange={(event) => setManualLocation(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!manualEmployeeId || !date} onClick={saveManualRecord}>
              Save Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(reviewVisit)} onOpenChange={(open) => !open && setReviewVisit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review Site Visit</DialogTitle>
            <DialogDescription>
              {reviewVisit?.origin === "Home"
                ? "Approval will authorise automatic scheduled attendance from home."
                : "The employee must clock in inside the office before leaving."}
            </DialogDescription>
          </DialogHeader>
          {reviewVisit && (
            <div className="rounded-lg border bg-muted/20 p-4 text-sm">
              <p className="font-medium">{reviewVisit.destination}</p>
              <p>
                {reviewVisit.date} · {reviewVisit.startTime}–{reviewVisit.endTime}
              </p>
              <p className="mt-2 text-muted-foreground">{reviewVisit.purpose}</p>
            </div>
          )}
          <Textarea
            value={decisionNotes}
            onChange={(event) => setDecisionNotes(event.target.value)}
            placeholder="Required HR decision notes"
          />
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={decisionNotes.trim().length < 3}
              onClick={() => decideVisit(false)}
            >
              <XCircle className="mr-2 h-4 w-4" /> Reject
            </Button>
            <Button disabled={decisionNotes.trim().length < 3} onClick={() => decideVisit(true)}>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!caseDialog} onOpenChange={(open) => !open && setCaseDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Attendance Exception Case</DialogTitle>
            <DialogDescription>
              Add investigation notes to keep this open, or resolve the case with a closing note.
            </DialogDescription>
          </DialogHeader>
          {caseDialog && (
            <div className="rounded-lg border bg-muted/20 p-4 text-sm">
              <p className="font-medium">{caseDialog.destination}</p>
              <p>{caseDialog.date}</p>
              <p className="mt-2 text-muted-foreground">
                Office-origin site visit ended without a clock-in.
              </p>
            </div>
          )}
          <Textarea
            value={caseNotes}
            onChange={(event) => setCaseNotes(event.target.value)}
            placeholder="Investigation notes, or a resolution note to close the case"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={saveCaseNotes}
              disabled={caseNotes.trim().length === 0}
            >
              Save Notes
            </Button>
            <Button onClick={resolveCase} disabled={caseNotes.trim().length < 5}>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Resolve Case
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
