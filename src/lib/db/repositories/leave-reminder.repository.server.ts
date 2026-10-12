import "@tanstack/react-start/server-only";
import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { getDatabaseClient } from "../client.ts";
import { employees, users } from "../schema/employee.ts";
import { appSettings, organisations } from "../schema/organisation.ts";
import { leaveBalances, leavePolicies, leaveTransactions, leaveRequests } from "../schema/leave.ts";
import { notifications } from "../schema/system.ts";
import { leaveYearForDate } from "../../data/leave-year.ts";
import { reminderRulesFromSettings } from "../../data/reminder-rules.ts";
import { leaveReminderStage } from "../../data/leave-reminders.ts";
import { carryExpiryDateForYear, carryPosition } from "../../data/leave-carry.ts";

export async function processLeaveUsageReminders(now = new Date()) {
  const db = getDatabaseClient();
  const orgs = await db
    .select({ settings: appSettings })
    .from(organisations)
    .innerJoin(appSettings, eq(appSettings.organisationId, organisations.id))
    .where(eq(organisations.isActive, true));
  let sent = 0;
  for (const { settings } of orgs) {
    const organisationId = settings.organisationId;
    const rules = reminderRulesFromSettings(settings.additionalSettings);
    if (!rules.leaveEnabled) continue;
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: settings.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const year = leaveYearForDate(today, settings.leaveYearStart);
    const carryExpiryDate = carryExpiryDateForYear(
      {
        leaveYearStart: settings.leaveYearStart,
        annualCarryExpiryDates: (settings.additionalSettings["annualCarryExpiryDates"] ??
          {}) as Record<string, string | null>,
        annualCarryExpiryMonthDay: (settings.additionalSettings["annualCarryExpiryMonthDay"] ??
          null) as string | null,
      },
      year,
    );
    const rows = await db
      .select({ balance: leaveBalances, userId: users.id, name: leavePolicies.name })
      .from(leaveBalances)
      .innerJoin(
        leavePolicies,
        and(
          eq(leavePolicies.id, leaveBalances.policyId),
          eq(leavePolicies.organisationId, organisationId),
        ),
      )
      .innerJoin(
        employees,
        and(
          eq(employees.id, leaveBalances.employeeId),
          eq(employees.organisationId, organisationId),
        ),
      )
      .innerJoin(
        users,
        and(eq(users.employeeId, employees.id), eq(users.organisationId, organisationId)),
      )
      .where(
        and(
          eq(leaveBalances.organisationId, organisationId),
          eq(leaveBalances.leaveYear, year),
          isNull(leaveBalances.archivedAt),
          isNull(employees.archivedAt),
          isNull(users.archivedAt),
          isNull(leavePolicies.archivedAt),
          eq(leavePolicies.isEnabled, true),
          eq(leavePolicies.type, "Annual"),
          eq(users.status, "Active"),
          inArray(employees.status, ["Active", "Probation", "Notice"]),
        ),
      );
    const transactions = await db
      .select()
      .from(leaveTransactions)
      .where(
        and(
          eq(leaveTransactions.organisationId, organisationId),
          isNull(leaveTransactions.archivedAt),
          gte(leaveTransactions.date, `${year}-${settings.leaveYearStart}`),
          lt(leaveTransactions.date, `${year + 1}-${settings.leaveYearStart}`),
        ),
      );
    const requests = await db
      .select({ id: leaveRequests.id, startDate: leaveRequests.startDate })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.organisationId, organisationId),
          isNull(leaveRequests.archivedAt),
          gte(leaveRequests.startDate, `${year}-${settings.leaveYearStart}`),
          lt(leaveRequests.startDate, `${year + 1}-${settings.leaveYearStart}`),
        ),
      );
    const requestStartDates = new Map(requests.map((request) => [request.id, request.startDate]));
    const grouped = new Map<string, typeof transactions>();
    for (const row of transactions) {
      const key = `${row.employeeId}:${row.policyId}`;
      const group = grouped.get(key) ?? [];
      group.push(row);
      grouped.set(key, group);
    }
    for (const { balance, userId, name } of rows) {
      const position = carryPosition(
        grouped.get(`${balance.employeeId}:${balance.policyId}`) ?? [],
        requestStartDates,
        carryExpiryDate,
      );
      const pendingExpiryChange =
        carryExpiryDate && today > carryExpiryDate
          ? -position.remaining
          : -position.expiryAdjustment;
      const available = Number(balance.balanceDays) + pendingExpiryChange;
      if (available <= 0) continue;
      const carry = Math.max(0, Math.min(available, position.remaining + pendingExpiryChange));
      const stage = leaveReminderStage(
        today,
        year,
        carry,
        rules,
        settings.leaveYearStart,
        carryExpiryDate,
      );
      const deadlineLabel = new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${stage.deadline}T00:00:00Z`));
      const inserted = await db
        .insert(notifications)
        .values({
          organisationId,
          recipientUserId: userId,
          type: "leave-usage-reminder",
          title:
            stage.kind === "carry"
              ? "Plan your carried-over leave"
              : "Remember to plan your annual leave",
          message:
            stage.kind === "carry"
              ? `Please plan to use old ${name} leave${carryExpiryDate ? ` by ${deadlineLabel}` : ""}. Your balance includes ${Number(carry.toFixed(2))} carried-over days. Check your dates with HR and request leave.`
              : `You have ${available} days of ${name} available. Plan a break with your manager and submit your leave request. Normal eligibility and approval rules apply.`,
          priority: "Normal",
          status: "Unread",
          deduplicationKey: `leave-use:${balance.id}:${stage.kind}:${stage.key}`,
          link: { entityType: "leave-balance", entityId: balance.id, path: "/staff/leave" },
          createdBy: userId,
          updatedBy: userId,
        })
        .onConflictDoNothing()
        .returning({ id: notifications.id });
      sent += inserted.length;
    }
  }
  return { sent };
}
