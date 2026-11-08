import assert from "node:assert/strict";
import test from "node:test";

import { newlyArrivedUnread } from "../src/lib/data/notification-popup.ts";

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
