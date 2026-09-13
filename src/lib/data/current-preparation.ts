export function latestPreparationPerCandidate<
  T extends { id: string; candidateId: string; createdAt: Date; status: string },
>(runs: T[]): Map<string, T> {
  const latest = new Map<string, T>();
  for (const run of [...runs].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
  )) {
    if (!latest.has(run.candidateId)) latest.set(run.candidateId, run);
  }
  return new Map([...latest].filter(([, run]) => ["Ready", "Needs Review"].includes(run.status)));
}
