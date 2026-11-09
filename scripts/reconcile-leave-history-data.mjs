import { codes, groupDays, normaliseName } from "./leave-history-data.mjs";

export const OLD_2026_SHA256 = "bb8612aac330c3a4b2c3f3a2b8a49197dda71d4731330a029fe89fcfdf35c6dd";
export const UPDATED_2026_SHA256 =
  "6e31a8b7e30b3d65cd55ad2adb498731c36c61e7228061aab6c1d238c30b43e0";
export const OLD_2026_FILE = "Leave tracker 2025 to 2026 (1).xlsx";
export const UPDATED_2026_FILE = "Leave tracker 2025 to 2026 (2).xlsx";
export const RECONCILE_VERSION = 2;

const effectiveStatuses = new Set(["Approved", "Taken"]);
const employedStatuses = new Set(["Onboarding", "Active", "Probation", "Notice"]);
const terminalStatuses = new Set([
  "Cancelled",
  "Cancellation Approved",
  "Declined",
  "Automatically Refused",
]);

export function getCodeDefinition(code) {
  if (code === "RM") return ["Remote Work", "Remote"];
  return codes[code];
}

export function sourceIsOld2026(request) {
  const info = request.policy_snapshot?.spreadsheetImport;
  return (
    info?.version === 1 &&
    Array.isArray(info.days) &&
    info.days.length > 0 &&
    info.days.every(
      (day) =>
        day.source?.sha256?.toLowerCase() === OLD_2026_SHA256 && day.source?.file === OLD_2026_FILE,
    )
  );
}

export function sourceIsUpdated2026(request) {
  const info = request.policy_snapshot?.spreadsheetImport;
  return (
    info?.version === RECONCILE_VERSION && info.sourceSha256?.toLowerCase() === UPDATED_2026_SHA256
  );
}

export function isHistoricalRequestSafeToArchive(request, importer) {
  return (
    sourceIsOld2026(request) &&
    effectiveStatuses.has(request.status) &&
    request.created_by === importer &&
    request.updated_by === importer &&
    request.record_version === 1 &&
    !request.archived_at &&
    Array.isArray(request.chain_approvals) &&
    request.chain_approvals.length === 0 &&
    request.policy_snapshot.spreadsheetImport.days.every(
      (day) => day.code === request.policy_snapshot.spreadsheetImport.days[0].code,
    ) &&
    Number(request.working_days_requested) ===
      request.policy_snapshot.spreadsheetImport.days.reduce((sum, day) => sum + day.days, 0) &&
    request.policy_snapshot?.type ===
      getCodeDefinition(request.policy_snapshot.spreadsheetImport.days[0].code)?.[1]
  );
}

/** Map source names to one active employee each; never create identities from a name alone. */
export function matchSourceNames(names, employees, matching, users = []) {
  const aliases = new Map(
    Object.entries(matching.aliases ?? {}).map(([source, target]) => [
      normaliseName(source),
      normaliseName(target),
    ]),
  );
  const former = new Set([
    ...(matching.formerEmployees ?? []).map(normaliseName),
    // The updated workbook explicitly formats this name red (former staff).
    normaliseName("Mohamed Almaiman"),
  ]);
  const employeesByName = new Map();
  for (const employee of employees) {
    const key = normaliseName(employee.legal_name);
    if (!employeesByName.has(key)) employeesByName.set(key, []);
    employeesByName.get(key).push(employee);
  }
  const usersByEmployee = new Map();
  for (const user of users) {
    if (!usersByEmployee.has(user.employee_id)) usersByEmployee.set(user.employee_id, []);
    usersByEmployee.get(user.employee_id).push(user);
  }
  const expectedEmails = new Map(
    Object.entries(matching.expectedWorkspaceEmails ?? {}).map(([source, email]) => [
      normaliseName(source),
      String(email).trim().toLowerCase(),
    ]),
  );
  const matched = new Map();
  const unmatched = [];
  const formerNames = [];
  for (const name of [...new Set(names)].sort()) {
    const key = normaliseName(name);
    if (former.has(key)) {
      formerNames.push(name);
      continue;
    }
    const choices = employeesByName.get(aliases.get(key) ?? key) ?? [];
    const active = choices.filter(
      (employee) => employedStatuses.has(employee.status) && !employee.archived_at,
    );
    if (active.length !== 1) {
      unmatched.push({
        name,
        reason: active.length ? "Ambiguous active employees" : "No active employee",
      });
      continue;
    }
    const expectedEmail = expectedEmails.get(key);
    if (expectedEmail) {
      const accounts = usersByEmployee.get(active[0].id) ?? [];
      if (
        !accounts.some(
          (user) =>
            user.status === "Active" &&
            !user.archived_at &&
            user.workspace_email?.toLowerCase() === expectedEmail,
        )
      ) {
        unmatched.push({ name, reason: "Protected Portal email does not match" });
        continue;
      }
    }
    matched.set(key, active[0]);
  }
  return { matched, unmatched, former: formerNames };
}

