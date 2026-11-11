/**
 * Add only missing, already-past dates for ONE verified employee from the
 * updated HR calendar. Never archive/replace a request or adjust a balance.
 * Any overlapping, changed, or ambiguous date blocks that person's apply.
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
  getCodeDefinition,
  preserveSafaMaternity,
} from "./reconcile-leave-history-data.mjs";
import { planUpdatedPersonImport } from "./import-updated-leave-person-data.mjs";

const args = process.argv.slice(2);
const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const modes = ["--source-check", "--dry-run", "--apply"].filter((flag) => args.includes(flag));
const mode = modes[0] ?? "--dry-run";
const importer = stableId("via-2026-updated-person-calendar-importer");

async function parseVerifiedWorkbook(path, expectedName, expectedHash) {
  if (basename(path) !== expectedName) throw new Error(`Expected source file ${expectedName}`);
  const hash = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
  if (hash !== expectedHash) throw new Error(`Source hash mismatch for ${expectedName}`);
  const extracted = extractDays(await readWorkbook(path), {
    file: expectedName,
    sha256: hash,
  });
  const unexpectedIssues = extracted.issues.filter(
    (issue) =>
      !(issue.sheet === "Apr" && issue.name === "Mohamed Almaiman" && issue.rawCode === "R") &&
      !(
        expectedName === OLD_2026_FILE &&
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
  const sourceName = option("name")?.trim();
  const email = option("email")?.trim().toLowerCase();
  const asOf = option("as-of");
  const expectedNewDays = option("expected-new-days");
  const onlyDatesText = option("only-dates");
  const onlyDates = onlyDatesText?.split(",").map((value) => value.trim());
  if (
    modes.length > 1 ||
    !updatedPath ||
    !previousPath ||
    !sourceName ||
    !email ||
    !/^20\d\d-\d\d-\d\d$/.test(asOf ?? "")
  )
    throw new Error(
      "Usage: node scripts/import-updated-leave-person.mjs --updated=updated.xlsx --previous=old.xlsx --name='Exact HR name' --email=portal@company.com --as-of=2026-11-09 [--source-check|--dry-run|--apply]",
    );
  const [rawUpdated, previous] = await Promise.all([
    parseVerifiedWorkbook(updatedPath, UPDATED_2026_FILE, UPDATED_2026_SHA256),
    parseVerifiedWorkbook(previousPath, OLD_2026_FILE, OLD_2026_SHA256),
  ]);
  const extracted = preserveSafaMaternity(rawUpdated, previous);
  if (mode === "--source-check") {
    console.log(
      JSON.stringify(
        {
          mode,
          sourceName,
          asOf,
          sourceSha256: UPDATED_2026_SHA256,
          sourceDates: [
            ...extracted.days,
            ...extracted.excluded.filter((entry) => entry.code === "RM"),
          ]
            .filter(
              (entry) =>
                entry.name.trim().toLowerCase().replace(/\s+/g, " ") ===
                sourceName.toLowerCase().replace(/\s+/g, " "),
            )
            .map((entry) => ({ date: entry.date, code: entry.code })),
          databaseChecked: false,
        },
        null,
        2,
      ),
    );
    return;
  }

  const organisationId = process.env.VIA_HR_IMPORT_ORGANISATION_ID?.trim();
  if (!/^[0-9a-f-]{36}$/i.test(organisationId ?? ""))
    throw new Error("Set the exact VIA_HR_IMPORT_ORGANISATION_ID");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (mode === "--apply") {
    if (asOf !== "2026-11-09")
      throw new Error("Apply is limited to the verified 2026-11-09 HR calendar snapshot");
    if (process.env.VIA_HR_UPDATED_PERSON_CONFIRM_SHA256?.toLowerCase() !== UPDATED_2026_SHA256)
      throw new Error("Confirm the exact updated workbook SHA-256 before applying");
    if (!/^(0|[1-9]\d*)$/.test(expectedNewDays ?? ""))
      throw new Error("Apply requires --expected-new-days from the reviewed dry run");
  }
  if (
    onlyDates &&
    (!onlyDates.length || onlyDates.some((date) => !/^20\d\d-\d\d-\d\d$/.test(date)))
  )
    throw new Error("--only-dates must be a comma-separated list of YYYY-MM-DD dates");
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
      const org = await tx`SELECT id FROM organisations
        WHERE id=${organisationId} AND is_active=true`;
      if (org.length !== 1) throw new Error("The selected organisation is not active");
      const employees = await tx`SELECT id,legal_name,status,archived_at,start_date::text,
        termination_date::text FROM employees WHERE organisation_id=${organisationId}`;
      const users = await tx`SELECT employee_id,workspace_email,status,archived_at FROM users
        WHERE organisation_id=${organisationId} AND employee_id IS NOT NULL`;
      const existing = await tx`SELECT id,employee_id,start_date::text,end_date::text,is_half_day,
        status,policy_snapshot,archived_at FROM leave_requests WHERE organisation_id=${organisationId}`;
      const attendance = await tx`SELECT a.date::text,a.clock_in_at,a.clock_out_at,a.archived_at
        FROM attendance_records a JOIN users u ON u.employee_id=a.employee_id
          AND u.organisation_id=a.organisation_id
        WHERE a.organisation_id=${organisationId} AND lower(u.workspace_email)=${email}
          AND u.status='Active' AND u.archived_at IS NULL`;
      const timesheets = await tx`SELECT t.status,t.archived_at,p.start_date::text,p.end_date::text,
        p.status AS period_status FROM timesheet_periods p
        LEFT JOIN timesheets t ON t.period_id=p.id AND t.archived_at IS NULL AND t.employee_id=(
          SELECT employee_id FROM users WHERE organisation_id=${organisationId}
            AND lower(workspace_email)=${email} AND status='Active' AND archived_at IS NULL
          LIMIT 1)
        WHERE p.organisation_id=${organisationId} AND p.archived_at IS NULL`;
      const plan = planUpdatedPersonImport({
        extracted,
        sourceName,
        email,
        employees,
        users,
        matching,
        existing,
        attendance,
        timesheets,
        asOf,
        onlyDates: onlyDates ?? null,
      });
      console.log(
        JSON.stringify(
          {
            mode,
            sourceName,
            employeeId: plan.employeeId,
            employeeName: plan.employeeName,
            asOf,
            sourceSha256: UPDATED_2026_SHA256,
            sourceDays: plan.sourceDays,
            newDates: plan.inserts.flatMap((group) =>
              group.days.map((day) => ({ date: day.date, code: day.code })),
            ),
            newRequests: plan.inserts.length,
            alreadyRecorded: plan.alreadyRecorded,
            withheldFuture: plan.withheldFuture,
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
      if (!plan.canApply) throw new Error("Conflicting dates require HR review; nothing imported");
      const actualNewDays = plan.inserts.reduce((count, group) => count + group.days.length, 0);
      if (actualNewDays !== Number(expectedNewDays))
        throw new Error("New date count changed since dry run; nothing imported");
      if (!plan.inserts.length) return;

      const inserted = [];
      for (const group of plan.inserts) {
        const [label, type] = getCodeDefinition(group.code);
        const paid = group.code !== "UPL";
        const policyId = stableId(`${organisationId}:supplemental-history-policy:${group.code}`);
        await tx`INSERT INTO leave_policies
          (id,organisation_id,code,name,type,category,description,is_paid,scope,accrual_mode,
           base_entitlement_days,carry_forward_limit,approval_chain,is_enabled,is_statutory,
           consumes_balance,requires_handover_contact,counts_toward_gratuity,created_by,updated_by)
          VALUES (${policyId},${organisationId},${`HIST3-${group.code}`},${`${label} (HR calendar record)`},${type},
            'Company Policy','Previously approved HR calendar entry; not selectable for new requests.',${paid},
            'Not Tracked','Not Applicable',0,0,'[]',false,false,false,false,${paid},${importer},${importer})
          ON CONFLICT (id) DO NOTHING`;
        const [policy] =
          await tx`SELECT code,type,is_paid,is_enabled,consumes_balance FROM leave_policies
          WHERE organisation_id=${organisationId} AND id=${policyId}`;
        if (
          !policy ||
          policy.code !== `HIST3-${group.code}` ||
          policy.type !== type ||
          policy.is_paid !== paid ||
          policy.is_enabled ||
          policy.consumes_balance
        )
          throw new Error("Historical policy changed; transaction rolled back");
        const requestId = stableId(
          `${organisationId}:${group.employeeId}:supplemental-history:${UPDATED_2026_SHA256}:${group.startDate}:${group.endDate}:${group.code}`,
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
            version: 3,
            sourceFile: UPDATED_2026_FILE,
            sourceSha256: UPDATED_2026_SHA256,
            asOf,
            entitlementYear,
            approvalSource:
              "HR-confirmed completed or ongoing calendar; original approver not supplied",
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
            'Taken','[]',${tx.json(snapshot)},${importer},${importer})`;
        inserted.push(requestId);
      }
      // The trigger's owner notices are removed before commit; the mail worker
      // can never observe these historical imports as new employee requests.
      const deleted = await tx`DELETE FROM notifications WHERE organisation_id=${organisationId}
        AND created_by=${importer} AND type='workflow.request_update'
        AND link->>'entityId' IN ${tx(inserted)} RETURNING id`;
      if (deleted.length !== inserted.length)
        throw new Error("Historical owner notices were not fully removed; transaction rolled back");
      const remaining =
        await tx`SELECT id FROM notifications WHERE organisation_id=${organisationId}
        AND link->>'entityId' IN ${tx(inserted)} LIMIT 1`;
      if (remaining.length)
        throw new Error("A historical notification remains; transaction rolled back");
      await tx`INSERT INTO audit_events
        (organisation_id,actor_display_name,active_role,actor_roles,action,module,
         entity_type,entity_id,after_summary,reason,risk_level)
        VALUES (${organisationId},'Verified HR calendar import','System','{}','import','leave',
          'updated-person-calendar-import',
          ${stableId(`${organisationId}:${plan.employeeId}:${UPDATED_2026_SHA256}`)},
          ${tx.json({
            employeeId: plan.employeeId,
            requestIds: inserted,
            sourceFile: UPDATED_2026_FILE,
            sourceSha256: UPDATED_2026_SHA256,
            asOf,
            balancesChanged: false,
            staffEmails: 0,
          })},
          'Added verified missing HR calendar dates for one employee; existing requests preserved.',
          'Medium')`;
      console.log(`COMMITTED ${inserted.length} historical requests for ${plan.employeeName}.`);
    });
  } finally {
    await db.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
