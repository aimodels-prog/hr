import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { PayrollService } from "@/lib/data/payroll-service";
import type { PayrollException, PayrollManualAdjustment } from "@/lib/data/payroll-types";
import { EmployeeService } from "@/lib/data/employee-service";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import {
  ArrowLeft,
  Download,
  Lock,
  Play,
  AlertTriangle,
  CheckCircle,
  Plus,
  FileText,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { AuditViewer } from "@/components/audit-viewer";

type ManualAdjustmentDraft = Pick<
  PayrollManualAdjustment,
  "employeeId" | "type" | "amount" | "currency" | "reason"
>;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export const Route = createFileRoute("/staff/payroll/periods/$periodId")({
  component: PayrollWorkbenchRoute,
});

function PayrollWorkbenchRoute() {
  return (
    <RequirePermission permission="payroll:view" resourceName="Payroll Workbench">
      <PayrollWorkbenchContent />
    </RequirePermission>
  );
}

function PayrollWorkbenchContent() {
  const { periodId } = Route.useParams();
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const payrollService = useMemo(() => new PayrollService(), []);
  const actorContext = currentUser.getActorContext();
  const empService = useMemo(() => new EmployeeService(), []);
  const allEmployees = useMemo(
    () => empService.getDirectoryEmployees(currentUser.getActorContext()),
    [currentUser, empService],
  );

  const [period, setPeriod] = useState(() => payrollService.getPeriodById(periodId, actorContext));
  useEffect(() => {
    void payrollService
      .getPeriodByIdAsync(periodId, actorContext)
      .then(setPeriod)
      .catch((error) => toast.error(getErrorMessage(error)));
    // The preview identity remounts this route when its actor changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodId, payrollService]);

  const [activeTab, setActiveTab] = useState("aggregation");
  const [showAckDialog, setShowAckDialog] = useState<PayrollException | null>(null);
  const [ackNotes, setAckNotes] = useState("");

  const [showManualDialog, setShowManualDialog] = useState(false);
  const [showReopenDialog, setShowReopenDialog] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [manualEvidence, setManualEvidence] = useState<File | null>(null);
  const [manualAdj, setManualAdj] = useState<ManualAdjustmentDraft>({
    employeeId: "",
    type: "Allowance",
    amount: 0,
    currency: "",
    reason: "",
  });

  // The compiled row for an employee is otherwise entirely in their real salary currency, so the
  // adjustment currency must follow the selected employee rather than a hardcoded default - it is not
  // independently editable, only shown for visibility.
  const handleManualEmployeeChange = (employeeId: string) => {
    const emp = allEmployees.find((e) => e.id === employeeId);
    setManualAdj({ ...manualAdj, employeeId, currency: emp?.salary?.currency || "OMR" });
  };

  if (!period) return <div className="p-8">Period not found.</div>;

  const handleCollect = async () => {
    try {
      const updated = await payrollService.collectInputsAsync(period.id, actorContext);
      if (!updated) throw new Error("Payroll period could not be reloaded.");
      setPeriod(updated);
      toast.success("Inputs collected and exceptions refreshed.");
      if (updated.status === "Exceptions") {
        setActiveTab("exceptions");
        toast.warning("Exceptions detected requiring attention.");
      }
    } catch (error: unknown) {
      toast.error(getErrorMessage(error));
    }
  };

  const handleAcknowledge = async () => {
    if (!showAckDialog) return;
    try {
      const updated = await payrollService.acknowledgeExceptionAsync(
        period.id,
        showAckDialog.id,
        ackNotes,
        actorContext,
      );
      if (!updated) throw new Error("Payroll period could not be reloaded.");
      setPeriod(updated);
      setShowAckDialog(null);
      toast.success("Exception acknowledged.");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error));
    }
  };

  const handleAddManual = async () => {
    try {
      if (
        !manualAdj.employeeId ||
        !manualAdj.reason ||
        manualAdj.amount <= 0 ||
        !manualAdj.currency ||
        !manualEvidence
      ) {
        toast.error("Please fill all required fields correctly.");
        return;
      }
      const updated = await payrollService.addManualAdjustmentAsync(
        period.id,
        manualAdj,
        actorContext,
        manualEvidence,
      );
      if (!updated) throw new Error("Payroll period could not be reloaded.");
      setPeriod(updated);
      setShowManualDialog(false);
      setManualAdj({ employeeId: "", type: "Allowance", amount: 0, currency: "", reason: "" });
      setManualEvidence(null);
      toast.success(
        "Payroll correction added. Collect the payroll information again to include it.",
      );
    } catch (error: unknown) {
      toast.error(getErrorMessage(error));
    }
  };

  const handleViewEvidence = async (adjustmentId: string) => {
    try {
      const file = await payrollService.readManualAdjustmentEvidenceAsync(
        adjustmentId,
        actorContext,
      );
      const url = URL.createObjectURL(file.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success("Supporting evidence downloaded.");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error));
    }
  };

  const handleLock = async () => {
    try {
      const updated = await payrollService.lockPeriodAsync(period.id, actorContext);
      if (!updated) throw new Error("Payroll period could not be reloaded.");
      setPeriod(updated);
      toast.success("Payroll period locked");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error));
    }
  };

  const handleApprove = async () => {
    try {
      const updated = await payrollService.approvePeriodAsync(period.id, actorContext);
      if (!updated) throw new Error("Payroll period could not be reloaded.");
      setPeriod(updated);
      toast.success("Payroll input approved.");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error));
    }
  };

  const handleExport = async () => {
    try {
      const csv = await payrollService.exportCsvAsync(period.id, actorContext);
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payroll_input_${period.name.replace(/\s+/g, "_")}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setPeriod(await payrollService.getPeriodByIdAsync(period.id, actorContext));
      toast.success("Export successful.");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error));
    }
  };

  const handleReopen = async () => {
    try {
      const updated = await payrollService.reopenPeriodAsync(period.id, reopenReason, actorContext);
      if (!updated) throw new Error("Payroll period could not be reloaded.");
      setPeriod(updated);
      setShowReopenDialog(false);
      setReopenReason("");
      toast.success("Payroll reopened for a controlled correction.");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error));
    }
  };

  const isEditable =
    period.status === "Draft" ||
    period.status === "Collecting Inputs" ||
    period.status === "Exceptions" ||
    period.status === "Corrected";

  return (
    <div className="flex flex-col gap-6 max-w-[1200px] mx-auto pb-10">
      <div className="flex items-center gap-2 mb-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: "/staff/payroll/periods" })}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Periods
        </Button>
      </div>

      <PageHeader
        title={`Workbench: ${period.name}`}
        description={`Dates: ${period.startDate} to ${period.endDate} | Cutoff: ${period.cutoffDate}`}
        actions={
          <div className="flex gap-2 items-center">
            <Badge
              className="text-sm px-3 py-1 mr-4"
              variant={
                period.status === "Locked" || period.status === "Exported"
                  ? "default"
                  : period.status === "Exceptions"
                    ? "destructive"
                    : "secondary"
              }
            >
              {period.status}
            </Badge>

            {isEditable && (
              <Button onClick={() => void handleCollect()} variant="outline">
                <Play className="w-4 h-4 mr-2" /> Collect Inputs
              </Button>
            )}
            {period.status === "Prepared" && currentUser.activeRole === "Super Admin" && (
              <Button onClick={() => void handleApprove()}>
                <CheckCircle className="w-4 h-4 mr-2" /> Approve Payroll
              </Button>
            )}
            {period.status === "Approved" && (
              <Button onClick={() => void handleLock()}>
                <Lock className="w-4 h-4 mr-2" /> Lock Period
              </Button>
            )}
            {(period.status === "Locked" || period.status === "Exported") && (
              <>
                {currentUser.activeRole === "Super Admin" && (
                  <Button variant="outline" onClick={() => setShowReopenDialog(true)}>
                    Reopen for Correction
                  </Button>
                )}
                <Button onClick={() => void handleExport()}>
                  <Download className="w-4 h-4 mr-2" /> Export CSV
                </Button>
              </>
            )}
          </div>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="aggregation">Compiled Inputs</TabsTrigger>
          <TabsTrigger value="manual">
            Manual Adjustments ({period.manualAdjustments.length})
          </TabsTrigger>
          <TabsTrigger value="exceptions">
            Exceptions
            {period.exceptions.filter((e) => !e.acknowledged).length > 0 && (
              <Badge
                variant="destructive"
                className="ml-2 h-5 w-5 p-0 flex items-center justify-center rounded-full"
              >
                {period.exceptions.filter((e) => !e.acknowledged).length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="aggregation">
          <Card>
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base">Payroll Input Aggregation</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-3 font-medium">Employee</th>
                    <th className="text-right p-3 font-medium">Approved Overtime (Hrs)</th>
                    <th className="text-right p-3 font-medium">Unpaid Leave (Days)</th>
                    <th className="text-right p-3 font-medium">Travel Reimbursements</th>
                    <th className="text-right p-3 font-medium">Manual Adj.</th>
                    <th className="text-right p-3 font-medium">Currencies</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {period.compiledInputs?.map((row, idx) => {
                    const emp = allEmployees.find((e) => e.id === row.employeeId);
                    return (
                      <tr key={idx} className="hover:bg-muted/10">
                        <td className="p-3 font-medium">
                          {emp?.preferredName}{" "}
                          <span className="text-muted-foreground text-xs block">{emp?.id}</span>
                        </td>
                        <td className="p-3 text-right">
                          {row.approvedOvertimeHours > 0 ? (
                            <Badge variant="secondary">{row.approvedOvertimeHours}</Badge>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="p-3 text-right">
                          {row.unpaidLeaveDays > 0 ? (
                            <Badge variant="outline">{row.unpaidLeaveDays}</Badge>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="p-3 text-right">
                          {row.reimbursementsTotal > 0
                            ? `${row.reimbursementsTotal.toLocaleString()} ${row.reimbursementsCurrency || "OMR"}`
                            : "-"}
                        </td>
                        <td className="p-3 text-right">
                          {row.manualAdjustmentsTotal !== 0
                            ? row.manualAdjustmentsTotal.toLocaleString()
                            : "-"}
                        </td>
                        <td className="p-3 text-right text-muted-foreground">
                          Adjustments: {row.currency}
                        </td>
                      </tr>
                    );
                  })}
                  {(!period.compiledInputs || period.compiledInputs.length === 0) && (
                    <tr>
                      <td colSpan={6} className="text-center p-8 text-muted-foreground">
                        No inputs compiled yet. Click 'Collect Inputs' to aggregate data from
                        modules.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="manual">
          <Card>
            <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
              <CardTitle className="text-base">Manual Allowances & Deductions</CardTitle>
              {isEditable && (
                <Button size="sm" onClick={() => setShowManualDialog(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Add
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-3 font-medium">Employee</th>
                    <th className="text-left p-3 font-medium">Type</th>
                    <th className="text-left p-3 font-medium">Reason</th>
                    <th className="text-right p-3 font-medium">Amount</th>
                    <th className="text-right p-3 font-medium">Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {period.manualAdjustments.map((adj) => {
                    const emp = allEmployees.find((e) => e.id === adj.employeeId);
                    return (
                      <tr key={adj.id}>
                        <td className="p-3">{emp?.preferredName}</td>
                        <td className="p-3">
                          <Badge variant="outline">{adj.type}</Badge>
                        </td>
                        <td className="p-3 text-muted-foreground">{adj.reason}</td>
                        <td
                          className={`p-3 text-right font-medium ${adj.type === "Deduction" ? "text-destructive" : "text-emerald-600"}`}
                        >
                          {adj.type === "Deduction" ? "-" : "+"}
                          {adj.amount.toLocaleString()} {adj.currency}
                        </td>
                        <td className="p-3 text-right">
                          {adj.evidenceFileId ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void handleViewEvidence(adj.id)}
                            >
                              <FileText className="mr-1 h-4 w-4" /> View
                            </Button>
                          ) : (
                            <span className="text-muted-foreground">Unavailable</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {period.manualAdjustments.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center p-8 text-muted-foreground">
                        No manual adjustments.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="exceptions">
          <div className="space-y-4">
            {period.exceptions.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  No exceptions detected.
                </CardContent>
              </Card>
            ) : (
              period.exceptions.map((ex) => {
                const emp = allEmployees.find((e) => e.id === ex.employeeId);
                return (
                  <Card
                    key={ex.id}
                    className={
                      !ex.acknowledged
                        ? "border-amber-200 bg-amber-50/50"
                        : "bg-muted/10 opacity-70"
                    }
                  >
                    <CardContent className="p-4 flex items-start justify-between">
                      <div className="flex gap-4">
                        <div className="mt-1">
                          {!ex.acknowledged ? (
                            <AlertTriangle className="w-5 h-5 text-amber-500" />
                          ) : (
                            <CheckCircle className="w-5 h-5 text-muted-foreground" />
                          )}
                        </div>
                        <div>
                          <div className="font-medium">{ex.type}</div>
                          <div className="text-sm text-muted-foreground mb-1">
                            Employee: {emp?.preferredName}
                          </div>
                          <p className="text-sm">{ex.description}</p>
                          {ex.acknowledged && ex.acknowledgementNotes && (
                            <div className="mt-2 text-xs bg-white p-2 rounded border">
                              Admin note: {ex.acknowledgementNotes}
                            </div>
                          )}
                        </div>
                      </div>
                      <div>
                        {!ex.acknowledged && isEditable && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="bg-white"
                            onClick={() => {
                              setAckNotes("");
                              setShowAckDialog(ex);
                            }}
                          >
                            Acknowledge
                          </Button>
                        )}
                        {ex.acknowledged && <Badge variant="secondary">Acknowledged</Badge>}
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Acknowledge Dialog */}
      <Dialog open={!!showAckDialog} onOpenChange={(o) => !o && setShowAckDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Acknowledge Exception</DialogTitle>
            <DialogDescription>
              By acknowledging this exception, you certify that it has been reviewed and requires no
              further system changes for this period.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 mt-2">
            <label className="text-sm font-medium">Resolution Notes / Explanation</label>
            <Textarea
              value={ackNotes}
              onChange={(e) => setAckNotes(e.target.value)}
              placeholder="e.g. Discussed with manager, approved to proceed..."
            />
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setShowAckDialog(null)}>
              Cancel
            </Button>
            <Button onClick={() => void handleAcknowledge()} disabled={ackNotes.trim().length < 5}>
              Confirm Acknowledgment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual Adj Dialog */}
      <Dialog open={showManualDialog} onOpenChange={setShowManualDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Manual Adjustment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Employee</label>
              <Select value={manualAdj.employeeId} onValueChange={handleManualEmployeeChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {allEmployees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.preferredName} ({e.id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Type</label>
                <Select
                  value={manualAdj.type}
                  onValueChange={(value) =>
                    setManualAdj({
                      ...manualAdj,
                      type: value as ManualAdjustmentDraft["type"],
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Allowance">Allowance</SelectItem>
                    <SelectItem value="Deduction">Deduction</SelectItem>
                    <SelectItem value="Correction">Correction</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Amount</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={manualAdj.amount || ""}
                  onChange={(e) =>
                    setManualAdj({ ...manualAdj, amount: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Currency</label>
              <Input
                value={manualAdj.currency}
                readOnly
                disabled
                placeholder="Select an employee first"
              />
              <p className="text-xs text-muted-foreground">
                Follows the employee's actual salary currency and cannot be edited.
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Reason</label>
              <Input
                value={manualAdj.reason}
                onChange={(e) => setManualAdj({ ...manualAdj, reason: e.target.value })}
                placeholder="e.g. Sign-on bonus, hardware deduction..."
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="payroll-adjustment-evidence">
                Supporting evidence
              </label>
              <Input
                id="payroll-adjustment-evidence"
                type="file"
                accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                onChange={(event) => setManualEvidence(event.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">PDF, JPG or PNG, up to 10 MB.</p>
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setShowManualDialog(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleAddManual()} disabled={!manualEvidence}>
              Add Adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showReopenDialog} onOpenChange={setShowReopenDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reopen payroll for correction</DialogTitle>
            <DialogDescription>
              This unlocks the workbench and records why the completed payroll changed.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reopenReason}
            onChange={(event) => setReopenReason(event.target.value)}
            placeholder="Explain the correction required"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReopenDialog(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleReopen()} disabled={reopenReason.trim().length < 5}>
              Reopen Payroll
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mt-8 min-h-[400px]">
        <AuditViewer entityId={period.id} entityType="payrollPeriod" />
      </div>
    </div>
  );
}
