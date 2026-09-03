import { createFileRoute } from "@tanstack/react-router";
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
import { getMasterDataRepository, getProjectRepository } from "@/lib/data/master-data";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { CheckCircle, Paperclip, XCircle } from "lucide-react";

export const Route = createFileRoute("/staff/travel-accounts-approvals")({
  component: AccountsTravelApprovalsRoute,
});

function AccountsTravelApprovalsRoute() {
  return (
    <RequirePermission permission="travel:finance_review" resourceName="Accounts Travel Approvals">
      <AccountsTravelApprovalsContent />
    </RequirePermission>
  );
}

function AccountsTravelApprovalsContent() {
  const currentUser = useCurrentUser();
  const travelService = useMemo(() => new TravelService(), []);
  const empService = useMemo(() => new EmployeeService(), []);

  const [requests, setRequests] = useState(
    travelService.getAllRequests(currentUser.getActorContext()),
  );
  useEffect(() => {
    void travelService
      .getRequestsAsync(currentUser.getActorContext())
      .then(setRequests)
      .catch((error) =>
        toast.error(
          error instanceof Error ? error.message : "Travel requests could not be loaded.",
        ),
      );
  }, [currentUser, travelService]);
  const allEmployees = empService.getDirectoryEmployees(currentUser.getActorContext());

  const [notes, setNotes] = useState("");
  const [selectedReq, setSelectedReq] = useState<TravelRequest | null>(null);
  const [actionType, setActionType] = useState<"approve" | "reject">("approve");

  const pendingAccounts = requests.filter(
    (r) => r.accountsApprovalStatus === "Pending" && r.status === "Pending HR and Accounts",
  );
  const processed = requests.filter((r) => r.accountsApprovalStatus !== "Pending");

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

  const handleFinalise = async () => {
    if (!selectedReq) return;
    try {
      await travelService.accountsApproveAsync(
        selectedReq.id,
        actionType === "approve",
        notes,
        currentUser.getActorContext(),
      );
      setRequests(travelService.getAllRequests(currentUser.getActorContext()));
      setSelectedReq(null);
      toast.success(
        `Travel budget ${actionType === "approve" ? "approved" : "rejected"} by Accounts.`,
      );
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "The travel decision could not be saved.",
      );
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-[1200px] mx-auto pb-10">
      <PageHeader
        title="Accounts Travel Approvals"
        description="Review estimated travel costs against department budgets and cost centre limits."
      />

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">
            Budget Action Required ({pendingAccounts.length})
          </TabsTrigger>
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
                    <TableHead>Cost Centre / Project</TableHead>
                    <TableHead>Total Estimate</TableHead>
                    <TableHead>HR Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingAccounts.map((r) => {
                    const emp = allEmployees.find((e) => e.id === r.employeeId);
                    const cc = r.costCentreId
                      ? getMasterDataRepository("costCentres").getById(r.costCentreId)
                      : null;
                    const proj = r.projectId ? getProjectRepository().getById(r.projectId) : null;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{emp?.preferredName}</TableCell>
                        <TableCell>{r.destination}</TableCell>
                        <TableCell>
                          <div className="flex flex-col text-sm">
                            <span>{cc ? cc.name : "Default"}</span>
                            {proj && <span className="text-muted-foreground">{proj.name}</span>}
                          </div>
                        </TableCell>
                        <TableCell className="font-bold">
                          {r.totalEstimate.toLocaleString()} {r.currency}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{r.hrApprovalStatus}</Badge>
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
                            <CheckCircle className="w-4 h-4 mr-1" /> Approve Budget
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {pendingAccounts.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        No pending budget reviews.
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
                    <TableHead>Total Estimate</TableHead>
                    <TableHead>Accounts Decision</TableHead>
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
                        <TableCell className="font-medium">
                          {r.totalEstimate.toLocaleString()} {r.currency}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              r.accountsApprovalStatus === "Approved" ? "default" : "destructive"
                            }
                          >
                            {r.accountsApprovalStatus}
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
              {actionType === "approve" ? "Approve Budget Estimate" : "Reject Budget Estimate"}
            </DialogTitle>
            <DialogDescription>
              {actionType === "approve"
                ? "Approving signifies the estimated costs are within department budget limits."
                : "Rejecting this request will immediately end the workflow for this trip. Please provide a reason."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-x-2 gap-y-4 bg-muted/30 p-3 rounded-md">
              <div className="col-span-2 text-lg font-bold pb-2 border-b">
                Total Estimate: {selectedReq?.totalEstimate.toLocaleString()}{" "}
                {selectedReq?.currency}
              </div>
              <div>
                <span className="text-muted-foreground">Transport:</span>{" "}
                {selectedReq?.estTransport.toLocaleString()}
              </div>
              <div>
                <span className="text-muted-foreground">Accommodation:</span>{" "}
                {selectedReq?.estAccommodation.toLocaleString()}
              </div>
              <div>
                <span className="text-muted-foreground">Per Diem:</span>{" "}
                {selectedReq?.estPerDiem.toLocaleString()}
              </div>
              <div>
                <span className="text-muted-foreground">Other Costs:</span>{" "}
                {selectedReq?.estOther.toLocaleString()}
              </div>
            </div>
            <div className="space-y-2">
              <label className="font-medium">
                Accounts Review Notes{" "}
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
              onClick={() => void handleFinalise()}
              disabled={actionType === "reject" && notes.trim().length < 3}
            >
              {actionType === "approve" ? "Confirm Budget Approval" : "Confirm Rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
