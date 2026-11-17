import { SafeForm } from "@/components/ui/safe-form";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, CheckCircle2, Settings2 } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useHrSetupPreference } from "./use-hr-setup-preference";

type ConnectionStatus = {
  configured: boolean;
  connected: boolean;
  emailEnabled: boolean;
  accountEmail: string;
};

const shortcutClass =
  "inline-flex min-h-9 items-center gap-1 rounded-lg border px-3 text-xs font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function HrSetup() {
  const user = useCurrentUser();
  const preference = useHrSetupPreference();
  const allowed = user.activeRole === "HR" || user.activeRole === "Super Admin";
  const status = useQuery({
    queryKey: ["hr-dashboard-setup", user.id, user.activeRole],
    enabled: allowed && preference.loaded && !preference.hidden,
    staleTime: 60_000,
    retry: false,
    queryFn: async ({ signal }): Promise<ConnectionStatus> => {
      const response = await fetch("/api/integrations/google-calendar", {
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Setup status could not be checked.");
      return response.json();
    },
  });
  if (!allowed || !preference.loaded || preference.hidden) return null;
  const data = status.data;
  const complete = !status.isError && data?.configured && data.connected && data.emailEnabled;
  const connections = [
    {
      title: "Approval emails & reminders",
      ready: data?.emailEnabled,
      action: "/api/integrations/google-calendar?email=enable",
      button: "Enable emails",
    },
    {
      title: "Interview calendar & Google Meet",
      ready: data?.connected,
      action: "/api/integrations/google-calendar",
      button: "Connect calendar",
    },
  ];

  return (
    <section aria-label="HR setup" className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Settings2 className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold tracking-tight">HR setup</h2>
            <p className="text-xs text-muted-foreground">
              {complete ? "Email and calendar are ready" : "Connections and working rules"}
            </p>
          </div>
        </div>
        {complete && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              preference.setHidden(true);
              toast.success("Setup hidden on this browser. Restore it from Manage connections.", {
                action: { label: "Undo", onClick: () => preference.setHidden(false) },
              });
            }}
          >
            Hide from dashboard
          </Button>
        )}
      </div>

      {status.isPending ? (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          Checking connections…
        </p>
      ) : status.isError ? (
        <div role="status" className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          Connection status is unavailable.
          <Button
            variant="outline"
            size="sm"
            disabled={status.isFetching}
            onClick={() => void status.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : (
        <>
          {!data?.configured && (
            <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              An administrator needs to finish Google setup before HR can connect.
            </p>
          )}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {connections.map((connection) => (
              <div
                key={connection.title}
                className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/20 p-3"
              >
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{connection.title}</h3>
                  <p className="mt-0.5 break-all text-xs text-muted-foreground">
                    {connection.ready ? data?.accountEmail : "Not connected"}
                  </p>
                </div>
                {connection.ready ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                    <CheckCircle2 className="size-3.5" aria-hidden="true" />
                    Ready
                  </span>
                ) : (
                  <SafeForm method="post" action={connection.action}>
                    <Button size="sm" disabled={!data?.configured}>
                      {connection.button}
                    </Button>
                  </SafeForm>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <nav aria-label="HR setup shortcuts" className="mt-4 flex flex-wrap gap-2 border-t pt-4">
        <Link to="/staff/settings" search={{ section: "connections" }} className={shortcutClass}>
          Manage connections <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
        {user.can("attendance:manage_all") && (
          <Link to="/staff/attendance" hash="section=setup" className={shortcutClass}>
            Office & working hours
          </Link>
        )}
        {user.can("leave:admin_all") && (
          <Link to="/staff/leave-policies" className={shortcutClass}>
            Leave policies
          </Link>
        )}
        {(user.can("timesheet:admin_all") || user.can("system:settings_manage")) && (
          <Link to="/staff/timesheet-settings" className={shortcutClass}>
            Timesheet settings
          </Link>
        )}
        {(user.activeRole === "HR" || user.can("system:settings_manage")) && (
          <Link to="/staff/settings" search={{ section: "org" }} className={shortcutClass}>
            Company setup
          </Link>
        )}
      </nav>
    </section>
  );
}
