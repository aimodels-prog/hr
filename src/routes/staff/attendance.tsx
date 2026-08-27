import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePermission } from "@/lib/auth";

export const Route = createFileRoute("/staff/attendance")({
  component: AttendanceRoute,
});

function AttendanceRoute() {
  return (
    <RequirePermission permission="attendance:view_self" resourceName="Attendance">
      <Outlet />
    </RequirePermission>
  );
}
