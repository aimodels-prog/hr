import assert from "node:assert/strict";
import test from "node:test";

import {
  approvalActionUrl,
  approvalTaskForNotification,
  focusedApprovalId,
  leaveRequestHistoryUrl,
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

test("resolved leave notifications open an authorised exact request detail", () => {
  assert.equal(leaveRequestHistoryUrl("leave-1"), "/staff/request-detail/Leave/leave-1");
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

test("booking notifications identify the exact arrangement on a shared trip", () => {
  const first = {
    ...task,
    id: "travel-booking-accounts-booking-1",
    sourceType: "travel-request",
    sourceId: "trip-1",
    actionUrl: "/staff/travel/trip-1#booking-booking-1",
  } satisfies AppTask;
  const second = {
    ...first,
    id: "travel-booking-accounts-booking-2",
    actionUrl: "/staff/travel/trip-1#booking-booking-2",
  } satisfies AppTask;
  const notice = {
    type: "Travel",
    title: "Travel arrangement needs Finance approval",
    message: "Review the car arrangement.",
    link: {
      entityType: "travel-request",
      entityId: "trip-1",
      path: "/staff/travel/trip-1#booking-booking-2",
    },
  };
  assert.equal(approvalTaskForNotification(notice, [first, second]), second);
  assert.equal(approvalTaskForNotification(notice, [first]), undefined);
  assert.equal(approvalActionUrl(second), second.actionUrl);
});
