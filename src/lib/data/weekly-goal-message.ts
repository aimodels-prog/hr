import type { AnalyticsDay } from "./workforce-analytics.ts";

export type WeeklyGoalState =
  "needs-review" | "new-week" | "behind" | "on-track" | "approved-time" | "goal-met" | "above-goal";

const leads: Record<WeeklyGoalState, readonly string[]> = {
  "needs-review": [
    "One or more days need a check before this week's result is final.",
    "Your weekly picture may change when the highlighted day is resolved.",
    "Let's make sure every day is accounted for before judging your progress.",
    "A record is missing or waiting for review; your total is provisional.",
    "Your hours may not tell the full story yet. Check the day needing attention.",
    "A pending record could change your weekly total.",
    "There's an attendance detail to review before this week is complete.",
    "Your progress will update when the outstanding record is confirmed.",
  ],
  "new-week": [
    "A fresh week starts here. Your progress will build as time is recorded.",
    "Your new weekly goal is ready. One day at a time.",
    "It's a new week, and your attendance view is ready.",
    "Your weekly circle starts fresh today.",
    "This week's progress begins with the next confirmed record.",
    "A new week gives you a clear view of the hours ahead.",
    "Your time will appear here as the week takes shape.",
    "Here is your starting point for the week.",
  ],
  behind: [
    "You're a little behind your usual pace, but the week is still open.",
    "Your remaining days can still change this week's picture.",
    "This is a progress check, not a final result.",
    "Your current total is below the completed-day pace; there is still time.",
    "Keep an eye on your remaining hours as the week continues.",
    "Your next confirmed day will update this picture.",
    "There is room to build on your current weekly total.",
    "The week is still in progress. Your hours will keep updating.",
  ],
  "on-track": [
    "You're on track this week. Keep it going.",
    "Your recorded time is keeping pace with the week.",
    "Good progress—your weekly total is coming together.",
    "You're moving steadily toward your weekly goal.",
    "Another day recorded, and your goal is in sight.",
    "Your attendance is building a solid week.",
    "You've made a good start toward this week's goal.",
    "Your progress is looking steady so far.",
  ],
  "approved-time": [
    "Your approved time is included in this week's progress.",
    "Work and eligible approved time are both reflected here.",
    "Your weekly total accounts for approved time as well as recorded work.",
    "The time approved for this week is part of your goal progress.",
    "Your attendance view includes the time already approved.",
    "Your weekly circle reflects the full approved picture.",
    "Approved time is counted without inventing a machine punch.",
    "Your work and approved time are shown together in this total.",
  ],
  "goal-met": [
    "Goal reached! You've completed your weekly target. 🏆",
    "You did it—your weekly goal is complete. 🏆",
    "Your progress circle is full. Well done!",
    "That's your weekly target accounted for. Nice work.",
    "You've reached the mark for this week. 🏆",
    "Weekly goal achieved—your time is accounted for.",
    "Your week has reached its target. Well done!",
    "A complete weekly goal is now on your record. 🏆",
  ],
  "above-goal": [
    "Your weekly total is above the goal; the full amount stays visible.",
    "You've passed your weekly target, and every recorded hour is shown.",
    "Goal met—with additional time accounted for this week.",
    "Your circle is complete, and your full weekly total remains on display.",
    "You've recorded more than the weekly target.",
    "Your week is above goal; this does not automatically mean overtime.",
    "The goal is complete, with additional recorded time visible.",
    "Your weekly total continues to show all confirmed time beyond the target.",
  ],
};

const factualEndings = [
  "Your current total is {credited} of {goal} hours.",
  "This week's recorded total stands at {credited} hours.",
  "Your daily breakdown shows how the {credited} hours were built.",
  "Your target is {goal} hours; {credited} are accounted for so far.",
  "The circle will update when your records change.",
  "Recorded work and eligible approved time are kept distinguishable in the detail view.",
  "Your recorded work is {worked} hours; eligible approved time is counted separately.",
  "Open attendance to see the days behind this total.",
] as const;

