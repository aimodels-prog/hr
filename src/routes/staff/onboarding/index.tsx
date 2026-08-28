import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Plus,
  Search,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { toast } from "sonner";

import { OnboardingTemplatesPanel } from "@/components/settings/onboarding-templates-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { EmployeeService } from "@/lib/data/employee-service";
import { OnboardingService } from "@/lib/data/onboarding-service";
import type { OnboardingCase } from "@/lib/data/onboarding-types";

export const Route = createFileRoute("/staff/onboarding/")({ component: OnboardingDashboard });

type CaseView = "Active" | "At Risk" | "Completed" | "Cancelled" | "All";

function OnboardingDashboard() {
  const currentUser = useCurrentUser();
  const [onboardingService] = useState(() => new OnboardingService());
  const [employeeService] = useState(() => new EmployeeService());
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<CaseView>("Active");
  const [createOpen, setCreateOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [assignedHRId, setAssignedHRId] = useState("");
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const actorContext = currentUser.getActorContext();
  const cases = onboardingService.getCasesForContext(actorContext);
  const employees = employeeService.getEmployees(actorContext);
  const templates = onboardingService
    .getTemplates(actorContext)
    .filter((template) => template.isActive);
  const hrOwners = employeeService
    .getUsers(actorContext)
    .filter((user) => user.status === "Active" && user.roles.includes("HR"));
  const today = new Date().toISOString().slice(0, 10);
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const isOverdue = (onboardingCase: OnboardingCase) =>
    onboardingCase.tasks.some(
      (task) => task.dueDate < today && task.status !== "Completed" && task.status !== "Waived",
    );
  const activeCases = cases.filter((item) => item.status === "In Progress");
  const atRiskCases = activeCases.filter((item) => {
    const employee = employeeById.get(item.employeeId);
    if (!employee || item.isReadyForStartDate) return false;
    if (
      !employee.lineManagerId &&
      item.tasks.some((task) => task.isMandatory && task.ownerRole === "Line Manager")
    ) {
      return true;
    }
    const daysToStart = Math.ceil(
      (parseISO(employee.startDate).getTime() - parseISO(today).getTime()) / 86_400_000,
    );
    return daysToStart <= 7 || isOverdue(item);
  });
  const visibleCases = cases
    .filter((item) => {
      if (view === "Active") return item.status === "In Progress";
      if (view === "At Risk") return atRiskCases.some((risk) => risk.id === item.id);
      if (view === "Completed") return item.status === "Completed";
      if (view === "Cancelled") return item.status === "Cancelled";
      return true;
    })
    .filter((item) => {
      const employee = employeeById.get(item.employeeId);
      return `${employee?.legalName ?? ""} ${employee?.employeeNumber ?? ""} ${employee?.department ?? ""} ${employee?.position ?? ""}`
        .toLowerCase()
        .includes(query.trim().toLowerCase());
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const employeesAvailableForOnboarding = employees.filter(
    (employee) =>
      employee.status === "Onboarding" &&
      !cases.some((item) => item.employeeId === employee.id && item.status === "In Progress"),
  );

  const resetCreate = () => {
    setEmployeeId("");
    setTemplateId("");
    setAssignedHRId("");
  };
  const createCase = () => {
    if (!employeeId || !templateId) {
      toast.error("Select an employee and onboarding template.");
      return;
    }
    setSaving(true);
    try {
      const created = onboardingService.createCaseForEmployee(employeeId, actorContext, {
        templateId,
        ...(assignedHRId ? { assignedHRId } : {}),
      });
      toast.success("Onboarding started");
      setCreateOpen(false);
      resetCreate();
      setRevision((value) => value + 1);
      void navigate({ to: `/staff/onboarding/${created.id}` });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Onboarding could not be started.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <RequirePermission permission="onboarding:manage_all" resourceName="Onboarding">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6 pb-10" data-revision={revision}>
        <PageHeader
          title="Onboarding"
          description="Prepare every new employee for a safe, organised and confident first day."
          actions={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Start onboarding
            </Button>
          }
        />
        <Tabs defaultValue="cases" className="space-y-6">
          <TabsList>
            <TabsTrigger value="cases">Employee onboarding</TabsTrigger>
            <TabsTrigger value="templates">Checklist templates</TabsTrigger>
          </TabsList>
          <TabsContent value="cases" className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard title="In progress" value={activeCases.length} icon={Clock3} />
              <SummaryCard
                title="Ready to start"
                value={activeCases.filter((item) => item.isReadyForStartDate).length}
                icon={ShieldCheck}
                tone="success"
              />
              <SummaryCard
                title="Needs attention"
                value={atRiskCases.length}
                icon={AlertTriangle}
                tone="danger"
              />
              <SummaryCard
                title="Completed"
                value={cases.filter((item) => item.status === "Completed").length}
                icon={CheckCircle2}
              />
            </div>
            <Card>
              <CardHeader className="gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                  <CardTitle>Employee onboarding</CardTitle>
                  <CardDescription>
                    Review progress, start-date readiness, overdue work and assigned owners.
                  </CardDescription>
                </div>
                <div className="flex w-full flex-col gap-2 sm:flex-row md:w-auto">
                  <label className="relative min-w-64">
                    <span className="sr-only">Search onboarding cases</span>
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search employee or department"
                    />
                  </label>
                  <Select value={view} onValueChange={(value) => setView(value as CaseView)}>
                    <SelectTrigger className="w-full sm:w-40" aria-label="Filter onboarding cases">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["Active", "At Risk", "Completed", "Cancelled", "All"] as const).map(
                        (option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                {visibleCases.length === 0 ? (
                  <EmptyState
                    icon={UserRoundCheck}
                    title={
                      query ? "No matching onboarding cases" : "No onboarding cases in this view"
                    }
                    description={
                      query
                        ? "Try a different employee name, number or department."
                        : "Start onboarding when a new employee is ready to join."
                    }
                    action={
                      !query && view === "Active" ? (
                        <Button onClick={() => setCreateOpen(true)}>Start onboarding</Button>
                      ) : undefined
                    }
                  />
                ) : (
                  <div className="divide-y">
                    {visibleCases.map((onboardingCase) => {
                      const employee = employeeById.get(onboardingCase.employeeId);
                      if (!employee) return null;
                      const overdueCount = onboardingCase.tasks.filter(
                        (task) =>
                          task.dueDate < today &&
                          task.status !== "Completed" &&
                          task.status !== "Waived",
                      ).length;
                      const blockedCount = onboardingCase.tasks.filter(
                        (task) => task.status === "Blocked",
                      ).length;
                      return (
                        <article
                          key={onboardingCase.id}
                          className="grid gap-4 py-5 first:pt-0 last:pb-0 lg:grid-cols-[minmax(0,1.4fr)_minmax(180px,0.7fr)_minmax(230px,0.9fr)_auto] lg:items-center"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold">{employee.legalName}</div>
                            <div className="mt-1 text-sm text-muted-foreground">
                              {employee.employeeNumber} · {employee.position} ·{" "}
                              {employee.department}
                            </div>
                            <div className="mt-2 text-xs text-muted-foreground">
                              Starts {format(parseISO(employee.startDate), "d MMM yyyy")}
                            </div>
                          </div>
                          <div>
                            <div className="mb-1.5 flex justify-between text-xs">
                              <span>Overall progress</span>
                              <span className="font-semibold">
                                {onboardingCase.progressPercentage}%
                              </span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-primary"
                                style={{ width: `${onboardingCase.progressPercentage}%` }}
                              />
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Badge
                              variant={onboardingCase.isReadyForStartDate ? "default" : "outline"}
                            >
                              {onboardingCase.isReadyForStartDate
                                ? "Ready to start"
                                : onboardingCase.status}
                            </Badge>
                            {overdueCount > 0 && (
                              <Badge variant="destructive">{overdueCount} overdue</Badge>
                            )}
                            {blockedCount > 0 && (
                              <Badge variant="secondary">{blockedCount} blocked</Badge>
                            )}
                            {!employee.lineManagerId &&
                              onboardingCase.tasks.some(
                                (task) => task.isMandatory && task.ownerRole === "Line Manager",
                              ) && <Badge variant="destructive">Manager needed</Badge>}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              void navigate({ to: `/staff/onboarding/${onboardingCase.id}` })
                            }
                          >
                            Open <ArrowRight className="h-4 w-4" />
                          </Button>
                        </article>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="templates">
            <OnboardingTemplatesPanel onChanged={() => setRevision((value) => value + 1)} />
          </TabsContent>
        </Tabs>

        <Dialog
          open={createOpen}
          onOpenChange={(open) => {
            setCreateOpen(open);
            if (!open) resetCreate();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Start employee onboarding</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Field label="Employee">
                <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an employee" />
                  </SelectTrigger>
                  <SelectContent>
                    {employeesAvailableForOnboarding.map((employee) => (
                      <SelectItem key={employee.id} value={employee.id}>
                        {employee.legalName} · {employee.employeeNumber}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {employeesAvailableForOnboarding.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Every employee with Onboarding status already has an active case.
                  </p>
                )}
              </Field>
              <Field label="Checklist template">
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a template" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="HR owner">
                <Select
                  value={assignedHRId || "automatic"}
                  onValueChange={(value) => setAssignedHRId(value === "automatic" ? "" : value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="automatic">Assign automatically</SelectItem>
                    {hrOwners.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button disabled={saving || !employeeId || !templateId} onClick={createCase}>
                {saving ? "Starting..." : "Start onboarding"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </RequirePermission>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium">{label}</div>
      {children}
    </div>
  );
}

function SummaryCard({
  title,
  value,
  icon: Icon,
  tone = "default",
}: {
  title: string;
  value: number;
  icon: typeof Clock3;
  tone?: "default" | "success" | "danger";
}) {
  const iconClass =
    tone === "success"
      ? "bg-emerald-50 text-emerald-700"
      : tone === "danger"
        ? "bg-rose-50 text-rose-700"
        : "bg-primary/10 text-primary";
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <div className="text-2xl font-bold">{value}</div>
          <div className="text-sm text-muted-foreground">{title}</div>
        </div>
        <div className={`rounded-xl p-3 ${iconClass}`}>
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}
