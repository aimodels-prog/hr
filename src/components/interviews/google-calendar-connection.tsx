import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function GoogleCalendarConnection() {
  const [status, setStatus] = useState<{
    configured: boolean;
    connected: boolean;
    accountEmail: string;
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
      </CardContent>
    </Card>
  );
}
