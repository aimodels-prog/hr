import * as React from "react";
import { cn } from "@/lib/utils";

export interface DataTableShellProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function DataTableShell({ children, className, ...props }: DataTableShellProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border/80 bg-card text-card-foreground shadow-[0_12px_38px_-32px_oklch(0.3_0.1_253/0.4)]",
        className,
      )}
      {...props}
    >
      <div className="relative w-full overflow-auto">{children}</div>
    </div>
  );
}
