export interface ChartPerson {
  id: string;
  lineManagerId?: string | null | undefined;
  preferredName: string;
}

/** Build a display forest without mutating reporting relationships. Break corrupt cycles. */
export function buildOrganisationForest<T extends ChartPerson>(people: T[], headId: string | null) {
  const byId = new Map(people.map((person) => [person.id, person]));
  const parents = new Map<string, string>();
  for (const person of people) {
    if (person.id === headId || !person.lineManagerId || !byId.has(person.lineManagerId)) continue;
    const seen = new Set([person.id]);
    let cursor: string | undefined = person.lineManagerId;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      cursor = parents.get(cursor);
    }
    if (!cursor) parents.set(person.id, person.lineManagerId);
  }
  const children = new Map<string, T[]>();
  for (const person of people) {
    const parent = parents.get(person.id);
    if (parent) children.set(parent, [...(children.get(parent) ?? []), person]);
  }
  const compare = (a: T, b: T) => a.preferredName.localeCompare(b.preferredName);
  for (const siblings of children.values()) siblings.sort(compare);
  return {
    children,
    roots: people.filter((person) => !parents.has(person.id)).sort(compare),
    head: headId ? (byId.get(headId) ?? null) : null,
  };
}
