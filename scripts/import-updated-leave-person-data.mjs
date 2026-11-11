import { groupDays, normaliseName } from "./leave-history-data.mjs";
import { getCodeDefinition, matchSourceNames } from "./reconcile-leave-history-data.mjs";

const effectiveStatuses = new Set(["Approved", "Taken"]);

function coversSameDay(request, day) {
  if (!effectiveStatuses.has(request.status)) return false;
  if (request.policy_snapshot?.type !== getCodeDefinition(day.code)?.[1]) return false;
  if (Boolean(request.is_half_day) !== (day.days === 0.5)) return false;
  const workingDates = request.policy_snapshot?.workingDates;
  if (Array.isArray(workingDates) && !workingDates.includes(day.date)) return false;
  if (["AL24", "AL25"].includes(day.code)) {
    if (
      request.policy_snapshot?.spreadsheetImport?.entitlementYear !==
      Number(day.code.slice(2)) + 2000
    )
      return false;
  }
  return true;
}

/** Additive plan: never archive or alter existing requests, balances, or approvals. */
export function planUpdatedPersonImport({
  extracted,
  sourceName,
  email,
  employees,
  users,
  matching,
  existing,
  attendance = [],
  timesheets = [],
  asOf,
  onlyDates = null,
}) {
  if (!/^20\d\d-\d\d-\d\d$/.test(asOf)) throw new Error("Pass an explicit YYYY-MM-DD as-of date");
  const sourceKey = normaliseName(sourceName);
  const selectedNames = extracted.names.filter((name) => normaliseName(name) === sourceKey);
  if (!selectedNames.length) throw new Error("The source name is not present in the workbook");
  const { matched, unmatched, former } = matchSourceNames(
    selectedNames,
    employees,
    matching,
    users,
  );
  if (former.length) throw new Error("The source name is marked as a former employee");
  if (unmatched.length || matched.size !== 1)
    throw new Error(
      `The source name does not safely match an active employee: ${JSON.stringify(unmatched)}`,
    );
  const employee = matched.get(sourceKey);
  const activeAccounts = users.filter(
    (user) =>
      user.employee_id === employee.id &&
      user.status === "Active" &&
      !user.archived_at &&
      user.workspace_email?.toLowerCase() === email.trim().toLowerCase(),
  );
  if (activeAccounts.length !== 1)
    throw new Error("The exact active Portal email does not match this employee");

  const current = existing.filter(
    (request) => request.employee_id === employee.id && !request.archived_at,
  );
  const archived = existing.filter(
    (request) => request.employee_id === employee.id && request.archived_at,
  );
  const allSelected = [
    ...extracted.days,
    ...extracted.excluded.filter((day) => day.code === "RM"),
  ].filter((day) => normaliseName(day.name) === sourceKey);
  const dateFilter = onlyDates === null ? null : new Set(onlyDates);
  const selected = dateFilter ? allSelected.filter((day) => dateFilter.has(day.date)) : allSelected;
  if (dateFilter && (dateFilter.size !== onlyDates.length || selected.length !== dateFilter.size))
    throw new Error("Every scoped date must appear exactly once for this employee in the workbook");
  if (!selected.length) throw new Error("This employee has no leave or remote-work markers");

  const seen = new Set();
  const inserts = [];
  const alreadyRecorded = [];
  const withheldFuture = [];
  const conflicts = [];
  for (const day of selected.sort((a, b) => a.date.localeCompare(b.date))) {
    if (!getCodeDefinition(day.code) || ![0.5, 1].includes(day.days))
      throw new Error(`Unexpected code or duration on ${day.date}`);
    if (seen.has(day.date)) {
      conflicts.push({ date: day.date, code: day.code, reason: "Duplicate source date" });
      continue;
    }
    seen.add(day.date);
    if (day.date > asOf) {
      withheldFuture.push({ date: day.date, code: day.code });
      continue;
    }
    if (
      (employee.start_date && day.date < employee.start_date) ||
      (employee.termination_date && day.date > employee.termination_date)
    ) {
      conflicts.push({ date: day.date, code: day.code, reason: "Outside employment dates" });
      continue;
    }
    const overlaps = current.filter(
      (request) => request.start_date <= day.date && request.end_date >= day.date,
    );
    if (overlaps.length === 1 && coversSameDay(overlaps[0], day)) {
      alreadyRecorded.push({ date: day.date, code: day.code, requestId: overlaps[0].id });
      continue;
    }
    if (overlaps.length) {
      conflicts.push({
        date: day.date,
        code: day.code,
        reason: "Overlaps an existing app request",
        requestIds: overlaps.map((request) => request.id),
      });
      continue;
    }
    if (
      attendance.some(
        (record) =>
          !record.archived_at &&
          record.date === day.date &&
          (record.clock_in_at || record.clock_out_at),
      )
    ) {
      conflicts.push({
        date: day.date,
        code: day.code,
        reason:
          "Attendance punches require HR review before adding historical leave or remote work",
      });
      continue;
    }
    if (
      timesheets.some(
        (timesheet) =>
          !timesheet.archived_at &&
          timesheet.start_date <= day.date &&
          timesheet.end_date >= day.date &&
          ((timesheet.status && timesheet.status !== "Draft") ||
            timesheet.period_status === "Closed"),
      )
    ) {
      conflicts.push({
        date: day.date,
        code: day.code,
        reason: "A submitted or closed timesheet needs HR review before historical import",
      });
      continue;
    }
    if (
      archived.some(
        (request) =>
          request.start_date <= day.date &&
          request.end_date >= day.date &&
          request.policy_snapshot?.spreadsheetImport,
      )
    ) {
      conflicts.push({
        date: day.date,
        code: day.code,
        reason: "A historical request for this date was archived",
      });
      continue;
    }
    inserts.push({ ...day, employeeId: employee.id });
  }
  return {
    employeeId: employee.id,
    employeeName: employee.legal_name,
    sourceName,
    asOf,
    sourceDays: selected.length,
    inserts: groupDays(inserts),
    alreadyRecorded,
    withheldFuture,
    conflicts,
    canApply: conflicts.length === 0,
  };
}
