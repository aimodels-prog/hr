import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { TimesheetDayNavigation } from "@/components/timesheets/day-navigation";
import { timesheetPeriodLabel, isConfiguredTimesheetPeriod } from "@/lib/data/timesheet-periods";
import {
  formatSignedHours,
  isTimesheetWeekend,
  meetsTimesheetDailyTarget,
  meetsTimesheetWorkTarget,
  timesheetCalendarDayLabel,
} from "@/lib/data/timesheet-day-display";
import {
  approvedLeaveCoversDate,
  isApprovedRemoteWork,
  isAbsenceLeave,
  isEffectiveLeave,
  organisationDate,
} from "@/lib/data/approved-leave";
import { AttendanceService } from "@/lib/data/attendance-service";
import { LeaveService } from "@/lib/data/leave-service";
import { leaveDisplayType } from "@/lib/data/leave-presentation";
import { recordedAttendanceHours } from "@/lib/data/recorded-hours";
import { SettingsService } from "@/lib/data/settings-service";
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
import { ConfirmAction } from "@/components/ui/confirm-action";
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
import { AlertTriangle, CheckCircle2, Info, Trash2, Plus, Copy, Save, Send } from "lucide-react";
import type { TimesheetEntry, TimesheetWithEntries } from "@/lib/data/timesheet-types";

export const Route = createFileRoute("/staff/me/timesheets/$periodId")({
  component: TimesheetEntryRoute,
});

