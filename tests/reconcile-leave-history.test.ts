import assert from "node:assert/strict";
import test from "node:test";

import { stableId } from "../scripts/leave-history-data.mjs";
import {
  OLD_2026_FILE,
  OLD_2026_SHA256,
  UPDATED_2026_SHA256,
  countCodeChanges,
  planReconciliation,
  preserveSafaMaternity,
  sourceIsOld2026,
} from "../scripts/reconcile-leave-history-data.mjs";

const importer = stableId("via-approved-leave-history-importer");
const reconciler = stableId("via-2026-leave-history-reconciler");
const employee = {
  id: "employee-1",
  legal_name: "Employee One",
  status: "Active",
  archived_at: null,
  start_date: "2026-01-01",
  termination_date: null,
};

function day(date: string, code = "A/L") {
  return {
    name: "Employee One",
    date,
    code,
    rawCode: code,
    days: code === "HFD" ? 0.5 : 1,
    year: 2026,
    source: { file: "Leave tracker 2025 to 2026 (2).xlsx", sha256: UPDATED_2026_SHA256 },
  };
}

function request(id: string, date: string, status: string, type = "Annual") {
  return {
    id,
    employee_id: employee.id,
    start_date: date,
    end_date: date,
    is_half_day: false,
    status,
    policy_snapshot: { type },
    chain_approvals: [],
    created_by: "app-user",
    updated_by: "app-user",
    record_version: 1,
    working_days_requested: 1,
    archived_at: null,
  };
}

function oldRequest() {
  return {
    ...request("old-1", "2026-10-01", "Approved"),
    policy_snapshot: {
      type: "Annual",
      spreadsheetImport: {
        version: 1,
        days: [
          {
            ...day("2026-10-01"),
            source: {
              file: OLD_2026_FILE,
              sha256: OLD_2026_SHA256,
            },
          },
        ],
      },
    },
    created_by: importer,
    updated_by: importer,
  };
}

type PlanOptions = Parameters<typeof planReconciliation>[0];

function plan(
  days: ReturnType<typeof day>[],
  existing: PlanOptions["existing"] = [],
  extra: Partial<PlanOptions> = {},
) {
  return planReconciliation({
    extracted: { names: [employee.legal_name], days, excluded: [], previousDays: [] },
    employees: [employee],
    users: [],
    matching: {},
    existing,
    asOf: "2026-11-09",
    importer,
    reconciler,
    ...extra,
  });
}

test("replaces only untouched rows from the exact prior 2026 source", () => {
  const old = oldRequest();
  assert.equal(sourceIsOld2026(old), true);
  assert.equal(
    sourceIsOld2026({
      ...old,
      policy_snapshot: {
        ...old.policy_snapshot,
        spreadsheetImport: {
          ...old.policy_snapshot.spreadsheetImport,
          days: [
            {
              ...old.policy_snapshot.spreadsheetImport.days[0],
              source: {
                file: OLD_2026_FILE,
                sha256: "0".repeat(64),
              },
            },
          ],
        },
      },
    }),
    false,
  );
  const result = plan([day("2026-10-01", "RM")], [old]);
  assert.deepEqual(result.archiveIds, ["old-1"]);
  assert.equal(result.inserts.length, 1);
  assert.equal(result.inserts[0]!.code, "RM");
  assert.equal(result.canApply, true);
});

test("a refused or declined native request blocks a conflicting historical approval", () => {
  for (const status of ["Automatically Refused", "Declined", "Cancelled"]) {
    const result = plan([day("2026-11-05")], [request("native-1", "2026-11-05", status)]);
    assert.equal(result.canApply, false);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.inserts.length, 0);
  }
});

test("a separately approved special request covers the day without erasing an earlier refusal", () => {
  const special = {
    ...request("special-approved", "2026-11-05", "Approved"),
    policy_snapshot: { type: "Annual", specialRequest: { reason: "Approved exception" } },
  };
  const refused = request("original-refused", "2026-11-05", "Automatically Refused");
  const result = plan([day("2026-11-05")], [refused, special]);
  assert.equal(result.canApply, true);
  assert.deepEqual(result.archiveIds, []);
  assert.deepEqual(result.inserts, []);
  assert.equal(result.alreadyInApp[0]!.requestId, "special-approved");
});

