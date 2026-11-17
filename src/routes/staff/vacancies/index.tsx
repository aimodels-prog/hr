import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { redactEmployee } from "@/lib/auth/redaction";
import { VacancyService } from "@/lib/data/vacancy-service";
import { EmployeeService } from "@/lib/data/employee-service";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FilePlus2, Search, X } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import type { Vacancy } from "@/lib/data/types";

export const Route = createFileRoute("/staff/vacancies/")({
  component: VacanciesIndexRoute,
});

function VacanciesIndexRoute() {
  const currentUser = useCurrentUser();
  const vacancyService = useMemo(() => new VacancyService(), []);
  const employeeService = useMemo(() => new EmployeeService(), []);

  const navigate = useNavigate();

  const allVacancies = vacancyService.getVacancyRepository().list();
  // Redacted immediately after fetching - this list is only ever used to resolve a hiring
  // manager's name for display, but this route is visible to Line Managers too, so no
  // unredacted record (salary, bank details, etc.) for a colleague outside their management
  // chain should sit in this component's memory.
  const allEmployees = employeeService
    .getEmployeesWithReportingLine(currentUser.getActorContext(), { includeArchived: false })
    .map((e) => redactEmployee(e, currentUser));

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [selectedVacancy, setSelectedVacancy] = useState<Vacancy | null>(null);
  const [changingStatus, setChangingStatus] = useState(false);
  const [, refreshList] = useState(0);
  const canManageVacancies =
    currentUser.can("recruitment:manage_vacancies") &&
    (currentUser.activeRole === "HR" || currentUser.activeRole === "Super Admin");

  const changeVisibility = async () => {
    if (!selectedVacancy || changingStatus) return;
    const takingOffline = selectedVacancy.status === "Open";
    setChangingStatus(true);
    try {
      await vacancyService.transitionStatusAsync(
        selectedVacancy.id,
        takingOffline ? "Paused" : "Open",
        takingOffline ? "Advert taken offline by HR" : "Advert put back online by HR",
        currentUser.getActorContext(),
      );
      toast.success(
        takingOffline
          ? "Advert is offline. Existing applications are kept."
          : "Advert is live again.",
      );
      setSelectedVacancy(null);
      refreshList((version) => version + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The advert could not be updated.");
    } finally {
      setChangingStatus(false);
    }
  };

  const filteredVacancies = allVacancies.filter((v) => {
    if (statusFilter !== "all" && v.status !== statusFilter) return false;
    if (departmentFilter !== "all" && v.department !== departmentFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return v.title.toLowerCase().includes(q) || v.department.toLowerCase().includes(q);
    }
    return true;
  });

  const departments = Array.from(new Set(allVacancies.map((v) => v.department)));

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setDepartmentFilter("all");
  };

  return (
    <RequirePermission permission="recruitment:view_vacancies" resourceName="Vacancies">
      <div className="flex flex-col gap-6 max-w-[1400px] mx-auto pb-10">
        <PageHeader
          title="Job Vacancies"
          description="Publish, pause or close job adverts."
          actions={
            <Button onClick={() => navigate({ to: "/staff/vacancies/new" })}>
              <FilePlus2 className="mr-2 h-4 w-4" /> Add Job
            </Button>
          }
        />

        <Card>
          <div className="p-4 border-b flex flex-wrap gap-4 items-center bg-muted/20">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search vacancies..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="w-[180px]">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="Draft">Draft</SelectItem>
                  <SelectItem value="Pending Approval">Pending Approval</SelectItem>
                  <SelectItem value="Open">Open</SelectItem>
                  <SelectItem value="Paused">Paused</SelectItem>
                  <SelectItem value="Closed">Closed</SelectItem>
                  <SelectItem value="Archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-[180px]">
              <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(search || statusFilter !== "all" || departmentFilter !== "all") && (
              <Button variant="ghost" onClick={clearFilters} className="text-muted-foreground">
                <X className="mr-2 h-4 w-4" /> Clear
              </Button>
            )}
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job Title</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Target Start</TableHead>
                <TableHead>Hiring Manager</TableHead>
                <TableHead>Applicants</TableHead>
                <TableHead>Status</TableHead>
                {canManageVacancies && <TableHead className="text-right">Advert</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredVacancies.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={canManageVacancies ? 8 : 7}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No vacancies found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredVacancies.map((vacancy) => {
                  const manager = vacancy.hiringManagerId
                    ? allEmployees.find((e) => e.id === vacancy.hiringManagerId)
                    : null;
                  return (
                    <TableRow
                      key={vacancy.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() =>
                        navigate({
                          to: "/staff/vacancies/$vacancyId",
                          params: { vacancyId: vacancy.id },
                        })
                      }
                    >
                      <TableCell className="font-medium">{vacancy.title}</TableCell>
                      <TableCell>{vacancy.department}</TableCell>
                      <TableCell>{vacancy.location}</TableCell>
                      <TableCell>
                        {vacancy.targetStartDate
                          ? format(new Date(vacancy.targetStartDate), "MMM d, yyyy")
                          : "-"}
                      </TableCell>
                      <TableCell>
                        {manager ? `${manager.preferredName} ${manager.legalName}` : "-"}
                      </TableCell>
                      <TableCell className="font-medium text-blue-600">
                        {vacancy.applicantCount}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={vacancy.status} />
                      </TableCell>
                      {canManageVacancies && (
                        <TableCell
                          className="text-right"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {vacancy.status === "Open" || vacancy.status === "Paused" ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedVacancy(vacancy)}
                            >
                              {vacancy.status === "Open" ? "Take offline" : "Put online"}
                            </Button>
                          ) : null}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Card>
        <AlertDialog
          open={!!selectedVacancy}
          onOpenChange={(open) => !open && !changingStatus && setSelectedVacancy(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {selectedVacancy?.status === "Open"
                  ? "Take this advert offline?"
                  : "Put this advert online?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {selectedVacancy?.status === "Open"
                  ? `${selectedVacancy.title} will disappear from the public careers page and stop accepting new applications. Existing applications will remain available to HR.`
                  : `${selectedVacancy?.title ?? "This advert"} will appear on the public careers page and accept new applications again.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={changingStatus}>Cancel</AlertDialogCancel>
              <Button
                type="button"
                disabled={changingStatus}
                onClick={() => void changeVisibility()}
              >
                {changingStatus
                  ? "Updating…"
                  : selectedVacancy?.status === "Open"
                    ? "Take offline"
                    : "Put online"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </RequirePermission>
  );
}
