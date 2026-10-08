import assert from "node:assert/strict";
import test from "node:test";
import { StaffModuleLoader } from "../src/lib/data/staff-module-loader.ts";
import {
  DASHBOARD_MODULES,
  staffPageModules,
  type StaffModule,
} from "../src/lib/data/staff-module-plan.ts";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("staff routes load their own modules, not the entire organisation", () => {
  for (const path of [
    "/staff",
    "/staff/employees",
    "/staff/org-chart",
    "/staff/payslips",
    "/staff/company-library",
    "/staff/my-tasks",
  ]) {
    assert.deepEqual(staffPageModules(path, "", "", "HR"), [], path);
  }
  assert.deepEqual(staffPageModules("/staff/leave-approvals", "", "", "HR"), ["leave"]);
  assert.deepEqual(staffPageModules("/staff/me/training", "", "", "Employee"), ["training"]);
  assert.deepEqual(staffPageModules("/staff/settings", "", "departments", "HR"), []);
  assert.deepEqual(staffPageModules("/staff/settings", "", "performanceTemplates", "HR"), [
    "performance",
  ]);
  assert.deepEqual(staffPageModules("/staff/vacancies", "", "", "HR"), ["vacancies"]);
  assert.deepEqual(staffPageModules("/staff/payroll/overtime", "", "", "HR"), []);
  assert.deepEqual(staffPageModules("/staff/candidates", "", "", "Employee"), []);
  assert.deepEqual(staffPageModules("/staff/offers", "", "", "Line Manager"), []);
  assert.deepEqual(staffPageModules("/staff/interviews", "", "", "Employee"), []);
  assert.deepEqual(staffPageModules("/staff/candidates/candidate-1", "", "", "HR"), [
    "recruitment",
  ]);
  assert.deepEqual(staffPageModules("/staff/employees/employee-1", "leave", "", "HR"), ["leave"]);
  assert.deepEqual(staffPageModules("/staff/me/profile", "attendance", "", "Employee"), [
    "attendance",
    "overtime",
  ]);
  assert.deepEqual(staffPageModules("/staff/employees/employee-1", "equipment", "", "HR"), []);
  assert.deepEqual(staffPageModules("/staff/employees/employee-1", "", "", "HR"), [
    "documents",
    "timesheets",
    "lifecycle",
  ]);
  for (const [section, modules] of [
    ["leave", ["leave"]],
    ["timesheets", ["timesheets", "leave", "attendance"]],
    ["attendance", ["attendance", "overtime"]],
    ["performance", ["performance"]],
    ["training", ["training"]],
    ["documents", []],
  ] as const) {
    assert.deepEqual(
      staffPageModules("/staff/employees/employee-1", `section=${section}`, "", "HR"),
      modules,
    );
    assert.deepEqual(
      staffPageModules("/staff/employees/employee-1", `#section=${section}`, "", "HR"),
      modules,
    );
  }
  assert.ok(
    !DASHBOARD_MODULES.employee.some((module: string) =>
      ["payroll", "recruitment"].includes(module),
    ),
  );
  assert.ok(!DASHBOARD_MODULES.hr.some((module: string) => module === "payroll"));
});

test("concurrent consumers share one load and ready modules are reused", async () => {
  const response = deferred();
  let calls = 0;
  const loader = new StaffModuleLoader(async () => {
    calls++;
    await response.promise;
  });
  const first = loader.ensure(["leave"]);
  const second = loader.ensure(["leave"]);
  await tick();
  assert.equal(calls, 1);
  response.resolve();
  await Promise.all([first, second]);
  await loader.ensure(["leave"]);
  assert.equal(calls, 1);
  assert.equal(loader.getSnapshot().leave?.status, "ready");
  loader.dispose();
});

test("dependent recruitment mapping waits for vacancies without occupying a load slot", async () => {
  const vacancies = deferred();
  const started: StaffModule[] = [];
  const loader = new StaffModuleLoader(
    async (module) => {
      started.push(module);
      if (module === "vacancies") await vacancies.promise;
    },
    1000,
    1,
  );
  const recruitment = loader.ensure(["recruitment"]);
  await tick();
  assert.deepEqual(started, ["vacancies"]);
  const leave = loader.ensure(["leave"]);
  vacancies.resolve();
  await Promise.all([recruitment, leave]);
  assert.ok(started.indexOf("recruitment") > started.indexOf("vacancies"));
  assert.equal(started.filter((item) => item === "vacancies").length, 1);
  loader.dispose();
});

