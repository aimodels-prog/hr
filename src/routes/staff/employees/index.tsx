/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Search, Download, Plus, FilterX, Upload } from "lucide-react";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { canViewSensitiveField, redactSensitiveExportField } from "@/lib/auth/redaction";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTableShell } from "@/components/ui/data-table-shell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilterBar } from "@/components/ui/filter-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { getApplicationDataServices } from "@/lib/data/application-data";
import { getMasterDataRepository, getProjectRepository } from "@/lib/data/master-data";
import { EmployeeService } from "@/lib/data/employee-service";
import type { Employee, EmployeeStatus } from "@/lib/data/types";
import { z } from "zod";

export type EmployeeSearch = {
  q: string;
  status: string;
  department: string;
  location: string;
  project: string;
  manager: string;
  employmentType: string;
  page: number;
};

// Columns in the CSV export that carry government-ID data and must be re-checked per row via
// canViewSensitiveField("passport", ...) / redactSensitiveExportField before being written out.
const SENSITIVE_EMPLOYEE_EXPORT_COLUMNS = new Set(["nationalId", "passportNumber"]);

export const Route = createFileRoute("/staff/employees/")({
  component: EmployeesRoute,
  validateSearch: (search: Record<string, unknown>): EmployeeSearch => ({
    q: (search["q"] as string) || "",
    status: (search["status"] as string) || "",
    department: (search["department"] as string) || "",
    location: (search["location"] as string) || "",
    project: (search["project"] as string) || "",
    manager: (search["manager"] as string) || "",
    employmentType: (search["employmentType"] as string) || "",
    page: Number(search["page"]) || 1,
  }),
});

