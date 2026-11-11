import { groupDays, normaliseName, stableId } from "./leave-history-data.mjs";
import { sourceIsOld2026 } from "./reconcile-leave-history-data.mjs";

export const SURABHI_SOURCE_NAME = "Surabhi Bharadwaj";
export const EXPECTED_SOURCE_PAIRS = 214;

const effectiveStatuses = new Set(["Approved", "Taken"]);

function sameSourceName(value) {
  return normaliseName(value) === normaliseName(SURABHI_SOURCE_NAME);
}

/** The old and updated workbooks must independently identify the same dates. */
export function changedSurabhiDates(previous, updated) {
  const previousHalfDays = previous.days.filter(
    (day) =>
      sameSourceName(day.name) &&
      day.code === "HFD" &&
      day.rawCode?.toUpperCase().replace(/\s+/g, "") === "HFD/R",
  );
  const updatedRemote = updated.excluded.filter(
    (day) => sameSourceName(day.name) && day.code === "RM",
  );
  const priorDates = new Set(previousHalfDays.map((day) => day.date));
  const updatedDates = new Set(updatedRemote.map((day) => day.date));
  if (
    previousHalfDays.length !== EXPECTED_SOURCE_PAIRS ||
    priorDates.size !== EXPECTED_SOURCE_PAIRS ||
    updatedDates.size < EXPECTED_SOURCE_PAIRS
  )
    throw new Error("Surabhi's verified old/new source dates changed; stop for review");
  const pairs = updatedRemote.filter((day) => priorDates.has(day.date));
  if (pairs.length !== EXPECTED_SOURCE_PAIRS)
    throw new Error("Not every verified HFD/R date became RM in the updated workbook");
  return pairs.sort((a, b) => a.date.localeCompare(b.date));
}

function oldRequestIsOnlyWorkerMarkedTaken({
  request,
  date,
  organisationId,
  employeeId,
  oldImporter,
  markTakenEvents,
  oldPolicy,
  ledgerReferenceIds,
}) {
  if (
    request.id !== stableId(`${organisationId}:${employeeId}:approved-history:${date}:HFD`) ||
    request.start_date !== date ||
    request.end_date !== date ||
    request.is_half_day !== true ||
    Number(request.working_days_requested) !== 0.5 ||
    request.status !== "Taken" ||
    request.record_version !== 2 ||
    request.created_by !== oldImporter ||
    !request.updated_by ||
    request.policy_id !== oldPolicy?.id ||
    !Array.isArray(request.chain_approvals) ||
    request.chain_approvals.length !== 0 ||
    request.policy_snapshot?.type !== "Other" ||
    !sourceIsOld2026(request) ||
    request.policy_snapshot?.spreadsheetImport?.days?.length !== 1 ||
    request.policy_snapshot.spreadsheetImport.days[0]?.code !== "HFD" ||
    request.policy_snapshot.spreadsheetImport.days[0]?.date !== date ||
    request.policy_snapshot.spreadsheetImport.days[0]?.rawCode
      ?.toUpperCase()
      .replace(/\s+/g, "") !== "HFD/R" ||
    request.policy_snapshot?.workingDates?.length !== 1 ||
    request.policy_snapshot.workingDates[0] !== date ||
    ledgerReferenceIds.has(request.id)
  )
    return false;
  return markTakenEvents.some(
    (event) =>
      event.actor_user_id === request.updated_by &&
      event.action === "mark-taken" &&
      event.module === "leave" &&
      Array.isArray(event.after_summary?.requestIds) &&
      event.after_summary.requestIds.includes(request.id),
  );
}

/**
 * Produce a reversible, strictly provenance-checked reclassification plan.
 * Uncovered RM days are left to the separate additive person importer.
 */
export function planSurabhiRemoteReclassification({
  previous,
  updated,
  organisationId,
  employee,
  user,
  email,
  existing,
  oldPolicy,
  oldPolicyHasBalance,
  oldPolicyHasLedger,
  markTakenEvents,
  ledgerReferenceIds,
  attendance,
  asOf,
}) {
  if (asOf !== "2026-11-09") throw new Error("Use the verified 2026-11-09 snapshot");
  if (
    !employee ||
    !user ||
    normaliseName(employee.legal_name) !== normaliseName(SURABHI_SOURCE_NAME)
  )
    throw new Error("The active employee identity does not match Surabhi");
  if (
    employee.status !== "Active" ||
    employee.archived_at ||
    user.employee_id !== employee.id ||
    user.status !== "Active" ||
    user.archived_at ||
    user.workspace_email?.toLowerCase() !== email?.trim().toLowerCase()
  )
    throw new Error("The exact active Portal account is required");
  if (
    !oldPolicy ||
    oldPolicy.code !== "HIST-HFD" ||
    oldPolicy.type !== "Other" ||
    !oldPolicy.is_paid ||
    oldPolicy.is_enabled ||
    oldPolicy.consumes_balance ||
    oldPolicyHasBalance ||
    oldPolicyHasLedger
  )
    throw new Error("Historical half-day policy is not safe to reclassify");

  const pairs = changedSurabhiDates(previous, updated);
  const current = existing.filter((request) => !request.archived_at);
  const oldImporter = stableId("via-approved-leave-history-importer");
  const byDate = new Map(attendance.map((record) => [record.date, record]));
  const replace = [];
  const uncovered = [];
  const alreadyRemote = [];
  const withheldOutsideService = [];
  const conflicts = [];
  for (const day of pairs) {
    if (
      (employee.start_date && day.date < employee.start_date) ||
      (employee.termination_date && day.date > employee.termination_date) ||
      day.date > asOf
    ) {
      withheldOutsideService.push(day.date);
      continue;
    }
    const attendanceRecord = byDate.get(day.date);
    if (
      attendanceRecord &&
      !attendanceRecord.archived_at &&
      attendanceRecord.clock_in_at &&
      attendanceRecord.clock_out_at
    ) {
      conflicts.push({ date: day.date, reason: "Complete attendance requires HR review" });
      continue;
    }
    const overlaps = current.filter(
      (request) => request.start_date <= day.date && request.end_date >= day.date,
    );
    if (overlaps.length === 0) {
      uncovered.push(day.date);
      continue;
    }
    if (
      overlaps.length === 1 &&
      effectiveStatuses.has(overlaps[0].status) &&
      overlaps[0].policy_snapshot?.type === "Remote" &&
      (!Array.isArray(overlaps[0].policy_snapshot?.workingDates) ||
        overlaps[0].policy_snapshot.workingDates.includes(day.date))
    ) {
      alreadyRemote.push(day.date);
      continue;
    }
    if (
      overlaps.length !== 1 ||
      !oldRequestIsOnlyWorkerMarkedTaken({
        request: overlaps[0],
        date: day.date,
        organisationId,
        employeeId: employee.id,
        oldImporter,
        markTakenEvents,
        oldPolicy,
        ledgerReferenceIds,
      })
    ) {
      conflicts.push({
        date: day.date,
        reason: "Existing request is not an untouched worker-completed HFD/R import",
        requestIds: overlaps.map((request) => request.id),
      });
      continue;
    }
    replace.push({ ...day, employeeId: employee.id, oldRequestId: overlaps[0].id });
  }
  return {
    employeeId: employee.id,
    sourcePairs: pairs.length,
    replace,
    replacementGroups: groupDays(replace),
    uncovered,
    alreadyRemote,
    withheldOutsideService,
    conflicts,
    canApply: conflicts.length === 0,
  };
}
