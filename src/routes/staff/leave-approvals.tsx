import { createFileRoute, useLocation } from "@tanstack/react-router";
import { useCallback, useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  PageSections as Tabs,
  SectionPanel as TabsContent,
  SectionNavigation as TabsList,
  SectionLink as TabsTrigger,
} from "@/components/ui/page-sections";
import { Check, X, AlertTriangle, Info, Paperclip, Search, CalendarDays } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { LeaveService } from "@/lib/data/leave-service";
import { EmployeeService } from "@/lib/data/employee-service";
import type { LeaveRequest } from "@/lib/data/leave-types";
import { useCurrentUser, RequirePermission } from "@/lib/auth";
import { focusedApprovalId } from "@/lib/data/approval-links";

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
  const location = useLocation();
  const focusedRequestId = focusedApprovalId(location.hash);
  const leaveService = useMemo(() => new LeaveService(), []);
  const empService = useMemo(() => new EmployeeService(), []);
  const directoryEmployees = empService.getDirectoryEmployees(currentUser.getActorContext());

  const canCompleteHrReview =
    currentUser.activeRole === "HR" || currentUser.activeRole === "Super Admin";
  // Assuming anyone can be a manager if they have direct reports.

  const policies = leaveService.getPolicies();

  const [managerQueue, setManagerQueue] = useState<LeaveRequest[]>([]);
  const [adminQueue, setAdminQueue] = useState<LeaveRequest[]>([]);
  const [specialQueue, setSpecialQueue] = useState<LeaveRequest[]>([]);
  const [selectedSection, setSelectedSection] = useState(canCompleteHrReview ? "admin" : "manager");
  const [searchQuery, setSearchQuery] = useState("");
  const [decidingRequestId, setDecidingRequestId] = useState<string | null>(null);

  const [rejectDialog, setRejectDialog] = useState<{ open: boolean; request: LeaveRequest | null }>(
    { open: false, request: null },
  );
  const [rejectReason, setRejectReason] = useState("");
  const [allocationRequest, setAllocationRequest] = useState<LeaveRequest | null>(null);
  const [allocations, setAllocations] = useState<
    Array<{ policyId: string; leaveYear: number; days: number }>
  >([]);
  const [remainingPay, setRemainingPay] = useState<"Paid" | "Unpaid" | "">("");

  const loadData = useCallback(() => {
    setSpecialQueue(
      leaveService.getRequests(currentUser.getActorContext()).filter((request) => {
        if (
          request.status !== "Pending HR" ||
          (!request.policySnapshot.noticeException && !request.policySnapshot.specialRequest)
        )
          return false;
        const countryManagerPending = request.chainApprovals.some(
          (step) => step.role === "Country Manager" && step.status === "Pending",
        );
        const hrPending = request.chainApprovals.some(
          (step) => step.role === "HR" && step.status === "Pending",
        );
        if (request.policySnapshot.specialRequest)
          return (
            countryManagerPending &&
            currentUser.employeeId ===
              request.policySnapshot.specialRequest.countryManagerEmployeeId
          );
        return (
          (countryManagerPending &&
            currentUser.employeeId ===
              request.policySnapshot.noticeException?.countryManagerEmployeeId) ||
          (hrPending && currentUser.activeRole === "HR")
        );
      }),
    );
    if (currentUser.employeeId) {
      if (
        currentUser.roles.includes("Line Manager") ||
        ["Line Manager", "HR", "Super Admin"].includes(currentUser.activeRole)
      ) {
        setManagerQueue(leaveService.getPendingRequestsForManager(currentUser.getActorContext()));
      } else {
        setManagerQueue([]);
      }
    }
    if (canCompleteHrReview) {
      setAdminQueue(
        leaveService
          .getPendingRequestsForHr(currentUser.getActorContext())
          .filter(
            (request) =>
              ["Pending HR", "Amendment Pending HR", "Cancellation Pending"].includes(
                request.status,
              ) &&
              !(request.status === "Pending HR" && request.policySnapshot.noticeException) &&
              !(
                request.status === "Pending HR" &&
                request.policySnapshot.specialRequest &&
                (currentUser.activeRole !== "HR" ||
                  request.chainApprovals.some(
                    (step) => step.role === "Country Manager" && step.status === "Pending",
                  ))
              ),
          ),
      );
    }
  }, [canCompleteHrReview, currentUser, leaveService]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    setSelectedSection((current) =>
      specialQueue.length > 0
        ? "special"
        : current === "special"
          ? canCompleteHrReview
            ? "admin"
            : "manager"
          : current,
    );
  }, [specialQueue.length, canCompleteHrReview]);

  useEffect(() => {
    if (!focusedRequestId) return;
    if (specialQueue.some((request) => request.id === focusedRequestId))
      setSelectedSection("special");
    else if (adminQueue.some((request) => request.id === focusedRequestId))
      setSelectedSection("admin");
    else if (managerQueue.some((request) => request.id === focusedRequestId))
      setSelectedSection("manager");
  }, [adminQueue, focusedRequestId, managerQueue, specialQueue]);

  useEffect(() => {
    if (!focusedRequestId) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`approval-${focusedRequestId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedRequestId, selectedSection, adminQueue, managerQueue, specialQueue]);

  const handleApprove = async (req: LeaveRequest) => {
    if (decidingRequestId) return;
    if (
      req.policySnapshot.specialRequest &&
      req.status === "Pending HR" &&
      req.chainApprovals.some((step) => step.role === "HR" && step.status === "Pending") &&
      !req.chainApprovals.some(
        (step) => step.role === "Country Manager" && step.status === "Pending",
      )
    ) {
      setAllocationRequest(req);
      setAllocations([]);
      setRemainingPay("");
      return;
    }
    setDecidingRequestId(req.id);
    try {
      await leaveService.decideRequestAsync(
        req.id,
        "approve",
        undefined,
        currentUser.getActorContext(),
      );
      toast.success(
        req.policySnapshot.noticeException && req.status === "Pending HR"
          ? "Your special review was recorded. The request will reach the line manager after both special reviewers approve."
          : "Leave request approved.",
      );
      loadData();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to approve request");
    } finally {
      setDecidingRequestId(null);
    }
  };

  const handleSpecialFinalApproval = async () => {
    if (!allocationRequest || !remainingPay || decidingRequestId) return;
    setDecidingRequestId(allocationRequest.id);
    try {
      await leaveService.decideRequestAsync(
        allocationRequest.id,
        "approve",
        undefined,
        currentUser.getActorContext(),
        { allocations, remainingPay },
      );
      toast.success("Special leave approved and sent to Finance.");
      setAllocationRequest(null);
      loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not approve special leave.");
    } finally {
      setDecidingRequestId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectDialog.request || decidingRequestId) return;
    setDecidingRequestId(rejectDialog.request.id);
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
    } finally {
      setDecidingRequestId(null);
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
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const visibleRequests = requests.filter((request) => {
      if (!normalizedQuery) return true;
      const employee = directoryEmployees.find((item) => item.id === request.employeeId);
      const policy = policies.find((item) => item.id === request.policyId);
      return [
        employee?.preferredName,
        request.requesterName,
        policy?.name,
        request.reason,
        request.startDate,
        request.endDate,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
    if (visibleRequests.length === 0) {
      return (
        <div className="rounded-2xl border bg-card px-5 py-14 text-center shadow-sm">
          <Check className="mx-auto mb-3 size-9 text-emerald-600/70" aria-hidden="true" />
          <p className="font-semibold">
            {requests.length ? "No requests match your search" : "All caught up"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {requests.length
              ? "Try another name, leave type or date."
              : "There are no leave requests waiting in this queue."}
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {[...visibleRequests]
          .sort(
            (left, right) =>
              Number(Boolean(right.policySnapshot.noticeException)) -
                Number(Boolean(left.policySnapshot.noticeException)) ||
              left.startDate.localeCompare(right.startDate),
          )
          .map((req) => {
            const emp = directoryEmployees.find((item) => item.id === req.employeeId);
            const employeeName = emp?.preferredName ?? req.requesterName ?? "Employee";
            const policy = policies.find((p) => p.id === req.policyId);
            const reviewStartDate = req.pendingAmendment?.proposedStartDate ?? req.startDate;
            const reviewEndDate = req.pendingAmendment?.proposedEndDate ?? req.endDate;
            const reviewDays =
              req.pendingAmendment?.proposedWorkingDays ?? req.workingDaysRequested;
            const isSpecial = Boolean(req.policySnapshot.specialRequest);
            const overlaps = leaveService
              .getTeamOverlaps(
                emp?.department || "",
                reviewStartDate,
                reviewEndDate,
                currentUser.getActorContext(),
              )
              .filter((overlapReq) => overlapReq.id !== req.id); // exclude self

            return (
              <Card
                key={req.id}
                id={`approval-${req.id}`}
                className={`overflow-hidden shadow-sm transition-colors hover:border-primary/30 ${
                  focusedRequestId === req.id ? "border-primary ring-2 ring-primary/20" : ""
                }`}
              >
                <CardHeader className="border-b bg-muted/20 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
                        aria-hidden="true"
                      >
                        {employeeName.slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <CardTitle className="truncate text-base">{employeeName}</CardTitle>
                        <CardDescription className="mt-1">
                          {policy?.name ?? "Leave"} · {reviewDays}{" "}
                          {reviewDays === 1 ? "day" : "days"}
                        </CardDescription>
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className="border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-800"
                    >
                      {req.status === "Pending HR" && req.policySnapshot.noticeException
                        ? "Special approvals"
                        : req.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-5 pt-5">
                  {isSpecial && (
                    <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                      <strong>Special leave - line manager, then Riccardo, then HR</strong>
                      <p className="mt-1">
                        This request may cross leave years or exceed the ordinary allowance. HR
                        decides the balance deductions and pay treatment at final approval.
                      </p>
                      <p className="mt-2 whitespace-pre-wrap">
                        {req.policySnapshot.specialRequest?.reason}
                      </p>
                    </div>
                  )}
                  {req.policySnapshot.noticeException && !req.pendingAmendment && (
                    <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                      <strong>
                        {req.status === "Pending Line Manager"
                          ? "Special reviews complete — final line manager decision"
                          : "Short-notice exception — Country Manager and HR review first"}
                      </strong>
                      <p className="mt-1">
                        {req.policySnapshot.noticeException.actualDays} of{" "}
                        {req.policySnapshot.noticeException.requiredDays} required calendar days'
                        notice. Riccardo and HR must both approve before the line manager can
                        decide.
                      </p>
                      <p className="mt-2 whitespace-pre-wrap">
                        {req.policySnapshot.noticeException.reason}
                      </p>
                    </div>
                  )}
                  <div className="grid gap-5 text-sm lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
                    <div className="min-w-0 space-y-3">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <CalendarDays className="size-4" aria-hidden="true" /> Request details
                      </div>
                      <div className="grid grid-cols-[85px_minmax(0,1fr)] gap-2">
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
                        <div className="grid grid-cols-[85px_minmax(0,1fr)] gap-2">
                          <span className="text-muted-foreground">Current leave:</span>
                          <span>
                            {req.startDate} to {req.endDate} ({req.workingDaysRequested} days)
                          </span>
                        </div>
                      )}
                      <div className="grid grid-cols-[85px_minmax(0,1fr)] gap-2">
                        <span className="text-muted-foreground">
                          {req.pendingAmendment ? "Change reason:" : "Reason:"}
                        </span>
                        <span className="whitespace-pre-wrap break-words">
                          {req.pendingAmendment?.reason ?? req.reason}
                        </span>
                      </div>
                      {req.handoverContactId && (
                        <div className="grid grid-cols-[85px_minmax(0,1fr)] gap-2">
                          <span className="text-muted-foreground">Handover:</span>
                          <span>
                            {directoryEmployees.find((item) => item.id === req.handoverContactId)
                              ?.preferredName ?? "Colleague"}
                          </span>
                        </div>
                      )}
                      {req.attachmentFileId && (
                        <div className="grid grid-cols-[85px_minmax(0,1fr)] items-center gap-2">
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

                    <div className="min-w-0 space-y-3 border-t pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Your decision
                      </p>
                      {overlaps.length > 0 && (
                        <div className="bg-amber-50 border border-amber-200 text-amber-800 p-2 rounded-md text-xs flex gap-2">
                          <AlertTriangle className="h-4 w-4 shrink-0" />
                          <div>
                            <strong>Team Overlap Warning:</strong>
                            <ul className="list-disc pl-4 mt-1">
                              {overlaps.map((o) => (
                                <li key={o.id}>
                                  {
                                    directoryEmployees.find((item) => item.id === o.employeeId)
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
                                  : isSpecial
                                    ? "HR will choose the balance deductions and pay treatment before approval."
                                    : `Approval will deduct ${req.workingDaysRequested} days from the employee's ${policy?.name} balance.`}
                            </div>
                          </div>
                        )}
                      <div className="flex gap-2 justify-end pt-2">
                        <Button
                          variant="outline"
                          className="text-destructive border-destructive/30 hover:bg-destructive hover:text-white"
                          disabled={Boolean(decidingRequestId)}
                          onClick={() => setRejectDialog({ open: true, request: req })}
                        >
                          <X className="mr-2 h-4 w-4" /> Reject
                        </Button>
                        <Button
                          className="bg-emerald-600 hover:bg-emerald-700 text-white"
                          disabled={Boolean(decidingRequestId)}
                          onClick={() => handleApprove(req)}
                        >
                          <Check className="mr-2 h-4 w-4" />{" "}
                          {decidingRequestId === req.id
                            ? "Saving…"
                            : (req.policySnapshot.noticeException || isSpecial) &&
                                !req.pendingAmendment
                              ? "Approve exception"
                              : "Approve"}
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
    <main className="mx-auto max-w-[1280px] space-y-5 pb-10">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          Leave · Decisions
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Leave Approvals</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review each request and make the next decision.
        </p>
      </header>

      <div className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
        <label htmlFor="leave-approval-search" className="mb-2 block text-sm font-semibold">
          Find a request
        </label>
        <div className="relative max-w-xl">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="leave-approval-search"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search employee, leave type or date"
            className="h-10 pl-9"
          />
        </div>
      </div>

      <Tabs value={selectedSection} onValueChange={setSelectedSection} className="w-full">
        <TabsList>
          {specialQueue.length > 0 && (
            <TabsTrigger value="special" className="flex gap-2">
              Special approvals
              <Badge variant="destructive" className="ml-1">
                {specialQueue.length}
              </Badge>
            </TabsTrigger>
          )}
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

        {specialQueue.length > 0 && (
          <TabsContent value="special" className="space-y-3">
            <h2 className="text-base font-semibold">Special approvals</h2>
            {renderQueue(specialQueue, false)}
          </TabsContent>
        )}

        <TabsContent value="manager" className="space-y-3">
          <h2 className="text-base font-semibold">My team</h2>
          {renderQueue(managerQueue, false)}
        </TabsContent>

        {canCompleteHrReview && (
          <TabsContent value="admin" className="space-y-3">
            <h2 className="text-base font-semibold">HR confirmation</h2>
            {renderQueue(adminQueue, true)}
          </TabsContent>
        )}
      </Tabs>

      <Dialog
        open={Boolean(allocationRequest)}
        onOpenChange={(open) => !open && setAllocationRequest(null)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[650px]">
          <DialogHeader>
            <DialogTitle>Allocate special leave before approval</DialogTitle>
          </DialogHeader>
          {allocationRequest &&
            (() => {
              const sources = leaveService.getSpecialAllocationSources(
                allocationRequest.employeeId,
                currentUser.getActorContext(),
              );
              const allocated = allocations.reduce(
                (sum, item) => sum + (Number.isFinite(item.days) ? item.days : 0),
                0,
              );
              const remaining = allocationRequest.workingDaysRequested - allocated;
              const unpaidAllocated = allocations.reduce((sum, item) => {
                const source = sources.find(
                  (row) => row.policyId === item.policyId && row.leaveYear === item.leaveYear,
                );
                return sum + (source && !source.isPaid ? item.days : 0);
              }, 0);
              return (
                <div className="space-y-4 text-sm">
                  <p>
                    {allocationRequest.workingDaysRequested} day(s), {allocationRequest.startDate}{" "}
                    to {allocationRequest.endDate}. Choose any available balances to deduct from. A
                    balance marked unpaid remains unpaid. The remaining days can be paid or unpaid.
                    Unpaid days are assigned to the latest dates first for payroll.
                  </p>
                  {allocations.map((allocation, index) => {
                    const source = sources.find(
                      (item) =>
                        item.policyId === allocation.policyId &&
                        item.leaveYear === allocation.leaveYear,
                    );
                    return (
                      <div
                        key={`${allocation.policyId}-${allocation.leaveYear}`}
                        className="flex flex-wrap items-end gap-2 rounded-md border p-3"
                      >
                        <div className="min-w-[180px] flex-1">
                          <Label>Balance</Label>
                          <p className="mt-2 font-medium">
                            {source?.policyName ?? "Leave"} - {allocation.leaveYear} (
                            {source?.balanceDays ?? 0} available;{" "}
                            {source?.isPaid ? "paid" : "unpaid"})
                          </p>
                        </div>
                        <div className="w-28">
                          <Label htmlFor={`special-days-${index}`}>Days</Label>
                          <Input
                            id={`special-days-${index}`}
                            type="number"
                            min="0.5"
                            max={source?.balanceDays}
                            step="0.5"
                            value={allocation.days || ""}
                            onChange={(event) =>
                              setAllocations((rows) =>
                                rows.map((row, position) =>
                                  position === index
                                    ? { ...row, days: Number(event.target.value) }
                                    : row,
                                ),
                              )
                            }
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            setAllocations((rows) =>
                              rows.filter((_, position) => position !== index),
                            )
                          }
                        >
                          Remove
                        </Button>
                      </div>
                    );
                  })}
                  <div className="space-y-2">
                    <Label>Add a balance deduction</Label>
                    <Select
                      value=""
                      onValueChange={(value) => {
                        const source = sources.find(
                          (item) => `${item.policyId}:${item.leaveYear}` === value,
                        );
                        if (source)
                          setAllocations((rows) => [
                            ...rows,
                            { policyId: source.policyId, leaveYear: source.leaveYear, days: 0 },
                          ]);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select leave type and year (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        {sources
                          .filter(
                            (source) =>
                              !allocations.some(
                                (row) =>
                                  row.policyId === source.policyId &&
                                  row.leaveYear === source.leaveYear,
                              ),
                          )
                          .map((source) => (
                            <SelectItem
                              key={`${source.policyId}:${source.leaveYear}`}
                              value={`${source.policyId}:${source.leaveYear}`}
                            >
                              {source.policyName} - {source.leaveYear} ({source.balanceDays} days;{" "}
                              {source.isPaid ? "paid" : "unpaid"})
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className={remaining < 0 ? "font-medium text-destructive" : "font-medium"}>
                    Remaining without balance deduction: {remaining} day(s)
                  </p>
                  {remainingPay && (
                    <p className="font-medium">
                      Payroll will treat{" "}
                      {unpaidAllocated + (remainingPay === "Unpaid" ? Math.max(0, remaining) : 0)}{" "}
                      day(s) as unpaid.
                    </p>
                  )}
                  <div className="space-y-2">
                    <Label>Pay treatment for remaining days</Label>
                    <Select
                      value={remainingPay}
                      onValueChange={(value) => setRemainingPay(value as "Paid" | "Unpaid")}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choose paid or unpaid" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Paid">Paid - no payroll deduction</SelectItem>
                        <SelectItem value="Unpaid">Unpaid - payroll deduction</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setAllocationRequest(null)}>
                      Back
                    </Button>
                    <Button
                      disabled={
                        Boolean(decidingRequestId) ||
                        !remainingPay ||
                        remaining < 0 ||
                        allocations.some(
                          (item) =>
                            item.days <= 0 ||
                            item.days >
                              (sources.find(
                                (source) =>
                                  source.policyId === item.policyId &&
                                  source.leaveYear === item.leaveYear,
                              )?.balanceDays ?? 0),
                        )
                      }
                      onClick={() => void handleSpecialFinalApproval()}
                    >
                      {decidingRequestId === allocationRequest.id
                        ? "Saving…"
                        : "Approve and notify Finance"}
                    </Button>
                  </DialogFooter>
                </div>
              );
            })()}
        </DialogContent>
      </Dialog>

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
              disabled={rejectReason.trim().length < 3 || Boolean(decidingRequestId)}
            >
              {decidingRequestId === rejectDialog.request?.id ? "Saving…" : "Confirm Rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
