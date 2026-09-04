import * as React from "react";
import { cn } from "@/lib/utils";
import { Badge, type BadgeProps } from "./badge";

export type StatusVariant =
  | "Active"
  | "Pending"
  | "Approved"
  | "Rejected"
  | "Archived"
  | "Onboarding"
  | "Inactive"
  | "Draft"
  | "default";

interface StatusBadgeProps extends Omit<BadgeProps, "variant"> {
  status: StatusVariant | string;
}

export function StatusBadge({ status, className, ...props }: StatusBadgeProps) {
  let colorClass = "bg-secondary text-secondary-foreground hover:bg-secondary/80";
  const label =
    status === "Pending HR and Accounts"
      ? "Awaiting approvals"
      : status === "Pending Super Admin Closure"
        ? "Awaiting reimbursement review"
        : status;

  switch (status) {
    case "Active":
    case "Approved":
      colorClass = "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20";
      break;
    case "Pending":
    case "Onboarding":
    case "Draft":
      colorClass = "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20";
      break;
    case "Rejected":
    case "Inactive":
      colorClass = "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/20";
      break;
    case "Archived":
      colorClass = "bg-slate-500/15 text-slate-700 dark:text-slate-400 border-slate-500/20";
      break;
  }
  if (status.startsWith("Pending ") || status === "Pending Pre-authorisation") {
    colorClass = "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20";
  }

  return (
    <Badge variant="outline" className={cn("font-medium", colorClass, className)} {...props}>
      {label}
    </Badge>
  );
}
