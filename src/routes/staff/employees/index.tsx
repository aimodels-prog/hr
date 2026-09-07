import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, FilterX, Mail, Phone, Plus, Search, Upload } from "lucide-react";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilterBar } from "@/components/ui/filter-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { EmployeeService } from "@/lib/data/employee-service";

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
  const currentUser = useCurrentUser();
  const employeeService = useMemo(() => new EmployeeService(), []);
  const canManageEmployees = currentUser.permissions.has("employee:manage_all");
  const employees = useMemo(
    () =>
      employeeService
        .getDirectoryEmployees(currentUser.getActorContext(), {
          includeArchived: false,
        })
        .filter((employee) => !["Inactive", "Archived"].includes(employee.status)),
    [employeeService, currentUser],
  );

  const employeeById = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee])),
    [employees],
  );
  const departments = useMemo(
    () => Array.from(new Set(employees.map((employee) => employee.department))).sort(),
    [employees],
  );
  const locations = useMemo(
    () => Array.from(new Set(employees.map((employee) => employee.location))).sort(),
    [employees],
  );
  const filteredEmployees = useMemo(() => {
    const query = searchParams.q.trim().toLowerCase();
    return employees.filter((employee) => {
      if (searchParams.department && employee.department !== searchParams.department) return false;
      if (searchParams.location && employee.location !== searchParams.location) return false;
      if (!query) return true;
      return [
        employee.legalName,
        employee.preferredName,
        employee.employeeNumber,
        employee.workEmail,
        employee.position,
        employee.department,
        employee.location,
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [employees, searchParams]);

  const pageSize = 20;
  const totalPages = Math.ceil(filteredEmployees.length / pageSize);
  const page = Math.max(1, Math.min(searchParams.page, totalPages || 1));
  const visibleEmployees = filteredEmployees.slice((page - 1) * pageSize, page * pageSize);
  const updateSearch = (updates: Partial<EmployeeSearch>) =>
    navigate({
      search: (previous) => ({ ...previous, ...updates, page: updates.page ?? 1 }),
      replace: true,
    });
  const clearFilters = () =>
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

  return (
    <RequirePermission permission="employee:view_directory" resourceName="Employee Directory">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-6 pb-10">
        <PageHeader
          title="Employee Directory"
          description="Find a colleague's VIA contact details, position and work location."
          breadcrumbs={[{ label: "Core HR" }, { label: "Employee Directory" }]}
          actions={
            canManageEmployees ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => navigate({ to: "/staff/employees/import" })}
                >
                  <Upload className="mr-2 h-4 w-4" /> Import
                </Button>
                <Button onClick={() => navigate({ to: "/staff/employees/new" })}>
                  <Plus className="mr-2 h-4 w-4" /> Add employee
                </Button>
              </div>
            ) : undefined
          }
        />

        <FilterBar>
          <div className="relative min-w-[260px] flex-1 sm:max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search name or ID..."
              className="pl-9"
              value={searchParams.q}
              onChange={(event) => updateSearch({ q: event.target.value })}
            />
          </div>
          <Select
            value={searchParams.department || "all"}
            onValueChange={(value) => updateSearch({ department: value === "all" ? "" : value })}
          >
            <SelectTrigger className="w-full sm:w-[190px]">
              <SelectValue placeholder="Department" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departments.map((department) => (
                <SelectItem key={department} value={department}>
                  {department}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={searchParams.location || "all"}
            onValueChange={(value) => updateSearch({ location: value === "all" ? "" : value })}
          >
            <SelectTrigger className="w-full sm:w-[190px]">
              <SelectValue placeholder="Work location" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All work locations</SelectItem>
              {locations.map((location) => (
                <SelectItem key={location} value={location}>
                  {location}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(searchParams.q || searchParams.department || searchParams.location) && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <FilterX className="mr-2 h-4 w-4" /> Clear filters
            </Button>
          )}
        </FilterBar>

        <DataTableShell>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Colleague</TableHead>
                <TableHead>VIA email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Position</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Work location</TableHead>
                <TableHead>Supervisor</TableHead>
                {canManageEmployees && <TableHead className="text-right">HR record</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleEmployees.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canManageEmployees ? 8 : 7} className="h-64 text-center">
                    <EmptyState
                      icon={Search}
                      title="No colleagues found"
                      description="Try another name, department or work location."
                      action={
                        <Button variant="outline" onClick={clearFilters}>
                          Clear filters
                        </Button>
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                visibleEmployees.map((employee) => {
                  const supervisor = employee.lineManagerId
                    ? employeeById.get(employee.lineManagerId)
                    : undefined;
                  return (
                    <TableRow key={employee.id}>
                      <TableCell>
                        <p className="font-medium">
                          {employee.preferredName} {employee.legalName.split(" ").slice(-1)}
                        </p>
                        {canManageEmployees && (
                          <p className="text-xs text-muted-foreground">{employee.employeeNumber}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <a
                          href={`mailto:${employee.workEmail}`}
                          className="inline-flex items-center gap-1.5 text-primary hover:underline"
                        >
                          <Mail className="h-3.5 w-3.5" /> {employee.workEmail}
                        </a>
                      </TableCell>
                      <TableCell>
                        {employee.phone ? (
                          <a
                            href={`tel:${employee.phone}`}
                            className="inline-flex items-center gap-1.5 hover:underline"
                          >
                            <Phone className="h-3.5 w-3.5" /> {employee.phone}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">Not provided</span>
                        )}
                      </TableCell>
                      <TableCell>{employee.position}</TableCell>
                      <TableCell>{employee.department}</TableCell>
                      <TableCell>{employee.location}</TableCell>
                      <TableCell>
                        {supervisor
                          ? `${supervisor.preferredName} ${supervisor.legalName.split(" ").slice(-1)}`
                          : "Top of organisation"}
                      </TableCell>
                      {canManageEmployees && (
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              navigate({
                                to: "/staff/employees/$employeeId",
                                params: { employeeId: employee.id },
                              })
                            }
                          >
                            Open <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </DataTableShell>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-2 text-sm">
            <span className="text-muted-foreground">
              Showing {(page - 1) * pageSize + 1} to{" "}
              {Math.min(page * pageSize, filteredEmployees.length)} of {filteredEmployees.length}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => updateSearch({ page: page - 1 })}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page === totalPages}
                onClick={() => updateSearch({ page: page + 1 })}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </RequirePermission>
  );
}
