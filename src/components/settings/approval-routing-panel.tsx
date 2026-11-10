import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useCurrentUser } from "@/lib/auth";
import { SettingsService } from "@/lib/data/settings-service";
import type { AppSettings } from "@/lib/data/types";
import {
  DEFAULT_APPROVAL_ROUTING_SETTINGS,
  parseApprovalRoutingSettings,
  type ApprovalRoutingSettings,
} from "@/lib/data/approval-routing-settings";
import {
  assignExistingHrOwnRequestsFn,
  getApprovalRoutingOptionsFn,
  getPendingIndependentHrReviewsFn,
  reassignPendingIndependentHrReviewFn,
} from "@/lib/server-functions/settings.server";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ReviewerOption = {
  employeeId: string;
  name: string;
  legalName: string;
  workEmail: string;
};

type PendingAssignment = {
  module:
    | "Leave"
    | "Timesheet"
    | "Attendance Correction"
    | "Overtime"
    | "Training"
    | "Visit"
    | "Time Away"
    | "Document"
    | "Training Certificate"
    | "Employment Confirmation";
  requestId: string;
  requesterEmployeeId: string;
  requesterName: string;
  reviewerEmployeeId: string;
  reviewerName: string;
  reviewerActive: boolean;
  status: string;
};

export function ApprovalRoutingPanel() {
  const currentUser = useCurrentUser();
  const service = useMemo(() => new SettingsService(), []);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [routing, setRouting] = useState<ApprovalRoutingSettings>(
    DEFAULT_APPROVAL_ROUTING_SETTINGS,
  );
  const [reviewers, setReviewers] = useState<ReviewerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [confirmAssignment, setConfirmAssignment] = useState(false);
  const [pendingAssignments, setPendingAssignments] = useState<PendingAssignment[]>([]);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [reassignment, setReassignment] = useState<PendingAssignment | null>(null);
  const [replacementReviewerId, setReplacementReviewerId] = useState("");
  const [reassigning, setReassigning] = useState(false);
  const [error, setError] = useState("");
  const canAssignIndependentReviewer =
    currentUser.activeRole === "Super Admin" && !currentUser.roles.includes("HR");

  const refreshAssignments = useCallback(async () => {
    if (!canAssignIndependentReviewer) return;
    setLoadingAssignments(true);
    try {
      const rows = await getPendingIndependentHrReviewsFn({
        data: {
          actorId: currentUser.id,
          ...(currentUser.workspaceEmail ? { actorEmail: currentUser.workspaceEmail } : {}),
        },
      });
      setPendingAssignments(rows);
    } catch (cause: unknown) {
      toast.error(cause instanceof Error ? cause.message : "Waiting reviews could not be loaded.");
    } finally {
      setLoadingAssignments(false);
    }
  }, [canAssignIndependentReviewer, currentUser.id, currentUser.workspaceEmail]);

  useEffect(() => {
    void refreshAssignments();
  }, [refreshAssignments]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void Promise.all([
      service.getAppSettings(),
      getApprovalRoutingOptionsFn({
        data: {
          actorId: currentUser.id,
          ...(currentUser.workspaceEmail ? { actorEmail: currentUser.workspaceEmail } : {}),
        },
      }),
    ])
      .then(([loadedSettings, choices]) => {
        if (cancelled) return;
        setSettings(loadedSettings);
        setRouting(parseApprovalRoutingSettings(loadedSettings.approvalRouting));
        setReviewers(choices);
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "Approval routes could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser.id, currentUser.workspaceEmail, service]);

  const selectedReviewer = reviewers.find(
    (person) => person.employeeId === routing.hrOwnRequestReviewerEmployeeId,
  );
  const selectedAttendanceReviewer = reviewers.find(
    (person) => person.employeeId === routing.managerlessExecutiveAttendanceReviewerEmployeeId,
  );
  const reviewerUnavailable =
    Boolean(routing.hrOwnRequestReviewerEmployeeId) && !selectedReviewer && !loading;
  const changed =
    settings &&
    JSON.stringify(parseApprovalRoutingSettings(settings.approvalRouting)) !==
      JSON.stringify(routing);

  const save = async () => {
    if (!settings || saving) return;
    setSaving(true);
    try {
      const saved = await service.saveAppSettings(
        { ...settings, approvalRouting: routing },
        currentUser.getActorContext(),
      );
      setSettings(saved);
      setRouting(parseApprovalRoutingSettings(saved.approvalRouting));
      toast.success("Approval routes saved");
    } catch (cause: unknown) {
      toast.error(cause instanceof Error ? cause.message : "Approval routes could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const assignExisting = async () => {
    if (!canAssignIndependentReviewer || assigning || !selectedReviewer || changed) return;
    setAssigning(true);
    try {
      const result = await assignExistingHrOwnRequestsFn({
        data: {
          actorId: currentUser.id,
          ...(currentUser.workspaceEmail ? { actorEmail: currentUser.workspaceEmail } : {}),
        },
      });
      setConfirmAssignment(false);
      const assignedMessage = result.assigned
        ? `${result.assigned} waiting request${result.assigned === 1 ? "" : "s"} assigned for independent review.`
        : "No waiting HR requests were assigned.";
      if (result.skipped)
        toast.warning(
          `${assignedMessage} ${result.skipped} request${result.skipped === 1 ? " was" : "s were"} left unchanged. Check their approval stages in All employee requests; special approvals are never bypassed.`,
        );
      else toast.success(assignedMessage);
      await refreshAssignments();
    } catch (cause: unknown) {
      toast.error(
        cause instanceof Error ? cause.message : "Waiting requests could not be assigned.",
      );
    } finally {
      setAssigning(false);
    }
  };

  const confirmReassignment = async () => {
    if (
      !reassignment ||
      !replacementReviewerId ||
      reassigning ||
      replacementReviewerId === reassignment.reviewerEmployeeId ||
      replacementReviewerId === reassignment.requesterEmployeeId
    )
      return;
    setReassigning(true);
    try {
      await reassignPendingIndependentHrReviewFn({
        data: {
          actorId: currentUser.id,
          ...(currentUser.workspaceEmail ? { actorEmail: currentUser.workspaceEmail } : {}),
          module: reassignment.module,
          requestId: reassignment.requestId,
          newReviewerEmployeeId: replacementReviewerId,
        },
      });
      setReassignment(null);
      setReplacementReviewerId("");
      toast.success("Reviewer changed. The new reviewer has been notified.");
      await refreshAssignments();
    } catch (cause: unknown) {
      toast.error(cause instanceof Error ? cause.message : "Reviewer could not be changed.");
    } finally {
      setReassigning(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-5">
      <p className="text-sm text-muted-foreground">
        Choose who makes independent decisions when the usual reviewer cannot. Changes apply to new
        requests; requests already waiting need a separate review.
      </p>
      {loading && <p role="status">Loading approval routes…</p>}
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"
        >
          {error}
        </p>
      )}
      {!loading && settings && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>When HR requests something</CardTitle>
              <CardDescription>
                An HR team member cannot approve their own request. Choose an independent colleague
                with an active VIA HR account.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {canAssignIndependentReviewer ? (
                <SearchableSelect
                  aria-label="Independent reviewer for HR requests"
                  value={routing.hrOwnRequestReviewerEmployeeId ?? ""}
                  onValueChange={(employeeId) =>
                    setRouting((current) => ({
                      ...current,
                      hrOwnRequestReviewerEmployeeId: employeeId || null,
                    }))
                  }
                  options={reviewers.map((person) => ({
                    value: person.employeeId,
                    label: `${person.name || person.legalName} — ${person.workEmail}`,
                    keywords: [person.legalName, person.workEmail],
                  }))}
                  placeholder="Search for a reviewer"
                  searchPlaceholder="Search staff by name or email"
                />
              ) : (
                <p className="rounded-lg border bg-muted/40 p-3 text-sm">
                  {selectedReviewer
                    ? `${selectedReviewer.name || selectedReviewer.legalName} — ${selectedReviewer.workEmail}`
                    : "No independent reviewer is assigned."}{" "}
                  Only a Super Admin outside HR can change this choice. That role does not approve
                  the requests.
                </p>
              )}
              {!routing.hrOwnRequestReviewerEmployeeId && (
                <p role="alert" className="text-sm text-amber-800">
                  Setup needed: HR team members’ own requests cannot receive a final decision until
                  an independent reviewer is selected.
                </p>
              )}
              {reviewerUnavailable && (
                <p role="alert" className="text-sm text-amber-800">
                  The saved reviewer no longer has an active account. Select another person before
                  HR team members submit new requests.
                </p>
              )}
              {canAssignIndependentReviewer && selectedReviewer && (
                <div className="space-y-2 border-t pt-3">
                  <p className="text-sm text-muted-foreground">
                    Requests already waiting do not change when you save this setting. Assign them
                    separately after checking the reviewer above.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={Boolean(changed) || saving || assigning}
                    onClick={() => setConfirmAssignment(true)}
                  >
                    Assign existing waiting HR requests
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          {canAssignIndependentReviewer && (
            <Card>
              <CardHeader>
                <CardTitle>Waiting on an independent reviewer</CardTitle>
                <CardDescription>
                  Each request keeps its assigned reviewer even when the default above changes.
                  Change a waiting request here only if its reviewer is unavailable.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void refreshAssignments()}
                  disabled={loadingAssignments}
                >
                  {loadingAssignments ? "Refreshing..." : "Refresh waiting requests"}
                </Button>
                {!loadingAssignments && pendingAssignments.length === 0 && (
                  <p className="text-sm text-muted-foreground">No assigned requests are waiting.</p>
                )}
                {pendingAssignments.map((item) => (
                  <div
                    key={`${item.module}-${item.requestId}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm"
                  >
                    <div>
                      <p className="font-medium">
                        {item.requesterName} · {item.module}
                      </p>
                      <p className="text-muted-foreground">
                        {item.status} · Reviewer: {item.reviewerName}
                        {!item.reviewerActive && (
                          <span className="ml-1 text-amber-800">(unavailable)</span>
                        )}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setReassignment(item);
                        setReplacementReviewerId("");
                      }}
                    >
                      Change reviewer
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>When an executive has no supervisor</CardTitle>
              <CardDescription>
                Choose who reviews travel and attendance corrections. New requests follow the saved
                route; waiting requests keep their assigned reviewer.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="block text-sm font-medium">
                Travel reviewer
                <select
                  value={routing.managerlessExecutiveTravelReviewerRole}
                  onChange={(event) =>
                    setRouting((current) => ({
                      ...current,
                      managerlessExecutiveTravelReviewerRole: event.target.value as
                        "Accounts" | "HR",
                    }))
                  }
                  className="mt-1.5 h-11 w-full rounded-md border bg-background px-3"
                >
                  <option value="Accounts">Finance</option>
                  <option value="HR">HR</option>
                </select>
              </label>
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={routing.managerlessExecutiveTravelNotifyHr}
                  onChange={(event) =>
                    setRouting((current) => ({
                      ...current,
                      managerlessExecutiveTravelNotifyHr: event.target.checked,
                    }))
                  }
                  className="size-4"
                />
                Notify HR when the request is sent
              </label>
              <div className="space-y-2 border-t pt-4">
                <p className="text-sm font-medium">Full attendance corrections</p>
                <p className="text-sm text-muted-foreground">
                  HR reviews these directly by default. Choose a specific active colleague only if
                  the company changes this route. The reviewer must open the request in their
                  Employee view; nobody can review their own correction.
                </p>
                <SearchableSelect
                  aria-label="Executive attendance correction reviewer"
                  value={routing.managerlessExecutiveAttendanceReviewerEmployeeId ?? ""}
                  onValueChange={(employeeId) =>
                    setRouting((current) => ({
                      ...current,
                      managerlessExecutiveAttendanceReviewerEmployeeId: employeeId || null,
                    }))
                  }
                  options={[
                    { value: "", label: "HR team (default)" },
                    ...reviewers.map((person) => ({
                      value: person.employeeId,
                      label: `${person.name || person.legalName} — ${person.workEmail}`,
                      keywords: [person.legalName, person.workEmail],
                    })),
                  ]}
                  placeholder="HR team (default)"
                  searchPlaceholder="Search by name or email"
                />
                {routing.managerlessExecutiveAttendanceReviewerEmployeeId &&
                  !selectedAttendanceReviewer && (
                    <p role="alert" className="text-sm text-amber-800">
                      The selected reviewer no longer has an active account. Choose another person
                      before saving.
                    </p>
                  )}
              </div>
            </CardContent>
          </Card>
          <div className="flex justify-end">
            <Button onClick={() => void save()} disabled={!changed || saving}>
              {saving ? "Saving…" : "Save approval routes"}
            </Button>
          </div>
          <AlertDialog open={confirmAssignment} onOpenChange={setConfirmAssignment}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Assign waiting HR requests?</AlertDialogTitle>
                <AlertDialogDescription>
                  Eligible requests already waiting for HR review will be assigned to{" "}
                  {selectedReviewer?.name || selectedReviewer?.legalName || "the selected reviewer"}
                  {". "}Each assignment is recorded in the audit history. This does not approve any
                  request.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={assigning}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={assigning}
                  onClick={(event) => {
                    event.preventDefault();
                    void assignExisting();
                  }}
                >
                  {assigning ? "Assigning..." : "Assign requests"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog
            open={Boolean(reassignment)}
            onOpenChange={(open) => {
              if (!open && !reassigning) {
                setReassignment(null);
                setReplacementReviewerId("");
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Change this request's reviewer?</AlertDialogTitle>
                <AlertDialogDescription>
                  {reassignment?.requesterName}'s {reassignment?.module} request is waiting for{" "}
                  {reassignment?.reviewerName}. Choose an active colleague. This action is recorded
                  and the new reviewer is notified; it does not approve the request.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <SearchableSelect
                aria-label="Replacement reviewer"
                value={replacementReviewerId}
                onValueChange={setReplacementReviewerId}
                options={reviewers
                  .filter((person) => person.employeeId !== reassignment?.requesterEmployeeId)
                  .map((person) => ({
                    value: person.employeeId,
                    label: `${person.name || person.legalName} — ${person.workEmail}`,
                    keywords: [person.legalName, person.workEmail],
                  }))}
                placeholder="Search for a reviewer"
                searchPlaceholder="Search staff by name or email"
              />
              <AlertDialogFooter>
                <AlertDialogCancel disabled={reassigning}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={
                    reassigning ||
                    !replacementReviewerId ||
                    replacementReviewerId === reassignment?.reviewerEmployeeId
                  }
                  onClick={(event) => {
                    event.preventDefault();
                    void confirmReassignment();
                  }}
                >
                  {reassigning ? "Changing..." : "Confirm change"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
