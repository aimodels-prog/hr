import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
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
import { EmployeeService } from "@/lib/data/employee-service";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { ArrowLeft, Download, Lock, Play, AlertTriangle, CheckCircle, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { AuditViewer } from "@/components/audit-viewer";

export const Route = createFileRoute("/staff/payroll/periods/$periodId")({
  component: PayrollWorkbenchRoute,
});

function PayrollWorkbenchRoute() {
  const { periodId } = Route.useParams();
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const payrollService = useMemo(() => new PayrollService(), []);
  const empService = useMemo(() => new EmployeeService(), []);
  const allEmployees = useMemo(() => empService.getEmployees(), [empService]);

  const [period, setPeriod] = useState(payrollService.getPeriodById(periodId));

  const [activeTab, setActiveTab] = useState("aggregation");
  const [showAckDialog, setShowAckDialog] = useState<any>(null);
  const [ackNotes, setAckNotes] = useState("");

  const [showManualDialog, setShowManualDialog] = useState(false);
  const [manualAdj, setManualAdj] = useState({
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

  const handleCollect = () => {
    try {
      const updated = payrollService.collectInputs(period.id, {
        actor: {
          userId: currentUser!.userId,
          displayName: currentUser!.displayName,
          roles: currentUser!.roles,
        },
      });
      setPeriod(updated);
      toast.success("Inputs collected and exceptions refreshed.");
      if (updated.status === "Exceptions") {
        setActiveTab("exceptions");
        toast.warning("Exceptions detected requiring attention.");
      }
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleAcknowledge = () => {
    if (!showAckDialog) return;
    try {
      const updated = payrollService.acknowledgeException(period.id, showAckDialog.id, ackNotes, {
        actor: {
          userId: currentUser!.userId,
          displayName: currentUser!.displayName,
          roles: currentUser!.roles,
        },
      });
      setPeriod(updated);
      setShowAckDialog(null);
      toast.success("Exception acknowledged.");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleAddManual = () => {
    try {
      if (
        !manualAdj.employeeId ||
        !manualAdj.reason ||
        manualAdj.amount <= 0 ||
        !manualAdj.currency
      ) {
        toast.error("Please fill all required fields correctly.");
        return;
      }
      const updated = payrollService.addManualAdjustment(period.id, manualAdj as any, {
        actor: {
          userId: currentUser!.userId,
          displayName: currentUser!.displayName,
          roles: currentUser!.roles,
        },
      });
      setPeriod(updated);
      setShowManualDialog(false);
      setManualAdj({ employeeId: "", type: "Allowance", amount: 0, currency: "", reason: "" });
      toast.success(
        "Payroll correction added. Collect the payroll information again to include it.",
      );
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleLock = () => {
    try {
      const updated = payrollService.lockPeriod(period.id, {
        actor: {
          userId: currentUser!.userId,
          displayName: currentUser!.displayName,
          roles: currentUser!.roles,
        },
      });
      setPeriod(updated);
      toast.success("Payroll period locked");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleExport = () => {
    try {
      const csv = payrollService.exportCsv(period.id, {
        actor: {
          userId: currentUser!.userId,
          displayName: currentUser!.displayName,
          roles: currentUser!.roles,
        },
      });
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payroll_input_${period.name.replace(/\s+/g, "_")}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setPeriod(payrollService.getPeriodById(period.id));
      toast.success("Export successful.");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const isEditable =
    period.status === "Draft" ||
    period.status === "Collecting Inputs" ||
    period.status === "Exceptions";

  return (
    <RequirePermission permission="payroll:view" resourceName="Payroll Workbench">
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
                <Button onClick={handleCollect} variant="outline">
                  <Play className="w-4 h-4 mr-2" /> Collect Inputs
                </Button>
              )}
              {period.status === "Prepared" && (
                <Button onClick={handleLock}>
                  <Lock className="w-4 h-4 mr-2" /> Lock Period
                </Button>
              )}
              {(period.status === "Locked" || period.status === "Exported") && (
                <Button onClick={handleExport}>
                  <Download className="w-4 h-4 mr-2" /> Export CSV
                </Button>
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
                      <th className="text-right p-3 font-medium">Currency</th>
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
                              ? row.reimbursementsTotal.toLocaleString()
                              : "-"}
                          </td>
                          <td className="p-3 text-right">
                            {row.manualAdjustmentsTotal !== 0
                              ? row.manualAdjustmentsTotal.toLocaleString()
                              : "-"}
                          </td>
                          <td className="p-3 text-right text-muted-foreground">{row.currency}</td>
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
                        </tr>
                      );
                    })}
                    {period.manualAdjustments.length === 0 && (
                      <tr>
                        <td colSpan={4} className="text-center p-8 text-muted-foreground">
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
                By acknowledging this exception, you certify that it has been reviewed and requires
                no further system changes for this period.
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
              <Button onClick={handleAcknowledge} disabled={ackNotes.trim().length < 2}>
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
                    onValueChange={(v) => setManualAdj({ ...manualAdj, type: v })}
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
            </div>
            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => setShowManualDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddManual}>Add Adjustment</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="mt-8 min-h-[400px]">
          <AuditViewer entityId={period.id} entityType="payrollPeriod" />
        </div>
      </div>
    </RequirePermission>
  );
}
