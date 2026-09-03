import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, useMemo } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { Check, X, AlertTriangle, Info, Paperclip } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { LeaveService } from "@/lib/data/leave-service";
import { EmployeeService } from "@/lib/data/employee-service";
import type { LeaveRequest, LeavePolicy } from "@/lib/data/leave-types";
import { useCurrentUser, RequirePermission } from "@/lib/auth";

export const Route = createFileRoute("/staff/leave-approvals")({
  component: LeaveApprovalsRoute,
});

function LeaveApprovalsRoute() {
  return (
    <RequirePermission permission="leave:approve_direct_reports" resourceName="Leave Approvals">
      <LeaveApprovalsContent />
    </RequirePermission>
  );
}

function LeaveApprovalsContent() {
  const currentUser = useCurrentUser();
  const leaveService = useMemo(() => new LeaveService(), []);
  const empService = useMemo(() => new EmployeeService(), []);

  const canCompleteHrReview =
    currentUser.activeRole === "HR" || currentUser.activeRole === "Super Admin";
  // Assuming anyone can be a manager if they have direct reports.

  const policies = leaveService.getPolicies();

  const [managerQueue, setManagerQueue] = useState<LeaveRequest[]>([]);
  const [adminQueue, setAdminQueue] = useState<LeaveRequest[]>([]);

  const [rejectDialog, setRejectDialog] = useState<{ open: boolean; request: LeaveRequest | null }>(
    { open: false, request: null },
  );
  const [rejectReason, setRejectReason] = useState("");

  const loadData = useCallback(() => {
    if (currentUser.employeeId) {
      if (currentUser.activeRole === "Line Manager") {
        setManagerQueue(leaveService.getPendingRequestsForManager(currentUser.getActorContext()));
      } else {
        setManagerQueue([]);
      }
    }
    if (canCompleteHrReview) {
      setAdminQueue(leaveService.getPendingRequestsForHr(currentUser.getActorContext()));
    }
  }, [canCompleteHrReview, currentUser, leaveService]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleApprove = async (req: LeaveRequest) => {
    try {
      await leaveService.decideRequestAsync(
        req.id,
        "approve",
        undefined,
        currentUser.getActorContext(),
      );
      toast.success("Leave request approved.");
      loadData();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to approve request");
    }
  };

  const handleReject = async () => {
    if (!rejectDialog.request) return;
    try {
      await leaveService.decideRequestAsync(
        rejectDialog.request.id,
        "decline",
        rejectReason,
        currentUser.getActorContext(),
      );
      toast.success("Leave request declined.");
      setRejectDialog({ open: false, request: null });
      setRejectReason("");
      loadData();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to reject request");
    }
  };

  const openAttachment = async (requestId: string) => {
    try {
      const { blob } = await leaveService.getAttachmentBlob(
        requestId,
        currentUser.getActorContext(),
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open the attachment.");
    }
  };

  const renderQueue = (requests: LeaveRequest[], isFinal: boolean) => {
    if (requests.length === 0) {
      return (
        <div className="text-center py-12 text-muted-foreground border rounded-md bg-muted/10">
          <Check className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
          <p>No pending approvals in this queue.</p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {requests.map((req) => {
          const emp = empService.getById(req.employeeId, currentUser.getActorContext());
          const policy = policies.find((p) => p.id === req.policyId);
          const reviewStartDate = req.pendingAmendment?.proposedStartDate ?? req.startDate;
          const reviewEndDate = req.pendingAmendment?.proposedEndDate ?? req.endDate;
          const reviewDays = req.pendingAmendment?.proposedWorkingDays ?? req.workingDaysRequested;
          const overlaps = leaveService
            .getTeamOverlaps(
              emp?.department || "",
              reviewStartDate,
              reviewEndDate,
              currentUser.getActorContext(),
            )
            .filter((overlapReq) => overlapReq.id !== req.id); // exclude self

          return (
            <Card key={req.id}>
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-lg">{emp?.preferredName}</CardTitle>
                    <CardDescription>
                      {policy?.name} &bull; {reviewDays} working days
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                    {req.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div className="space-y-2">
                    <div className="grid grid-cols-[100px_1fr] gap-1">
                      <span className="text-muted-foreground">Dates:</span>
                      <span className="font-medium">
                        {new Date(reviewStartDate).toLocaleDateString()}
                        {reviewStartDate !== reviewEndDate
                          ? ` - ${new Date(reviewEndDate).toLocaleDateString()}`
                          : req.isHalfDay
                            ? " (Half Day)"
                            : ""}
                      </span>
                    </div>
                    {req.pendingAmendment && (
                      <div className="grid grid-cols-[100px_1fr] gap-1">
                        <span className="text-muted-foreground">Current leave:</span>
                        <span>
                          {req.startDate} to {req.endDate} ({req.workingDaysRequested} days)
                        </span>
                      </div>
                    )}
                    <div className="grid grid-cols-[100px_1fr] gap-1">
                      <span className="text-muted-foreground">
                        {req.pendingAmendment ? "Change reason:" : "Reason:"}
                      </span>
                      <span>{req.pendingAmendment?.reason ?? req.reason}</span>
                    </div>
                    {req.handoverContactId && (
                      <div className="grid grid-cols-[100px_1fr] gap-1">
                        <span className="text-muted-foreground">Handover:</span>
                        <span>
                          {
                            empService.getById(req.handoverContactId, currentUser.getActorContext())
                              ?.preferredName
                          }
                        </span>
                      </div>
                    )}
                    {req.attachmentFileId && (
                      <div className="grid grid-cols-[100px_1fr] items-center gap-1">
                        <span className="text-muted-foreground">Evidence:</span>
                        <Button
                          variant="link"
                          className="h-auto justify-start p-0"
                          onClick={() => openAttachment(req.id)}
                        >
                          <Paperclip className="mr-1.5 h-3.5 w-3.5" /> View attachment
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    {overlaps.length > 0 && (
                      <div className="bg-amber-50 border border-amber-200 text-amber-800 p-2 rounded-md text-xs flex gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <div>
                          <strong>Team Overlap Warning:</strong>
                          <ul className="list-disc pl-4 mt-1">
                            {overlaps.map((o) => (
                              <li key={o.id}>
                                {
                                  empService.getById(o.employeeId, currentUser.getActorContext())
                                    ?.preferredName
                                }{" "}
                                (Off: {o.startDate} to {o.endDate})
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}

                    {isFinal &&
                      req.status !== "Pending Line Manager" &&
                      req.status !== "Amendment Pending Line Manager" && (
                        <div className="bg-blue-50 border border-blue-200 text-blue-800 p-2 rounded-md text-xs flex gap-2">
                          <Info className="h-4 w-4 shrink-0" />
                          <div>
                            <strong>Final approval:</strong>{" "}
                            {req.status === "Cancellation Pending"
                              ? `Approval will return ${req.workingDaysRequested} days to the employee's available balance.`
                              : req.pendingAmendment
                                ? `Approval will replace the current dates with ${reviewStartDate} to ${reviewEndDate} and adjust the balance by ${reviewDays - req.workingDaysRequested} day(s).`
                                : `Approval will deduct ${req.workingDaysRequested} days from the employee's ${policy?.name} balance.`}
                          </div>
                        </div>
                      )}
                    <div className="flex gap-2 justify-end pt-2">
                      <Button
                        variant="outline"
                        className="text-destructive border-destructive/30 hover:bg-destructive hover:text-white"
                        onClick={() => setRejectDialog({ open: true, request: req })}
                      >
                        <X className="mr-2 h-4 w-4" /> Reject
                      </Button>
                      <Button
                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={() => handleApprove(req)}
                      >
                        <Check className="mr-2 h-4 w-4" /> Approve
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6 max-w-[1000px] mx-auto pb-10">
      <PageHeader
        title="Leave Approvals"
        description="Review and process pending time-off requests."
      />

      <Tabs
        defaultValue={managerQueue.length > 0 || !canCompleteHrReview ? "manager" : "admin"}
        className="w-full"
      >
        <TabsList className="mb-4">
          <TabsTrigger value="manager" className="flex gap-2">
            My Team
            {managerQueue.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {managerQueue.length}
              </Badge>
            )}
          </TabsTrigger>
          {canCompleteHrReview && (
            <TabsTrigger value="admin" className="flex gap-2">
              HR Confirmation
              {adminQueue.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {adminQueue.length}
                </Badge>
              )}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="manager">{renderQueue(managerQueue, false)}</TabsContent>

        {canCompleteHrReview && (
          <TabsContent value="admin">{renderQueue(adminQueue, true)}</TabsContent>
        )}
      </Tabs>

      <Dialog
        open={rejectDialog.open}
        onOpenChange={(open) => !open && setRejectDialog({ open: false, request: null })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Leave Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>
                Rejection Reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Explain why this request is being declined..."
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRejectDialog({ open: false, request: null })}
            >
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
    </div>
  );
}
