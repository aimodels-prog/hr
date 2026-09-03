import { SYSTEM_CONTEXT } from "./types.ts";
import { EmployeeService } from "./employee-service.ts";
import { LeaveService } from "./leave-service.ts";
import { TimesheetService } from "./timesheet-service.ts";
import { RecruitmentService } from "./recruitment-service.ts";
import { PerformanceService } from "./performance-service.ts";
import { TrainingService } from "./training-service.ts";
import { DocumentService } from "./document-service.ts";
import { TravelService } from "./travel-service.ts";
import { PayrollService } from "./payroll-service.ts";
import { OnboardingService } from "./onboarding-service.ts";
import { getApplicationDataServices } from "./application-data.ts";
import type {
  ActorContext,
  Candidate,
  CandidateApplication,
  CandidateContact,
  CandidateRecommendation,
  Employee,
  Role,
  Vacancy,
} from "./types.ts";
import { SYSTEM_ACTOR } from "./types.ts";
import type { LeaveRequest } from "./leave-types.ts";
import type { TimesheetWithEntries } from "./timesheet-types.ts";
import type { AttendanceRecord } from "./attendance-types.ts";
import type { OvertimeClaim } from "./overtime-types.ts";
import type { OffboardingCase } from "./offboarding-types.ts";
import { LocalRepository } from "./repository.ts";
import type { BaseRecord } from "./types.ts";
import {
  deleteReportViewFn,
  exportReportCsvFn,
  generateReportFn,
  getAvailableReportsFn,
  getSavedReportViewsFn,
  saveReportViewFn,
} from "../server-functions/report.server.ts";

export type ReportColumn = {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "currency";
};

export type ReportCellValue = string | number | boolean | null | undefined;

export type ReportData = {
  id: string;
  name: string;
  description: string;
  columns: ReportColumn[];
  rows: Record<string, ReportCellValue>[];
  containsPersonalData: boolean;
};

export interface ReportFilters {
  search: string;
  dateFrom: string;
  dateTo: string;
  department: string;
  status: string;
}

export interface ReportSavedView extends BaseRecord {
  ownerUserId: string;
  reportId: string;
  name: string;
  filters: ReportFilters;
}

export class ReportService {
  private activeRole: Role;
  private currentEmployee: Employee | null;
  private userId: string;

  constructor(userId: string, activeRole: Role, currentEmployee: Employee | null) {
    this.userId = userId;
    this.activeRole = activeRole;
    this.currentEmployee = currentEmployee;
  }

  private getServerActor() {
    return {
      actorId: this.userId,
      actorEmail: this.currentEmployee?.workEmail,
      activeRole: this.activeRole,
    };
  }

  async getAvailableReportsFromDatabase() {
    return getAvailableReportsFn({ data: { actor: this.getServerActor() } });
  }

  async generateReportFromDatabase(reportId: string, filters: ReportFilters) {
    return generateReportFn({ data: { actor: this.getServerActor(), reportId, filters } });
  }

  async getSavedViewsFromDatabase(reportId: string): Promise<ReportSavedView[]> {
    const views = await getSavedReportViewsFn({
      data: { actor: this.getServerActor(), reportId },
    });
    return views.map((view) => ({
      ...view,
      createdAt: new Date(view.createdAt).toISOString(),
      updatedAt: new Date(view.updatedAt).toISOString(),
      archivedAt: view.archivedAt ? new Date(view.archivedAt).toISOString() : undefined,
    }));
  }

  async saveViewToDatabase(reportId: string, name: string, filters: ReportFilters) {
    return saveReportViewFn({
      data: { actor: this.getServerActor(), reportId, name, filters },
    });
  }

  async deleteSavedViewFromDatabase(viewId: string) {
    return deleteReportViewFn({ data: { actor: this.getServerActor(), viewId } });
  }

  async exportReportFromDatabase(reportId: string, filters: ReportFilters) {
    return exportReportCsvFn({
      data: { actor: this.getServerActor(), reportId, filters },
    });
  }

