import { getApplicationDataServices } from "./application-data.ts";
import { TimesheetService } from "./timesheet-service.ts";
import type { AttendanceCorrection, SiteVisitRequest } from "./attendance-types.ts";
import type { EmployeeGoal } from "./goal-service.ts";
import type { LeaveRequest } from "./leave-types.ts";
import type { OffboardingCase, OffboardingTask } from "./offboarding-types.ts";
import type { OnboardingCase, OnboardingTask } from "./onboarding-types.ts";
import type { OvertimeClaim } from "./overtime-types.ts";
import type { PayrollPeriod } from "./payroll-types.ts";
import type { PerformanceReview, ReviewCycle } from "./performance-types.ts";
import type { TimesheetPeriod, TimesheetWithEntries } from "./timesheet-types.ts";
import type { TrainingRecord } from "./training-types.ts";
import type { TravelRequest } from "./travel-types.ts";
import type {
  Candidate,
  CandidateContact,
  Employee,
  EmployeeDocument,
  InterviewEvent,
  InterviewScorecard,
  NotificationPriority,
  ProfileChangeRequest,
  Role,
} from "./types.ts";

export type TaskState = "Open" | "Due Soon" | "Overdue" | "Blocked";

export interface AppTask {
  id: string;
  module: string;
  title: string;
  description: string;
  priority: NotificationPriority;
  state: TaskState;
  actionLabel: string;
  actionUrl: string;
  sourceType: string;
  sourceId: string;
  dueDate?: string | undefined;
  subjectEmployeeId?: string | undefined;
  subjectName?: string | undefined;
}

export interface TaskViewer {
  userId: string;
  employeeId?: string | undefined;
  activeRole: Role;
}

interface TaskServiceOptions {
  now?: () => Date;
}

type AddTask = (task: Omit<AppTask, "state"> & { state?: TaskState | undefined }) => void;

