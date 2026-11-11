import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPublicVacancyPostedDate,
  sortPublicVacanciesNewestFirst,
} from "../src/lib/data/public-vacancy-date.ts";

test("posted date uses the office calendar day even near UTC midnight", () => {
  assert.equal(formatPublicVacancyPostedDate("2026-11-10T21:30:00Z"), "11 Nov 2026");
  assert.equal(formatPublicVacancyPostedDate(undefined), null);
  assert.equal(formatPublicVacancyPostedDate("invalid"), null);
});

test("open positions sort by actual posting time, newest first", () => {
  const vacancies = [
    { id: "older", publishedAt: "2026-11-01T08:00:00Z" },
    { id: "missing" },
    { id: "newest", publishedAt: "2026-11-10T08:00:00Z" },
    { id: "later-on-first", publishedAt: "2026-11-01T12:00:00Z" },
  ];
  assert.deepEqual(
    sortPublicVacanciesNewestFirst(vacancies).map((vacancy) => vacancy.id),
    ["newest", "later-on-first", "older", "missing"],
  );
  assert.equal(vacancies[0]?.id, "older", "sorting must not change the source list");
});

test("positions posted at the same time have a stable order", () => {
  const when = "2026-11-10T08:00:00Z";
  const vacancies = [
    { id: "z", publishedAt: when },
    { id: "a", publishedAt: when },
  ];
  assert.deepEqual(
    sortPublicVacanciesNewestFirst(vacancies).map((vacancy) => vacancy.id),
    ["a", "z"],
  );
});
