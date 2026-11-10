import assert from "node:assert/strict";
import test from "node:test";

import { buildVacancySpecs, parseOptions } from "../scripts/publish-salalah-ibri-vacancies.ts";

const ORGANISATION_ID = "aa98aa96-b498-5ca8-8d0d-da19cd34c176";

test("four separate Salalah and Ibri openings are prepared without invented experience years", () => {
  const specs = buildVacancySpecs("jobs@via-int.com");
  assert.deepEqual(
    specs.map(({ title, position, location }) => ({ title, position, location })),
    [
      {
        title: "Resident Engineer – Buildings — Salalah",
        position: "Resident Engineer",
        location: "Salalah",
      },
      {
        title: "Quantity Surveyor — Salalah",
        position: "Quantity Surveyor",
        location: "Salalah",
      },
      {
        title: "Quantity Surveyor — Ibri",
        position: "Quantity Surveyor",
        location: "Ibri",
      },
      { title: "Civil Engineer — Ibri", position: "Civil Engineer", location: "Ibri" },
    ],
  );
  assert.equal(new Set(specs.map((spec) => spec.title)).size, 4);
  for (const spec of specs) {
    assert.match(spec.summary, /jobs@via-int\.com/);
    assert.match(spec.summary, /apply directly/i);
    assert.match(spec.minimumExperience, /Proven experience relevant/i);
    assert.doesNotMatch(spec.minimumExperience, /\d+\s*years?/i);
    assert.ok(spec.responsibilities.length > 0);
    assert.ok(spec.mandatoryCriteria.length > 0);
    for (const criterion of spec.mandatoryCriteria) {
      assert.ok(spec.requirements.includes(criterion));
    }
    assert.ok(spec.skills.preferred.some((item) => /Oman or GCC/i.test(item)));
    assert.ok(spec.skills.preferred.some((item) => /Arabic/i.test(item)));
    assert.ok(spec.mandatoryCriteria.every((item) => !/Arabic|GCC/i.test(item)));
  }
  assert.ok(specs[0]?.mandatoryCriteria.some((item) => /building construction/i.test(item)));
  assert.ok(
    specs.slice(1).every((spec) => !spec.mandatoryCriteria.some((item) => /building/i.test(item))),
  );
});

test("publisher requires explicit organisation, mode, and a VIA application address", () => {
  assert.deepEqual(
    parseOptions([
      `--organisation-id=${ORGANISATION_ID}`,
      "--application-email=JOBS@VIA-INT.COM",
      "--dry-run",
    ]),
    {
      organisationId: ORGANISATION_ID,
      applicationEmail: "jobs@via-int.com",
      apply: false,
    },
  );
  assert.equal(parseOptions([`--organisation-id=${ORGANISATION_ID}`, "--apply"]).apply, true);
  for (const args of [
    [],
    [`--organisation-id=${ORGANISATION_ID}`],
    [`--organisation-id=${ORGANISATION_ID}`, "--apply", "--dry-run"],
    ["--organisation-id=not-a-uuid", "--dry-run"],
    [`--organisation-id=${ORGANISATION_ID}`, "--application-email=other@example.com", "--apply"],
    [`--organisation-id=${ORGANISATION_ID}`, "--apply", "--application-email="],
    [`--organisation-id=${ORGANISATION_ID}`, "--apply", "--unknown=1"],
  ]) {
    assert.throws(() => parseOptions(args), /Usage/);
  }
});
