import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { getScopedEmployeesWithAncestors } from "@/lib/auth/record-scope";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmployeeService } from "@/lib/data/employee-service";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, Search, Users } from "lucide-react";
import type { Employee } from "@/lib/data/types";

export const Route = createFileRoute("/staff/org-chart")({
  component: OrgChartRoute,
});

function initialsFor(employee: Employee): string {
  return (employee.preferredName || employee.legalName)
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function matchesSearch(employee: Employee, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    employee.preferredName.toLowerCase().includes(q) ||
    employee.legalName.toLowerCase().includes(q) ||
    employee.position.toLowerCase().includes(q) ||
    employee.department.toLowerCase().includes(q) ||
    employee.employeeNumber.toLowerCase().includes(q)
  );
}

// Matches the manager-loop circuit breaker already used in employee-service.ts's
// validateHierarchy - a defensive bound, not an expected depth.
const MAX_ANCESTOR_HOPS = 100;

function OrgChartRoute() {
  const currentUser = useCurrentUser();
  const employeeService = useMemo(() => new EmployeeService(), []);
  const allEmployees = employeeService.getEmployeeRepository().list({ includeArchived: false });

  const visibleList = useMemo(
    () => getScopedEmployeesWithAncestors(allEmployees, currentUser),
    [allEmployees, currentUser],
  );
  const visible = useMemo(() => new Map(visibleList.map((e) => [e.id, e])), [visibleList]);

  const childrenByManager = useMemo(() => {
    const map = new Map<string, Employee[]>();
    for (const employee of visible.values()) {
      if (!employee.lineManagerId || !visible.has(employee.lineManagerId)) continue;
      const siblings = map.get(employee.lineManagerId) ?? [];
      siblings.push(employee);
      map.set(employee.lineManagerId, siblings);
    }
    for (const siblings of map.values()) {
      siblings.sort((a, b) => a.preferredName.localeCompare(b.preferredName));
    }
    return map;
  }, [visible]);

  // Real report counts, from the full company - not just what this viewer's scope shows -
  // so a manager never looks like they have fewer reports than they really do.
  const totalReportsByManager = useMemo(() => {
    const map = new Map<string, number>();
    for (const employee of allEmployees) {
      if (!employee.lineManagerId) continue;
      map.set(employee.lineManagerId, (map.get(employee.lineManagerId) ?? 0) + 1);
    }
    return map;
  }, [allEmployees]);

  const roots = useMemo(
    () =>
      [...visible.values()]
        .filter((employee) => !employee.lineManagerId || !visible.has(employee.lineManagerId))
        .sort((a, b) => a.preferredName.localeCompare(b.preferredName)),
    [visible],
  );

  const [query, setQuery] = useState("");

  // While searching, prune the tree to matches plus the path down to them (ancestors) and
  // their own team (descendants), instead of flattening the whole chart into a plain list.
  const keepIds = useMemo(() => {
    if (!query.trim()) return null;
    const keep = new Set<string>();
    for (const employee of visible.values()) {
      if (!matchesSearch(employee, query)) continue;
      keep.add(employee.id);
      let current: Employee | undefined = employee;
      let hops = 0;
      while (current?.lineManagerId && hops < MAX_ANCESTOR_HOPS) {
        keep.add(current.lineManagerId);
        current = visible.get(current.lineManagerId);
        hops += 1;
      }
      const stack = [...(childrenByManager.get(employee.id) ?? [])];
      while (stack.length > 0) {
        const next = stack.pop()!;
        keep.add(next.id);
        stack.push(...(childrenByManager.get(next.id) ?? []));
      }
    }
    return keep;
  }, [query, visible, childrenByManager]);

  const totalVisible = visible.size;
  const totalCompany = allEmployees.length;
  const visibleRoots = roots.filter((root) => !keepIds || keepIds.has(root.id));
  const noSearchMatches = query.trim().length > 0 && keepIds?.size === 0;

  return (
    <RequirePermission permission="employee:view_directory" resourceName="Organisation Chart">
      <div className="flex flex-col gap-6 max-w-[1400px] mx-auto pb-10">
        <PageHeader
          title="Organisation Chart"
          description="Reporting lines across VIA, built from each employee's line manager."
          breadcrumbs={[{ label: "Core HR" }, { label: "Organisation Chart" }]}
        />

        <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-card p-4 shadow-sm">
          <div className="relative flex-1 min-w-[250px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, position, or department..."
              className="pl-9 bg-background"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {totalVisible < totalCompany && (
            <p className="text-xs text-muted-foreground max-w-md">
              Showing your reporting line ({totalVisible} of {totalCompany} employees). HR and Super
              Admin see the full company chart.
            </p>
          )}
        </div>

        <Card className="p-6 overflow-x-auto">
          {visibleRoots.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground">
              {noSearchMatches
                ? "No one in your reporting line matches that search."
                : "No reporting line is visible to you yet."}
            </p>
          ) : (
            <div className="flex flex-col gap-2 min-w-[520px]">
              {visibleRoots.map((root) => (
                <OrgChartNode
                  key={root.id}
                  employee={root}
                  childrenByManager={childrenByManager}
                  totalReportsByManager={totalReportsByManager}
                  keepIds={keepIds}
                  query={query}
                  currentEmployeeId={currentUser?.employeeId}
                  depth={0}
                />
              ))}
            </div>
          )}
        </Card>
      </div>
    </RequirePermission>
  );
}

