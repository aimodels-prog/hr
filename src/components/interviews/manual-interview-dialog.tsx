import { useMemo, useState } from "react";
import { ClipboardCheck, Info, Users } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentUser } from "@/lib/auth";
import { EmployeeService } from "@/lib/data/employee-service";
import { InterviewService } from "@/lib/data/interview-service";
import { ScorecardService } from "@/lib/data/scorecard-service";
import { VacancyService } from "@/lib/data/vacancy-service";

interface ManualInterviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidateId: string;
  defaultPosition?: string | undefined;
  defaultProject?: string | undefined;
  onSuccess?: () => void;
}

function localDateTimeValue(date = new Date()) {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 16);
}

export function ManualInterviewDialog({
  open,
  onOpenChange,
  candidateId,
  defaultPosition,
  defaultProject,
  onSuccess,
}: ManualInterviewDialogProps) {
  const currentUser = useCurrentUser();
  const [interviewService] = useState(() => new InterviewService());
  const [scorecardService] = useState(() => new ScorecardService());
  const [employeeService] = useState(() => new EmployeeService());
  const [vacancyService] = useState(() => new VacancyService());

  const [vacancyId, setVacancyId] = useState("none");
  const [stageName, setStageName] = useState("Manual Interview");
  const [positionTitle, setPositionTitle] = useState(defaultPosition || "");
  const [projectName, setProjectName] = useState(defaultProject || "");
  const [occurredAt, setOccurredAt] = useState(localDateTimeValue());
  const [duration, setDuration] = useState("60");
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [method, setMethod] = useState("In person");
  const [location, setLocation] = useState("VIA Office");
  const [templateId, setTemplateId] = useState("");
  const [notes, setNotes] = useState("");
  const [otherPanelUserIds, setOtherPanelUserIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const vacancies = useMemo(
    () =>
      vacancyService
        .getVacancyRepository()
        .list()
        .filter((vacancy) => !vacancy.archivedAt),
    [vacancyService],
  );
  const templates = useMemo(
    () => scorecardService.getApplicableTemplates(vacancyId === "none" ? "" : vacancyId),
    [scorecardService, vacancyId],
  );
  const otherUsers = useMemo(() => {
    const employeeById = new Map(
      employeeService
        .getEmployees(currentUser.getActorContext())
        .map((employee) => [employee.id, employee]),
    );
    return employeeService
      .getUsers(currentUser.getActorContext())
      .filter((user) => user.id !== currentUser.userId && user.status === "Active")
      .map((user) => ({
        ...user,
        employee: user.employeeId ? employeeById.get(user.employeeId) : undefined,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [employeeService, currentUser]);

  const togglePanelUser = (userId: string, checked: boolean) => {
    setOtherPanelUserIds((current) =>
      checked ? [...new Set([...current, userId])] : current.filter((id) => id !== userId),
    );
  };

  const save = async () => {
    if (!positionTitle.trim()) {
      toast.error("Enter the position discussed in the interview");
      return;
    }
    if (!occurredAt) {
      toast.error("Enter when the interview occurred");
      return;
    }
    if (!templateId) {
      toast.error("Select the HR scoring criteria for this interview");
      return;
    }

    setIsSaving(true);
    try {
      await interviewService.createManualInterviewAsync(
        {
          candidateId,
          ...(vacancyId !== "none" ? { vacancyId } : {}),
          templateId,
          stageName,
          occurredAt: new Date(occurredAt).toISOString(),
          durationMinutes: Number(duration),
          timezone,
          panelUserIds: [currentUser.userId, ...otherPanelUserIds],
          positionTitle,
          ...(projectName.trim() ? { projectName } : {}),
          location,
          videoMethod: method,
          notes,
        },
        { ...currentUser.getActorContext(), reason: "Recorded completed manual interview" },
      );
      toast.success("Manual interview recorded. Assigned interviewers can now submit scorecards.");
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record manual interview");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Record Manual Interview</DialogTitle>
          <DialogDescription>
            Record an interview that already happened outside VIA HR System. No application,
            shortlist, calendar event, Meet link or invitation will be created.
          </DialogDescription>
        </DialogHeader>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            This creates an auditable completed interview with scorecards. A vacancy is optional and
            can be confirmed later if the candidate is selected.
          </AlertDescription>
        </Alert>

        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="manual-position">Position discussed</Label>
            <Input
              id="manual-position"
              value={positionTitle}
              onChange={(event) => setPositionTitle(event.target.value)}
              placeholder="e.g. Project Manager"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-project">Project (optional)</Label>
            <Input
              id="manual-project"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="Project discussed"
            />
          </div>
          <div className="space-y-2">
            <Label>Existing vacancy (optional)</Label>
            <Select value={vacancyId} onValueChange={setVacancyId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No vacancy — direct/manual interview</SelectItem>
                {vacancies.map((vacancy) => (
                  <SelectItem key={vacancy.id} value={vacancy.id}>
                    {vacancy.title} · {vacancy.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-stage">Interview stage</Label>
            <Input
              id="manual-stage"
              value={stageName}
              onChange={(event) => setStageName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-occurred">Date and time interviewed</Label>
            <Input
              id="manual-occurred"
              type="datetime-local"
              max={localDateTimeValue()}
              value={occurredAt}
              onChange={(event) => setOccurredAt(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Duration</Label>
            <Select value={duration} onValueChange={setDuration}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[15, 30, 45, 60, 90, 120].map((minutes) => (
                  <SelectItem key={minutes} value={String(minutes)}>
                    {minutes} minutes
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="In person">In person</SelectItem>
                <SelectItem value="Google Meet">Google Meet</SelectItem>
                <SelectItem value="Phone">Phone</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-location">Location or meeting reference</Label>
            <Input
              id="manual-location"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-timezone">Timezone</Label>
            <Input
              id="manual-timezone"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Scoring criteria</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a scorecard template" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <Label>Interviewers</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            You are included automatically. Every selected interviewer receives their own scorecard
            in the Interviews workspace.
          </p>
          <div className="max-h-40 divide-y overflow-y-auto rounded-md border">
            {otherUsers.length === 0 ? (
              <p className="p-3 text-center text-xs text-muted-foreground">
                No other active users.
              </p>
            ) : (
              otherUsers.map((user) => (
                <label
                  key={user.id}
                  className="flex cursor-pointer items-center gap-3 p-3 hover:bg-muted/50"
                >
                  <Checkbox
                    checked={otherPanelUserIds.includes(user.id)}
                    onCheckedChange={(checked) => togglePanelUser(user.id, checked === true)}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{user.displayName}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {user.employee?.position || user.roles.join(", ")}
                  </span>
                </label>
              ))
            )}
          </div>
        </div>

        <div className="space-y-2 border-t pt-4">
          <Label htmlFor="manual-notes" className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" /> Interview notes
          </Label>
          <Textarea
            id="manual-notes"
            rows={4}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="What was discussed, evidence received, and any follow-up required"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={isSaving}>
            {isSaving ? "Recording…" : "Record completed interview"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