  private getActorContext(): ActorContext {
    return {
      actor: {
        userId: this.userId,
        ...(this.currentEmployee ? { employeeId: this.currentEmployee.id } : {}),
        displayName: this.currentEmployee?.preferredName ?? "Report viewer",
        roles: [this.activeRole],
        activeRole: this.activeRole,
      },
      reason: "Viewed an HR report",
    };
  }

  private requireReportAccess(reportId?: string): void {
    const allowed = ["HR", "Super Admin", "Accounts"].includes(this.activeRole);
    const accountsAllowed =
      this.activeRole !== "Accounts" ||
      !reportId ||
      ReportService.ACCOUNTS_SCOPED_REPORT_IDS.has(reportId);
    if (allowed && accountsAllowed) return;
    const { audit } = getApplicationDataServices();
    audit.record({
      context: this.getActorContext(),
      action: "access-denied",
      module: "reports",
      entityType: "report",
      entityId: reportId ?? "reports-centre",
      reason: "This role is not authorised to access the requested report.",
      riskLevel: "High",
    });
    throw new Error("You do not have permission to view this report.");
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
    const allEmployees = empService.getEmployees(SYSTEM_CONTEXT);

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
    this.requireReportAccess();
    const reports = [
      { id: "headcount", name: "Headcount & Diversity", category: "Core HR" },
      { id: "recruitment", name: "Recruitment Funnel", category: "Recruitment" },
      { id: "recruitment_sources", name: "Candidate Sources", category: "Recruitment" },
      { id: "recommenders", name: "Recommender Outcomes", category: "Recruitment" },
      { id: "contact_activity", name: "Candidate Contact Activity", category: "Recruitment" },
      { id: "leave_balances", name: "Leave Balances", category: "Time & Attendance" },
      { id: "leave_usage", name: "Leave Usage & Upcoming Absence", category: "Time & Attendance" },
      { id: "timesheet_completion", name: "Timesheet Completion", category: "Time & Attendance" },
      {
        id: "timesheet_projects",
        name: "Project & Cost Centre Hours",
        category: "Time & Attendance",
      },
      { id: "attendance", name: "Attendance Exceptions", category: "Time & Attendance" },
      { id: "overtime", name: "Overtime Summary", category: "Time & Attendance" },
      { id: "performance", name: "Performance Distribution", category: "Performance" },
      { id: "training", name: "Training Certifications", category: "Training" },
      { id: "documents", name: "Document Expiries", category: "Compliance" },
      { id: "travel", name: "Travel Variance", category: "Operations" },
      { id: "onboarding", name: "Onboarding Progress", category: "Operations" },
      { id: "offboarding", name: "Offboarding Progress", category: "Operations" },
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

  getSavedViews(reportId: string): ReportSavedView[] {
    this.requireReportAccess(reportId);
    return this.getSavedViewRepository()
      .list()
      .filter((view) => view.ownerUserId === this.userId && view.reportId === reportId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  saveView(reportId: string, name: string, filters: ReportFilters): ReportSavedView {
    this.requireReportAccess(reportId);
    const cleanName = name.trim();
    if (cleanName.length < 2 || cleanName.length > 60) {
      throw new Error("View name must be between 2 and 60 characters.");
    }
    const repository = this.getSavedViewRepository();
    const duplicate = repository
      .list()
      .find(
        (view) =>
          view.ownerUserId === this.userId &&
          view.reportId === reportId &&
          view.name.toLowerCase() === cleanName.toLowerCase(),
      );
    if (duplicate) {
      return repository.update(
        duplicate.id,
        { filters, name: cleanName },
        { ...this.getActorContext(), reason: "Saved report view updated" },
      );
    }
    return repository.create(
      { ownerUserId: this.userId, reportId, name: cleanName, filters },
      { ...this.getActorContext(), reason: "Saved report view created" },
    );
  }

  deleteSavedView(viewId: string): void {
    const repository = this.getSavedViewRepository();
    const view = repository.getById(viewId);
    if (!view || view.ownerUserId !== this.userId) {
      throw new Error("The saved view was not found.");
    }
    this.requireReportAccess(view.reportId);
    repository.archive(viewId, {
      ...this.getActorContext(),
      reason: "Saved report view removed",
    });
  }

  private getSavedViewRepository(): LocalRepository<ReportSavedView> {
    const { storage, audit } = getApplicationDataServices();
    return new LocalRepository<ReportSavedView>("reportSavedViews", storage, audit, {
      module: "reports",
      entityType: "saved-report-view",
    });
  }

  generateReport(reportId: string): ReportData {
    this.requireReportAccess(reportId);
    const scopedEmployees = this.getScopedEmployees(reportId);
    const scopedIds = new Set(scopedEmployees.map((e) => e.id));
    const { storage } = getApplicationDataServices();
    const employeeName = (id: string) =>
      scopedEmployees.find((employee) => employee.id === id)?.legalName ?? "Unknown";

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
            ...(this.activeRole === "Super Admin"
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
            salary: e.salary?.baseMonthly,
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
            const balances = leaveService.getAllBalancesForEmployee(e.id, this.getActorContext());
            const row: Record<string, ReportCellValue> = {
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
        const timesheets = tsService
          .getAllTimesheets(this.getActorContext())
          .filter((t) => scopedIds.has(t.employeeId));
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

      case "recruitment_sources": {
        const candidates = storage.readCollection<Candidate>("candidates");
        const vacancies = storage.readCollection<Vacancy>("vacancies");
        const applications = storage.readCollection<CandidateApplication>("applications");
        return {
          id: reportId,
          name: "Candidate Sources",
          description: "Application sources, current outcomes and the roles they supported.",
          containsPersonalData: true,
          columns: [
            { key: "candidate", label: "Candidate" },
            { key: "vacancy", label: "Vacancy" },
            { key: "source", label: "Source" },
            { key: "status", label: "Status" },
            { key: "date", label: "Applied", type: "date" },
          ],
          rows: applications.map((application) => ({
            candidate: (() => {
              const candidate = candidates.find((item) => item.id === application.candidateId);
              return candidate ? `${candidate.firstName} ${candidate.lastName}`.trim() : "Unknown";
            })(),
            vacancy:
              vacancies.find((vacancy) => vacancy.id === application.vacancyId)?.title ?? "Unknown",
            source: application.source,
            status: application.status,
            date: application.createdAt.slice(0, 10),
          })),
        };
      }

      case "recommenders": {
        const candidates = storage.readCollection<Candidate>("candidates");
        const vacancies = storage.readCollection<Vacancy>("vacancies");
        const recommendations = storage.readCollection<CandidateRecommendation>(
          "candidate_recommendations",
        );
        return {
          id: reportId,
          name: "Recommender Outcomes",
          description: "Who recommended each candidate, the HR owner and the current outcome.",
          containsPersonalData: true,
          columns: [
            { key: "recommender", label: "Recommender" },
            { key: "company", label: "Company" },
            { key: "candidate", label: "Candidate" },
            { key: "vacancy", label: "Vacancy" },
            { key: "owner", label: "HR Owner" },
            { key: "status", label: "Outcome" },
            { key: "date", label: "Date", type: "date" },
          ],
          rows: recommendations.map((recommendation) => ({
            recommender: recommendation.recommenderName,
            company: recommendation.recommenderCompany ?? "Independent",
            candidate: (() => {
              const candidate = candidates.find((item) => item.id === recommendation.candidateId);
              return candidate ? `${candidate.firstName} ${candidate.lastName}`.trim() : "Unknown";
            })(),
            vacancy:
              vacancies.find((vacancy) => vacancy.id === recommendation.vacancyId)?.title ??
              "Candidate Pool",
            owner:
              scopedEmployees.find((employee) => employee.id === recommendation.hrOwnerId)
                ?.legalName ?? "Unassigned",
            status: recommendation.sourceOutcome,
            date: recommendation.date,
          })),
        };
      }

      case "contact_activity": {
        const candidates = storage.readCollection<Candidate>("candidates");
        const contacts = storage.readCollection<CandidateContact>("candidate_contacts");
        return {
          id: reportId,
          name: "Candidate Contact Activity",
          description: "A clear record of candidate contact, ownership and follow-up outcomes.",
          containsPersonalData: true,
          columns: [
            { key: "candidate", label: "Candidate" },
            { key: "channel", label: "Channel" },
            { key: "owner", label: "Contacted By" },
            { key: "status", label: "Outcome" },
            { key: "date", label: "Contact Date", type: "date" },
            { key: "followUp", label: "Next Follow-up", type: "date" },
          ],
          rows: contacts.map((contact) => ({
            candidate: (() => {
              const candidate = candidates.find((item) => item.id === contact.candidateId);
              return candidate ? `${candidate.firstName} ${candidate.lastName}`.trim() : "Unknown";
            })(),
            channel: contact.channel,
            owner:
              storage
                .readCollection<{ id: string; displayName: string }>("users")
                .find((user) => user.id === contact.contactedByUserId)?.displayName ?? "Unknown",
            status: contact.outcome,
            date: contact.date.slice(0, 10),
            followUp: contact.nextFollowUpDate ?? "",
          })),
        };
      }

      case "leave_usage": {
        const requests = storage
          .readCollection<LeaveRequest>("leave_requests")
          .filter((request) => scopedIds.has(request.employeeId));
        const policies = new LeaveService().getPolicies();
        return {
          id: reportId,
          name: "Leave Usage & Upcoming Absence",
          description: "Submitted leave, approval status and scheduled working days away.",
          containsPersonalData: true,
          columns: [
            { key: "employee", label: "Employee" },
            { key: "department", label: "Department" },
            { key: "leaveType", label: "Leave Type" },
            { key: "startDate", label: "Start", type: "date" },
            { key: "endDate", label: "End", type: "date" },
            { key: "days", label: "Working Days", type: "number" },
            { key: "status", label: "Status" },
          ],
          rows: requests.map((request) => {
            const employee = scopedEmployees.find((item) => item.id === request.employeeId);
            return {
              employee: employeeName(request.employeeId),
              department: employee?.department ?? "Unknown",
              leaveType:
                policies.find((policy) => policy.id === request.policyId)?.name ?? "Unknown",
              startDate: request.startDate,
              endDate: request.endDate,
              days: request.workingDaysRequested,
              status: request.status,
            };
          }),
        };
      }

      case "timesheet_projects": {
        const projects = storage.readCollection<{ id: string; name: string }>("projects");
        const costCentres = storage.readCollection<{ id: string; name: string }>("costCentres");
        const timesheets = storage
          .readCollection<TimesheetWithEntries>("timesheets")
          .filter((timesheet) => scopedIds.has(timesheet.employeeId));
        return {
          id: reportId,
          name: "Project & Cost Centre Hours",
          description: "Approved and submitted time allocated to projects and cost centres.",
          containsPersonalData: true,
          columns: [
            { key: "employee", label: "Employee" },
            { key: "project", label: "Project" },
            { key: "costCentre", label: "Cost Centre" },
            { key: "hours", label: "Hours", type: "number" },
            { key: "status", label: "Timesheet Status" },
          ],
          rows: timesheets.flatMap((timesheet) =>
            timesheet.entries.map((entry) => ({
              employee: employeeName(timesheet.employeeId),
              project:
                projects.find((project) => project.id === entry.projectId)?.name ?? "Unknown",
              costCentre:
                costCentres.find((costCentre) => costCentre.id === entry.costCentreId)?.name ??
                "Unknown",
              hours: entry.total,
              status: timesheet.status,
            })),
          ),
        };
      }

      case "attendance": {
        const records = storage
          .readCollection<AttendanceRecord>("attendanceRecords")
          .filter((record) => scopedIds.has(record.employeeId));
        return {
          id: reportId,
          name: "Attendance Exceptions",
          description: "Daily attendance hours, late arrivals and records requiring attention.",
          containsPersonalData: true,
          columns: [
            { key: "employee", label: "Employee" },
            { key: "date", label: "Date", type: "date" },
            { key: "location", label: "Location" },
            { key: "hours", label: "Hours", type: "number" },
            { key: "status", label: "Status" },
            { key: "late", label: "Late" },
          ],
          rows: records.map((record) => ({
            employee: employeeName(record.employeeId),
            date: record.date,
            location: record.location ?? "Not recorded",
            hours: record.calculatedHours,
            status: record.status,
            late: record.isLate ? "Yes" : "No",
          })),
        };
      }

      case "overtime": {
        const claims = storage
          .readCollection<OvertimeClaim>("overtimeClaims")
          .filter((claim) => scopedIds.has(claim.employeeId));
        return {
          id: reportId,
          name: "Overtime Summary",
          description: "Overtime requests, compensation choices and approval outcomes.",
          containsPersonalData: true,
          columns: [
            { key: "employee", label: "Employee" },
            { key: "date", label: "Date", type: "date" },
            { key: "hours", label: "Hours", type: "number" },
            { key: "compensation", label: "Compensation" },
            { key: "status", label: "Status" },
            { key: "warnings", label: "Review Notes" },
          ],
          rows: claims.map((claim) => ({
            employee: employeeName(claim.employeeId),
            date: claim.date,
            hours: claim.hours,
            compensation: claim.compensationType,
            status: claim.status,
            warnings: claim.crossCheckWarnings.join("; "),
          })),
        };
      }

      case "offboarding": {
        const cases = storage
          .readCollection<OffboardingCase>("offboardingCases")
          .filter((item) => scopedIds.has(item.employeeId));
        return {
          id: reportId,
          name: "Offboarding Progress",
          description: "Departures, clearance progress and outstanding offboarding work.",
          containsPersonalData: true,
          columns: [
            { key: "employee", label: "Employee" },
            { key: "reason", label: "Reason" },
            { key: "lastWorkingDate", label: "Last Working Date", type: "date" },
            { key: "progress", label: "Completion %", type: "number" },
            { key: "outstanding", label: "Outstanding Tasks", type: "number" },
            { key: "status", label: "Status" },
          ],
          rows: cases.map((item) => ({
            employee: employeeName(item.employeeId),
            reason: item.reasonCategory,
            lastWorkingDate: item.lastWorkingDate,
            progress: item.progressPercentage,
            outstanding: item.tasks.filter((task) => !["Completed", "Waived"].includes(task.status))
              .length,
            status: item.status,
          })),
        };
      }

      case "training": {
        const trainService = new TrainingService();
        const records = trainService
          .getRecords(this.getActorContext())
          .filter((r) => scopedIds.has(r.employeeId));
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
        const reviews = perfService
          .getReviews(this.getActorContext())
          .filter((r) => scopedIds.has(r.employeeId));
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
          .getDocumentRepository(SYSTEM_CONTEXT)
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
          .getAllRequests({
            actor: { ...SYSTEM_ACTOR, activeRole: "Super Admin" },
            reason: "Internal report generation",
          })
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
        const cases = obService
          .getCasesForContext(this.getActorContext())
          .filter((c) => scopedIds.has(c.employeeId));
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
        const periods = payrollService.getAllPeriods(this.getActorContext());
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
            { key: "reimbursementCurrency", label: "Reimbursement Currency" },
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
                  reimbursementCurrency: line.reimbursementsCurrency || "OMR",
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

  logReportExport(reportId: string, format: string, rowCount: number) {
    this.requireReportAccess(reportId);
    const report = this.generateReport(reportId);
    const { audit } = getApplicationDataServices();
    audit.record({
      context: this.getActorContext(),
      action: "export",
      module: "reports",
      entityType: "report",
      entityId: reportId,
      reason: `${report.name} exported as ${format}.`,
      riskLevel: report.containsPersonalData ? "High" : "Medium",
      after: { rowCount, format },
    });
  }
}
