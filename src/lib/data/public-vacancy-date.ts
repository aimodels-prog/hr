/** Show the publication day in the office timezone, not the visitor's device timezone. */
export function formatPublicVacancyPostedDate(publishedAt: string | undefined): string | null {
  if (!publishedAt) return null;
  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Muscat",
  }).format(date);
}

/** Keep the careers list newest-first even if its compatibility cache changes order. */
export function sortPublicVacanciesNewestFirst<T extends { id: string; publishedAt?: string }>(
  vacancies: readonly T[],
): T[] {
  const timestamp = (value: string | undefined) => {
    if (!value) return Number.NEGATIVE_INFINITY;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
  };
  return [...vacancies].sort((a, b) => {
    const aPublishedAt = timestamp(a.publishedAt);
    const bPublishedAt = timestamp(b.publishedAt);
    return aPublishedAt === bPublishedAt ? a.id.localeCompare(b.id) : bPublishedAt - aPublishedAt;
  });
}
