import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { planUpdatedPersonImport } from "../scripts/import-updated-leave-person-data.mjs";
import { preserveSafaMaternity } from "../scripts/reconcile-leave-history-data.mjs";

const employee = {
  id: "employee-emmanuel",
  legal_name: "Emmanuel Essiet",
  status: "Active",
  archived_at: null,
  start_date: "2026-05-04",
  termination_date: null,
};
const user = {
  employee_id: employee.id,
  workspace_email: "e.essiet@via-int.com",
  status: "Active",
  archived_at: null,
};
const sourceName = "Emmanuel Gregory Essiet";
const matching = { aliases: { "emmanuel gregory essiet": "emmanuel essiet" } };

function day(date: string, code = "RM", name = sourceName) {
  return { name, date, code, days: code === "HFD" ? 0.5 : 1, year: 2026 };
}

function plan(
  sourceDays: ReturnType<typeof day>[],
  existing: Array<Record<string, unknown>> = [],
  extra: Record<string, unknown> = {},
) {
  return planUpdatedPersonImport({
    extracted: {
      names: [sourceName],
      days: sourceDays.filter((item) => item.code !== "RM" && item.code !== "R"),
      excluded: sourceDays.filter((item) => item.code === "RM" || item.code === "R"),
    },
    sourceName,
    email: user.workspace_email,
    employees: [employee],
    users: [user],
    matching,
    existing,
    asOf: "2026-11-09",
    ...extra,
  });
}

function request(date: string, type = "Remote", status = "Approved") {
  return {
    id: `request-${date}`,
    employee_id: employee.id,
    start_date: date,
    end_date: date,
    is_half_day: false,
    status,
    policy_snapshot: { type, workingDates: [date] },
    archived_at: null,
  };
}

test("Emmanuel's 18 October RM is a missing Remote Work date, not ordinary leave", () => {
  const result = plan([day("2026-10-18"), day("2026-10-19")]);
  assert.equal(result.canApply, true);
  assert.equal(result.inserts.length, 1);
  assert.equal(result.inserts[0]!.code, "RM");
  assert.deepEqual(
    result.inserts[0]!.days.map((item: { date: string }) => item.date),
    ["2026-10-18", "2026-10-19"],
  );
  assert.deepEqual(result.conflicts, []);
});

test("an already-approved matching day is reused without a duplicate", () => {
  const result = plan([day("2026-10-18")], [request("2026-10-18")]);
  assert.equal(result.canApply, true);
  assert.equal(result.inserts.length, 0);
  assert.equal(result.alreadyRecorded.length, 1);
});

test("an existing half-day leave is never silently overwritten by updated RM", () => {
  const halfDay = {
    ...request("2026-10-18", "Other"),
    is_half_day: true,
  };
  const result = plan([day("2026-10-18")], [halfDay]);
  assert.equal(result.canApply, false);
  assert.equal(result.inserts.length, 0);
  assert.equal(result.conflicts[0]!.reason, "Overlaps an existing app request");
});

test("pending or declined app decisions block re-import", () => {
  for (const status of ["Pending HR", "Declined", "Automatically Refused"]) {
    const result = plan([day("2026-10-18")], [request("2026-10-18", "Remote", status)]);
    assert.equal(result.canApply, false);
    assert.equal(result.inserts.length, 0);
  }
});

test("office punch evidence blocks a missing spreadsheet date pending HR review", () => {
  for (const clockOut of [null, "2026-10-18T17:00:00Z"]) {
    const result = plan([day("2026-10-18")], [], {
      attendance: [
        {
          date: "2026-10-18",
          clock_in_at: "2026-10-18T08:00:00Z",
          clock_out_at: clockOut,
          archived_at: null,
        },
      ],
    });
    assert.equal(result.canApply, false);
    assert.equal(result.inserts.length, 0);
    assert.match(result.conflicts[0]!.reason, /Attendance punches/);
  }
});

