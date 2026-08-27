import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { AuditViewer } from "@/components/audit-viewer";
import { getApplicationDataServices } from "@/lib/data/application-data";
import { useCurrentUser, RequirePermission } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { toast } from "sonner";
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

  if (!currentUser) return null;

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const { audit } = getApplicationDataServices();

      // Log the export action itself first
      audit.record({
        context: {
          actor: {
            userId: currentUser.userId,
            displayName: currentUser.displayName,
            roles: currentUser.roles,
            activeRole: currentUser.activeRole,
          },
        },
        action: "export",
        module: "Audit",
        entityType: "system",
        entityId: "global-audit",
        reason: "User requested CSV export of global audit logs",
        riskLevel: "High",
      });

      const allEvents = audit.list();

      // Build simple CSV
      const headers = [
        "ID",
        "Timestamp",
        "Actor",
        "Role",
        "Module",
        "Entity",
        "EntityID",
        "Action",
        "Risk",
        "Reason",
      ];
      const rows = allEvents.map((e) =>
        [
          e.id,
          e.occurredAt,
          e.actor.displayName,
          e.actor.activeRole || e.actor.roles[0],
          e.module,
          e.entityType,
          e.entityId,
          e.action,
          e.riskLevel,
          e.reason || "",
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      );

      const csvContent = [headers.join(","), ...rows].join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `audit_export_${new Date().toISOString().split("T")[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success("Audit history downloaded");
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
    <RequirePermission permission="system:audit_view" resourceName="Audit History">
      <div className="mx-auto flex h-full max-w-[1500px] flex-col gap-6 pb-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <PageHeader
            title="Audit History"
            description="Review who changed, approved or accessed information across VIA HR System."
          />
          <Button
            variant="outline"
            onClick={() => setExportDialogOpen(true)}
            disabled={isExporting}
            className="self-start sm:self-auto"
          >
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
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
                {isExporting ? "Preparing file…" : "Download CSV"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </RequirePermission>
  );
}
