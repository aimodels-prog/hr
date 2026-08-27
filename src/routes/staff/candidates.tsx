import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePermission } from "@/lib/auth";

export const Route = createFileRoute("/staff/candidates")({
  head: () => ({
    meta: [
      { title: "Candidates — VIA HR System" },
      {
        name: "description",
        content: "Candidate database, scoring, contact tracker, and shortlist management.",
      },
      { property: "og:title", content: "Candidates — VIA HR System" },
      { property: "og:description", content: "Repository-backed candidate database with full HR override." },
    ],
  }),
  component: CandidatesRoute,
});

function CandidatesRoute() {
  return (
    <RequirePermission
      permission="recruitment:view_candidates"
      resourceName="Candidate Database & Scoring"
    >
      <Outlet />
    </RequirePermission>
  );
}
