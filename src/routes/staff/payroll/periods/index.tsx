import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { PayrollService } from "@/lib/data/payroll-service";
import { FileText, Plus } from "lucide-react";
import { startOfMonth, endOfMonth, addMonths, format } from "date-fns";

export const Route = createFileRoute("/staff/payroll/periods/")({
  component: PayrollPeriodsIndexRoute,
});

function PayrollPeriodsIndexRoute() {
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const payrollService = useMemo(() => new PayrollService(), []);
  
  const [periods, setPeriods] = useState(payrollService.getAllPeriods());
  const [showCreate, setShowCreate] = useState(false);
  const [newPeriod, setNewPeriod] = useState({
    name: format(new Date(), "MMMM yyyy"),
    startDate: format(startOfMonth(new Date()), "yyyy-MM-dd"),
    endDate: format(endOfMonth(new Date()), "yyyy-MM-dd"),
    cutoffDate: format(endOfMonth(new Date()), "yyyy-MM-dd"),
    paymentDate: format(endOfMonth(new Date()), "yyyy-MM-dd"),
    notes: ""
  });

  const handleCreate = () => {
    try {
      payrollService.createPeriod(newPeriod, { actor: { userId: currentUser!.userId, displayName: currentUser!.displayName, roles: currentUser!.roles } });
      setPeriods(payrollService.getAllPeriods());
      setShowCreate(false);
    } catch (e: any) {
      alert(e.message);
    }
  };

  return (
    <RequirePermission permission="payroll:view" resourceName="Payroll Periods">
      <div className="flex flex-col gap-6 max-w-[1200px] mx-auto pb-10">
        <PageHeader 
          title="Payroll Periods" 
          description="Manage payroll input collection periods, review exceptions, and lock for export."
          actions={<Button onClick={() => setShowCreate(true)}><Plus className="w-4 h-4 mr-2" /> New Period</Button>}
        />

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Period Name</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Payment Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.startDate} to {p.endDate}</TableCell>
                    <TableCell>{p.paymentDate}</TableCell>
                    <TableCell>
                      <Badge variant={p.status === "Locked" || p.status === "Exported" ? "default" : p.status === "Exceptions" ? "destructive" : "secondary"}>
                        {p.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => navigate({ to: `/staff/payroll/periods/${p.id}` })}>
                        <FileText className="w-4 h-4 mr-2"/> Open Workbench
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {periods.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No payroll periods found.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Payroll Period</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-sm mt-4">
              <div className="space-y-1">
                <label className="font-medium">Period Name</label>
                <Input value={newPeriod.name} onChange={e => setNewPeriod({...newPeriod, name: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="font-medium">Start Date</label>
                  <Input type="date" value={newPeriod.startDate} onChange={e => setNewPeriod({...newPeriod, startDate: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="font-medium">End Date</label>
                  <Input type="date" value={newPeriod.endDate} onChange={e => setNewPeriod({...newPeriod, endDate: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="font-medium">Cutoff Date</label>
                  <Input type="date" value={newPeriod.cutoffDate} onChange={e => setNewPeriod({...newPeriod, cutoffDate: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="font-medium">Payment Date</label>
                  <Input type="date" value={newPeriod.paymentDate} onChange={e => setNewPeriod({...newPeriod, paymentDate: e.target.value})} />
                </div>
              </div>
            </div>
            <DialogFooter className="mt-6">
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button onClick={handleCreate}>Create Period</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </RequirePermission>
  );
}