function dateWithin(request, date) {
  return request.start_date <= date && request.end_date >= date;
}

function existingRequestCoversDay(request, day) {
  if (!dateWithin(request, day.date)) return false;
  if (!effectiveStatuses.has(request.status)) return false;
  const expectedType = getCodeDefinition(day.code)?.[1];
  if (request.policy_snapshot?.type !== expectedType) return false;
  const workingDates = request.policy_snapshot?.workingDates;
  if (Array.isArray(workingDates) && !workingDates.includes(day.date)) return false;
  if (day.days === 0.5 && !request.is_half_day) return false;
  if (day.days === 1 && request.is_half_day) return false;
  if (["AL24", "AL25"].includes(day.code)) {
    const entitlementYear = request.policy_snapshot?.spreadsheetImport?.entitlementYear;
    // A generic Annual request does not prove which entitlement year's ledger
    // it used. Treat that as a conflict requiring HR review, not a duplicate.
    if (entitlementYear !== Number(day.code.slice(2)) + 2000) return false;
  }
  return true;
}

/** Pure plan; database reads and writes are deliberately outside this function. */
export function planReconciliation({
  extracted,
  employees,
  users,
  matching,
  existing,
  asOf,
  importer,
  reconciler,
}) {
  if (!/^20\d\d-\d\d-\d\d$/.test(asOf)) throw new Error("Pass an explicit YYYY-MM-DD as-of date");
  const { matched, unmatched, former } = matchSourceNames(
    extracted.names,
    employees,
    matching,
    users,
  );
  const matchedIds = new Set([...matched.values()].map((employee) => employee.id));
  const conflicts = [];
  for (const request of existing.filter((row) => row.archived_at && sourceIsUpdated2026(row)))
    conflicts.push({ requestId: request.id, reason: "Reconciled record was archived in the app" });
  const current = existing.filter((request) => !request.archived_at);
  const old = current.filter(
    (request) => matchedIds.has(request.employee_id) && sourceIsOld2026(request),
  );
  const oldIds = new Set(old.map((request) => request.id));
  for (const request of old) {
    if (!isHistoricalRequestSafeToArchive(request, importer))
      conflicts.push({
        requestId: request.id,
        reason: "Old imported record has changed or was approved in the app",
      });
  }
  const other = current.filter((request) => !oldIds.has(request.id));
  for (const request of other.filter(sourceIsUpdated2026)) {
    if (
      !effectiveStatuses.has(request.status) ||
      request.created_by !== reconciler ||
      request.updated_by !== reconciler ||
      !Array.isArray(request.chain_approvals) ||
      request.chain_approvals.length
    )
      conflicts.push({ requestId: request.id, reason: "Reconciled record has changed in the app" });
  }
  const activeDays = [];
  const seen = new Set();
  for (const raw of [
    ...extracted.days,
    ...extracted.excluded.filter((entry) => entry.code === "RM"),
  ]) {
    const employee = matched.get(normaliseName(raw.name));
    if (!employee) continue;
    if (!getCodeDefinition(raw.code) || ![0.5, 1].includes(raw.days))
      throw new Error(`Unexpected code or duration: ${raw.name} ${raw.date}`);
    const key = `${employee.id}:${raw.date}`;
    if (seen.has(key)) {
      conflicts.push({ name: raw.name, date: raw.date, reason: "Duplicate workbook date" });
      continue;
    }
    seen.add(key);
    if (
      (employee.start_date && raw.date < employee.start_date) ||
      (employee.termination_date && raw.date > employee.termination_date)
    ) {
      conflicts.push({ name: raw.name, date: raw.date, reason: "Outside service dates" });
      continue;
    }
    activeDays.push({ ...raw, employeeId: employee.id });
  }

  const groups = groupDays(activeDays);
  const inserts = [];
  const alreadyInApp = [];
  const alreadyReconciled = [];
  const withheldFuture = [];
  for (const group of groups) {
    const uncovered = [];
    for (const day of group.days) {
      const overlapping = other.filter(
        (request) => request.employee_id === group.employeeId && dateWithin(request, day.date),
      );
      const approvedSpecial = overlapping.filter(
        (request) =>
          request.policy_snapshot?.specialRequest && existingRequestCoversDay(request, day),
      );
      const resolvedSpecial =
        approvedSpecial.length === 1 &&
        overlapping.every(
          (request) => request.id === approvedSpecial[0].id || terminalStatuses.has(request.status),
        );
      if (!overlapping.length) {
        if (day.date > asOf)
          withheldFuture.push({ name: day.name, date: day.date, code: day.code });
        else uncovered.push(day);
      } else if (
        (overlapping.length === 1 && existingRequestCoversDay(overlapping[0], day)) ||
        resolvedSpecial
      ) {
        const approved = resolvedSpecial ? approvedSpecial[0] : overlapping[0];
        (sourceIsUpdated2026(approved) ? alreadyReconciled : alreadyInApp).push({
          name: day.name,
          date: day.date,
          code: day.code,
          requestId: approved.id,
        });
      } else {
        conflicts.push({
          name: day.name,
          date: day.date,
          reason: "Overlaps a different or pending app request",
          requestIds: overlapping.map((request) => request.id),
        });
      }
    }
    inserts.push(...groupDays(uncovered));
  }
  return {
    matches: [...matched.entries()].map(([source, employee]) => ({
      source,
      employeeId: employee.id,
      legalName: employee.legal_name,
    })),
    unmatched,
    former,
    archiveIds: old.map((request) => request.id),
    inserts,
    alreadyInApp,
    alreadyReconciled,
    withheldFuture,
    conflicts,
    maternityPreserved: extracted.maternityPreserved ?? 0,
    canApply: unmatched.length === 0 && conflicts.length === 0,
  };
}

