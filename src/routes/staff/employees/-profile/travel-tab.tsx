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
import { TravelService } from "@/lib/data/travel-service";
import { useCurrentUser } from "@/lib/auth";

export function TravelTab({ employeeId }: { employeeId: string }) {
  const travelService = useMemo(() => new TravelService(), []);
  const currentUser = useCurrentUser();
  const destination =
    currentUser.activeRole === "HR"
      ? "/staff/travel-hr-approvals"
      : currentUser.activeRole === "Accounts"
        ? "/staff/travel-accounts-approvals"
        : currentUser.activeRole === "Super Admin"
          ? "/staff/travel-closures"
          : "/staff/travel";
  const destinationLabel =
    currentUser.activeRole === "HR"
      ? "Open HR Approvals"
      : currentUser.activeRole === "Accounts"
        ? "Open Accounts Approvals"
        : currentUser.activeRole === "Super Admin"
          ? "Open Reimbursements"
          : "Open My Travel";

  const requests = useMemo(
    () =>
      travelService
        .getRequestsForEmployee(employeeId, currentUser.getActorContext())
        .sort((a, b) => b.startDate.localeCompare(a.startDate)),
    [travelService, employeeId, currentUser],
  );

  const active = requests.filter(
    (r) =>
      r.status !== "Closed" &&
      r.status !== "Rejected" &&
      r.status !== "Withdrawn" &&
      r.status !== "Draft",
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Trips</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{requests.length}</div>
          </CardContent>
        </Card>
        <Card className={active.length > 0 ? "border-blue-200 bg-blue-50/50" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active / In Progress
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{active.length}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Travel History</CardTitle>
          <Link to={destination} className="text-sm text-primary hover:underline">
            {destinationLabel}
          </Link>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Destination</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Purpose</TableHead>
                <TableHead>Estimate</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No travel requests on record.
                  </TableCell>
                </TableRow>
              ) : (
                requests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm font-medium">{r.destination}</TableCell>
                    <TableCell className="text-sm">
                      {r.startDate} to {r.endDate}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.purpose}</TableCell>
                    <TableCell className="text-sm">
                      {r.totalEstimate.toLocaleString()} {r.currency}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.status === "Closed" || r.status === "Pre-authorised"
                            ? "default"
                            : r.status === "Rejected" || r.status === "Withdrawn"
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
