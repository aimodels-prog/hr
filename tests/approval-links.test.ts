import assert from "node:assert/strict";
import test from "node:test";

import {
  approvalActionUrl,
  approvalTaskForNotification,
  focusedApprovalId,
} from "../src/lib/data/approval-links.ts";
import type { AppTask } from "../src/lib/data/task-service.ts";

const task = {
  id: "leave-hr-1",
  module: "Leave",
  title: "Confirm leave request",
  description: "Review the employee's leave",
  priority: "High",
  state: "Open",
  actionLabel: "Review request",
  actionUrl: "/staff/leave-approvals",
  sourceType: "leave-request",
  sourceId: "request-1",
} satisfies AppTask;

test("approval links focus the exact request without changing direct detail links", () => {
  assert.equal(approvalActionUrl(task), "/staff/leave-approvals#review=request-1");
  assert.equal(focusedApprovalId("#review=request-1"), "request-1");
  assert.equal(
    approvalActionUrl({ actionUrl: "/staff/timesheet-approvals/record-1", sourceId: "record-1" }),
    "/staff/timesheet-approvals/record-1",
  );
  assert.equal(
    approvalActionUrl({ actionUrl: "/staff/offers", sourceId: "offer-1" }),
    "/staff/offers#review=offer-1",
  );
});

test("notifications match only the recipient's assigned approval task", () => {
  const notice = {
    type: "leave_approval",
    title: "Leave awaiting review",
    message: "Please review this leave request.",
    link: { entityType: "leave-request", entityId: "request-1", path: task.actionUrl },
  };
  assert.equal(approvalTaskForNotification(notice, [task]), task);
  assert.equal(approvalTaskForNotification(notice, []), undefined);
  assert.equal(
    approvalTaskForNotification(
      { ...notice, message: "Awaiting line manager; no HR action is required yet." },
      [task],
    ),
    undefined,
  );
  assert.equal(
    approvalTaskForNotification(
      { ...notice, link: { ...notice.link, entityType: "travel-request" } },
      [task],
    ),
    undefined,
  );
});
