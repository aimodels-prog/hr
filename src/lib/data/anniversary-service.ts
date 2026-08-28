import { SYSTEM_CONTEXT } from "./types.ts";
import { getApplicationDataServices } from "./application-data.ts";
import { EmployeeService } from "./employee-service.ts";
import type { ActorContext, Employee } from "./types.ts";

/** Tenure lengths VIA recognizes as milestones worth a reminder/notification. */
export const MILESTONE_YEARS: readonly number[] = [1, 2, 3, 5, 7, 10, 15, 20, 25, 30, 35, 40];

const REMINDER_THRESHOLDS = [30, 14, 7, 1, 0];
// How many days after a missed anniversary the engine will still backfill it, matching
// getUpcomingAnniversaries's own "recently passed" window. Without a bound, a naive `<=`
// catch-up would keep re-treating a months-old anniversary (this year's now-stale occurrence,
// since this loop doesn't roll forward to next year the way getUpcomingAnniversaries does) as
// freshly "reached" for as long as the page went unopened.
const CATCHUP_WINDOW_DAYS = 14;

export interface UpcomingAnniversary {
  employee: Employee;
  /** ISO date (YYYY-MM-DD) of the next occurrence of this employee's hire-date anniversary. */
  anniversaryDate: string;
  yearsOfService: number;
  /** Negative when the date already passed within the lookback window. */
  daysRemaining: number;
  isMilestone: boolean;
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Parses a "YYYY-MM-DD" (or ISO datetime) string into local calendar-date components without
 * ever routing through `Date`'s UTC string-parsing - `new Date("2026-08-27")` parses as UTC
 * midnight, so reading it back with local getters (or serializing with toISOString) silently
 * shifts the date by one day for anyone whose browser timezone isn't UTC+0, in either direction.
 */
function parseIsoDateParts(raw: string): { year: number; month: number; day: number } | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const probe = new Date(year, month, day);
  if (probe.getFullYear() !== year || probe.getMonth() !== month || probe.getDate() !== day) {
    return undefined;
  }
  return { year, month, day };
}

/** Formats a local Date as YYYY-MM-DD using local calendar fields - see parseIsoDateParts. */
function toLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * This year's occurrence of the employee's hire-date anniversary, and how many years of
 * service that occurrence represents. Returns undefined for an unparseable or future start date.
 */
function thisYearOccurrence(
  startDateRaw: string,
  today: Date,
): { date: Date; yearsOfService: number } | undefined {
  const parts = parseIsoDateParts(startDateRaw);
  if (!parts) return undefined;
  const start = new Date(parts.year, parts.month, parts.day);
  if (start.getTime() > today.getTime()) return undefined;
  const date = new Date(today.getFullYear(), parts.month, parts.day);
  const yearsOfService = today.getFullYear() - parts.year;
  return { date, yearsOfService };
}

export class AnniversaryService {
  private employeeService = new EmployeeService();

  /**
   * Every employee whose hire-date anniversary falls within [-daysBehind, +daysAhead] of today,
   * rolling forward to next year's occurrence once this year's has fallen further behind than
   * daysBehind (so a milestone from 9 months ago doesn't linger forever as "recently passed").
   */
  getUpcomingAnniversaries(daysAhead = 90, daysBehind = 14): UpcomingAnniversary[] {
    const employees = this.employeeService
      .getEmployeeRepository(SYSTEM_CONTEXT)
      .list({ includeArchived: false })
      .filter((e) => e.status !== "Archived");
    const today = startOfDay(new Date());

    const results: UpcomingAnniversary[] = [];
    for (const employee of employees) {
      const occurrence = thisYearOccurrence(employee.startDate, today);
      if (!occurrence || occurrence.yearsOfService < 1) continue;

      let { date, yearsOfService } = occurrence;
      let daysRemaining = daysBetween(today, date);

      if (daysRemaining < -daysBehind) {
        const nextYearDate = new Date(today.getFullYear() + 1, date.getMonth(), date.getDate());
        const nextDaysRemaining = daysBetween(today, nextYearDate);
        if (nextDaysRemaining > daysAhead) continue;
        date = nextYearDate;
        yearsOfService += 1;
        daysRemaining = nextDaysRemaining;
      } else if (daysRemaining > daysAhead) {
        continue;
      }

      results.push({
        employee,
        anniversaryDate: toLocalIsoDate(date),
        yearsOfService,
        daysRemaining,
        isMilestone: MILESTONE_YEARS.includes(yearsOfService),
      });
    }

    return results.sort((a, b) => a.daysRemaining - b.daysRemaining);
  }

