import postgres from "postgres";
import { randomUUID } from "node:crypto";

// One-time, guarded correction of the opening balances imported from this workbook.
// The source formulas have fractional cached values, but the HR workbook displays
// these columns as whole days. Preserve both the original and correcting entries.
const expectedSourceSha256 = "bb8612aac330c3a4b2c3f3a2b8a49197dda71d4731330a029fe89fcfdf35c6dd";
const mode = process.argv[2] ?? "--dry-run";
if (!["--dry-run", "--apply"].includes(mode))
  throw new Error("Usage: correct-live-leave-display.mjs [--dry-run|--apply] < payload.json");
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
if (
  payload.version !== 1 ||
  payload.year !== 2026 ||
  payload.sourceSha256 !== expectedSourceSha256 ||
  !Array.isArray(payload.rows) ||
  payload.rows.length !== 25
)
  throw new Error("Unexpected opening-balance workbook; no correction was made");

const cents = (value) => Math.round(Number(value) * 100);
const days = (value) => (value / 100).toFixed(2);
const db = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
try {
  const result = await db.begin(async (tx) => {
    if (mode === "--dry-run") await tx`SET TRANSACTION READ ONLY`;
    else {
      await tx`SELECT pg_advisory_xact_lock(hashtext('via-live-leave-catalogue-2026'))`;
      await tx`LOCK TABLE leave_balances, leave_transactions IN SHARE ROW EXCLUSIVE MODE`;
    }
    const organisations = process.env.VIA_HR_ORGANISATION_ID
      ? await tx`SELECT id FROM organisations WHERE is_active=true AND id=${process.env.VIA_HR_ORGANISATION_ID}`
      : await tx`SELECT id FROM organisations WHERE is_active=true`;
    if (organisations.length !== 1) throw new Error("Exactly one active organisation is required");
    const organisationId = organisations[0].id;
    const [actor] = await tx`
      SELECT u.id, u.employee_id, r.code AS role FROM users u
      JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
      WHERE u.organisation_id=${organisationId} AND lower(u.workspace_email)='hr@via-int.com'
        AND u.status='Active' AND u.archived_at IS NULL AND r.code IN ('HR','Super Admin')
      ORDER BY CASE WHEN r.code='HR' THEN 0 ELSE 1 END LIMIT 1`;
    if (!actor) throw new Error("Active HR owner was not found");
    const [policy] = await tx`SELECT id FROM leave_policies WHERE organisation_id=${organisationId}
      AND code='A/L' AND is_enabled AND archived_at IS NULL`;
    if (!policy) throw new Error("Active annual leave policy was not found");
    // The first import saved its summary as a JSON scalar string; newer events use an object.
    const [restoreAudit] =
      await tx`SELECT id FROM audit_events WHERE organisation_id=${organisationId}
      AND action='restore-active-leave' AND after_summary::text LIKE ${`%${expectedSourceSha256}%`}
      LIMIT 1`;
    if (!restoreAudit) throw new Error("The expected opening balance import was not found");
    const [correctionAudit] =
      await tx`SELECT id FROM audit_events WHERE organisation_id=${organisationId}
      AND action='correct-opening-display-days' AND after_summary::text LIKE ${`%${expectedSourceSha256}%`}
      LIMIT 1`;
    const [history] = await tx`SELECT count(*)::integer AS count FROM leave_requests
      WHERE organisation_id=${organisationId} AND archived_at IS NULL`;
    if (history.count < 347) throw new Error("Historical leave requests are missing");
    const staff =
      await tx`SELECT id, lower(regexp_replace(trim(legal_name), '\\s+', ' ', 'g')) AS name,
      status FROM employees WHERE organisation_id=${organisationId} AND archived_at IS NULL`;
    const staffByName = new Map(staff.map((employee) => [employee.name, employee]));
    const former = new Set(payload.formerEmployees ?? []);
    const matched = payload.rows
      .filter((row) => !former.has(row.employeeName))
      .map((row) => ({ row, employee: staffByName.get(row.employeeName) }))
      .filter(({ employee }) => employee && !["Inactive", "Archived"].includes(employee.status));
    if (matched.length !== 19) throw new Error("The employee match set has changed");
    const balances = await tx`SELECT id, employee_id, balance_days FROM leave_balances
      WHERE organisation_id=${organisationId} AND policy_id=${policy.id} AND leave_year=2026
        AND archived_at IS NULL`;
    if (balances.length !== 19) throw new Error("Annual opening balance count has changed");
    const balancesByEmployee = new Map(balances.map((balance) => [balance.employee_id, balance]));
    const transactions = await tx`SELECT employee_id, transaction_type, days, reason
      FROM leave_transactions WHERE organisation_id=${organisationId} AND policy_id=${policy.id}
        AND date >= '2026-01-01' AND date < '2027-01-01' AND archived_at IS NULL`;
    const transactionsByEmployee = new Map();
    for (const entry of transactions) {
      const entries = transactionsByEmployee.get(entry.employee_id) ?? [];
      entries.push(entry);
      transactionsByEmployee.set(entry.employee_id, entries);
    }
    const changes = [];
    for (const { row, employee } of matched) {
      if (
        ![
          row.entitlement,
          row.remaining,
          row.carry,
          row.rawEntitlement,
          row.rawRemaining,
          row.rawCarry,
        ].every((value) => typeof value === "number" && Number.isFinite(value)) ||
        ![row.entitlement, row.remaining, row.carry].every(Number.isInteger)
      )
        throw new Error("Invalid displayed and raw balance values");
      const balance = balancesByEmployee.get(employee.id);
      if (!balance) throw new Error("Opening balance is missing for a matched employee");
      const rawTotal = cents(row.rawRemaining) + cents(row.rawCarry);
      const displayedTotal = cents(row.remaining) + cents(row.carry);
      const entries = transactionsByEmployee.get(employee.id) ?? [];
      if (correctionAudit) {
        if (cents(balance.balance_days) !== displayedTotal)
          throw new Error("A corrected opening balance has changed");
        continue;
      }
      if (cents(balance.balance_days) !== rawTotal)
        throw new Error("An opening balance has changed since import");
      const expected = [
        ...(row.rawEntitlement > 0
          ? [["Entitlement", cents(row.rawEntitlement), "2026 annual leave allowance"]]
          : []),
        ...(row.rawEntitlement - row.rawRemaining > 0.005
          ? [
              [
                "Approved Leave",
                -cents(row.rawEntitlement - row.rawRemaining),
                "Previously approved leave included in opening balance",
              ],
            ]
          : []),
        ...(row.rawCarry > 0
          ? [["Carry-Forward", cents(row.rawCarry), "Unused annual leave carried from 2025"]]
          : []),
      ];
      if (
        entries.length !== expected.length ||
        expected.some(
          ([type, amount, reason]) =>
            !entries.some(
              (entry) =>
                entry.transaction_type === type &&
                cents(entry.days) === amount &&
                entry.reason === reason,
            ),
        )
      )
        throw new Error("Opening ledger has changed since import");
      changes.push({
        balance,
        employee,
        currentDelta: cents(row.remaining) - cents(row.rawRemaining),
        carryDelta: cents(row.carry) - cents(row.rawCarry),
      });
    }
    if (correctionAudit || mode === "--dry-run")
      return {
        mode,
        alreadyCorrected: Boolean(correctionAudit),
        matched: matched.length,
        balances: balances.length,
        changes: changes.filter((change) => change.currentDelta || change.carryDelta).length,
        history: history.count,
        sourceSha256: expectedSourceSha256,
      };
    for (const change of changes) {
      const totalDelta = change.currentDelta + change.carryDelta;
      if (totalDelta)
        await tx`UPDATE leave_balances SET balance_days=balance_days+${days(totalDelta)},
          record_version=record_version+1, updated_at=now(), updated_by=${actor.id}
          WHERE id=${change.balance.id}`;
      for (const [type, delta, reason] of [
        [
          "Manual Adjustment",
          change.currentDelta,
          "2026 opening balance corrected to displayed whole days",
        ],
        ["Carry-Forward", change.carryDelta, "2025 carry corrected to displayed whole days"],
      ]) {
        if (!delta) continue;
        await tx`INSERT INTO leave_transactions (
          id, organisation_id, employee_id, policy_id, date, transaction_type, days,
          reason, reference_id, actor_user_id, created_by, updated_by
        ) VALUES (
          ${randomUUID()}, ${organisationId}, ${change.employee.id}, ${policy.id}, '2026-01-01',
          ${type}, ${days(delta)}, ${reason}, ${change.balance.id}, ${actor.id}, ${actor.id}, ${actor.id}
        )`;
      }
    }
    await tx`INSERT INTO audit_events (
      organisation_id, actor_user_id, actor_employee_id, actor_display_name,
      active_role, actor_roles, action, module, entity_type, entity_id,
      after_summary, reason, risk_level
    ) VALUES (
      ${organisationId}, ${actor.id}, ${actor.employee_id}, 'HR Department', ${actor.role},
      ARRAY[${actor.role}]::text[], 'correct-opening-display-days', 'leave', 'leave-balance',
      ${organisationId}, ${tx.json({ matched: matched.length, sourceSha256: expectedSourceSha256 })},
      'Aligned opening balances with whole days displayed in the HR workbook', 'High'
    )`;
    return {
      mode,
      alreadyCorrected: false,
      matched: matched.length,
      balances: balances.length,
      changes: changes.filter((change) => change.currentDelta || change.carryDelta).length,
      history: history.count,
      sourceSha256: expectedSourceSha256,
    };
  });
  console.log(JSON.stringify(result));
} finally {
  await db.end();
}
