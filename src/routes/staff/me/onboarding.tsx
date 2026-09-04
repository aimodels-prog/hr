import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/ui/page-header";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { SelfServiceOnboardingForm } from "@/components/onboarding/self-service-onboarding-form";

export const Route = createFileRoute("/staff/me/onboarding")({
  component: MyOnboardingRoute,
});

function MyOnboardingRoute() {
  const { currentEmployee } = useCurrentUser();

  return (
    <RequirePermission permission="onboarding:view_self" resourceName="My Setup">
      <div className="flex flex-col gap-6 max-w-3xl mx-auto pb-10">
        <PageHeader
          title="My Employee Setup"
          description="Confirm your employment information and keep your personal records and required documents complete."
          breadcrumbs={[{ label: "Overview" }, { label: "My Employee Setup" }]}
        />
        {currentEmployee ? (
          <SelfServiceOnboardingForm employeeId={currentEmployee.id} />
        ) : (
          <div className="p-8 text-center text-muted-foreground">
            No employee record is linked to your account.
          </div>
        )}
      </div>
    </RequirePermission>
  );
}
