import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArchiveRestore,
  Clock3,
  DatabaseBackup,
  FileLock2,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const safeguards = [
  {
    title: "Complete system backup",
    description:
      "All VIA HR records are encrypted and included in a protected backup before it leaves the system.",
    icon: DatabaseBackup,
  },
  {
    title: "Document backup",
    description:
      "Encrypted employee and candidate documents are copied to the separate backup destination with their original record links.",
    icon: FileLock2,
  },
  {
    title: "Isolated recovery test",
    description:
      "A backup is accepted only after it is recovered safely and all records and files are checked.",
    icon: ArchiveRestore,
  },
];

interface WorkerStatus {
  status: string;
  activeWorkers: number;
  staleWorkers: number;
  queuedJobs: number;
  retryJobs: number;
  failedJobs: number;
  overdueSchedules: number;
  checkedAt: string;
}

export function DataManagement() {
  const [worker, setWorker] = useState<WorkerStatus | null>(null);
  const [workerError, setWorkerError] = useState("");
  const [workerLoading, setWorkerLoading] = useState(true);
  const refreshWorker = useCallback(async () => {
    setWorkerLoading(true);
    setWorkerError("");
    try {
      const response = await fetch("/health/worker", { cache: "no-store" });
      const payload = (await response.json()) as Partial<WorkerStatus>;
      if (
        typeof payload.activeWorkers !== "number" ||
        typeof payload.queuedJobs !== "number" ||
        typeof payload.failedJobs !== "number"
      ) {
        throw new Error("Worker monitoring returned an invalid response.");
      }
      setWorker(payload as WorkerStatus);
      if (!response.ok) setWorkerError("Background work needs administrator attention.");
    } catch (error) {
      setWorker(null);
      setWorkerError(error instanceof Error ? error.message : "Worker monitoring is unavailable.");
    } finally {
      setWorkerLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshWorker();
  }, [refreshWorker]);

  return (
    <div className="space-y-6">
      <Alert className="border-emerald-200 bg-emerald-50/70 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Protected production backups</AlertTitle>
        <AlertDescription>
          VIA HR backups are handled by the authorised server administrator. Browser downloads and
          uploads cannot replace the organisation&apos;s records or employee documents.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 lg:grid-cols-3">
        {safeguards.map(({ title, description, icon: Icon }) => (
          <Card key={title}>
            <CardHeader>
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <CardTitle className="text-base">{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" /> Background processing
              </CardTitle>
              <CardDescription>
                Current worker availability, queued work and failed jobs.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refreshWorker()}
              disabled={workerLoading}
            >
              <RefreshCcw className={`h-4 w-4 ${workerLoading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {workerError ? (
            <Alert variant="destructive">
              <AlertTitle>Attention required</AlertTitle>
              <AlertDescription>{workerError}</AlertDescription>
            </Alert>
          ) : null}
          {workerLoading && !worker ? (
            <p className="text-sm text-muted-foreground">Checking background processing…</p>
          ) : worker ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              {[
                ["Active workers", worker.activeWorkers],
                ["Stale workers", worker.staleWorkers],
                ["Queued", worker.queuedJobs],
                ["Retrying", worker.retryJobs],
                ["Failed", worker.failedJobs],
                ["Overdue schedules", worker.overdueSchedules],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl border p-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
                </div>
              ))}
            </div>
          ) : null}
          {worker ? (
            <p className="text-xs text-muted-foreground">
              Last checked {new Date(worker.checkedAt).toLocaleString()}.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Recovery and retention</CardTitle>
              <CardDescription>
                Controls applied to the organisation&apos;s protected records.
              </CardDescription>
            </div>
            <Badge variant="outline" className="gap-1.5">
              <Clock3 className="h-3.5 w-3.5" /> Administrator managed
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 text-sm md:grid-cols-2">
            <div className="rounded-xl border p-4">
              <p className="font-medium">Backup retention</p>
              <p className="mt-1 text-muted-foreground">
                Daily and pre-release backups are retained in separate off-server storage according
                to VIA&apos;s approved retention period.
              </p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="font-medium">Safe restore</p>
              <p className="mt-1 text-muted-foreground">
                Recovery cannot overwrite the live system. It must first be completed and checked in
                a separate, empty recovery area.
              </p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="font-medium">Employee information</p>
              <p className="mt-1 text-muted-foreground">
                Employment records are retained for the approved legal and operational period, then
                archived, anonymised or deleted through an authorised process.
              </p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="font-medium">Legal hold</p>
              <p className="mt-1 text-muted-foreground">
                An active investigation, claim or legal obligation pauses deletion until the
                authorised record owner releases the hold.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