test("future-only sheet entries are withheld unless an app approval already exists", () => {
  const future = day("2026-11-19");
  const withoutApproval = plan([future]);
  assert.equal(withoutApproval.inserts.length, 0);
  assert.equal(withoutApproval.withheldFuture.length, 1);
  const withApproval = plan([future], [request("app-approved", future.date, "Approved")]);
  assert.equal(withApproval.alreadyInApp.length, 1);
  assert.equal(withApproval.withheldFuture.length, 0);
  assert.equal(withApproval.inserts.length, 0);
});

test("even an ongoing leave does not auto-approve future dates from the sheet alone", () => {
  const result = plan([day("2026-11-08"), day("2026-11-09"), day("2026-11-10")]);
  assert.equal(result.inserts.length, 1);
  assert.equal(result.inserts[0]!.days.length, 2);
  assert.equal(result.withheldFuture.length, 1);
});

test("a previous reconciled request is idempotently reused, not inserted again", () => {
  const reconciled = {
    ...request("v2-1", "2026-10-18", "Approved", "Remote"),
    policy_snapshot: {
      type: "Remote",
      spreadsheetImport: {
        version: 2,
        sourceSha256: UPDATED_2026_SHA256,
      },
    },
    created_by: reconciler,
    updated_by: reconciler,
  };
  const result = plan([day("2026-10-18", "RM")], [reconciled]);
  assert.equal(result.canApply, true);
  assert.equal(result.alreadyReconciled.length, 1);
  assert.equal(result.inserts.length, 0);
});

test("a changed reconciled decision is protected", () => {
  const changed = {
    ...request("v2-1", "2026-10-18", "Declined", "Remote"),
    policy_snapshot: {
      type: "Remote",
      spreadsheetImport: {
        version: 2,
        sourceSha256: UPDATED_2026_SHA256,
      },
    },
    created_by: reconciler,
    updated_by: "hr-user",
  };
  const result = plan([day("2026-10-18", "RM")], [changed]);
  assert.equal(result.canApply, false);
  assert.equal(result.inserts.length, 0);
});

test("an archived reconciled request is not silently recreated", () => {
  const archived = {
    ...request("v2-archived", "2026-10-18", "Approved", "Remote"),
    policy_snapshot: {
      type: "Remote",
      spreadsheetImport: {
        version: 2,
        sourceSha256: UPDATED_2026_SHA256,
      },
    },
    created_by: reconciler,
    updated_by: reconciler,
    archived_at: "2026-10-20T00:00:00Z",
  };
  const result = plan([day("2026-10-18", "RM")], [archived]);
  assert.equal(result.canApply, false);
});

test("unmatched names block apply; no employee record is synthesized", () => {
  const result = plan([day("2026-10-01")], [], { employees: [] });
  assert.equal(result.canApply, false);
  assert.equal(result.unmatched.length, 1);
  assert.equal(result.inserts.length, 0);
});

test("26 Safa RM reclassifications retain maternity while other remote dates remain remote", () => {
  const oldDays = Array.from({ length: 95 }, (_, index) => ({
    ...day(new Date(Date.UTC(2026, 1, 3 + index)).toISOString().slice(0, 10), "MAT"),
    name: "Safa Al Balushi",
  }));
  const changed = oldDays.slice(0, 26).map((item) => ({ ...item, code: "RM", rawCode: "RM" }));
  const otherRemote = { ...day("2026-10-10", "RM"), name: "Safa Al Balushi" };
  const effective = preserveSafaMaternity(
    { days: oldDays.slice(26), excluded: [...changed, otherRemote] },
    { days: oldDays },
  );
  assert.equal(countCodeChanges(oldDays, changed, "MAT", "RM"), 26);
  assert.equal(effective.maternityPreserved, 26);
  assert.equal(effective.days.filter((item) => item.code === "MAT").length, 95);
  assert.equal(effective.excluded.filter((item) => item.code === "RM").length, 1);
  assert.equal(effective.days.at(-1)!.sourceOverride.previousCode, "MAT");
  assert.throws(
    () =>
      preserveSafaMaternity(
        { days: oldDays.slice(26), excluded: changed.slice(1) },
        { days: oldDays },
      ),
    /exactly 26/,
  );
});
