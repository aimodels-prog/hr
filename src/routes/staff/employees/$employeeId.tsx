import { createFileRoute, useParams } from "@tanstack/react-router";
import { RequirePermission } from "@/lib/auth";
import { EmployeeProfileView } from "./-profile/employee-profile-view";

export const Route = createFileRoute("/staff/employees/$employeeId")({
  component: EmployeeProfileRoute,
});

function EmployeeProfileRoute() {
  const { employeeId } = useParams({ from: "/staff/employees/$employeeId" });

  return (
    <RequirePermission permission="employee:view_directory" resourceName="Employee Profile">
      <EmployeeProfileView employeeId={employeeId} />
    </RequirePermission>
  );
}
