import { createFileRoute } from "@tanstack/react-router";
import { UserManagementPanel } from "@/components/settings/user-management-panel";
import { PageHeader } from "@/components/ui/page-header";
import { RequirePermission } from "@/lib/auth";

export const Route = createFileRoute("/staff/users")({
  component: UsersRoute,
});

function UsersRoute() {
  return (
    <RequirePermission permission="system:users_manage" resourceName="User Management">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <PageHeader
          title="User Management"
          description="Manage who can access each part of VIA HR System."
          breadcrumbs={[{ label: "People" }, { label: "User Management" }]}
        />
        <UserManagementPanel />
      </div>
    </RequirePermission>
  );
}
