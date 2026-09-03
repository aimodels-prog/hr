import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LeaveService } from "@/lib/data/leave-service";
import { EmployeeService } from "@/lib/data/employee-service";
import { getMasterDataRepository } from "@/lib/data/master-data";
import type { MasterRecord } from "@/lib/data/types";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { Download, Calendar as CalendarIcon, List, RotateCw } from "lucide-react";
import { startOfMonth, endOfMonth, eachDayOfInterval, format, parseISO, isSameDay } from "date-fns";
import { toast } from "sonner";
import { LeaveBalanceRegister } from "@/components/leave/leave-balance-register";
import { WalletCards } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/staff/leave-admin")({
  component: LeaveAdminRoute,
});

function LeaveAdminRoute() {
  return (
    <RequirePermission permission="leave:admin_all" resourceName="Leave Administration">
      <LeaveAdminContent />
    </RequirePermission>
  );
}

function LeaveAdminContent() {
  const currentUser = useCurrentUser();
  const leaveService = useMemo(() => new LeaveService(), []);
  const empService = useMemo(() => new EmployeeService(), []);

  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  const employees = empService.getEmployees(currentUser.getActorContext());
  const departments = getMasterDataRepository("departments").list() as MasterRecord[];
  const policies = leaveService.getPolicies();

  const allRequests = useMemo(
    () =>
      leaveService
        .getAllRequests(currentUser.getActorContext())
        .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leaveService, refreshKey],
  );

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");

  const deptFilterName =
    deptFilter === "all" ? null : (departments.find((d) => d.id === deptFilter)?.name ?? null);

  const filteredRequests = allRequests.filter((req) => {
    if (statusFilter !== "all" && req.status !== statusFilter) return false;
    if (deptFilterName !== null) {
      const emp = employees.find((e) => e.id === req.employeeId);
      if (emp?.department !== deptFilterName) return false;
    }
    return true;
  });

  // Calendar State
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());

  const daysInMonth = useMemo(() => {
    const start = startOfMonth(calendarMonth);
    const end = endOfMonth(calendarMonth);
    return eachDayOfInterval({ start, end });
  }, [calendarMonth]);

  const [isRolloverOpen, setIsRolloverOpen] = useState(false);
  const [rolloverYear, setRolloverYear] = useState(String(new Date().getFullYear()));

  const handleRunAnnualRollover = async () => {
    if (!currentUser) return;
    const targetYear = parseInt(rolloverYear, 10);
    if (!Number.isFinite(targetYear) || targetYear < 2000 || targetYear > 2100) {
      toast.error("Enter a valid 4-digit year.");
      return;
    }
    try {
      const created = await leaveService.runAnnualRolloverAsync(
        targetYear,
        currentUser.getActorContext(),
      );
      if (created === 0) {
        toast.success(`${targetYear} balances are already up to date.`);
      } else {
        toast.success(
          `Annual rollover complete for ${targetYear}: ${created} employee/policy grant(s) created.`,
        );
      }
      setIsRolloverOpen(false);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to run annual rollover");
    }
  };

  const handleExportData = async () => {
    try {
      const department = departments.find((item) => item.id === deptFilter) as
        (MasterRecord & { databaseId?: string }) | undefined;
      const result = await leaveService.exportRequestsCsv(
        {
          ...(statusFilter !== "all" ? { status: statusFilter } : {}),
          ...(department?.databaseId ? { departmentId: department.databaseId } : {}),
        },
        currentUser.getActorContext(),
      );
      const blob = new Blob([result.content], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", result.fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success(`${result.rowCount} leave record(s) exported.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Leave records could not be exported.");
    }
  };

  return (
    <>
      <div className="flex flex-col gap-6 max-w-[1400px] mx-auto pb-10">
        <PageHeader
          title="Leave Administration & Calendar"
          description="Global view of all employee absences, historical records, and policy snapshots."
          actions={
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setRolloverYear(String(new Date().getFullYear()));
                  setIsRolloverOpen(true);
                }}
              >
                <RotateCw className="mr-2 h-4 w-4" /> Run Annual Rollover
              </Button>
              <Button variant="outline" onClick={handleExportData}>
                <Download className="mr-2 h-4 w-4" /> Export Data
              </Button>
            </div>
          }
        />

        <Tabs defaultValue="balances" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="balances" className="flex gap-2">
              <WalletCards className="h-4 w-4" /> Balance Register
            </TabsTrigger>
            <TabsTrigger value="list" className="flex gap-2">
              <List className="h-4 w-4" /> All Requests
            </TabsTrigger>
            <TabsTrigger value="calendar" className="flex gap-2">
              <CalendarIcon className="h-4 w-4" /> Team Calendar
            </TabsTrigger>
          </TabsList>

          <TabsContent value="balances" className="space-y-4">
            <LeaveBalanceRegister />
          </TabsContent>

          <TabsContent value="list" className="space-y-4">
            <Card>
              <CardHeader className="py-4">
                <div className="flex gap-4 items-center">
                  <div className="w-[200px]">
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger>
                        <SelectValue placeholder="Filter by Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="Pending Line Manager">Pending Line Manager</SelectItem>
                        <SelectItem value="Pending Super Admin">Pending Super Admin</SelectItem>
                        <SelectItem value="Pending HR">Pending HR</SelectItem>
                        <SelectItem value="Approved">Approved (Future)</SelectItem>
                        <SelectItem value="Taken">Taken (Past)</SelectItem>
                        <SelectItem value="Automatically Refused">Automatically Refused</SelectItem>
                        <SelectItem value="Cancellation Pending">Cancellation Pending</SelectItem>
                        <SelectItem value="Cancellation Approved">Cancellation Approved</SelectItem>
                        <SelectItem value="Cancelled">Cancelled</SelectItem>
                        <SelectItem value="Declined">Declined</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-[250px]">
                    <Select value={deptFilter} onValueChange={setDeptFilter}>
                      <SelectTrigger>
                        <SelectValue placeholder="Filter by Department" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Departments</SelectItem>
                        {departments.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Dates</TableHead>
                      <TableHead>Days</TableHead>
                      <TableHead>Policy</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRequests.map((req) => {
                      const emp = employees.find((e) => e.id === req.employeeId);

                      return (
                        <TableRow key={req.id}>
                          <TableCell>
                            <div className="font-medium">{emp?.preferredName}</div>
                            <div className="text-xs text-muted-foreground">{emp?.department}</div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {format(parseISO(req.startDate), "MMM d, yyyy")}
                            {req.startDate !== req.endDate &&
                              ` - ${format(parseISO(req.endDate), "MMM d, yyyy")}`}
                          </TableCell>
                          <TableCell className="font-medium">{req.workingDaysRequested}</TableCell>
                          <TableCell>
                            {req.policySnapshot?.name ||
                              policies.find((p) => p.id === req.policyId)?.name}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                req.status === "Approved"
                                  ? "default"
                                  : req.status === "Taken"
                                    ? "secondary"
                                    : req.status.startsWith("Pending")
                                      ? "outline"
                                      : req.status === "Automatically Refused" ||
                                          req.status === "Declined"
                                        ? "destructive"
                                        : req.status === "Cancelled" ||
                                            req.status === "Cancellation Approved"
                                          ? "outline"
                                          : "secondary"
                              }
                            >
                              {req.status}
                            </Badge>
                          </TableCell>
                          <TableCell
                            className="text-xs max-w-[250px] truncate"
                            title={req.refusalReason || req.cancellationReason || req.reason}
                          >
                            {req.status === "Automatically Refused" ? (
                              <span className="text-destructive font-medium">
                                Auto-Refused: Notice violation
                              </span>
                            ) : req.status === "Cancellation Pending" ? (
                              <span className="text-amber-600 font-medium">
                                Cancel: {req.cancellationReason}
                              </span>
                            ) : (
                              req.reason
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {filteredRequests.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          No requests match the current filters.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="calendar">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle>Team Absence Calendar</CardTitle>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        const d = new Date(calendarMonth);
                        d.setMonth(d.getMonth() - 1);
                        setCalendarMonth(d);
                      }}
                    >
                      Prev
                    </Button>
                    <div className="font-semibold text-lg flex items-center justify-center min-w-[150px]">
                      {format(calendarMonth, "MMMM yyyy")}
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => {
                        const d = new Date(calendarMonth);
                        d.setMonth(d.getMonth() + 1);
                        setCalendarMonth(d);
                      }}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {/* A simplified visual grid */}
                <div className="min-w-[1000px] border rounded-md">
                  <div className="flex bg-muted/50 border-b">
                    <div className="w-[200px] p-2 font-semibold border-r shrink-0">Employee</div>
                    {daysInMonth.map((day) => (
                      <div
                        key={day.toISOString()}
                        className="flex-1 min-w-[30px] p-1 text-center border-r text-xs"
                      >
                        {format(day, "d")}
                      </div>
                    ))}
                  </div>

                  {employees.map((emp) => {
                    // Get approved/taken leaves for this employee in this month
                    const empRequests = allRequests.filter(
                      (r) =>
                        r.employeeId === emp.id &&
                        (r.status === "Approved" || r.status === "Taken"),
                    );

                    if (empRequests.length === 0) return null; // Only show if they have leave this month

                    return (
                      <div key={emp.id} className="flex border-b hover:bg-muted/10">
                        <div
                          className="w-[200px] p-2 text-sm font-medium border-r shrink-0 truncate"
                          title={`${emp.preferredName}`}
                        >
                          {emp.preferredName}
                        </div>
                        {daysInMonth.map((day) => {
                          const isLeave = empRequests.some((r) => {
                            const start = parseISO(r.startDate);
                            const end = parseISO(r.endDate);
                            return day >= start && day <= end;
                          });

                          return (
                            <div
                              key={day.toISOString()}
                              className={`flex-1 min-w-[30px] border-r ${isLeave ? "bg-primary/20" : ""}`}
                              title={isLeave ? "On Leave" : ""}
                            />
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={isRolloverOpen} onOpenChange={setIsRolloverOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run Annual Rollover</DialogTitle>
            <DialogDescription>
              This adds each employee's allowance for the selected year and carries over unused days
              within the policy limit. Running it again for a year already rolled over will not
              duplicate balances.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rollover-year">Leave year</Label>
            <Input
              id="rollover-year"
              type="number"
              min={2000}
              max={2100}
              value={rolloverYear}
              onChange={(event) => setRolloverYear(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRolloverOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRunAnnualRollover}>Run Rollover</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
