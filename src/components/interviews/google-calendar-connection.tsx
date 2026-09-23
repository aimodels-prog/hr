import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function GoogleCalendarConnection() {
  const [status, setStatus] = useState<{
    configured: boolean;
    connected: boolean;
    accountEmail: string;
    emailEnabled: boolean;
    emailDeliveryCounts: Array<{ status: string; count: number }>;
  }>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const result = new URL(window.location.href).searchParams.get("calendar");
    if (result && result !== "connected")
      setError(
        "Google Calendar was not connected. Sign in through VIA Portal if your session expired, then try again using hr@via-int.com.",
      );
    void fetch("/api/integrations/google-calendar", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Connection status could not be loaded.");
        setStatus(await response.json());
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
        <p>
          {status?.connected
            ? `Organising account connected: ${status.accountEmail}`
            : status?.configured
              ? "Connect hr@via-int.com once for the HR team."
              : "Google Calendar setup is awaiting administrator configuration. You can still prepare interview records."}
        </p>
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
            connect below and allow sending as hr@via-int.com. This starts emails for new workflow
            notifications; it does not email the old notification backlog. Private details stay
            inside VIA HR.
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
