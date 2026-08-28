import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LeaveService } from "@/lib/data/leave-service";
import { CalendarDays } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";

export function LeaveTab({ employeeId }: { employeeId: string }) {
  const leaveService = useMemo(() => new LeaveService(), []);
  const currentUser = useCurrentUser();
  const leaveDestination =
    currentUser.activeRole === "HR" || currentUser.activeRole === "Super Admin"
      ? "/staff/leave-admin"
      : currentUser.activeRole === "Line Manager"
        ? "/staff/leave-approvals"
        : "/staff/me/leave-balances";
  const leaveDestinationLabel =
    currentUser.activeRole === "HR" || currentUser.activeRole === "Super Admin"
      ? "Open Leave Admin"
      : currentUser.activeRole === "Line Manager"
        ? "Open Leave Approvals"
        : "Open My Leave";

  const balances = useMemo(
    () => leaveService.getAllBalancesForEmployee(employeeId, currentUser.getActorContext()),
    [currentUser, leaveService, employeeId],
  );
  const policies = useMemo(() => leaveService.getPolicies(), [leaveService]);
  const requests = useMemo(
    () =>
      leaveService
        .getLeaveRequestsForEmployee(employeeId, currentUser.getActorContext())
        .sort((a, b) => b.startDate.localeCompare(a.startDate)),
    [currentUser, leaveService, employeeId],
  );

  const upcoming = requests.filter(
    (r) => r.status === "Approved" && new Date(r.startDate) >= new Date(),
  );

  const usedStatuses = new Set([
    "Approved",
    "Taken",
    "Pending Line Manager",
    "Pending HR",
    "Pending Super Admin",
  ]);
  const visibleBalances = balances.filter((b) => {
    const policy = policies.find((p) => p.id === b.policyId);
    return policy?.consumesBalance !== false;
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {visibleBalances.map((b) => {
          const policy = policies.find((p) => p.id === b.policyId);
          const hasBeenUsed = requests.some(
            (r) => r.policyId === b.policyId && usedStatuses.has(r.status),
          );

          return (
            <Card key={b.policyId}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between gap-2">
                  <span>{policy?.name || "Policy"}</span>
                  {policy && (
                    <Badge variant="outline" className="text-[10px] font-normal shrink-0">
                      {policy.code} &middot; {policy.category}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {policy?.scope === "Once Per Service" ? (
                  hasBeenUsed ? (
                    <div>
                      <Badge variant="secondary">Used</Badge>
                      <p className="text-xs text-muted-foreground mt-1">
                        This leave allowance has already been used or requested.
                      </p>
                    </div>
                  ) : (
                    <div>
                      <Badge variant="default">Available</Badge>
                      <p className="text-xs text-muted-foreground mt-1">
                        Usable once during employment ({policy.baseEntitlementDays} days).
                      </p>
                    </div>
                  )
                ) : policy?.scope === "Per Event" ? (
                  <>
                    <div className="text-2xl font-bold">
                      {policy.baseEntitlementDays}{" "}
                      <span className="text-sm font-normal text-muted-foreground">
                        days / occurrence
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Not annually tracked &middot; per-event cap
                    </p>
                  </>
                ) : policy?.scope === "Ledger" ? (
                  <>
                    <div className="text-2xl font-bold">
                      {b.available.toFixed(1)}{" "}
                      <span className="text-sm font-normal text-muted-foreground">
                        days credited
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {b.taken} taken &middot; {b.pending} pending &middot;{" "}
                      {b.projectedAvailable.toFixed(1)} projected
                    </p>
                  </>
                ) : (
                  <>
                    <div className="text-2xl font-bold">
                      {b.available.toFixed(1)}{" "}
                      <span className="text-sm font-normal text-muted-foreground">days</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {b.taken} taken &middot; {b.pending} pending &middot;{" "}
                      {b.projectedAvailable.toFixed(1)} projected
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
        {visibleBalances.length === 0 && (
          <Card className="sm:col-span-2 lg:col-span-4">
            <CardContent className="py-8 text-center text-muted-foreground">
              No leave balances established for this employee yet.
            </CardContent>
          </Card>
        )}
      </div>

      {upcoming.length > 0 && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <CalendarDays className="h-4 w-4" /> Upcoming Approved Leave
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            {upcoming.map((r) => (
              <div key={r.id}>
                {r.startDate} to {r.endDate} &middot; {r.workingDaysRequested}{" "}
                {r.workingDaysRequested === 1 ? "day" : "days"} &middot; {r.reason}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Request History</CardTitle>
          <Link to={leaveDestination} className="text-sm text-primary hover:underline">
            {leaveDestinationLabel}
          </Link>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dates</TableHead>
                <TableHead>Days</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    No leave requests on record.
                  </TableCell>
                </TableRow>
              ) : (
                requests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm">
                      {r.startDate} {r.startDate !== r.endDate ? `to ${r.endDate}` : ""}
                    </TableCell>
                    <TableCell className="text-sm">{r.workingDaysRequested}</TableCell>
                    <TableCell className="text-sm">{r.reason}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.status === "Approved" || r.status === "Taken"
                            ? "default"
                            : r.status === "Declined" || r.status === "Automatically Refused"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {r.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
