import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";

import { HrSidebar } from "@/components/hr-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { NotificationDrawer } from "@/components/layout/notification-drawer";
import { DevRoleSwitcher } from "@/components/dev-role-switcher";
import { useCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { SelfServiceOnboardingForm } from "@/components/onboarding/self-service-onboarding-form";
import { OnboardingService } from "@/lib/data/onboarding-service";
import { SettingsService } from "@/lib/data/settings-service";
import { AttendanceService } from "@/lib/data/attendance-service";
import { LeaveService } from "@/lib/data/leave-service";
import { TimesheetService } from "@/lib/data/timesheet-service";
import { DocumentService } from "@/lib/data/document-service";
import { SYSTEM_CONTEXT } from "@/lib/data/types";

export const Route = createFileRoute("/staff")({
  component: StaffLayout,
});

function StaffLayout() {
  const { currentEmployee, getActorContext } = useCurrentUser();
  const [obService] = useState(() => new OnboardingService());
  const [settingsService] = useState(() => new SettingsService());
  const [settings, setSettings] = useState(() => settingsService.getAppSettingsSync());
  const [gateCleared, setGateCleared] = useState(false);

  useEffect(() => {
    settingsService
      .getAppSettings()
      .then(setSettings)
      .catch(() => {});
  }, [settingsService]);

  const isGated = useMemo(() => {
    if (gateCleared || !currentEmployee || !settings) return false;
    if (!settings.requireOnboardingCompletionBeforeDashboard) return false;
    try {
      return obService.hasIncompleteSelfServiceTasks(currentEmployee.id, getActorContext());
    } catch {
      return false;
    }
  }, [currentEmployee, gateCleared, getActorContext, obService, settings]);

  return (
    <SidebarProvider>
      <OperationsAutomation onboardingService={obService} />
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
              <div className="hidden items-center gap-1.5 rounded-full border border-primary/10 bg-primary/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-primary xl:flex">
                <Sparkles className="h-3 w-3" /> Demo workspace
              </div>
              <NotificationDrawer />
              <DevRoleSwitcher />
            </div>
          </header>
          <main className="page-grid flex-1 p-4 sm:p-6 lg:p-8">
            {isGated && currentEmployee ? (
              <div className="flex flex-col gap-6 max-w-3xl mx-auto pb-10">
                <PageHeader
                  title="Welcome - let's finish setting up your record"
                  description="HR and Finance need a few more details from you before you can access the rest of the system."
                />
                <SelfServiceOnboardingForm
                  employeeId={currentEmployee.id}
                  onAllComplete={() => setGateCleared(true)}
                />
              </div>
            ) : (
              <Outlet />
            )}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function OperationsAutomation({ onboardingService }: { onboardingService: OnboardingService }) {
  const [attendanceService] = useState(() => new AttendanceService());
  const [leaveService] = useState(() => new LeaveService());
  const [timesheetService] = useState(() => new TimesheetService(attendanceService));
  const [documentService] = useState(() => new DocumentService());

  useEffect(() => {
    const reconcile = () => {
      attendanceService.reconcileSiteVisits();
      attendanceService.reconcileSignOutReminders();
      onboardingService.reconcileStartDates();
      leaveService.autoRunAnnualRollover();
      timesheetService.reconcileSubmissionReminders();
      documentService.reconcileExpiryNotifications(SYSTEM_CONTEXT);
      window.dispatchEvent(new CustomEvent("via_hr:notifications_changed"));
    };
    reconcile();
    const timer = window.setInterval(reconcile, 60_000);
    return () => window.clearInterval(timer);
  }, [attendanceService, onboardingService, leaveService, timesheetService, documentService]);

  return null;
}
