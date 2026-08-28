import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Activity,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  History,
  PlusCircle,
  Scale,
} from "lucide-react";

import { LeaveRequestDialog } from "@/components/leave/leave-request-dialog";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTableShell } from "@/components/ui/data-table-shell";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { LeaveService } from "@/lib/data/leave-service";
import type { LeavePolicy, LeaveRequest, LeaveTransaction } from "@/lib/data/leave-types";
import { toast } from "sonner";

export const Route = createFileRoute("/staff/me/leave-balances")({
  component: LeaveBalancesWrapper,
});

function LeaveBalancesWrapper() {
  return (
    <RequirePermission permission="leave:view_self" resourceName="My Leave">
      <LeaveBalancesRoute />
    </RequirePermission>
  );
}

const ACTIVE_OR_USED_STATUSES = [
  "Approved",
  "Taken",
  "Pending Line Manager",
  "Pending HR",
  "Pending Super Admin",
];
const HISTORY_PAGE_SIZE = 5;

function formatDays(value: number): string {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function requestVariant(
  status: LeaveRequest["status"],
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "Approved") return "default";
  if (status === "Taken" || status.startsWith("Pending")) return "secondary";
  if (status.startsWith("Cancellation")) return "outline";
  return "destructive";
}

function entitlementLabel(policy: LeavePolicy): string {
  if (!policy.consumesBalance || policy.scope === "Not Tracked") return "Not balance tracked";
  if (policy.scope === "Annual") return `${formatDays(policy.baseEntitlementDays)} days / year`;
  if (policy.scope === "Once Per Service")
    return `${formatDays(policy.baseEntitlementDays)} days once`;
  if (policy.scope === "Per Event") return `${formatDays(policy.baseEntitlementDays)} days / event`;
  return "Credited by HR";
}

function activityLabel(type: LeaveTransaction["transactionType"]): string {
  const labels: Record<LeaveTransaction["transactionType"], string> = {
    Entitlement: "Leave allowance added",
    "Carry-Forward": "Unused leave carried over",
    Accrual: "Leave added",
    "Approved Leave": "Leave used",
    "Cancellation Restoration": "Leave returned",
    Expiry: "Unused leave expired",
    "Manual Adjustment": "HR correction",
  };
  return labels[type];
}

function activityReason(transaction: LeaveTransaction, policy?: LeavePolicy): string {
  const leaveName = policy?.name ?? "leave";
  const year = new Date(transaction.date).getFullYear();
  const reason = transaction.reason.trim();

  if (reason === "System initialization for current year") {
    return `${year} ${leaveName} allowance added.`;
  }
  if (reason === "Carried forward from previous year") {
    return `Unused ${leaveName.toLowerCase()} carried forward from ${year - 1}.`;
  }
  if (reason === "Taken leave (historical)") {
    return `Approved ${leaveName.toLowerCase()} taken from the available balance.`;
  }
  return reason;
}

