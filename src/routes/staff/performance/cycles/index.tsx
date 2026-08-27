import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PerformanceService } from "@/lib/data/performance-service";
import { RequirePermission } from "@/lib/auth";
import { format } from "date-fns";
import { Plus, ArrowRight, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/staff/performance/cycles/")({
  component: PerformanceCyclesRoute,
});

function PerformanceCyclesRoute() {
  const [perfService] = useState(() => new PerformanceService());
  const navigate = useNavigate();

  const cycles = perfService.getCycles();
  const templates = perfService.getTemplates();

  return (
    <RequirePermission permission="system:settings_manage" resourceName="Performance Cycles">
      <div className="flex flex-col gap-6 max-w-[1200px] mx-auto pb-10">
        <PageHeader 
          title="Performance Cycles" 
          description="Manage review cycles and monitor organization-wide completion."
          actions={
            <Button onClick={() => navigate({ to: "/staff/performance/cycles/new" })}>
              <Plus className="w-4 h-4 mr-2" /> Launch New Cycle
            </Button>
          }
        />

        <Card>
          <CardHeader>
            <CardTitle>All Cycles</CardTitle>
          </CardHeader>
          <CardContent>
             <Table>
               <TableHeader>
                 <TableRow>
                   <TableHead>Cycle Name</TableHead>
                   <TableHead>Template</TableHead>
                   <TableHead>Status</TableHead>
                   <TableHead>Population</TableHead>
                   <TableHead>Deadlines</TableHead>
                 </TableRow>
               </TableHeader>
               <TableBody>
                 {cycles.map(c => {
                    const tmpl = templates.find(t => t.id === c.templateId);
                    
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell>{tmpl?.name || "Unknown Template"}</TableCell>
                        <TableCell>
                           <Badge variant={c.status === "Active" ? "default" : c.status === "Completed" ? "secondary" : "outline"} className={c.status === "Active" ? "bg-emerald-500 hover:bg-emerald-600" : ""}>
                             {c.status}
                           </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                           Depts: {c.departments.length > 0 ? c.departments.join(", ") : "All"}<br/>
                           Types: {c.employmentTypes.length > 0 ? c.employmentTypes.join(", ") : "All"}
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="grid grid-cols-[auto_1fr] gap-x-2">
                             <span className="text-muted-foreground text-right">Self:</span> <span>{c.selfAssessmentDeadline}</span>
                             <span className="text-muted-foreground text-right">Manager:</span> <span>{c.managerReviewDeadline}</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                 })}
                 {cycles.length === 0 && (
                   <TableRow>
                     <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No review cycles created yet.</TableCell>
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
