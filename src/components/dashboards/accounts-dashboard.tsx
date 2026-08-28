import { useMemo } from "react";
import { Plane, FileSpreadsheet, AlertCircle } from "lucide-react";
import { TravelService } from "@/lib/data/travel-service";
import { PayrollService } from "@/lib/data/payroll-service";
import { EmployeeService } from "@/lib/data/employee-service";
import { TimesheetService } from "@/lib/data/timesheet-service";
import { OvertimeService } from "@/lib/data/overtime-service";
import { useCurrentUser } from "@/lib/auth";
import {
  isCurrentWorkforceMember,
  isDateWithinPeriod,
} from "@/components/dashboards/dashboard-data";
import {
  AttentionQueue,
  PulseStrip,
  DashboardPanel,
  BreakdownBars,
  type AttentionItem,
  type PulseMetric,
} from "@/components/dashboards/dashboard-kit";

export function AccountsDashboard() {
  const currentUser = useCurrentUser();
  const actorContext = currentUser.getActorContext();
  const travelService = useMemo(() => new TravelService(), []);
  const payrollService = useMemo(() => new PayrollService(), []);
  const employeeService = useMemo(() => new EmployeeService(), []);
  const timesheetService = useMemo(() => new TimesheetService(), []);
  const overtimeService = useMemo(() => new OvertimeService(), []);

  // Travel & Expenses
  const allTravel = travelService.getAllRequests(actorContext);
  const pendingTravel = allTravel.filter(
    (r) => r.status === "Pending HR and Accounts" && r.accountsApprovalStatus === "Pending",
  );
  const pendingReimbursements = allTravel.filter((r) => r.status === "Pending Super Admin Closure");

  // Payroll
  const openPeriods = payrollService
    .getAllPeriods()
    .filter(
      (p) =>
        p.status === "Collecting Inputs" || p.status === "Exceptions" || p.status === "Prepared",
    )
    .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
  const currentPeriod = openPeriods[0] ?? null;
  const unresolvedExceptions = currentPeriod
    ? currentPeriod.exceptions.filter((e) => !e.acknowledged).length
    : 0;
  const latestTimesheetPeriod = [...timesheetService.getPeriods()].sort((a, b) =>
    b.endDate.localeCompare(a.endDate),
  )[0];
  const latestTimesheets = latestTimesheetPeriod
    ? timesheetService.getTimesheetsForPeriod(latestTimesheetPeriod.id, actorContext)
    : [];
  const approvedTimesheets = latestTimesheets.filter((item) =>
    ["Approved", "Payroll Locked"].includes(item.status),
  );
  const timesheetsNotReady = latestTimesheets.filter(
    (item) => !["Approved", "Payroll Locked"].includes(item.status),
  );
  const approvedOvertime = currentPeriod
    ? overtimeService
        .getAllClaims(actorContext)
        .filter(
          (claim) =>
            claim.status === "Approved" &&
            isDateWithinPeriod(claim.date, currentPeriod.startDate, currentPeriod.endDate),
        )
    : [];
  const activeEmployees = employeeService
    .getDirectoryEmployees(actorContext)
    .filter((employee) => isCurrentWorkforceMember(employee));

  const attentionItems: AttentionItem[] = [];

  if (pendingTravel.length > 0) {
    attentionItems.push({
      id: "travel-clearance",
      severity: "warning",
      icon: Plane,
      title: `${pendingTravel.length} travel request${pendingTravel.length === 1 ? "" : "s"} awaiting budget clearance`,
      meta: "Accounts approval pending",
      actionLabel: "Review Travel",
      actionTo: "/staff/travel-accounts-approvals",
    });
  }

  if (currentPeriod) {
    if (currentPeriod.status === "Exceptions") {
      attentionItems.push({
        id: "payroll-exceptions",
        severity: "critical",
        icon: AlertCircle,
        title: `${unresolvedExceptions} unresolved payroll exception${unresolvedExceptions === 1 ? "" : "s"}`,
        meta: `${currentPeriod.name} — blocks payroll`,
        actionLabel: "Open Workbench",
        actionTo: `/staff/payroll/periods/${currentPeriod.id}`,
      });
    } else {
      attentionItems.push({
        id: "payroll-status",
        severity: "info",
        icon: FileSpreadsheet,
        title: `${currentPeriod.name} is ${currentPeriod.status}`,
        meta: "Routine payroll workflow",
        actionLabel: "Open Workbench",
        actionTo: `/staff/payroll/periods/${currentPeriod.id}`,
      });
    }
  }

  const pulseMetrics: PulseMetric[] = [
    {
      label: "Pending Travel",
      value: String(pendingTravel.length),
    },
    {
      label: "Pending Reimbursements",
      value: String(pendingReimbursements.length),
    },
    {
      label: "Payroll Period",
      value: currentPeriod ? currentPeriod.name : "None open",
      ...(currentPeriod ? { note: currentPeriod.status } : {}),
    },
    {
      label: "Timesheets Ready",
      value: `${approvedTimesheets.length}/${latestTimesheets.length || activeEmployees.length}`,
      note: latestTimesheetPeriod
        ? `${latestTimesheetPeriod.startDate} – ${latestTimesheetPeriod.endDate}`
        : "No period generated",
    },
    {
      label: "Approved Overtime",
      value: String(approvedOvertime.length),
      note: currentPeriod ? `For ${currentPeriod.name}` : "No open payroll period",
    },
    {
      label: "Exceptions",
      value: String(unresolvedExceptions),
      note: unresolvedExceptions > 0 ? "Must be resolved" : "No blockers",
    },
  ];

  const recentTravelRequests = [...pendingTravel]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 5)
    .map((req) => {
      const employee = activeEmployees.find((item) => item.id === req.employeeId);
      return {
        id: req.id,
        requesterName: employee ? employee.preferredName || employee.legalName : "Unknown employee",
        destination: req.destination,
        amount: req.totalEstimate,
        currency: req.currency,
      };
    });

  return (
    <div className="flex flex-col gap-4">
      <AttentionQueue items={attentionItems} />
      <PulseStrip metrics={pulseMetrics} />

      <div className="grid gap-4 lg:grid-cols-2">
        <DashboardPanel
          title="Payroll Readiness"
          description={
            latestTimesheetPeriod
              ? `${latestTimesheetPeriod.startDate} – ${latestTimesheetPeriod.endDate}`
              : "No active timesheet period"
          }
          viewAllLabel="Payroll Workbench"
          viewAllTo={
            currentPeriod ? `/staff/payroll/periods/${currentPeriod.id}` : "/staff/payroll/periods"
          }
        >
          <BreakdownBars
            items={[
              { label: "Approved timesheets", value: approvedTimesheets.length },
              { label: "Timesheets not ready", value: timesheetsNotReady.length },
              { label: "Approved overtime claims", value: approvedOvertime.length },
              { label: "Unresolved exceptions", value: unresolvedExceptions },
            ]}
          />
        </DashboardPanel>

        {recentTravelRequests.length > 0 ? (
          <DashboardPanel
            title="Travel Requests Awaiting Budget Clearance"
            viewAllLabel="Review Travel"
            viewAllTo="/staff/travel-accounts-approvals"
          >
            <div className="flex flex-col divide-y divide-border">
              {recentTravelRequests.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between py-2 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.requesterName}</p>
                    <p className="truncate text-xs text-muted-foreground">{r.destination}</p>
                  </div>
                  <span className="shrink-0 pl-3 text-sm font-medium tabular-nums">
                    {r.amount.toLocaleString(undefined, {
                      style: "currency",
                      currency: r.currency,
                    })}
                  </span>
                </div>
              ))}
            </div>
          </DashboardPanel>
        ) : (
          <DashboardPanel
            title="Travel Budget Clearance"
            description="Requests requiring Accounts approval"
          >
            <p className="py-5 text-center text-sm text-muted-foreground">
              No travel requests are awaiting budget clearance.
            </p>
          </DashboardPanel>
        )}
      </div>
    </div>
  );
}
