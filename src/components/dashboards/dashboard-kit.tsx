import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------- Attention Queue ----------

export type AttentionItem = {
  id: string;
  severity: "critical" | "warning" | "info";
  icon: LucideIcon;
  title: string;
  meta: string;
  actionLabel: string;
  actionTo: string;
};

const stripeBySeverity: Record<AttentionItem["severity"], string> = {
  critical: "bg-destructive",
  warning: "bg-warning",
  info: "bg-primary",
};

const iconBadgeBySeverity: Record<AttentionItem["severity"], string> = {
  critical: "bg-destructive/10 text-destructive",
  warning: "bg-warning/15 text-warning",
  info: "bg-primary/10 text-primary",
};

export function AttentionQueue({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <Card className="flex items-center gap-3 rounded-xl p-4 shadow-sm text-muted-foreground">
        <CheckCircle2 className="h-5 w-5" />
        <span className="text-sm">Nothing needs attention right now.</span>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Card
            key={item.id}
            // overflow-hidden keeps the left accent stripe flush with the rounded corners
            className="flex items-start gap-3 overflow-hidden rounded-xl p-0 shadow-sm sm:items-center"
          >
            <span className={cn("h-full w-1 self-stretch", stripeBySeverity[item.severity])} />
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                iconBadgeBySeverity[item.severity],
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1 py-2.5">
              <span className="block text-sm font-medium sm:truncate">{item.title}</span>
              <span className="block text-xs text-muted-foreground sm:truncate">{item.meta}</span>
            </span>
            <span className="shrink-0 pr-3">
              <Button
                asChild
                size="sm"
                variant={item.severity === "critical" ? "destructive" : "outline"}
                className="rounded-full"
              >
                <Link to={item.actionTo}>{item.actionLabel}</Link>
              </Button>
            </span>
          </Card>
        );
      })}
    </div>
  );
}

// ---------- Pulse Strip ----------

export type PulseMetric = {
  label: string;
  value: string;
  deltaDirection?: "up" | "down" | "flat";
  deltaText?: string;
  note?: string;
};

const deltaColorByDirection: Record<NonNullable<PulseMetric["deltaDirection"]>, string> = {
  up: "text-success",
  down: "text-destructive",
  flat: "text-muted-foreground",
};

const deltaArrowByDirection: Record<NonNullable<PulseMetric["deltaDirection"]>, string> = {
  up: "↑",
  down: "↓",
  flat: "–",
};

export function PulseStrip({ metrics }: { metrics: PulseMetric[] }) {
  const desktopColumns =
    metrics.length === 7
      ? "xl:grid-cols-7"
      : metrics.length >= 8
        ? "xl:grid-cols-4"
        : "xl:grid-cols-6";

  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3",
        desktopColumns,
      )}
    >
      {metrics.map((metric, index) => (
        <div key={index} className="bg-card px-3 py-2.5">
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {metric.label}
          </p>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-lg font-bold tabular-nums">{metric.value}</span>
            {metric.deltaDirection ? (
              <span
                className={cn("text-xs font-medium", deltaColorByDirection[metric.deltaDirection])}
              >
                {deltaArrowByDirection[metric.deltaDirection]} {metric.deltaText}
              </span>
            ) : null}
          </div>
          {metric.note ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{metric.note}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ---------- Dashboard Panel ----------

export function DashboardPanel({
  title,
  description,
  viewAllLabel,
  viewAllTo,
  className,
  children,
}: {
  title: string;
  description?: string;
  viewAllLabel?: string;
  viewAllTo?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn("rounded-xl p-4 shadow-sm", className)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {viewAllLabel && viewAllTo ? (
          <Link to={viewAllTo} className="text-xs font-medium text-primary hover:underline">
            {viewAllLabel}
          </Link>
        ) : null}
      </div>
      <div className="mt-3">{children}</div>
    </Card>
  );
}

// ---------- Compact distribution bars ----------

export type BreakdownItem = {
  label: string;
  value: number;
  detail?: string;
};

export function BreakdownBars({
  items,
  emptyMessage = "No data available yet.",
}: {
  items: BreakdownItem[];
  emptyMessage?: string;
}) {
  if (items.length === 0) {
    return <p className="py-5 text-center text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  const maximum = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label}>
          <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
            <span className="truncate font-medium">{item.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {item.value}
              {item.detail ? ` · ${item.detail}` : ""}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full min-w-1 rounded-full bg-primary transition-[width]"
              style={{ width: `${Math.max((item.value / maximum) * 100, 3)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProgressRing({ value, label }: { value: number; label: string }) {
  const safeValue = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-3">
      <div
        className="grid h-14 w-14 shrink-0 place-items-center rounded-full"
        style={{
          background: `conic-gradient(var(--primary) ${safeValue * 3.6}deg, var(--muted) 0deg)`,
        }}
      >
        <div className="grid h-10 w-10 place-items-center rounded-full bg-card text-xs font-bold tabular-nums">
          {Math.round(safeValue)}%
        </div>
      </div>
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted-foreground">Overall completion</p>
      </div>
    </div>
  );
}
