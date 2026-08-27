import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/staff/payroll")({
  component: PayrollRoute,
});

function PayrollRoute() {
  return <Outlet />;
}
