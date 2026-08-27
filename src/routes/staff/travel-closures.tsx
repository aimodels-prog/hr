import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { TravelService } from "@/lib/data/travel-service";
import { EmployeeService } from "@/lib/data/employee-service";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { CheckCircle, Paperclip, XCircle } from "lucide-react";

export const Route = createFileRoute("/staff/travel-closures")({
  component: TravelClosuresRoute,
});

function TravelClosuresRoute() {
  const currentUser = useCurrentUser();
  const travelService = useMemo(() => new TravelService(), []);
  const empService = useMemo(() => new EmployeeService(), []);
  
  const [requests, setRequests] = useState(travelService.getAllRequests(currentUser.getActorContext()));
  const allEmployees = empService.getEmployees();

  const [notes, setNotes] = useState("");
  const [selectedReq, setSelectedReq] = useState<any>(null);
  const [actionType, setActionType] = useState<"approve" | "reject">("approve");

  const pendingClosure = requests.filter(r => r.status === "Pending Super Admin Closure");
  const closed = requests.filter(r => r.status === "Closed");

  const handleOpenAction = (req: any, type: "approve" | "reject") => {
    setSelectedReq(req);
    setActionType(type);
    setNotes("");
  };

  const viewEvidence = async (requestId: string) => {
    try {
      const { blob } = await travelService.getEvidenceBlob(requestId, currentUser.getActorContext());
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to open evidence");
    }
  };

  const viewReceipt = async (requestId: string, lineId: string) => {
    try {
      const { blob } = await travelService.getReceiptBlob(requestId, lineId, currentUser.getActorContext());
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to open receipt");
    }
  };

  const handleFinalise = () => {
    if (!selectedReq) return;
    try {
      travelService.superAdminClose(
        selectedReq.id,
        actionType === "approve",
        notes,
        currentUser!.getActorContext(),
      );
      setRequests(travelService.getAllRequests(currentUser.getActorContext()));
      setSelectedReq(null);
      toast.success(`Reimbursement ${actionType === "approve" ? 'closed' : 'rejected'}.`);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <RequirePermission permission="travel:final_close" resourceName="Travel Closures">
      <div className="flex flex-col gap-6 max-w-[1200px] mx-auto pb-10">
        <PageHeader 
          title="Travel Reimbursement Closure" 
          description="Review post-trip actual expenses and variance explanations to authorise final reimbursement."
        />

        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">Action Required ({pendingClosure.length})</TabsTrigger>
            <TabsTrigger value="closed">Closed / Paid ({closed.length})</TabsTrigger>
          </TabsList>
          
          <TabsContent value="pending">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Destination</TableHead>
                      <TableHead>Estimate</TableHead>
                      <TableHead>Actual Claimed</TableHead>
                      <TableHead>Variance</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingClosure.map(r => {
                      const emp = allEmployees.find(e => e.id === r.employeeId);
                      const variance = ((r.actualTotal! - r.totalEstimate) / r.totalEstimate) * 100;
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">{emp?.preferredName}</TableCell>
                          <TableCell>{r.destination}</TableCell>
                          <TableCell className="text-muted-foreground">{r.totalEstimate.toLocaleString()} {r.currency}</TableCell>
                          <TableCell className="font-bold">{r.actualTotal?.toLocaleString()} {r.currency}</TableCell>
                          <TableCell>
                            {variance > 10 ? (
                               <Badge variant="destructive">+{variance.toFixed(1)}%</Badge>
                            ) : variance > 0 ? (
                               <Badge variant="secondary">+{variance.toFixed(1)}%</Badge>
                            ) : (
                               <Badge variant="outline" className="text-emerald-600 border-emerald-200">{variance.toFixed(1)}%</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            <Button variant="ghost" size="sm" onClick={() => handleOpenAction(r, "reject")} className="text-destructive">
                              <XCircle className="w-4 h-4 mr-1"/> Reject
                            </Button>
                            <Button size="sm" onClick={() => handleOpenAction(r, "approve")}>
                              <CheckCircle className="w-4 h-4 mr-1"/> Close
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {pendingClosure.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No pending reimbursements.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="closed">
             <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Destination</TableHead>
                      <TableHead>Reimbursed Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {closed.map(r => {
                      const emp = allEmployees.find(e => e.id === r.employeeId);
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">{emp?.preferredName}</TableCell>
                          <TableCell>{r.destination}</TableCell>
                          <TableCell className="font-bold text-emerald-600">{r.actualTotal?.toLocaleString()} {r.currency}</TableCell>
                          <TableCell>
                             <Badge variant="default">Closed</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {closed.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No closed requests.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={!!selectedReq} onOpenChange={(o) => !o && setSelectedReq(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{actionType === "approve" ? "Close Reimbursement" : "Reject Expenses"}</DialogTitle>
              <DialogDescription>
                {actionType === "approve" 
                  ? "Closing this request will lock the expenses and create a payroll input reference." 
                  : "Rejecting will return the request to the employee to correct their expenses. Provide a reason below."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-2 bg-muted/30 p-3 rounded-md">
                <div className="col-span-2 text-lg font-bold pb-2 border-b">
                   Actual Claimed: {selectedReq?.actualTotal?.toLocaleString()} {selectedReq?.currency} <span className="text-sm font-normal text-muted-foreground ml-2">(Estimate: {selectedReq?.totalEstimate.toLocaleString()})</span>
                </div>
                {selectedReq?.varianceExplanation && (
                  <div className="col-span-2 mt-2">
                    <span className="text-muted-foreground font-medium text-amber-700 block mb-1">Employee Variance Explanation:</span>
                    <div className="bg-white p-2 border border-amber-200 rounded">{selectedReq.varianceExplanation}</div>
                  </div>
                )}
              </div>
              
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left p-2">Category</th>
                      <th className="text-left p-2">Date</th>
                      <th className="text-left p-2">Amount</th>
                      <th className="text-left p-2">Reference</th>
                      <th className="text-left p-2">Receipt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {selectedReq?.expenses?.map((line: any) => (
                      <tr key={line.id}>
                        <td className="p-2">{line.category}</td>
                        <td className="p-2">{line.date}</td>
                        <td className="p-2">{line.amount}</td>
                        <td className="p-2 text-muted-foreground">{line.reference || "-"}</td>
                        <td className="p-2">
                          {line.receiptFileId ? (
                            <Button variant="ghost" size="sm" onClick={() => void viewReceipt(selectedReq.id, line.id)}>
                              <Paperclip className="w-3.5 h-3.5" />
                            </Button>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {selectedReq?.evidenceFileId && (
                <Button variant="outline" size="sm" onClick={() => void viewEvidence(selectedReq.id)}>
                  <Paperclip className="w-3.5 h-3.5 mr-1" /> View trip evidence
                </Button>
              )}
              
              <div className="space-y-2">
                <label className="font-medium">Admin Notes {actionType === "reject" && <span className="text-destructive">*</span>}</label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Required for rejection..." />
              </div>
            </div>
            <DialogFooter className="flex gap-2 mt-4">
              <Button variant="outline" onClick={() => setSelectedReq(null)}>Cancel</Button>
              <Button variant={actionType === "approve" ? "default" : "destructive"} onClick={handleFinalise} disabled={actionType === "reject" && notes.trim().length < 3}>
                {actionType === "approve" ? "Confirm Closure" : "Confirm Rejection"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </RequirePermission>
  );
}
