import type { LeaveRequest } from "@/lib/data/leave-types";

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

/** Read-only history shared by the employee and HR views. */
export function LeaveApprovalHistory({ request }: { request: LeaveRequest }) {
  const steps = request.chainApprovals;
  const amendmentSteps = request.pendingAmendment?.chainApprovals ?? [];
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">
        {request.startDate} to {request.endDate} · {request.workingDaysRequested} day(s)
      </p>
      {amendmentSteps.length > 0 && <p className="font-medium">Original request</p>}
      <ol className="space-y-2" aria-label="Original approval history">
        {steps.map((step, index) => (
          <li
            key={`${step.role}-${index}`}
            className="flex items-start justify-between gap-3 rounded-lg border p-3"
          >
            <span className="font-medium">{step.role}</span>
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
                <span className="font-medium">{step.role}</span>
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
      {steps.length === 0 && amendmentSteps.length === 0 && (
        <p className="rounded-lg border p-3 text-muted-foreground">
          Approval steps were not recorded for this older leave entry. Current status:{" "}
          {request.status}.
        </p>
      )}
      {(steps.length > 0 || amendmentSteps.length > 0) && (
        <p className="text-xs text-muted-foreground">Current status: {request.status}</p>
      )}
    </div>
  );
}
