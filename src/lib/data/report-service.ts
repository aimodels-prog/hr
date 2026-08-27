import { EmployeeService } from "./employee-service";
import { LeaveService } from "./leave-service";
import { TimesheetService } from "./timesheet-service";
import { RecruitmentService } from "./recruitment-service";
import { PerformanceService } from "./performance-service";
import { TrainingService } from "./training-service";
import { DocumentService } from "./document-service";
import { TravelService } from "./travel-service";
import { PayrollService } from "./payroll-service";
import { OnboardingService } from "./onboarding-service";
import { getApplicationDataServices } from "./application-data";
import type { Employee, Role } from "./types";
import { SYSTEM_ACTOR } from "./types";

export type ReportColumn = {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "currency";
};

export type ReportData = {
  id: string;
  name: string;
  description: string;
  columns: ReportColumn[];
  rows: Record<string, any>[];
  containsPersonalData: boolean;
};

export class ReportService {
  private activeRole: Role;
  private currentEmployee: Employee | null;
  private userId: string;

  constructor(userId: string, activeRole: Role, currentEmployee: Employee | null) {
    this.userId = userId;
    this.activeRole = activeRole;
    this.currentEmployee = currentEmployee;
  }

  // Report ids whose content is genuinely payroll/finance-relevant and therefore
  // appropriate for Accounts to see company-wide (matches the "Payroll Inputs
  // Summary" and "Travel Variance" entries Accounts is offered in
  // getAvailableReports). Every other report surfaces company-wide personal HR
  // data (performance, leave, documents, headcount, etc.) that Accounts has no
  // business seeing beyond their own record - see src/lib/auth/record-scope.ts,
  // which documents that Accounts' payroll access must never widen their
  // employee-directory scope.
  private static readonly ACCOUNTS_SCOPED_REPORT_IDS = new Set(["payroll", "travel"]);

  private getScopedEmployees(reportId?: string) {
    const empService = new EmployeeService();
    const allEmployees = empService.getEmployees();

    if (this.activeRole === "HR" || this.activeRole === "Super Admin") {
      return allEmployees;
    }

    if (this.activeRole === "Accounts") {
      if (reportId && ReportService.ACCOUNTS_SCOPED_REPORT_IDS.has(reportId)) {
        return allEmployees;
      }
      // Non-payroll reports: Accounts is restricted to their own record, same
      // as the record-scope.ts "self only" rule for this role.
      return this.currentEmployee ? [this.currentEmployee] : [];
    }

    if (this.activeRole === "Line Manager" && this.currentEmployee) {
      return allEmployees.filter(
        (e) => e.lineManagerId === this.currentEmployee!.id || e.id === this.currentEmployee!.id,
      );
    }

    if (this.currentEmployee) {
      return [this.currentEmployee];
    }

    return [];
  }

  getAvailableReports(): { id: string; name: string; category: string }[] {
    const reports = [
      { id: "headcount", name: "Headcount & Diversity", category: "Core HR" },
      { id: "recruitment", name: "Recruitment Funnel", category: "Recruitment" },
      { id: "leave_balances", name: "Leave Balances", category: "Time & Attendance" },
      { id: "timesheet_completion", name: "Timesheet Completion", category: "Time & Attendance" },
      { id: "performance", name: "Performance Distribution", category: "Performance" },
      { id: "training", name: "Training Certifications", category: "Training" },
      { id: "documents", name: "Document Expiries", category: "Compliance" },
      { id: "travel", name: "Travel Variance", category: "Operations" },
      { id: "onboarding", name: "Onboarding Progress", category: "Operations" },
    ];

    if (this.activeRole === "Accounts" || this.activeRole === "Super Admin") {
      reports.push({ id: "payroll", name: "Payroll Inputs Summary", category: "Finance" });
    }

    if (this.activeRole === "Accounts") {
      // Accounts only gets payroll/finance-relevant reports - see
      // getScopedEmployees for why the rest are off-limits.
      return reports.filter((r) => ReportService.ACCOUNTS_SCOPED_REPORT_IDS.has(r.id));
    }

    return reports;
  }