  /**
   * Creates reminder notifications for milestone anniversaries crossing a reminder threshold
   * today. Safe to call on every page load - deduplicationKey means each employee/milestone/
   * threshold/recipient combination is only ever notified once.
   */
  async runReminderEngine(actorContext: ActorContext): Promise<void> {
    const { notifications } = getApplicationDataServices();
    const employees = this.employeeService
      .getEmployeeRepository(SYSTEM_CONTEXT)
      .list({ includeArchived: false })
      .filter((e) => e.status !== "Archived");
    const users = this.employeeService.getUserRepository(SYSTEM_CONTEXT).list();
    const hrUsers = users.filter((u) => u.roles.includes("HR") && u.status === "Active");
    const today = startOfDay(new Date());

    for (const employee of employees) {
      const occurrence = thisYearOccurrence(employee.startDate, today);
      if (!occurrence) continue;
      const { date, yearsOfService } = occurrence;
      if (!MILESTONE_YEARS.includes(yearsOfService)) continue;

      const daysRemaining = daysBetween(today, date);
      // Every threshold reached or passed, not just an exact match for today - this app has no
      // server-side cron, so a run can easily be skipped on the exact calendar day a threshold
      // is crossed. The lower bound stops a months-old, now-stale occurrence (this loop doesn't
      // roll forward to next year the way getUpcomingAnniversaries does) from being treated as
      // freshly "reached" indefinitely. Each (employee, threshold, recipient) notification is
      // deduplicated below, so re-detecting an already-reached threshold on a later run is a
      // no-op - safe to backfill in one pass.
      const reachedThresholds = REMINDER_THRESHOLDS.filter(
        (t) => daysRemaining <= t && daysRemaining >= -CATCHUP_WINDOW_DAYS,
      );
      if (reachedThresholds.length === 0) continue;

      const yearsLabel = `${yearsOfService} year${yearsOfService === 1 ? "" : "s"}`;
      const milestoneLabel = ordinal(yearsOfService);
      // Live status, appended to every notification below regardless of which historical
      // threshold it represents, so a backfilled reminder still tells the reader where things
      // actually stand today rather than reading as stale/wrong.
      const currentStatus =
        daysRemaining < 0
          ? `Their anniversary was ${Math.abs(daysRemaining)} day${Math.abs(daysRemaining) === 1 ? "" : "s"} ago, on ${toLocalIsoDate(date)}.`
          : daysRemaining === 0
            ? `Their anniversary is today, ${toLocalIsoDate(date)}.`
            : `Their anniversary is in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}, on ${toLocalIsoDate(date)}.`;

      const employeeUser = users.find((u) => u.employeeId === employee.id);
      const managerUser = employee.lineManagerId
        ? users.find((u) => u.employeeId === employee.lineManagerId)
        : undefined;

      for (const threshold of reachedThresholds) {
        // Each backfilled notification describes ITS OWN threshold, not the live day count -
        // otherwise a long-missed milestone would generate several notifications that all read
        // identically, which looks like spam rather than distinct missed checkpoints.
        const isToday = threshold === 0;
        const title = isToday
          ? `Happy ${milestoneLabel} work anniversary!`
          : `${milestoneLabel} work anniversary reminder: ${threshold} day${threshold === 1 ? "" : "s"} to go`;
        const employeeMilestoneLine = isToday
          ? `Today marks your ${milestoneLabel} work anniversary.`
          : `Your ${milestoneLabel} work anniversary was flagged ${threshold} day${threshold === 1 ? "" : "s"} out.`;
        const hrTitle = isToday
          ? `${employee.preferredName} reaches their ${milestoneLabel} work anniversary today`
          : `${employee.preferredName}'s ${milestoneLabel} work anniversary reminder: ${threshold} day${threshold === 1 ? "" : "s"} to go`;

        if (employeeUser) {
          notifications.create(
            {
              recipientUserId: employeeUser.id,
              type: "work_anniversary",
              title,
              message: `${employeeMilestoneLine} You joined VIA on ${employee.startDate}. Thank you for ${yearsLabel} of service. ${currentStatus}`,
              priority: "Normal",
              status: "Unread",
              deduplicationKey: `anniversary_${employee.id}_${yearsOfService}yr_${threshold}d_emp`,
              link: {
                entityType: "employee",
                entityId: employee.id,
                path: `/staff/employees/${employee.id}`,
              },
            },
            actorContext,
          );
        }

        for (const hr of hrUsers) {
          notifications.create(
            {
              recipientUserId: hr.id,
              type: "work_anniversary",
              title: hrTitle,
              message: `${employee.preferredName} ${employee.legalName} (${employee.employeeNumber}) reaches ${yearsLabel} of service. ${currentStatus}`,
              priority: "Normal",
              status: "Unread",
              deduplicationKey: `anniversary_${employee.id}_${yearsOfService}yr_${threshold}d_hr_${hr.id}`,
              link: {
                entityType: "anniversary",
                entityId: employee.id,
                path: "/staff/anniversaries",
              },
            },
            actorContext,
          );
        }

        if (managerUser) {
          notifications.create(
            {
              recipientUserId: managerUser.id,
              type: "work_anniversary",
              title: hrTitle,
              message: `Consider recognising ${employee.preferredName}'s ${yearsLabel} milestone with VIA. ${currentStatus}`,
              priority: "Normal",
              status: "Unread",
              deduplicationKey: `anniversary_${employee.id}_${yearsOfService}yr_${threshold}d_mgr`,
              link: {
                entityType: "employee",
                entityId: employee.id,
                path: `/staff/employees/${employee.id}`,
              },
            },
            actorContext,
          );
        }
      }
    }
  }
}
