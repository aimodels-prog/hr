import { useEffect, useState } from "react";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { ClipboardCheck, Sparkles } from "lucide-react";

import { HrSidebar } from "@/components/hr-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { NotificationDrawer } from "@/components/layout/notification-drawer";
import { DevRoleSwitcher } from "@/components/dev-role-switcher";
import { useCurrentUser } from "@/lib/auth";
import { OnboardingService } from "@/lib/data/onboarding-service";
import { SettingsService } from "@/lib/data/settings-service";
import { MasterDataService } from "@/lib/data/master-data";
import { LeaveService } from "@/lib/data/leave-service";
import { TimesheetService } from "@/lib/data/timesheet-service";
import { OvertimeService } from "@/lib/data/overtime-service";
import { TravelService } from "@/lib/data/travel-service";
import { PayrollService } from "@/lib/data/payroll-service";
import { PerformanceService } from "@/lib/data/performance-service";
import { TrainingService } from "@/lib/data/training-service";
import { EmployeeService } from "@/lib/data/employee-service";
import { VacancyService } from "@/lib/data/vacancy-service";
import { CandidateService } from "@/lib/data/candidate-service";
import { getApplicationDataServices } from "@/lib/data/application-data";
import { type Role } from "@/lib/data/types";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/staff")({
  component: StaffLayout,
});

function isTransientFetchError(error: unknown): boolean {
  return (
    error instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(error.message)
  );
}

async function retryTransientFetch<T>(operation: () => Promise<T>): Promise<T> {
  const maximumAttempts = 3;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientFetchError(error) || attempt === maximumAttempts) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, attempt * 300));
    }
  }
  throw new Error("VIA HR could not load organisation data.");
}

