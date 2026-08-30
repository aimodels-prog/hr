import { Outlet, createFileRoute } from "@tanstack/react-router";
import { RequireAnyPermission } from "@/lib/auth";

export const Route = createFileRoute("/staff/training")({ component: TrainingLayout });

function TrainingLayout() {
  return (
    <RequireAnyPermission
      permissions={["training:manage_all", "training:view_direct_reports"]}
      resourceName="Training Records"
    >
      <Outlet />
    </RequireAnyPermission>
  );
}
