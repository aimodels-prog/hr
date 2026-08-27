import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePermission } from "@/lib/auth";

export const Route = createFileRoute("/staff/performance")({
  component: PerformanceRoute,
});

function PerformanceRoute() {
  return (
    <RequirePermission permission="performance:view_self" resourceName="Performance">
      <Outlet />
    </RequirePermission>
  );
}
