import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  historicalLeaveMonths,
  type HistoricalLeaveDay,
} from "@/lib/data/historical-leave-calendar";
import type { LeaveRequest } from "@/lib/data/leave-types";
import type { TimesheetPeriod } from "@/lib/data/timesheet-types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function utcDate(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(utcDate(`${month}-01`));
}

function DayLabels({ day, weekend }: { day: HistoricalLeaveDay; weekend: boolean }) {
  if (day.coveredByTimesheet) {
    return <span className="text-xs text-muted-foreground">In timesheet</span>;
  }
  return (
    <>
      {day.events.map((event) => (
        <span
          key={`${event.kind}-${event.label}-${event.halfDay}`}
          className={`inline-flex max-w-full rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-snug whitespace-normal break-words ${
            event.kind === "Remote Work"
              ? "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200"
              : "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200"
          }`}
        >
          {event.label}
          {event.halfDay ? " - half day" : ""}
        </span>
      ))}
      {weekend && <span className="text-xs text-muted-foreground">Weekend</span>}
    </>
  );
}

export function HistoricalLeaveCalendar({
  leaveRequests,
  periods,
  workingDays,
  asOfDate,
}: {
  leaveRequests: readonly LeaveRequest[];
  periods: readonly Pick<TimesheetPeriod, "startDate" | "endDate">[];
  workingDays: readonly number[];
  asOfDate: string;
}) {
  const months = useMemo(
    () => historicalLeaveMonths({ leaveRequests, periods, asOfDate }),
    [leaveRequests, periods, asOfDate],
  );
  const [selectedMonth, setSelectedMonth] = useState("");
  const selected = months.find((month) => month.month === selectedMonth) ?? months[0];
  if (!selected) return null;

  const firstWeekday = (utcDate(selected.days[0]!.date).getUTCDay() + 6) % 7;
  const leaveDays = selected.days.filter((day) =>
    day.events.some((event) => event.kind === "Leave"),
  ).length;
  const remoteDays = selected.days.filter((day) =>
    day.events.some((event) => event.kind === "Remote Work"),
  ).length;

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="text-base">Leave and remote work history</CardTitle>
          <CardDescription>
            Approved records through today from dates without a timesheet. No worked hours are
            estimated here.
          </CardDescription>
        </div>
        <label className="flex flex-col gap-1 text-sm font-medium sm:min-w-48">
          Month
          <select
            value={selected.month}
            onChange={(event) => setSelectedMonth(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            aria-label="Historical leave month"
          >
            {months.map((month) => (
              <option key={month.month} value={month.month}>
                {monthLabel(month.month)}
              </option>
            ))}
          </select>
        </label>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>
            {leaveDays} {leaveDays === 1 ? "leave day" : "leave days"} | {remoteDays}{" "}
            {remoteDays === 1 ? "remote day" : "remote days"}
          </span>
          <span>
            Credited hours: <strong className="font-medium text-foreground">Not calculated</strong>
          </span>
        </div>
        <div className="hidden sm:block">
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">
            {WEEKDAYS.map((weekday) => (
              <div key={weekday} className="py-1">
                {weekday}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: firstWeekday }, (_, index) => (
              <div key={`blank-${index}`} aria-hidden="true" />
            ))}
            {selected.days.map((day) => {
              const weekend = !workingDays.includes(utcDate(day.date).getUTCDay());
              return (
                <div
                  key={day.date}
                  className={`min-h-20 space-y-1 rounded-lg border p-2 ${weekend ? "bg-muted/40" : "bg-card"}`}
                  aria-label={`${day.date}: ${day.coveredByTimesheet ? "In timesheet" : day.events.map((event) => event.label).join(", ") || (weekend ? "Weekend" : "No leave recorded")}`}
                >
                  <span className="block text-xs font-semibold">{Number(day.date.slice(-2))}</span>
                  <div className="flex flex-col items-start gap-1">
                    <DayLabels day={day} weekend={weekend} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="divide-y rounded-lg border sm:hidden">
          {selected.days.map((day) => {
            const weekday = utcDate(day.date).getUTCDay();
            const weekend = !workingDays.includes(weekday);
            return (
              <div
                key={day.date}
                className={`flex min-h-12 items-start justify-between gap-3 px-3 py-2 ${weekend ? "bg-muted/40" : ""}`}
              >
                <span className="shrink-0 text-sm font-medium">
                  {WEEKDAYS[(weekday + 6) % 7]} {Number(day.date.slice(-2))}
                </span>
                <div className="flex flex-wrap justify-end gap-1">
                  <DayLabels day={day} weekend={weekend} />
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Blank weekdays have no approved leave or remote work recorded. Dates covered by a
          timesheet appear in its own calendar.
        </p>
      </CardContent>
    </Card>
  );
}
