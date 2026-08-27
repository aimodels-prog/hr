import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/placeholder-page";
import { RequirePermission } from "@/lib/auth";

export const Route = createFileRoute("/staff/leave")({
  component: LeaveRoute,
});

function LeaveRoute() {
  return (
    <RequirePermission permission="leave:view_self" resourceName="Leave">
      <PlaceholderPage
        title="Leave"
        breadcrumbs={[{ label: "Time & Travel" }, { label: "Leave" }]}
      />
    </RequirePermission>
  );
}
