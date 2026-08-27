/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useRef } from "react";
import { Download, Upload, RotateCcw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useCurrentUser } from "@/lib/auth";
import {
  exportApplicationBackup,
  previewApplicationRestore,
  restoreApplicationBackup,
  resetApplicationDemoData,
} from "@/lib/data/application-data";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function DataManagement() {
  const { currentUser, activeRole } = useCurrentUser();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentActor = currentUser
    ? {
        userId: currentUser.id,
        employeeId: currentUser.employeeId,
        displayName: currentUser.displayName,
        roles: currentUser.roles,
        activeRole,
      }
    : { userId: "system", displayName: "System", roles: [] };

  const [restorePreview, setRestorePreview] = useState<any>(null);
  const [isRestoreDialogOpen, setIsRestoreDialogOpen] = useState(false);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [rawRestoreData, setRawRestoreData] = useState<string>("");

  const handleExport = () => {
    try {
      const data = exportApplicationBackup({ actor: currentActor });
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `via-hr-backup-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Backup downloaded");
    } catch (e: any) {
      toast.error(`Export failed: ${e.message}`);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const preview = previewApplicationRestore(content);
        setRawRestoreData(content);
        setRestorePreview(preview);
        setIsRestoreDialogOpen(true);
      } catch (e: any) {
        toast.error(`Invalid backup file: ${e.message}`);
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.readAsText(file);
  };

  const confirmRestore = () => {
    try {
      const result = restoreApplicationBackup(rawRestoreData, { actor: currentActor as any });
      const collectionsRestored = Object.keys(result.collectionCounts).length;
      const totalRecordsRestored = Object.values(result.collectionCounts).reduce(
        (a, b) => a + b,
        0,
      );
      toast.success(
        `Restore complete: ${collectionsRestored} sections and ${totalRecordsRestored} records.`,
      );
      setIsRestoreDialogOpen(false);
      setTimeout(() => window.location.reload(), 1500);
    } catch (e: any) {
      toast.error(`Restore failed: ${e.message}`);
    }
  };

  const confirmReset = async () => {
    try {
      await resetApplicationDemoData({ actor: currentActor as any });
      toast.success("The sample workspace has been restored.");
      setIsResetDialogOpen(false);
      setTimeout(() => window.location.reload(), 1500);
    } catch (e: any) {
      toast.error(`Reset failed: ${e.message}`);
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" /> Export Backup
          </CardTitle>
          <CardDescription>Download a copy of your VIA HR records and settings.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Uploaded documents and profile pictures are not included. Keep a separate copy of those
            files.
          </p>
        </CardContent>
        <CardFooter>
          <Button onClick={handleExport} className="w-full">
            Export Data
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" /> Restore Backup
          </CardTitle>
          <CardDescription>Restore VIA HR System from a previous backup.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Restoring will replace the current VIA HR records. You can review the backup before
            confirming.
          </p>
          <input
            type="file"
            accept=".json"
            className="hidden"
            ref={fileInputRef}
            onChange={handleFileSelect}
          />
        </CardContent>
        <CardFooter>
          <Button
            onClick={() => fileInputRef.current?.click()}
            variant="secondary"
            className="w-full"
          >
            Select File
          </Button>
        </CardFooter>
      </Card>

      <Card className="border-rose-200 bg-rose-50/50 dark:border-rose-900/50 dark:bg-rose-950/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-rose-700 dark:text-rose-500">
            <RotateCcw className="h-5 w-5" /> Reset Sample Workspace
          </CardTitle>
          <CardDescription className="text-rose-600/80 dark:text-rose-400/80">
            Delete current records and restore the original sample information.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-rose-700/80 dark:text-rose-400/80">
            All changes, new employees and settings will be permanently removed.
          </p>
        </CardContent>
        <CardFooter>
          <Button
            onClick={() => setIsResetDialogOpen(true)}
            variant="destructive"
            className="w-full"
          >
            Reset System
          </Button>
        </CardFooter>
      </Card>

      {/* Restore Confirmation Dialog */}
      <Dialog open={isRestoreDialogOpen} onOpenChange={setIsRestoreDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Restore</DialogTitle>
            <DialogDescription>
              Review the backup before replacing the current records.
            </DialogDescription>
          </DialogHeader>

          {restorePreview && (
            <div className="space-y-4 py-2">
              <Alert variant={restorePreview.isValid ? "default" : "destructive"}>
                {restorePreview.isValid ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <AlertTriangle className="h-4 w-4" />
                )}
                <AlertTitle>
                  {restorePreview.isValid ? "Valid Backup" : "Invalid Backup"}
                </AlertTitle>
                <AlertDescription>
                  {restorePreview.isValid
                    ? "This backup is ready to restore."
                    : restorePreview.error}
                </AlertDescription>
              </Alert>

              {restorePreview.isValid && (
                <div className="rounded-md bg-muted p-4 text-sm">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="font-medium">Sections:</div>
                    <div>{restorePreview.collectionsFound}</div>
                    <div className="font-medium">Total Records:</div>
                    <div>{restorePreview.totalRecords}</div>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRestoreDialogOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!restorePreview?.isValid} onClick={confirmRestore}>
              Confirm Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Confirmation Dialog */}
      <Dialog open={isResetDialogOpen} onOpenChange={setIsResetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-rose-600 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" /> Reset Sample Workspace?
            </DialogTitle>
            <DialogDescription>
              This will permanently delete the current VIA HR records saved on this device.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm font-medium">This action will:</p>
            <ul className="list-disc pl-5 text-sm text-muted-foreground mt-2 space-y-1">
              <li>Delete all custom employees, vacancies, and records.</li>
              <li>Remove current settings, departments and other company lists.</li>
              <li>Restore the seven original sample employees and default settings.</li>
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsResetDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmReset}>
              Yes, Reset System
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
