import postgres from "postgres";
import { readFile } from "node:fs/promises";
import { codes, normaliseName, groupDays, stableId } from "./leave-history-data.mjs";

const [file, mode = "--dry-run"] = process.argv.slice(2);
if (!file || !["--dry-run", "--apply"].includes(mode))
  throw new Error("Usage: payload.json [--dry-run|--apply]");
const payload = JSON.parse(await readFile(file, "utf8"));
if (payload.version !== 1) throw new Error("Invalid import version");
// Personal matching decisions belong in a protected local file, never in source control.
const matchingFile =
  process.env.VIA_HR_LEAVE_HISTORY_MATCHING_FILE ??
  new URL("./leave-history-matching.local.json", import.meta.url);
const matching = await readFile(matchingFile, "utf8")
  .then(JSON.parse)
  .catch((error) => {
    if (error.code === "ENOENT" && !process.env.VIA_HR_LEAVE_HISTORY_MATCHING_FILE) return {};
    throw error;
  });
const aliases = new Map(
  Object.entries(matching.aliases ?? {}).map(([source, target]) => [
    normaliseName(source),
    normaliseName(target),
  ]),
);
const former = new Set((matching.formerEmployees ?? []).map(normaliseName));
const db = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
try {
  await db.begin(async (tx) => {
    if (mode === "--dry-run") await tx`SET TRANSACTION READ ONLY`;
    else {
      await tx`SELECT pg_advisory_xact_lock(hashtext('via-approved-leave-history'))`;
      await tx`LOCK TABLE leave_requests IN SHARE ROW EXCLUSIVE MODE`;
    }
    const organisations = process.env.VIA_HR_IMPORT_ORGANISATION_ID
      ? await tx`SELECT id FROM organisations WHERE is_active=true AND id=${process.env.VIA_HR_IMPORT_ORGANISATION_ID}`
      : await tx`SELECT id FROM organisations WHERE is_active=true`;
    if (organisations.length !== 1) throw new Error("Exactly one active organisation is required");
    const org = organisations[0].id;
    const staff =
      await tx`SELECT id,legal_name,status FROM employees WHERE organisation_id=${org} AND archived_at IS NULL`;
    const names = new Map();
    for (const e of staff) {
      const key = normaliseName(e.legal_name);
      if (names.has(key)) throw new Error(`Ambiguous employee: ${key}`);
      names.set(key, e);
    }
    const matches = new Map(),
      unmatched = new Set(),
      formerNames = new Set();
    for (const sourceName of payload.workbooks.flatMap((w) => w.names)) {
      const key = normaliseName(sourceName);
      if (former.has(key)) {
        formerNames.add(sourceName);
        continue;
      }
      const employee = names.get(aliases.get(key) ?? key);
      if (!employee || ["Inactive", "Archived"].includes(employee.status)) {
        unmatched.add(sourceName);
        continue;
      }
      matches.set(key, employee);
    }
    for (const [source, email] of Object.entries(matching.expectedWorkspaceEmails ?? {})) {
      const employee = matches.get(normaliseName(source));
      if (!employee) continue;
      const account =
        await tx`SELECT u.id FROM users u WHERE u.organisation_id=${org} AND u.employee_id=${employee.id} AND lower(u.workspace_email)=${email.trim().toLowerCase()} AND u.status='Active' AND u.archived_at IS NULL`;
      if (!account.length)
        throw new Error("Employee mapping must refer to its confirmed workspace account");
    }
    const existing =
      await tx`SELECT id,employee_id,start_date::text,end_date::text,status,policy_snapshot FROM leave_requests WHERE organisation_id=${org} AND archived_at IS NULL`;
    const covered = new Map();
    const regular = [];
    for (const request of existing) {
      const history = request.policy_snapshot?.spreadsheetImport;
      if (history?.version === 1)
        for (const day of history.days)
          covered.set(`${request.employee_id}:${day.date}`, { ...day, status: request.status });
      else if (
        !["Cancelled", "Cancellation Approved", "Declined", "Automatically Refused"].includes(
          request.status,
        )
      )
        regular.push(request);
    }
    let skipped = 0;
    const pending = new Map();
    for (const day of payload.workbooks.flatMap((w) => w.days)) {
      const employee = matches.get(normaliseName(day.name));
      if (!employee) continue;
      if (!codes[day.code] || ![0.5, 1].includes(day.days) || !/^20\d\d-\d\d-\d\d$/.test(day.date))
        throw new Error("Invalid leave day");
      const key = `${employee.id}:${day.date}`;
      const prior = covered.get(key) ?? pending.get(key);
      if (prior) {
        if (
          prior.code !== day.code ||
          prior.days !== day.days ||
          (prior.status && !["Approved", "Taken"].includes(prior.status))
        )
          throw new Error(
            `Changed previously imported leave requires review: ${day.name} ${day.date}`,
          );
        skipped++;
        continue;
      }
      if (
        regular.some(
          (r) =>
            r.employee_id === employee.id && r.start_date <= day.date && r.end_date >= day.date,
        )
      )
        throw new Error(
          `Existing app request overlaps ${day.name} ${day.date}; review before importing`,
        );
      pending.set(key, { ...day, employeeId: employee.id });
    }
    const groups = groupDays([...pending.values()]);
    const summary = {
      mode,
      matchedAccounts: new Set([...matches.values()].map((e) => e.id)).size,
      matches: [
        ...new Map(
          [...matches.entries()].map(([source, e]) => [source, { source, app: e.legal_name }]),
        ).values(),
      ],
      unmatched: [...unmatched].sort(),
      former: [...formerNames].sort(),
      newRequests: groups.length,
      newDays: [...pending.values()].reduce((sum, d) => sum + d.days, 0),
      alreadyImportedDays: skipped,
      issues: payload.workbooks.flatMap((w) => w.issues),
      balancesChanged: false,
    };
    console.log(JSON.stringify(summary, null, 2));
    if (mode === "--dry-run") return;
    const importer = stableId("via-approved-leave-history-importer");
    const inserted = [];
    for (const group of groups) {
      const [label, type] = codes[group.code];
      const policyId = stableId(`${org}:history-policy:${group.code}`);
      const paid = group.code !== "UPL";
      await tx`INSERT INTO leave_policies (id,organisation_id,code,name,type,category,description,is_paid,scope,accrual_mode,base_entitlement_days,carry_forward_limit,approval_chain,is_enabled,is_statutory,consumes_balance,requires_handover_contact,counts_toward_gratuity,created_by,updated_by)
        VALUES (${policyId},${org},${"HIST-" + group.code},${label + " — imported history"},${type},'Company Policy','Previously approved spreadsheet history. Balance reconciliation pending; unavailable for new requests.',${paid},'Not Tracked','Not Applicable',0,0,'[]',false,false,false,false,${paid},${importer},${importer}) ON CONFLICT (id) DO NOTHING`;
      const id = stableId(
        `${org}:${group.employeeId}:approved-history:${group.startDate}:${group.code}`,
      );
      const snapshot = {
        name: label + " — imported history",
        type,
        isPaid: paid,
        baseEntitlementDays: 0,
        accrualMode: "Not Applicable",
        workingDates: group.days.map((d) => d.date),
        spreadsheetImport: {
          version: 1,
          approvalSource:
            "User-confirmed previously approved HR spreadsheet; original approver not recorded",
          balanceStatus: "Pending reconciliation; no balance transactions created",
          entitlementYear: group.code === "AL24" ? 2024 : group.code === "AL25" ? 2025 : group.year,
          days: group.days,
        },
      };
      const reason = `Previously approved spreadsheet record (${group.code}). Original approval date/approver not supplied. Balance reconciliation pending.`;
      await tx`INSERT INTO leave_requests (id,organisation_id,employee_id,policy_id,start_date,end_date,is_half_day,working_days_requested,reason,status,chain_approvals,policy_snapshot,created_by,updated_by)
        VALUES (${id},${org},${group.employeeId},${policyId},${group.startDate},${group.endDate},${group.code === "HFD"},${group.days.reduce((sum, d) => sum + d.days, 0)},${reason},'Approved','[]',${tx.json(snapshot)},${importer},${importer})`;
      inserted.push(id);
    }
    if (inserted.length) {
      // Remove only notices produced by this transaction's new historical records, before commit.
      // Workers cannot observe or email these uncommitted notices. Existing notifications are untouched.
      await tx`DELETE FROM notifications WHERE organisation_id=${org} AND type='workflow.request_update' AND link->>'entityId' IN ${tx(inserted)} AND created_by=${importer}`;
      await tx`INSERT INTO audit_events (organisation_id,actor_display_name,active_role,actor_roles,action,module,entity_type,entity_id,after_summary,reason,risk_level)
        VALUES (${org},'Authorised historical leave import','System','{}','import','leave','leave-history-import',${stableId(payload.workbooks.map((w) => w.sha256).join(":") + ":" + inserted.join(":"))},${tx.json({ requests: inserted.length, days: summary.newDays, requestIds: inserted, sourceFiles: payload.workbooks.map((w) => ({ file: w.file, sha256: w.sha256 })), balancesChanged: false })},'User requested importing existing approved leave. No new approval, payroll run, balance adjustment or employee account was created.','Medium')`;
    }
    console.log(
      `COMMITTED ${inserted.length} approved historical requests. No balance changes or emails.`,
    );
  });
} finally {
  await db.end({ timeout: 5 });
}
