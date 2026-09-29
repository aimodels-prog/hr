import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOrganisationForest } from "../src/lib/data/org-chart-layout.ts";

test("company head is placed first without changing anyone's supervisor", () => {
  const people = [
    { id: "a", preferredName: "Adam" },
    { id: "h", preferredName: "Zara", lineManagerId: "a" },
    { id: "t", preferredName: "Team", lineManagerId: "h" },
  ];
  const before = JSON.stringify(people);
  const chart = buildOrganisationForest(people, "h");
  assert.equal(chart.head?.id, "h");
  assert.deepEqual(
    chart.children.get("h")?.map((person) => person.id),
    ["t"],
  );
  assert.equal(chart.children.get("a"), undefined);
  assert.equal(JSON.stringify(people), before);
  assert.deepEqual(
    chart.roots.map((person) => person.id),
    ["a", "h"],
  );
});
test("a cycle or missing supervisor cannot hide employees or recurse forever", () => {
  const chart = buildOrganisationForest(
    [
      { id: "a", preferredName: "A", lineManagerId: "b" },
      { id: "b", preferredName: "B", lineManagerId: "a" },
      { id: "c", preferredName: "C", lineManagerId: "missing" },
    ],
    null,
  );
  const visited = new Set<string>();
  const visit = (id: string) => {
    assert.equal(visited.has(id), false);
    visited.add(id);
    chart.children.get(id)?.forEach((person) => visit(person.id));
  };
  chart.roots.forEach((person) => visit(person.id));
  assert.equal(visited.size, 3);
});
test("missing company head falls back to existing reporting trees", () => {
  const chart = buildOrganisationForest([{ id: "a", preferredName: "A" }], "archived");
  assert.equal(chart.head, null);
  assert.equal(chart.roots[0]?.id, "a");
});
