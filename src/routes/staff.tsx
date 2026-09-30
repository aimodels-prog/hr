import { useEffect, useState } from "react";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { ClipboardCheck, Sparkles } from "lucide-react";

import { HrSidebar } from "@/components/hr-sidebar";
import { SidebarSectionsProvider } from "@/components/layout/sidebar-sections-provider";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { NotificationDrawer } from "@/components/layout/notification-drawer";
import { ContextualHelpProvider, HelpShortcut, PageTip } from "@/components/help/contextual-help";
import { ApplicationBootScreen } from "@/components/layout/application-boot-screen";
import { DevRoleSwitcher } from "@/components/dev-role-switcher";
import { useCurrentUser } from "@/lib/auth";
import { SettingsService } from "@/lib/data/settings-service";
import { MasterDataService } from "@/lib/data/master-data";
import { EmployeeService } from "@/lib/data/employee-service";
import { type ActorContext } from "@/lib/data/types";
import { StaffModuleLoader } from "@/lib/data/staff-module-loader";
import { hydrateStaffModule } from "@/lib/data/staff-module-hydration";
import { StaffPageBoundary } from "@/components/layout/staff-data-boundary";
import { StaffDataContext } from "@/components/layout/staff-data-context";
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
  const { getActorContext } = useCurrentUser();
  const actor = getActorContext();
  // Remount before showing another identity/role: old module responses must never become its cache.
  const scope = JSON.stringify(actor.actor);
  return <StaffWorkspace key={scope} actor={actor} />;
}

function StaffWorkspace({ actor }: { actor: ActorContext }) {
  const { currentEmployee, isDevelopmentPreview } = useCurrentUser();
  const [actorContext] = useState(actor);
  const [settingsService] = useState(() => new SettingsService());
  const [masterDataService] = useState(() => new MasterDataService());
  const [employeeService] = useState(() => new EmployeeService());
  const [moduleLoader, setModuleLoader] = useState<StaffModuleLoader | null>(null);
  const [settings, setSettings] = useState<Awaited<
    ReturnType<SettingsService["getAppSettings"]>
  > | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setBootstrapError(null);
    const loader = new StaffModuleLoader((module, canCommit) =>
      hydrateStaffModule(module, actorContext, canCommit),
    );
    const timeout = setTimeout(() => {
      cancelled = true;
      setBootstrapError("The workspace took too long to load. Try again.");
    }, 20_000);
    retryTransientFetch(async () => {
      const [loadedSettings] = await Promise.all([
        settingsService.getAppSettings(),
        masterDataService.hydrateCompatibilityCache(),
      ]);
      if (!cancelled)
        await employeeService.hydrateCompatibilityCache(actorContext, () => !cancelled);
      return loadedSettings;
    })
      .then((loadedSettings) => {
        if (!cancelled) {
          setSettings(loadedSettings);
          setModuleLoader(loader);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setBootstrapError(
            error instanceof Error ? error.message : "VIA HR could not load organisation data.",
          );
        }
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      loader.dispose();
    };
  }, [actorContext, bootstrapAttempt, employeeService, masterDataService, settingsService]);

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

  if (!settings || !moduleLoader) {
    return <ApplicationBootScreen />;
  }

  return (
    <StaffDataContext.Provider value={moduleLoader}>
      <SidebarProvider>
        <ContextualHelpProvider>
          <SidebarSectionsProvider>
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
                    <HelpShortcut />
                    <NotificationDrawer />
                    <DevRoleSwitcher />
                  </div>
                </header>
                <main className="flex-1 bg-background p-4 sm:p-6 lg:p-8">
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
                  <StaffPageBoundary>
                    <PageTip />
                    <Outlet />
                  </StaffPageBoundary>
                </main>
              </div>
            </div>
          </SidebarSectionsProvider>
        </ContextualHelpProvider>
      </SidebarProvider>
    </StaffDataContext.Provider>
  );
}
