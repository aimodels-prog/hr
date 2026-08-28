import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { PageHeader } from "@/components/ui/page-header";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Lock, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { TimesheetService } from "@/lib/data/timesheet-service";
import { RequireAnyPermission, useCurrentUser } from "@/lib/auth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TimesheetSettings } from "@/lib/data/timesheet-types";

export const Route = createFileRoute("/staff/timesheet-settings")({
  component: TimesheetSettingsRoute,
});

function TimesheetSettingsRoute() {
  const currentUser = useCurrentUser();
  const tsService = useMemo(() => new TimesheetService(), []);

  const [settings, setSettings] = useState<TimesheetSettings>(tsService.getSettings());

  const [genStart, setGenStart] = useState("");
  const [genEnd, setGenEnd] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [reopenPeriodId, setReopenPeriodId] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState("");
  const periods = tsService.getPeriods();

  const handleClosePeriod = (periodId: string) => {
    try {
      tsService.closePeriod(periodId, currentUser.getActorContext());
      toast.success("Period closed. No further timesheet changes are possible for it.");
      setRefreshKey((k) => k + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to close period");
    }
  };

  const handleSaveSettings = () => {
    try {
      tsService.saveSettings(settings, currentUser.getActorContext());
      toast.success("Timesheet settings saved.");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    }
  };

  const handleReopenPeriod = () => {
    if (!reopenPeriodId) return;
    try {
      tsService.reopenPeriod(reopenPeriodId, reopenReason, currentUser.getActorContext());
      toast.success("Period reopened. Returned timesheets can now be corrected.");
      setReopenPeriodId(null);
      setReopenReason("");
      setRefreshKey((value) => value + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The period could not be reopened.");
    }
  };

  const handleGeneratePeriods = () => {
    if (!genStart || !genEnd) {
      toast.error("Please select start and end dates.");
      return;
    }
    try {
      const count = tsService.generatePeriods(genStart, genEnd, currentUser.getActorContext());
      toast.success(`Generated ${count} new periods.`);
      setGenStart("");
      setGenEnd("");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to generate periods.");
    }
  };

  return (
    <RequireAnyPermission
      permissions={["timesheet:admin_all", "system:settings_manage"]}
      resourceName="Timesheet Settings"
    >
      <div className="flex flex-col gap-6 max-w-[800px] mx-auto pb-10">
        <PageHeader
          title="Timesheet Settings"
          description="Configure weekly periods, standard hours, and generation rules."
        />

        <Card>
          <CardHeader>
            <CardTitle>Global Configuration</CardTitle>
            <CardDescription>Changes apply to new periods and timesheets.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Weekly Period Start Day</Label>
                <Select
                  value={settings.weeklyPeriodStartDay.toString()}
                  onValueChange={(v) =>
                    setSettings({ ...settings, weeklyPeriodStartDay: parseInt(v) })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Sunday</SelectItem>
                    <SelectItem value="1">Monday</SelectItem>
                    <SelectItem value="6">Saturday</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Submission Deadline (Days after end)</Label>
                <Input
                  type="number"
                  min={0}
                  max={30}
                  value={settings.submissionDeadlineDays}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      submissionDeadlineDays: parseInt(e.target.value) || 0,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Standard Daily Hours</Label>
                <Input
                  type="number"
                  min={1}
                  max={24}
                  value={settings.standardDailyHours}
                  onChange={(e) =>
                    setSettings({ ...settings, standardDailyHours: parseInt(e.target.value) || 0 })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Overtime Threshold (Weekly Hours)</Label>
                <Input
                  type="number"
                  min={1}
                  max={168}
                  value={settings.overtimeThresholdWeekly}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      overtimeThresholdWeekly: parseInt(e.target.value) || 0,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Attendance Variance Tolerance (Hours)</Label>
                <Input
                  type="number"
                  min={0}
                  max={2}
                  step={0.05}
                  value={settings.attendanceVarianceToleranceHours}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      attendanceVarianceToleranceHours: Number(event.target.value) || 0,
                    })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Daily differences above this value require an employee explanation.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Payroll Lock Behaviour</Label>
                <Select
                  value={settings.payrollLockBehaviour}
                  onValueChange={(value: TimesheetSettings["payrollLockBehaviour"]) =>
                    setSettings({ ...settings, payrollLockBehaviour: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Automatic on Approval">Automatic on Approval</SelectItem>
                    <SelectItem value="Manual by HR">Manual by HR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center space-x-2 pt-4">
              <Switch
                id="copy-week"
                checked={settings.allowCopyPreviousWeek}
                onCheckedChange={(v) => setSettings({ ...settings, allowCopyPreviousWeek: v })}
              />
              <Label htmlFor="copy-week">Allow employees to copy entries from previous week</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="hr-overtime-verification"
                checked={settings.requireHrOvertimeVerification}
                onCheckedChange={(value) =>
                  setSettings({ ...settings, requireHrOvertimeVerification: value })
                }
              />
              <Label htmlFor="hr-overtime-verification">
                Require HR verification after supervisor overtime approval
              </Label>
            </div>
          </CardContent>
          <CardFooter className="justify-end">
            <Button onClick={handleSaveSettings}>Save Configuration</Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Period Generation</CardTitle>
            <CardDescription>
              Automatically generate weekly periods across a date range respecting your configured
              start day.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input type="date" value={genStart} onChange={(e) => setGenStart(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input type="date" value={genEnd} onChange={(e) => setGenEnd(e.target.value)} />
              </div>
            </div>
            <p className="text-sm text-muted-foreground pt-2">
              Note: This will align the first generated period to the previous occurrence of your
              configured "Weekly Period Start Day" if the chosen start date doesn't land exactly on
              it.
            </p>
          </CardContent>
          <CardFooter className="justify-end">
            <Button variant="secondary" onClick={handleGeneratePeriods}>
              Generate Periods
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Period Lifecycle</CardTitle>
            <CardDescription>
              Closing a period stops any employee from creating, editing, or submitting a timesheet
              inside it. A closed period can be reopened with a recorded reason when corrections are
              required.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((period) => (
                  <TableRow key={period.id}>
                    <TableCell>
                      {period.startDate} to {period.endDate}
                    </TableCell>
                    <TableCell>
                      <Badge variant={period.status === "Closed" ? "outline" : "default"}>
                        {period.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {period.status === "Open" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleClosePeriod(period.id)}
                        >
                          <Lock className="w-3.5 h-3.5 mr-1" /> Close Period
                        </Button>
                      )}
                      {period.status === "Closed" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setReopenReason("");
                            setReopenPeriodId(period.id);
                          }}
                        >
                          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reopen Period
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {periods.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                      No periods generated yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      <Dialog
        open={Boolean(reopenPeriodId)}
        onOpenChange={(open) => !open && setReopenPeriodId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reopen timesheet period</DialogTitle>
            <DialogDescription>
              Explain why this period needs to accept corrections again. The decision is recorded in
              Audit History.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={reopenReason}
            onChange={(event) => setReopenReason(event.target.value)}
            placeholder="Reason for reopening"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenPeriodId(null)}>
              Cancel
            </Button>
            <Button onClick={handleReopenPeriod} disabled={reopenReason.trim().length < 5}>
              Reopen Period
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </RequireAnyPermission>
  );
}
