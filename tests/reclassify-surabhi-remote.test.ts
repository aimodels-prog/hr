import assert from "node:assert/strict";
import test from "node:test";

import { stableId } from "../scripts/leave-history-data.mjs";
import { OLD_2026_FILE, OLD_2026_SHA256 } from "../scripts/reconcile-leave-history-data.mjs";
import {
  changedSurabhiDates,
  planSurabhiRemoteReclassification,
} from "../scripts/reclassify-surabhi-remote-data.mjs";

const org = "00000000-0000-4000-8000-000000000001";
const employee = {
  id: "00000000-0000-4000-8000-000000000002",
  legal_name: "Surabhi Bharadwaj",
  status: "Active",
  archived_at: null,
  start_date: "2026-01-01",
  termination_date: null,
};
const user = {
  employee_id: employee.id,
  workspace_email: "surabhi@via-int.com",
  status: "Active",
  archived_at: null,
};
const oldPolicy = {
  id: "00000000-0000-4000-8000-000000000003",
  code: "HIST-HFD",
  type: "Other",
  is_paid: true,
  is_enabled: false,
  consumes_balance: false,
};
const oldImporter = stableId("via-approved-leave-history-importer");
const worker = "00000000-0000-4000-8000-000000000004";

const dates = Array.from({ length: 214 }, (_, index) =>
  new Date(Date.UTC(2026, 3, 1 + index)).toISOString().slice(0, 10),
);
const previous = {
  days: dates.map((date) => ({
    name: "Surabhi Bharadwaj",
    date,
    code: "HFD",
    rawCode: "HFD/ R",
    days: 0.5,
    year: 2026,
  })),
};
const updated = {
  excluded: dates.map((date) => ({
    name: "Surabhi Bharadwaj",
    date,
    code: "RM",
    rawCode: "RM",
    days: 1,
    year: 2026,
  })),
};

function oldRequest(date: string) {
  return {
    id: stableId(`${org}:${employee.id}:approved-history:${date}:HFD`),
    employee_id: employee.id,
    policy_id: oldPolicy.id,
    start_date: date,
    end_date: date,
    is_half_day: true,
    working_days_requested: "0.5",
    status: "Taken",
    record_version: 2,
    created_by: oldImporter,
    updated_by: worker,
    chain_approvals: [],
    policy_snapshot: {
      type: "Other",
      workingDates: [date],
      spreadsheetImport: {
        version: 1,
        days: [
          {
            name: "Surabhi Bharadwaj",
            date,
            code: "HFD",
            rawCode: "HFD/ R",
            days: 0.5,
            year: 2026,
            source: { sha256: OLD_2026_SHA256, file: OLD_2026_FILE },
          },
        ],
      },
    },
    archived_at: null,
  };
}

function plan(existing: Record<string, unknown>[], extras: Record<string, unknown> = {}) {
  return planSurabhiRemoteReclassification({
    previous,
    updated,
    organisationId: org,
    employee,
    user,
    email: user.workspace_email,
    existing,
    oldPolicy,
    oldPolicyHasBalance: false,
    oldPolicyHasLedger: false,
    markTakenEvents: [
      {
        actor_user_id: worker,
        action: "mark-taken",
        module: "leave",
        after_summary: { requestIds: existing.map((request) => request.id) },
      },
    ],
    ledgerReferenceIds: new Set(),
    attendance: [],
    asOf: "2026-11-09",
    ...extras,
  });
}

test("exact HFD/R-to-RM pair set is required", () => {
  assert.equal(changedSurabhiDates(previous, updated).length, 214);
  assert.throws(
    () => changedSurabhiDates(previous, { excluded: updated.excluded.slice(1) }),
    /verified old\/new source dates changed|Not every verified HFD\/R date/,
  );
});

test("one untouched worker-completed old half-day can be reclassified", () => {
  const record = oldRequest(dates[0]!);
  const result = plan([record]);
  assert.equal(result.canApply, true);
  assert.equal(result.replace.length, 1);
  assert.equal(result.replace[0]!.oldRequestId, record.id);
  assert.equal(result.replacementGroups.length, 1);
  assert.equal(result.uncovered.length, 213);
});

test("a manually changed old request is a conflict", () => {
  const record = { ...oldRequest(dates[0]!), record_version: 3 };
  const result = plan([record]);
  assert.equal(result.canApply, false);
  assert.equal(result.replace.length, 0);
});

test("mark-taken audit and actor identity must prove the worker-only update", () => {
  const record = oldRequest(dates[0]!);
  assert.equal(plan([record], { markTakenEvents: [] }).canApply, false);
  assert.equal(
    plan([record], {
      markTakenEvents: [
        {
          actor_user_id: "some-other-person",
          action: "mark-taken",
          module: "leave",
          after_summary: { requestIds: [record.id] },
        },
      ],
    }).canApply,
    false,
  );
});

test("balance, ledger and complete attendance evidence block correction", () => {
  const record = oldRequest(dates[0]!);
  assert.throws(() => plan([record], { oldPolicyHasBalance: true }), /not safe/);
  assert.throws(() => plan([record], { oldPolicyHasLedger: true }), /not safe/);
  assert.equal(plan([record], { ledgerReferenceIds: new Set([record.id]) }).canApply, false);
  assert.equal(
    plan([record], {
      attendance: [
        {
          date: dates[0],
          clock_in_at: "2026-04-01T08:00:00Z",
          clock_out_at: "2026-04-01T17:00:00Z",
          archived_at: null,
        },
      ],
    }).canApply,
    false,
  );
});

test("outside-service dates are withheld, not silently reclassified", () => {
  const result = plan([], { employee: { ...employee, start_date: dates[1] } });
  assert.equal(result.withheldOutsideService.length, 1);
  assert.equal(result.replace.length, 0);
});

test("already-approved Remote Work is not duplicated", () => {
  const date = dates[0]!;
  const result = plan([
    {
      id: "remote-existing",
      employee_id: employee.id,
      start_date: date,
      end_date: date,
      status: "Approved",
      policy_snapshot: { type: "Remote", workingDates: [date] },
      archived_at: null,
    },
  ]);
  assert.deepEqual(result.alreadyRemote, [date]);
  assert.equal(result.replace.length, 0);
  assert.equal(result.canApply, true);
});

test("wrong employee or Portal account is rejected", () => {
  assert.throws(() => plan([], { employee: { ...employee, legal_name: "Someone else" } }));
  assert.throws(() => plan([], { email: "wrong@via-int.com" }));
});
