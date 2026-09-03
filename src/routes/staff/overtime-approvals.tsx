import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { OvertimeService } from "@/lib/data/overtime-service";
import { EmployeeService } from "@/lib/data/employee-service";
import { useCurrentUser, RequireAnyPermission } from "@/lib/auth";
import { AlertTriangle, CheckCircle, Paperclip, Plus, XCircle } from "lucide-react";
import type { OvertimeClaim } from "@/lib/data/overtime-types";
import { OvertimeOnBehalfDialog } from "@/components/overtime/overtime-on-behalf-dialog";

export const Route = createFileRoute("/staff/overtime-approvals")({
  component: OvertimeApprovalsRoute,
});

function OvertimeApprovalsRoute() {
  return (
    <RequireAnyPermission
      permissions={["overtime:approve_direct_reports", "overtime:admin_all"]}
      resourceName="Team Overtime Approvals"
    >
      <OvertimeApprovalsContent />
    </RequireAnyPermission>
  );
}

function OvertimeApprovalsContent() {
  const currentUser = useCurrentUser();
  const otService = useMemo(() => new OvertimeService(), []);
  const empService = useMemo(() => new EmployeeService(), []);
  const actorContext = currentUser.getActorContext();
  const canVerify = currentUser.can("overtime:admin_all");

  const [claims, setClaims] = useState<OvertimeClaim[]>(() =>
    otService.getClaimsForDirectReports(actorContext),
  );
  const allEmployees = empService.getEmployees(actorContext);

  const refresh = () => setClaims(otService.getClaimsForDirectReports(actorContext));

  const [rejectReason, setRejectReason] = useState("");
  const [selectedClaim, setSelectedClaim] = useState<OvertimeClaim | null>(null);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);

  const [hrNotes, setHrNotes] = useState("");
  const [hrSelectedClaim, setHrSelectedClaim] = useState<OvertimeClaim | null>(null);
  const [hrActionType, setHrActionType] = useState<"approve" | "reject">("approve");
  const [recordOpen, setRecordOpen] = useState(false);

  if (!currentUser.employeeId) {
    return <div>Employee profile required.</div>;
  }

  const myDirectReports = allEmployees
    .filter((e) => e.lineManagerId === currentUser.employeeId)
    .map((e) => e.id);
  const pendingManager = claims.filter(
    (c) => c.status === "Pending Manager" && myDirectReports.includes(c.employeeId),
  );
  const pendingHr = claims.filter((c) => c.status === "Pending HR");
  const recordableEmployees = allEmployees.filter((employee) =>
    canVerify
      ? !["Inactive", "Archived"].includes(employee.status)
      : myDirectReports.includes(employee.id),
  );

  const viewEvidence = async (claimId: string) => {
    try {
      const { blob } = await otService.getEvidenceBlob(claimId, actorContext);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to open evidence");
    }
  };

  const handleApprove = async (id: string) => {
    try {
      await otService.decideClaimAsync(id, "approve", undefined, actorContext);
      refresh();
      toast.success("Overtime claim approved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to approve claim");
    }
  };

  const handleOpenReject = (claim: OvertimeClaim) => {
    setSelectedClaim(claim);
    setRejectReason("");
    setRejectDialogOpen(true);
  };

  const handleReject = async () => {
    if (!selectedClaim) return;
    try {
      await otService.decideClaimAsync(selectedClaim.id, "reject", rejectReason, actorContext);
      refresh();
      setRejectDialogOpen(false);
      setSelectedClaim(null);
      toast.success("Claim rejected.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reject claim");
    }
  };

  const handleOpenHrAction = (claim: OvertimeClaim, type: "approve" | "reject") => {
    setHrSelectedClaim(claim);
    setHrActionType(type);
    setHrNotes("");
  };

  const handleHrFinalise = async () => {
    if (!hrSelectedClaim) return;
    try {
      await otService.decideClaimAsync(
        hrSelectedClaim.id,
        hrActionType === "approve" ? "approve" : "reject",
        hrNotes,
        actorContext,
      );
      refresh();
      setHrSelectedClaim(null);
      toast.success(`Overtime ${hrActionType === "approve" ? "verified" : "rejected"}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to finalise verification");
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-[1200px] mx-auto pb-10">
      <PageHeader
        title="Team Overtime Approvals"
        description="Review overtime requests from your direct reports, and complete HR verification where required."
        actions={
          <Button onClick={() => setRecordOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Record for Employee
          </Button>
        }
      />

      <Tabs defaultValue="manager">
        <TabsList>
          <TabsTrigger value="manager">My Team ({pendingManager.length})</TabsTrigger>
          {canVerify && <TabsTrigger value="hr">HR Verification ({pendingHr.length})</TabsTrigger>}
        </TabsList>

        <TabsContent value="manager">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Hours</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Discrepancies</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingManager.map((c) => {
                    const emp = allEmployees.find((e) => e.id === c.employeeId);
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{emp?.preferredName}</TableCell>
                        <TableCell>{c.date}</TableCell>
                        <TableCell className="font-medium text-emerald-600">{c.hours}h</TableCell>
                        <TableCell className="max-w-[300px] truncate text-sm" title={c.reason}>
                          {c.reason}
                        </TableCell>
                        <TableCell>
                          {c.crossCheckWarnings && c.crossCheckWarnings.length > 0 ? (
                            <div className="flex flex-col gap-1">
                              {c.crossCheckWarnings.map((w: string, i: number) => (
                                <div
                                  key={i}
                                  className="flex items-start text-xs text-amber-600 bg-amber-50 p-1 rounded"
                                >
                                  <AlertTriangle className="w-3 h-3 mr-1 mt-0.5 flex-shrink-0" />
                                  <span>{w}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-emerald-600 border-emerald-200"
                            >
                              Verified Match
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {c.evidenceFileId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void viewEvidence(c.id)}
                            >
                              <Paperclip className="w-4 h-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenReject(c)}
                            className="text-destructive"
                          >
                            <XCircle className="w-4 h-4 mr-1" /> Reject
                          </Button>
                          <Button size="sm" onClick={() => handleApprove(c.id)}>
                            <CheckCircle className="w-4 h-4 mr-1" /> Approve
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {pendingManager.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        No pending requests for your team.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {canVerify && (
          <TabsContent value="hr">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Hours</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Discrepancies</TableHead>
                      <TableHead className="text-right">HR Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingHr.map((c) => {
                      const emp = allEmployees.find((e) => e.id === c.employeeId);
                      return (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium">{emp?.preferredName}</TableCell>
                          <TableCell>{c.date}</TableCell>
                          <TableCell className="font-medium text-emerald-600">{c.hours}h</TableCell>
                          <TableCell className="max-w-[300px] truncate text-sm" title={c.reason}>
                            {c.reason}
                          </TableCell>
                          <TableCell>
                            {c.crossCheckWarnings && c.crossCheckWarnings.length > 0 ? (
                              <div className="flex flex-col gap-1">
                                {c.crossCheckWarnings.map((w: string, i: number) => (
                                  <div
                                    key={i}
                                    className="flex items-start text-xs text-amber-600 bg-amber-50 p-1 rounded"
                                  >
                                    <AlertTriangle className="w-3 h-3 mr-1 mt-0.5 flex-shrink-0" />
                                    <span>{w}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <Badge
                                variant="outline"
                                className="text-emerald-600 border-emerald-200"
                              >
                                Verified Match
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            {c.evidenceFileId && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void viewEvidence(c.id)}
                              >
                                <Paperclip className="w-4 h-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenHrAction(c, "reject")}
                              className="text-destructive"
                            >
                              <XCircle className="w-4 h-4 mr-1" /> Reject
                            </Button>
                            <Button size="sm" onClick={() => handleOpenHrAction(c, "approve")}>
                              <CheckCircle className="w-4 h-4 mr-1" /> Verify
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {pendingHr.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          No pending verifications.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Overtime</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting this claim. This will be visible to the
              employee.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection..."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={rejectReason.trim().length < 3}
            >
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!hrSelectedClaim} onOpenChange={(o) => !o && setHrSelectedClaim(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {hrActionType === "approve" ? "Verify Overtime" : "Reject Overtime"}
            </DialogTitle>
            <DialogDescription>
              {hrActionType === "approve"
                ? "Verifying this claim marks it as Approved and clears it for payroll processing."
                : "Rejecting this claim blocks it from payroll. Please provide a reason."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-2 bg-muted/30 p-3 rounded-md">
              <div>
                <span className="text-muted-foreground">Date:</span> {hrSelectedClaim?.date}
              </div>
              <div>
                <span className="text-muted-foreground">Hours:</span> {hrSelectedClaim?.hours}h
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">Employee Explanation:</span>{" "}
                {hrSelectedClaim?.reason}
              </div>
              {hrSelectedClaim?.crossCheckWarnings &&
                hrSelectedClaim.crossCheckWarnings.length > 0 && (
                  <div className="col-span-2 flex flex-col gap-1">
                    {hrSelectedClaim.crossCheckWarnings.map((w, i) => (
                      <div
                        key={i}
                        className="flex items-start text-xs text-amber-600 bg-amber-50 p-1 rounded"
                      >
                        <AlertTriangle className="w-3 h-3 mr-1 mt-0.5 flex-shrink-0" />
                        <span>{w}</span>
                      </div>
                    ))}
                  </div>
                )}
              {hrSelectedClaim?.evidenceFileId && (
                <div className="col-span-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void viewEvidence(hrSelectedClaim.id)}
                  >
                    <Paperclip className="w-4 h-4 mr-1" /> View evidence
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <label className="font-medium">HR Verification Notes</label>
              <Textarea
                value={hrNotes}
                onChange={(e) => setHrNotes(e.target.value)}
                placeholder="Optional notes regarding decision..."
              />
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setHrSelectedClaim(null)}>
              Cancel
            </Button>
            <Button
              variant={hrActionType === "approve" ? "default" : "destructive"}
              onClick={handleHrFinalise}
            >
              {hrActionType === "approve" ? "Confirm Verification" : "Confirm Rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <OvertimeOnBehalfDialog
        open={recordOpen}
        onOpenChange={setRecordOpen}
        employees={recordableEmployees}
        onSuccess={refresh}
      />
    </div>
  );
}
