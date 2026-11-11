import { CalendarDays } from "lucide-react";

import { formatPublicVacancyPostedDate } from "@/lib/data/public-vacancy-date";

export function PublicVacancyPostedDate({
  publishedAt,
  className,
}: {
  publishedAt: string | undefined;
  className: string;
}) {
  const formatted = formatPublicVacancyPostedDate(publishedAt);
  if (!publishedAt || !formatted) return null;
  return (
    <span className={className}>
      <CalendarDays className="h-4 w-4" aria-hidden="true" />
      <time dateTime={publishedAt}>Posted {formatted}</time>
    </span>
  );
}