test("a submitted or payroll-locked month cannot change silently", () => {
  for (const status of ["Pending Manager", "Approved", "Payroll Locked"]) {
    const result = plan([day("2026-10-18")], [], {
      timesheets: [
        {
          start_date: "2026-10-01",
          end_date: "2026-10-31",
          status,
          period_status: "Open",
          archived_at: null,
        },
      ],
    });
    assert.equal(result.canApply, false);
    assert.equal(result.inserts.length, 0);
  }
  const draft = plan([day("2026-10-18")], [], {
    timesheets: [
      {
        start_date: "2026-10-01",
        end_date: "2026-10-31",
        status: "Draft",
        period_status: "Open",
        archived_at: null,
      },
    ],
  });
  assert.equal(draft.canApply, true);
});

test("future markers are withheld, while already-approved future dates remain untouched", () => {
  const future = day("2026-11-19");
  const missing = plan([future]);
  assert.equal(missing.inserts.length, 0);
  assert.deepEqual(missing.withheldFuture, [{ date: future.date, code: "RM" }]);
  const existing = plan([future], [request(future.date)]);
  assert.equal(existing.inserts.length, 0);
  assert.equal(existing.withheldFuture.length, 1);
  assert.equal(existing.canApply, true);
  const pending = plan([future, day("2026-10-18")], [request(future.date, "Remote", "Pending HR")]);
  assert.equal(pending.canApply, true);
  assert.equal(pending.inserts.length, 1);
});

test("an exact source date can be imported without bypassing unrelated conflicts", () => {
  const conflict = request("2026-10-18", "Annual", "Declined");
  const source = [day("2026-10-18"), day("2026-11-04", "SICK")];
  const full = plan(source, [conflict]);
  assert.equal(full.canApply, false);
  const scoped = plan(source, [conflict], { onlyDates: ["2026-11-04"] });
  assert.equal(scoped.canApply, true);
  assert.equal(scoped.inserts[0]!.startDate, "2026-11-04");
  assert.throws(() => plan(source, [], { onlyDates: ["2026-11-05"] }), /Every scoped date/);
});

test("the workbook's R resignation marker is not imported as Remote Work", () => {
  const result = plan([day("2026-10-18", "R"), day("2026-10-19", "RM")]);
  assert.equal(result.sourceDays, 1);
  assert.equal(result.inserts.length, 1);
  assert.equal(result.inserts[0]!.startDate, "2026-10-19");
});

test("the exact active Portal account is required", () => {
  assert.throws(
    () => plan([day("2026-10-18")], [], { email: "another@via-int.com" }),
    /exact active Portal email/,
  );
});

test("Safa's verified maternity dates stay maternity, not remote, in the person's plan", () => {
  const maternity = Array.from({ length: 95 }, (_, index) =>
    day(
      new Date(Date.UTC(2026, 1, 3 + index)).toISOString().slice(0, 10),
      "MAT",
      "Safa Al Balushi",
    ),
  );
  const changed = maternity.slice(0, 26).map((entry) => ({ ...entry, code: "RM" }));
  const effective = preserveSafaMaternity(
    { names: ["Safa Al Balushi"], days: maternity.slice(26), excluded: changed },
    { days: maternity },
  );
  const safa = { ...employee, id: "safa", legal_name: "Safa Al Balushi", start_date: "2026-01-01" };
  const result = planUpdatedPersonImport({
    extracted: effective,
    sourceName: "Safa Al Balushi",
    email: "safa@via-int.com",
    employees: [safa],
    users: [{ ...user, employee_id: safa.id, workspace_email: "safa@via-int.com" }],
    matching: {},
    existing: [],
    asOf: "2026-11-09",
  });
  assert.equal(
    result.inserts.every((group: { code: string }) => group.code === "MAT"),
    true,
  );
  assert.equal(result.inserts.flatMap((group: { days: unknown[] }) => group.days).length, 95);
});

test("historical insertions start as Taken so the worker cannot emit a later status-change alert", () => {
  for (const script of [
    "../scripts/import-updated-leave-person.mjs",
    "../scripts/reclassify-surabhi-remote.mjs",
  ]) {
    const source = readFileSync(new URL(script, import.meta.url), "utf8");
    assert.match(source, /'Taken','\[\]'/);
    assert.doesNotMatch(source, /'Approved','\[\]'/);
  }
});
