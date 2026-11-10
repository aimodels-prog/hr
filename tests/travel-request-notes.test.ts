import { strict as assert } from "node:assert";
import { test } from "node:test";
import { travelRequestNotes } from "../src/lib/data/travel-request-notes.ts";

test("travel request keeps VIA booking intent and free-text notes for reviewers", () => {
  assert.equal(
    travelRequestNotes(true, "  Flight to Muscat  "),
    "VIA booking requested after trip approval. A separate booking request is still required.\n\nFlight to Muscat",
  );
});

test("self-booked travel keeps optional reimbursement estimate context", () => {
  assert.equal(
    travelRequestNotes(false, ""),
    "No VIA booking requested. Estimated costs, if any, may be claimed after the trip.",
  );
});
