import { createFileRoute } from "@tanstack/react-router";
import { ObjectivesWorkspace } from "@/components/performance/objectives-workspace";
import { PageHeader } from "@/components/ui/page-header";
import { RequirePermission } from "@/lib/auth";

export const Route = createFileRoute("/staff/performance/goals")({ component: GoalsRoute });

function GoalsRoute() {
  return (
    <RequirePermission permission="performance:view_self" resourceName="Objectives">
      <div className="mx-auto max-w-[1200px] space-y-6 pb-10">
        <PageHeader
          title="My Objectives"
          description="Create measurable objectives and keep your manager up to date."
        />
        <ObjectivesWorkspace />
      </div>
    </RequirePermission>
  );
}
