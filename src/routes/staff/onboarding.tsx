import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePermission } from "@/lib/auth";

export const Route = createFileRoute("/staff/onboarding")({
  component: OnboardingRoute,
});

function OnboardingRoute() {
  return (
    <RequirePermission permission="onboarding:view_self" resourceName="Onboarding">
      <Outlet />
    </RequirePermission>
  );
}