function StaffLayout() {
  const { currentEmployee, currentUser, activeRole, getActorContext, isDevelopmentPreview } =
    useCurrentUser();
  const [obService] = useState(() => new OnboardingService());
  const [settingsService] = useState(() => new SettingsService());
  const [masterDataService] = useState(() => new MasterDataService());
  const [employeeService] = useState(() => new EmployeeService());
  const [vacancyService] = useState(() => new VacancyService());
  const [candidateService] = useState(() => new CandidateService());
  const [leaveService] = useState(() => new LeaveService());
  const [timesheetService] = useState(() => new TimesheetService());
  const [overtimeService] = useState(() => new OvertimeService());
  const [travelService] = useState(() => new TravelService());
  const [payrollService] = useState(() => new PayrollService());
  const [performanceService] = useState(() => new PerformanceService());
  const [trainingService] = useState(() => new TrainingService());
  const [notificationService] = useState(() => getApplicationDataServices().notifications);
  const [settings, setSettings] = useState<Awaited<
    ReturnType<SettingsService["getAppSettings"]>
  > | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const currentUserId = currentUser?.id ?? "user-rana";
  const currentEmployeeId = currentUser?.employeeId ?? "employee-rana";
  const currentDisplayName = currentUser?.displayName ?? "Rana Nair";
  const currentWorkspaceEmail = currentUser?.workspaceEmail ?? "rana.nair@via-int.com";
  const currentRolesKey = currentUser?.roles.join("|") ?? "Employee|HR";

  useEffect(() => {
    let cancelled = false;
    setBootstrapError(null);
    retryTransientFetch(async () => {
      const [loadedSettings] = await Promise.all([
        settingsService.getAppSettings(),
        masterDataService.hydrateCompatibilityCache(),
      ]);
      const actorContext = {
        actor: {
          userId: currentUserId,
          employeeId: currentEmployeeId,
          displayName: currentDisplayName,
          workspaceEmail: currentWorkspaceEmail,
          roles: currentRolesKey.split("|") as Role[],
          activeRole,
        },
      };
      await employeeService.hydrateCompatibilityCache(actorContext);
      await obService.hydrateCompatibilityCache(actorContext);
      await leaveService.hydrateCompatibilityCache(actorContext);
      await timesheetService.hydrateCompatibilityCache(actorContext);
      await overtimeService.hydrateCompatibilityCache(actorContext);
      await travelService.hydrateCompatibilityCache(actorContext);
      await performanceService.hydrateCompatibilityCache(actorContext);
      await trainingService.hydrateCompatibilityCache(actorContext);
      await notificationService.hydrateCompatibilityCache(actorContext);
      if (activeRole === "Accounts" || activeRole === "Super Admin")
        await payrollService.hydrateCompatibilityCache(actorContext);
      if (activeRole === "HR" || activeRole === "Super Admin") {
        await vacancyService.hydrateCompatibilityCache(actorContext);
        await candidateService.hydrateCompatibilityCache(actorContext);
      }
      return loadedSettings;
    })
      .then((loadedSettings) => {
        if (!cancelled) setSettings(loadedSettings);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setBootstrapError(
            error instanceof Error ? error.message : "VIA HR could not load organisation data.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeRole,
    bootstrapAttempt,
    candidateService,
    currentDisplayName,
    currentEmployeeId,
    currentRolesKey,
    currentUserId,
    currentWorkspaceEmail,
    employeeService,
    leaveService,
    masterDataService,
    notificationService,
    obService,
    overtimeService,
    payrollService,
    performanceService,
    settingsService,
    timesheetService,
    travelService,
    trainingService,
    vacancyService,
  ]);

  const setupNeedsAttention =
    currentEmployee?.profileSetupStatus === "In Progress" ||
    currentEmployee?.employmentConfirmationStatus === "Pending HR Review" ||
    currentEmployee?.employmentConfirmationStatus === "Changes Requested";
  const employmentChangesRequested =
    currentEmployee?.employmentConfirmationStatus === "Changes Requested";
  const awaitingEmploymentConfirmation =
    currentEmployee?.employmentConfirmationStatus === "Pending HR Review";

  if (!settings && bootstrapError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-lg rounded-2xl border bg-card p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold">Organisation data is unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">{bootstrapError}</p>
          <Button className="mt-6" onClick={() => setBootstrapAttempt((value) => value + 1)}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <p className="text-sm text-muted-foreground">Loading VIA HR organisation data…</p>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <HrSidebar />
        <div className="min-w-0 flex flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border/70 bg-card/90 px-4 shadow-[0_1px_12px_oklch(0.3_0.08_253/0.04)] backdrop-blur-xl sm:px-6">
            <SidebarTrigger className="h-9 w-9 rounded-xl border border-border/70 bg-background shadow-sm" />
            <div className="hidden items-center gap-2 md:flex">
              <span className="font-display text-[15px] font-bold tracking-[-0.02em]">
                VIA HR System
              </span>
              <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-success">
                People operations
              </span>
            </div>

            <div className="ml-auto flex items-center gap-2">
              {isDevelopmentPreview && (
                <div className="hidden items-center gap-1.5 rounded-full border border-primary/10 bg-primary/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-primary xl:flex">
                  <Sparkles className="h-3 w-3" /> Demo workspace
                </div>
              )}
              <NotificationDrawer />
              <DevRoleSwitcher />
            </div>
          </header>
          <main className="page-grid flex-1 p-4 sm:p-6 lg:p-8">
            {setupNeedsAttention && (
              <div className="mx-auto mb-5 flex max-w-7xl flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-3">
                  <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div>
                    <p className="font-medium">
                      {employmentChangesRequested
                        ? "Update your employment information"
                        : awaitingEmploymentConfirmation &&
                            currentEmployee?.profileSetupStatus === "Completed"
                          ? "Your employment information is with HR"
                          : "Complete your employee record"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {employmentChangesRequested
                        ? currentEmployee?.employmentReviewNote ||
                          "HR requested changes before confirming your employment information."
                        : awaitingEmploymentConfirmation &&
                            currentEmployee?.profileSetupStatus === "Completed"
                          ? "Your details are saved. Leave, timesheets, travel and overtime become available after HR confirms your employment information."
                          : "You can continue using essential work services while you finish your details and documents. Leave becomes available after HR confirms your employment information."}
                    </p>
                  </div>
                </div>
                <Button asChild size="sm" className="shrink-0">
                  <Link to="/staff/me/onboarding">Continue setup</Link>
                </Button>
              </div>
            )}
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
