import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PerformanceService } from "@/lib/data/performance-service";
import { EmployeeService } from "@/lib/data/employee-service";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/staff/performance/team")({
  component: TeamPerformanceRoute,
});

function TeamPerformanceRoute() {
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const [perfService] = useState(() => new PerformanceService());
  const [empService] = useState(() => new EmployeeService());

  const reviews = perfService.getReviewsForManager(currentUser!.employeeId ?? "");
  const cycles = perfService.getCycles();
  const employees = empService.getEmployees();

  return (
    <RequirePermission permission="timesheet:view_self" resourceName="Team Performance">
      <div className="flex flex-col gap-6 max-w-[1000px] mx-auto pb-10">
        <PageHeader 
          title="Team Performance Reviews" 
          description="Evaluate and discuss performance reviews with your direct reports."
        />

        <Card>
          <CardContent className="pt-6">
             <Table>
               <TableHeader>
                 <TableRow>
                   <TableHead>Employee</TableHead>
                   <TableHead>Review Cycle</TableHead>
                   <TableHead>Status</TableHead>
                   <TableHead>Manager Review Due</TableHead>
                   <TableHead></TableHead>
                 </TableRow>
               </TableHeader>
               <TableBody>
                 {reviews.map(r => {
                    const cycle = cycles.find(c => c.id === r.cycleId);
                    const emp = employees.find(e => e.id === r.employeeId);
                    if (!cycle || !emp) return null;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{emp.legalName}</TableCell>
                        <TableCell>{cycle.name}</TableCell>
                        <TableCell>
                           <Badge variant="outline" className={r.status === "Manager Review Pending" ? "border-amber-200 text-amber-700 bg-amber-50" : ""}>
                             {r.status}
                           </Badge>
                        </TableCell>
                        <TableCell>{cycle.managerReviewDeadline}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => navigate({ to: `/staff/performance/reviews/${r.id}` })}>
                             Open <ArrowRight className="w-4 h-4 ml-2" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                 })}
                 {reviews.length === 0 && (
                   <TableRow>
                     <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No performance reviews found for your team.</TableCell>
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
