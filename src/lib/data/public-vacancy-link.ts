import type { Vacancy } from "./types.ts";

type LinkableVacancy = Pick<Vacancy, "id" | "databaseId" | "publicSlug">;
type PublicVacancy = LinkableVacancy & Pick<Vacancy, "status" | "archivedAt">;

export function getPublicVacancyReference(vacancy: LinkableVacancy): string {
  return vacancy.publicSlug || vacancy.databaseId || vacancy.id;
}

/** Keep old UUID and browser-cache links valid without exposing closed vacancies. */
export function findPublicVacancy<T extends PublicVacancy>(
  vacancies: readonly T[],
  reference: string,
): T | undefined {
  const open = vacancies.filter((vacancy) => vacancy.status === "Open" && !vacancy.archivedAt);
  return (
    open.find((vacancy) => vacancy.publicSlug === reference) ??
    open.find((vacancy) => vacancy.databaseId === reference || vacancy.id === reference)
  );
}
