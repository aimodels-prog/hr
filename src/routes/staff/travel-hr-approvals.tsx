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
import { TravelService } from "@/lib/data/travel-service";
import type { TravelRequest } from "@/lib/data/travel-types";
import { EmployeeService } from "@/lib/data/employee-service";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { CheckCircle, Paperclip, XCircle } from "lucide-react";

export const Route = createFileRoute("/staff/travel-hr-approvals")({
  component: HrTravelApprovalsRoute,
});

function HrTravelApprovalsRoute() {
  return (
    <RequirePermission permission="travel:hr_review" resourceName="HR Travel Approvals">
      <HrTravelApprovalsContent />
    </RequirePermission>
  );
}

function HrTravelApprovalsContent() {
  const currentUser = useCurrentUser();
  const travelService = useMemo(() => new TravelService(), []);
  const empService = useMemo(() => new EmployeeService(), []);

  const [requests, setRequests] = useState(
    travelService.getAllRequests(currentUser.getActorContext()),
  );
  const allEmployees = empService.getEmployees(currentUser.getActorContext());

  const [notes, setNotes] = useState("");
  const [selectedReq, setSelectedReq] = useState<TravelRequest | null>(null);
  const [actionType, setActionType] = useState<"approve" | "reject">("approve");

  const pendingHr = requests.filter(
    (r) => r.hrApprovalStatus === "Pending" && r.status === "Pending HR and Accounts",
  );
  const processed = requests.filter((r) => r.hrApprovalStatus !== "Pending");

  const handleOpenAction = (req: TravelRequest, type: "approve" | "reject") => {
    setSelectedReq(req);
    setActionType(type);
    setNotes("");
  };

  const viewEvidence = async (requestId: string) => {
    try {
      const { blob } = await travelService.getEvidenceBlob(
        requestId,
        currentUser.getActorContext(),
      );
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to open evidence");
    }
  };

  const handleFinalise = () => {
    if (!selectedReq) return;
    try {
      travelService.hrApprove(
        selectedReq.id,
        actionType === "approve",
        notes,
        currentUser.getActorContext(),
      );
      setRequests(travelService.getAllRequests(currentUser.getActorContext()));
      setSelectedReq(null);
      toast.success(`Travel request ${actionType === "approve" ? "approved" : "rejected"} by HR.`);
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "The travel decision could not be saved.",
      );
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-[1200px] mx-auto pb-10">
      <PageHeader
        title="HR Travel Approvals"
        description="Review travel requests for policy compliance, dates, and employee readiness."
      />

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">Action Required ({pendingHr.length})</TabsTrigger>
          <TabsTrigger value="processed">Processed ({processed.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead>Purpose</TableHead>
                    <TableHead>Accounts Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingHr.map((r) => {
                    const emp = allEmployees.find((e) => e.id === r.employeeId);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{emp?.preferredName}</TableCell>
                        <TableCell>{r.destination}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {r.startDate} to {r.endDate}
                        </TableCell>
                        <TableCell className="max-w-[250px] truncate text-sm" title={r.purpose}>
                          {r.purpose}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{r.accountsApprovalStatus}</Badge>
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {r.evidenceFileId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void viewEvidence(r.id)}
                            >
                              <Paperclip className="w-4 h-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenAction(r, "reject")}
                            className="text-destructive"
                          >
                            <XCircle className="w-4 h-4 mr-1" /> Reject
                          </Button>
                          <Button size="sm" onClick={() => handleOpenAction(r, "approve")}>
                            <CheckCircle className="w-4 h-4 mr-1" /> Approve Dates
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {pendingHr.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        No pending HR travel reviews.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="processed">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead>HR Decision</TableHead>
                    <TableHead>Overall Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {processed.map((r) => {
                    const emp = allEmployees.find((e) => e.id === r.employeeId);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{emp?.preferredName}</TableCell>
                        <TableCell>{r.destination}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {r.startDate} to {r.endDate}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={r.hrApprovalStatus === "Approved" ? "default" : "destructive"}
                          >
                            {r.hrApprovalStatus}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{r.status}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {processed.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        No processed requests.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!selectedReq} onOpenChange={(o) => !o && setSelectedReq(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionType === "approve" ? "Approve Travel Policy" : "Reject Travel Policy"}
            </DialogTitle>
            <DialogDescription>
              {actionType === "approve"
                ? "Approving signifies the travel dates and business purpose align with company policy."
                : "Rejecting this request will immediately end the workflow for this trip. Please provide a reason."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-2 bg-muted/30 p-3 rounded-md">
              <div>
                <span className="text-muted-foreground">Destination:</span>{" "}
                {selectedReq?.destination}
              </div>
              <div>
                <span className="text-muted-foreground">Dates:</span> {selectedReq?.startDate} to{" "}
                {selectedReq?.endDate}
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">Purpose:</span> {selectedReq?.purpose}
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">Notes:</span> {selectedReq?.notes || "None"}
              </div>
            </div>
            <div className="space-y-2">
              <label className="font-medium">
                HR Review Notes{" "}
                {actionType === "reject" && <span className="text-destructive">*</span>}
              </label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Required for rejection..."
              />
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setSelectedReq(null)}>
              Cancel
            </Button>
            <Button
              variant={actionType === "approve" ? "default" : "destructive"}
              onClick={handleFinalise}
              disabled={actionType === "reject" && notes.trim().length < 3}
            >
              {actionType === "approve" ? "Confirm HR Approval" : "Confirm Rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