function isActive(record: { archivedAt?: string | undefined }): boolean {
  return record.archivedAt === undefined;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

export class TaskService {
  private readonly now: () => Date;

  constructor(options: TaskServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  getMyTasks(viewer: TaskViewer): AppTask[] {
    const { storage } = getApplicationDataServices();
    const today = this.now().toISOString().slice(0, 10);
    const employees = storage.readCollection<Employee>("employees").filter(isActive);
    const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
    const directReportIds = new Set(
      employees
        .filter((employee) => employee.lineManagerId === viewer.employeeId)
        .map((employee) => employee.id),
    );
    const tasks = new Map<string, AppTask>();
    const employeeName = (employeeId: string): string =>
      employeeById.get(employeeId)?.preferredName ||
      employeeById.get(employeeId)?.legalName ||
      "Employee";
    const addTask: AddTask = (task) => {
      const state = task.state ?? this.getState(task.dueDate, today);
      const priority = state === "Overdue" && task.priority === "Normal" ? "High" : task.priority;
      tasks.set(task.id, { ...task, state, priority });
    };

    this.addEmployeeTasks(viewer, employeeName, today, addTask);
    this.addManagerTasks(viewer, directReportIds, employeeName, addTask);
    this.addLifecycleTasks(viewer, employeeById, addTask);
    this.addPerformanceTasks(viewer, directReportIds, employeeName, addTask);
    this.addHrTasks(viewer, employeeName, today, addTask);
    this.addAccountsTasks(viewer, employeeName, addTask);
    this.addSuperAdminTasks(viewer, employeeName, addTask);
    this.addInterviewTasks(viewer, addTask);

    const stateOrder: Record<TaskState, number> = {
      Overdue: 0,
      "Due Soon": 1,
      Open: 2,
      Blocked: 3,
    };
    return [...tasks.values()].sort((a, b) => {
      const byState = stateOrder[a.state] - stateOrder[b.state];
      if (byState !== 0) return byState;
      const byPriority = this.priorityWeight(b.priority) - this.priorityWeight(a.priority);
      if (byPriority !== 0) return byPriority;
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return a.title.localeCompare(b.title);
    });
  }

  private addEmployeeTasks(
    viewer: TaskViewer,
    employeeName: (employeeId: string) => string,
    today: string,
    addTask: AddTask,
  ): void {
    if (!viewer.employeeId) return;
    const { storage } = getApplicationDataServices();
    const periods = storage.readCollection<TimesheetPeriod>("timesheetPeriods");
    const periodById = new Map(periods.map((period) => [period.id, period]));
    const settings = new TimesheetService().getSettings();
    const timesheets = storage
      .readCollection<TimesheetWithEntries>("timesheets")
      .filter(
        (timesheet) =>
          isActive(timesheet) &&
          timesheet.employeeId === viewer.employeeId &&
          (timesheet.status === "Returned" ||
            (timesheet.status === "Draft" &&
              (periodById.get(timesheet.periodId)?.endDate ?? "9999-12-31") <= today)),
      );
    for (const timesheet of timesheets) {
      const period = periodById.get(timesheet.periodId);
      addTask({
        id: `timesheet-self-${timesheet.id}`,
        module: "Timesheets",
        title: timesheet.status === "Returned" ? "Correct returned timesheet" : "Submit timesheet",
        description:
          timesheet.status === "Returned"
            ? timesheet.managerNotes || "Your manager returned this timesheet for correction."
            : `Complete the timesheet for ${period?.startDate ?? "this period"} to ${period?.endDate ?? "the period end"}.`,
        priority: timesheet.status === "Returned" ? "High" : "Normal",
        dueDate: period ? addDays(period.endDate, settings.submissionDeadlineDays) : undefined,
        actionLabel: "Open timesheet",
        actionUrl: `/staff/me/timesheets/${timesheet.periodId}`,
        sourceType: "timesheet",
        sourceId: timesheet.id,
        subjectEmployeeId: viewer.employeeId,
        subjectName: employeeName(viewer.employeeId),
      });
    }

    for (const request of storage.readCollection<TravelRequest>("travelRequests")) {
      if (
        isActive(request) &&
        request.employeeId === viewer.employeeId &&
        request.status === "Pre-authorised" &&
        request.endDate < today
      ) {
        addTask({
          id: `travel-expenses-${request.id}`,
          module: "Travel",
          title: "Submit trip expenses",
          description: `Add bills and expense references for your trip to ${request.destination}.`,
          priority: "Normal",
          dueDate: addDays(request.endDate, 7),
          actionLabel: "Add expenses",
          actionUrl: `/staff/travel/${request.id}`,
          sourceType: "travel-request",
          sourceId: request.id,
          subjectEmployeeId: request.employeeId,
          subjectName: employeeName(request.employeeId),
        });
      }
    }

    for (const document of storage.readCollection<EmployeeDocument>("employee_documents")) {
      if (
        isActive(document) &&
        document.employeeId === viewer.employeeId &&
        document.status === "Rejected"
      ) {
        addTask({
          id: `document-replace-${document.id}`,
          module: "Documents",
          title: "Replace rejected document",
          description:
            document.rejectionReason || `Upload a corrected ${document.type.replaceAll("_", " ")}.`,
          priority: "High",
          actionLabel: "Open documents",
          actionUrl: "/staff/me/profile",
          sourceType: "employee-document",
          sourceId: document.id,
          subjectEmployeeId: document.employeeId,
          subjectName: employeeName(document.employeeId),
        });
      }
    }
  }

  private addManagerTasks(
    viewer: TaskViewer,
    directReportIds: Set<string>,
    employeeName: (employeeId: string) => string,
    addTask: AddTask,
  ): void {
    if (viewer.activeRole !== "Line Manager" || !viewer.employeeId) return;
    const { storage } = getApplicationDataServices();
    for (const request of storage.readCollection<LeaveRequest>("leave_requests")) {
      if (
        isActive(request) &&
        request.status === "Pending Line Manager" &&
        directReportIds.has(request.employeeId)
      ) {
        addTask({
          id: `leave-manager-${request.id}`,
          module: "Leave",
          title: "Review leave request",
          description: `${employeeName(request.employeeId)} requested ${request.workingDaysRequested} working day${request.workingDaysRequested === 1 ? "" : "s"} of ${request.policySnapshot.name}.`,
          priority: "Normal",
          dueDate: addDays(request.createdAt.slice(0, 10), 2),
          actionLabel: "Review request",
          actionUrl: "/staff/leave-approvals",
          sourceType: "leave-request",
          sourceId: request.id,
          subjectEmployeeId: request.employeeId,
          subjectName: employeeName(request.employeeId),
        });
      }
    }
    for (const timesheet of storage.readCollection<TimesheetWithEntries>("timesheets")) {
      if (
        isActive(timesheet) &&
        timesheet.status === "Pending Manager" &&
        directReportIds.has(timesheet.employeeId)
      ) {
        addTask({
          id: `timesheet-manager-${timesheet.id}`,
          module: "Timesheets",
          title: "Review submitted timesheet",
          description: `${employeeName(timesheet.employeeId)} submitted ${timesheet.totalHours.toFixed(1)} hours.`,
          priority: "Normal",
          dueDate: addDays(
            timesheet.submittedAt?.slice(0, 10) ?? timesheet.updatedAt.slice(0, 10),
            2,
          ),
          actionLabel: "Review timesheet",
          actionUrl: `/staff/timesheet-approvals/${timesheet.id}`,
          sourceType: "timesheet",
          sourceId: timesheet.id,
          subjectEmployeeId: timesheet.employeeId,
          subjectName: employeeName(timesheet.employeeId),
        });
      }
    }
    for (const correction of storage.readCollection<AttendanceCorrection>(
      "attendanceCorrections",
    )) {
      if (
        isActive(correction) &&
        correction.status === "Pending Manager" &&
        directReportIds.has(correction.employeeId)
      ) {
        addTask({
          id: `attendance-manager-${correction.id}`,
          module: "Attendance",
          title: "Review attendance correction",
          description: `${employeeName(correction.employeeId)} submitted a ${correction.correctionType.toLowerCase()} request.`,
          priority: "High",
          dueDate: addDays(correction.createdAt.slice(0, 10), 1),
          actionLabel: "Review correction",
          actionUrl: "/staff/attendance/corrections",
          sourceType: "attendance-correction",
          sourceId: correction.id,
          subjectEmployeeId: correction.employeeId,
          subjectName: employeeName(correction.employeeId),
        });
      }
    }
    for (const claim of storage.readCollection<OvertimeClaim>("overtimeClaims")) {
      if (
        isActive(claim) &&
        claim.status === "Pending Manager" &&
        directReportIds.has(claim.employeeId)
      ) {
        addTask({
          id: `overtime-manager-${claim.id}`,
          module: "Overtime",
          title: "Review overtime claim",
          description: `${employeeName(claim.employeeId)} submitted ${claim.hours} overtime hour${claim.hours === 1 ? "" : "s"}.`,
          priority: claim.crossCheckWarnings.length > 0 ? "High" : "Normal",
          dueDate: addDays(claim.createdAt.slice(0, 10), 2),
          actionLabel: "Review claim",
          actionUrl: "/staff/overtime-approvals",
          sourceType: "overtime-claim",
          sourceId: claim.id,
          subjectEmployeeId: claim.employeeId,
          subjectName: employeeName(claim.employeeId),
        });
      }
    }
    for (const goal of storage.readCollection<EmployeeGoal>("employeeGoals")) {
      if (goal.status === "Pending Approval" && directReportIds.has(goal.employeeId)) {
        addTask({
          id: `goal-manager-${goal.id}`,
          module: "Performance",
          title: "Review employee goal",
          description: `${employeeName(goal.employeeId)} submitted “${goal.title}” for approval.`,
          priority: "Normal",
          dueDate: addDays(goal.updatedAt.slice(0, 10), 3),
          actionLabel: "Review goals",
          actionUrl: "/staff/performance/goals",
          sourceType: "employee-goal",
          sourceId: goal.id,
          subjectEmployeeId: goal.employeeId,
          subjectName: employeeName(goal.employeeId),
        });
      }
    }
  }

  private addLifecycleTasks(
    viewer: TaskViewer,
    employeeById: Map<string, Employee>,
    addTask: AddTask,
  ): void {
    const { storage } = getApplicationDataServices();
    const employeeName = (employeeId: string) =>
      employeeById.get(employeeId)?.preferredName ||
      employeeById.get(employeeId)?.legalName ||
      "Employee";
    for (const onboardingCase of storage.readCollection<OnboardingCase>("onboardingCases")) {
      if (!isActive(onboardingCase) || onboardingCase.status !== "In Progress") continue;
      const employee = employeeById.get(onboardingCase.employeeId);
      for (const task of onboardingCase.tasks) {
        if (!this.isLifecycleTaskRelevant(viewer, employee, onboardingCase.employeeId, task))
          continue;
        addTask({
          id: `onboarding-${onboardingCase.id}-${task.id}`,
          module: "Onboarding",
          title: task.title,
          description:
            task.instructions || `${task.group} for ${employeeName(onboardingCase.employeeId)}.`,
          priority: task.isMandatory ? "High" : "Normal",
          dueDate: task.dueDate,
          state: task.status === "Blocked" ? "Blocked" : undefined,
          actionLabel: task.status === "Blocked" ? "View blocker" : "Open task",
          actionUrl:
            task.ownerRole === "Employee" && onboardingCase.employeeId === viewer.employeeId
              ? "/staff/me/onboarding"
              : `/staff/onboarding/${onboardingCase.id}`,
          sourceType: "onboarding-task",
          sourceId: task.id,
          subjectEmployeeId: onboardingCase.employeeId,
          subjectName: employeeName(onboardingCase.employeeId),
        });
      }
    }
    for (const offboardingCase of storage.readCollection<OffboardingCase>("offboardingCases")) {
      if (
        !isActive(offboardingCase) ||
        offboardingCase.status === "Completed" ||
        offboardingCase.status === "Cancelled"
      ) {
        continue;
      }
      const employee = employeeById.get(offboardingCase.employeeId);
      for (const task of offboardingCase.tasks) {
        if (!this.isLifecycleTaskRelevant(viewer, employee, offboardingCase.employeeId, task))
          continue;
        addTask({
          id: `offboarding-${offboardingCase.id}-${task.id}`,
          module: "Offboarding",
          title: task.title,
          description:
            task.instructions || `${task.group} for ${employeeName(offboardingCase.employeeId)}.`,
          priority: task.isMandatory ? "High" : "Normal",
          dueDate: task.dueDate,
          state: task.status === "Blocked" ? "Blocked" : undefined,
          actionLabel: task.status === "Blocked" ? "View blocker" : "Open task",
          actionUrl: `/staff/offboarding/${offboardingCase.id}`,
          sourceType: "offboarding-task",
          sourceId: task.id,
          subjectEmployeeId: offboardingCase.employeeId,
          subjectName: employeeName(offboardingCase.employeeId),
        });
      }
      if (
        viewer.activeRole === "Accounts" &&
        offboardingCase.progressPercentage === 100 &&
        !offboardingCase.financialClearanceAt
      ) {
        addTask({
          id: `offboarding-finance-${offboardingCase.id}`,
          module: "Offboarding",
          title: "Confirm financial clearance",
          description: `Confirm that ${employeeName(offboardingCase.employeeId)} has no outstanding expenses, advances or payroll items.`,
          priority: "High",
          dueDate: offboardingCase.lastWorkingDate,
          actionLabel: "Review clearance",
          actionUrl: `/staff/offboarding/${offboardingCase.id}`,
          sourceType: "offboarding-case",
          sourceId: offboardingCase.id,
          subjectEmployeeId: offboardingCase.employeeId,
          subjectName: employeeName(offboardingCase.employeeId),
        });
      }
      if (
        viewer.activeRole === "HR" &&
        offboardingCase.progressPercentage === 100 &&
        !offboardingCase.legalClearanceAt
      ) {
        addTask({
          id: `offboarding-legal-${offboardingCase.id}`,
          module: "Offboarding",
          title: "Confirm HR and document clearance",
          description: `Confirm that ${employeeName(offboardingCase.employeeId)} completed the required HR and document steps.`,
          priority: "High",
          dueDate: offboardingCase.lastWorkingDate,
          actionLabel: "Review clearance",
          actionUrl: `/staff/offboarding/${offboardingCase.id}`,
          sourceType: "offboarding-case",
          sourceId: offboardingCase.id,
          subjectEmployeeId: offboardingCase.employeeId,
          subjectName: employeeName(offboardingCase.employeeId),
        });
      }
      if (
        viewer.activeRole === "Super Admin" &&
        offboardingCase.progressPercentage === 100 &&
        offboardingCase.financialClearanceAt &&
        offboardingCase.legalClearanceAt
      ) {
        addTask({
          id: `offboarding-finalize-${offboardingCase.id}`,
          module: "Offboarding",
          title: "Complete employee offboarding",
          description: `All clearances for ${employeeName(offboardingCase.employeeId)} are complete. Review and close the case.`,
          priority: "Critical",
          dueDate: offboardingCase.lastWorkingDate,
          actionLabel: "Complete offboarding",
          actionUrl: `/staff/offboarding/${offboardingCase.id}`,
          sourceType: "offboarding-case",
          sourceId: offboardingCase.id,
          subjectEmployeeId: offboardingCase.employeeId,
          subjectName: employeeName(offboardingCase.employeeId),
        });
      }
    }
  }

  private addPerformanceTasks(
    viewer: TaskViewer,
    directReportIds: Set<string>,
    employeeName: (employeeId: string) => string,
    addTask: AddTask,
  ): void {
    const { storage } = getApplicationDataServices();
    const cycleById = new Map(
      storage.readCollection<ReviewCycle>("performanceCycles").map((cycle) => [cycle.id, cycle]),
    );
    for (const review of storage.readCollection<PerformanceReview>("performanceReviews")) {
      if (!isActive(review)) continue;
      const cycle = cycleById.get(review.cycleId);
      if (review.employeeId === viewer.employeeId && review.status === "Self Assessment Pending") {
        addTask({
          id: `performance-self-${review.id}`,
          module: "Performance",
          title: "Complete self-assessment",
          description: `Complete your assessment for ${cycle?.name ?? "the current review cycle"}.`,
          priority: "High",
          dueDate: cycle?.selfAssessmentDeadline,
          actionLabel: "Open review",
          actionUrl: `/staff/performance/reviews/${review.id}`,
          sourceType: "performance-review",
          sourceId: review.id,
          subjectEmployeeId: review.employeeId,
          subjectName: employeeName(review.employeeId),
        });
      }
      if (
        viewer.activeRole === "Line Manager" &&
        directReportIds.has(review.employeeId) &&
        review.status === "Manager Review Pending"
      ) {
        addTask({
          id: `performance-manager-${review.id}`,
          module: "Performance",
          title: "Complete manager review",
          description: `Complete the review for ${employeeName(review.employeeId)}.`,
          priority: "High",
          dueDate: cycle?.managerReviewDeadline,
          actionLabel: "Open review",
          actionUrl: `/staff/performance/reviews/${review.id}`,
          sourceType: "performance-review",
          sourceId: review.id,
          subjectEmployeeId: review.employeeId,
          subjectName: employeeName(review.employeeId),
        });
      }
      if (viewer.activeRole === "HR" && review.status === "Moderation Pending") {
        addTask({
          id: `performance-moderation-${review.id}`,
          module: "Performance",
          title: "Moderate performance review",
          description: `Review the manager assessment for ${employeeName(review.employeeId)} before discussion.`,
          priority: "High",
          dueDate: cycle?.discussionDeadline,
          actionLabel: "Open review",
          actionUrl: `/staff/performance/reviews/${review.id}`,
          sourceType: "performance-review",
          sourceId: review.id,
          subjectEmployeeId: review.employeeId,
          subjectName: employeeName(review.employeeId),
        });
      }
      if (review.employeeId === viewer.employeeId && review.status === "Discussion Pending") {
        addTask({
          id: `performance-acknowledge-${review.id}`,
          module: "Performance",
          title: "Acknowledge performance review",
          description: "Read the completed review and record your acknowledgement.",
          priority: "Normal",
          dueDate: cycle?.discussionDeadline,
          actionLabel: "Open review",
          actionUrl: `/staff/performance/reviews/${review.id}`,
          sourceType: "performance-review",
          sourceId: review.id,
          subjectEmployeeId: review.employeeId,
          subjectName: employeeName(review.employeeId),
        });
      }
    }
  }

  private addHrTasks(
    viewer: TaskViewer,
    employeeName: (employeeId: string) => string,
    today: string,
    addTask: AddTask,
  ): void {
    if (viewer.activeRole !== "HR") return;
    const { storage } = getApplicationDataServices();
    for (const request of storage.readCollection<LeaveRequest>("leave_requests")) {
      if (
        isActive(request) &&
        (request.status === "Pending HR" || request.status === "Pending Super Admin")
      ) {
        addTask({
          id: `leave-hr-${request.id}`,
          module: "Leave",
          title: "Confirm leave request",
          description: `${employeeName(request.employeeId)}'s supervisor approved this ${request.policySnapshot.name} request.`,
          priority: "High",
          dueDate: addDays(request.updatedAt.slice(0, 10), 2),
          actionLabel: "Review request",
          actionUrl: "/staff/leave-approvals",
          sourceType: "leave-request",
          sourceId: request.id,
          subjectEmployeeId: request.employeeId,
          subjectName: employeeName(request.employeeId),
        });
      }
    }
    for (const timesheet of storage.readCollection<TimesheetWithEntries>("timesheets")) {
      if (isActive(timesheet) && timesheet.status === "Pending HR") {
        addTask({
          id: `timesheet-hr-${timesheet.id}`,
          module: "Timesheets",
          title: "Approve reviewed timesheet",
          description: `${employeeName(timesheet.employeeId)}'s supervisor completed the first review.`,
          priority: "High",
          dueDate: addDays(timesheet.updatedAt.slice(0, 10), 2),
          actionLabel: "Review timesheet",
          actionUrl: `/staff/timesheet-approvals/${timesheet.id}`,
          sourceType: "timesheet",
          sourceId: timesheet.id,
          subjectEmployeeId: timesheet.employeeId,
          subjectName: employeeName(timesheet.employeeId),
        });
      }
    }
    for (const correction of storage.readCollection<AttendanceCorrection>(
      "attendanceCorrections",
    )) {
      if (isActive(correction) && correction.status === "Pending HR") {
        addTask({
          id: `attendance-hr-${correction.id}`,
          module: "Attendance",
          title: "Complete attendance correction review",
          description: `${employeeName(correction.employeeId)}’s manager approved a correction that needs HR review.`,
          priority: "High",
          dueDate: addDays(correction.updatedAt.slice(0, 10), 1),
          actionLabel: "Review correction",
          actionUrl: "/staff/attendance/corrections",
          sourceType: "attendance-correction",
          sourceId: correction.id,
          subjectEmployeeId: correction.employeeId,
          subjectName: employeeName(correction.employeeId),
        });
      }
    }
    for (const visit of storage.readCollection<SiteVisitRequest>("attendanceSiteVisits")) {
      if (isActive(visit) && visit.status === "Pending HR") {
        addTask({
          id: `site-visit-hr-${visit.id}`,
          module: "Attendance",
          title: "Review site visit request",
          description: `${employeeName(visit.employeeId)} requested permission to visit ${visit.destination}.`,
          priority: "Normal",
          dueDate: visit.date,
          actionLabel: "Review request",
          actionUrl: "/staff/attendance",
          sourceType: "site-visit-request",
          sourceId: visit.id,
          subjectEmployeeId: visit.employeeId,
          subjectName: employeeName(visit.employeeId),
        });
      }
    }
    for (const claim of storage.readCollection<OvertimeClaim>("overtimeClaims")) {
      if (isActive(claim) && claim.status === "Pending HR") {
        addTask({
          id: `overtime-hr-${claim.id}`,
          module: "Overtime",
          title: "Verify overtime claim",
          description: `${employeeName(claim.employeeId)} has a manager-approved ${claim.hours}-hour overtime claim.`,
          priority: claim.crossCheckWarnings.length > 0 ? "High" : "Normal",
          dueDate: addDays(claim.updatedAt.slice(0, 10), 2),
          actionLabel: "Verify claim",
          actionUrl: "/staff/overtime-approvals",
          sourceType: "overtime-claim",
          sourceId: claim.id,
          subjectEmployeeId: claim.employeeId,
          subjectName: employeeName(claim.employeeId),
        });
      }
    }
    for (const request of storage.readCollection<TravelRequest>("travelRequests")) {
      if (
        isActive(request) &&
        request.status === "Pending HR and Accounts" &&
        request.hrApprovalStatus === "Pending"
      ) {
        addTask({
          id: `travel-hr-${request.id}`,
          module: "Travel",
          title: "Review travel pre-authorisation",
          description: `${employeeName(request.employeeId)} requested travel to ${request.destination}.`,
          priority: "Normal",
          dueDate: addDays(request.createdAt.slice(0, 10), 2),
          actionLabel: "Review travel",
          actionUrl: "/staff/travel-hr-approvals",
          sourceType: "travel-request",
          sourceId: request.id,
          subjectEmployeeId: request.employeeId,
          subjectName: employeeName(request.employeeId),
        });
      }
    }
    for (const request of storage.readCollection<ProfileChangeRequest>("profile_change_requests")) {
      if (isActive(request) && request.status === "Pending") {
        addTask({
          id: `profile-review-${request.id}`,
          module: "Employee Records",
          title: "Review profile update",
          description: `${employeeName(request.employeeId)} requested changes to their personal details.`,
          priority: "Normal",
          dueDate: addDays(request.createdAt.slice(0, 10), 3),
          actionLabel: "Review profile",
          actionUrl: `/staff/employees/${request.employeeId}`,
          sourceType: "profile-change-request",
          sourceId: request.id,
          subjectEmployeeId: request.employeeId,
          subjectName: employeeName(request.employeeId),
        });
      }
    }
    for (const document of storage.readCollection<EmployeeDocument>("employee_documents")) {
      if (!isActive(document)) continue;
      if (document.status === "Pending Verification") {
        addTask({
          id: `document-verify-${document.id}`,
          module: "Documents",
          title: "Verify employee document",
          description: `Review ${employeeName(document.employeeId)}’s ${document.type.replaceAll("_", " ")}.`,
          priority: "Normal",
          dueDate: addDays(document.createdAt.slice(0, 10), 3),
          actionLabel: "Review document",
          actionUrl: `/staff/employees/${document.employeeId}`,
          sourceType: "employee-document",
          sourceId: document.id,
          subjectEmployeeId: document.employeeId,
          subjectName: employeeName(document.employeeId),
        });
      } else if (
        document.status === "Valid" &&
        document.expiryDate &&
        document.expiryDate <= addDays(today, 30)
      ) {
        addTask({
          id: `document-expiry-${document.id}`,
          module: "Documents",
          title: document.expiryDate < today ? "Resolve expired document" : "Document expires soon",
          description: `${employeeName(document.employeeId)}’s ${document.type.replaceAll("_", " ")} ${document.expiryDate < today ? "expired" : "expires"} on ${document.expiryDate}.`,
          priority: document.expiryDate < today ? "Critical" : "High",
          dueDate: document.expiryDate,
          actionLabel: "Open expiry list",
          actionUrl: "/staff/document-expiry",
          sourceType: "employee-document",
          sourceId: document.id,
          subjectEmployeeId: document.employeeId,
          subjectName: employeeName(document.employeeId),
        });
      }
    }
    for (const training of storage.readCollection<TrainingRecord>("training_records")) {
      if (isActive(training) && !training.hrVerified && training.certificateFileId) {
        addTask({
          id: `training-verify-${training.id}`,
          module: "Training",
          title: "Verify training certificate",
          description: `Review ${employeeName(training.employeeId)}’s ${training.title} certificate.`,
          priority: "Normal",
          dueDate: addDays(training.createdAt.slice(0, 10), 3),
          actionLabel: "Review training",
          actionUrl: `/staff/employees/${training.employeeId}`,
          sourceType: "training-record",
          sourceId: training.id,
          subjectEmployeeId: training.employeeId,
          subjectName: employeeName(training.employeeId),
        });
      }
    }
    const candidateById = new Map(
      storage.readCollection<Candidate>("candidates").map((candidate) => [candidate.id, candidate]),
    );
    for (const contact of storage.readCollection<CandidateContact>("candidate_contacts")) {
      if (isActive(contact) && contact.nextFollowUpDate && contact.nextFollowUpDate <= today) {
        const candidate = candidateById.get(contact.candidateId);
        if (candidate?.hrOwnerId && candidate.hrOwnerId !== viewer.userId) continue;
        addTask({
          id: `candidate-follow-up-${contact.id}`,
          module: "Recruitment",
          title: "Candidate follow-up due",
          description: `Follow up with ${candidate ? `${candidate.firstName} ${candidate.lastName}` : "the candidate"}.`,
          priority: contact.nextFollowUpDate < today ? "High" : "Normal",
          dueDate: contact.nextFollowUpDate,
          actionLabel: "Open contact tracker",
          actionUrl: "/staff/candidates/contacts",
          sourceType: "candidate-contact",
          sourceId: contact.id,
        });
      }
    }
  }

  private addAccountsTasks(
    viewer: TaskViewer,
    employeeName: (employeeId: string) => string,
    addTask: AddTask,
  ): void {
    if (viewer.activeRole !== "Accounts") return;
    const { storage } = getApplicationDataServices();
    for (const request of storage.readCollection<TravelRequest>("travelRequests")) {
      if (
        isActive(request) &&
        request.status === "Pending HR and Accounts" &&
        request.accountsApprovalStatus === "Pending"
      ) {
        addTask({
          id: `travel-accounts-${request.id}`,
          module: "Travel",
          title: "Review travel budget",
          description: `${employeeName(request.employeeId)} requested ${request.totalEstimate.toLocaleString()} ${request.currency} for travel to ${request.destination}.`,
          priority: "Normal",
          dueDate: addDays(request.createdAt.slice(0, 10), 2),
          actionLabel: "Review travel",
          actionUrl: "/staff/travel-accounts-approvals",
          sourceType: "travel-request",
          sourceId: request.id,
          subjectEmployeeId: request.employeeId,
          subjectName: employeeName(request.employeeId),
        });
      }
    }
    for (const period of storage.readCollection<PayrollPeriod>("payrollPeriods")) {
      const unresolved = period.exceptions.filter((exception) => !exception.acknowledged);
      if (unresolved.length === 0) continue;
      addTask({
        id: `payroll-exceptions-${period.id}`,
        module: "Payroll",
        title: "Resolve payroll exceptions",
        description: `${period.name} has ${unresolved.length} unresolved exception${unresolved.length === 1 ? "" : "s"}.`,
        priority: unresolved.some((exception) => exception.severity === "High")
          ? "Critical"
          : "High",
        dueDate: period.cutoffDate,
        actionLabel: "Review payroll",
        actionUrl: `/staff/payroll/periods/${period.id}`,
        sourceType: "payroll-period",
        sourceId: period.id,
      });
    }
  }

  private addSuperAdminTasks(
    viewer: TaskViewer,
    employeeName: (employeeId: string) => string,
    addTask: AddTask,
  ): void {
    if (viewer.activeRole !== "Super Admin") return;
    const { storage } = getApplicationDataServices();
    for (const request of storage.readCollection<LeaveRequest>("leave_requests")) {
      if (
        isActive(request) &&
        (request.status === "Pending HR" ||
          request.status === "Pending Super Admin" ||
          request.status === "Cancellation Pending")
      ) {
        addTask({
          id: `leave-final-${request.id}`,
          module: "Leave",
          title:
            request.status === "Cancellation Pending"
              ? "Review leave cancellation"
              : "Complete final leave review",
          description: `${employeeName(request.employeeId)}’s ${request.policySnapshot.name} request requires a final decision.`,
          priority: "High",
          dueDate: addDays(request.updatedAt.slice(0, 10), 2),
          actionLabel: "Review request",
          actionUrl: "/staff/leave-approvals",
          sourceType: "leave-request",
          sourceId: request.id,
          subjectEmployeeId: request.employeeId,
          subjectName: employeeName(request.employeeId),
        });
      }
    }
    for (const request of storage.readCollection<TravelRequest>("travelRequests")) {
      if (isActive(request) && request.status === "Pending Super Admin Closure") {
        addTask({
          id: `travel-close-${request.id}`,
          module: "Travel",
          title: "Close reimbursement",
          description: `${employeeName(request.employeeId)} submitted trip expenses for ${request.destination}.`,
          priority: "High",
          dueDate: addDays(request.updatedAt.slice(0, 10), 3),
          actionLabel: "Review reimbursement",
          actionUrl: "/staff/travel-closures",
          sourceType: "travel-request",
          sourceId: request.id,
          subjectEmployeeId: request.employeeId,
          subjectName: employeeName(request.employeeId),
        });
      }
    }
    for (const request of storage.readCollection<ProfileChangeRequest>("profile_change_requests")) {
      if (!isActive(request) || request.status !== "Pending") continue;
      addTask({
        id: `profile-review-${request.id}`,
        module: "Employee Records",
        title: "Review profile update",
        description: `${employeeName(request.employeeId)} requested changes to their personal details.`,
        priority: "Normal",
        dueDate: addDays(request.createdAt.slice(0, 10), 3),
        actionLabel: "Review profile",
        actionUrl: `/staff/employees/${request.employeeId}`,
        sourceType: "profile-change-request",
        sourceId: request.id,
        subjectEmployeeId: request.employeeId,
        subjectName: employeeName(request.employeeId),
      });
    }
    for (const period of storage.readCollection<PayrollPeriod>("payrollPeriods")) {
      const unresolved = period.exceptions.filter((exception) => !exception.acknowledged);
      if (unresolved.length === 0) continue;
      addTask({
        id: `payroll-exceptions-${period.id}`,
        module: "Payroll",
        title: "Resolve payroll exceptions",
        description: `${period.name} has ${unresolved.length} unresolved exception${unresolved.length === 1 ? "" : "s"}.`,
        priority: unresolved.some((exception) => exception.severity === "High")
          ? "Critical"
          : "High",
        dueDate: period.cutoffDate,
        actionLabel: "Review payroll",
        actionUrl: `/staff/payroll/periods/${period.id}`,
        sourceType: "payroll-period",
        sourceId: period.id,
      });
    }
  }

  private addInterviewTasks(viewer: TaskViewer, addTask: AddTask): void {
    const { storage } = getApplicationDataServices();
    const submittedInterviewIds = new Set(
      storage
        .readCollection<InterviewScorecard>("interview_scorecards")
        .filter(
          (scorecard) =>
            scorecard.panelUserId === viewer.userId && scorecard.status === "Submitted",
        )
        .map((scorecard) => scorecard.interviewId),
    );
    const candidateById = new Map(
      storage.readCollection<Candidate>("candidates").map((candidate) => [candidate.id, candidate]),
    );
    for (const interview of storage.readCollection<InterviewEvent>("interview_events")) {
      if (
        !isActive(interview) ||
        !interview.panelUserIds.includes(viewer.userId) ||
        submittedInterviewIds.has(interview.id) ||
        !["Scheduled", "Completed"].includes(interview.status)
      ) {
        continue;
      }
      const candidate = candidateById.get(interview.candidateId);
      addTask({
        id: `interview-scorecard-${interview.id}-${viewer.userId}`,
        module: "Recruitment",
        title: "Complete interview scorecard",
        description: `Submit your evidence-based scores for ${candidate ? `${candidate.firstName} ${candidate.lastName}` : "the candidate"}.`,
        priority: "High",
        dueDate:
          interview.confirmedSlot?.endTime.slice(0, 10) ?? interview.occurredAt?.slice(0, 10),
        actionLabel: "Open interviews",
        actionUrl: "/staff/interviews",
        sourceType: "interview",
        sourceId: interview.id,
      });
    }
  }

  private isLifecycleTaskRelevant(
    viewer: TaskViewer,
    employee: Employee | undefined,
    caseEmployeeId: string,
    task: OnboardingTask | OffboardingTask,
  ): boolean {
    if (task.status !== "Pending" && task.status !== "Blocked") return false;
    if (task.assignedUserId) {
      return task.assignedUserId === viewer.userId || task.assignedUserId === viewer.employeeId;
    }
    if (task.ownerRole === "Employee") return caseEmployeeId === viewer.employeeId;
    if (task.ownerRole === "Line Manager") {
      return viewer.activeRole === "Line Manager" && employee?.lineManagerId === viewer.employeeId;
    }
    return task.ownerRole === viewer.activeRole;
  }

  private getState(dueDate: string | undefined, today: string): TaskState {
    if (!dueDate) return "Open";
    if (dueDate < today) return "Overdue";
    if (dueDate <= addDays(today, 7)) return "Due Soon";
    return "Open";
  }

  private priorityWeight(priority: NotificationPriority): number {
    return { Low: 0, Normal: 1, High: 2, Critical: 3 }[priority];
  }
}
