import type { LeaveRequest } from "@/lib/data/leave-types";
import { leaveDecisionSummary } from "@/lib/data/leave-decision-display";

function decisionDate(value?: string) {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

type ApprovalStep = LeaveRequest["chainApprovals"][number];

function stepPerson(
  request: LeaveRequest,
  step: ApprovalStep,
  showRecordGaps: boolean,
): string | null {
  if (step.status !== "Pending") {
    return step.approverName || (showRecordGaps ? "Decision-maker not recorded" : null);
  }
  if (["Line Manager", "Supervisor", "Manager"].includes(step.role)) {
    return (
      request.lineManagerName || (showRecordGaps ? "Assigned manager name not recorded" : null)
    );
  }
  if (step.role === "HR") return "HR team";
  return step.role;
}

/** Read-only history shared by the employee and HR views. */
export function LeaveApprovalHistory({
  request,
  showRecordGaps = true,
}: {
  request: LeaveRequest;
  /** HR keeps audit gaps visible; staff see only known actors and actionable pending gaps. */
  showRecordGaps?: boolean;
}) {
  const steps = request.chainApprovals;
  const amendmentSteps = request.pendingAmendment?.chainApprovals ?? [];
  const missingCurrentManager =
    !showRecordGaps &&
    !request.lineManagerName &&
    [...steps, ...amendmentSteps].some(
      (step) =>
        step.status === "Pending" && ["Line Manager", "Supervisor", "Manager"].includes(step.role),
    );
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground">
          {request.startDate} to {request.endDate} · {request.workingDaysRequested} day(s)
        </p>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
          {request.status}
        </span>
      </div>
      {(request.lineManagerName || showRecordGaps) && (
        <p>
          Line manager: <strong>{request.lineManagerName || "None assigned"}</strong>
        </p>
      )}
      {missingCurrentManager && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950">
          This request is waiting for a manager, but their name is unavailable. Contact HR if it is
          not moving forward.
        </p>
      )}
      {leaveDecisionSummary(request, { staffView: !showRecordGaps }) && (
        <p className="rounded-lg border bg-muted/30 p-3 font-medium">
          {leaveDecisionSummary(request, { staffView: !showRecordGaps })}
        </p>
      )}
      {Boolean(request.policySnapshot.officeWorkCorrections?.length) && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sky-950">
          <p className="font-medium">Leave days replaced by office work</p>
          <ul className="mt-2 space-y-1">
            {request.policySnapshot.officeWorkCorrections?.map((correction) => (
              <li key={`${correction.date}-${correction.attendanceRecordId}`}>
                {correction.date}: counted as work after{" "}
                {correction.decisionSource === "HR" ? "HR review" : "verified office attendance"}.
                {correction.restoredDays > 0 && ` ${correction.restoredDays} day(s) restored.`}
                {decisionDate(correction.correctedAt) && (
                  <span className="text-xs text-sky-800">
                    {" "}
                    Recorded {decisionDate(correction.correctedAt)}.
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {request.status === "Declined" && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-900">
          Reason for decline: {request.refusalReason || "No reason provided"}
        </p>
      )}
      {amendmentSteps.length > 0 && <p className="font-medium">Original request</p>}
      <ol className="space-y-2" aria-label="Original approval history">
        {steps.map((step, index) => (
          <li
            key={`${step.role}-${index}`}
            className="flex items-start justify-between gap-3 rounded-lg border p-3"
          >
            <span>
              <span className="block font-medium">{step.role}</span>
              {stepPerson(request, step, showRecordGaps) && (
                <span className="block text-xs text-muted-foreground">
                  {step.status === "Pending" ? "Assigned to " : "By "}
                  {stepPerson(request, step, showRecordGaps)}
                </span>
              )}
            </span>
            <span className="text-right">
              <span
                className={
                  step.status === "Approved"
                    ? "text-emerald-700"
                    : step.status === "Declined"
                      ? "text-rose-700"
                      : "text-amber-700"
                }
              >
                {step.status}
              </span>
              {decisionDate(step.date) && (
                <span className="block text-xs text-muted-foreground">
                  {decisionDate(step.date)}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
      {amendmentSteps.length > 0 && (
        <>
          <p className="font-medium">Requested change</p>
          <ol className="space-y-2" aria-label="Change approval history">
            {amendmentSteps.map((step, index) => (
              <li
                key={`${step.role}-${index}`}
                className="flex items-start justify-between gap-3 rounded-lg border p-3"
              >
                <span>
                  <span className="block font-medium">{step.role}</span>
                  {stepPerson(request, step, showRecordGaps) && (
                    <span className="block text-xs text-muted-foreground">
                      {step.status === "Pending" ? "Assigned to " : "By "}
                      {stepPerson(request, step, showRecordGaps)}
                    </span>
                  )}
                </span>
                <span className="text-right">
                  <span
                    className={
                      step.status === "Approved"
                        ? "text-emerald-700"
                        : step.status === "Declined"
                          ? "text-rose-700"
                          : "text-amber-700"
                    }
                  >
                    {step.status}
                  </span>
                  {decisionDate(step.date) && (
                    <span className="block text-xs text-muted-foreground">
                      {decisionDate(step.date)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
      {Boolean(request.amendmentHistory?.length) && (
        <>
          <p className="font-medium">Earlier date changes</p>
          <ol className="space-y-2" aria-label="Earlier date-change decisions">
            {request.amendmentHistory?.map((history, index) => (
              <li key={`${history.decidedAt}-${index}`} className="rounded-lg border p-3">
                <p className="font-medium">
                  {history.outcome}
                  {history.deciderName
                    ? ` by ${history.deciderName}`
                    : showRecordGaps
                      ? " by decision-maker not recorded"
                      : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {history.previousStartDate} to {history.previousEndDate} → {history.newStartDate}{" "}
                  to {history.newEndDate}
                </p>
                {history.decisionReason && (
                  <p className="mt-1 text-xs">Reason: {history.decisionReason}</p>
                )}
                {decisionDate(history.decidedAt) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {decisionDate(history.decidedAt)}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
      {showRecordGaps && steps.length === 0 && amendmentSteps.length === 0 && (
        <p className="rounded-lg border p-3 text-muted-foreground">
          Approval steps were not recorded for this older leave entry. Current status:{" "}
          {request.status}.
        </p>
      )}
    </div>
  );
}
