import "@tanstack/react-start/server-only";
import { randomUUID, createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDatabaseClient } from "../client.ts";
import { officeExceptions, attendancePolicies, attendanceRecords } from "../schema/time.ts";
import { appSettings } from "../schema/organisation.ts";
import { employees } from "../schema/employee.ts";
import { auditEvents } from "../schema/system.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";
import { recordedDailyHours } from "../../data/recorded-hours.ts";
import type { OfficeExceptionType, OfficeCredit } from "../../data/office-exceptions.ts";

type Db = ReturnType<typeof getDatabaseClient>;
function requireHr(actor: AuditActorContext) {
  if (!["HR", "Super Admin"].includes(actor.activeRole))
    throw new Error("Only HR can manage office exceptions.");
}
export async function listOfficeExceptions(org: string, actor: AuditActorContext) {
  requireHr(actor);
  return getDatabaseClient()
    .select()
    .from(officeExceptions)
    .where(eq(officeExceptions.organisationId, org))
    .orderBy(sql`${officeExceptions.startDate} DESC`);
}
export async function saveOfficeException(
  org: string,
  input: {
    title: string;
    kind: OfficeExceptionType;
    startDate: string;
    endDate: string;
    scope: "Everyone" | "Location" | "Department" | "Employees";
    scopeId?: string | undefined;
    employeeIds: string[];
    countAsWorked: boolean;
  },
  actor: AuditActorContext,
) {
  requireHr(actor);
  if (
    input.endDate < input.startDate ||
    (Date.parse(input.endDate) - Date.parse(input.startDate)) / 86400000 > 30
  )
    throw new Error("Choose a date range of up to 31 days.");
  return getDatabaseClient().transaction(async (tx) => {
    // Serialise overlapping creation/cancellation within the organisation.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${org + ":office-exceptions"},0))`,
    );
    const [settings] = await tx
      .select()
      .from(appSettings)
      .where(eq(appSettings.organisationId, org));
    if (!settings) throw new Error("Complete company working-day settings first.");
    const [policy] = await tx
      .select()
      .from(attendancePolicies)
      .where(eq(attendancePolicies.organisationId, org));
    const people = await tx
      .select()
      .from(employees)
      .where(and(eq(employees.organisationId, org), isNull(employees.archivedAt)));
    const selected = people.filter(
      (p) =>
        !["Inactive", "Archived"].includes(p.status) &&
        (input.scope === "Everyone" ||
          (input.scope === "Location" && p.locationId === input.scopeId) ||
          (input.scope === "Department" && p.departmentId === input.scopeId) ||
          (input.scope === "Employees" && input.employeeIds.includes(p.id))),
    );
    if (!selected.length) throw new Error("Select at least one active employee.");
    if (input.scope === "Employees" && selected.length !== new Set(input.employeeIds).size)
      throw new Error("Some selected employees are not available in this organisation.");
    const ids = selected.map((p) => p.id);
    const [overlap] = await tx.execute(
      sql`SELECT id FROM office_exceptions WHERE organisation_id=${org}::uuid AND archived_at IS NULL AND start_date<=${input.endDate}::date AND end_date>=${input.startDate}::date AND employee_ids && ${sql`ARRAY[${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}]`} LIMIT 1`,
    );
    if (overlap)
      throw new Error(
        "An office exception already covers some of these people and dates. Cancel it before replacing it.",
      );
    const id = randomUUID();
    await tx.insert(officeExceptions).values({
      id,
      organisationId: org,
      title: input.title,
      kind: input.kind,
      startDate: input.startDate,
      endDate: input.endDate,
      employeeIds: ids,
      scopeLabel: input.scope,
      countAsWorked: input.countAsWorked,
      dailyHours: String(
        recordedDailyHours(
          Number(policy?.standardDailyHours ?? settings.standardDailyHours),
          policy?.defaultBreakMinutes ?? 60,
        ),
      ),
      createdBy: actor.userId!,
      updatedBy: actor.userId!,
    });
    await tx.insert(auditEvents).values({
      organisationId: org,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: "create",
      module: "attendance",
      entityType: "office-exception",
      entityId: id,
      afterSummary: { ...input, employeeIds: ids },
      reason: input.title,
      riskLevel: "Medium",
    });
    return id;
  });
}
export async function cancelOfficeException(org: string, id: string, actor: AuditActorContext) {
  requireHr(actor);
  await getDatabaseClient().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${org + ":office-exceptions"},0))`,
    );
    const [row] = await tx
      .update(officeExceptions)
      .set({
        archivedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: actor.userId!,
        recordVersion: sql`${officeExceptions.recordVersion}+1`,
      })
      .where(
        and(
          eq(officeExceptions.organisationId, org),
          eq(officeExceptions.id, id),
          isNull(officeExceptions.archivedAt),
        ),
      )
      .returning();
    if (!row) throw new Error("This office exception is already cancelled or unavailable.");
    await tx.insert(auditEvents).values({
      organisationId: org,
      actorUserId: actor.userId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: "cancel",
      module: "attendance",
      entityType: "office-exception",
      entityId: id,
      reason: "Office exception cancelled by HR",
      riskLevel: "Medium",
    });
  });
}

/** Leave, holidays, employment dates and weekends are evaluated at read time. */
export async function officeCredits(
  org: string,
  ids: string[],
  start = "1900-01-01",
  end = "2999-12-31",
  db: Pick<Db, "execute"> = getDatabaseClient(),
): Promise<OfficeCredit[]> {
  if (!ids.length) return [];
  const rows =
    await db.execute(sql`SELECT x.id, x.organisation_id, x.created_by, x.created_at, e.id AS employee_id, d.day::date::text AS date,
    CASE WHEN x.count_as_worked THEN x.kind ELSE 'Excused closure' END AS label,
    round(x.daily_hours * greatest(0, 1-coalesce((SELECT sum(CASE WHEN l.is_half_day THEN 0.5 ELSE 1 END) FROM leave_requests l WHERE l.organisation_id=x.organisation_id AND l.employee_id=e.id AND l.archived_at IS NULL AND l.status IN ('Approved','Taken','Cancellation Pending') AND d.day::date BETWEEN l.start_date AND l.end_date),0)),2) AS hours
    FROM office_exceptions x JOIN app_settings s ON s.organisation_id=x.organisation_id
    JOIN employees e ON e.organisation_id=x.organisation_id AND e.id=ANY(x.employee_ids)
    CROSS JOIN LATERAL generate_series(greatest(x.start_date,${start}::date),least(x.end_date,${end}::date), interval '1 day') d(day)
    WHERE x.organisation_id=${org}::uuid AND x.archived_at IS NULL
      AND e.id IN (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
      AND d.day::date>=e.start_date AND (e.termination_date IS NULL OR d.day::date<=e.termination_date)
      AND extract(dow FROM d.day)::int=ANY(s.working_days)
      AND NOT EXISTS (SELECT 1 FROM public_holidays h WHERE h.organisation_id=x.organisation_id AND h.is_active AND h.archived_at IS NULL AND h.holiday_date=d.day::date AND (h.location_id IS NULL OR h.location_id=e.location_id))`);
  return rows
    .map((r) => ({
      id: String(r["id"]),
      organisationId: String(r["organisation_id"]),
      createdBy: String(r["created_by"]),
      createdAt: new Date(String(r["created_at"])),
      employeeId: String(r["employee_id"]),
      date: String(r["date"]),
      label: String(r["label"]),
      hours: Number(r["hours"]),
    }))
    .filter((r) => r.hours > 0);
}

type Row = typeof attendanceRecords.$inferSelect;
export function applyOfficeCredits(
  records: Row[],
  credits: OfficeCredit[],
): Array<Row & { officeExceptionLabel?: string; creditedHours?: number }> {
  const result: Array<Row & { officeExceptionLabel?: string; creditedHours?: number }> = [
    ...records,
  ];
  for (const credit of credits) {
    const index = result.findIndex(
      (r) => r.employeeId === credit.employeeId && r.date === credit.date,
    );
    const original = result[index];
    if (original && ["Holiday", "Rest Day"].includes(original.status)) continue;
    const hash = createHash("sha256")
      .update(`${credit.id}:${credit.employeeId}:${credit.date}`)
      .digest("hex")
      .slice(0, 32);
    const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
    const row: Row & { creditedHours: number; officeExceptionLabel: string } = {
      ...(original ?? {
        id,
        organisationId: credit.organisationId,
        employeeId: credit.employeeId,
        date: credit.date,
        clockInAt: null,
        clockOutAt: null,
        breakMinutes: 0,
        source: "Manual Entry",
        createdAt: credit.createdAt,
        updatedAt: credit.createdAt,
        createdBy: credit.createdBy,
        updatedBy: credit.createdBy,
        shiftId: null,
        expectedClockIn: null,
        expectedClockOut: null,
        location: null,
        locationId: null,
        capturedLatitude: null,
        capturedLongitude: null,
        capturedAccuracyMeters: null,
        clockOutLocationId: null,
        clockOutCapturedLatitude: null,
        clockOutCapturedLongitude: null,
        clockOutCapturedAccuracyMeters: null,
        workMode: null,
        siteVisitId: null,
        archivedAt: null,
        recordVersion: 1,
      }),
      status: "Present",
      isLate: false,
      isEarlyDeparture: false,
      calculatedHours: String(credit.hours),
      creditedHours: credit.hours,
      officeExceptionLabel: credit.label,
    };
    if (index >= 0) result[index] = row;
    else result.push(row);
  }
  return result;
}
