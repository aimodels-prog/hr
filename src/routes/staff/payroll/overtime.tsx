import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
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
import { OvertimeService } from "@/lib/data/overtime-service";
import { EmployeeService } from "@/lib/data/employee-service";
import { RequireAnyPermission, useCurrentUser } from "@/lib/auth";

export const Route = createFileRoute("/staff/payroll/overtime")({
  component: PayrollOvertimeRoute,
});

function PayrollOvertimeRoute() {
  const currentUser = useCurrentUser();
  const otService = useMemo(() => new OvertimeService(), []);
  const empService = useMemo(() => new EmployeeService(), []);

  const claims = otService.getAllClaims(currentUser.getActorContext());
  const allEmployees = empService.getDirectoryEmployees(currentUser.getActorContext());
  const approved = claims.filter((c) => c.status === "Approved");

  return (
    <RequireAnyPermission
      permissions={["payroll:view", "overtime:admin_all"]}
      resourceName="Payroll Overtime Ledger"
    >
      <div className="flex flex-col gap-6 max-w-[1200px] mx-auto pb-10">
        <PageHeader
          title="Overtime Payroll Ledger"
          description="Approved overtime claims ready for payroll extraction. HR verification happens on the Overtime Approvals page."
        />

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {approved.map((c) => {
                  const emp = allEmployees.find((e) => e.id === c.employeeId);
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{emp?.preferredName}</TableCell>
                      <TableCell>{c.date}</TableCell>
                      <TableCell className="font-bold text-emerald-600">{c.hours}h</TableCell>
                      <TableCell className="text-muted-foreground">{c.projectId || "-"}</TableCell>
                      <TableCell className="max-w-[300px] truncate text-sm" title={c.reason}>
                        {c.reason}
                      </TableCell>
                      <TableCell>
                        <Badge>Ready for Payroll</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {approved.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      No approved claims ready for payroll.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </RequireAnyPermission>
  );
}