  generateReport(reportId: string): ReportData {
    const scopedEmployees = this.getScopedEmployees(reportId);
    const scopedIds = new Set(scopedEmployees.map((e) => e.id));

    switch (reportId) {
      case "headcount":
        return {
          id: "headcount",
          name: "Headcount & Diversity",
          description: "Current workforce metrics across departments and locations.",
          containsPersonalData: true,
          columns: [
            { key: "employeeNumber", label: "Employee ID" },
            { key: "name", label: "Name" },
            { key: "department", label: "Department" },
            { key: "location", label: "Location" },
            { key: "employmentType", label: "Type" },
            { key: "status", label: "Status" },
            { key: "startDate", label: "Start Date", type: "date" },
            ...(this.activeRole === "HR" || this.activeRole === "Super Admin"
              ? [{ key: "salary", label: "Base Salary", type: "currency" as const }]
              : []),
          ],
          rows: scopedEmployees.map((e) => ({
            employeeNumber: e.employeeNumber,
            name: e.legalName,
            department: e.department,
            location: e.location,
            employmentType: e.employmentType,
            status: e.status,
            startDate: e.startDate,
            salary: e.salary,
          })),
        };

      case "leave_balances": {
        const leaveService = new LeaveService();
        const policies = leaveService.getPolicies();

        return {
          id: "leave_balances",
          name: "Leave Balances",
          description: "Current employee leave balances.",
          containsPersonalData: false,
          columns: [
            { key: "employee", label: "Employee" },
            { key: "department", label: "Department" },
            ...policies.map((p) => ({
              key: `policy_${p.id}`,
              label: p.name,
              type: "number" as const,
            })),
          ],
          rows: scopedEmployees.map((e) => {
            const balances = leaveService.getAllBalancesForEmployee(e.id);
            const row: Record<string, any> = {
              employee: e.legalName,
              department: e.department,
            };
            policies.forEach((p) => {
              const bal = balances.find((b) => b.policyId === p.id);
              row[`policy_${p.id}`] = bal ? bal.available : 0;
            });
            return row;
          }),
        };
      }

      case "timesheet_completion": {
        const tsService = new TimesheetService();
        const timesheets = tsService.getAllTimesheets().filter((t) => scopedIds.has(t.employeeId));
        return {
          id: "timesheet_completion",
          name: "Timesheet Completion",
          description: "Timesheet submission status and billed hours.",
          containsPersonalData: false,
          columns: [
            { key: "period", label: "Period" },
            { key: "employee", label: "Employee" },
            { key: "status", label: "Status" },
            { key: "totalHours", label: "Total Hours", type: "number" },
            { key: "overtime", label: "Overtime Hours", type: "number" },
          ],
          rows: timesheets.map((t) => {
            const emp = scopedEmployees.find((e) => e.id === t.employeeId);
            return {
              period: t.periodId,
              employee: emp?.legalName || "Unknown",
              status: t.status,
              totalHours: t.totalHours,
              overtime: Math.max(0, t.totalHours - t.expectedHours),
            };
          }),
        };
      }

      case "recruitment": {
        const recService = new RecruitmentService();
        // Even for managers, show candidates for their department? For now, we'll return all if HR/Admin, or limit if Manager.
        // Actually, recruitment is usually HR only, but managers might see their own.
        // Let's keep it simple: if Manager, filter to vacancies they manage.
        const vacancies = recService
          .getVacancies()
          .filter(
            (v) =>
              this.activeRole === "HR" ||
              this.activeRole === "Super Admin" ||
              v.hiringManagerId === this.currentEmployee?.id,
          );
        const vacIds = new Set(vacancies.map((v) => v.id));
        const candidates = recService
          .getCandidates()
          .filter((c) => c.applications.some((a) => vacIds.has(a.vacancyId)));

        return {
          id: "recruitment",
          name: "Recruitment Funnel",
          description: "Candidate applications and outcomes.",
          containsPersonalData: true,
          columns: [
            { key: "candidate", label: "Candidate Name" },
            { key: "source", label: "Source" },
            { key: "vacancy", label: "Vacancy" },
            { key: "stage", label: "Current Stage" },
            { key: "score", label: "AI Score", type: "number" },
          ],
          rows: candidates.flatMap((c) =>
            c.applications
              .filter((a) => vacIds.has(a.vacancyId))
              .map((a) => {
                const vac = vacancies.find((v) => v.id === a.vacancyId);
                return {
                  candidate: c.name,
                  source: c.source,
                  vacancy: vac?.title || "Unknown",
                  stage: c.stage,
                  score: c.score,
                };
              }),
          ),
        };
      }

      case "training": {
        const trainService = new TrainingService();
        const records = trainService.getRecords().filter((r) => scopedIds.has(r.employeeId));
        return {
          id: "training",
          name: "Training Certifications",
          description: "Employee self-certified training records.",
          containsPersonalData: false,
          columns: [
            { key: "employee", label: "Employee" },
            { key: "title", label: "Certification Title" },
            { key: "provider", label: "Provider" },
            { key: "completionDate", label: "Completion Date", type: "date" },
            { key: "expiryDate", label: "Expiry Date", type: "date" },
          ],
          rows: records.map((r) => {
            const emp = scopedEmployees.find((e) => e.id === r.employeeId);
            return {
              employee: emp?.legalName || "Unknown",
              title: r.title,
              provider: r.provider,
              completionDate: r.completionDate,
              expiryDate: r.expiryDate || "N/A",
            };
          }),
        };
      }

      case "performance": {
        const perfService = new PerformanceService();
        const reviews = perfService.getReviews().filter((r) => scopedIds.has(r.employeeId));
        return {
          id: "performance",
          name: "Performance Distribution",
          description: "Performance review scores and statuses.",
          containsPersonalData: true,
          columns: [
            { key: "employee", label: "Employee" },
            { key: "cycle", label: "Review Cycle" },
            { key: "status", label: "Status" },
            { key: "score", label: "Weighted Score", type: "number" },
          ],
          rows: reviews.map((r) => {
            const emp = scopedEmployees.find((e) => e.id === r.employeeId);
            return {
              employee: emp?.legalName || "Unknown",
              cycle: r.cycleId,
              status: r.status,
              score: r.overallManagerScore ?? r.overallSelfScore ?? 0,
            };
          }),
        };
      }

      case "documents": {
        const docService = new DocumentService();
        const docs = docService
          .getDocumentRepository()
          .list()
          .filter((d) => scopedIds.has(d.employeeId) && d.expiryDate);
        return {
          id: "documents",
          name: "Document Expiries",
          description: "Track document expiration dates across the workforce.",
          containsPersonalData: false,
          columns: [
            { key: "employee", label: "Employee" },
            { key: "type", label: "Document Type" },
            { key: "expiryDate", label: "Expiry Date", type: "date" },
            { key: "status", label: "Status" },
          ],
          rows: docs.map((d) => {
            const emp = scopedEmployees.find((e) => e.id === d.employeeId);
            const isExpired = new Date(d.expiryDate!) < new Date();
            return {
              employee: emp?.legalName || "Unknown",
              type: d.type,
              expiryDate: d.expiryDate,
              status: isExpired ? "Expired" : "Valid",
            };
          }),
        };
      }

      case "travel": {
        const travelService = new TravelService();
        const requests = travelService
          .getAllRequests({ actor: { ...SYSTEM_ACTOR, activeRole: "Super Admin" }, reason: "Internal report generation" })
          .filter((r) => scopedIds.has(r.employeeId));
        return {
          id: "travel",
          name: "Travel Variance",
          description: "Compare estimated travel costs to actual reimbursements.",
          containsPersonalData: false,
          columns: [
            { key: "employee", label: "Employee" },
            { key: "destination", label: "Destination" },
            { key: "status", label: "Status" },
            { key: "estimatedCost", label: "Estimated Cost", type: "currency" },
            { key: "actualCost", label: "Actual Cost", type: "currency" },
            { key: "variance", label: "Variance", type: "currency" },
          ],
          rows: requests.map((r) => {
            const emp = scopedEmployees.find((e) => e.id === r.employeeId);
            // Prefer the currency-safe OMR-equivalent total (see TravelService.submitExpenses / actualTotalOmr)
            // over the raw actualTotal, which silently mixes currencies when expense lines aren't all in OMR.
            // Fall back to actualTotal only for records closed before actualTotalOmr existed.
            const actual = r.actualTotalOmr ?? r.actualTotal ?? 0;
            return {
              employee: emp?.legalName || "Unknown",
              destination: r.destination,
              status: r.status,
              estimatedCost: r.totalEstimate,
              actualCost: actual,
              variance: r.status === "Closed" ? actual - r.totalEstimate : 0,
            };
          }),
        };
      }

      case "onboarding": {
        const obService = new OnboardingService();
        const cases = obService.getCases().filter((c) => scopedIds.has(c.employeeId));
        return {
          id: "onboarding",
          name: "Onboarding Progress",
          description: "Track completion of onboarding workflows.",
          containsPersonalData: false,
          columns: [
            { key: "employee", label: "Employee" },
            { key: "progress", label: "Completion %", type: "number" },
            { key: "totalTasks", label: "Total Tasks", type: "number" },
            { key: "completedTasks", label: "Completed", type: "number" },
            { key: "overdueTasks", label: "Overdue", type: "number" },
          ],
          rows: cases.map((c) => {
            const emp = scopedEmployees.find((e) => e.id === c.employeeId);
            const completed = c.tasks.filter(
              (t) => t.status === "Completed" || t.status === "Waived",
            ).length;
            const overdue = c.tasks.filter(
              (t) => t.status === "Pending" && new Date(t.dueDate) < new Date(),
            ).length;
            return {
              employee: emp?.legalName || "Unknown",
              progress: c.progressPercentage,
              totalTasks: c.tasks.length,
              completedTasks: completed,
              overdueTasks: overdue,
            };
          }),
        };
      }

      case "payroll": {
        if (this.activeRole !== "Accounts" && this.activeRole !== "Super Admin") {
          throw new Error("Unauthorized to access payroll reports.");
        }
        const payrollService = new PayrollService();
        const periods = payrollService.getAllPeriods();
        return {
          id: "payroll",
          name: "Payroll Inputs Summary",
          description: "Consolidated payroll inputs for the current periods.",
          containsPersonalData: true,
          columns: [
            { key: "period", label: "Period" },
            { key: "employee", label: "Employee" },
            { key: "approvedOvertimeHours", label: "Approved Overtime (hrs)", type: "number" },
            { key: "unpaidLeaveDays", label: "Unpaid Leave (days)", type: "number" },
            { key: "reimbursementsTotal", label: "Reimbursements", type: "currency" },
            { key: "manualAdjustmentsTotal", label: "Manual Adjustments", type: "currency" },
          ],
          rows: periods
            .flatMap((p) =>
              (p.compiledInputs ?? []).map((line) => {
                const emp = scopedEmployees.find((e) => e.id === line.employeeId);
                return {
                  period: p.name,
                  employee: emp?.legalName || "Unknown",
                  approvedOvertimeHours: line.approvedOvertimeHours,
                  unpaidLeaveDays: line.unpaidLeaveDays,
                  reimbursementsTotal: line.reimbursementsTotal,
                  manualAdjustmentsTotal: line.manualAdjustmentsTotal,
                };
              }),
            )
            .filter((r) => r.employee !== "Unknown"),
        };
      }

      default:
        throw new Error("Report not found");
    }
  }

  logReportExport(reportId: string, format: string) {
    const report = this.generateReport(reportId);
    if (report.containsPersonalData) {
      const { audit } = getApplicationDataServices();
      audit.record({
        context: {
          actor: {
            userId: this.userId,
            displayName: this.currentEmployee?.legalName || "System",
            roles: [this.activeRole],
          },
        },
        action: `Exported Report: ${report.name}`,
        module: "reports",
        entityType: "report",
        entityId: reportId,
        reason: `Exported to ${format} format`,
        riskLevel: "Medium",
        after: { rowCount: report.rows.length },
      });
    }
  }
}
