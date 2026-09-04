import { createFileRoute } from "@tanstack/react-router";

import { LeavePolicyConfig } from "@/components/settings/leave-policy-config";
import { PageHeader } from "@/components/ui/page-header";
import { RequirePermission } from "@/lib/auth";

export const Route = createFileRoute("/staff/leave-policies")({
  component: LeavePoliciesRoute,
});

function LeavePoliciesRoute() {
  return (
    <RequirePermission permission="leave:admin_all" resourceName="Leave Policies">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <PageHeader
          title="Leave Policies"
          description="Manage leave allowances, eligibility, evidence and notice rules."
          breadcrumbs={[{ label: "Time & Travel" }, { label: "Leave Policies" }]}
        />
        <LeavePolicyConfig />
      </div>
    </RequirePermission>
  );
}