function TimesheetEntryRoute() {
  const { periodId } = Route.useParams();
  const router = useRouter();
  const currentUser = useCurrentUser();

  const tsService = useMemo(() => new TimesheetService(), []);
  const attendanceService = useMemo(() => new AttendanceService(), []);
  const leaveService = useMemo(() => new LeaveService(), []);

  const [timesheet, setTimesheet] = useState<TimesheetWithEntries | null>(null);
  const [dayPage, setDayPage] = useState(0);
  const [isCertifyOpen, setIsCertifyOpen] = useState(false);
  const [isCopyConfirmOpen, setIsCopyConfirmOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const projects = getProjectRepository().list();
  const costCentres = getMasterDataRepository("costCentres").list();
  const activities = getMasterDataRepository("activityCodes").list();
  const locations = getMasterDataRepository("locations").list();

  useEffect(() => {
    if (currentUser?.employeeId && periodId) {
      setSelectedDate(null);
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

  const allDays = eachDayOfInterval({
    start: parseISO(period!.startDate),
    end: parseISO(period!.endDate),
  });
  const days = allDays.slice(dayPage * 7, dayPage * 7 + 7);
  const monthNotEnded =
    isConfiguredTimesheetPeriod(period!) &&
    period!.endDate >=
      organisationDate(new Date(), new SettingsService().getAppSettingsSync().timezone);

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
    const entries = timesheet.entries.filter((e) => e.id !== id);
    setTimesheet({
      ...timesheet,
      entries,
      totalHours: entries
        .filter((e) => !e.isLeave && !e.isHoliday && !e.isRemoteWork)
        .reduce((sum, e) => sum + e.total, 0),
    });
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
      const totalHours = entries
        .filter((e) => !e.isLeave && !e.isHoliday && !e.isRemoteWork)
        .reduce((sum, e) => sum + e.total, 0);
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
      toast.success("Copied rows from previous month.");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Previous month could not be copied.");
    }
  };

  const handleCopyPrev = () => {
    const hasEnteredRows = timesheet.entries.some(
      (entry) => !entry.isLeave && !entry.isHoliday && !entry.isRemoteWork,
    );
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
    if (e.isLeave || e.isHoliday || e.isRemoteWork) return;
    Object.entries(e.hours).forEach(([d, h]) => {
      if (dailyTotals[d] !== undefined) {
        dailyTotals[d] += h || 0;
      }
    });
  });

  const reconciliation = tsService.reconcileAttendance(timesheet);
  const hasProjectComparison = reconciliation.days.some((day) => (day.projectHours ?? 0) > 0);
  const summary = tsService.getPeriodSummary(currentUser.employeeId!, period!, timesheet);
  const diff = Number((summary.workedHours - summary.requiredWorkHours).toFixed(2));
  const periodWorkTargetMet = meetsTimesheetWorkTarget(
    summary.workedHours,
    summary.requiredWorkHours,
  );
  const attendanceDays = new Map(reconciliation.days.map((day) => [day.date, day]));
  const employeeRecords = attendanceService.getRecordsForEmployee(
    currentUser.employeeId!,
    currentUser.getActorContext(),
  );
  const corrections = attendanceService.getCorrectionsForEmployee(
    currentUser.employeeId!,
    currentUser.getActorContext(),
  );
  const visits = attendanceService.getSiteVisitsForEmployee(
    currentUser.employeeId!,
    currentUser.getActorContext(),
  );
  const leaveRequests = leaveService.getLeaveRequestsForEmployee(
    currentUser.employeeId!,
    currentUser.getActorContext(),
  );
  const todayDate = organisationDate(
    new Date(),
    new SettingsService().getAppSettingsSync().timezone,
  );
  const focusedDate =
    selectedDate ??
    (todayDate >= period!.startDate && todayDate <= period!.endDate
      ? todayDate
      : period!.startDate);
  const focusedDay = attendanceDays.get(focusedDate);
  const focusedProjectHours =
    focusedDay?.projectHours && focusedDay.projectHours > 0 ? focusedDay.projectHours : undefined;
  const focusedProjectGap =
    focusedProjectHours === undefined
      ? null
      : Number((focusedProjectHours - (focusedDay?.timesheetWorkHours ?? 0)).toFixed(2));
  const focusedLeave = timesheet.entries.filter(
    (entry) => entry.isLeave && entry.hours[focusedDate],
  );
  const focusedRemoteWork =
    timesheet.entries.some(
      (entry) => entry.isRemoteWork && Object.hasOwn(entry.hours, focusedDate),
    ) || leaveRequests.some((request) => isApprovedRemoteWork(request, focusedDate));
  const focusedHoliday = timesheet.entries.some(
    (entry) => entry.isHoliday && entry.hours[focusedDate],
  );
  const focusedRecord = employeeRecords.find((record) => record.date === focusedDate);
  const focusedCorrections = corrections.filter(
    (correction) =>
      correction.attendanceRecordId === focusedRecord?.id ||
      correction.attendanceRecordId === focusedRecord?.databaseId,
  );
  const focusedVisits = visits.filter((visit) => visit.date === focusedDate);
  const focusedLeaveRequests = leaveRequests.filter((request) =>
    approvedLeaveCoversDate(request, focusedDate),
  );
  const paidLeaveHours = (date: string) =>
    timesheet.entries.reduce(
      (sum, entry) => sum + (entry.isLeave && !entry.isUnpaidLeave ? (entry.hours[date] ?? 0) : 0),
      0,
    );
  const holidayHours = (date: string) =>
    timesheet.entries.reduce(
      (sum, entry) => sum + (entry.isHoliday ? (entry.hours[date] ?? 0) : 0),
      0,
    );
  const workingDays = new SettingsService().getAppSettingsSync().workingDays;
  const dailyWorkTarget = tsService.getSettings().standardDailyHours;
  const focusedWeekend = isTimesheetWeekend(parseISO(focusedDate), workingDays);
  const shortDay = (date: string, worked = 0, leave = 0, holiday = 0) => {
    if (date >= todayDate || (currentUser.currentEmployee?.startDate ?? "") > date) return false;
    if (!workingDays.includes(parseISO(date).getDay())) return false;
    return worked + 0.01 < Math.max(0, dailyWorkTarget - leave - holiday);
  };
  const focusedShort = shortDay(
    focusedDate,
    focusedDay?.timesheetWorkHours ?? 0,
    focusedDay?.leaveHours ?? 0,
    focusedDay?.holidayHours ?? 0,
  );
  const focusedPendingReview =
    focusedVisits.some((visit) => visit.status === "Pending HR") ||
    focusedCorrections.some((correction) =>
      ["Pending Manager", "Pending HR"].includes(correction.status),
    ) ||
    focusedLeaveRequests.some(
      (request) =>
        !isEffectiveLeave(request) &&
        !["Rejected", "Cancelled", "Declined"].includes(request.status),
    );
  const hasAttendanceDifference = reconciliation.days.some((day) =>
    ["Variance", "Missing Attendance", "Missing Timesheet", "Incomplete Attendance"].includes(
      day.status,
    ),
  );

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
          description={period ? timesheetPeriodLabel(period) : undefined}
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
            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div className="min-w-28">
                <div className="text-sm text-muted-foreground">Required work</div>
                <div className="text-2xl font-bold">{summary.requiredWorkHours} h</div>
              </div>
              <div className="min-w-28 text-right">
                <div className="text-sm text-muted-foreground">Total hours worked</div>
                <div
                  className={`text-2xl font-bold ${periodWorkTargetMet ? "text-emerald-700 dark:text-emerald-300" : summary.workedHours < summary.requiredWorkHours && isEditable ? "text-destructive" : ""}`}
                >
                  {summary.workedHours} h
                </div>
              </div>
              <div className="min-w-28 text-right">
                <div className="text-sm text-muted-foreground">Worked vs required</div>
                <div
                  className={`text-2xl font-bold ${diff >= 0 && summary.requiredWorkHours > 0 ? "text-emerald-700 dark:text-emerald-300" : diff < 0 ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {formatSignedHours(diff)}
                </div>
                {diff > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Extra hours need separate overtime approval.
                  </p>
                )}
              </div>
              {timesheet.entries.some((entry) => entry.isLeave || entry.isHoliday) && (
                <div className="min-w-28 text-right">
                  <div className="text-sm text-muted-foreground">Paid leave / holiday</div>
                  <div className="text-2xl font-bold">
                    {summary.paidLeaveHours + summary.holidayHours} h
                  </div>
                  {summary.unpaidLeaveHours > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {summary.unpaidLeaveHours} h unpaid leave · 0 credit
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Daily calendar</CardTitle>
            <p className="text-sm text-muted-foreground">
              Select a day to see your hours, leave and anything needing review.
            </p>
            <details className="text-sm text-muted-foreground">
              <summary className="w-fit cursor-pointer text-primary">
                How daily hours are counted
              </summary>
              <p className="mt-2 max-w-2xl">
                Complete attendance can fill work hours automatically. Your scheduled break is
                excluded. Green means the daily target is met, not that overtime is approved. Paid
                leave adds credit; unpaid leave does not.
              </p>
            </details>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name) => (
                <div key={name} className="py-1">
                  {name}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: (allDays[0]!.getDay() + 6) % 7 }, (_, index) => (
                <div key={`blank-${index}`} aria-hidden="true" />
              ))}
              {allDays.map((dayDate) => {
                const date = format(dayDate, "yyyy-MM-dd");
                const day = attendanceDays.get(date);
                const weekend = isTimesheetWeekend(dayDate, workingDays);
                const paid = paidLeaveHours(date);
                const unpaid = timesheet.entries.some(
                  (entry) => entry.isUnpaidLeave && (entry.hours[date] ?? 0) > 0,
                );
                const approvedLeave = leaveRequests.find(
                  (request) =>
                    isEffectiveLeave(request) &&
                    isAbsenceLeave(request) &&
                    approvedLeaveCoversDate(request, date),
                );
                const leaveName =
                  timesheet.entries.find((entry) => entry.isLeave && (entry.hours[date] ?? 0) > 0)
                    ?.notes ?? (approvedLeave ? leaveDisplayType(approvedLeave) : undefined);
                const remoteWork =
                  timesheet.entries.some(
                    (entry) => entry.isRemoteWork && Object.hasOwn(entry.hours, date),
                  ) || leaveRequests.some((request) => isApprovedRemoteWork(request, date));
                const pendingLeave = leaveRequests.some(
                  (request) =>
                    approvedLeaveCoversDate(request, date) &&
                    !isEffectiveLeave(request) &&
                    !["Rejected", "Cancelled", "Declined"].includes(request.status),
                );
                const pendingVisit = visits.some(
                  (visit) => visit.date === date && visit.status === "Pending HR",
                );
                const record = employeeRecords.find((item) => item.date === date);
                const pendingCorrection = corrections.some(
                  (correction) =>
                    ["Pending Manager", "Pending HR"].includes(correction.status) &&
                    (correction.attendanceRecordId === record?.id ||
                      correction.attendanceRecordId === record?.databaseId),
                );
                const pending = pendingLeave || pendingVisit || pendingCorrection;
                const issue =
                  Boolean(day && !day.resolved) ||
                  day?.status === "Incomplete Attendance" ||
                  shortDay(
                    date,
                    day?.timesheetWorkHours ?? 0,
                    day?.leaveHours ?? 0,
                    day?.holidayHours ?? 0,
                  );
                const worked = day?.timesheetWorkHours ?? 0;
                const credit = Number(
                  (
                    worked +
                    Math.min(paid + holidayHours(date), Math.max(0, dailyWorkTarget - worked))
                  ).toFixed(2),
                );
                const targetMet = meetsTimesheetDailyTarget({
                  workedHours: worked,
                  paidLeaveHours: paid,
                  holidayHours: holidayHours(date),
                  targetHours: dailyWorkTarget,
                  workingDay: !weekend,
                });
                const dayLabel = timesheetCalendarDayLabel({
                  weekend,
                  leaveName,
                  holiday: holidayHours(date) > 0,
                  unpaid,
                  remoteWork,
                  attendanceStatus: day?.attendanceStatus,
                });
                return (
                  <button
                    key={date}
                    type="button"
                    aria-pressed={focusedDate === date}
                    aria-label={`${date}: ${worked} hours worked, ${credit} hours credited, ${dayLabel}${targetMet ? ", daily hours target met" : ""}${pending ? ", approval pending" : ""}${issue ? ", needs review" : ""}`}
                    onClick={() => setSelectedDate(date)}
                    className={`min-h-20 rounded-lg border p-1.5 text-left transition-colors hover:border-primary sm:p-2 ${targetMet ? "bg-emerald-50 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-100" : weekend ? "bg-muted/30" : "bg-card"} ${focusedDate === date ? "ring-2 ring-primary" : ""} ${issue ? "border-amber-400" : targetMet ? "border-emerald-300 dark:border-emerald-800" : ""}`}
                  >
                    <span className="block text-xs text-muted-foreground">
                      {format(dayDate, "d")}
                    </span>
                    <span className="block text-sm font-semibold">{credit} h</span>
                    {worked > 0 && paid + holidayHours(date) > 0 && (
                      <span className="block text-[10px]">{worked} h worked</span>
                    )}
                    <span className="block truncate text-[10px] text-muted-foreground sm:text-xs">
                      {dayLabel}
                    </span>
                    {(pending || issue) && (
                      <span className="mt-1 block text-[10px] font-medium text-amber-700">
                        {pending ? "Pending" : "Review"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="rounded-lg border bg-muted/20 p-4 text-sm">
              <h3 className="flex flex-wrap items-center gap-2 font-semibold">
                {format(parseISO(focusedDate), "EEEE, d MMMM yyyy")}
                {focusedWeekend && <Badge variant="outline">Weekend</Badge>}
              </h3>
              <p className="mt-1 text-muted-foreground">
                {focusedDay?.timesheetWorkHours ?? 0} h worked · {paidLeaveHours(focusedDate)} h
                paid leave · {holidayHours(focusedDate)} h holiday
                {focusedLeave.some((entry) => entry.isUnpaidLeave)
                  ? " · Unpaid leave: 0 h credit"
                  : ""}
              </p>
              {focusedProjectHours !== undefined && (
                <p className="mt-1 text-muted-foreground">
                  {focusedProjectHours} h entered against projects
                  {focusedProjectGap !== null && Math.abs(focusedProjectGap) >= 0.01 && (
                    <span>
                      {" "}
                      · {Math.abs(focusedProjectGap)} h{" "}
                      {focusedProjectGap > 0
                        ? "more project time entered than total worked"
                        : "more total work than allocated project time"}
                    </span>
                  )}
                </p>
              )}
              {focusedRecord && (
                <div className="mt-2">
                  <p>
                    Attendance: {focusedRecord.clockIn ?? "—"} to {focusedRecord.clockOut ?? "—"} ·{" "}
                    {focusedRecord.source}
                  </p>
                  <p className="text-muted-foreground">
                    {focusedRecord.officeExceptionLabel
                      ? "Approved office credit"
                      : "Recorded presence"}
                    : {recordedAttendanceHours(focusedRecord)} h before break deduction
                    {recordedAttendanceHours(focusedRecord) > (focusedDay?.timesheetWorkHours ?? 0)
                      ? " · Extra presence is not automatic overtime"
                      : ""}
                  </p>
                </div>
              )}
              {(focusedShort || (focusedDay && !focusedDay.resolved)) && (
                <p className="mt-2 text-amber-700">
                  {focusedPendingReview
                    ? "A request for this day is awaiting a decision. Open it below to see the next approver."
                    : focusedShort
                      ? "This day has fewer recorded hours than expected."
                      : `This day needs review: ${focusedDay?.status}.`}
                </p>
              )}
              {focusedShort && !focusedPendingReview && (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {attendanceService.isTrackingRequired(currentUser.employeeId!, focusedDate) ||
                  focusedRecord ||
                  focusedVisits.some((visit) =>
                    ["Approved", "Completed", "Rejected"].includes(visit.status),
                  ) ? (
                    <Button asChild size="sm">
                      <Link to="/staff/me/attendance" search={{ correct: focusedDate }}>
                        Request an attendance correction
                      </Link>
                    </Button>
                  ) : (
                    <Button asChild size="sm" variant="outline">
                      <a href="#manual-hours">Add manual work hours</a>
                    </Button>
                  )}
                  {focusedRecord && (
                    <span className="text-xs text-muted-foreground">
                      If the punch is correct, explain the difference below.
                    </span>
                  )}
                </div>
              )}
              {focusedHoliday && <p className="mt-2">Public holiday</p>}
              {focusedRemoteWork && (
                <p className="mt-2">Remote Work approved. Actual working hours remain separate.</p>
              )}
              {focusedLeaveRequests.map((request) => (
                <p key={request.id} className="mt-2">
                  <Link
                    to="/staff/request-detail/$module/$requestId"
                    params={{ module: "Leave", requestId: request.id }}
                    search={{}}
                    className="font-medium text-primary underline"
                  >
                    {leaveDisplayType(request)} · {request.status}
                  </Link>
                </p>
              ))}
              {focusedVisits.map((visit) => (
                <p key={visit.id} className="mt-2">
                  <Link
                    to="/staff/request-detail/$module/$requestId"
                    params={{ module: "Visits", requestId: visit.databaseId ?? visit.id }}
                    search={{}}
                    className="font-medium text-primary underline"
                  >
                    Visit to {visit.destination} · {visit.status}
                  </Link>
                </p>
              ))}
              {focusedCorrections.map((correction) => (
                <p key={correction.id} className="mt-2">
                  <Link
                    to="/staff/request-detail/$module/$requestId"
                    params={{
                      module: "Attendance corrections",
                      requestId: correction.databaseId ?? correction.id,
                    }}
                    search={{}}
                    className="font-medium text-primary underline"
                  >
                    {correction.correctionType} · {correction.status}
                  </Link>
                </p>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              {reconciliation.days.length === 0 ? (
                <Info className="h-5 w-5 text-muted-foreground" />
              ) : reconciliation.unresolvedCount === 0 && !hasAttendanceDifference ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              )}
              {reconciliation.days.length === 0
                ? "No attendance to compare"
                : "Attendance and Timesheet Check"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">
                  Work hours from attendance (break excluded)
                </div>
                <div className="text-xl font-semibold">{reconciliation.attendanceHours}</div>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">Total work hours</div>
                <div className="text-xl font-semibold">{reconciliation.timesheetWorkHours}</div>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">
                  {hasProjectComparison ? "Project minus attendance" : "Recorded difference"}
                </div>
                <div className="text-xl font-semibold">
                  {formatSignedHours(reconciliation.varianceHours)}
                </div>
                {hasProjectComparison && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    + means more project hours; − means more attendance work.
                  </p>
                )}
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

            {reconciliation.days.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No attendance records or approved absences are available for comparison. This does
                not confirm that your timesheet is complete.
              </p>
            )}

            {reconciliation.unresolvedCount === 0 && hasAttendanceDifference && (
              <p className="text-sm text-amber-800">
                {hasProjectComparison
                  ? "Project hours and recorded work differ."
                  : "Recorded attendance and timesheet hours differ."}{" "}
                Check the dates below. A recorded punch is shown even when biometric attendance was
                not required that day.
              </p>
            )}

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Attendance</TableHead>
                    <TableHead className="text-right">Attendance work hours</TableHead>
                    <TableHead className="text-right">Timesheet work</TableHead>
                    <TableHead className="text-right">Project hours</TableHead>
                    <TableHead className="text-right">
                      {hasProjectComparison ? "Project gap" : "Difference"}
                    </TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reconciliation.days.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        No attendance dates to compare.
                      </TableCell>
                    </TableRow>
                  )}
                  {reconciliation.days.map((day) => (
                    <TableRow
                      key={day.date}
                      className={!day.resolved ? "bg-amber-50/60" : undefined}
                    >
                      <TableCell className="font-medium">{day.date}</TableCell>
                      <TableCell>{day.attendanceStatus}</TableCell>
                      <TableCell className="text-right">{day.attendanceHours}</TableCell>
                      <TableCell className="text-right">{day.timesheetWorkHours}</TableCell>
                      <TableCell className="text-right">
                        {(day.projectHours ?? 0) > 0 ? `${day.projectHours} h` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatSignedHours(day.varianceHours)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            !day.resolved
                              ? "destructive"
                              : [
                                    "Variance",
                                    "Missing Attendance",
                                    "Missing Timesheet",
                                    "Incomplete Attendance",
                                  ].includes(day.status)
                                ? "outline"
                                : "secondary"
                          }
                        >
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

        <Card id="manual-hours">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between py-3">
            <div>
              <CardTitle className="text-base">Project allocations or manual hours</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Complete attendance fills work hours automatically. Add rows only for work without a
                punch or when a project allocation is needed.
              </p>
            </div>
            {isEditable && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyPrev}
                  disabled={!tsService.getSettings().allowCopyPreviousWeek}
                >
                  <Copy className="w-4 h-4 mr-2" /> Copy Previous Month
                </Button>
                <Button variant="outline" size="sm" onClick={handleAddRow}>
                  <Plus className="w-4 h-4 mr-2" /> Add Row
                </Button>
              </div>
            )}
          </CardHeader>
          <TimesheetDayNavigation days={allDays} page={dayPage} onChange={setDayPage} />
          <CardContent className="p-0 overflow-x-auto">
            {/* Desktop Grid */}
            <Table className="min-w-[1200px]">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-[150px]">Project</TableHead>
                  <TableHead className="w-[150px]">Cost Centre</TableHead>
                  <TableHead className="w-[150px]">Activity</TableHead>
                  <TableHead className="w-[150px]">Location</TableHead>
                  {days.map((d) => {
                    const weekend = isTimesheetWeekend(d, workingDays);
                    return (
                      <TableHead
                        key={d.toISOString()}
                        className={`w-[80px] px-1 text-center ${weekend ? "bg-muted/60" : ""}`}
                      >
                        <div className="text-xs font-normal">{format(d, "EEE")}</div>
                        <div>{format(d, "dd")}</div>
                        {weekend && <div className="text-[10px] font-medium">Weekend</div>}
                      </TableHead>
                    );
                  })}
                  <TableHead className="w-[80px] text-center">Total</TableHead>
                  <TableHead className="w-[200px]">Notes</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {timesheet.entries.map((entry) => {
                  const isReadonlyBlock = entry.isLeave || entry.isHoliday || entry.isRemoteWork;

                  return (
                    <TableRow key={entry.id} className={isReadonlyBlock ? "bg-muted/30" : ""}>
                      <TableCell className="p-2">
                        {isReadonlyBlock ? (
                          <span className="text-sm font-semibold text-muted-foreground">
                            {entry.notes ||
                              (entry.isLeave
                                ? "Approved leave"
                                : entry.isRemoteWork
                                  ? "Remote work"
                                  : "Public holiday")}
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
                                {entry.isRemoteWork
                                  ? Object.hasOwn(entry.hours, dateStr)
                                    ? "Remote"
                                    : "—"
                                  : entry.isUnpaidLeave
                                    ? "0"
                                    : val || "-"}
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

                      <TableCell className="p-2 text-center font-bold">
                        {entry.isUnpaidLeave ? 0 : entry.total}
                      </TableCell>
                      <TableCell className="p-2">
                        {isReadonlyBlock ? (
                          <span className="text-xs text-muted-foreground">{entry.notes}</span>
                        ) : (
                          <Input
                            disabled={!isEditable}
                            className="h-8 text-xs"
                            value={entry.notes || ""}
                            onChange={(e) => updateEntry(entry.id, "notes", e.target.value)}
                            placeholder="Task notes (optional)"
                          />
                        )}
                      </TableCell>
                      <TableCell className="p-2 text-center">
                        {isEditable &&
                          !isReadonlyBlock &&
                          (!entry.projectId &&
                          !entry.costCentreId &&
                          !entry.activityCodeId &&
                          !entry.locationCodeId &&
                          !entry.notes?.trim() &&
                          !Object.values(entry.hours).some((hours) => Number(hours) > 0) ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              aria-label="Remove timesheet row"
                              onClick={() => handleRemoveRow(entry.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          ) : (
                            <ConfirmAction
                              title="Remove this timesheet row?"
                              description="The row and its entered hours will be removed from this form. Save your timesheet to keep the change."
                              confirmLabel="Remove row"
                              onConfirm={() => handleRemoveRow(entry.id)}
                            >
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                aria-label="Remove timesheet row"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </ConfirmAction>
                          ))}
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
            <CardFooter className="flex flex-col gap-4 sm:flex-row sm:justify-between bg-muted/20 py-4 border-t mt-4">
              <div className="text-sm text-muted-foreground max-w-[600px]">
                {timesheet.totalHours < timesheet.expectedHours && (
                  <span className="text-destructive font-medium block mb-1">
                    Work hours are below the expected hours. Approved leave is already excluded.
                  </span>
                )}
                Save your daily hours as you go. Submit once for the whole month after it ends.
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleSaveDraft}>
                  <Save className="w-4 h-4 mr-2" /> Save Draft
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={monthNotEnded}
                  title={
                    monthNotEnded
                      ? "Submit after the month ends. You can save daily hours now."
                      : undefined
                  }
                >
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
            <AlertDialogTitle>Add rows from the previous month?</AlertDialogTitle>
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
