import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CheckCircle2, Download, FileCheck2, XCircle } from "lucide-react";
import { toast } from "sonner";

import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { AttendanceService } from "@/lib/data/attendance-service";
import type { AttendanceCorrection } from "@/lib/data/attendance-types";
import { EmployeeService } from "@/lib/data/employee-service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/staff/attendance/corrections")({
  component: AttendanceCorrectionsRoute,
});

function AttendanceCorrectionsRoute() {
  const currentUser = useCurrentUser();
  const attendanceService = useMemo(() => new AttendanceService(), []);
  const employeeService = useMemo(() => new EmployeeService(), []);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<AttendanceCorrection | null>(null);
  const [reviewMode, setReviewMode] = useState<"manager" | "hr">("manager");
  const [notes, setNotes] = useState("");
  const actorContext = currentUser.getActorContext();
  const employees = employeeService.getEmployees();
  const records = attendanceService.getRecordsForContext(actorContext);
  const canManagerReview = ["Line Manager", "Super Admin"].includes(currentUser.activeRole);
  const canHrReview = currentUser.can("attendance:manage_all");
  const managerCorrections = canManagerReview
    ? attendanceService
        .getCorrectionsForDirectReports(actorContext)
        .filter((item) => item.status === "Pending Manager")
    : [];
  const hrCorrections = canHrReview
    ? attendanceService.getAllCorrections().filter((item) => item.status === "Pending HR")
    : [];
  const visibleCorrections = attendanceService.getCorrectionsForContext(actorContext);
  const history = visibleCorrections
    .filter((item) => ["Approved", "Rejected"].includes(item.status))
    .slice(0, 30);

  const openReview = (correction: AttendanceCorrection, mode: "manager" | "hr") => {
    setSelected(correction);
    setReviewMode(mode);
    setNotes("");
  };

  const decide = (approve: boolean) => {
    if (!selected) return;
    try {
      if (reviewMode === "manager") {
        if (approve) attendanceService.managerApproveCorrection(selected.id, actorContext, notes);
        else attendanceService.managerRejectCorrection(selected.id, notes, actorContext);
      } else {
        attendanceService.hrFinaliseCorrection(selected.id, approve, notes, actorContext);
      }
      setSelected(null);
      setRevision((value) => value + 1);
      toast.success(approve ? "Correction approved." : "Correction rejected.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Decision could not be saved.");
    }
  };

  const downloadEvidence = async (correctionId: string) => {
    try {
      const { blob, fileName } = await attendanceService.getCorrectionEvidence(
        correctionId,
        actorContext,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Evidence could not be downloaded.");
    }
  };

  const correctionTable = (
    corrections: AttendanceCorrection[],
    mode: "manager" | "hr" | "history",
  ) => (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Original</TableHead>
              <TableHead>Proposed</TableHead>
              <TableHead>Justification</TableHead>
              <TableHead>Evidence</TableHead>
              <TableHead>Status</TableHead>
              {mode !== "history" && <TableHead className="text-right">Action</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {corrections.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={mode === "history" ? 8 : 9}
                  className="h-28 text-center text-muted-foreground"
                >
                  No attendance corrections in this queue.
                </TableCell>
              </TableRow>
            ) : (
              corrections.map((correction) => {
                const record =
                  records.find((item) => item.id === correction.attendanceRecordId) ??
                  attendanceService
                    .getAllRecords()
                    .find((item) => item.id === correction.attendanceRecordId);
                const employee = employees.find((item) => item.id === correction.employeeId);
                return (
                  <TableRow key={correction.id}>
                    <TableCell>
                      <span className="font-medium">{employee?.preferredName ?? "Unknown"}</span>
                      <span className="block text-xs text-muted-foreground">
                        {employee?.employeeNumber}
                      </span>
                    </TableCell>
                    <TableCell>{record?.date ?? "—"}</TableCell>
                    <TableCell>{correction.correctionType ?? "Punch Correction"}</TableCell>
                    <TableCell>
                      {correction.originalClockIn ?? "?"}–{correction.originalClockOut ?? "?"}
                    </TableCell>
                    <TableCell className="font-medium text-emerald-700">
                      {correction.proposedClockIn ?? "?"}–{correction.proposedClockOut ?? "?"}
                    </TableCell>
                    <TableCell className="max-w-72 truncate" title={correction.explanation}>
                      {correction.explanation}
                    </TableCell>
                    <TableCell>
                      {correction.evidenceFileId ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void downloadEvidence(correction.id)}
                        >
                          <Download className="mr-1 h-3 w-3" /> View
                        </Button>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          correction.status === "Rejected"
                            ? "destructive"
                            : correction.status === "Approved"
                              ? "default"
                              : "secondary"
                        }
                      >
                        {correction.status}
                      </Badge>
                    </TableCell>
                    {mode !== "history" && (
                      <TableCell className="text-right">
                        <Button size="sm" onClick={() => openReview(correction, mode)}>
                          Review
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );

  const defaultTab = canManagerReview ? "manager" : canHrReview ? "hr" : "history";

  return (
    <RequirePermission permission="attendance:approve_direct_reports" resourceName="Attendance Corrections">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 pb-10" data-revision={revision}>
        <PageHeader
          title="Attendance Corrections"
          description="Original punches remain immutable until the controlled approval flow is complete."
        />
        <Tabs defaultValue={defaultTab}>
          <TabsList>
            {canManagerReview && (
              <TabsTrigger value="manager">My Team ({managerCorrections.length})</TabsTrigger>
            )}
            {canHrReview && (
              <TabsTrigger value="hr">HR Finalisation ({hrCorrections.length})</TabsTrigger>
            )}
            <TabsTrigger value="history">Decision History</TabsTrigger>
          </TabsList>
          {canManagerReview && (
            <TabsContent value="manager">
              {correctionTable(managerCorrections, "manager")}
            </TabsContent>
          )}
          {canHrReview && (
            <TabsContent value="hr">{correctionTable(hrCorrections, "hr")}</TabsContent>
          )}
          <TabsContent value="history">{correctionTable(history, "history")}</TabsContent>
        </Tabs>

        <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {reviewMode === "manager" ? "Manager Review" : "HR Final Decision"}
              </DialogTitle>
              <DialogDescription>
                {reviewMode === "manager"
                  ? "Endorse the correction for HR or reject it with a reason."
                  : "Approval applies the proposed punches and recalculates worked hours."}
              </DialogDescription>
            </DialogHeader>
            {selected && (
              <div className="space-y-3">
                <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 text-sm sm:grid-cols-2">
                  <div>
                    <span className="block text-xs text-muted-foreground">Original</span>
                    {selected.originalClockIn ?? "?"}–{selected.originalClockOut ?? "?"}
                  </div>
                  <div>
                    <span className="block text-xs text-muted-foreground">Proposed</span>
                    {selected.proposedClockIn ?? "?"}–{selected.proposedClockOut ?? "?"}
                  </div>
                  <div className="sm:col-span-2">
                    <span className="block text-xs text-muted-foreground">
                      Employee justification
                    </span>
                    {selected.explanation}
                  </div>
                  {selected.managerNotes && (
                    <div className="sm:col-span-2">
                      <span className="block text-xs text-muted-foreground">Manager notes</span>
                      {selected.managerNotes}
                    </div>
                  )}
                </div>
                <Textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Required decision notes"
                />
              </div>
            )}
            <DialogFooter>
              <Button
                variant="destructive"
                disabled={notes.trim().length < 3}
                onClick={() => decide(false)}
              >
                <XCircle className="mr-2 h-4 w-4" /> Reject
              </Button>
              <Button disabled={notes.trim().length < 3} onClick={() => decide(true)}>
                {reviewMode === "manager" ? (
                  <FileCheck2 className="mr-2 h-4 w-4" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                {reviewMode === "manager" ? "Endorse to HR" : "Approve & Apply"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </RequirePermission>
  );
}
