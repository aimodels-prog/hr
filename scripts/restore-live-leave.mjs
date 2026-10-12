import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { POLICY_DEFINITIONS } from "../src/lib/data/leave-policy-defaults.ts";

const mode = process.argv[2] ?? "--dry-run";
if (!["--dry-run", "--apply"].includes(mode))
  throw new Error("Usage: restore-live-leave.mjs [--dry-run|--apply] < prepared-payload.json");
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
if (
  payload.version !== 1 ||
  payload.year !== 2026 ||
  !/^[0-9a-f]{64}$/.test(payload.sourceSha256) ||
  !Array.isArray(payload.rows) ||
  payload.rows.length < 20
)
  throw new Error("Invalid opening balance payload");
const db = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
try {
  const result = await db.begin(async (tx) => {
    if (mode === "--dry-run") await tx`SET TRANSACTION READ ONLY`;
    else {
      await tx`SELECT pg_advisory_xact_lock(hashtext('via-live-leave-catalogue-2026'))`;
      await tx`LOCK TABLE leave_policies, leave_balances, leave_transactions IN SHARE ROW EXCLUSIVE MODE`;
    }
    const organisations = process.env.VIA_HR_ORGANISATION_ID
      ? await tx`SELECT id FROM organisations WHERE is_active=true AND id=${process.env.VIA_HR_ORGANISATION_ID}`
      : await tx`SELECT id FROM organisations WHERE is_active=true`;
    if (organisations.length !== 1) throw new Error("Exactly one active organisation is required");
    const organisationId = organisations[0].id;
    const [settings] =
      await tx`SELECT leave_year_start, timezone FROM app_settings WHERE organisation_id=${organisationId}`;
    if (!settings || settings.leave_year_start !== "01-01")
      throw new Error("This opening balance file requires a January leave year");
    const [actor] = await tx`
      SELECT u.id, u.employee_id, r.code AS role FROM users u
      JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
      WHERE u.organisation_id=${organisationId} AND lower(u.workspace_email)='hr@via-int.com'
        AND u.status='Active' AND u.archived_at IS NULL
        AND r.code IN ('HR','Super Admin')
      ORDER BY CASE WHEN r.code='HR' THEN 0 ELSE 1 END LIMIT 1`;
    if (!actor) throw new Error("Active HR or Super Admin owner was not found");
    const staff = await tx`SELECT id, legal_name, status FROM employees
      WHERE organisation_id=${organisationId} AND archived_at IS NULL`;
    const names = new Map();
    for (const employee of staff) {
      const name = employee.legal_name.trim().toLowerCase().replace(/\s+/g, " ");
      if (names.has(name)) throw new Error("Duplicate employee name in live records");
      names.set(name, employee);
    }
    const former = new Set(payload.formerEmployees ?? []);
    const matched = [];
    const unmatched = [];
    for (const row of payload.rows) {
      if (
        typeof row.employeeName !== "string" ||
        typeof row.name !== "string" ||
        ![row.entitlement, row.remaining, row.carry].every(
          (value) => typeof value === "number" && Number.isFinite(value),
        ) ||
        row.entitlement < 0 ||
        row.carry < 0 ||
        row.carry > 30 ||
        row.entitlement > 365
      )
        throw new Error("Invalid opening balance entry");
      if (former.has(row.employeeName)) continue;
      const employee = names.get(row.employeeName);
      if (!employee || ["Inactive", "Archived"].includes(employee.status)) {
        unmatched.push(row.name);
        continue;
      }
      matched.push({ employee, row });
    }
    if (matched.length < 15) throw new Error("Too few employees match the opening balances");
    const policies = await tx`SELECT id, code, name FROM leave_policies
      WHERE organisation_id=${organisationId} AND archived_at IS NULL`;
    const livePolicies = policies.filter((policy) => !policy.code.startsWith("HIST-"));
    const [balances] = await tx`SELECT count(*)::integer AS count FROM leave_balances
      WHERE organisation_id=${organisationId} AND leave_year=2026 AND archived_at IS NULL`;
    const [transactions] = await tx`SELECT count(*)::integer AS count FROM leave_transactions
      WHERE organisation_id=${organisationId} AND archived_at IS NULL`;
    const [history] = await tx`SELECT count(*)::integer AS count FROM leave_requests
      WHERE organisation_id=${organisationId} AND archived_at IS NULL`;
    const alreadyApplied =
      livePolicies.some((policy) => policy.code === "A/L") && balances.count >= matched.length;
    if (!alreadyApplied && (livePolicies.length || balances.count || transactions.count))
      throw new Error("Live leave data already exists; automatic opening balance setup stopped");
    if (mode === "--dry-run" || alreadyApplied)
      return {
        mode,
        alreadyApplied,
        matched: matched.length,
        unmatched: unmatched.length,
        activePolicies: livePolicies.length,
        balances: balances.count,
        history: history.count,
        sourceSha256: payload.sourceSha256,
      };
    const defaults = POLICY_DEFINITIONS.filter((policy) => policy.category !== "Attendance Marker");
    let annualPolicyId = null;
    for (const policy of defaults) {
      const id = randomUUID();
      await tx`INSERT INTO leave_policies (
        id, organisation_id, code, name, type, category, legal_basis, description,
        is_paid, pay_tiers, base_entitlement_days, scope, accrual_mode,
        carry_forward_limit, allow_negative_balance, max_negative_balance,
        requires_attachment, requires_handover_contact, counts_toward_gratuity,
        eligibility, approval_chain, notice_rules, is_enabled, is_statutory,
        consumes_balance, created_by, updated_by
      ) VALUES (
        ${id}, ${organisationId}, ${policy.code}, ${policy.name}, ${policy.type}, ${policy.category},
        ${policy.legalBasis ?? null}, ${policy.description}, ${policy.isPaid},
        ${JSON.stringify(policy.payTiers ?? [])}::jsonb, ${policy.baseEntitlementDays.toFixed(2)},
        ${policy.scope}, ${policy.accrualMode}, ${policy.carryForwardLimit.toFixed(2)},
        ${policy.allowNegativeBalance}, ${policy.allowNegativeBalance ? (policy.maxNegativeBalance ?? 0).toFixed(2) : null},
        ${policy.requiresAttachment}, ${policy.requiresHandoverContact}, ${policy.countsTowardGratuity},
        ${policy.eligibility ? JSON.stringify(policy.eligibility) : null}::jsonb,
        ${JSON.stringify(policy.approvalChain)}::jsonb,
        ${policy.noticeRules ? JSON.stringify(policy.noticeRules) : null}::jsonb,
        ${policy.isEnabled}, ${policy.isStatutory}, ${policy.consumesBalance}, ${actor.id}, ${actor.id}
      )`;
      if (policy.code === "A/L") annualPolicyId = id;
    }
    if (!annualPolicyId) throw new Error("Annual leave policy is missing");
    const openingTime = new Date();
    for (const { employee, row } of matched) {
      const balanceId = randomUUID();
      const openingBalance = (
        (Math.round(row.remaining * 100) + Math.round(row.carry * 100)) /
        100
      ).toFixed(2);
      await tx`INSERT INTO leave_balances (
        id, organisation_id, employee_id, policy_id, leave_year, balance_days,
        created_by, updated_by
      ) VALUES (${balanceId}, ${organisationId}, ${employee.id}, ${annualPolicyId}, 2026,
        ${openingBalance}, ${actor.id}, ${actor.id})`;
      const entitlement = Math.round(row.entitlement * 100) / 100;
      const priorUsed = Math.round((entitlement - row.remaining) * 100) / 100;
      if (entitlement > 0)
        await tx`INSERT INTO leave_transactions (
        id, organisation_id, employee_id, policy_id, date, transaction_type, days,
        reason, reference_id, actor_user_id, created_at, updated_at, created_by, updated_by
      ) VALUES (${randomUUID()}, ${organisationId}, ${employee.id}, ${annualPolicyId}, '2026-01-01',
        'Entitlement', ${entitlement.toFixed(2)}, '2026 annual leave allowance', ${balanceId},
        ${actor.id}, ${new Date(openingTime.getTime() - 3000)}, ${new Date(openingTime.getTime() - 3000)},
        ${actor.id}, ${actor.id})`;
      if (priorUsed > 0)
        await tx`INSERT INTO leave_transactions (
        id, organisation_id, employee_id, policy_id, date, transaction_type, days,
        reason, actor_user_id, created_at, updated_at, created_by, updated_by
      ) VALUES (${randomUUID()}, ${organisationId}, ${employee.id}, ${annualPolicyId}, '2026-01-01',
        'Approved Leave', ${(-priorUsed).toFixed(2)}, 'Previously approved leave included in opening balance',
        ${actor.id}, ${new Date(openingTime.getTime() - 2000)}, ${new Date(openingTime.getTime() - 2000)},
        ${actor.id}, ${actor.id})`;
      if (row.carry > 0)
        await tx`INSERT INTO leave_transactions (
        id, organisation_id, employee_id, policy_id, date, transaction_type, days,
        reason, reference_id, actor_user_id, created_at, updated_at, created_by, updated_by
      ) VALUES (${randomUUID()}, ${organisationId}, ${employee.id}, ${annualPolicyId}, '2026-01-01',
        'Carry-Forward', ${row.carry.toFixed(2)}, 'Unused annual leave carried from 2025', ${balanceId},
        ${actor.id}, ${new Date(openingTime.getTime() - 1000)}, ${new Date(openingTime.getTime() - 1000)},
        ${actor.id}, ${actor.id})`;
    }
    await tx`INSERT INTO audit_events (
      organisation_id, actor_user_id, actor_employee_id, actor_display_name,
      active_role, actor_roles, action, module, entity_type, entity_id,
      after_summary, reason, risk_level
    ) VALUES (
      ${organisationId}, ${actor.id}, ${actor.employee_id}, 'HR Department', ${actor.role},
      ARRAY[${actor.role}]::text[], 'restore-active-leave', 'leave', 'leave-balance',
      ${organisationId}, ${JSON.stringify({ matched: matched.length, unmatched: unmatched.length, sourceSha256: payload.sourceSha256 })}::jsonb,
      'Restored active leave types and opening balances', 'High'
    )`;
    const [finalHistory] = await tx`SELECT count(*)::integer AS count FROM leave_requests
      WHERE organisation_id=${organisationId} AND archived_at IS NULL`;
    if (finalHistory.count !== history.count)
      throw new Error("Historical leave records changed unexpectedly");
    return {
      mode,
      alreadyApplied: false,
      matched: matched.length,
      unmatched: unmatched.length,
      activePolicies: defaults.length,
      balances: matched.length,
      history: finalHistory.count,
      sourceSha256: payload.sourceSha256,
    };
  });
  console.log(JSON.stringify(result));
} finally {
  await db.end();
}
