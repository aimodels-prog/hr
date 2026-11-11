/**
 * Reclassify ONLY the untouched, worker-completed Surabhi HFD/R imports whose
 * dates are RM in the exact updated HR workbook. This never changes a balance,
 * manually reviewed request, another employee, or an out-of-service date.
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
} from "./reconcile-leave-history-data.mjs";
import {
  SURABHI_SOURCE_NAME,
  changedSurabhiDates,
  planSurabhiRemoteReclassification,
} from "./reclassify-surabhi-remote-data.mjs";

const args = process.argv.slice(2);
const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const modes = ["--source-check", "--dry-run", "--apply"].filter((flag) => args.includes(flag));
const mode = modes[0] ?? "--dry-run";
const asOf = "2026-11-09";
const actorId = stableId("via-2026-surabhi-remote-reclassifier");

async function verifiedWorkbook(path, expectedFile, expectedSha) {
  if (basename(path) !== expectedFile) throw new Error(`Expected exact source ${expectedFile}`);
  const digest = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
  if (digest !== expectedSha) throw new Error(`Source hash mismatch for ${expectedFile}`);
  const result = extractDays(await readWorkbook(path), { file: expectedFile, sha256: digest });
  const unrelatedIssues = result.issues.filter(
    (issue) =>
      !(issue.sheet === "Apr" && issue.name === "Mohamed Almaiman" && issue.rawCode === "R") &&
      !(
        expectedFile === OLD_2026_FILE &&
        issue.sheet === "Feb" &&
        issue.name === "Safa Al Balushi" &&
        issue.rawCode === "MAT" &&
        [32, 33, 34].includes(issue.column)
      ),
  );
  if (unrelatedIssues.length)
    throw new Error(`Unexpected spreadsheet cells: ${JSON.stringify(unrelatedIssues)}`);
  return result;
}

async function main() {
  const previousPath = option("previous");
  const updatedPath = option("updated");
  const email = option("email")?.trim().toLowerCase();
  const expectedCount = Number(option("expected-count"));
  if (modes.length > 1 || !previousPath || !updatedPath || !email)
    throw new Error(
      "Usage: node scripts/reclassify-surabhi-remote.mjs --previous=old.xlsx --updated=new.xlsx --email=verified@company.com [--source-check|--dry-run|--apply --expected-count=169]",
    );
  const [previous, updated] = await Promise.all([
    verifiedWorkbook(previousPath, OLD_2026_FILE, OLD_2026_SHA256),
    verifiedWorkbook(updatedPath, UPDATED_2026_FILE, UPDATED_2026_SHA256),
  ]);
  const sourcePairs = changedSurabhiDates(previous, updated);
  if (mode === "--source-check") {
    console.log(
      JSON.stringify({
        mode,
        sourceName: SURABHI_SOURCE_NAME,
        oldSha256: OLD_2026_SHA256,
        updatedSha256: UPDATED_2026_SHA256,
        changedHfdToRmDates: sourcePairs.length,
        firstDate: sourcePairs[0]?.date,
        lastDate: sourcePairs.at(-1)?.date,
        databaseChecked: false,
      }),
    );
    return;
  }
  const organisationId = process.env.VIA_HR_IMPORT_ORGANISATION_ID?.trim();
  if (!/^[0-9a-f-]{36}$/i.test(organisationId ?? ""))
    throw new Error("Set exact VIA_HR_IMPORT_ORGANISATION_ID");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (mode === "--apply") {
    if (!Number.isSafeInteger(expectedCount) || expectedCount < 1)
      throw new Error("Apply needs a positive --expected-count from the reviewed dry-run");
    if (process.env.VIA_HR_REMOTE_RECLASSIFY_CONFIRM_SHA256?.toLowerCase() !== UPDATED_2026_SHA256)
      throw new Error("Apply needs the exact updated source SHA-256 confirmation");
  }

  const db = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
  try {
    await db.begin(async (tx) => {
      if (mode === "--dry-run") await tx`SET TRANSACTION READ ONLY`;
      else {
        await tx`SELECT pg_advisory_xact_lock(hashtext('via-approved-leave-history'))`;
        await tx`LOCK TABLE leave_requests IN SHARE ROW EXCLUSIVE MODE`;
      }
      const org = await tx`SELECT id FROM organisations
        WHERE id=${organisationId} AND is_active=true`;
      if (org.length !== 1) throw new Error("The selected organisation is not active");
      const people = await tx`SELECT e.id,e.legal_name,e.status,e.archived_at,
          e.start_date::text,e.termination_date::text,
          u.employee_id,u.workspace_email,u.status AS user_status,u.archived_at AS user_archived_at
        FROM users u JOIN employees e ON e.id=u.employee_id AND e.organisation_id=u.organisation_id
        WHERE u.organisation_id=${organisationId} AND lower(u.workspace_email)=${email}`;
      if (people.length !== 1) throw new Error("Exactly one employee must match the Portal email");
      const person = people[0];
      const employee = {
        id: person.id,
        legal_name: person.legal_name,
        status: person.status,
        archived_at: person.archived_at,
        start_date: person.start_date,
        termination_date: person.termination_date,
      };
      const user = {
        employee_id: person.employee_id,
        workspace_email: person.workspace_email,
        status: person.user_status,
        archived_at: person.user_archived_at,
      };
      const [oldPolicy] = await tx`SELECT id,code,type,is_paid,is_enabled,consumes_balance
        FROM leave_policies WHERE organisation_id=${organisationId} AND code='HIST-HFD'
          AND archived_at IS NULL`;
      const [balance] = oldPolicy
        ? await tx`SELECT id FROM leave_balances WHERE organisation_id=${organisationId}
            AND policy_id=${oldPolicy.id} LIMIT 1`
        : [];
      const [ledger] = oldPolicy
        ? await tx`SELECT id FROM leave_transactions WHERE organisation_id=${organisationId}
            AND policy_id=${oldPolicy.id} LIMIT 1`
        : [];
      const existing = await tx`SELECT id,employee_id,policy_id,start_date::text,end_date::text,
          is_half_day,working_days_requested,status,record_version,created_by,updated_by,
          chain_approvals,policy_snapshot,archived_at
        FROM leave_requests WHERE organisation_id=${organisationId} AND employee_id=${employee.id}`;
      const markTakenEvents = await tx`SELECT actor_user_id,action,module,after_summary
        FROM audit_events WHERE organisation_id=${organisationId} AND action='mark-taken'
          AND module='leave' AND after_summary->'requestIds' IS NOT NULL`;
      const ledgerRows = await tx`SELECT reference_id FROM leave_transactions
        WHERE organisation_id=${organisationId} AND reference_id IS NOT NULL`;
      const attendance = await tx`SELECT date::text,clock_in_at,clock_out_at,archived_at
        FROM attendance_records WHERE organisation_id=${organisationId}
          AND employee_id=${employee.id}`;
      const plan = planSurabhiRemoteReclassification({
        previous,
        updated,
        organisationId,
        employee,
        user,
        email,
        existing,
        oldPolicy,
        oldPolicyHasBalance: Boolean(balance),
        oldPolicyHasLedger: Boolean(ledger),
        markTakenEvents,
        ledgerReferenceIds: new Set(ledgerRows.map((row) => row.reference_id)),
        attendance,
        asOf,
      });
      console.log(
        JSON.stringify(
          {
            mode,
            sourceName: SURABHI_SOURCE_NAME,
            employeeId: plan.employeeId,
            sourcePairs: plan.sourcePairs,
            replacements: plan.replace.length,
            replacementGroups: plan.replacementGroups.length,
            uncovered: plan.uncovered.length,
            alreadyRemote: plan.alreadyRemote.length,
            withheldOutsideService: plan.withheldOutsideService.length,
            conflicts: plan.conflicts,
            canApply: plan.canApply,
            balancesChanged: false,
            staffEmails: 0,
          },
          null,
          2,
        ),
      );
      if (mode === "--dry-run") return;
      if (!plan.canApply || plan.replace.length !== expectedCount)
        throw new Error("Dry-run count or safety conditions changed; no correction committed");

      const oldIds = plan.replace.map((day) => day.oldRequestId);
      const archived = await tx`UPDATE leave_requests
        SET archived_at=now(),updated_by=${actorId},record_version=record_version+1
        WHERE organisation_id=${organisationId} AND employee_id=${employee.id}
          AND id IN ${tx(oldIds)} AND archived_at IS NULL AND status='Taken'
          AND record_version=2 RETURNING id`;
      if (archived.length !== oldIds.length)
        throw new Error("One old request changed during correction; transaction rolled back");

      const policyId = stableId(`${organisationId}:surabhi-remote-reclassification-policy`);
      await tx`INSERT INTO leave_policies
        (id,organisation_id,code,name,type,category,description,is_paid,scope,accrual_mode,
         base_entitlement_days,carry_forward_limit,approval_chain,is_enabled,is_statutory,
         consumes_balance,requires_handover_contact,counts_toward_gratuity,created_by,updated_by)
        VALUES (${policyId},${organisationId},'HIST4-RM','Remote Work (HR calendar correction)',
          'Remote','Company Policy','Corrected HR calendar history; unavailable for new requests.',
          true,'Not Tracked','Not Applicable',0,0,'[]',false,false,false,false,true,
          ${actorId},${actorId}) ON CONFLICT (id) DO NOTHING`;
      const [policy] = await tx`SELECT code,type,is_paid,is_enabled,consumes_balance
        FROM leave_policies WHERE organisation_id=${organisationId} AND id=${policyId}`;
      if (
        !policy ||
        policy.code !== "HIST4-RM" ||
        policy.type !== "Remote" ||
        !policy.is_paid ||
        policy.is_enabled ||
        policy.consumes_balance
      )
        throw new Error("Historical remote policy differs; transaction rolled back");

      const inserted = [];
      for (const group of plan.replacementGroups) {
        const requestId = stableId(
          `${organisationId}:${employee.id}:surabhi-remote-reclassification:${UPDATED_2026_SHA256}:${group.startDate}:${group.endDate}`,
        );
        const snapshot = {
          name: "Remote Work",
          type: "Remote",
          isPaid: true,
          baseEntitlementDays: 0,
          accrualMode: "Not Applicable",
          workingDates: group.days.map((day) => day.date),
          spreadsheetImport: {
            version: 4,
            sourceFile: UPDATED_2026_FILE,
            sourceSha256: UPDATED_2026_SHA256,
            previousSourceFile: OLD_2026_FILE,
            previousSourceSha256: OLD_2026_SHA256,
            asOf,
            correctedFromRequestIds: group.days.map((day) => day.oldRequestId),
            days: group.days,
          },
        };
        await tx`INSERT INTO leave_requests
          (id,organisation_id,employee_id,policy_id,start_date,end_date,is_half_day,
           working_days_requested,reason,status,chain_approvals,policy_snapshot,created_by,updated_by)
          VALUES (${requestId},${organisationId},${employee.id},${policyId},
            ${group.startDate},${group.endDate},false,${group.days.length},'Remote work',
            'Taken','[]',${tx.json(snapshot)},${actorId},${actorId})`;
        inserted.push(requestId);
      }
      const removed = await tx`DELETE FROM notifications WHERE organisation_id=${organisationId}
        AND created_by=${actorId} AND type='workflow.request_update'
        AND link->>'entityId' IN ${tx(inserted)} RETURNING id`;
      if (removed.length !== inserted.length)
        throw new Error(
          "Imported owner notifications were not fully removed; transaction rolled back",
        );
      const remaining =
        await tx`SELECT id FROM notifications WHERE organisation_id=${organisationId}
        AND link->>'entityId' IN ${tx(inserted)} LIMIT 1`;
      if (remaining.length)
        throw new Error("A correction notification remains; transaction rolled back");
      await tx`INSERT INTO audit_events
        (organisation_id,actor_display_name,active_role,actor_roles,action,module,entity_type,
         entity_id,after_summary,reason,risk_level)
        VALUES (${organisationId},'Verified HR remote-work correction','System','{}',
          'reclassify','leave','surabhi-remote-work-correction',
          ${stableId(`${organisationId}:${employee.id}:${UPDATED_2026_SHA256}:surabhi-remote`)},
          ${tx.json({
            employeeId: employee.id,
            previousRequestIds: oldIds,
            replacementRequestIds: inserted,
            datesChanged: plan.replace.length,
            oldSourceSha256: OLD_2026_SHA256,
            updatedSourceSha256: UPDATED_2026_SHA256,
            balancesChanged: false,
            staffEmails: 0,
          })},
          'HR confirmed updated spreadsheet RM dates supersede old imported HFD/R dates.',
          'High')`;
      console.log(
        `COMMITTED ${plan.replace.length} verified date corrections for ${SURABHI_SOURCE_NAME}.`,
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
