import assert from "node:assert/strict";
import test from "node:test";

import {
  buildUgandaVacancySpecs,
  parsePublicationOptions,
} from "../scripts/publish-uganda-vacancies.ts";

const ORGANISATION_ID = "aa98aa96-b498-5ca8-8d0d-da19cd34c176";

test("Uganda adverts preserve the two distinct assignments and all published requirements", () => {
  const specs = buildUgandaVacancySpecs();
  assert.deepEqual(
    specs.map(({ title, employmentType }) => ({ title, employmentType })),
    [
      { title: "Resident Engineer — Uganda", employmentType: "Project Assignment" },
      { title: "Electromechanical Engineer — Uganda", employmentType: "Freelance" },
    ],
  );
  assert.match(specs[0]!.summary, /January 2027/);
  assert.match(specs[0]!.summary, /14 person-months per regional position/);
  assert.match(specs[0]!.summary, /Site based/);
  assert.match(specs[1]!.summary, /7 person-months over 14 months/);
  assert.match(specs[1]!.summary, /On site and at home/);
  for (const spec of specs) {
    assert.match(spec.summary, /recruitment@via-int\.com/);
    assert.match(spec.summary, /apply directly/);
    assert.equal(spec.requirements.length, 5);
    assert.ok(spec.requirements.every((requirement) => requirement.trim().length > 0));
    assert.ok(spec.responsibilities.length > 0);
  }
  assert.match(specs[0]!.requirements.join(" "), /7\+ years supervising water supply/);
  assert.match(specs[0]!.requirements.join(" "), /engineering registration/);
  assert.match(specs[1]!.requirements.join(" "), /solar packages/);
  assert.match(specs[1]!.requirements.join(" "), /Sub-Saharan Africa/);
});

test("publication requires an explicit organisation and dry-run or apply mode", () => {
  assert.deepEqual(parsePublicationOptions([`--organisation-id=${ORGANISATION_ID}`, "--dry-run"]), {
    organisationId: ORGANISATION_ID,
    apply: false,
  });
  assert.deepEqual(parsePublicationOptions([`--organisation-id=${ORGANISATION_ID}`, "--apply"]), {
    organisationId: ORGANISATION_ID,
    apply: true,
  });
  for (const args of [
    [],
    [`--organisation-id=${ORGANISATION_ID}`],
    ["--organisation-id=invalid", "--apply"],
    [`--organisation-id=${ORGANISATION_ID}`, "--apply", "--dry-run"],
    [`--organisation-id=${ORGANISATION_ID}`, "--unknown"],
  ])
    assert.throws(() => parsePublicationOptions(args), /Usage/);
});
