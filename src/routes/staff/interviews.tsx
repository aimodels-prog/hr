import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarClock, Users, ClipboardCheck, AlertTriangle, CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { InterviewService } from "@/lib/data/interview-service";
import { ScorecardService } from "@/lib/data/scorecard-service";
import { CandidateService } from "@/lib/data/candidate-service";
import { VacancyService } from "@/lib/data/vacancy-service";
import { EmployeeService } from "@/lib/data/employee-service";
import { ScorecardForm } from "@/components/interviews/scorecard-form";
import type { InterviewEvent } from "@/lib/data/types";
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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

export const Route = createFileRoute("/staff/interviews")({
  head: () => ({
    meta: [
      { title: "Interviews — VIA HR System" },
      {
        name: "description",
        content: "Interviews you are on the panel for, and company-wide interview oversight.",
      },
    ],
  }),
  component: InterviewsWrapper,
});

function InterviewsWrapper() {
  return (
    <RequirePermission permission="recruitment:score_interviews_assigned" resourceName="Interviews">
      <Interviews />
    </RequirePermission>
  );
}

function Interviews() {
  const { userId, can, getActorContext } = useCurrentUser();
  const canViewAll = can("recruitment:view_interviews");
  const canManage = can("recruitment:manage_interviews");

  const [interviewService] = useState(() => new InterviewService());
  const [scorecardService] = useState(() => new ScorecardService());
  const [candidateService] = useState(() => new CandidateService());
  const [vacancyService] = useState(() => new VacancyService());
  const [empService] = useState(() => new EmployeeService());
  const [refreshKey, setRefreshKey] = useState(0);
  const [scoringInterview, setScoringInterview] = useState<InterviewEvent | null>(null);
  const [reschedulingInterview, setReschedulingInterview] = useState<InterviewEvent | null>(null);
  const [rescheduleStart, setRescheduleStart] = useState("");
  const [respondingInterview, setRespondingInterview] = useState<InterviewEvent | null>(null);
  const [chosenSlotIndex, setChosenSlotIndex] = useState<number | null>(null);
  const [declineNote, setDeclineNote] = useState("");

  const submitCandidateResponse = async (response: "Accepted" | "Declined") => {
    if (!respondingInterview) return;
    try {
      await interviewService.recordCandidateResponse(
        respondingInterview.id,
        response,
        getActorContext(),
        response === "Accepted" && chosenSlotIndex !== null
          ? respondingInterview.proposedSlots[chosenSlotIndex]
          : undefined,
        declineNote,
      );
      toast.success(response === "Accepted" ? "Interview confirmed" : "Marked as declined");
      setRespondingInterview(null);
      setChosenSlotIndex(null);
      setDeclineNote("");
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record response");
    }
  };

  const allInterviews = useMemo(
    () => interviewService.getInterviews(getActorContext()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [interviewService, getActorContext, refreshKey],
  );

  const candidateById = useMemo(() => {
    void refreshKey;
    const map = new Map(
      candidateService
        .getCandidateRepository()
        .list()
        .map((c) => [c.id, c]),
    );
    return map;
  }, [candidateService, refreshKey]);

  const vacancyById = useMemo(() => {
    void refreshKey;
    const map = new Map(
      vacancyService
        .getVacancyRepository()
        .list()
        .map((v) => [v.id, v]),
    );
    return map;
  }, [vacancyService, refreshKey]);

  const userById = useMemo(() => {
    void refreshKey;
    const map = new Map(empService.getUsers(getActorContext()).map((u) => [u.id, u]));
    return map;
  }, [empService, refreshKey]);

  const candidateName = (id: string) => {
    const c = candidateById.get(id);
    return c ? `${c.firstName} ${c.lastName}` : "Unknown candidate";
  };
  const userName = (id: string) => userById.get(id)?.displayName || "Unknown user";

  const myInterviews = useMemo(
    () => allInterviews.filter((i) => i.panelUserIds.includes(userId)).sort(sortByTime),
    [allInterviews, userId],
  );

  const refresh = () => setRefreshKey((k) => k + 1);

  const [statusChangeTarget, setStatusChangeTarget] = useState<{
    interview: InterviewEvent;
    status: "Completed" | "Cancelled" | "No Show";
  } | null>(null);
  const [statusChangeReason, setStatusChangeReason] = useState("");
  const [waiverAcknowledged, setWaiverAcknowledged] = useState(false);

  const statusChangeMetrics = useMemo(() => {
    if (!statusChangeTarget) return null;
    return scorecardService.calculateInterviewMetrics(
      statusChangeTarget.interview.id,
      statusChangeTarget.interview.panelUserIds,
    );
  }, [scorecardService, statusChangeTarget]);
  const statusChangeNeedsWaiver =
    statusChangeTarget?.status === "Completed" && statusChangeMetrics
      ? !statusChangeMetrics.isComplete
      : false;

  const openStatusChangeDialog = (
    interview: InterviewEvent,
    status: "Completed" | "Cancelled" | "No Show",
  ) => {
    setStatusChangeReason("");
    setWaiverAcknowledged(false);
    setStatusChangeTarget({ interview, status });
  };

  const submitStatusChange = () => {
    if (!statusChangeTarget) return;
    if (!statusChangeReason.trim()) {
      toast.error("A reason is required.");
      return;
    }
    if (statusChangeNeedsWaiver && !waiverAcknowledged) {
      toast.error("Required scorecards are incomplete - acknowledge the waiver to proceed.");
      return;
    }
    try {
      interviewService.changeStatus(
        statusChangeTarget.interview.id,
        statusChangeTarget.status,
        statusChangeReason,
        { ...getActorContext(), reason: statusChangeReason },
        statusChangeNeedsWaiver,
      );
      toast.success(`Interview marked ${statusChangeTarget.status}`);
      setStatusChangeTarget(null);
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update interview");
    }
  };

  const confirmReschedule = async () => {
    if (!reschedulingInterview || !rescheduleStart) return;
    const start = new Date(rescheduleStart);
    const end = new Date(start.getTime() + reschedulingInterview.durationMinutes * 60_000);
    try {
      await interviewService.rescheduleInterview(
        reschedulingInterview.id,
        {
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          timezone: reschedulingInterview.confirmedSlot?.timezone || "Asia/Dubai",
        },
        { ...getActorContext(), reason: "Interview rescheduled by HR" },
      );
      toast.success("Interview rescheduled and invitation details updated");
      setReschedulingInterview(null);
      setRescheduleStart("");
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reschedule interview");
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-10">
      <div>
        <h1 className="text-2xl font-semibold">Interviews</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Interviews you are on the panel for, and their scorecards.
        </p>
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-primary" /> My Interviews to Score
        </h2>
        {myInterviews.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground text-sm">
              You are not on the panel for any interview right now. When someone schedules you as an
              interviewer from a candidate&rsquo;s profile, it will show up here.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {myInterviews.map((interview) => {
              const myScorecard = scorecardService
                .getScorecardsForInterview(interview.id)
                .find((s) => s.panelUserId === userId);
              const vacancy = interview.vacancyId
                ? vacancyById.get(interview.vacancyId)
                : undefined;
              return (
                <Card key={interview.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-base truncate">
                        {candidateName(interview.candidateId)}
                      </CardTitle>
                      <Badge variant={interview.status === "Scheduled" ? "default" : "secondary"}>
                        {interview.status}
                      </Badge>
                    </div>
                    <CardDescription className="truncate">
                      {interview.stageName} {vacancy ? `· ${vacancy.title}` : ""}
                    </CardDescription>
                    {!vacancy && interview.positionTitle && (
                      <p className="text-xs text-muted-foreground">
                        Manual position: {interview.positionTitle}
                      </p>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <CalendarClock className="h-3.5 w-3.5" />
                      <span>
                        {interview.confirmedSlot
                          ? new Date(interview.confirmedSlot.startTime).toLocaleString()
                          : "Not yet confirmed"}
                      </span>
                    </div>
                    {interview.meetingJoinUrl && (
                      <a
                        href={interview.meetingJoinUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-primary hover:underline"
                      >
                        Open meeting
                      </a>
                    )}
                    <div className="flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5" />
                      <span>{interview.panelUserIds.map(userName).join(", ")}</span>
                    </div>

                    {interview.templateId ? (
                      <Button
                        size="sm"
                        variant={myScorecard?.status === "Submitted" ? "outline" : "default"}
                        className="mt-2 w-full"
                        onClick={() => setScoringInterview(interview)}
                      >
                        {myScorecard?.status === "Submitted"
                          ? "View my scorecard"
                          : myScorecard?.status === "Draft"
                            ? "Continue scoring"
                            : "Score this interview"}
                      </Button>
                    ) : (
                      <p className="mt-2 text-[11px] italic">
                        No scorecard template assigned to this interview.
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {canViewAll && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" /> All Interviews
          </h2>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Candidate</TableHead>
                    <TableHead>Vacancy</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Panel</TableHead>
                    <TableHead>Scorecards</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allInterviews.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        No interviews scheduled yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    [...allInterviews].sort(sortByTime).map((interview) => {
                      const metrics = scorecardService.calculateInterviewMetrics(
                        interview.id,
                        interview.panelUserIds,
                      );
                      const vacancy = interview.vacancyId
                        ? vacancyById.get(interview.vacancyId)
                        : undefined;
                      return (
                        <TableRow key={interview.id}>
                          <TableCell className="font-medium">
                            {candidateName(interview.candidateId)}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {vacancy?.title || interview.positionTitle || "No vacancy linked"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {interview.stageName}
                            {interview.source === "Manual / Offline" && (
                              <Badge variant="outline" className="ml-2">
                                Manual
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={interview.status === "Scheduled" ? "default" : "secondary"}
                            >
                              {interview.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {interview.panelUserIds.map(userName).join(", ")}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5 text-xs">
                              {metrics.isComplete ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                              ) : (
                                <ClipboardCheck className="h-3.5 w-3.5 text-muted-foreground" />
                              )}
                              <span>
                                {metrics.completedCount}/{metrics.totalExpected}
                              </span>
                              {metrics.hasDisagreement && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] px-1 py-0 border-warning/30 text-warning bg-warning/15 gap-1"
                                >
                                  <AlertTriangle className="h-3 w-3" /> Split decision
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-wrap justify-end gap-1">
                              {canManage && interview.status === "Scheduled" && (
                                <>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setReschedulingInterview(interview)}
                                  >
                                    Reschedule
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => openStatusChangeDialog(interview, "Completed")}
                                  >
                                    Complete
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => openStatusChangeDialog(interview, "No Show")}
                                  >
                                    No Show
                                  </Button>
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={() => openStatusChangeDialog(interview, "Cancelled")}
                                  >
                                    Cancel
                                  </Button>
                                </>
                              )}
                              {canManage && interview.status === "Proposed" && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={interview.proposedSlots.length === 0}
                                  onClick={() => {
                                    try {
                                      interviewService.sendSlotsToCandidate(
                                        interview.id,
                                        getActorContext(),
                                      );
                                      toast.success("Slots sent to candidate");
                                      refresh();
                                    } catch (error) {
                                      toast.error(
                                        error instanceof Error
                                          ? error.message
                                          : "Could not send slots",
                                      );
                                    }
                                  }}
                                >
                                  Send Slots to Candidate
                                </Button>
                              )}
                              {canManage && interview.status === "Awaiting Candidate" && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setRespondingInterview(interview)}
                                >
                                  Record Response
                                </Button>
                              )}
                              <Button asChild variant="ghost" size="sm">
                                <Link
                                  to="/staff/candidates/$candidateId"
                                  params={{ candidateId: interview.candidateId }}
                                >
                                  Open candidate
                                </Link>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {scoringInterview && (
        <ScorecardForm
          open={!!scoringInterview}
          onOpenChange={(open) => !open && setScoringInterview(null)}
          interviewId={scoringInterview.id}
          templateId={scoringInterview.templateId!}
          onSuccess={refresh}
        />
      )}

      <Dialog
        open={!!reschedulingInterview}
        onOpenChange={(open) => !open && setReschedulingInterview(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reschedule Interview</DialogTitle>
            <DialogDescription>
              The previous time will remain in the interview history. Confirm the new time below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reschedule-start">New start date and time</Label>
            <Input
              id="reschedule-start"
              type="datetime-local"
              value={rescheduleStart}
              onChange={(event) => setRescheduleStart(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReschedulingInterview(null)}>
              Cancel
            </Button>
            <Button disabled={!rescheduleStart} onClick={() => void confirmReschedule()}>
              Confirm Reschedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!statusChangeTarget}
        onOpenChange={(open) => !open && setStatusChangeTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark interview as {statusChangeTarget?.status}</DialogTitle>
            <DialogDescription>
              This is recorded on the interview history and requires a reason.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="status-change-reason">Reason</Label>
            <Textarea
              id="status-change-reason"
              value={statusChangeReason}
              onChange={(event) => setStatusChangeReason(event.target.value)}
              placeholder={`Reason for marking this interview ${statusChangeTarget?.status ?? ""}`}
            />
          </div>
          {statusChangeNeedsWaiver && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3">
              <Checkbox
                id="status-change-waiver"
                checked={waiverAcknowledged}
                onCheckedChange={(checked) => setWaiverAcknowledged(checked === true)}
              />
              <Label htmlFor="status-change-waiver" className="text-sm font-normal leading-snug">
                Required scorecards are incomplete. I confirm this is an authorised waiver to
                complete the interview anyway.
              </Label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusChangeTarget(null)}>
              Cancel
            </Button>
            <Button onClick={submitStatusChange}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!respondingInterview}
        onOpenChange={(open) => {
          if (!open) {
            setRespondingInterview(null);
            setChosenSlotIndex(null);
            setDeclineNote("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Candidate Response</DialogTitle>
            <DialogDescription>
              What did the candidate say about the proposed times?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label>Proposed slots</Label>
            <div className="space-y-2">
              {respondingInterview?.proposedSlots.map((slot, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setChosenSlotIndex(index)}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                    chosenSlotIndex === index ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  {new Date(slot.startTime).toLocaleString()} ({slot.timezone})
                </button>
              ))}
            </div>
            <div className="space-y-2 pt-2">
              <Label htmlFor="decline-note">If declined, note why (optional)</Label>
              <Textarea
                id="decline-note"
                value={declineNote}
                onChange={(event) => setDeclineNote(event.target.value)}
                placeholder="None of these times work because..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => void submitCandidateResponse("Declined")}>
              Candidate Declined
            </Button>
            <Button
              disabled={chosenSlotIndex === null}
              onClick={() => void submitCandidateResponse("Accepted")}
            >
              Candidate Accepted Slot
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function sortByTime(a: InterviewEvent, b: InterviewEvent): number {
  const at = a.confirmedSlot?.startTime || a.createdAt;
  const bt = b.confirmedSlot?.startTime || b.createdAt;
  return new Date(bt).getTime() - new Date(at).getTime();
}
