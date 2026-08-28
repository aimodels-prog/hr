import { useState, useMemo } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info, Calendar, Users } from "lucide-react";
import { InterviewService } from "@/lib/data/interview-service";
import { ScorecardService } from "@/lib/data/scorecard-service";
import { EmployeeService } from "@/lib/data/employee-service";
import type { InterviewSlot } from "@/lib/data/types";
import { useCurrentUser } from "@/lib/auth";
import { toast } from "sonner";
import { format } from "date-fns";

interface InterviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vacancyId: string;
  candidateId: string;
  onSuccess?: () => void;
}

export function InterviewDialog({
  open,
  onOpenChange,
  vacancyId,
  candidateId,
  onSuccess,
}: InterviewDialogProps) {
  const currentUser = useCurrentUser();
  const [stageName, setStageName] = useState("HR Screen");
  const [templateId, setTemplateId] = useState<string>("");
  const [duration, setDuration] = useState("30");
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [location, setLocation] = useState("Google Meet");
  const [notes, setNotes] = useState("");
  const [dateRangeStart, setDateRangeStart] = useState("");

  const [isSimulating, setIsSimulating] = useState(false);
  const [proposedSlots, setProposedSlots] = useState<InterviewSlot[]>([]);
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number>(-1);
  const [otherPanelUserIds, setOtherPanelUserIds] = useState<string[]>([]);

  const interviewService = useMemo(() => new InterviewService(), []);
  const scorecardService = useMemo(() => new ScorecardService(), []);
  const empService = useMemo(() => new EmployeeService(), []);
  const templates = useMemo(
    () => scorecardService.getApplicableTemplates(vacancyId, stageName),
    [scorecardService, vacancyId, stageName],
  );

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
    () => [currentUser!.userId, ...otherPanelUserIds],
    [currentUser, otherPanelUserIds],
  );

  const handleSimulate = async () => {
    setIsSimulating(true);
    try {
      const start = new Date(dateRangeStart || new Date());
      const end = new Date(start);
      end.setDate(end.getDate() + 7); // Default to a 1 week range

      const slots = await interviewService.proposeSlots(
        panelUserIds,
        candidateId,
        start,
        end,
        parseInt(duration),
        timezone,
        {
          ...currentUser!.getActorContext(),
          reason: "Reviewed interview availability",
        },
      );
      setProposedSlots(slots);
      setSelectedSlotIndex(-1);
    } catch (e) {
      toast.error("Failed to fetch mock availability");
    } finally {
      setIsSimulating(false);
    }
  };

  const handleSchedule = async () => {
    if (selectedSlotIndex === -1) {
      toast.error("Please select a time slot");
      return;
    }
    if (!templateId || templateId === "none") {
      toast.error("Select the scorecard template HR configured for this stage");
      return;
    }
    const slot = proposedSlots[selectedSlotIndex]!;

    try {
      const interview = interviewService.createInterview(
        {
          vacancyId,
          candidateId,
          ...(templateId ? { templateId } : {}),
          stageName,
          durationMinutes: parseInt(duration),
          panelUserIds,
          location,
          videoMethod: location,
          notes,
          proposedSlots,
        },
        currentUser!.getActorContext(),
      );

      await interviewService.confirmInterview(interview.id, slot, currentUser!.getActorContext());

      toast.success("Interview scheduled and invitation details saved");
      onOpenChange(false);
      onSuccess?.();
    } catch (e) {
      toast.error("Failed to schedule interview");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Schedule Interview</DialogTitle>
          <DialogDescription>Create a new interview stage for this candidate.</DialogDescription>
        </DialogHeader>

        <Alert className="bg-blue-50 text-blue-900 border-blue-200">
          <Info className="h-4 w-4" color="blue" />
          <AlertDescription>
            <strong>Calendar connection is not active yet.</strong> Choose the interview time
            manually. Google Calendar and Meet can be connected later.
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-2 gap-4 my-4">
          <div className="space-y-2">
            <Label>Stage Name</Label>
            <Input
              value={stageName}
              onChange={(e) => setStageName(e.target.value)}
              placeholder="e.g. Technical Interview"
            />
          </div>
          <div className="space-y-2">
            <Label>Scorecard Template (Optional)</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder="No template" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No template</SelectItem>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Duration (Minutes)</Label>
            <Select value={duration} onValueChange={setDuration}>
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
            <Label>Location / Video</Label>
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Google Meet link or Office Room"
            />
          </div>
          <div className="space-y-2">
            <Label>Timezone</Label>
            <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Earliest Date</Label>
            <Input
              type="date"
              value={dateRangeStart}
              onChange={(e) => setDateRangeStart(e.target.value)}
            />
          </div>
          <div className="space-y-2 col-span-2">
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
            You are on the panel automatically. Add anyone else conducting this interview - they
            will be able to see it under their own Interviews page and submit their own scorecard.
          </p>
          <div className="max-h-40 overflow-y-auto border rounded-md divide-y">
            {otherUsers.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground text-center">
                No other users available.
              </p>
            ) : (
              otherUsers.map((u) => (
                <label
                  key={u.id}
                  className="flex items-center gap-2.5 p-2.5 text-sm cursor-pointer hover:bg-muted/50"
                >
                  <Checkbox
                    checked={otherPanelUserIds.includes(u.id)}
                    onCheckedChange={(checked) => togglePanelUser(u.id, checked === true)}
                  />
                  <span className="flex-1 truncate">{u.displayName}</span>
                  {u.employee && (
                    <span className="text-xs text-muted-foreground truncate">
                      {u.employee.position}
                    </span>
                  )}
                </label>
              ))
            )}
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold text-lg">Availability</h3>
            <Button variant="outline" onClick={handleSimulate} disabled={isSimulating}>
              {isSimulating ? "Checking..." : "Simulate Availability"}
            </Button>
          </div>

          {proposedSlots.length > 0 && (
            <div className="space-y-2">
              <Label>Select a confirmed slot</Label>
              <div className="grid grid-cols-1 gap-2">
                {proposedSlots.map((slot, idx) => (
                  <div
                    key={idx}
                    className={`p-3 border rounded-md cursor-pointer flex items-center justify-between ${selectedSlotIndex === idx ? "bg-primary/10 border-primary" : "hover:bg-muted"}`}
                    onClick={() => setSelectedSlotIndex(idx)}
                  >
                    <div className="flex items-center gap-3">
                      <Calendar className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <div className="font-medium">
                          {format(new Date(slot.startTime), "EEEE, MMM do, yyyy")}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {format(new Date(slot.startTime), "h:mm a")} -{" "}
                          {format(new Date(slot.endTime), "h:mm a")} ({slot.timezone})
                        </div>
                      </div>
                    </div>
                    {selectedSlotIndex === idx && <Badge>Selected</Badge>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSchedule} disabled={selectedSlotIndex === -1}>
            Schedule Interview
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
