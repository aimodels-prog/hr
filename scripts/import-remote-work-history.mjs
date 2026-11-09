import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import readWorkbook from "read-excel-file/node";
import postgres from "postgres";

import { extractDays, normaliseName, stableId } from "./leave-history-data.mjs";
import { groupRemoteMarkers, verifiedRemoteMarkers } from "./remote-work-history-data.mjs";

const options = process.argv.slice(2);
const option = (name) =>
  options.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const selectedModes = ["--source-check", "--dry-run", "--apply"].filter((mode) =>
  options.includes(mode),
);
const mode = selectedModes[0] ?? "--dry-run";
const effectiveStatuses = new Set(["Approved", "Taken"]);

async function main() {
  const payloadPath = option("payload");
  const workbookPath = option("workbook");
  const sourceName = option("name")?.trim();
  const email = option("email")?.trim().toLowerCase();
  if (selectedModes.length > 1 || !payloadPath || !workbookPath || !sourceName)
    throw new Error(
      "Usage: node scripts/import-remote-work-history.mjs --payload=prepared.json --workbook=source.xlsx --name='Spreadsheet Name' [--email=portal@company.com] [--source-check|--dry-run|--apply]",
    );
  if (mode !== "--source-check" && !email)
    throw new Error(
      "An exact active VIA Portal email is required for the database dry-run or apply.",
    );

  const sourceFile = basename(workbookPath);
  const sourceSha256 = createHash("sha256")
    .update(await readFile(workbookPath))
    .digest("hex");
  const payload = JSON.parse(await readFile(payloadPath, "utf8"));
  if (payload.version !== 1 || !Array.isArray(payload.workbooks))
    throw new Error("Invalid prepared leave workbook payload");
  const preparedWorkbook = payload.workbooks.find((item) => item.file === sourceFile);
  if (!preparedWorkbook) throw new Error("The source workbook is not in the prepared payload");
  const extractedWorkbook = extractDays(await readWorkbook(workbookPath), {
    file: sourceFile,
    sha256: sourceSha256,
  });
  const verifiedDays = verifiedRemoteMarkers(
    preparedWorkbook,
    extractedWorkbook,
    sourceFile,
    sourceSha256,
  );
  const selectedDays = verifiedDays.filter(
    (day) => normaliseName(day.name) === normaliseName(sourceName),
  );
  if (!selectedDays.length) throw new Error("No RM remote-work dates match that exact source name");
  if (new Set(selectedDays.map((day) => day.date)).size !== selectedDays.length)
    throw new Error("The workbook has duplicate remote-work dates for this employee");

  const sourceSummary = {
    mode,
    sourceFile,
    sourceSha256,
    sourceName,
    remoteDates: selectedDays.map((day) => day.date),
    remotePeriods: groupRemoteMarkers(selectedDays, "source-only").map((group) => ({
      startDate: group.startDate,
      endDate: group.endDate,
      days: group.days.length,
    })),
  };
  if (mode === "--source-check") {
    console.log(JSON.stringify({ ...sourceSummary, databaseMappingChecked: false }, null, 2));
    return;
  }

  const organisationId = process.env.VIA_HR_IMPORT_ORGANISATION_ID?.trim();
  if (!organisationId || !/^[0-9a-f-]{36}$/i.test(organisationId))
    throw new Error("Set the exact VIA_HR_IMPORT_ORGANISATION_ID before database access");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (
    mode === "--apply" &&
    process.env.VIA_HR_REMOTE_HISTORY_CONFIRM_SHA256?.toLowerCase() !== sourceSha256
  )
    throw new Error("Confirm the exact source SHA-256 before applying remote-work history");

  const matchingPath =
    process.env.VIA_HR_LEAVE_HISTORY_MATCHING_FILE ??
    new URL("./leave-history-matching.local.json", import.meta.url);
  const matching = JSON.parse(await readFile(matchingPath, "utf8"));
  const sourceKey = normaliseName(sourceName);
  const former = new Set((matching.formerEmployees ?? []).map(normaliseName));
  if (former.has(sourceKey)) throw new Error("The source name is marked as a former employee");
  const aliases = new Map(
    Object.entries(matching.aliases ?? {}).map(([name, target]) => [
      normaliseName(name),
      normaliseName(target),
    ]),
  );
  const mappedName = aliases.get(sourceKey) ?? sourceKey;
  const expectedEmail = Object.entries(matching.expectedWorkspaceEmails ?? {}).find(
    ([name]) => normaliseName(name) === sourceKey,
  )?.[1];
  if (expectedEmail && expectedEmail.trim().toLowerCase() !== email)
    throw new Error("The supplied Portal email does not match the protected name mapping");

  const db = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
  try {
    await db.begin(async (tx) => {
      if (mode === "--dry-run") await tx`SET TRANSACTION READ ONLY`;
      else {
        await tx`SELECT pg_advisory_xact_lock(hashtext('via-remote-work-history'))`;
        await tx`LOCK TABLE leave_requests IN SHARE ROW EXCLUSIVE MODE`;
      }
      const [organisation] =
        await tx`SELECT id FROM organisations WHERE id=${organisationId} AND is_active=true`;
      if (!organisation) throw new Error("The chosen organisation is not active");
      const people = await tx`
        SELECT e.id,e.legal_name,e.status,e.start_date::text,e.termination_date::text,u.id AS user_id
        FROM users u JOIN employees e ON e.id=u.employee_id AND e.organisation_id=u.organisation_id
        WHERE u.organisation_id=${organisationId} AND lower(u.workspace_email)=${email}
          AND u.status='Active' AND u.archived_at IS NULL
          AND e.status='Active' AND e.archived_at IS NULL`;
      if (people.length !== 1)
        throw new Error("Exactly one active Portal user and employee must match the email");
      const employee = people[0];
      if (normaliseName(employee.legal_name) !== mappedName)
        throw new Error("The source name does not match this employee's verified name mapping");
      const policies = await tx`
        SELECT id,name,type,is_paid,consumes_balance
        FROM leave_policies
        WHERE organisation_id=${organisationId} AND code='RM' AND is_enabled=true AND archived_at IS NULL`;
      if (
        policies.length !== 1 ||
        policies[0].type !== "Remote" ||
        !policies[0].is_paid ||
        policies[0].consumes_balance
      )
        throw new Error("Exactly one active, paid, non-balance Remote Work Day policy is required");
      const policy = policies[0];
      const existing = await tx`
        SELECT id,start_date::text,end_date::text,status,policy_snapshot
        FROM leave_requests
        WHERE organisation_id=${organisationId} AND employee_id=${employee.id}
          AND archived_at IS NULL`;
      const alreadyRecorded = [];
      const conflicts = [];
      const newDays = [];
      for (const day of selectedDays) {
        if (
          day.date < employee.start_date ||
          (employee.termination_date && day.date > employee.termination_date)
        ) {
          conflicts.push({ date: day.date, reason: "Outside the employee's service dates" });
          continue;
        }
        const overlaps = existing.filter(
          (request) => request.start_date <= day.date && request.end_date >= day.date,
        );
        if (!overlaps.length) {
          newDays.push(day);
          continue;
        }
        if (
          overlaps.length === 1 &&
          overlaps[0].policy_snapshot?.type === "Remote" &&
          effectiveStatuses.has(overlaps[0].status)
        ) {
          alreadyRecorded.push(day.date);
          continue;
        }
        conflicts.push({
          date: day.date,
          reason: "Overlaps an existing leave or remote-work request",
          requests: overlaps.map((request) => ({ id: request.id, status: request.status })),
        });
      }
      const groups = groupRemoteMarkers(newDays, employee.id);
      const summary = {
        ...sourceSummary,
        databaseMappingChecked: true,
        employeeId: employee.id,
        employeeLegalName: employee.legal_name,
        policyName: policy.name,
        alreadyRecorded,
        newDates: newDays.map((day) => day.date),
        newRequests: groups.length,
        conflicts,
        balanceChanges: 0,
        staffEmails: 0,
      };
      console.log(JSON.stringify(summary, null, 2));
      if (mode === "--dry-run") return;
      if (conflicts.length)
        throw new Error("Conflicting dates require manual review; nothing was imported");

      const importer = stableId("via-approved-remote-work-history-importer");
      const inserted = [];
      for (const group of groups) {
        const id = stableId(
          `${organisationId}:${employee.id}:remote-work-history:${group.startDate}:${group.endDate}`,
        );
        const snapshot = {
          name: policy.name,
          type: "Remote",
          isPaid: true,
          baseEntitlementDays: 0,
          accrualMode: "Not Applicable",
          workingDates: group.days.map((day) => day.date),
          remoteWorkHistory: {
            version: 1,
            sourceFile,
            sourceSha256,
            sourceName,
          },
        };
        await tx`INSERT INTO leave_requests
          (id,organisation_id,employee_id,policy_id,start_date,end_date,is_half_day,working_days_requested,reason,status,chain_approvals,policy_snapshot,created_by,updated_by)
          VALUES (${id},${organisationId},${employee.id},${policy.id},${group.startDate},${group.endDate},false,${group.days.length},'Remote work','Approved','[]',${tx.json(snapshot)},${importer},${importer})`;
        inserted.push(id);
      }
      if (inserted.length) {
        // The owner-notification trigger runs in this transaction. Remove only its notices
        // for the newly inserted history before any mail worker can observe them.
        const removedOwnerNotices =
          await tx`DELETE FROM notifications WHERE organisation_id=${organisationId}
          AND created_by=${importer} AND type='workflow.request_update'
          AND link->>'entityId' IN ${tx(inserted)} RETURNING id`;
        if (removedOwnerNotices.length !== inserted.length)
          throw new Error("A historical owner notice was not removed; import rolled back");
        await tx`INSERT INTO audit_events
          (organisation_id,actor_display_name,active_role,actor_roles,action,module,entity_type,entity_id,after_summary,reason,risk_level)
          VALUES (${organisationId},'Authorised remote-work history import','System','{}','import','leave','remote-work-history-import',${stableId(`${organisationId}:${employee.id}:${sourceSha256}:${inserted.join(":")}`)},${tx.json({ employeeId: employee.id, requestIds: inserted, sourceFile, sourceSha256, balanceChanges: 0 })},'User-confirmed remote-work history from HR workbook; no new approval or balance adjustment.','Medium')`;
      }
      console.log(
        `COMMITTED ${inserted.length} remote-work requests. No balance changes or staff emails.`,
      );
    });
  } finally {
    await db.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Remote-work history could not be checked",
  );
  process.exitCode = 1;
});
