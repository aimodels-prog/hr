import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesSearch } from "../src/lib/search-options.ts";

test("people search supports partial names, accents, email and employee numbers", () => {
  assert.equal(matchesSearch("emma", "Emmanuel Musa"), true);
  assert.equal(matchesSearch("musa emma", "Emmanuel Musa"), true);
  assert.equal(matchesSearch("JOSE", "José Silva"), true);
  assert.equal(matchesSearch("e017", "Emmanuel", "E017", "emmanuel@example.test"), true);
  assert.equal(matchesSearch("example.test", "Emmanuel", "emmanuel@example.test"), true);
  assert.equal(matchesSearch(" ", "Emmanuel"), true);
  assert.equal(matchesSearch("Emmanuel Finance", "Emmanuel HR"), false);
});

test("100+ people can be searched without truncation or treating duplicate names as IDs", () => {
  const people = Array.from({ length: 150 }, (_, index) => ({
    id: `id-${index}`,
    name: "Alex",
    number: `VIA-${index}`,
  }));
  const results = people.filter((person) =>
    matchesSearch("via-149 alex", person.name, person.number),
  );
  assert.deepEqual(
    results.map((person) => person.id),
    ["id-149"],
  );
  assert.equal(people.filter((person) => matchesSearch("Alex", person.name)).length, 150);
});
