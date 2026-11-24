import { Link } from "@tanstack/react-router";
import { ArrowRight, CircleAlert, CircleCheck, Clock3, Trophy } from "lucide-react";
import type { WorkforceAnalytics } from "@/lib/data/workforce-analytics";
import { weeklyGoalMessage } from "@/lib/data/weekly-goal-message";

const displayHours = (value: number) => {
  const minutes = Math.max(0, Math.round(value * 60));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${String(rest).padStart(2, "0")}m` : `${hours}h`;
};
const compactHours = (value: number) => {
  const minutes = Math.max(0, Math.round(value * 60));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
};

const dateAtNoon = (date: string) => new Date(`${date}T12:00:00Z`);
const shortDate = (date: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    dateAtNoon(date),
  );

function weekLabel(start: string, end: string) {
  const startYear = start.slice(0, 4);
  const endYear = end.slice(0, 4);
  if (startYear !== endYear)
    return `${shortDate(start)} ${startYear} – ${shortDate(end)} ${endYear}`;
  if (start.slice(0, 7) === end.slice(0, 7)) {
    return `${Number(start.slice(8))}–${shortDate(end)} ${endYear}`;
  }
  return `${shortDate(start)} – ${shortDate(end)} ${endYear}`;
}

export function WeeklyGoalCard({
  data,
  employeeId,
}: {
  data: WorkforceAnalytics;
  employeeId: string;
}) {
  const goal = data.weeklyGoalHours;
  if (!goal || !Number.isFinite(goal) || !data.attendanceTracked) return null;

  const progress = weeklyGoalMessage({
    days: data.days,
    today: data.today.date,
    goalHours: goal,
    weekStartDay: data.weekStartDay ?? 1,
    ...(data.workingDays ? { workingDays: data.workingDays } : {}),
    dailyHours: data.dailyHours,
    employeeId,
  });
  const percent = Math.max(0, Math.min(100, (progress.creditedHours / goal) * 100));
  const complete = progress.state === "goal-met" || progress.state === "above-goal";
  const needsReview = progress.state === "needs-review";
  const behind = progress.state === "behind";
  const approvedHours = Math.max(0, progress.creditedHours - progress.workedHours);
  const overGoal = Math.max(0, progress.creditedHours - goal);
  const weekDays = Array.from({ length: 7 }, (_, offset) => {
    const date = dateAtNoon(progress.startDate);
    date.setUTCDate(date.getUTCDate() + offset);
    const key = date.toISOString().slice(0, 10);
    return {
      date: key,
      weekday: new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(date),
      day: data.days.find((entry) => entry.date === key),
      scheduled: data.workingDays ? data.workingDays.includes(date.getUTCDay()) : true,
    };
  });
  const status = complete
    ? "Goal reached"
    : needsReview
      ? "Needs a check"
      : behind
        ? "Behind pace"
        : progress.state === "approved-time"
          ? "Approved time included"
          : progress.state === "new-week"
            ? "New week"
            : "On track";
  const statusColor = complete
    ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
    : needsReview || behind
      ? "bg-amber-50 text-amber-800 ring-amber-200"
      : "bg-primary/5 text-primary ring-primary/15";
  const statusIcon = complete ? (
    <Trophy className="size-3.5" aria-hidden="true" />
  ) : needsReview || behind ? (
    <CircleAlert className="size-3.5" aria-hidden="true" />
  ) : (
    <CircleCheck className="size-3.5" aria-hidden="true" />
  );
  const remainingPace = progress.remainingScheduledDays
    ? progress.remainingHours / progress.remainingScheduledDays
    : null;
  const guidance =
    needsReview && progress.problemDate
      ? `Check ${shortDate(progress.problemDate)} before treating this total as final.`
      : behind && remainingPace !== null
        ? data.dailyHours && remainingPace > data.dailyHours + 0.25
          ? "The remaining time exceeds a normal day. Check your records with HR."
          : `About ${displayHours(remainingPace)} per remaining workday would reach your goal.`
        : progress.headline;

  return (
    <section
      aria-label="My weekly attendance goal"
      data-testid="weekly-goal-card"
      className="overflow-hidden rounded-2xl border border-[#bdd9ec] bg-gradient-to-br from-[#e8f3fc] via-[#f3f8fd] to-[#e8f5f1] shadow-[0_12px_30px_-22px_rgba(11,87,150,0.55)] dark:border-[#365b79] dark:from-[#18334f] dark:via-[#1b344e] dark:to-[#193d43]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#c4deef] px-5 py-3.5 sm:px-6 dark:border-[#365b79]">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-[#0b5796] text-white">
            <Clock3 className="size-4" aria-hidden="true" />
          </span>
          <h2 className="text-sm font-semibold">Weekly attendance</h2>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {weekLabel(progress.startDate, weekDays[6]!.date)}
        </span>
      </div>

      <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-4 px-5 py-5 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-7 sm:px-6 lg:grid-cols-[8.5rem_minmax(0,1fr)_minmax(11rem,14rem)]">
        <div
          className="relative mx-auto flex size-[7rem] items-center justify-center rounded-full sm:size-[8.5rem]"
          style={{
            background: `conic-gradient(${complete ? "#079669" : "var(--primary)"} ${percent}%, var(--muted) ${percent}% 100%)`,
          }}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={goal}
          aria-valuenow={Math.min(goal, progress.creditedHours)}
          aria-label={`${displayHours(progress.creditedHours)} of ${displayHours(goal)} weekly goal`}
        >
          <div className="flex size-[5.75rem] flex-col items-center justify-center rounded-full bg-[#edf6fc] text-center dark:bg-[#19344e] sm:size-[7rem]">
            <strong className="text-xl font-semibold tabular-nums tracking-tight sm:text-[1.65rem]">
              {displayHours(progress.creditedHours)}
            </strong>
            <span className="text-[11px] text-muted-foreground">of {displayHours(goal)}</span>
          </div>
        </div>

        <div className="min-w-0">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${statusColor}`}
          >
            {statusIcon}
            {status}
          </span>
          <p className="mt-3 max-w-xl text-sm font-medium leading-relaxed text-foreground">
            {guidance}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
            <span className="text-muted-foreground">
              Recorded work{" "}
              <strong className="ml-1 font-semibold tabular-nums text-foreground">
                {displayHours(progress.workedHours)}
              </strong>
            </span>
            {approvedHours > 0.01 && (
              <span className="text-muted-foreground">
                Approved time{" "}
                <strong className="ml-1 font-semibold tabular-nums text-foreground">
                  {displayHours(approvedHours)}
                </strong>
              </span>
            )}
            {needsReview && progress.problemDate ? (
              <Link
                to="/staff/me/attendance"
                search={{ correct: progress.problemDate }}
                className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
              >
                Review day <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            ) : (
              <Link
                to="/staff/me/attendance"
                className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
              >
                View attendance <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            )}
          </div>
        </div>

        <div
          className={`col-span-2 flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-white shadow-sm lg:col-span-1 lg:block lg:px-5 lg:py-4 ${complete ? "bg-[#087d61]" : "bg-[#0b5796]"}`}
        >
          <span className="text-xs font-medium text-white/80">
            {complete ? (overGoal > 0 ? "Beyond target" : "Target completed") : "Time to goal"}
          </span>
          <strong className="text-[1.65rem] font-semibold tabular-nums tracking-tight text-white lg:mt-2 lg:block lg:text-3xl">
            {complete
              ? overGoal > 0
                ? `+${displayHours(overGoal)}`
                : displayHours(progress.creditedHours)
              : displayHours(progress.remainingHours)}
          </strong>
          {needsReview && (
            <span className="text-xs text-amber-100 lg:mt-1 lg:block">Provisional</span>
          )}
        </div>
      </div>

      <div className="border-t border-[#c4deef] bg-[#dcecf8]/65 px-4 py-3.5 dark:border-[#365b79] dark:bg-[#122d46]/55 sm:px-6">
        <div className="grid grid-cols-7 gap-1.5 sm:gap-3" aria-label="This week's daily hours">
          {weekDays.map(({ date, weekday, day, scheduled }) => {
            const future = date > data.today.date;
            const credited = day ? Math.max(day.worked, day.attendanceCredit) : 0;
            const review = !future && Boolean(day && (day.review > 0 || day.missing > 0));
            const target = day?.attendanceTarget || data.dailyHours || 8;
            const dailyPercent = Math.min(100, (credited / target) * 100);
            const label = future
              ? "—"
              : review
                ? "Review"
                : credited > 0
                  ? displayHours(credited)
                  : scheduled
                    ? "—"
                    : "Off";
            return (
              <div
                key={date}
                className="min-w-0 text-center"
                aria-label={`${weekday} ${shortDate(date)}: ${future ? "upcoming" : review ? "needs review" : credited > 0 ? `${displayHours(credited)} credited` : scheduled ? "no time recorded" : "non-working day"}`}
              >
                <div className="flex items-baseline justify-center gap-1 text-[11px] text-muted-foreground">
                  <span>{weekday}</span>
                  <span className="tabular-nums">{Number(date.slice(8))}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border/70">
                  <div
                    className={`h-full rounded-full ${review ? "bg-amber-500" : credited >= target - 0.01 ? "bg-emerald-600" : "bg-primary"}`}
                    style={{ width: `${dailyPercent}%` }}
                  />
                </div>
                <span
                  className={`mt-1.5 block truncate text-[11px] font-semibold tabular-nums ${review ? "text-amber-700" : future || !credited ? "text-muted-foreground" : "text-foreground"}`}
                >
                  {credited > 0 && !review && !future ? (
                    <>
                      <span className="sm:hidden">{compactHours(credited)}</span>
                      <span className="hidden sm:inline">{label}</span>
                    </>
                  ) : (
                    label
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
