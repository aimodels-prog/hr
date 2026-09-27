import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/lib/auth";
import { EmployeeService } from "@/lib/data/employee-service";
import { getApplicationDataServices } from "@/lib/data/application-data";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const labels: Record<string, string> = {
  lineManagerId: "Supervisor",
  projectId: "Project",
  costCentreId: "Cost centre",
  employmentType: "Employment type",
  staffEntryType: "Staff entry type",
  visaRequired: "Visa required",
  startDate: "Joining date",
  probationEndDate: "Probation end",
  weeklyHours: "Weekly hours",
  department: "Department",
  position: "Position",
  grade: "Grade",
  location: "Location",
  salary: "Salary",
};

export function ScheduledEmploymentChanges({
  employeeId,
  refreshVersion,
}: {
  employeeId: string;
  refreshVersion: number;
}) {
  const currentUser = useCurrentUser();
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const actor = {
    actorId: currentUser.userId,
    actorEmail: currentUser.workspaceEmail,
    activeRole: currentUser.activeRole,
  };
  const query = useQuery({
    queryKey: [
      "scheduled-employment",
      employeeId,
      currentUser.userId,
      currentUser.activeRole,
      refreshVersion,
    ],
    queryFn: async () => {
      const { listScheduledEmploymentChangesFn } =
        await import("@/lib/server-functions/employee.server");
      return listScheduledEmploymentChangesFn({ data: { actor, employeeId } });
    },
    refetchInterval: 60_000,
  });
  const displayValue = (field: string, value: unknown): string => {
    if (value === null || value === "") return "None";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (field === "lineManagerId") {
      const employee = new EmployeeService()
        .getDirectoryEmployees(currentUser.getActorContext())
        .find((item) => item.id === value || item.databaseId === value);
      return employee?.legalName ?? "Selected supervisor";
    }
    if (field === "projectId" || field === "costCentreId") {
      const records = getApplicationDataServices().storage.readCollection<{
        id: string;
        databaseId?: string;
        name: string;
      }>(field === "projectId" ? "projects" : "costCentres");
      return (
        records.find((item) => item.id === value || item.databaseId === value)?.name ??
        "Selected record"
      );
    }
    if (value && typeof value === "object") {
      return Object.entries(value)
        .map(([key, entry]) => `${key.replace(/([A-Z])/g, " $1")}: ${String(entry)}`)
        .join(" · ");
    }
    return String(value);
  };
  const cancel = async () => {
    if (!cancelId) return;
    setSaving(true);
    try {
      const { cancelScheduledEmploymentChangeFn } =
        await import("@/lib/server-functions/employee.server");
      await cancelScheduledEmploymentChangeFn({ data: { actor, id: cancelId, reason } });
      setCancelId(null);
      await query.refetch();
      toast.success("Scheduled change cancelled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not cancel this change.");
    } finally {
      setSaving(false);
    }
  };
  if (query.isPending) return null;
  if (query.isError)
    return (
      <p role="alert">
        Scheduled changes could not be loaded.{" "}
        <Button variant="link" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </p>
    );
  if (!query.data.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Scheduled changes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.data.map((change) => (
          <div key={change.id} className="rounded-lg border p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                {change.effectiveDate} ·{" "}
                {change.status === "Pending" ? "Scheduled" : "Needs review"}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setCancelId(change.id);
                  setReason("");
                }}
              >
                Cancel change
              </Button>
            </div>
            <dl className="text-sm space-y-1">
              {Object.entries(change.changes).map(([field, value]) => (
                <div key={field} className="flex flex-wrap gap-2">
                  <dt className="text-muted-foreground">{labels[field] ?? field}:</dt>
                  <dd>{displayValue(field, value)}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sm text-muted-foreground">{change.reason}</p>
            {change.reviewNote && (
              <p className="text-sm" role="alert">
                {change.reviewNote}
              </p>
            )}
          </div>
        ))}
      </CardContent>
      <Dialog
        open={Boolean(cancelId)}
        onOpenChange={(open) => {
          if (!open && !saving) setCancelId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel scheduled change</DialogTitle>
          </DialogHeader>
          <Textarea
            aria-label="Cancellation reason"
            placeholder="Reason for cancellation"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <Button disabled={saving || reason.trim().length < 5} onClick={() => void cancel()}>
            {saving ? "Cancelling…" : "Confirm cancellation"}
          </Button>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
