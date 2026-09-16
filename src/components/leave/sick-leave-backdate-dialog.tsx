import { useState } from "react";
import { useCurrentUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { grantSickLeaveBackdatePermissionFn } from "@/lib/server-functions/leave.server";
import { toast } from "sonner";

export function SickLeaveBackdateDialog({
  employees,
}: {
  employees: { id: string; legalName: string; databaseId?: string }[];
}) {
  const user = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  if (!["HR", "Super Admin"].includes(user.activeRole)) return null;
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await grantSickLeaveBackdatePermissionFn({
        data: {
          actor: {
            actorId: user.id,
            ...(user.workspaceEmail ? { actorEmail: user.workspaceEmail } : {}),
            activeRole: user.activeRole,
          },
          employeeId:
            employees.find((employee) => employee.id === employeeId)?.databaseId ?? employeeId,
          startDate,
          endDate,
          reason,
        },
      });
      toast.success(
        "Permission granted. The employee has 14 days to submit these exact sick-leave dates and has been notified.",
      );
      setOpen(false);
      setEmployeeId("");
      setStartDate("");
      setEndDate("");
      setReason("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Permission could not be saved.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Permit backdated sick leave
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!saving) setOpen(value);
        }}
      >
        <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg">
          <DialogHeader>
            <DialogTitle>Permit backdated sick leave</DialogTitle>
            <DialogDescription>
              For someone who was too unwell to apply. One submission for these exact dates, valid
              for 14 days. Medical evidence and normal approvals still apply. Another HR colleague
              must authorise your own case.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="backdate-employee">Employee</Label>
            <select
              id="backdate-employee"
              className="h-10 w-full rounded-md border bg-background px-3"
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
            >
              <option value="">Select employee</option>
              {employees
                .filter((employee) => employee.id !== user.employeeId)
                .map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.legalName}
                  </option>
                ))}
            </select>
            <Label htmlFor="backdate-start">First sick day</Label>
            <Input
              id="backdate-start"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
            <Label htmlFor="backdate-end">Last sick day</Label>
            <Input
              id="backdate-end"
              type="date"
              min={startDate}
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
            <Label htmlFor="backdate-reason">Reason for allowing late submission</Label>
            <Textarea
              id="backdate-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Employee was too unwell to submit at the time"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={saving || !employeeId || !startDate || !endDate || reason.trim().length < 5}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Grant permission"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
