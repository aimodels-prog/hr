import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, ChevronDown, Settings2 } from "lucide-react";
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

export function HrSetup() {
  const user = useCurrentUser();
  const panelId = useId();
  const preference = useHrSetupPreference();
  const [expanded, setExpanded] = useState<boolean | null>(null);
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
  const needsConnection = data && (!data.configured || !data.connected || !data.emailEnabled);
  const open = expanded ?? Boolean(needsConnection || status.isError);
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
    <section aria-label="HR setup" className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-x-2 pr-3">
        <button
          type="button"
          className="flex min-h-12 flex-1 items-center gap-3 rounded-xl p-4 text-left focus-visible:outline-primary"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setExpanded(!open)}
        >
          <Settings2 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="font-medium">HR setup</span>
          {needsConnection && (
            <span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">
              Connect your HR account
            </span>
          )}
          {status.isError && (
            <span className="text-xs text-muted-foreground">Check connection status</span>
          )}
          <ChevronDown
            className={`ml-auto h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
        {complete && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mb-1 ml-3 sm:mb-0"
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
      {open && (
        <div id={panelId} className="space-y-4 border-t p-4">
          {status.isPending ? (
            <p role="status" className="text-sm text-muted-foreground">
              Checking connections…
            </p>
          ) : status.isError ? (
            <div className="flex flex-wrap items-center gap-3">
              <p role="status" className="text-sm">
                Connection status is unavailable.
              </p>
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
                <p className="text-sm text-muted-foreground">
                  Your administrator needs to finish Google setup before HR can connect.
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {connections.map((connection) => (
                  <div
                    key={connection.title}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium">{connection.title}</h3>
                      {connection.ready && (
                        <p className="mt-1 flex items-center gap-1 break-all text-xs text-muted-foreground">
                          <CheckCircle2
                            className="h-3.5 w-3.5 shrink-0 text-primary"
                            aria-hidden="true"
                          />
                          {data?.accountEmail}
                        </p>
                      )}
                    </div>
                    {connection.ready ? (
                      <span className="text-xs text-primary">
                        {connection.title.startsWith("Approval") ? "Enabled" : "Connected"}
                      </span>
                    ) : (
                      <form method="post" action={connection.action}>
                        <Button size="sm" disabled={!data?.configured}>
                          {connection.button}
                        </Button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
              {needsConnection && data?.configured && (
                <p className="text-xs text-muted-foreground">
                  Connect {status.data?.accountEmail ?? "the organising account"} once. Email
                  permission is separate from calendar permission.
                </p>
              )}
            </>
          )}
          <nav aria-label="HR setup shortcuts" className="flex flex-wrap gap-2 border-t pt-3">
            <Button variant="outline" size="sm" asChild>
              <Link to="/staff/requests" search={{ view: "organisation" }}>
                Manage connections
              </Link>
            </Button>
            {user.can("attendance:manage_all") && (
              <Button variant="outline" size="sm" asChild>
                <Link to="/staff/attendance" hash="section=setup">
                  Office & working hours
                </Link>
              </Button>
            )}
            {user.can("leave:admin_all") && (
              <Button variant="outline" size="sm" asChild>
                <Link to="/staff/leave-policies">Leave policies</Link>
              </Button>
            )}
            {(user.can("timesheet:admin_all") || user.can("system:settings_manage")) && (
              <Button variant="outline" size="sm" asChild>
                <Link to="/staff/timesheet-settings">Timesheet settings</Link>
              </Button>
            )}
            {user.can("system:settings_manage") && (
              <Button variant="outline" size="sm" asChild>
                <Link to="/staff/settings" search={{ section: "org" }}>
                  Company setup
                </Link>
              </Button>
            )}
          </nav>
        </div>
      )}
    </section>
  );
}
