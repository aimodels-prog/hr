import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { toast } from "sonner";

const endpoint = "/api/integrations/recruitment-mailboxes";
type Mailbox = {
  id: string;
  email: string;
  labelId: string;
  sinceDate: string;
  vacancyId: string | null;
  connected: boolean;
  paused: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
};
type Overview = {
  configured: boolean;
  mailboxes: Mailbox[];
  recent: {
    id: string;
    mailboxId: string;
    status: string;
    importedCount: number;
    error: string | null;
    updatedAt: string;
  }[];
};
type Vacancy = { id: string; title: string };
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${endpoint}${path}`, {
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Please try again.");
  return data as T;
}

export function RecruitmentMailboxes({ vacancies }: { vacancies: Vacancy[] }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    try {
      setOverview(await request<Overview>(""));
      setError("");
    } catch {
      setError("Recruitment mailboxes could not be loaded.");
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("mailbox");
    if (result === "connected")
      toast.success("Mailbox connected. Choose a label, save, then start importing.");
    else if (result)
      toast.error(
        "Mailbox was not connected. Check Google setup and sign in with the mailbox account.",
      );
  }, []);
  async function add() {
    setBusy(true);
    try {
      await request("?action=add", {
        email,
        labelId: "INBOX",
        sinceDate: new Date().toISOString().slice(0, 10),
      });
      setEmail("");
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add mailbox.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recruitment mailboxes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Import PDF and Word CVs from selected Gmail labels. Originals are kept; extracted details
          wait for HR review. Manual uploads remain available below.
        </p>
        {error && (
          <p role="alert">
            {error}{" "}
            <Button variant="outline" onClick={() => void reload()}>
              Retry
            </Button>
          </p>
        )}
        {overview && !overview.configured && (
          <p className="text-sm" role="status">
            Google recruitment email setup is needed before connecting mailboxes. Calendar is
            separate and is not affected.
          </p>
        )}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <div className="min-w-0 flex-1">
            <Label htmlFor="recruitment-mailbox-email">Mailbox email</Label>
            <Input
              id="recruitment-mailbox-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="recruitment@company.com"
            />
          </div>
          <Button disabled={busy || !overview?.configured}>Add mailbox</Button>
          <Button type="button" variant="outline" onClick={() => void reload()}>
            Refresh
          </Button>
        </form>
        {overview?.mailboxes.map((mailbox) => (
          <MailboxCard key={mailbox.id} mailbox={mailbox} vacancies={vacancies} reload={reload} />
        ))}
        {!!overview?.recent.length && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">Recent imports</summary>
            <ul className="mt-3 space-y-2">
              {overview.recent.map((row) => (
                <li key={row.id} className="rounded-md border p-3 text-sm">
                  <span className="font-medium">
                    {overview.mailboxes.find((m) => m.id === row.mailboxId)?.email}
                  </span>{" "}
                  — {row.status} · {row.importedCount} CV(s)
                  <span className="block text-muted-foreground">
                    {new Date(row.updatedAt).toLocaleString()}
                    {row.error ? ` · ${row.error}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function MailboxCard({
  mailbox,
  vacancies,
  reload,
}: {
  mailbox: Mailbox;
  vacancies: Vacancy[];
  reload: () => Promise<void>;
}) {
  const [label, setLabel] = useState(mailbox.labelId);
  const [since, setSince] = useState(mailbox.sinceDate);
  const [vacancy, setVacancy] = useState(mailbox.vacancyId ?? "none");
  const [labels, setLabels] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  async function action(name: string, body: unknown = {}) {
    if (
      name === "disconnect" &&
      !window.confirm(
        "Disconnect this mailbox? Imported CVs will be kept. Future imports will stop.",
      )
    )
      return;
    setBusy(true);
    try {
      await request(`?id=${mailbox.id}&action=${name}`, body);
      await reload();
      toast.success(name === "settings" ? "Mailbox settings saved." : "Mailbox updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function loadLabels() {
    setBusy(true);
    try {
      const result = await request<{ labels: { id: string; name: string }[] }>(
        `?id=${mailbox.id}&action=labels`,
      );
      setLabels(result.labels);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load labels.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label={mailbox.email}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium break-all">{mailbox.email}</h3>
        <span className="text-sm text-muted-foreground">
          {!mailbox.connected ? "Not connected" : mailbox.paused ? "Paused" : "Importing"}
        </span>
      </div>
      {mailbox.lastError && (
        <p role="alert" className="text-sm text-destructive">
          {mailbox.lastError}
        </p>
      )}
      <form method="post" action={`${endpoint}?id=${mailbox.id}&action=connect`}>
        <Button variant="outline" type="submit">
          {mailbox.connected ? "Reconnect Google" : "Connect Google"}
        </Button>
      </form>
      {mailbox.connected && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>Recruitment label</Label>
              <SearchableSelect
                value={label}
                onValueChange={setLabel}
                options={(labels.length
                  ? labels
                  : [{ id: mailbox.labelId, name: mailbox.labelId }]
                ).map((l) => ({ value: l.id, label: l.name }))}
              />
              <Button variant="link" disabled={busy} onClick={() => void loadLabels()}>
                Load Google labels
              </Button>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${mailbox.id}-since`}>Emails received from</Label>
              <Input
                id={`${mailbox.id}-since`}
                type="date"
                value={since}
                onChange={(e) => setSince(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Assign new CVs to</Label>
              <SearchableSelect
                value={vacancy}
                onValueChange={setVacancy}
                options={[
                  { value: "none", label: "HR will choose the role" },
                  ...vacancies.map((v) => ({ value: v.id, label: v.title })),
                ]}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Use a label containing recruitment emails only. Google grants read access to the
            mailbox; VIA imports only the label selected here. No emails are changed or deleted.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy}
              variant="outline"
              onClick={() =>
                void action("settings", {
                  labelId: label,
                  sinceDate: since,
                  vacancyId: vacancy === "none" ? null : vacancy,
                })
              }
            >
              Save settings
            </Button>
            <Button
              disabled={
                busy ||
                label !== mailbox.labelId ||
                since !== mailbox.sinceDate ||
                vacancy !== (mailbox.vacancyId ?? "none")
              }
              onClick={() => void action(mailbox.paused ? "resume" : "pause")}
            >
              {mailbox.paused ? "Start importing" : "Pause imports"}
            </Button>
            <Button disabled={busy} variant="outline" onClick={() => void action("retry")}>
              Check again / retry
            </Button>
            <Button disabled={busy} variant="ghost" onClick={() => void action("disconnect")}>
              Disconnect
            </Button>
          </div>
        </>
      )}
      {mailbox.lastSyncAt && (
        <p className="text-xs text-muted-foreground">
          Last checked {new Date(mailbox.lastSyncAt).toLocaleString()}
        </p>
      )}
    </section>
  );
}
