import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { PageHeader } from "@/components/ui/page-header";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { OvertimeService } from "@/lib/data/overtime-service";
import { getMasterDataRepository, getProjectRepository } from "@/lib/data/master-data";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { AlertTriangle, Clock, FileEdit, Paperclip } from "lucide-react";
import type { OvertimeClaim, OvertimeCompensationType } from "@/lib/data/overtime-types";

export const Route = createFileRoute("/staff/me/overtime")({
  component: MyOvertimeRoute,
});

function MyOvertimeRoute() {
  const currentUser = useCurrentUser();
  const otService = useMemo(() => new OvertimeService(), []);

  const [claims, setClaims] = useState(
    otService.getClaimsForEmployee(currentUser?.employeeId || "", currentUser.getActorContext()),
  );
  const activeProjects = getProjectRepository()
    .list()
    .filter((p) => p.isActive);
  const costCentres = getMasterDataRepository("costCentres")
    .list()
    .filter((item) => item.isActive);
  const activities = getMasterDataRepository("activityCodes")
    .list()
    .filter((item) => item.isActive);
  const workLocations = getMasterDataRepository("locations")
    .list()
    .filter((item) => item.isActive);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dateStr, setDateStr] = useState("");
  const [hoursStr, setHoursStr] = useState("");
  const [projectId, setProjectId] = useState("");
  const [costCentreId, setCostCentreId] = useState("");
  const [activityCodeId, setActivityCodeId] = useState("");
  const [locationCodeId, setLocationCodeId] = useState("");
  const [reason, setReason] = useState("");
  const [originalClaimId, setOriginalClaimId] = useState("");
  const [compensationType, setCompensationType] = useState<OvertimeCompensationType>("Payment");
  const [requestKind, setRequestKind] = useState<"Planned" | "Emergency Retrospective">("Planned");
  const [emergencyReason, setEmergencyReason] = useState("");
  const [actualClaim, setActualClaim] = useState<OvertimeClaim | null>(null);
  const [actualHours, setActualHours] = useState("");
  const [actualNote, setActualNote] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleOpenNew = () => {
    setDateStr("");
    setHoursStr("");
    setProjectId("");
    setCostCentreId("");
    setActivityCodeId("");
    setLocationCodeId("");
    setReason("");
    setEmergencyReason("");
    setOriginalClaimId("");
    setCompensationType("Payment");
    setRequestKind("Planned");
    setEvidenceFile(null);
    setDialogOpen(true);
  };

  const handleOpenCorrection = (claim: OvertimeClaim) => {
    setDateStr(claim.date);
    setHoursStr(claim.hours.toString());
    setProjectId(claim.projectId || "");
    setCostCentreId(claim.costCentreId);
    setActivityCodeId(claim.activityCodeId);
    setLocationCodeId(claim.locationCodeId);
    setReason(`Correction of original claim: ${claim.reason}`);
    setOriginalClaimId(claim.id);
    setCompensationType(claim.compensationType || "Payment");
    setEvidenceFile(null);
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    setIsUploading(true);
    const actorContext = currentUser.getActorContext();
    try {
      if (originalClaimId) {
        await otService.createCorrection(
          originalClaimId,
          parseFloat(hoursStr),
          reason,
          actorContext,
          undefined,
          evidenceFile ?? undefined,
        );
        toast.success("Correction request sent. The original record was kept.");
      } else {
        await otService.submitClaim(
          {
            employeeId: currentUser!.employeeId!,
            date: dateStr,
            hours: parseFloat(hoursStr),
            ...(projectId && projectId !== "none" ? { projectId } : {}),
            costCentreId,
            activityCodeId,
            locationCodeId,
            reason,
            requestKind,
            ...(requestKind === "Emergency Retrospective" ? { emergencyReason } : {}),
            compensationType,
          },
          actorContext,
          evidenceFile ?? undefined,
        );
        toast.success(
          requestKind === "Planned"
            ? "Planned overtime sent for pre-authorisation."
            : "Emergency overtime claim sent to your manager.",
        );
      }
      setClaims(otService.getClaimsForEmployee(currentUser.employeeId!, actorContext));
      setDialogOpen(false);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Overtime claim could not be sent.");
    } finally {
      setIsUploading(false);
    }
  };

  if (!currentUser?.employeeId) return <div>Employee profile required.</div>;

  return (
    <RequirePermission permission="timesheet:view_self" resourceName="My Overtime">
      <div className="flex flex-col gap-6 max-w-[1200px] mx-auto pb-10">
        <PageHeader
          title="My Overtime Claims"
          description="Request and track overtime compensation or TOIL."
          actions={
            <Button onClick={handleOpenNew}>
              <Clock className="w-4 h-4 mr-2" />
              New Claim
            </Button>
          }
        />

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">Claim History</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Warnings</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {claims.map((claim) => (
                  <TableRow
                    key={claim.id}
                    className={claim.status === "Corrected" ? "opacity-50" : ""}
                  >
                    <TableCell className="font-medium">{claim.date}</TableCell>
                    <TableCell>{claim.hours}h</TableCell>
                    <TableCell className="text-muted-foreground">
                      {claim.projectId || "-"}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm" title={claim.reason}>
                      {claim.reason}
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        {claim.compensationType === "TOIL" ? "TOIL" : "Paid"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          claim.status === "Approved"
                            ? "default"
                            : claim.status === "Corrected"
                              ? "outline"
                              : claim.status === "Rejected"
                                ? "destructive"
                                : "secondary"
                        }
                      >
                        {claim.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {claim.crossCheckWarnings && claim.crossCheckWarnings.length > 0 ? (
                        <span title={`${claim.crossCheckWarnings.length} Discrepancies found`}>
                          <AlertTriangle className="w-4 h-4 text-amber-500" />
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Clear</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {claim.status === "Pre-authorised" &&
                        claim.date <= new Date().toISOString().slice(0, 10) && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setActualClaim(claim);
                              setActualHours(String(claim.authorisedHours ?? claim.hours));
                              setActualNote("");
                            }}
                          >
                            Confirm actual hours
                          </Button>
                        )}
                      {claim.status === "Approved" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenCorrection(claim)}
                        >
                          <FileEdit className="w-4 h-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {claims.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No overtime claims found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {originalClaimId ? "Correct Approved Claim" : "New Overtime Claim"}
              </DialogTitle>
              <DialogDescription>
                {originalClaimId
                  ? "Adjusting this claim will archive the original record and send this new request through the approval flow."
                  : "Overtime is mathematically cross-checked against your daily timesheet and physical attendance punches."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {!originalClaimId && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Request type</label>
                  <Select
                    value={requestKind}
                    onValueChange={(value) =>
                      setRequestKind(value as "Planned" | "Emergency Retrospective")
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Planned">
                        Planned overtime - request before working
                      </SelectItem>
                      <SelectItem value="Emergency Retrospective">
                        Emergency overtime already worked
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Planned overtime must be approved by your supervisor before the extra work.
                    Emergency retrospective claims require a clear explanation.
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Date</label>
                  <Input
                    type="date"
                    value={dateStr}
                    onChange={(e) => setDateStr(e.target.value)}
                    disabled={!!originalClaimId}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Hours</label>
                  <Input
                    type="number"
                    step="0.25"
                    min="0.25"
                    max="24"
                    value={hoursStr}
                    onChange={(e) => setHoursStr(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Project Allocation (Optional)</label>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select Project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None / Administrative</SelectItem>
                    {activeProjects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Cost Centre</label>
                  <Select
                    value={costCentreId}
                    onValueChange={setCostCentreId}
                    disabled={!!originalClaimId}
                  >
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
                  <label className="text-sm font-medium">Activity</label>
                  <Select
                    value={activityCodeId}
                    onValueChange={setActivityCodeId}
                    disabled={!!originalClaimId}
                  >
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
                  <label className="text-sm font-medium">Work Location</label>
                  <Select
                    value={locationCodeId}
                    onValueChange={setLocationCodeId}
                    disabled={!!originalClaimId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {workLocations.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {!originalClaimId && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Compensation</label>
                  <Select
                    value={compensationType}
                    onValueChange={(v) => setCompensationType(v as OvertimeCompensationType)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Payment">Paid overtime</SelectItem>
                      <SelectItem value="TOIL">
                        Time off in lieu (credited to Compensation Leave)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium">Reason / Justification</label>
                <Textarea
                  placeholder="Required explanation for the extra hours..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              {!originalClaimId && requestKind === "Emergency Retrospective" && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Why approval was not requested first
                  </label>
                  <Textarea
                    placeholder="Explain the unexpected event that made prior approval impossible."
                    value={emergencyReason}
                    onChange={(event) => setEmergencyReason(event.target.value)}
                  />
                </div>
              )}
              {!originalClaimId && (
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-1">
                    <Paperclip className="w-3.5 h-3.5" /> Supporting evidence (optional)
                  </label>
                  <Input
                    type="file"
                    onChange={(e) => setEvidenceFile(e.target.files?.[0] ?? null)}
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => void handleSubmit()}
                disabled={
                  !dateStr ||
                  !hoursStr ||
                  !costCentreId ||
                  !activityCodeId ||
                  !locationCodeId ||
                  reason.trim().length < 5 ||
                  (requestKind === "Emergency Retrospective" &&
                    emergencyReason.trim().length < 5) ||
                  isUploading
                }
              >
                {isUploading
                  ? "Submitting..."
                  : originalClaimId
                    ? "Send correction"
                    : requestKind === "Planned"
                      ? "Request approval"
                      : "Submit emergency claim"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={Boolean(actualClaim)} onOpenChange={(open) => !open && setActualClaim(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm actual overtime</DialogTitle>
              <DialogDescription>
                Record the hours actually worked. If they exceed the authorised amount, your
                supervisor must review the difference again.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">Actual hours worked</label>
                <Input
                  type="number"
                  min="0.25"
                  max="24"
                  step="0.25"
                  value={actualHours}
                  onChange={(event) => setActualHours(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Note</label>
                <Textarea
                  value={actualNote}
                  onChange={(event) => setActualNote(event.target.value)}
                  placeholder="Required when actual hours exceed the authorised hours"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setActualClaim(null)}>
                Cancel
              </Button>
              <Button
                disabled={isUploading || !actualHours}
                onClick={() => {
                  if (!actualClaim) return;
                  setIsUploading(true);
                  void otService
                    .confirmPlannedHours(
                      actualClaim.id,
                      Number(actualHours),
                      actualNote,
                      currentUser.getActorContext(),
                    )
                    .then(() => {
                      setClaims(
                        otService.getClaimsForEmployee(
                          currentUser.employeeId!,
                          currentUser.getActorContext(),
                        ),
                      );
                      setActualClaim(null);
                      toast.success("Actual overtime hours submitted");
                    })
                    .catch((error) =>
                      toast.error(
                        error instanceof Error ? error.message : "Actual hours could not be saved.",
                      ),
                    )
                    .finally(() => setIsUploading(false));
                }}
              >
                Submit actual hours
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </RequirePermission>
  );
}