function OrgChartNode({
  employee,
  childrenByManager,
  totalReportsByManager,
  keepIds,
  query,
  currentEmployeeId,
  depth,
}: {
  employee: Employee;
  childrenByManager: Map<string, Employee[]>;
  totalReportsByManager: Map<string, number>;
  keepIds: Set<string> | null;
  query: string;
  currentEmployeeId: string | undefined;
  depth: number;
}) {
  const allScopedChildren = childrenByManager.get(employee.id) ?? [];
  const children = allScopedChildren.filter((child) => !keepIds || keepIds.has(child.id));
  const totalReports = totalReportsByManager.get(employee.id) ?? 0;
  const hiddenReports = totalReports - allScopedChildren.length;
  const [expanded, setExpanded] = useState(true);
  const isMatch = matchesSearch(employee, query);
  const isSelf = currentEmployeeId === employee.id;

  return (
    <div className="flex flex-col">
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border p-3 bg-card",
          isSelf && "border-primary bg-primary/5",
          isMatch && "ring-2 ring-amber-400",
        )}
        style={{ marginLeft: depth * 28 }}
      >
        {children.length > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="text-muted-foreground hover:text-foreground"
            aria-label={expanded ? "Collapse team" : "Expand team"}
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          {initialsFor(employee)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/staff/employees/$employeeId"
              params={{ employeeId: employee.id }}
              className="font-medium hover:underline"
            >
              {employee.preferredName}
            </Link>
            {isSelf && <span className="text-xs text-primary">(You)</span>}
            <StatusBadge status={employee.status} />
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {employee.position} &bull; {employee.department}
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 gap-1">
          <Users className="h-3 w-3" />
          {totalReports}
        </Badge>
      </div>
      {expanded && children.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          {children.map((child) => (
            <OrgChartNode
              key={child.id}
              employee={child}
              childrenByManager={childrenByManager}
              totalReportsByManager={totalReportsByManager}
              keepIds={keepIds}
              query={query}
              currentEmployeeId={currentEmployeeId}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
      {expanded && hiddenReports > 0 && (
        <p
          className="mt-1 text-xs text-muted-foreground"
          style={{ marginLeft: (depth + 1) * 28 + 40 }}
        >
          +{hiddenReports} more direct report{hiddenReports === 1 ? "" : "s"} outside your view
        </p>
      )}
    </div>
  );
}
