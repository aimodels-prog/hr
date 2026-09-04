import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { EmployeeService } from "@/lib/data/employee-service";
import { TravelService } from "@/lib/data/travel-service";
import type { TravelRequest } from "@/lib/data/travel-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/staff/travel-approvals")({
  component: TravelManagerApprovalsRoute,
});

function TravelManagerApprovalsRoute() {
  return (
    <RequirePermission permission="travel:manager_review" resourceName="Team Travel Approvals">
      <TravelManagerApprovals />
    </RequirePermission>
  );
}

function TravelManagerApprovals() {
  const currentUser = useCurrentUser();
  const travelService = useMemo(() => new TravelService(), []);
  const employeeService = useMemo(() => new EmployeeService(), []);
  const [requests, setRequests] = useState<TravelRequest[]>([]);
  const [selected, setSelected] = useState<TravelRequest | null>(null);
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void travelService
      .getRequestsAsync(currentUser.getActorContext())
      .then(setRequests)
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : "Team travel could not be loaded."),
      );
  }, [currentUser, travelService]);

  const employees = employeeService.getEmployees(currentUser.getActorContext());
  const pending = requests.filter(
    (request) =>
      request.employeeId !== currentUser.employeeId &&
      request.status === "Pending HR and Accounts" &&
      request.managerApprovalStatus === "Pending",
  );

  const openDecision = (request: TravelRequest, next: "approve" | "reject") => {
    setSelected(request);
    setDecision(next);
    setNote("");
  };

  const submitDecision = async () => {
    if (!selected) return;
    if (decision === "reject" && note.trim().length < 3) {
      toast.error("Explain why the request is being declined.");
      return;
    }
    setSaving(true);
    try {
      await travelService.managerApproveAsync(
        selected.id,
        decision === "approve",
        note,
        currentUser.getActorContext(),
      );
      setRequests(await travelService.getRequestsAsync(currentUser.getActorContext()));
      setSelected(null);
      toast.success(
        decision === "approve" ? "Business travel approved" : "Travel request declined",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The decision could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 pb-10">
      <PageHeader
        title="Team Travel Approvals"
        description="Confirm the business need and dates for travel requested by your direct reports."
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Purpose</TableHead>
                <TableHead>HR / Accounts</TableHead>
                <TableHead className="text-right">Decision</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.map((request) => (
                <TableRow key={request.id}>
                  <TableCell className="font-medium">
                    {employees.find((employee) => employee.id === request.employeeId)
                      ?.preferredName ?? "Employee"}
                  </TableCell>
                  <TableCell>{request.destination}</TableCell>
                  <TableCell>
                    {request.startDate} to {request.endDate}
                  </TableCell>
                  <TableCell className="max-w-64 truncate" title={request.purpose}>
                    {request.purpose}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Badge variant="outline">HR: {request.hrApprovalStatus}</Badge>
                      <Badge variant="outline">Accounts: {request.accountsApprovalStatus}</Badge>
                    </div>
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openDecision(request, "reject")}
                    >
                      <XCircle className="h-4 w-4" /> Decline
                    </Button>
                    <Button size="sm" onClick={() => openDecision(request, "approve")}>
                      <CheckCircle className="h-4 w-4" /> Approve
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {pending.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No team travel requests need your decision.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decision === "approve" ? "Approve business travel" : "Decline travel request"}
            </DialogTitle>
            <DialogDescription>
              Confirm whether this trip is needed for the employee's work. HR and Accounts complete
              their own compliance and budget reviews.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={decision === "reject" ? "Reason for declining" : "Optional manager note"}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>
              Cancel
            </Button>
            <Button
              variant={decision === "approve" ? "default" : "destructive"}
              disabled={saving}
              onClick={() => void submitDecision()}
            >
              {saving
                ? "Saving..."
                : decision === "approve"
                  ? "Confirm approval"
                  : "Confirm decline"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
