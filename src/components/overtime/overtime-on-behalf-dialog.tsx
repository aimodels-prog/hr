import { useState } from "react";
import { toast } from "sonner";

import { useCurrentUser } from "@/lib/auth";
import { getApplicationDataServices } from "@/lib/data/application-data";
import { getMasterDataRepository, getProjectRepository } from "@/lib/data/master-data";
import { OvertimeService } from "@/lib/data/overtime-service";
import type { OvertimeCompensationType } from "@/lib/data/overtime-types";
import type { Employee } from "@/lib/data/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function OvertimeOnBehalfDialog({
  open,
  onOpenChange,
  employees,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: Employee[];
  onSuccess: () => void;
}) {
  const currentUser = useCurrentUser();
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState("");
  const [hours, setHours] = useState("");
  const [projectId, setProjectId] = useState("");
  const [costCentreId, setCostCentreId] = useState("");
  const [activityCodeId, setActivityCodeId] = useState("");
  const [locationCodeId, setLocationCodeId] = useState("");
  const [reason, setReason] = useState("");
  const [compensationType, setCompensationType] = useState<OvertimeCompensationType>("Payment");
  const [evidence, setEvidence] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const projects = getProjectRepository()
    .list()
    .filter((item) => item.isActive);
  const costCentres = getMasterDataRepository("costCentres")
    .list()
    .filter((item) => item.isActive);
  const activities = getMasterDataRepository("activityCodes")
    .list()
    .filter((item) => item.isActive);
  const locations = getMasterDataRepository("locations")
    .list()
    .filter((item) => item.isActive);

  const submit = async () => {
    const context = currentUser.getActorContext();
    let uploadedFileId: string | undefined;
    setSaving(true);
    try {
      if (evidence) {
        const saved = await getApplicationDataServices().files.save(
          {
            blob: evidence,
            name: evidence.name,
            mimeType: evidence.type,
            owner: { entityType: "overtime-claim", entityId: employeeId },
          },
          context,
        );
        uploadedFileId = saved.id;
      }
      await new OvertimeService().submitClaim(
        {
          employeeId,
          date,
          hours: Number(hours),
          ...(projectId && projectId !== "none" ? { projectId } : {}),
          costCentreId,
          activityCodeId,
          locationCodeId,
          reason,
          compensationType,
          ...(uploadedFileId ? { evidenceFileId: uploadedFileId } : {}),
        },
        context,
      );
      uploadedFileId = undefined;
      onSuccess();
      onOpenChange(false);
      toast.success("Overtime claim recorded and sent for approval.");
    } catch (error) {
      if (uploadedFileId) {
        await getApplicationDataServices().files.delete(uploadedFileId, {
          ...context,
          reason: "On-behalf overtime submission failed",
        });
      }
      toast.error(error instanceof Error ? error.message : "The claim could not be recorded.");
    } finally {
      setSaving(false);
    }
  };

  const valid =
    employeeId &&
    date &&
    Number(hours) > 0 &&
    costCentreId &&
    activityCodeId &&
    locationCodeId &&
    reason.trim().length >= 5;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Record overtime for an employee</DialogTitle>
          <DialogDescription>
            The employee owns the claim and its evidence. Normal supervisor and HR review still
            applies, and nobody can approve their own claim.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>Employee</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger>
                <SelectValue placeholder="Select employee" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.preferredName} · {item.employeeNumber}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Hours</Label>
            <Input
              type="number"
              min="0.25"
              max="12"
              step="0.25"
              value={hours}
              onChange={(event) => setHours(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Optional" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Administrative</SelectItem>
                {projects.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Cost Centre</Label>
            <Select value={costCentreId} onValueChange={setCostCentreId}>
              <SelectTrigger>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {costCentres.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Activity</Label>
            <Select value={activityCodeId} onValueChange={setActivityCodeId}>
              <SelectTrigger>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {activities.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Work Location</Label>
            <Select value={locationCodeId} onValueChange={setLocationCodeId}>
              <SelectTrigger>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Compensation</Label>
            <Select
              value={compensationType}
              onValueChange={(value) => setCompensationType(value as OvertimeCompensationType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Payment">Paid overtime</SelectItem>
                <SelectItem value="TOIL">Time off in lieu</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Evidence</Label>
            <Input type="file" onChange={(event) => setEvidence(event.target.files?.[0] ?? null)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Reason</Label>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why the overtime was required"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!valid || saving} onClick={() => void submit()}>
            {saving ? "Saving…" : "Record Claim"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
