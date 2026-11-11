import assert from "node:assert/strict";
import test from "node:test";

import {
  browserApprovalAlertsKey,
  browserApprovalAlertHistoryKey,
  claimBrowserApprovalTasks,
  newlyArrivedUnread,
  newlyAssignedApprovalTasks,
} from "../src/lib/data/notification-popup.ts";

test("existing unread notifications do not pop up when the page first opens", () => {
  const notices = [{ id: "existing", status: "Unread" }];
  assert.deepEqual(newlyArrivedUnread(notices, null), []);
});

test("only newly arrived unread notifications pop up", () => {
  const notices = [
    { id: "existing", status: "Unread" },
    { id: "new-request", status: "Unread" },
    { id: "already-read", status: "Read" },
  ];
  assert.deepEqual(newlyArrivedUnread(notices, new Set(["existing"])), [notices[1]]);
  assert.deepEqual(newlyArrivedUnread(notices, new Set(notices.map((notice) => notice.id))), []);
});

test("only newly assigned approval tasks trigger browser pop-ups", () => {
  const tasks = [{ id: "old-approval" }, { id: "new-approval" }];
  assert.deepEqual(newlyAssignedApprovalTasks(tasks, null), []);
  assert.deepEqual(newlyAssignedApprovalTasks(tasks, new Set(["old-approval"])), [tasks[1]]);
  assert.deepEqual(newlyAssignedApprovalTasks(tasks, new Set(tasks.map((task) => task.id))), []);
});

test("browser alert preference is scoped to the signed-in account", () => {
  assert.notEqual(browserApprovalAlertsKey("hr-user"), browserApprovalAlertsKey("manager-user"));
  assert.notEqual(
    browserApprovalAlertHistoryKey("hr-user", "HR"),
    browserApprovalAlertHistoryKey("hr-user", "Employee"),
  );
});

test("browser approval pop-ups are deduplicated across tabs and retain only recent IDs", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
  const key = browserApprovalAlertHistoryKey("hr-user", "HR");
  const tasks = [{ id: "one" }, { id: "two" }, { id: "two" }];
  assert.deepEqual(claimBrowserApprovalTasks(tasks, storage, key), [tasks[0], tasks[1]]);
  assert.deepEqual(claimBrowserApprovalTasks(tasks, storage, key), []);
  assert.deepEqual(JSON.parse(values.get(key)!), ["one", "two"]);

  const many = Array.from({ length: 250 }, (_, index) => ({ id: `next-${index}` }));
  claimBrowserApprovalTasks(many, storage, key);
  assert.equal(JSON.parse(values.get(key)!).length, 200);
});
