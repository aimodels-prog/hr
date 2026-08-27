import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/placeholder-page";
import { RequirePermission } from "@/lib/auth";

export const Route = createFileRoute("/staff/documents")({
  component: DocumentsRoute,
});

function DocumentsRoute() {
  return (
    <RequirePermission permission="document:view_all" resourceName="Document Expiry">
      <PlaceholderPage
        title="Document Expiry"
        breadcrumbs={[{ label: "Core HR" }, { label: "Document Expiry" }]}
      />
    </RequirePermission>
  );
}
