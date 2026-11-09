/**
 * Reconcile the updated 2026 HR calendar against the earlier 2026 import.
 * Source check has no DB connection. Dry run opens a read-only DB transaction.
 * Apply is deliberately gated by source hash, as-of date, organisation and an
 * exact HR-confirmed preservation of Safa's 26 maternity-leave dates.
 *
 * This tool never creates an employee/user, posts a leave-balance transaction,
 * or sends mail. It archives only untouched v1 rows from the exact old source.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import readWorkbook from "read-excel-file/node";
import postgres from "postgres";

import { extractDays, stableId } from "./leave-history-data.mjs";
import {
  OLD_2026_FILE,
  OLD_2026_SHA256,
  UPDATED_2026_FILE,
  UPDATED_2026_SHA256,
  RECONCILE_VERSION,
  getCodeDefinition,
  planReconciliation,
  preserveSafaMaternity,
} from "./reconcile-leave-history-data.mjs";

const args = process.argv.slice(2);
const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const modes = ["--source-check", "--dry-run", "--apply"].filter((flag) => args.includes(flag));
const mode = modes[0] ?? "--dry-run";
const importer = stableId("via-approved-leave-history-importer");
const reconciler = stableId("via-2026-leave-history-reconciler");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function tidyPlan(plan) {
  return {
    matchedEmployees: plan.matches.length,
    unmatched: plan.unmatched,
    former: plan.former,
    archiveOldRequests: plan.archiveIds.length,
    insertHistoricalRequests: plan.inserts.length,
    insertLeaveDays: plan.inserts.reduce(
      (count, group) => count + group.days.reduce((sum, day) => sum + day.days, 0),
      0,
    ),
    alreadyApprovedInApp: plan.alreadyInApp.length,
    alreadyReconciled: plan.alreadyReconciled.length,
    withheldFuture: plan.withheldFuture,
    conflicts: plan.conflicts,
    maternityPreserved: plan.maternityPreserved,
    canApply: plan.canApply,
  };
}

async function parseVerifiedWorkbook(path, expectedFile, expectedSha) {
  if (basename(path) !== expectedFile)
    throw new Error(`Expected the exact source filename ${expectedFile}`);
  const hash = sha256(await readFile(path));
  if (hash !== expectedSha) throw new Error(`Source hash mismatch for ${expectedFile}: ${hash}`);
  const extracted = extractDays(await readWorkbook(path), { file: expectedFile, sha256: hash });
  // The source has one known R marker beyond the last date column. No other
  // undated or unknown cells can be accepted silently.
  const unexpectedIssues = extracted.issues.filter(
    (issue) =>
      !(
        expectedFile === UPDATED_2026_FILE &&
        issue.sheet === "Apr" &&
        issue.name === "Mohamed Almaiman" &&
        issue.rawCode === "R"
      ) &&
      !(
        expectedFile === OLD_2026_FILE &&
        issue.sheet === "Apr" &&
        issue.name === "Mohamed Almaiman" &&
        issue.rawCode === "R"
      ) &&
      !(
        expectedFile === OLD_2026_FILE &&
        issue.sheet === "Feb" &&
        issue.name === "Safa Al Balushi" &&
        issue.rawCode === "MAT" &&
        [32, 33, 34].includes(issue.column)
      ),
  );
  if (unexpectedIssues.length)
    throw new Error(`Unexpected source cells: ${JSON.stringify(unexpectedIssues)}`);
  return extracted;
}

async function main() {
  const updatedPath = option("updated");
  const previousPath = option("previous");
  const asOf = option("as-of");
  const expectedSha = option("expected-sha256")?.toLowerCase();
  if (
    modes.length > 1 ||
    !updatedPath ||
    !previousPath ||
    !/^20\d\d-\d\d-\d\d$/.test(asOf ?? "") ||
    expectedSha !== UPDATED_2026_SHA256
  )
    throw new Error(
      "Usage: node scripts/reconcile-leave-history.mjs --updated='Leave tracker 2025 to 2026 (2).xlsx' --previous='Leave tracker 2025 to 2026 (1).xlsx' --as-of=YYYY-MM-DD --expected-sha256=6e31a8... [--source-check|--dry-run|--apply]",
    );

  const [rawUpdated, previous] = await Promise.all([
    parseVerifiedWorkbook(updatedPath, UPDATED_2026_FILE, UPDATED_2026_SHA256),
    parseVerifiedWorkbook(previousPath, OLD_2026_FILE, OLD_2026_SHA256),
  ]);
  const updated = preserveSafaMaternity(rawUpdated, previous);
  updated.previousDays = [
    ...previous.days,
    ...previous.excluded.filter((day) => day.code === "RM"),
  ];
  const source = {
    asOf,
    updatedFile: UPDATED_2026_FILE,
    updatedSha256: UPDATED_2026_SHA256,
    previousFile: OLD_2026_FILE,
    previousSha256: OLD_2026_SHA256,
    sourceNames: updated.names.length,
    rawLeaveMarkedCells: rawUpdated.days.length,
    rawRemoteMarkedCells: rawUpdated.excluded.filter((day) => day.code === "RM").length,
    effectiveLeaveMarkedCells: updated.days.length,
    effectiveRemoteMarkedCells: updated.excluded.filter((day) => day.code === "RM").length,
    sourceMaternityToRemote: 26,
    maternityPreserved: updated.maternityPreserved,
    sourceIssues: updated.issues,
    balancesChanged: false,
    balanceReconciliationRequired: true,
  };
  if (mode === "--source-check") {
    console.log(JSON.stringify({ mode, ...source, databaseChecked: false }, null, 2));
    return;
  }

  const organisationId = process.env.VIA_HR_IMPORT_ORGANISATION_ID?.trim();
  if (!/^[0-9a-f-]{36}$/i.test(organisationId ?? ""))
    throw new Error("Set the exact VIA_HR_IMPORT_ORGANISATION_ID");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (mode === "--apply") {
    if (asOf !== "2026-11-09")
      throw new Error(
        "This one-time reconciliation may only apply the 2026-11-09 approval snapshot",
      );
    if (process.env.VIA_HR_LEAVE_RECONCILE_CONFIRM_SHA256?.toLowerCase() !== UPDATED_2026_SHA256)
      throw new Error(
        "Apply requires VIA_HR_LEAVE_RECONCILE_CONFIRM_SHA256 set to the updated source SHA-256",
      );
  }
  const matchingPath =
    process.env.VIA_HR_LEAVE_HISTORY_MATCHING_FILE ??
    new URL("./leave-history-matching.local.json", import.meta.url);
  const matching = JSON.parse(await readFile(matchingPath, "utf8"));
  const db = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
  try {
    await db.begin(async (tx) => {
      if (mode === "--dry-run") await tx`SET TRANSACTION READ ONLY`;
      else {
        await tx`SELECT pg_advisory_xact_lock(hashtext('via-approved-leave-history'))`;
        await tx`LOCK TABLE leave_requests IN SHARE ROW EXCLUSIVE MODE`;
      }
      const org =
        await tx`SELECT id FROM organisations WHERE id=${organisationId} AND is_active=true`;
      if (org.length !== 1) throw new Error("The selected organisation is not active");
      const employees =
        await tx`SELECT id,legal_name,status,archived_at,start_date::text,termination_date::text
        FROM employees WHERE organisation_id=${organisationId}`;
      const users = await tx`SELECT employee_id,workspace_email,status,archived_at FROM users
        WHERE organisation_id=${organisationId} AND employee_id IS NOT NULL`;
      const existing =
        await tx`SELECT id,employee_id,start_date::text,end_date::text,is_half_day,status,
        policy_id,policy_snapshot,chain_approvals,working_days_requested,record_version,
        created_by,updated_by,archived_at
        FROM leave_requests WHERE organisation_id=${organisationId}`;
      const plan = planReconciliation({
        extracted: updated,
        employees,
        users,
        matching,
        existing,
        asOf,
        importer,
        reconciler,
      });
      const summary = {
        mode,
        ...source,
        databaseChecked: true,
        organisationId,
        ...tidyPlan(plan),
        balancesChanged: false,
        balanceReconciliationRequired: true,
        balanceChanges: 0,
        staffEmails: 0,
      };
      console.log(JSON.stringify(summary, null, 2));
      if (mode === "--dry-run") return;
      if (!plan.canApply)
        throw new Error(
          "Unmatched employees or app conflicts require manual resolution; no changes committed",
        );

      // Do not archive an old policy's request if its balance ledger was ever used.
      const policyIds = [
        ...new Set(existing.filter((r) => plan.archiveIds.includes(r.id)).map((r) => r.policy_id)),
      ];
      if (policyIds.length) {
        const policies = await tx`SELECT id,code,is_enabled,consumes_balance FROM leave_policies
          WHERE organisation_id=${organisationId} AND id IN ${tx(policyIds)}`;
        if (
          policies.length !== policyIds.length ||
          policies.some((p) => !p.code.startsWith("HIST-") || p.is_enabled || p.consumes_balance)
        )
          throw new Error(
            "Old imported requests use a policy with a changed balance or enabled state",
          );
        const balances =
          await tx`SELECT id FROM leave_balances WHERE organisation_id=${organisationId}
          AND policy_id IN ${tx(policyIds)} LIMIT 1`;
        if (balances.length)
          throw new Error("Old import policy has a leave balance; reconciliation must be manual");
        const transactions =
          await tx`SELECT id FROM leave_transactions WHERE organisation_id=${organisationId}
          AND policy_id IN ${tx(policyIds)} LIMIT 1`;
        if (transactions.length)
          throw new Error("Old import policy has ledger activity; reconciliation must be manual");
        const referencedTransactions = await tx`SELECT id FROM leave_transactions
          WHERE organisation_id=${organisationId} AND reference_id IN ${tx(plan.archiveIds)} LIMIT 1`;
        if (referencedTransactions.length)
          throw new Error(
            "An old import request is linked to a leave ledger entry; reconciliation must be manual",
          );
      }

      if (plan.archiveIds.length) {
        const archived = await tx`UPDATE leave_requests
          SET archived_at=now(),updated_by=${reconciler},record_version=record_version+1
          WHERE organisation_id=${organisationId} AND id IN ${tx(plan.archiveIds)}
            AND archived_at IS NULL RETURNING id`;
        if (archived.length !== plan.archiveIds.length)
          throw new Error("An old request changed while reconciling; transaction rolled back");
      }

      const inserted = [];
      for (const group of plan.inserts) {
        const [label, type] = getCodeDefinition(group.code);
        const paid = group.code !== "UPL";
        const policyId = stableId(`${organisationId}:reconciled-history-policy:${group.code}`);
        await tx`INSERT INTO leave_policies
          (id,organisation_id,code,name,type,category,description,is_paid,scope,accrual_mode,
           base_entitlement_days,carry_forward_limit,approval_chain,is_enabled,is_statutory,
           consumes_balance,requires_handover_contact,counts_toward_gratuity,created_by,updated_by)
          VALUES (${policyId},${organisationId},${`HIST2-${group.code}`},${`${label} (2026 calendar record)`},${type},
            'Company Policy','Historical HR calendar entry; not selectable for new requests.',${paid},
            'Not Tracked','Not Applicable',0,0,'[]',false,false,false,false,${paid},${reconciler},${reconciler})
          ON CONFLICT (id) DO NOTHING`;
        const [policy] = await tx`SELECT code,name,type,is_paid,is_enabled,consumes_balance
          FROM leave_policies WHERE organisation_id=${organisationId} AND id=${policyId}`;
        if (
          !policy ||
          policy.code !== `HIST2-${group.code}` ||
          policy.type !== type ||
          policy.is_paid !== paid ||
          policy.is_enabled ||
          policy.consumes_balance
        )
          throw new Error("Historical policy has changed; transaction rolled back");
        const requestId = stableId(
          `${organisationId}:${group.employeeId}:reconciled-history:${UPDATED_2026_SHA256}:${group.startDate}:${group.endDate}:${group.code}`,
        );
        const entitlementYear =
          group.code === "AL24" ? 2024 : group.code === "AL25" ? 2025 : group.year;
        const snapshot = {
          name: label,
          type,
          isPaid: paid,
          baseEntitlementDays: 0,
          accrualMode: "Not Applicable",
          workingDates: group.days.map((day) => day.date),
          spreadsheetImport: {
            version: RECONCILE_VERSION,
            sourceFile: UPDATED_2026_FILE,
            sourceSha256: UPDATED_2026_SHA256,
            asOf,
            entitlementYear,
            approvalSource:
              "HR-confirmed completed or ongoing leave calendar; original approver not supplied",
            days: group.days,
          },
        };
        const reason = type === "Remote" ? "Remote work" : label;
        await tx`INSERT INTO leave_requests
          (id,organisation_id,employee_id,policy_id,start_date,end_date,is_half_day,
           working_days_requested,reason,status,chain_approvals,policy_snapshot,created_by,updated_by)
          VALUES (${requestId},${organisationId},${group.employeeId},${policyId},
            ${group.startDate},${group.endDate},${group.code === "HFD"},
            ${group.days.reduce((sum, day) => sum + day.days, 0)},${reason},
            'Approved','[]',${tx.json(snapshot)},${reconciler},${reconciler})`;
        inserted.push({ requestId, employeeId: group.employeeId });
      }

      if (inserted.length) {
        // The status trigger writes in this uncommitted transaction. Delete exactly
        // those notices before workers can observe them. Any mismatch rolls back.
        const ids = inserted.map((row) => row.requestId);
        const expectedNotices = new Set(
          users.filter((u) => u.status === "Active" && !u.archived_at).map((u) => u.employee_id),
        );
        const expectedCount = inserted.filter((row) => expectedNotices.has(row.employeeId)).length;
        const deleted = await tx`DELETE FROM notifications WHERE organisation_id=${organisationId}
          AND created_by=${reconciler} AND type='workflow.request_update'
          AND link->>'entityId' IN ${tx(ids)} RETURNING id`;
        if (deleted.length !== expectedCount)
          throw new Error(
            "A historical owner notification was not removed; transaction rolled back",
          );
        const remaining =
          await tx`SELECT id FROM notifications WHERE organisation_id=${organisationId}
          AND link->>'entityId' IN ${tx(ids)} LIMIT 1`;
        if (remaining.length)
          throw new Error(
            "A historical notification remains; transaction rolled back before email delivery",
          );
      }
      if (plan.archiveIds.length || inserted.length) {
        await tx`INSERT INTO audit_events
          (organisation_id,actor_display_name,active_role,actor_roles,action,module,
           entity_type,entity_id,after_summary,reason,risk_level)
          VALUES (${organisationId},'2026 HR leave calendar reconciliation','System','{}','reconcile',
            'leave','leave-history-reconciliation',
            ${stableId(`${organisationId}:${UPDATED_2026_SHA256}:${asOf}`)},
            ${tx.json({
              oldSourceSha256: OLD_2026_SHA256,
              updatedSourceSha256: UPDATED_2026_SHA256,
              asOf,
              archivedRequestIds: plan.archiveIds,
              insertedRequestIds: inserted.map((r) => r.requestId),
              withheldFuture: plan.withheldFuture.length,
              sourceMaternityToRemote: 26,
              maternityPreserved: updated.maternityPreserved,
              balanceChanges: 0,
              balanceReconciliationRequired: true,
              staffEmails: 0,
            })},
            'Reconciled user-provided HR calendar; protected native approvals and balances.',
            'High')`;
      }
      console.log(
        `COMMITTED: ${plan.archiveIds.length} old source rows archived, ${inserted.length} clean historical requests created. No balance changes or staff emails.`,
      );
    });
  } finally {
    await db.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