function EmployeesRoute() {
  const navigate = Route.useNavigate();
  const searchParams = Route.useSearch();
  const userContext = useCurrentUser();
  const { audit } = getApplicationDataServices();
  const employeeService = useMemo(() => new EmployeeService(), []);
  const allEmployees = useMemo(
    () =>
      employeeService.getDirectoryEmployees(userContext.getActorContext(), {
        includeArchived: true,
      }),
    [employeeService, userContext],
  );
  const safeEmployees = useMemo(
    () => employeeService.getEmployees(userContext.getActorContext(), { includeArchived: true }),
    [employeeService, userContext],
  );

  // Derive filter options based on scoped data (so users don't see departments they have no people in)
  const departments = useMemo(
    () => Array.from(new Set(safeEmployees.map((e) => e.department).filter(Boolean))).sort(),
    [safeEmployees],
  );
  const locations = useMemo(
    () => Array.from(new Set(safeEmployees.map((e) => e.location).filter(Boolean))).sort(),
    [safeEmployees],
  );
  // Active projects only - a completed/archived project isn't a useful filter option going forward.
  const activeProjects = useMemo(
    () =>
      getProjectRepository()
        .list()
        .filter((p) => p.isActive),
    [],
  );
  // Active employment types only, mirroring the same "don't offer dead options" convention.
  const activeEmploymentTypes = useMemo(
    () =>
      getMasterDataRepository("employmentTypes")
        .list()
        .filter((t) => t.isActive),
    [],
  );
  // Only active employees who are actually someone's manager within the current viewer's scoped
  // directory - same "don't show options with no matching people" rationale as departments/locations.
  const managers = useMemo(() => {
    const managerIds = new Set(
      safeEmployees.map((e) => e.lineManagerId).filter((id): id is string => Boolean(id)),
    );
    return allEmployees
      .filter((e) => managerIds.has(e.id) && e.status === "Active")
      .sort((a, b) => a.preferredName.localeCompare(b.preferredName));
  }, [safeEmployees, allEmployees]);
  const statuses: EmployeeStatus[] = [
    "Onboarding",
    "Active",
    "Probation",
    "Notice",
    "Inactive",
    "Archived",
  ];

  // Filtering Logic
  const filteredEmployees = useMemo(() => {
    return safeEmployees.filter((emp) => {
      if (
        searchParams.status &&
        searchParams.status !== "All" &&
        emp.status !== searchParams.status
      )
        return false;
      if (
        searchParams.department &&
        searchParams.department !== "All" &&
        emp.department !== searchParams.department
      )
        return false;
      if (
        searchParams.location &&
        searchParams.location !== "All" &&
        emp.location !== searchParams.location
      )
        return false;
      if (
        searchParams.project &&
        searchParams.project !== "All" &&
        emp.projectId !== searchParams.project
      )
        return false;
      if (
        searchParams.manager &&
        searchParams.manager !== "All" &&
        emp.lineManagerId !== searchParams.manager
      )
        return false;
      if (
        searchParams.employmentType &&
        searchParams.employmentType !== "All" &&
        emp.employmentType !== searchParams.employmentType
      )
        return false;
      if (searchParams.q) {
        const q = searchParams.q.toLowerCase();
        return (
          emp.legalName.toLowerCase().includes(q) ||
          emp.preferredName.toLowerCase().includes(q) ||
          emp.employeeNumber.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [safeEmployees, searchParams]);

  // Pagination
  const pageSize = 20;
  const totalPages = Math.ceil(filteredEmployees.length / pageSize);
  const page = Math.max(1, Math.min(searchParams.page, totalPages || 1));
  const paginatedEmployees = filteredEmployees.slice((page - 1) * pageSize, page * pageSize);

  // Handlers for URL state
  const updateSearch = (updates: Partial<typeof searchParams>) => {
    navigate({
      search: (prev) => ({ ...prev, ...updates, page: updates.page ?? 1 }),
      replace: true,
    });
  };

  const clearFilters = () => {
    navigate({
      search: {
        q: "",
        status: "",
        department: "",
        location: "",
        project: "",
        manager: "",
        employmentType: "",
        page: 1,
      },
      replace: true,
    });
  };

  const exportCSV = () => {
    if (filteredEmployees.length === 0) return;

    // Dynamically get headers from the first redacted object (omitting complex nested objects)
    const headers = [
      "employeeNumber",
      "preferredName",
      "legalName",
      "workEmail",
      "department",
      "position",
      "location",
      "status",
      "startDate",
      "employmentType",
      "nationalId",
      "passportNumber",
    ];

    // Passport/national ID are re-gated here per row (not assumed safe just because they were
    // already redacted upstream by redactEmployee) using the same canViewSensitiveField("passport",
    // ...) rule the rest of the app uses - "self" visibility differs row to row across a directory
    // listing, so this can't be a single up-front check. This keeps the export safe on its own
    // terms even if the upstream redaction is ever changed independently of this file.
    let sensitiveDataExposed = false;
    const rows = filteredEmployees.map((emp) => {
      if (canViewSensitiveField("passport", emp, userContext)) {
        sensitiveDataExposed = true;
      }
      return headers.map((h) => {
        if (SENSITIVE_EMPLOYEE_EXPORT_COLUMNS.has(h)) {
          return redactSensitiveExportField((emp as any)[h], "passport", emp, userContext);
        }
        const val = (emp as any)[h];
        return val === undefined ? "" : String(val);
      });
    });

    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `employees_export_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Bulk-exporting the directory to a file is a distinct, auditable action from browsing it in
    // the app - for privileged viewers it can carry passport/national ID data out of the system
    // entirely, so it's logged the same way the candidate CSV export and leave data export already are.
    audit.record({
      context: userContext.getActorContext(),
      action: "employee_directory_csv_export",
      module: "core-hr",
      entityType: "employee-directory-export",
      entityId: crypto.randomUUID(),
      after: {
        rowCount: filteredEmployees.length,
        fields: headers,
        sensitiveFields: [...SENSITIVE_EMPLOYEE_EXPORT_COLUMNS],
        sensitiveFieldsIncluded: sensitiveDataExposed,
      },
      reason: "Employee directory exported to CSV",
      riskLevel: sensitiveDataExposed ? "High" : "Medium",
    });
  };

  return (
    <RequirePermission permission="employee:view_directory" resourceName="Employee Directory">
      <div className="flex flex-col gap-6 max-w-[1400px] mx-auto pb-10">
        <PageHeader
          title="Employee Directory"
          description="Browse and manage employee profiles across the organisation."
          breadcrumbs={[{ label: "Core HR" }, { label: "Employee Directory" }]}
          actions={
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={exportCSV}
                disabled={filteredEmployees.length === 0}
              >
                <Download className="mr-2 h-4 w-4" /> Export CSV
              </Button>
              {userContext.permissions.has("employee:manage_all") && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => navigate({ to: "/staff/employees/import" } as any)}
                  >
                    <Upload className="mr-2 h-4 w-4" /> Import
                  </Button>
                  <Button onClick={() => navigate({ to: "/staff/employees/new" } as any)}>
                    <Plus className="mr-2 h-4 w-4" /> Add Employee
                  </Button>
                </>
              )}
            </div>
          }
        />

        <div className="space-y-4">
          <FilterBar>
            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto flex-1">
              <div className="relative w-full sm:max-w-xs">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search name or ID..."
                  className="pl-9"
                  value={searchParams.q || ""}
                  onChange={(e) => updateSearch({ q: e.target.value })}
                />
              </div>

              <Select
                value={searchParams.status || "All"}
                onValueChange={(v) => updateSearch({ status: v === "All" ? "" : v })}
              >
                <SelectTrigger className="w-full sm:w-[150px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Statuses</SelectItem>
                  {statuses.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={searchParams.department || "All"}
                onValueChange={(v) => updateSearch({ department: v === "All" ? "" : v })}
              >
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="Department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Departments</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={searchParams.location || "All"}
                onValueChange={(v) => updateSearch({ location: v === "All" ? "" : v })}
              >
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="Location" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Locations</SelectItem>
                  {locations.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={searchParams.project || "All"}
                onValueChange={(v) => updateSearch({ project: v === "All" ? "" : v })}
              >
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="Project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Projects</SelectItem>
                  {activeProjects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={searchParams.manager || "All"}
                onValueChange={(v) => updateSearch({ manager: v === "All" ? "" : v })}
              >
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="Manager" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Managers</SelectItem>
                  {managers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.preferredName} {m.legalName.split(" ").slice(-1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={searchParams.employmentType || "All"}
                onValueChange={(v) => updateSearch({ employmentType: v === "All" ? "" : v })}
              >
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="Employment Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Employment Types</SelectItem>
                  {activeEmploymentTypes.map((t) => (
                    <SelectItem key={t.id} value={t.name}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {(searchParams.q ||
              searchParams.status ||
              searchParams.department ||
              searchParams.location ||
              searchParams.project ||
              searchParams.manager ||
              searchParams.employmentType) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="text-muted-foreground whitespace-nowrap"
              >
                <FilterX className="mr-2 h-4 w-4" /> Clear Filters
              </Button>
            )}
          </FilterBar>

          <DataTableShell>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Supervisor</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>Employment Type</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedEmployees.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-64 text-center">
                      <EmptyState
                        icon={Search}
                        title="No employees found"
                        description="Try adjusting your filters or search query."
                        action={
                          <Button variant="outline" onClick={clearFilters}>
                            Clear filters
                          </Button>
                        }
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedEmployees.map((emp) => (
                    <TableRow
                      key={emp.id}
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() =>
                        navigate({
                          to: `/staff/employees/$employeeId`,
                          params: { employeeId: emp.id },
                        } as any)
                      }
                    >
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground">
                            {emp.preferredName} {emp.legalName.split(" ").slice(-1)}
                          </span>
                          <span className="text-xs text-muted-foreground flex gap-1">
                            <span>{emp.employeeNumber}</span>
                            <span>•</span>
                            <span>{emp.position}</span>
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{emp.department}</TableCell>
                      <TableCell>{emp.location}</TableCell>
                      <TableCell>
                        {emp.lineManagerId
                          ? allEmployees.find((m) => m.id === emp.lineManagerId)?.preferredName ||
                            "-"
                          : "-"}
                      </TableCell>
                      <TableCell>{emp.startDate}</TableCell>
                      <TableCell>{emp.employmentType || "-"}</TableCell>
                      <TableCell>
                        <StatusBadge status={emp.status} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </DataTableShell>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-2">
              <div className="text-sm text-muted-foreground">
                Showing {(page - 1) * pageSize + 1} to{" "}
                {Math.min(page * pageSize, filteredEmployees.length)} of {filteredEmployees.length}{" "}
                entries
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => updateSearch({ page: page - 1 })}
                  disabled={page === 1}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => updateSearch({ page: page + 1 })}
                  disabled={page === totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </RequirePermission>
  );
}
