import { format } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A smaller date window for entry/review; submission still covers the whole month. */
export function TimesheetDayNavigation({
  days,
  page,
  onChange,
}: {
  days: Date[];
  page: number;
  onChange: (page: number) => void;
}) {
  if (days.length <= 7) return null;
  const start = page * 7;
  return (
    <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
      <Button
        variant="outline"
        size="sm"
        aria-label="Previous dates"
        disabled={page === 0}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft className="size-4" />
        <span className="hidden sm:inline">Previous</span>
      </Button>
      <span className="text-sm font-medium" aria-live="polite">
        {format(days[start]!, "d MMM")} –{" "}
        {format(days[Math.min(start + 6, days.length - 1)]!, "d MMM")}
      </span>
      <Button
        variant="outline"
        size="sm"
        aria-label="Next dates"
        disabled={start + 7 >= days.length}
        onClick={() => onChange(page + 1)}
      >
        <span className="hidden sm:inline">Next</span>
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}
