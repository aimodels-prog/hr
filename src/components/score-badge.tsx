import { cn } from "@/lib/utils";

export function ScoreBadge({ score, className }: { score: number; className?: string }) {
  const tone =
    score >= 88
      ? "bg-success/12 text-success border-success/30"
      : score >= 78
        ? "bg-primary/10 text-primary border-primary/25"
        : "bg-muted text-muted-foreground border-border";

  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1 rounded-md border px-2 py-1 font-display text-sm font-semibold tabular-nums",
        tone,
        className,
      )}
    >
      {score}
      <span className="text-[10px] font-medium opacity-60">/100</span>
    </span>
  );
}
