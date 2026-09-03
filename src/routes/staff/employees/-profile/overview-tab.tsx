import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Employee, User } from "@/lib/data/types";
import { EmployeeService } from "@/lib/data/employee-service";
import { getMasterDataRepository, getProjectRepository } from "@/lib/data/master-data";
import { DocumentService } from "@/lib/data/document-service";
import { TimesheetService } from "@/lib/data/timesheet-service";
import { OnboardingService } from "@/lib/data/onboarding-service";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { CandidateService } from "@/lib/data/candidate-service";
import { useCurrentUser } from "@/lib/auth";
import { Link } from "@tanstack/react-router";

export function OverviewTab({
  employee,
  userMapping,
}: {
  employee: Employee;
  userMapping: User | undefined;
}) {
  const currentUser = useCurrentUser();
  const employeeService = new EmployeeService();
  const manager = employee.lineManagerId
    ? (employeeService
        .getEmployeesWithReportingLine(currentUser.getActorContext())
        .find((item) => item.id === employee.lineManagerId) ?? null)
    : null;
  const projects = getProjectRepository().list();
  const project = employee.projectId ? projects.find((p) => p.id === employee.projectId) : null;
  const costCentre = employee.costCentreId
    ? getMasterDataRepository("costCentres").getById(employee.costCentreId)
    : null;

  const today = new Date();
  const recommendations = employee.candidateId
    ? new CandidateService().getRecommendationsForCandidate(
        employee.candidateId,
        currentUser.getActorContext(),
      )
    : [];
  const canViewRecruitmentSource =
    currentUser.activeRole === "HR" || currentUser.activeRole === "Super Admin";

  // Real computed alerts, not decorative placeholders.
  const alerts: { color: string; text: string }[] = [];

  if (employee.probationEndDate) {
    const daysToProbationEnd = differenceInCalendarDays(parseISO(employee.probationEndDate), today);
    if (daysToProbationEnd >= 0 && daysToProbationEnd <= 14) {
      alerts.push({
        color: "bg-orange-500",
        text: `Probation review due in ${daysToProbationEnd} ${daysToProbationEnd === 1 ? "day" : "days"}`,
      });
    } else if (daysToProbationEnd < 0 && employee.status === "Probation") {
      alerts.push({ color: "bg-rose-500", text: "Probation end date has passed - review overdue" });
    }
  }

  try {
    const docService = new DocumentService();
    const expiringDocs = docService
      .getExpiringDocuments(currentUser.getActorContext())
      .filter((d) => d.employeeId === employee.id);
    if (expiringDocs.length > 0) {
      alerts.push({
        color: "bg-amber-500",
        text: `${expiringDocs.length} ${expiringDocs.length === 1 ? "document is" : "documents are"} expired or due within 30 days`,
      });
    }
  } catch {
    /* ignore */
  }

  try {
    const tsService = new TimesheetService();
    const overdueTs = tsService
      .getTimesheetsForEmployee(employee.id, currentUser.getActorContext())
      .filter((t) => t.status === "Returned");
    if (overdueTs.length > 0) {
      alerts.push({
        color: "bg-blue-500",
        text: `${overdueTs.length} timesheet(s) returned and awaiting resubmission`,
      });
    }
  } catch {
    /* ignore */
  }

  try {
    const obService = new OnboardingService();
    const obCase = obService.getCaseByEmployeeId(employee.id, currentUser.getActorContext());
    if (obCase && obCase.status !== "Completed") {
      const pendingCount = obCase.tasks.filter(
        (t) => t.status === "Pending" || t.status === "Blocked",
      ).length;
      if (pendingCount > 0) {
        alerts.push({
          color: "bg-emerald-500",
          text: `${pendingCount} onboarding ${pendingCount === 1 ? "task is" : "tasks are"} still pending`,
        });
      }
    }
  } catch {
    /* ignore */
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{employee.status}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Department</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{employee.department}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Service Length
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {Math.max(
                0,
                Math.floor(
                  (Date.now() - new Date(employee.startDate).getTime()) /
                    (1000 * 60 * 60 * 24 * 30),
                ),
              )}{" "}
              months
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Profile Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Position</span>
              <span className="font-medium">{employee.position}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Supervisor</span>
              <span className="font-medium">{manager?.preferredName || "None"}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Project</span>
              <span className="font-medium">{project?.name || "None"}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Cost Centre</span>
              <span className="font-medium">{costCentre?.name || "None"}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Start Date</span>
              <span className="font-medium">{employee.startDate}</span>
            </div>
            <div className="flex justify-between pb-2">
              <span className="text-muted-foreground">Location</span>
              <span className="font-medium">{employee.location}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tasks & Alerts</CardTitle>
          </CardHeader>
          <CardContent>
            {alerts.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                No outstanding tasks or alerts.
              </div>
            ) : (
              <div className="text-sm text-muted-foreground space-y-2">
                {alerts.map((a, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${a.color} shrink-0`}></div>
                    {a.text}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {canViewRecruitmentSource && recommendations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recruitment Source</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recommendations.map((recommendation) => (
              <div
                key={recommendation.id}
                className="grid gap-2 rounded-md border p-4 text-sm sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <div>
                  <p className="font-medium">
                    {recommendation.recommenderName} · {recommendation.recommenderType}
                  </p>
                  <p className="text-muted-foreground">
                    {recommendation.recommenderCompany || "Independent"} ·{" "}
                    {recommendation.recommenderEmail}
                    {recommendation.recommenderPhone ? ` · ${recommendation.recommenderPhone}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {recommendation.relationship || "Relationship not recorded"} · Recommended{" "}
                    {new Date(recommendation.date).toLocaleDateString()}
                  </p>
                </div>
                <Link
                  to="/staff/recommendations/$email"
                  params={{ email: encodeURIComponent(recommendation.recommenderEmail) }}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  View source history
                </Link>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
