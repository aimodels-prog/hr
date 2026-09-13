import assert from "node:assert/strict";
import test from "node:test";
import { validateManualOfferDelivery } from "../src/lib/auth/offer-delivery.ts";
const delivery = {
  recipientEmail: "candidate@example.com",
  sentAt: "2026-01-01T10:00:00Z",
  evidenceReference: "<sent-message-123@example.com>",
  confirmed: true,
};
test("Sent requires attested manual dispatch with evidence and the correct recipient", () => {
  assert.throws(() => validateManualOfferDelivery(undefined, delivery.recipientEmail));
  assert.throws(() =>
    validateManualOfferDelivery({ ...delivery, confirmed: false }, delivery.recipientEmail),
  );
  assert.throws(() =>
    validateManualOfferDelivery(
      { ...delivery, evidenceReference: "I sent it" },
      delivery.recipientEmail,
    ),
  );
  assert.throws(() => validateManualOfferDelivery(delivery, "other@example.com"));
  assert.throws(() =>
    validateManualOfferDelivery({ ...delivery, sentAt: "2999-01-01" }, delivery.recipientEmail),
  );
  assert.equal(
    validateManualOfferDelivery(delivery, delivery.recipientEmail).evidenceReference,
    delivery.evidenceReference,
  );
});
