import { createFileRoute } from "@tanstack/react-router";
import { Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/staff/leave")({
  component: LeaveRoute,
});

function LeaveRoute() {
  return <Navigate to="/staff/me/leave-balances" replace />;
}
