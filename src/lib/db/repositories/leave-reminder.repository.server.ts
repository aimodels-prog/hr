import "@tanstack/react-start/server-only";
import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { getDatabaseClient } from "../client.ts";
import { employees, users } from "../schema/employee.ts";
import { appSettings, organisations } from "../schema/organisation.ts";
import { leaveBalances, leavePolicies, leaveTransactions } from "../schema/leave.ts";
import { notifications } from "../schema/system.ts";
import { leaveYearForDate } from "../../data/leave-year.ts";
import { leaveReminderStage, remainingCarryForReminder } from "../../data/leave-reminders.ts";

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
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: settings.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const year = leaveYearForDate(today, settings.leaveYearStart);
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
    const grouped = new Map<string, Array<{ transactionType: string; days: number }>>();
    for (const row of transactions) {
      const key = `${row.employeeId}:${row.policyId}`;
      const group = grouped.get(key) ?? [];
      group.push({ transactionType: row.transactionType, days: Number(row.days) });
      grouped.set(key, group);
    }
    for (const { balance, userId, name } of rows) {
      const available = Number(balance.balanceDays);
      if (available <= 0) continue;
      const carry = remainingCarryForReminder(
        available,
        grouped.get(`${balance.employeeId}:${balance.policyId}`) ?? [],
      );
      const stage = leaveReminderStage(today, year, carry);
      const inserted = await db
        .insert(notifications)
        .values({
          organisationId,
          recipientUserId: userId,
          type: "leave-usage-reminder",
          title:
            stage.kind === "carry"
              ? "Plan your carried-over leave before May"
              : "Remember to plan your annual leave",
          message:
            stage.kind === "carry"
              ? `Please plan to use old ${name} leave by 30 April ${year}. Your balance includes an estimated ${Number(carry.toFixed(2))} carried-over days, counting approved leave against old days first. Check your dates with HR and request leave. This reminder does not expire or deduct days.`
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
