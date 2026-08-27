import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePermission } from "@/lib/auth";

export const Route = createFileRoute("/staff/travel")({
  component: TravelRoute,
});

function TravelRoute() {
  return (
    <RequirePermission permission="travel:request_self" resourceName="Travel">
      <Outlet />
    </RequirePermission>
  );
}