function TablePagination({
  page,
  totalItems,
  onPageChange,
}: {
  page: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / HISTORY_PAGE_SIZE));
  if (totalItems <= HISTORY_PAGE_SIZE) return null;

  const firstItem = (page - 1) * HISTORY_PAGE_SIZE + 1;
  const lastItem = Math.min(page * HISTORY_PAGE_SIZE, totalItems);
  return (
    <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        Showing {firstItem}–{lastItem} of {totalItems}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" /> Previous
        </Button>
        <span className="min-w-20 text-center text-sm tabular-nums">
          {page} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page === totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function LeaveBalancesRoute() {
  const currentUser = useCurrentUser();
  const leaveService = useMemo(() => new LeaveService(), []);
  const employeeId = currentUser.employeeId || "";
  const [, setRevision] = useState(0);
  const [isRequestOpen, setIsRequestOpen] = useState(false);
  const [requestPage, setRequestPage] = useState(1);
  const [activityPage, setActivityPage] = useState(1);
  const [withdrawTarget, setWithdrawTarget] = useState<LeaveRequest | null>(null);
  const [cancelTarget, setCancelTarget] = useState<LeaveRequest | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");

  const isAdmin = currentUser.activeRole === "Super Admin" || currentUser.activeRole === "HR";
  const allPolicies = leaveService.getPolicies();
  const actorContext = currentUser.getActorContext();
  const policies = employeeId ? leaveService.getEligiblePolicies(employeeId, actorContext) : [];
  const balances = employeeId
    ? leaveService.getAllBalancesForEmployee(employeeId, actorContext)
    : [];
  const transactions = employeeId
    ? leaveService
        .getTransactionsForEmployee(employeeId, undefined, actorContext)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    : [];
  const requests = employeeId
    ? leaveService
        .getLeaveRequestsForEmployee(employeeId, actorContext)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    : [];

  const balanceByPolicy = new Map(balances.map((balance) => [balance.policyId, balance]));
  const policyById = new Map(allPolicies.map((policy) => [policy.id, policy]));
  const annualPolicy = policies.find((policy) => policy.type === "Annual");
  const annualBalance = annualPolicy ? balanceByPolicy.get(annualPolicy.id) : undefined;
  const pendingRequests = requests.filter((request) => request.status.startsWith("Pending"));
  const nextApprovedRequest = requests
    .filter(
      (request) =>
        request.status === "Approved" && new Date(request.startDate).getTime() >= Date.now(),
    )
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())[0];
  const usedPercentage = annualPolicy
    ? Math.min(
        100,
        Math.max(
          0,
          (((annualBalance?.taken ?? 0) + (annualBalance?.approvedFuture ?? 0)) /
            Math.max(annualPolicy.baseEntitlementDays, 1)) *
            100,
        ),
      )
    : 0;
  const visibleRequests = requests.slice(
    (requestPage - 1) * HISTORY_PAGE_SIZE,
    requestPage * HISTORY_PAGE_SIZE,
  );
  const visibleTransactions = transactions.slice(
    (activityPage - 1) * HISTORY_PAGE_SIZE,
    activityPage * HISTORY_PAGE_SIZE,
  );

  const refreshData = () => setRevision((value) => value + 1);

  const confirmWithdraw = () => {
    if (!withdrawTarget) return;
    try {
      leaveService.withdrawRequest(withdrawTarget.id, currentUser.getActorContext());
      refreshData();
      toast.success("Leave request withdrawn");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to withdraw request");
    } finally {
      setWithdrawTarget(null);
    }
  };

  const confirmCancellation = () => {
    if (!cancelTarget) return;
    if (cancellationReason.trim().length < 3) {
      toast.error("A reason is required to cancel leave.");
      return;
    }
    try {
      leaveService.requestCancellation(
        cancelTarget.id,
        cancellationReason,
        currentUser.getActorContext(),
      );
      refreshData();
      toast.success("Cancellation request sent");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to cancel leave");
    } finally {
      setCancelTarget(null);
      setCancellationReason("");
    }
  };

  if (!employeeId) {
    return (
      <div className="flex min-h-80 flex-col items-center justify-center rounded-xl border border-dashed p-10 text-center text-muted-foreground">
        <CalendarDays className="h-9 w-9" />
        <p className="mt-4 font-medium text-foreground">Employee profile required</p>
        <p className="mt-1 text-sm">
          Your account must be linked to an employee record before leave balances are available.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 pb-10">
      <PageHeader
        title="My Leave"
        description="See your leave allowances, available days and time-off requests."
        actions={
          <div className="flex flex-wrap gap-2">
            {isAdmin && (
              <Button asChild variant="outline">
                <Link to="/staff/leave-admin">
                  <Scale className="mr-2 h-4 w-4" /> Manage Balances
                </Link>
              </Button>
            )}
            <Button onClick={() => setIsRequestOpen(true)}>
              <PlusCircle className="mr-2 h-4 w-4" /> Request Leave
            </Button>
          </div>
        }
      />

      {annualPolicy && annualBalance && (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="grid lg:grid-cols-[1.2fr_1fr]">
            <div className="border-b p-6 sm:p-8 lg:border-b-0 lg:border-r">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{annualPolicy.name}</p>
                <Badge variant="outline">Managed by HR policy</Badge>
              </div>
              <div className="mt-5 flex items-end gap-3">
                <span className="text-5xl font-semibold tracking-tight tabular-nums">
                  {formatDays(annualBalance.available)}
                </span>
                <span className="pb-1 text-muted-foreground">days available</span>
              </div>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                VIA provides {formatDays(annualPolicy.baseEntitlementDays)} days each leave year.
                Changes made by HR will appear here automatically.
              </p>
              <div className="mt-6 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${usedPercentage}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {formatDays((annualBalance.taken ?? 0) + (annualBalance.approvedFuture ?? 0))} days
                used or scheduled from this year&apos;s allowance.
              </p>
            </div>
            <div className="grid grid-cols-2 divide-x divide-y sm:grid-cols-4 lg:grid-cols-2">
              {[
                ["Yearly allowance", annualPolicy.baseEntitlementDays],
                ["Carried forward", annualBalance.carriedForward],
                ["Pending approval", annualBalance.pending],
                ["Projected remaining", annualBalance.projectedAvailable],
              ].map(([label, value]) => (
                <div key={String(label)} className="p-5 sm:p-6">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {label}
                  </p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">
                    {formatDays(Number(value))}
                    <span className="ml-1 text-sm font-normal text-muted-foreground">days</span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Your Leave Allowances</CardTitle>
              <CardDescription className="mt-1">
                Every type of leave currently available to you.
              </CardDescription>
            </div>
            <Badge variant="secondary">{policies.length} available types</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <DataTableShell className="rounded-none border-0 shadow-none">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Leave type</TableHead>
                  <TableHead>Entitlement</TableHead>
                  <TableHead className="text-right">Carried</TableHead>
                  <TableHead className="text-right">Used / scheduled</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead>Request rules</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.map((policy) => {
                  const balance = balanceByPolicy.get(policy.id);
                  const hasBeenUsed = requests.some(
                    (request) =>
                      request.policyId === policy.id &&
                      ACTIVE_OR_USED_STATUSES.includes(request.status),
                  );
                  const isLedgerBalance = policy.scope === "Annual" || policy.scope === "Ledger";
                  const availableLabel = !policy.consumesBalance
                    ? "No deduction"
                    : policy.scope === "Per Event"
                      ? `${formatDays(policy.baseEntitlementDays)} / event`
                      : policy.scope === "Once Per Service"
                        ? hasBeenUsed
                          ? "Used"
                          : `${formatDays(policy.baseEntitlementDays)} days`
                        : `${formatDays(balance?.available ?? 0)} days`;

                  return (
                    <TableRow key={policy.id}>
                      <TableCell className="min-w-60">
                        <div className="font-medium">{policy.name}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {policy.code}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {policy.isPaid ? "Paid" : "Unpaid"} · {policy.scope}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-medium">
                        {entitlementLabel(policy)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {isLedgerBalance ? formatDays(balance?.carriedForward ?? 0) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {isLedgerBalance
                          ? formatDays((balance?.taken ?? 0) + (balance?.approvedFuture ?? 0))
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {balance?.pending ? formatDays(balance.pending) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {availableLabel}
                      </TableCell>
                      <TableCell className="min-w-52 text-xs leading-5 text-muted-foreground">
                        {policy.noticeRules?.enabled ? (
                          <span>
                            Up to {policy.noticeRules.shortLeaveMaxDays} days:{" "}
                            {policy.noticeRules.shortLeaveNoticeDays}-day notice. Longer:{" "}
                            {policy.noticeRules.longLeaveNoticeDays}-day notice.
                          </span>
                        ) : (
                          <span>No advance-notice rule</span>
                        )}
                        {policy.requiresAttachment && (
                          <span className="block font-medium text-foreground">
                            Evidence required
                          </span>
                        )}
                        {policy.requiresHandoverContact && (
                          <span className="block font-medium text-foreground">
                            Covering colleague required
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {policies.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                      No leave policies are currently available for your profile.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </DataTableShell>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Requests awaiting approval</p>
              <p className="text-xl font-semibold">{pendingRequests.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Next approved leave</p>
              <p className="text-base font-semibold">
                {nextApprovedRequest
                  ? `${formatDate(nextApprovedRequest.startDate)} · ${policyById.get(nextApprovedRequest.policyId)?.name ?? "Leave"}`
                  : "Nothing scheduled"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <Tabs defaultValue="requests">
          <CardHeader className="border-b pb-0">
            <div>
              <CardTitle>Leave History</CardTitle>
              <CardDescription className="mt-1">
                Review your requests and every change to your leave balance.
              </CardDescription>
            </div>
            <TabsList className="mt-5 h-auto w-full justify-start gap-1 rounded-none bg-transparent p-0">
              <TabsTrigger
                value="requests"
                className="flex-1 gap-1 rounded-none border-b-2 border-transparent px-1 pb-3 pt-1 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none sm:flex-none sm:gap-2"
              >
                <Activity className="hidden h-4 w-4 sm:block" />
                Request History
                <Badge variant="secondary" className="ml-1 rounded-full px-2 tabular-nums">
                  {requests.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger
                value="balance"
                className="flex-1 gap-1 rounded-none border-b-2 border-transparent px-1 pb-3 pt-1 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none sm:flex-none sm:gap-2"
              >
                <History className="hidden h-4 w-4 sm:block" />
                Balance Activity
                <Badge variant="secondary" className="ml-1 rounded-full px-2 tabular-nums">
                  {transactions.length}
                </Badge>
              </TabsTrigger>
            </TabsList>
          </CardHeader>

          <TabsContent value="requests" className="m-0 focus-visible:ring-inset">
            <div className="border-b px-6 py-4">
              <p className="text-sm text-muted-foreground">
                Follow submitted, approved, declined and cancelled leave requests.
              </p>
            </div>
            <CardContent className="p-0">
              <DataTableShell className="rounded-none border-0 shadow-none">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dates</TableHead>
                      <TableHead>Leave type</TableHead>
                      <TableHead className="text-right">Days</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleRequests.map((request) => {
                      const policy = policyById.get(request.policyId);
                      const canWithdraw = request.status.startsWith("Pending");
                      const canCancel =
                        request.status === "Approved" &&
                        request.endDate >= new Date().toISOString().slice(0, 10);
                      const reason =
                        request.status === "Automatically Refused"
                          ? request.refusalReason
                          : request.status === "Cancellation Pending"
                            ? `Cancellation: ${request.cancellationReason}`
                            : request.reason;
                      return (
                        <TableRow key={request.id}>
                          <TableCell className="whitespace-nowrap">
                            {formatDate(request.startDate)}
                            {request.startDate !== request.endDate &&
                              ` – ${formatDate(request.endDate)}`}
                          </TableCell>
                          <TableCell>{policy?.name ?? "Leave"}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatDays(request.workingDaysRequested)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={requestVariant(request.status)}>{request.status}</Badge>
                          </TableCell>
                          <TableCell className="max-w-64 truncate text-muted-foreground">
                            {reason}
                          </TableCell>
                          <TableCell className="text-right">
                            {canWithdraw && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setWithdrawTarget(request)}
                              >
                                Withdraw
                              </Button>
                            )}
                            {canCancel && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setCancelTarget(request);
                                  setCancellationReason("");
                                }}
                              >
                                Cancel leave
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {requests.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                          You have not submitted a leave request yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </DataTableShell>
              <TablePagination
                page={requestPage}
                totalItems={requests.length}
                onPageChange={setRequestPage}
              />
            </CardContent>
          </TabsContent>

          <TabsContent value="balance" className="m-0 focus-visible:ring-inset">
            <div className="border-b px-6 py-4">
              <p className="text-sm text-muted-foreground">
                See when leave was added, carried forward, used or corrected by HR.
              </p>
            </div>
            <CardContent className="p-0">
              <DataTableShell className="rounded-none border-0 shadow-none">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Leave type</TableHead>
                      <TableHead>Change</TableHead>
                      <TableHead className="text-right">Days</TableHead>
                      <TableHead>Explanation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleTransactions.map((transaction: LeaveTransaction) => {
                      const policy = policyById.get(transaction.policyId);
                      return (
                        <TableRow key={transaction.id}>
                          <TableCell className="whitespace-nowrap">
                            {formatDate(transaction.date)}
                          </TableCell>
                          <TableCell>{policy?.name ?? "Leave"}</TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {activityLabel(transaction.transactionType)}
                            </Badge>
                          </TableCell>
                          <TableCell
                            className={`text-right font-semibold tabular-nums ${transaction.days > 0 ? "text-emerald-600" : transaction.days < 0 ? "text-destructive" : ""}`}
                          >
                            {transaction.days > 0 ? "+" : ""}
                            {formatDays(transaction.days)}
                          </TableCell>
                          <TableCell className="min-w-72 text-muted-foreground">
                            {activityReason(transaction, policy)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {transactions.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                          No balance changes have been recorded yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </DataTableShell>
              <TablePagination
                page={activityPage}
                totalItems={transactions.length}
                onPageChange={setActivityPage}
              />
            </CardContent>
          </TabsContent>
        </Tabs>
      </Card>

      {isRequestOpen && (
        <LeaveRequestDialog
          open={isRequestOpen}
          onOpenChange={setIsRequestOpen}
          employeeId={employeeId}
          onSuccess={refreshData}
        />
      )}

      <AlertDialog
        open={!!withdrawTarget}
        onOpenChange={(open) => !open && setWithdrawTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Withdraw this leave request?</AlertDialogTitle>
            <AlertDialogDescription>
              This request will be removed from the approval queue. You can submit a new request
              later if you still need the time off.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep request</AlertDialogCancel>
            <AlertDialogAction onClick={confirmWithdraw}>Withdraw</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={!!cancelTarget}
        onOpenChange={(open) => {
          if (!open) {
            setCancelTarget(null);
            setCancellationReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this leave?</DialogTitle>
            <DialogDescription>
              This approved leave will be sent to HR for cancellation review, and your balance will
              be restored once approved.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={cancellationReason}
            onChange={(event) => setCancellationReason(event.target.value)}
            placeholder="Why are you cancelling this leave?"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>
              Keep leave
            </Button>
            <Button
              variant="destructive"
              disabled={cancellationReason.trim().length < 3}
              onClick={confirmCancellation}
            >
              Request Cancellation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
