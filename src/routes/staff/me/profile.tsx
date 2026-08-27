import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { EmployeeProfileView } from "../employees/-profile/employee-profile-view";

export const Route = createFileRoute("/staff/me/profile")({
  component: MyProfileRoute,
});

function MyProfileRoute() {
  const { currentEmployee } = useCurrentUser();

  return (
    <RequirePermission permission="employee:view_self" resourceName="My Profile">
      {currentEmployee ? (
        <EmployeeProfileView employeeId={currentEmployee.id} />
      ) : (
        <div className="p-8 text-center text-muted-foreground">
          No employee record is linked to your account.
        </div>
      )}
    </RequirePermission>
  );
}
