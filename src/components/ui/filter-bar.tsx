import * as React from "react";
import { cn } from "@/lib/utils";

export interface FilterBarProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function FilterBar({ children, className, ...props }: FilterBarProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
