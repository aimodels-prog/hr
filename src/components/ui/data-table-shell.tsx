import * as React from "react";
import { cn } from "@/lib/utils";

export interface DataTableShellProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function DataTableShell({ children, className, ...props }: DataTableShellProps) {
  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-xl border border-border/70 bg-card text-card-foreground",
        className,
      )}
      {...props}
    >
      <div className="relative w-full overflow-auto">{children}</div>
    </div>
  );
}
