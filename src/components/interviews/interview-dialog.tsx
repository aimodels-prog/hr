import { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
import { SearchablePeopleList } from "@/components/ui/searchable-people-list";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info, Calendar, Users } from "lucide-react";
import { InterviewService } from "@/lib/data/interview-service";
import {
  assertInterviewWorkingDay,
  calendarDateInZone,
  interviewSlotFromLocalTime,
  isWorkingCalendarDate,
} from "@/lib/data/interview-scheduling";
import { ScorecardService } from "@/lib/data/scorecard-service";
import { EmployeeService } from "@/lib/data/employee-service";
import { SettingsService } from "@/lib/data/settings-service";
import type { InterviewSlot } from "@/lib/data/types";
import { useCurrentUser } from "@/lib/auth";
import { toast } from "sonner";

interface InterviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vacancyId: string;
  candidateId: string;
  candidateName?: string;
  vacancyOptions?: Array<{ id: string; title: string }>;
  onSuccess?: () => void;
}

export function InterviewDialog({
  open,
  onOpenChange,
  vacancyId,
  candidateId,
  candidateName,
  vacancyOptions,
  onSuccess,
}: InterviewDialogProps) {
  const currentUser = useCurrentUser();
  const [selectedVacancyId, setSelectedVacancyId] = useState(vacancyId);
  const [stageName, setStageName] = useState("HR Screen");
  const [templateId, setTemplateId] = useState<string>("");
  const [duration, setDuration] = useState("30");
  const [organisation, setOrganisation] = useState<{
    timezone: string;
    workingDays: number[];
  } | null>(null);
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [manualDate, setManualDate] = useState("");
  const [manualTime, setManualTime] = useState("");

  const [isSimulating, setIsSimulating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [proposedSlots, setProposedSlots] = useState<InterviewSlot[]>([]);
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number>(-1);
  const [otherPanelUserIds, setOtherPanelUserIds] = useState<string[]>([]);
  const [includeMeOnPanel, setIncludeMeOnPanel] = useState(true);

  const interviewService = useMemo(() => new InterviewService(), []);
  const scorecardService = useMemo(() => new ScorecardService(), []);
  const empService = useMemo(() => new EmployeeService(), []);
  const templates = useMemo(
    () => scorecardService.getApplicableTemplates(selectedVacancyId, stageName),
    [scorecardService, selectedVacancyId, stageName],
  );

  useEffect(() => {
    if (open) setSelectedVacancyId(vacancyId);
  }, [open, vacancyId]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    new SettingsService()
      .getAppSettings()
      .then((settings) => {
        if (active)
          setOrganisation({ timezone: settings.timezone, workingDays: settings.workingDays });
      })
      .catch(() => {
        if (active)
          toast.error("Working-day settings could not be loaded. Try reopening this form.");
      });
    return () => {
      active = false;
    };
  }, [open]);

  // Anyone who might sit on this panel - not just HR/managers - so the scheduler can name a
  // real interviewer (a senior IC doing a technical round, for example), not only themselves.
  const otherUsers = useMemo(() => {
    const employeeById = new Map(
      empService.getEmployees(currentUser!.getActorContext()).map((e) => [e.id, e]),
    );
    return empService
      .getUsers(currentUser!.getActorContext())
      .filter((u) => u.id !== currentUser!.userId && u.status === "Active")
      .map((u) => ({ ...u, employee: u.employeeId ? employeeById.get(u.employeeId) : undefined }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [empService, currentUser]);

  const togglePanelUser = (userId: string, checked: boolean) => {
    setOtherPanelUserIds((prev) =>
      checked ? [...prev, userId] : prev.filter((id) => id !== userId),
    );
  };

  const panelUserIds = useMemo(
    () => [...(includeMeOnPanel ? [currentUser!.userId] : []), ...otherPanelUserIds],
    [currentUser, includeMeOnPanel, otherPanelUserIds],
  );
  const manualDateIsRestDay = Boolean(
    manualDate && organisation && !isWorkingCalendarDate(manualDate, organisation.workingDays),
  );

  const handleSimulate = async () => {
    if (!organisation) return;
    setIsSimulating(true);
    try {
      const start = manualDate ? new Date(`${manualDate}T00:00:00Z`) : new Date();
      const end = new Date(start.getTime() + 7 * 86_400_000);

      const slots = await interviewService.proposeSlots(
        panelUserIds,
        candidateId,
        start,
        end,
        parseInt(duration),
        organisation.timezone,
        {
          ...currentUser!.getActorContext(),
          reason: "Reviewed interview availability",
        },
      );
      setProposedSlots(slots);
      setSelectedSlotIndex(-1);
      if (!slots.length)
        toast.info("No working-hour suggestions were found. Choose a time manually.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not suggest interview times.");
    } finally {
      setIsSimulating(false);
    }
  };

  const handleSchedule = async () => {
    if (!organisation) return;
    try {
      const slot =
        selectedSlotIndex >= 0
          ? proposedSlots[selectedSlotIndex]!
          : interviewSlotFromLocalTime(
              manualDate,
              manualTime,
              Number(duration),
              organisation.timezone,
            );
      assertInterviewWorkingDay(slot, organisation.workingDays, organisation.timezone);
      setIsSaving(true);
      await interviewService.createInterviewAsync(
        {
          vacancyId: selectedVacancyId,
          candidateId,
          ...(templateId && templateId !== "none" ? { templateId } : {}),
          stageName,
          durationMinutes: Number(duration),
          panelUserIds,
          location,
          videoMethod: location,
          notes,
          confirmedSlot: slot,
        },
        currentUser!.getActorContext(),
      );
      toast.success("Interview scheduled. Share the time and location with the candidate.");
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not schedule the interview.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Schedule Interview</DialogTitle>
          <DialogDescription>
            {candidateName
              ? `Set an interview time for ${candidateName}.`
              : "Set an interview time for this candidate."}{" "}
            This does not send an invitation; share the confirmed details with the candidate.
          </DialogDescription>
        </DialogHeader>

        <Alert className="bg-blue-50 text-blue-900 border-blue-200">
          <Info className="h-4 w-4" color="blue" />
          <AlertDescription>
            Choose a date and time below. Suggested times follow VIA working days, but do not check
            anyone&apos;s calendar. Confirm with the interview panel before scheduling.
          </AlertDescription>
        </Alert>

        {vacancyOptions && vacancyOptions.length > 1 && (
          <div className="space-y-2">
            <Label>Vacancy *</Label>
            <Select
              value={selectedVacancyId}
              onValueChange={(value) => {
                setSelectedVacancyId(value);
                setTemplateId("");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose the vacancy" />
              </SelectTrigger>
              <SelectContent>
                {vacancyOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="my-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Interview stage *</Label>
            <Input
              value={stageName}
              onChange={(e) => setStageName(e.target.value)}
              placeholder="e.g. Technical Interview"
            />
          </div>
          <div className="space-y-2">
            <Label>Scorecard template (optional)</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder="No scorecard" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No scorecard</SelectItem>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Choose one if panel members should score this interview.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Duration (Minutes)</Label>
            <Select
              value={duration}
              onValueChange={(value) => {
                setDuration(value);
                setSelectedSlotIndex(-1);
                setProposedSlots([]);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15">15 mins</SelectItem>
                <SelectItem value="30">30 mins</SelectItem>
                <SelectItem value="45">45 mins</SelectItem>
                <SelectItem value="60">60 mins</SelectItem>
                <SelectItem value="90">90 mins</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Location or video link *</Label>
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Office room or meeting link"
            />
          </div>
          <div className="space-y-2">
            <Label>Timezone</Label>
            <Input value={organisation?.timezone ?? "Loading..."} readOnly />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Interview Notes / Instructions</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Topics to cover..."
            />
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="flex items-center gap-2 mb-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <Label className="mb-0">Interview Panel</Label>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Select the people conducting the interview. Only panel members receive scorecard tasks.
          </p>
          <label className="mb-3 flex items-center gap-2 text-sm">
            <Checkbox
              checked={includeMeOnPanel}
              onCheckedChange={(checked) => setIncludeMeOnPanel(checked === true)}
            />
            I am interviewing this candidate
          </label>
          <SearchablePeopleList
            selected={otherPanelUserIds}
            onToggle={togglePanelUser}
            options={otherUsers.map((u) => ({
              value: u.id,
              label: `${u.displayName} · ${u.employee?.workEmail || u.employee?.position || u.id}`,
            }))}
          />
        </div>

        <div className="border-t pt-4 space-y-4">
          <div>
            <h3 className="font-semibold text-lg">Interview time</h3>
            <p className="text-sm text-muted-foreground">
              Enter a time manually, or choose a working-day suggestion.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="interview-date">Date *</Label>
              <Input
                id="interview-date"
                type="date"
                value={manualDate}
                onChange={(event) => {
                  setManualDate(event.target.value);
                  setSelectedSlotIndex(-1);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="interview-time">Time *</Label>
              <Input
                id="interview-time"
                type="time"
                step={900}
                value={manualTime}
                onChange={(event) => {
                  setManualTime(event.target.value);
                  setSelectedSlotIndex(-1);
                }}
              />
            </div>
          </div>
          {organisation && (
            <p className="text-xs text-muted-foreground">
              Working days:{" "}
              {organisation.workingDays
                .map((day) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day])
                .join(", ")}
              . Timezone: {organisation.timezone}.
            </p>
          )}
          {manualDateIsRestDay && selectedSlotIndex === -1 && (
            <p className="text-sm text-destructive" role="alert">
              This is not a VIA working day. Choose another date.
            </p>
          )}
          <Button
            variant="outline"
            onClick={handleSimulate}
            disabled={isSimulating || !organisation}
          >
            {isSimulating ? "Finding times..." : "Suggest working times"}
          </Button>
          {proposedSlots.length > 0 && (
            <div className="space-y-2">
              <Label>Suggested times (not calendar-checked)</Label>
              <div className="grid grid-cols-1 gap-2">
                {proposedSlots.map((slot, idx) => (
                  <button
                    type="button"
                    key={`${slot.startTime}-${idx}`}
                    className={`p-3 border rounded-md text-left flex items-center justify-between ${selectedSlotIndex === idx ? "bg-primary/10 border-primary" : "hover:bg-muted"}`}
                    onClick={() => {
                      const start = new Date(slot.startTime);
                      setManualDate(calendarDateInZone(start, slot.timezone));
                      setManualTime(
                        new Intl.DateTimeFormat("en-GB", {
                          timeZone: slot.timezone,
                          hour: "2-digit",
                          minute: "2-digit",
                          hourCycle: "h23",
                        }).format(start),
                      );
                      setSelectedSlotIndex(idx);
                    }}
                    aria-pressed={selectedSlotIndex === idx}
                  >
                    <div className="flex items-center gap-3">
                      <Calendar className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <div className="font-medium">
                          {new Intl.DateTimeFormat("en", {
                            timeZone: slot.timezone,
                            weekday: "long",
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          }).format(new Date(slot.startTime))}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {new Intl.DateTimeFormat("en", {
                            timeZone: slot.timezone,
                            hour: "numeric",
                            minute: "2-digit",
                          }).format(new Date(slot.startTime))}{" "}
                          -{" "}
                          {new Intl.DateTimeFormat("en", {
                            timeZone: slot.timezone,
                            hour: "numeric",
                            minute: "2-digit",
                          }).format(new Date(slot.endTime))}{" "}
                          ({slot.timezone})
                        </div>
                      </div>
                    </div>
                    {selectedSlotIndex === idx && (
                      <span className="text-sm font-medium">Selected</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSchedule}
            disabled={
              isSaving ||
              !organisation ||
              !selectedVacancyId ||
              !stageName.trim() ||
              !location.trim() ||
              panelUserIds.length === 0 ||
              (selectedSlotIndex === -1 && (!manualDate || !manualTime || manualDateIsRestDay))
            }
          >
            {isSaving ? "Scheduling..." : "Schedule Interview"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
