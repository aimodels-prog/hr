import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useHrSetupPreference } from "@/components/dashboards/use-hr-setup-preference";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";

export function GoogleCalendarConnection() {
  const setupPreference = useHrSetupPreference();
  const [status, setStatus] = useState<{
    configured: boolean;
    connected: boolean;
    accountEmail: string;
    emailEnabled: boolean;
    emailDeliveryCounts: Array<{ status: string; count: number }>;
  }>();
  const [error, setError] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const result = new URL(window.location.href).searchParams.get("calendar");
    if (result && result !== "connected")
      setError(
        "Google Calendar was not connected. Sign in through VIA Portal if your session expired, then try again using the organising account shown below.",
      );
    void fetch("/api/integrations/google-calendar", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Connection status could not be loaded.");
        const next = await response.json();
        setStatus(next);
        setAccountEmail(next.accountEmail);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Connection status could not be loaded.");
      });
    return () => controller.abort();
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Google Calendar &amp; Meet</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {setupPreference.hidden && (
          <Button
            variant="outline"
            onClick={() => {
              setupPreference.setHidden(false);
              toast.success("HR setup will appear on your dashboard again.");
            }}
          >
            Show setup on dashboard
          </Button>
        )}
        <p>
          {status?.connected
            ? `Organising account connected: ${status.accountEmail}`
            : status?.configured
              ? `Connect ${status.accountEmail} once for the HR team.`
              : "Google Calendar setup is awaiting administrator configuration. You can still prepare interview records."}
        </p>
        <form
          className="space-y-2"
          onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);
            setError("");
            try {
              const response = await fetch("/api/integrations/google-calendar", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ accountEmail }),
              });
              const result = await response.json();
              if (!response.ok) throw new Error(result.error || "The account could not be saved.");
              const refreshed = await fetch("/api/integrations/google-calendar");
              if (!refreshed.ok)
                throw new Error(
                  "Saved, but connection status could not be refreshed. Reload this page.",
                );
              setStatus(await refreshed.json());
              setAccountEmail(result.accountEmail);
              toast.success("Organising account saved.");
            } catch (failure) {
              setError(
                failure instanceof Error ? failure.message : "The account could not be saved.",
              );
            } finally {
              setSaving(false);
            }
          }}
        >
          <label htmlFor="calendar-organiser-email" className="text-sm font-medium">
            Organising email
          </label>
          <Input
            id="calendar-organiser-email"
            type="email"
            required
            maxLength={254}
            value={accountEmail}
            onChange={(event) => setAccountEmail(event.target.value)}
            disabled={!status || saving}
          />
          <p className="text-xs text-muted-foreground">
            Changing accounts requires a new Google sign-in and pauses approval emails. Linked
            interview bookings must be migrated by an administrator first.
          </p>
          <Button
            variant="outline"
            disabled={
              !status || saving || accountEmail.trim().toLowerCase() === status.accountEmail
            }
          >
            {saving ? "Saving…" : "Save account and reconnect"}
          </Button>
        </form>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Save your interview changes before connecting. VIA Portal remains your app login.
          Connecting does not send invitations.
        </p>
        <form method="post" action="/api/integrations/google-calendar">
          <Button disabled={!status?.configured}>
            {status?.connected ? "Reconnect Google Calendar" : "Connect Google Calendar & Meet"}
          </Button>
        </form>
        <div className="space-y-3 border-t pt-4">
          <h3 className="font-semibold">Approval emails & reminders</h3>
          <p className="text-sm">
            {status?.emailEnabled
              ? `Enabled through ${status.accountEmail}. The background worker sends workflow notifications and reminders.`
              : "Not enabled. Calendar permission alone cannot send workflow emails."}
          </p>
          <p className="text-xs text-muted-foreground">
            Enable Gmail API in the existing Google Cloud project, add the gmail.send scope, then
            connect below and allow sending as {status?.accountEmail ?? "the organising account"}.
            This starts emails for new workflow notifications; it does not email the old
            notification backlog. Private details stay inside VIA HR.
          </p>
          <form method="post" action="/api/integrations/google-calendar?email=enable">
            <Button disabled={!status?.configured} variant="outline">
              {status?.emailEnabled
                ? "Reconnect email sender"
                : "Enable approval emails & reminders"}
            </Button>
          </form>
          {status?.emailEnabled && (
            <form method="post" action="/api/integrations/google-calendar?email=disable">
              <Button variant="outline">Pause approval emails</Button>
            </form>
          )}
          {!!status?.emailDeliveryCounts?.length && (
            <ul className="text-sm">
              {status.emailDeliveryCounts.map((row) => (
                <li key={row.status}>
                  {row.status}: {row.count}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Sent means Google accepted the message, not that it was read or reached the inbox.
            Blocked messages need sender reconnection. Failed or uncertain sends require
            administrator review; uncertain sends are not automatically repeated.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
