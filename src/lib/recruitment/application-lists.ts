export type ApplicationList = "review" | "shortlisted" | "interview" | "other";

export function applicationList(
  status: string,
  recommendationStatuses: readonly string[],
): ApplicationList {
  if (["Offered", "Hired", "Rejected", "Withdrawn"].includes(status)) return "other";
  if (
    status === "Interviewing" ||
    recommendationStatuses.some((value) =>
      ["Ready to Schedule", "Interview Scheduled"].includes(value),
    )
  )
    return "interview";
  if (status === "Shortlisted") return "shortlisted";
  if (status === "New" || status === "On Hold") return "review";
  return "other";
}
