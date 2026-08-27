import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/staff/offboarding")({
  component: OffboardingRoute,
});

function OffboardingRoute() {
  return <Outlet />;
}
