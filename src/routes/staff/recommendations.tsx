import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePermission } from "@/lib/auth";

export const Route = createFileRoute("/staff/recommendations")({
  component: RecommendationsRoute,
});

function RecommendationsRoute() {
  return (
    <RequirePermission permission="recruitment:view_candidates" resourceName="Recommendations">
      <Outlet />
    </RequirePermission>
  );
}
