import assert from "node:assert/strict";
import { test } from "node:test";

import {
  existingSalalahQuantitySurveyorHeadcount,
  salalahBuildingAdverts,
} from "../src/lib/recruitment/salalah-building-adverts.ts";

test("Salalah building advert drafts cover six new roles without duplicating Quantity Surveyor", () => {
  assert.equal(salalahBuildingAdverts.length, 6);
  assert.deepEqual(
    salalahBuildingAdverts.map((advert) => advert.position),
    [
      "Junior Architect",
      "Electrical Engineer",
      "Mechanical Engineer",
      "Civil Inspector",
      "Land Surveyor",
      "Document Controller",
    ],
  );
  assert.equal(existingSalalahQuantitySurveyorHeadcount, 12);
  assert.equal(
    salalahBuildingAdverts.reduce((sum, advert) => sum + advert.headcount, 0) +
      existingSalalahQuantitySurveyorHeadcount,
    75,
  );
});

test("each draft is role-specific, located in Salalah, and does not invent experience years", () => {
  for (const advert of salalahBuildingAdverts) {
    assert.match(advert.title, /— Salalah$/);
    assert.match(advert.summary, /building project in Salalah, Oman/);
    assert.ok(advert.responsibilities.length >= 3);
    assert.ok(advert.requirements.includes(advert.education));
    assert.ok(advert.requirements.includes(advert.minimumExperience));
    assert.doesNotMatch(
      `${advert.summary} ${advert.minimumExperience} ${advert.requirements.join(" ")}`,
      /\b\d+\+?\s*years?\b/i,
    );
    assert.equal(advert.headcount, advert.position === "Land Surveyor" ? 3 : 12);
  }
});
