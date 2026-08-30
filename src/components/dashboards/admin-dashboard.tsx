import { useMemo } from "react";
import { ShieldAlert, AlertTriangle, CalendarCheck, Wallet } from "lucide-react";
import { LeaveService } from "@/lib/data/leave-service";
import { DocumentService } from "@/lib/data/document-service";
import { PayrollService } from "@/lib/data/payroll-service";
import { getApplicationDataServices } from "@/lib/data/application-data";
import { EmployeeService } from "@/lib/data/employee-service";
import { RecruitmentService } from "@/lib/data/recruitment-service";
import { OnboardingService } from "@/lib/data/onboarding-service";
import { TravelService } from "@/lib/data/travel-service";
import { useCurrentUser } from "@/lib/auth";
import { isCurrentWorkforceMember } from "@/components/dashboards/dashboard-data";
import {
  AttentionQueue,
  PulseStrip,
  DashboardPanel,
  BreakdownBars,
  type AttentionItem,
  type PulseMetric,
} from "@/components/dashboards/dashboard-kit";

export function AdminDashboard() {
  const currentUser = useCurrentUser();
  const leaveService = useMemo(() => new LeaveService(), []);
  const docService = useMemo(() => new DocumentService(), []);
  const payrollService = useMemo(() => new PayrollService(), []);
  const auditService = useMemo(() => getApplicationDataServices().audit, []);
  const employeeService = useMemo(() => new EmployeeService(), []);
  const recruitmentService = useMemo(() => new RecruitmentService(), []);
  const onboardingService = useMemo(() => new OnboardingService(), []);
  const travelService = useMemo(() => new TravelService(), []);

  const pendingLeave = leaveService.getPendingRequestsForSuperAdmin(currentUser.getActorContext());
  const pendingPayroll = payrollService
    .getAllPeriods(currentUser.getActorContext())
    .filter((p) => p.status === "Prepared");
  const activeEmployees = employeeService
    .getEmployees(currentUser.getActorContext())
    .filter((employee) => isCurrentWorkforceMember(employee));
  const currentEmployeeIds = new Set(activeEmployees.map((employee) => employee.id));
  const criticalExpiries = docService
    .getExpiringDocuments(currentUser.getActorContext())
    .filter((document) => currentEmployeeIds.has(document.employeeId));
  const openVacancies = recruitmentService
    .getVacancies()
    .filter((vacancy) => vacancy.status === "Open");
  const activeOnboarding = onboardingService
    .getCasesForContext(currentUser.getActorContext())
    .filter(
      (item) =>
        item.status !== "Completed" && item.status !== "Cancelled" && item.progressPercentage < 100,
    );
  const reimbursementClosures = travelService
    .getAllRequests(currentUser.getActorContext())
    .filter((request) => request.status === "Pending Super Admin Closure");
  const departmentCounts = [...new Set(activeEmployees.map((employee) => employee.department))]
    .map((department) => ({
      label: department || "Unassigned",
      value: activeEmployees.filter((employee) => employee.department === department).length,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  // Get recent high risk audit events
  const auditEvents = auditService
    .list()
    .filter((e) => e.riskLevel === "High" || e.riskLevel === "Critical");
  const recentAlerts = auditEvents
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(0, 5);

  const attentionItems: AttentionItem[] = [];

  if (criticalExpiries.length > 0) {
    attentionItems.push({
      id: "document-expiries",
      severity: "critical",
      icon: AlertTriangle,
      title: `${criticalExpiries.length} document${criticalExpiries.length === 1 ? "" : "s"} expired or due within 30 days`,
      meta: "Compliance follow-up is required",
      actionLabel: "Review Expiries",
      actionTo: "/staff/document-expiry",
    });
  }

  if (pendingLeave.length > 0) {
    attentionItems.push({
      id: "leave-approvals",
      severity: "warning",
      icon: CalendarCheck,
      title: `${pendingLeave.length} leave request${pendingLeave.length === 1 ? "" : "s"} awaiting final approval`,
      meta: "Awaiting HR confirmation or admin override",
      actionLabel: "Review Leave",
      actionTo: "/staff/leave-approvals",
    });
  }

  if (pendingPayroll.length > 0) {
    attentionItems.push({
      id: "payroll-approvals",
      severity: "warning",
      icon: Wallet,
      title: `${pendingPayroll.length} payroll period${pendingPayroll.length === 1 ? "" : "s"} prepared and awaiting final action`,
      meta: "Ready for approval",
      actionLabel: "Review Payroll",
      actionTo: "/staff/payroll/periods",
    });
  }

  if (recentAlerts.length > 0) {
    attentionItems.push({
      id: "audit-alerts",
      severity: "critical",
      icon: ShieldAlert,
      title: `${auditEvents.length} high or critical risk audit event${auditEvents.length === 1 ? "" : "s"}`,
      meta: "Recorded in Audit History for review",
      actionLabel: "View Audit Log",
      actionTo: "/staff/audit",
    });
  }

  const pulseMetrics: PulseMetric[] = [
    {
      label: "Current Headcount",
      value: String(activeEmployees.length),
      note: `${departmentCounts.length} departments`,
    },
    {
      label: "Open Vacancies",
      value: String(openVacancies.length),
    },
    {
      label: "Active Onboarding",
      value: String(activeOnboarding.length),
    },
    {
      label: "Pending Final Approvals",
      value: String(pendingLeave.length + pendingPayroll.length),
      note: "Leave + payroll",
    },
    {
      label: "Pending Payroll Periods",
      value: String(pendingPayroll.length),
    },
    {
      label: "High-risk Audit Events",
      value: String(auditEvents.length),
      note: "High or critical risk",
    },
    {
      label: "Reimbursements to Close",
      value: String(reimbursementClosures.length),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <AttentionQueue items={attentionItems} />
      <PulseStrip metrics={pulseMetrics} />

      <div className="grid gap-4 lg:grid-cols-2">
        <DashboardPanel
          title="High-risk Audit Activity"
          description="Recent sensitive changes and denied actions"
          {...(recentAlerts.length > 0
            ? { viewAllLabel: "View Full Audit Log", viewAllTo: "/staff/audit" }
            : {})}
        >
          {recentAlerts.length > 0 ? (
            <div className="flex flex-col divide-y divide-border">
              {recentAlerts.map((a) => (
                <div
                  key={a.id}
                  className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <span className="block truncate text-sm font-medium text-destructive">
                      {a.action}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {a.actor.displayName} ({a.actor.roles.join(", ")})
                    </span>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(a.occurredAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-4 text-center text-sm text-muted-foreground">
              No high-risk audit activity recorded.
            </div>
          )}
        </DashboardPanel>
        <DashboardPanel
          title="Workforce Distribution"
          description="Current employees by department"
          viewAllLabel="Employee Directory"
          viewAllTo="/staff/employees"
        >
          <BreakdownBars items={departmentCounts} emptyMessage="No current employees recorded." />
        </DashboardPanel>
        <DashboardPanel
          title="Executive Operations"
          description="Cross-functional items requiring final control"
          viewAllLabel="Reports Centre"
          viewAllTo="/staff/reports"
          className="lg:col-span-2"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Final leave approvals", pendingLeave.length],
              ["Prepared payroll periods", pendingPayroll.length],
              ["Reimbursements to close", reimbursementClosures.length],
              ["Critical document risks", criticalExpiries.length],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border bg-muted/20 p-4">
                <p className="text-2xl font-bold tabular-nums">{value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        </DashboardPanel>
      </div>
    </div>
  );
}
