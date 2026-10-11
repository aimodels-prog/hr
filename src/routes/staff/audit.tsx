import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { AuditViewer } from "@/components/audit-viewer";
import { useCurrentUser, RequireRole } from "@/lib/auth";
import { exportAuditCsvFn } from "@/lib/server-functions/audit.server";
import { toast } from "sonner";
import { ExportMenu } from "@/components/ui/export-menu";
import { downloadCsvExport, type ExportFormat } from "@/lib/data/excel-export";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/staff/audit")({
  component: GlobalAuditRoute,
});

function GlobalAuditRoute() {
  const currentUser = useCurrentUser();
  const [isExporting, setIsExporting] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("xlsx");

  if (!currentUser) return null;

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const exported = await exportAuditCsvFn({
        data: {
          actor: {
            actorId: currentUser.id,
            actorEmail: currentUser.currentEmployee?.workEmail,
            activeRole: currentUser.activeRole,
          },
          filters: { global: true },
        },
      });

      await downloadCsvExport(exported.csv, exported.fileName, exportFormat);

      toast.success(`${exported.rowCount} audit records downloaded`);
      setExportDialogOpen(false);
    } catch (error: unknown) {
      toast.error(
        `Audit history could not be downloaded: ${error instanceof Error ? error.message : "Please try again."}`,
      );
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <RequireRole roles={["Super Admin"]} resourceName="Audit History">
      <div className="mx-auto flex h-full max-w-[1500px] flex-col gap-6 pb-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <PageHeader
            title="Audit History"
            description="Review who changed, approved or accessed information across VIA HR System."
          />
          <ExportMenu
            onExport={async (format) => {
              setExportFormat(format);
              setExportDialogOpen(true);
            }}
            disabled={isExporting}
          />
        </div>

        <div className="flex-1 min-h-[600px]">
          <AuditViewer global />
        </div>

        <AlertDialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Download the complete audit history?</AlertDialogTitle>
              <AlertDialogDescription>
                The file contains activity from across VIA HR System. Keep it secure and share it
                only with authorised colleagues. Your download will be recorded.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isExporting}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleExport} disabled={isExporting}>
                {isExporting
                  ? "Preparing file…"
                  : exportFormat === "xlsx"
                    ? "Download Excel"
                    : "Download CSV"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </RequireRole>
  );
}
