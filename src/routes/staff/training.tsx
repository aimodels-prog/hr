import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/placeholder-page";
import { RequirePermission } from "@/lib/auth";

export const Route = createFileRoute("/staff/training")({
  component: TrainingRoute,
});

function TrainingRoute() {
  return (
    <RequirePermission permission="training:view_all" resourceName="Training">
      <PlaceholderPage
        title="Training"
        breadcrumbs={[{ label: "Talent" }, { label: "Training" }]}
      />
    </RequirePermission>
  );
}