export function countCodeChanges(oldDays, newDays, from, to) {
  const oldByKey = new Map(
    oldDays.map((day) => [`${normaliseName(day.name)}:${day.date}`, day.code]),
  );
  return newDays.filter(
    (day) => oldByKey.get(`${normaliseName(day.name)}:${day.date}`) === from && day.code === to,
  ).length;
}

/**
 * HR confirmed that Safa's old maternity leave remains maternity leave.
 * The updated workbook accidentally relabelled exactly those 26 dates RM.
 * Keep the original workbook untouched; record the override in provenance.
 */
export function preserveSafaMaternity(updated, previous) {
  const safasName = normaliseName("Safa Al Balushi");
  const oldMaternityDates = new Set(
    previous.days
      .filter((day) => normaliseName(day.name) === safasName && day.code === "MAT")
      .map((day) => day.date),
  );
  if (oldMaternityDates.size !== 95)
    throw new Error("The verified prior source must contain exactly 95 Safa maternity dates");
  const overrides = updated.excluded.filter(
    (day) =>
      normaliseName(day.name) === safasName && day.code === "RM" && oldMaternityDates.has(day.date),
  );
  if (overrides.length !== 26 || new Set(overrides.map((day) => day.date)).size !== 26)
    throw new Error("The updated source must contain exactly 26 matching Safa RM dates");
  const otherMatToRemote = countCodeChanges(
    previous.days,
    updated.excluded.filter((day) => day.code === "RM"),
    "MAT",
    "RM",
  );
  if (otherMatToRemote !== 26)
    throw new Error("Unexpected additional maternity-to-remote changes require review");
  const keys = new Set(overrides.map((day) => `${normaliseName(day.name)}:${day.date}`));
  return {
    ...updated,
    days: [
      ...updated.days,
      ...overrides.map((day) => ({
        ...day,
        code: "MAT",
        days: 1,
        sourceOverride: {
          decision: "HR confirmed maternity leave remains maternity leave",
          originalUpdatedCode: "RM",
          previousCode: "MAT",
          previousSourceSha256: OLD_2026_SHA256,
        },
      })),
    ],
    excluded: updated.excluded.filter((day) => !keys.has(`${normaliseName(day.name)}:${day.date}`)),
    maternityPreserved: 26,
  };
}
