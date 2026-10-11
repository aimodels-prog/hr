import assert from "node:assert/strict";
import { test } from "node:test";

import {
  findPublicVacancy,
  getPublicVacancyReference,
} from "../src/lib/data/public-vacancy-link.ts";
import type { Vacancy } from "../src/lib/data/types.ts";

const vacancy = {
  id: "legacy-director",
  databaseId: "d73be084-39ed-4185-bb3a-e0619e69ea14",
  publicSlug: "technical-director",
  status: "Open" as const,
};

test("public vacancy links prefer their stable readable reference", () => {
  assert.equal(getPublicVacancyReference(vacancy), "technical-director");
  assert.equal(
    getPublicVacancyReference({ ...vacancy, publicSlug: undefined }),
    vacancy.databaseId,
  );
  assert.equal(getPublicVacancyReference({ id: "legacy-director" }), "legacy-director");
});

test("a vacancy resolves by its readable link, UUID and legacy cache ID", () => {
  for (const reference of [vacancy.publicSlug, vacancy.databaseId, vacancy.id]) {
    assert.equal(findPublicVacancy([vacancy], reference), vacancy);
  }
  assert.equal(findPublicVacancy([vacancy], "missing-role"), undefined);
  assert.equal(findPublicVacancy([vacancy], "Technical Director"), undefined);
  assert.equal(findPublicVacancy([vacancy], `${vacancy.publicSlug}-2`), undefined);
});

test("closed, paused, draft and archived jobs never resolve publicly", () => {
  const statuses: Vacancy["status"][] = [
    "Draft",
    "Pending Approval",
    "Paused",
    "Closed",
    "Archived",
  ];
  for (const status of statuses) {
    for (const reference of [vacancy.publicSlug, vacancy.databaseId, vacancy.id]) {
      assert.equal(findPublicVacancy([{ ...vacancy, status }], reference), undefined);
    }
  }
  assert.equal(
    findPublicVacancy([{ ...vacancy, archivedAt: new Date().toISOString() }], vacancy.publicSlug),
    undefined,
  );
});

test("distinct vacancies with the same title keep separate links and application identities", () => {
  const other = {
    ...vacancy,
    id: "second-id",
    databaseId: "second-uuid",
    publicSlug: "technical-director-2",
  };
  assert.equal(findPublicVacancy([vacancy, other], "technical-director"), vacancy);
  assert.equal(findPublicVacancy([vacancy, other], "technical-director-2"), other);
  // A legacy browser ID must not shadow a different vacancy's authoritative public slug.
  assert.equal(
    findPublicVacancy([{ ...other, id: "technical-director" }, vacancy], "technical-director"),
    vacancy,
  );
});