function formatHours(value: number): string {
  const totalMinutes = Math.max(0, Math.round(value * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${hours}h`;
}

function dateOrdinal(date: string): number {
  return Math.floor(Date.parse(`${date}T12:00:00Z`) / 86_400_000);
}

function weekStart(date: string, startDay: number): string {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() - startDay + 7) % 7));
  return day.toISOString().slice(0, 10);
}

function personalOffset(identity: string): number {
  let hash = 0;
  for (const character of identity) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % 64;
}

/** A stable daily message: eight state-specific leads × eight factual endings = 64 variants. */
export function weeklyGoalMessage(input: {
  days: readonly AnalyticsDay[];
  today: string;
  goalHours: number;
  weekStartDay: number;
  workingDays?: readonly number[];
  dailyHours?: number;
  employeeId: string;
}) {
  const start = weekStart(input.today, input.weekStartDay);
  const days = input.days.filter((day) => day.date >= start && day.date <= input.today);
  const worked = days.reduce((sum, day) => sum + day.worked, 0);
  // Attendance credit includes paid leave, remote work and approved duty. Actual
  // presence above the daily target must still count toward this weekly goal.
  const credited = days.reduce((sum, day) => sum + Math.max(day.worked, day.attendanceCredit), 0);
  const completedDays = days.filter((day) => day.date < input.today);
  const expectedToDate = completedDays.reduce((sum, day) => sum + day.attendanceTarget, 0);
  const problemDay = completedDays.find((day) => day.review > 0 || day.missing > 0);
  const remaining = Math.max(0, input.goalHours - credited);
  const remainingScheduledDays = input.workingDays
    ? Array.from({ length: 7 }, (_, offset) => {
        const date = new Date(`${start}T12:00:00Z`);
        date.setUTCDate(date.getUTCDate() + offset);
        return date;
      }).filter(
        (date) =>
          date.toISOString().slice(0, 10) > input.today &&
          input.workingDays!.includes(date.getUTCDay()),
      ).length
    : 0;
  const state: WeeklyGoalState = problemDay
    ? "needs-review"
    : credited > input.goalHours + 0.01
      ? "above-goal"
      : credited >= input.goalHours - 0.01
        ? "goal-met"
        : credited + 0.25 < expectedToDate
          ? "behind"
          : credited < 0.01
            ? "new-week"
            : credited > worked + 0.5
              ? "approved-time"
              : "on-track";
  // Lead changes daily; the second line changes every eight days. The same
  // complete message cannot recur within 64 calendar days for one state/user.
  const variant = (dateOrdinal(input.today) + personalOffset(input.employeeId)) % 64;
  const facts = {
    credited: formatHours(credited),
    worked: formatHours(worked),
    goal: formatHours(input.goalHours),
  };
  const fill = (copy: string) =>
    copy.replace(/\{(credited|worked|goal)\}/g, (_, key: keyof typeof facts) => facts[key]);
  return {
    state,
    startDate: start,
    creditedHours: Number(credited.toFixed(2)),
    workedHours: Number(worked.toFixed(2)),
    remainingHours: Number(remaining.toFixed(2)),
    remainingScheduledDays,
    paceGuidance:
      state === "behind" && remainingScheduledDays > 0
        ? `${formatHours(remaining)} remains across ${remainingScheduledDays} scheduled ${remainingScheduledDays === 1 ? "day" : "days"} after today - about ${formatHours(remaining / remainingScheduledDays)} per day.${input.dailyHours && remaining / remainingScheduledDays > input.dailyHours + 0.25 ? " This exceeds a normal day; check your records with HR rather than working extra without approval." : " This is a guide, not an overtime request."}`
        : null,
    goalHours: input.goalHours,
    problemDate: problemDay?.date,
    provisional: Boolean(problemDay),
    headline: fill(leads[state][variant % 8]!),
    detail: fill(factualEndings[Math.floor(variant / 8)]!),
  };
}