test("attendance loads approved leave before deriving absence, including direct page entry", async () => {
  assert.deepEqual(staffPageModules("/staff/me/attendance", "", "", "Employee"), [
    "attendance",
    "leave",
  ]);
  assert.deepEqual(staffPageModules("/staff/attendance", "", "", "HR"), ["attendance", "leave"]);
  const started: StaffModule[] = [];
  const loader = new StaffModuleLoader(
    async (module) => {
      started.push(module);
    },
    1000,
    1,
  );
  await loader.ensure(["attendance"]);
  assert.deepEqual(started, ["leave", "attendance"]);
  loader.dispose();
});

test("the concurrency limit advances as soon as any request completes", async () => {
  const pending = new Map<StaffModule, ReturnType<typeof deferred>>();
  const started: StaffModule[] = [];
  let active = 0;
  let peak = 0;
  const loader = new StaffModuleLoader(async (module) => {
    started.push(module);
    active++;
    peak = Math.max(active, peak);
    const response = deferred();
    pending.set(module, response);
    await response.promise;
    active--;
  });
  const all = loader.ensure(["leave", "travel", "training", "performance"]);
  await tick();
  assert.equal(started.length, 3);
  pending.get("travel")!.resolve();
  await tick();
  assert.equal(started.length, 4);
  assert.equal(loader.getSnapshot().leave?.status, "loading");
  pending.forEach((response) => response.resolve());
  await all;
  assert.equal(peak, 3);
  loader.dispose();
});

test("a failed module does not block another page and retry reloads only the failure", async () => {
  const attempts = new Map<StaffModule, number>();
  const loader = new StaffModuleLoader(async (module) => {
    const attempt = (attempts.get(module) ?? 0) + 1;
    attempts.set(module, attempt);
    if (module === "travel" && attempt === 1) throw new Error("Travel unavailable");
  });
  await assert.rejects(loader.ensure(["travel"]), /Travel unavailable/);
  await loader.ensure(["leave"]);
  assert.equal(loader.getSnapshot().leave?.status, "ready");
  await loader.retry(["leave", "travel"]);
  assert.equal(attempts.get("leave"), 1);
  assert.equal(attempts.get("travel"), 2);
  assert.equal(loader.getSnapshot().travel?.status, "ready");
  loader.dispose();
});

test("retry repairs a failed dependency before loading its dependent", async () => {
  let attempts = 0;
  let recruitmentCalls = 0;
  const loader = new StaffModuleLoader(async (module) => {
    if (module === "vacancies" && ++attempts === 1) throw new Error("Vacancies unavailable");
    if (module === "recruitment") recruitmentCalls++;
  });
  await assert.rejects(loader.ensure(["recruitment"]), /Vacancies unavailable/);
  assert.equal(recruitmentCalls, 0);
  await loader.retry(["recruitment"]);
  assert.equal(recruitmentCalls, 1);
  loader.dispose();
});

test("timeout frees the queue and late responses cannot overwrite a successful retry", async () => {
  const delayed = deferred();
  const commits: string[] = [];
  let attempts = 0;
  const loader = new StaffModuleLoader(
    async (module, canCommit) => {
      if (module === "leave" && ++attempts === 1) {
        await delayed.promise;
        if (canCommit()) commits.push("stale leave");
      } else if (canCommit()) commits.push(module);
    },
    25,
    1,
  );
  const stalled = assert.rejects(loader.ensure(["leave"]), /too long/);
  const other = loader.ensure(["travel"]);
  await Promise.all([stalled, other]);
  await loader.retry(["leave"]);
  delayed.resolve();
  await tick();
  assert.deepEqual(commits, ["travel", "leave"]);
  assert.equal(loader.getSnapshot().leave?.status, "ready");
  loader.dispose();
});

test("switching roles invalidates in-flight writes and cancels queued work", async () => {
  const delayed = deferred();
  const started: StaffModule[] = [];
  let commits = 0;
  const loader = new StaffModuleLoader(
    async (module, canCommit) => {
      started.push(module);
      await delayed.promise;
      if (canCommit()) commits++;
    },
    1000,
    1,
  );
  const first = assert.rejects(loader.ensure(["leave"]), /Workspace changed/);
  const queued = assert.rejects(loader.ensure(["travel"]), /Workspace changed/);
  await tick();
  loader.dispose();
  await Promise.all([first, queued]);
  delayed.resolve();
  await tick();
  assert.deepEqual(started, ["leave"]);
  assert.equal(commits, 0);
  await assert.rejects(loader.ensure(["leave"]), /Workspace changed/);
});
