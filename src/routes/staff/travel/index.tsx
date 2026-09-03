import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
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
import { toast } from "sonner";
import { TravelService } from "@/lib/data/travel-service";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { Plane, Plus } from "lucide-react";

export const Route = createFileRoute("/staff/travel/")({
  component: MyTravelRoute,
});

function MyTravelRoute() {
  const currentUser = useCurrentUser();
  const travelService = useMemo(() => new TravelService(), []);
  const employeeId = currentUser.employeeId ?? "";

  const [requests, setRequests] = useState(() =>
    travelService.getRequestsForEmployee(employeeId, currentUser.getActorContext()),
  );
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    travelService
      .getRequestsAsync(currentUser.getActorContext())
      .then((rows) => {
        if (!cancelled) setRequests(rows.filter((request) => request.employeeId === employeeId));
      })
      .catch((error) =>
        toast.error(
          error instanceof Error ? error.message : "Travel requests could not be loaded.",
        ),
      )
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [currentUser, employeeId, travelService]);

  if (!currentUser?.employeeId) {
    return <div>Employee profile required.</div>;
  }

  const handleWithdraw = async (id: string) => {
    try {
      await travelService.withdrawRequestAsync(id, currentUser.getActorContext());
      setRequests(travelService.getRequestsForEmployee(employeeId, currentUser.getActorContext()));
      toast.success("Travel request withdrawn");
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "The travel request could not be withdrawn.",
      );
    }
  };

  return (
    <RequirePermission permission="travel:request_self" resourceName="My Travel">
      <div className="flex flex-col gap-6 max-w-[1200px] mx-auto pb-10">
        <PageHeader
          title="My Travel Requests"
          description="Manage travel approvals and expense claims."
          actions={
            <Link to="/staff/travel/new">
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                New Travel Request
              </Button>
            </Link>
          }
        />

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Destination</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Total Estimate</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((req) => (
                  <TableRow key={req.id}>
                    <TableCell className="font-medium">
                      <div className="flex flex-col">
                        <span>{req.destination}</span>
                        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {req.purpose}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {req.startDate} to {req.endDate}
                    </TableCell>
                    <TableCell>
                      {req.totalEstimate.toLocaleString()} {req.currency}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          req.status === "Pre-authorised"
                            ? "default"
                            : req.status === "Pending HR and Accounts"
                              ? "secondary"
                              : req.status === "Rejected"
                                ? "destructive"
                                : "outline"
                        }
                      >
                        {req.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Link to="/staff/travel/$requestId" params={{ requestId: req.id }}>
                        <Button variant="ghost" size="sm">
                          Details
                        </Button>
                      </Link>
                      {req.status === "Pending HR and Accounts" &&
                        req.hrApprovalStatus === "Pending" &&
                        req.accountsApprovalStatus === "Pending" && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="ml-2"
                            onClick={() => void handleWithdraw(req.id)}
                          >
                            Withdraw
                          </Button>
                        )}
                    </TableCell>
                  </TableRow>
                ))}
                {!isLoading && requests.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      <Plane className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                      No travel requests found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </RequirePermission>
  );
}
