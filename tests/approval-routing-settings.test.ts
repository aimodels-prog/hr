import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_APPROVAL_ROUTING_SETTINGS,
  parseApprovalRoutingSettings,
} from "../src/lib/data/approval-routing-settings.ts";

test("approval routing uses safe defaults until a reviewer is explicitly chosen", () => {
  for (const input of [undefined, null, {}, [], "old setting"]) {
    assert.deepEqual(parseApprovalRoutingSettings(input), DEFAULT_APPROVAL_ROUTING_SETTINGS);
  }
});

test("approval routing preserves configurable reviewer, travel, and attendance choices", () => {
  assert.deepEqual(
    parseApprovalRoutingSettings({
      hrOwnRequestReviewerEmployeeId: "7d6b1d9f-a307-4726-93f0-f8caf7c57a78",
      managerlessExecutiveTravelReviewerRole: "HR",
      managerlessExecutiveTravelNotifyHr: false,
      managerlessExecutiveAttendanceReviewerEmployeeId: "77fc9101-d90f-45e4-bac7-fe46ed80be07",
    }),
    {
      hrOwnRequestReviewerEmployeeId: "7d6b1d9f-a307-4726-93f0-f8caf7c57a78",
      managerlessExecutiveTravelReviewerRole: "HR",
      managerlessExecutiveTravelNotifyHr: false,
      managerlessExecutiveAttendanceReviewerEmployeeId: "77fc9101-d90f-45e4-bac7-fe46ed80be07",
    },
  );
});

test("unrecognised travel roles cannot silently become an approver", () => {
  assert.deepEqual(
    parseApprovalRoutingSettings({
      hrOwnRequestReviewerEmployeeId: "",
      managerlessExecutiveTravelReviewerRole: "Super Admin",
      managerlessExecutiveTravelNotifyHr: true,
      managerlessExecutiveAttendanceReviewerEmployeeId: "",
    }),
    DEFAULT_APPROVAL_ROUTING_SETTINGS,
  );
});
