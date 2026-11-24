import { Link } from "@tanstack/react-router";
import { ArrowRight, Clock3, Trophy } from "lucide-react";
import type { WorkforceAnalytics } from "@/lib/data/workforce-analytics";
import { weeklyGoalMessage } from "@/lib/data/weekly-goal-message";

const displayHours = (value: number) => {
  const minutes = Math.max(0, Math.round(value * 60));
  const wholeHours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${wholeHours}h ${String(remaining).padStart(2, "0")}m` : `${wholeHours}h`;
};

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
  const days = data.days.filter(
    (day) => day.date >= progress.startDate && day.date <= data.today.date,
  );

  return (
    <section
      aria-label="My weekly attendance goal"
      data-testid="weekly-goal-card"
      className="rounded-2xl border border-primary/15 bg-card p-5 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Your week</h2>
        <span className="text-xs text-muted-foreground">
          {progress.startDate} to {data.today.date}
        </span>
      </div>
      <div className="mt-5 grid gap-6 md:grid-cols-[12rem_minmax(0,1fr)] md:items-center">
        <div
          className="relative mx-auto flex size-44 items-center justify-center rounded-full"
          style={{
            background: `conic-gradient(${complete ? "#079669" : "#0b61ba"} ${percent}%, #e5eaf0 ${percent}% 100%)`,
          }}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={goal}
          aria-valuenow={Math.min(goal, progress.creditedHours)}
          aria-label={`${displayHours(progress.creditedHours)} of ${displayHours(goal)} weekly goal`}
        >
          <div className="flex size-[9.25rem] flex-col items-center justify-center rounded-full bg-card text-center">
            <strong className="text-2xl font-semibold tabular-nums tracking-tight">
              {displayHours(progress.creditedHours)}
            </strong>
            <span className="mt-1 text-xs text-muted-foreground">of {displayHours(goal)} goal</span>
          </div>
        </div>
        <div className="min-w-0">
          <div className="flex items-start gap-2.5">
            {complete ? (
              <Trophy className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden="true" />
            ) : (
              <Clock3 className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
            )}
            <div>
              <p className="text-lg font-semibold leading-snug">{progress.headline}</p>
              <p className="mt-1 text-sm text-muted-foreground">{progress.detail}</p>
              {progress.paceGuidance && (
                <p className="mt-2 text-sm font-medium text-primary">{progress.paceGuidance}</p>
              )}
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-x-7 gap-y-3 border-t pt-4 text-sm">
            <div>
              <strong className="block tabular-nums">{displayHours(progress.workedHours)}</strong>
              <span className="text-xs text-muted-foreground">Recorded work</span>
            </div>
            <div>
              <strong className="block tabular-nums">{displayHours(goal)}</strong>
              <span className="text-xs text-muted-foreground">Weekly goal</span>
            </div>
            <div>
              <strong className="block tabular-nums">
                {progress.provisional ? "Pending review" : displayHours(progress.remainingHours)}
              </strong>
              <span className="text-xs text-muted-foreground">
                {progress.provisional ? "Result is provisional" : "To reach goal"}
              </span>
            </div>
          </div>
          {progress.provisional && progress.problemDate ? (
            <Link
              to="/staff/me/attendance"
              search={{ correct: progress.problemDate }}
              className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              Check {progress.problemDate} <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          ) : (
            <Link
              to="/staff/me/attendance"
              className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              View attendance <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>
      {days.length > 0 && (
        <div
          className="mt-6 grid grid-cols-3 gap-2 border-t pt-4 sm:grid-cols-7"
          aria-label="This week's daily hours"
        >
          {days.map((day) => (
            <div key={day.date} className="min-w-0 rounded-lg bg-muted/40 px-2 py-2 text-center">
              <span className="block text-xs text-muted-foreground">
                {new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(
                  new Date(`${day.date}T12:00:00Z`),
                )}
              </span>
              <strong className="mt-0.5 block text-sm tabular-nums">
                {displayHours(Math.max(day.worked, day.attendanceCredit))}
              </strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
