function normalizeCriterion(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[\s•*-]+/, "")
    .replace(/[^a-z0-9+#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanMandatoryCriteria(criteria: string[]): string[] {
  const unique = new Map<string, string>();
  for (const item of criteria) {
    const trimmed = item.trim();
    const normalized = normalizeCriterion(trimmed);
    if (normalized && !unique.has(normalized)) unique.set(normalized, trimmed);
  }
  return [...unique.values()];
}

export function findMissingMandatoryCriteria(
  mandatoryCriteria: string[],
  generatedRequirements: string[],
): string[] {
  const requirements = generatedRequirements.map(normalizeCriterion).filter(Boolean);
  return cleanMandatoryCriteria(mandatoryCriteria).filter((criterion) => {
    const normalized = normalizeCriterion(criterion);
    return !requirements.some((requirement) => requirement === normalized);
  });
}

export function ensureMandatoryCriteria(
  generatedRequirements: string[],
  mandatoryCriteria: string[],
): string[] {
  const requirements = generatedRequirements.map((item) => item.trim()).filter(Boolean);
  return [...requirements, ...findMissingMandatoryCriteria(mandatoryCriteria, requirements)];
}
