import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { PerformanceService } from "@/lib/data/performance-service";
import { EmployeeService } from "@/lib/data/employee-service";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/staff/performance/cycles/new")({
  validateSearch: (search: Record<string, unknown>) => ({
    edit: typeof search["edit"] === "string" ? search["edit"] : undefined,
  }),
  component: NewCycleRoute,
});

function NewCycleRoute() {
  return (
    <RequirePermission permission="performance:manage_all" resourceName="Performance Cycles">
      <NewCyclePage />
    </RequirePermission>
  );
}

function NewCyclePage() {
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const context = currentUser.getActorContext();
  const [perfService] = useState(() => new PerformanceService());
  const [employeeService] = useState(() => new EmployeeService());
  const { edit } = Route.useSearch();
  const existing = edit
    ? perfService.getCycles(context).find((cycle) => cycle.id === edit)
    : undefined;
  const templates = perfService.getTemplates(context).filter((t) => t.isActive);
  const employees = employeeService
    .getEmployees(context)
    .filter((employee) => employee.status !== "Archived" && employee.status !== "Inactive");
  const departments = [
    ...new Set(employees.map((employee) => employee.department).filter(Boolean)),
  ].sort();
  const employmentTypes = [
    ...new Set(employees.map((employee) => employee.employmentType).filter(Boolean)),
  ].sort();

  const [name, setName] = useState(existing?.name ?? "");
  const [templateId, setTemplateId] = useState(existing?.templateId ?? "");
  const [selfDeadline, setSelfDeadline] = useState(existing?.selfAssessmentDeadline ?? "");
  const [managerDeadline, setManagerDeadline] = useState(existing?.managerReviewDeadline ?? "");
  const [discussDeadline, setDiscussDeadline] = useState(existing?.discussionDeadline ?? "");
  const [objectiveDeadline, setObjectiveDeadline] = useState(
    existing?.objectiveSettingDeadline ?? "",
  );
  const [requiresModeration, setRequiresModeration] = useState(
    existing?.requiresModeration ?? false,
  );
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>(
    existing?.departments ?? [],
  );
  const [selectedEmploymentTypes, setSelectedEmploymentTypes] = useState<string[]>(
    existing?.employmentTypes ?? [],
  );

  const eligibleEmployees = employees.filter(
    (employee) =>
      (selectedDepartments.length === 0 || selectedDepartments.includes(employee.department)) &&
      (selectedEmploymentTypes.length === 0 ||
        selectedEmploymentTypes.includes(employee.employmentType)),
  );
  const employeesWithoutSupervisor = eligibleEmployees.filter(
    (employee) => !employee.lineManagerId || employee.lineManagerId === employee.id,
  );

  const save = (status: "Draft" | "Active") => {
    if (
      !name ||
      !templateId ||
      !objectiveDeadline ||
      !selfDeadline ||
      !managerDeadline ||
      !discussDeadline
    ) {
      toast.error("Please fill all required fields");
      return;
    }

    try {
      const input = {
        name,
        templateId,
        departments: selectedDepartments,
        employmentTypes: selectedEmploymentTypes,
        objectiveSettingDeadline: objectiveDeadline,
        selfAssessmentDeadline: selfDeadline,
        managerReviewDeadline: managerDeadline,
        discussionDeadline: discussDeadline,
        requiresModeration,
        employeeCanSeeManagerRatings: true,
      };
      if (existing) {
        perfService.updateDraftCycle(existing.id, input, context);
        if (status === "Active") perfService.updateCycleStatus(existing.id, "Active", context);
      } else perfService.createCycle({ ...input, status }, context);

      toast.success(status === "Active" ? "Review cycle started" : "Review cycle saved as a draft");
      navigate({ to: "/staff/performance/cycles" });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The review cycle could not be started.",
      );
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-[800px] mx-auto pb-10">
      <div className="flex items-center gap-2 mb-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: "/staff/performance/cycles" })}
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
      </div>

      <PageHeader
        title={existing ? "Edit Review Cycle" : "Create Review Cycle"}
        description="Set the review dates and confirm exactly which employees will be included."
      />

      <Card>
        <CardContent className="pt-6 space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium">Cycle Name</label>
            <Input
              placeholder="e.g. Q3 2026 Engineering Review"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Template</label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a template" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Objectives Submitted By</label>
              <Input
                type="date"
                value={objectiveDeadline}
                onChange={(e) => setObjectiveDeadline(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Self Assessment By</label>
              <Input
                type="date"
                value={selfDeadline}
                onChange={(e) => setSelfDeadline(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Manager Review By</label>
              <Input
                type="date"
                value={managerDeadline}
                onChange={(e) => setManagerDeadline(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Discussion/Acknowledge By</label>
              <Input
                type="date"
                value={discussDeadline}
                onChange={(e) => setDiscussDeadline(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">Departments</p>
                <p className="text-xs text-muted-foreground">
                  Leave all clear to include every department.
                </p>
              </div>
              {departments.map((department) => (
                <label key={department} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={selectedDepartments.includes(department)}
                    onCheckedChange={(checked) =>
                      setSelectedDepartments((current) =>
                        checked
                          ? [...current, department]
                          : current.filter((item) => item !== department),
                      )
                    }
                  />
                  {department}
                </label>
              ))}
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">Employment types</p>
                <p className="text-xs text-muted-foreground">
                  Leave all clear to include every employment type.
                </p>
              </div>
              {employmentTypes.map((type) => (
                <label key={type} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={selectedEmploymentTypes.includes(type)}
                    onCheckedChange={(checked) =>
                      setSelectedEmploymentTypes((current) =>
                        checked ? [...current, type] : current.filter((item) => item !== type),
                      )
                    }
                  />
                  {type}
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center space-x-2 pt-2">
            <Checkbox
              id="mod"
              checked={requiresModeration}
              onCheckedChange={(c) => setRequiresModeration(!!c)}
            />
            <label
              htmlFor="mod"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Require HR Moderation before Discussion
            </label>
          </div>

          <div className="rounded-xl border bg-muted/30 p-4">
            <p className="font-medium">Employees included: {eligibleEmployees.length}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {eligibleEmployees.length > 0
                ? eligibleEmployees
                    .slice(0, 6)
                    .map((employee) => employee.preferredName || employee.legalName)
                    .join(", ") +
                  (eligibleEmployees.length > 6 ? ` and ${eligibleEmployees.length - 6} more` : "")
                : "No active employees match this selection. Change the departments or employment types before launching."}
            </p>
            {employeesWithoutSupervisor.length > 0 && (
              <p className="mt-2 text-sm text-rose-700">
                Assign a supervisor to{" "}
                {employeesWithoutSupervisor
                  .map((employee) => employee.preferredName || employee.legalName)
                  .join(", ")}{" "}
                before launching.
              </p>
            )}
          </div>

          <div className="flex flex-wrap justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => save("Draft")}>
              Save draft
            </Button>
            <Button
              disabled={eligibleEmployees.length === 0 || employeesWithoutSupervisor.length > 0}
              onClick={() => save("Active")}
            >
              Launch cycle
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
