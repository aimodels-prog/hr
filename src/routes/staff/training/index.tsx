import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { TrainingService } from "@/lib/data/training-service";
import { EmployeeService } from "@/lib/data/employee-service";
import type { TrainingRecord } from "@/lib/data/training-types";
import { CheckCircle2, FileText, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/lib/auth";

export const Route = createFileRoute("/staff/training/")({
  component: StaffTrainingRoute,
});

function StaffTrainingRoute() {
  const currentUser = useCurrentUser();
  const [trainingService] = useState(() => new TrainingService());
  const [employeeService] = useState(() => new EmployeeService());
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [employees, setEmployees] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");

  useEffect(() => {
    const allRecords = trainingService.getRecords();
    // sort by latest completion date
    allRecords.sort(
      (a, b) => new Date(b.completionDate).getTime() - new Date(a.completionDate).getTime(),
    );
    setRecords(allRecords);

    const empMap: Record<string, string> = {};
    employeeService.getEmployees(currentUser.getActorContext()).forEach((e) => {
      empMap[e.id] = e.preferredName || e.legalName;
    });
    setEmployees(empMap);
  }, [currentUser, trainingService, employeeService]);

  const filteredRecords = records.filter(
    (r) =>
      r.title.toLowerCase().includes(search.toLowerCase()) ||
      (employees[r.employeeId] || "").toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-6 max-w-[1200px] mx-auto pb-10">
      <div className="flex items-center justify-between">
        <PageHeader
          title="All Staff Certifications"
          description="View all training records and certifications submitted by employees."
        />
        <div className="relative w-[300px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by course or employee..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-4">
        {filteredRecords.length === 0 ? (
          <Card className="border-dashed bg-muted/20">
            <CardContent className="flex flex-col items-center justify-center p-12 text-muted-foreground">
              <FileText className="w-10 h-10 mb-4 opacity-50" />
              <p>No records found.</p>
            </CardContent>
          </Card>
        ) : (
          filteredRecords.map((record) => (
            <Card key={record.id}>
              <CardContent className="p-6 flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-semibold">
                      {employees[record.employeeId] || "Unknown Employee"}
                    </span>
                    <span className="text-muted-foreground">/</span>
                    <span className="font-medium text-primary">{record.title}</span>
                  </div>
                  <div className="text-sm text-muted-foreground flex items-center gap-2">
                    <span>{record.provider}</span>
                    <span>•</span>
                    <span>Completed: {new Date(record.completionDate).toLocaleDateString()}</span>
                  </div>
                  {record.expiryDate && (
                    <div className="text-xs text-rose-600 font-medium mt-1">
                      Expires: {new Date(record.expiryDate).toLocaleDateString()}
                    </div>
                  )}
                </div>

                <div className="flex flex-col items-end gap-2">
                  {record.certificateFileId && (
                    <Button variant="outline" size="sm">
                      <FileText className="w-4 h-4 mr-2" /> View Certificate
                    </Button>
                  )}
                  {record.hrVerified && (
                    <div className="text-xs font-medium text-emerald-600 flex items-center">
                      <CheckCircle2 className="w-3 h-3 mr-1" /> Verified by HR
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
