import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { TimesheetService } from "@/lib/data/timesheet-service";
import { getMasterDataRepository, getProjectRepository } from "@/lib/data/master-data";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { parseISO, format, eachDayOfInterval } from "date-fns";
import { AlertTriangle, CheckCircle2, Trash2, Plus, Copy, Save, Send } from "lucide-react";
import type { TimesheetEntry, TimesheetWithEntries } from "@/lib/data/timesheet-types";

export const Route = createFileRoute("/staff/me/timesheets/$periodId")({
  component: TimesheetEntryRoute,
});

function TimesheetEntryRoute() {
  const { periodId } = Route.useParams();
  const router = useRouter();
  const currentUser = useCurrentUser();

  const tsService = useMemo(() => new TimesheetService(), []);

  const [timesheet, setTimesheet] = useState<TimesheetWithEntries | null>(null);
  const [isCertifyOpen, setIsCertifyOpen] = useState(false);
  const [isCopyConfirmOpen, setIsCopyConfirmOpen] = useState(false);

  const projects = getProjectRepository().list();
  const costCentres = getMasterDataRepository("costCentres").list();
  const activities = getMasterDataRepository("activityCodes").list();
  const locations = getMasterDataRepository("locations").list();

  useEffect(() => {
    if (currentUser?.employeeId && periodId) {
      void tsService
        .getOrCreateTimesheetAsync(currentUser.employeeId, periodId, currentUser.getActorContext())
        .then((ts) => setTimesheet(JSON.parse(JSON.stringify(ts))))
        .catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : "Failed to load timesheet");
          router.history.back();
        });
    }
  }, [currentUser, periodId, router.history, tsService]);

  if (!timesheet) return <div>Loading...</div>;

  const period = tsService.getPeriods().find((p) => p.id === periodId);
  const isEditable = timesheet.status === "Draft" || timesheet.status === "Returned";

  const days = eachDayOfInterval({
    start: parseISO(period!.startDate),
    end: parseISO(period!.endDate),
  });

  const handleAddRow = () => {
    const newEntry: TimesheetEntry = {
      id: crypto.randomUUID(),
      projectId: "",
      costCentreId: "",
      activityCodeId: "",
      locationCodeId: "",
      hours: {},
      total: 0,
      notes: "",
    };
    setTimesheet({ ...timesheet, entries: [...timesheet.entries, newEntry] });
  };

  const handleRemoveRow = (id: string) => {
    setTimesheet({ ...timesheet, entries: timesheet.entries.filter((e) => e.id !== id) });
  };

  const updateEntry = (
    id: string,
    field: keyof TimesheetEntry,
    value: TimesheetEntry[keyof TimesheetEntry],
  ) => {
    setTimesheet((prev) => {
      if (!prev) return prev;
      const entries = prev.entries.map((e) => {
        if (e.id === id) {
          return { ...e, [field]: value };
        }
        return e;
      });
      return { ...prev, entries };
    });
  };

  const updateHours = (id: string, dateStr: string, valStr: string) => {
    const num = parseFloat(valStr);
    const value = isNaN(num) ? 0 : num;
    setTimesheet((prev) => {
      if (!prev) return prev;
      const entries = prev.entries.map((e) => {
        if (e.id === id) {
          const hours = { ...e.hours, [dateStr]: value };
          const total = Object.values(hours).reduce((sum, h) => sum + h, 0);
          return { ...e, hours, total };
        }
        return e;
      });
      const totalHours = entries.reduce((sum, e) => sum + e.total, 0);
      return { ...prev, entries, totalHours };
    });
  };

  const handleSaveDraft = async () => {
    try {
      const saved = await tsService.saveTimesheetDraftAsync(
        timesheet,
        currentUser.getActorContext(),
      );
      setTimesheet(saved);
      toast.success("Draft saved");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to save draft.");
    }
  };

  const handleSubmit = () => {
    setIsCertifyOpen(true);
  };

  const confirmSubmit = async () => {
    setIsCertifyOpen(false);
    try {
      // First save draft
      await tsService.saveTimesheetDraftAsync(timesheet, currentUser.getActorContext());
      // Then submit
      const submitted = await tsService.submitTimesheetAsync(
        timesheet.id,
        currentUser.getActorContext(),
      );
      setTimesheet(submitted);
      toast.success("Timesheet sent to your manager");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Validation failed.");
    }
  };

  const performCopyPrev = async () => {
    try {
      const copied = await tsService.copyPreviousWeekAsync(
        currentUser.employeeId!,
        periodId,
        currentUser.getActorContext(),
      );
      setTimesheet(copied);
      toast.success("Copied rows from previous week.");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Previous week could not be copied.");
    }
  };

  const handleCopyPrev = () => {
    const hasEnteredRows = timesheet.entries.some((entry) => !entry.isLeave && !entry.isHoliday);
    if (hasEnteredRows) {
      setIsCopyConfirmOpen(true);
      return;
    }
    performCopyPrev();
  };

  // Calculations
  const dailyTotals: Record<string, number> = {};
  days.forEach((d) => (dailyTotals[format(d, "yyyy-MM-dd")] = 0));

  timesheet.entries.forEach((e) => {
    Object.entries(e.hours).forEach(([d, h]) => {
      if (dailyTotals[d] !== undefined) {
        dailyTotals[d] += h || 0;
      }
    });
  });

  const diff = timesheet.totalHours - timesheet.expectedHours;
  const reconciliation = tsService.reconcileAttendance(timesheet);

  const updateAttendanceExplanation = (date: string, explanation: string) => {
    setTimesheet((previous) =>
      previous
        ? {
            ...previous,
            attendanceDiscrepancyExplanations: {
              ...previous.attendanceDiscrepancyExplanations,
              [date]: explanation,
            },
          }
        : previous,
    );
  };

  return (
    <RequirePermission permission="timesheet:view_self" resourceName="Timesheet Entry">
      <div className="flex flex-col gap-4 max-w-[1400px] mx-auto pb-10">
        <PageHeader
          title="Timesheet Entry"
          description={`Period: ${period?.startDate} to ${period?.endDate}`}
          actions={
            <Badge
              variant={
                timesheet.status === "Approved" || timesheet.status === "Payroll Locked"
                  ? "default"
                  : timesheet.status === "Returned"
                    ? "destructive"
                    : "secondary"
              }
              className="text-sm px-3 py-1"
            >
              {timesheet.status}
            </Badge>
          }
        />

        <div className="flex gap-4 mb-2">
          <Card className="flex-1 bg-muted/30">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <div className="text-sm text-muted-foreground">Expected Hours</div>
                <div className="text-2xl font-bold">{timesheet.expectedHours}</div>
              </div>
              <div className="text-right">
                <div className="text-sm text-muted-foreground">Logged Hours</div>
                <div
                  className={`text-2xl font-bold ${timesheet.totalHours < timesheet.expectedHours && isEditable ? "text-destructive" : ""}`}
                >
                  {timesheet.totalHours}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm text-muted-foreground">Difference</div>
                <div
                  className={`text-2xl font-bold ${diff > 0 ? "text-emerald-600" : diff < 0 ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {diff > 0 ? `+${diff}` : diff}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              {reconciliation.unresolvedCount === 0 ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              )}
              Attendance and Timesheet Check
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">Attendance hours</div>
                <div className="text-xl font-semibold">{reconciliation.attendanceHours}</div>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">Project work hours</div>
                <div className="text-xl font-semibold">{reconciliation.timesheetWorkHours}</div>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">Difference</div>
                <div className="text-xl font-semibold">{reconciliation.varianceHours}</div>
              </div>
            </div>

            {reconciliation.unresolvedCount > 0 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Explanation required</AlertTitle>
                <AlertDescription>
                  Explain each highlighted difference before sending your timesheet. Attendance
                  shows when you were at work; the timesheet shows what you worked on.
                </AlertDescription>
              </Alert>
            )}

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Attendance</TableHead>
                    <TableHead className="text-right">Attendance hours</TableHead>
                    <TableHead className="text-right">Project hours</TableHead>
                    <TableHead className="text-right">Difference</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reconciliation.days.map((day) => (
                    <TableRow
                      key={day.date}
                      className={!day.resolved ? "bg-amber-50/60" : undefined}
                    >
                      <TableCell className="font-medium">{day.date}</TableCell>
                      <TableCell>{day.attendanceStatus}</TableCell>
                      <TableCell className="text-right">{day.attendanceHours}</TableCell>
                      <TableCell className="text-right">{day.timesheetWorkHours}</TableCell>
                      <TableCell className="text-right">{day.varianceHours}</TableCell>
                      <TableCell>
                        <Badge variant={day.resolved ? "secondary" : "destructive"}>
                          {day.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {reconciliation.days
              .filter((day) => day.requiresExplanation)
              .map((day) => (
                <div key={day.date} className="space-y-2 rounded-lg border p-3">
                  <label
                    className="text-sm font-medium"
                    htmlFor={`attendance-explanation-${day.date}`}
                  >
                    {day.date}: explain {day.status.toLowerCase()}
                  </label>
                  <Textarea
                    id={`attendance-explanation-${day.date}`}
                    disabled={!isEditable}
                    value={timesheet.attendanceDiscrepancyExplanations?.[day.date] ?? ""}
                    onChange={(event) => updateAttendanceExplanation(day.date, event.target.value)}
                    placeholder="Explain the difference in at least 10 characters."
                  />
                  {!day.resolved && (
                    <p className="text-xs text-amber-700">Please add a clear explanation.</p>
                  )}
                </div>
              ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between py-3">
            <CardTitle className="text-base">Time Entries</CardTitle>
            {isEditable && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleCopyPrev}>
                  <Copy className="w-4 h-4 mr-2" /> Copy Prev Week
                </Button>
                <Button variant="outline" size="sm" onClick={handleAddRow}>
                  <Plus className="w-4 h-4 mr-2" /> Add Row
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {/* Desktop Grid */}
            <Table className="min-w-[1200px]">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-[150px]">Project</TableHead>
                  <TableHead className="w-[150px]">Cost Centre</TableHead>
                  <TableHead className="w-[150px]">Activity</TableHead>
                  <TableHead className="w-[150px]">Location</TableHead>
                  {days.map((d) => (
                    <TableHead key={d.toISOString()} className="w-[80px] text-center px-1">
                      <div className="text-xs font-normal">{format(d, "EEE")}</div>
                      <div>{format(d, "dd")}</div>
                    </TableHead>
                  ))}
                  <TableHead className="w-[80px] text-center">Total</TableHead>
                  <TableHead className="w-[200px]">Notes</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {timesheet.entries.map((entry) => {
                  const isReadonlyBlock = entry.isLeave || entry.isHoliday;

                  return (
                    <TableRow key={entry.id} className={isReadonlyBlock ? "bg-muted/30" : ""}>
                      <TableCell className="p-2">
                        {isReadonlyBlock ? (
                          <span className="text-sm font-semibold text-muted-foreground">
                            {entry.projectId}
                          </span>
                        ) : (
                          <Select
                            disabled={!isEditable}
                            value={entry.projectId}
                            onValueChange={(v) => updateEntry(entry.id, "projectId", v)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Project" />
                            </SelectTrigger>
                            <SelectContent>
                              {projects
                                .filter((p) => p.isActive || p.id === entry.projectId)
                                .map((p) => (
                                  <SelectItem key={p.id} value={p.id}>
                                    {p.name} {!p.isActive && "(Archived)"}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell className="p-2">
                        {isReadonlyBlock ? null : (
                          <Select
                            disabled={!isEditable}
                            value={entry.costCentreId}
                            onValueChange={(v) => updateEntry(entry.id, "costCentreId", v)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Cost Centre" />
                            </SelectTrigger>
                            <SelectContent>
                              {costCentres.map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell className="p-2">
                        {isReadonlyBlock ? null : (
                          <Select
                            disabled={!isEditable}
                            value={entry.activityCodeId}
                            onValueChange={(v) => updateEntry(entry.id, "activityCodeId", v)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Activity" />
                            </SelectTrigger>
                            <SelectContent>
                              {activities.map((a) => (
                                <SelectItem key={a.id} value={a.id}>
                                  {a.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell className="p-2">
                        {isReadonlyBlock ? null : (
                          <Select
                            disabled={!isEditable}
                            value={entry.locationCodeId}
                            onValueChange={(v) => updateEntry(entry.id, "locationCodeId", v)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Location" />
                            </SelectTrigger>
                            <SelectContent>
                              {locations.map((l) => (
                                <SelectItem key={l.id} value={l.id}>
                                  {l.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>

                      {/* Day Inputs */}
                      {days.map((d) => {
                        const dateStr = format(d, "yyyy-MM-dd");
                        const val = entry.hours[dateStr] || "";
                        return (
                          <TableCell key={dateStr} className="p-1 text-center">
                            {isReadonlyBlock ? (
                              <div className="text-sm font-medium text-muted-foreground">
                                {val || "-"}
                              </div>
                            ) : (
                              <Input
                                disabled={!isEditable}
                                className={`h-8 text-center px-1 ${val && val > 12 ? "border-amber-500" : ""}`}
                                value={val}
                                onChange={(e) => updateHours(entry.id, dateStr, e.target.value)}
                                placeholder="0"
                              />
                            )}
                          </TableCell>
                        );
                      })}

                      <TableCell className="p-2 text-center font-bold">{entry.total}</TableCell>
                      <TableCell className="p-2">
                        {isReadonlyBlock ? (
                          <span className="text-xs text-muted-foreground">{entry.notes}</span>
                        ) : (
                          <Input
                            disabled={!isEditable}
                            className="h-8 text-xs"
                            value={entry.notes || ""}
                            onChange={(e) => updateEntry(entry.id, "notes", e.target.value)}
                            placeholder="Required..."
                          />
                        )}
                      </TableCell>
                      <TableCell className="p-2 text-center">
                        {isEditable && !isReadonlyBlock && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => handleRemoveRow(entry.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} className="text-right font-bold">
                    Daily Totals:
                  </TableCell>
                  {days.map((d) => {
                    const dateStr = format(d, "yyyy-MM-dd");
                    const tot = dailyTotals[dateStr] || 0;
                    return (
                      <TableCell
                        key={dateStr}
                        className={`text-center font-bold ${tot > 24 ? "text-destructive" : ""}`}
                      >
                        {tot}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-center font-bold text-lg">
                    {timesheet.totalHours}
                  </TableCell>
                  <TableCell colSpan={2}></TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
          {isEditable && (
            <CardFooter className="flex justify-between bg-muted/20 py-4 border-t mt-4">
              <div className="text-sm text-muted-foreground max-w-[600px]">
                {timesheet.totalHours < timesheet.expectedHours && (
                  <span className="text-destructive font-medium block mb-1">
                    Warning: Logged hours are less than expected standard hours.
                  </span>
                )}
                Note: Ensure all standard time entries have an associated project, cost centre,
                activity, location, and a descriptive note before submitting.
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleSaveDraft}>
                  <Save className="w-4 h-4 mr-2" /> Save Draft
                </Button>
                <Button onClick={handleSubmit}>
                  <Send className="w-4 h-4 mr-2" /> Submit Timesheet
                </Button>
              </div>
            </CardFooter>
          )}
        </Card>
      </div>

      <AlertDialog open={isCertifyOpen} onOpenChange={setIsCertifyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Certify and submit</AlertDialogTitle>
            <AlertDialogDescription>
              I certify that these hours are a mathematically correct and true representation of the
              time worked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSubmit}>Certify and Submit</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={isCopyConfirmOpen} onOpenChange={setIsCopyConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add rows from the previous week?</AlertDialogTitle>
            <AlertDialogDescription>
              Your current rows and entered hours will be kept. VIA will add only project rows that
              are not already on this timesheet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setIsCopyConfirmOpen(false);
                performCopyPrev();
              }}
            >
              Add Previous Rows
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </RequirePermission>
  );
}
