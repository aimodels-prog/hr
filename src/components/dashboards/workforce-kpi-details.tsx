import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { WorkforceAnalytics } from "@/lib/data/workforce-analytics";

export type WorkforceKpi = "current" | "recorded" | "leave" | "approvals";

const titles: Record<WorkforceKpi, string> = {
  current: "Current employees",
  recorded: "Attendance recorded today",
  leave: "On leave today",
  approvals: "Pending across company",
};

export function WorkforceKpiDetails({
  kind,
  data,
  onClose,
}: {
  kind: WorkforceKpi;
  data: WorkforceAnalytics;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const people =
    kind === "approvals" ? [] : (data.dashboardPeople?.[kind === "leave" ? "onLeave" : kind] ?? []);
  const visiblePeople = people.filter((person) =>
    `${person.name} ${person.department} ${person.office}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titles[kind]}</DialogTitle>
          <DialogDescription>
            {kind === "approvals"
              ? "Organisation-wide decisions by responsible team. Some are not assigned to HR."
              : `${data.today.date} · ${people.length} ${people.length === 1 ? "person" : "people"}`}
          </DialogDescription>
        </DialogHeader>
        {kind === "approvals" ? (
          <div className="space-y-2">
            {data.priorities.approvals.length ? (
              data.priorities.approvals.map((item) => (
                <div
                  key={item.name}
                  className="flex min-h-12 items-center justify-between rounded-lg border px-4 py-3 text-sm"
                >
                  <span>{item.name}</span>
                  <span className="font-semibold tabular-nums">{item.count}</span>
                </div>
              ))
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No decisions are waiting.
              </p>
            )}
            <Button asChild variant="outline" className="mt-2 w-full">
              <Link to="/staff/requests" search={{ view: "organisation" }} onClick={onClose}>
                Browse employee requests
              </Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {people.length > 8 && (
              <Input
                type="search"
                aria-label="Search people in this list"
                placeholder="Search by name, department or office"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            )}
            <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
              {visiblePeople.map((person) => (
                <Link
                  key={person.id}
                  to="/staff/employees/$employeeId"
                  params={{ employeeId: person.id }}
                  hash={kind === "recorded" ? "attendance" : kind === "leave" ? "leave" : ""}
                  onClick={onClose}
                  className="flex min-h-14 items-center justify-between gap-3 rounded-lg border px-4 py-2 hover:border-primary hover:bg-primary/5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{person.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {person.department} · {person.office}
                    </span>
                  </span>
                  <ArrowUpRight className="size-4 shrink-0 text-primary" aria-hidden="true" />
                </Link>
              ))}
              {!visiblePeople.length && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {query ? "No matching people." : "No people in this group today."}
                </p>
              )}
            </div>
            {kind === "recorded" && (
              <Button asChild variant="outline" className="w-full">
                <Link
                  to="/staff/attendance"
                  search={{ date: data.today.date, status: "All", location: "all" }}
                  onClick={onClose}
                >
                  Open full daily roster
                </Link>
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
