import * as React from "react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "page-grid flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-dashed border-primary/20 bg-card p-8 text-center animate-in fade-in-50",
        className,
      )}
      {...props}
    >
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/10 bg-primary/5 shadow-sm">
        <Icon className="h-6 w-6 text-primary" />
      </div>
      <h3 className="mt-4 text-lg font-semibold">{title}</h3>
      <p className="mb-4 mt-2 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action && <div>{action}</div>}
    </div>
  );
}
