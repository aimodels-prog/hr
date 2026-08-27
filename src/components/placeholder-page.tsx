import * as React from "react";
import { Hammer } from "lucide-react";
import { PageHeader } from "./ui/page-header";
import { EmptyState } from "./ui/empty-state";

interface PlaceholderPageProps {
  title: string;
  description?: string;
  breadcrumbs?: { label: string; href?: string }[];
}

export function PlaceholderPage({ title, description, breadcrumbs }: PlaceholderPageProps) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={title}
        description={description || `${title} module`}
        breadcrumbs={breadcrumbs}
      />
      <EmptyState
        icon={Hammer}
        title="Not available yet"
        description="This area is not available yet."
      />
    </div>
  );
}
