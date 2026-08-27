import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PerformanceService } from "@/lib/data/performance-service";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { format } from "date-fns";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/staff/me/performance")({
  component: MyPerformanceRoute,
});

function MyPerformanceRoute() {
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const [perfService] = useState(() => new PerformanceService());

  const reviews = perfService.getReviewsForEmployee(currentUser!.employeeId ?? "");
  const cycles = perfService.getCycles();

  return (
    <RequirePermission permission="timesheet:view_self" resourceName="My Performance">
      <div className="flex flex-col gap-6 max-w-[1000px] mx-auto pb-10">
        <PageHeader 
          title="My Performance Reviews" 
          description="Complete self-assessments and view manager feedback."
        />

        <Card>
          <CardContent className="pt-6">
             <Table>
               <TableHeader>
                 <TableRow>
                   <TableHead>Review Cycle</TableHead>
                   <TableHead>Status</TableHead>
                   <TableHead>Self Assessment Due</TableHead>
                   <TableHead></TableHead>
                 </TableRow>
               </TableHeader>
               <TableBody>
                 {reviews.map(r => {
                    const cycle = cycles.find(c => c.id === r.cycleId);
                    if (!cycle) return null;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{cycle.name}</TableCell>
                        <TableCell>
                           <Badge variant="outline">{r.status}</Badge>
                        </TableCell>
                        <TableCell>{cycle.selfAssessmentDeadline}</TableCell>
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
                     <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No performance reviews found.</TableCell>
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
