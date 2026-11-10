/** Organisation-owned routing choices. Employee IDs remain stable when people change roles. */
export interface ApprovalRoutingSettings {
  hrOwnRequestReviewerEmployeeId: string | null;
  managerlessExecutiveTravelReviewerRole: "Accounts" | "HR";
  managerlessExecutiveTravelNotifyHr: boolean;
  managerlessExecutiveAttendanceReviewerEmployeeId: string | null;
}

export const DEFAULT_APPROVAL_ROUTING_SETTINGS: ApprovalRoutingSettings = {
  // An HR employee must never be routed to approve their own request. HR chooses an
  // independent, active colleague in Company Setup before this route can be used.
  hrOwnRequestReviewerEmployeeId: null,
  managerlessExecutiveTravelReviewerRole: "Accounts",
  managerlessExecutiveTravelNotifyHr: true,
  // HR reviews by default. An organisation may explicitly name one active reviewer.
  managerlessExecutiveAttendanceReviewerEmployeeId: null,
};

export function parseApprovalRoutingSettings(value: unknown): ApprovalRoutingSettings {
  const candidate =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const reviewer = candidate["hrOwnRequestReviewerEmployeeId"];
  const travelRole = candidate["managerlessExecutiveTravelReviewerRole"];
  const attendanceReviewer = candidate["managerlessExecutiveAttendanceReviewerEmployeeId"];
  return {
    hrOwnRequestReviewerEmployeeId:
      typeof reviewer === "string" && reviewer.trim() ? reviewer.trim() : null,
    managerlessExecutiveTravelReviewerRole:
      travelRole === "HR" || travelRole === "Accounts" ? travelRole : "Accounts",
    managerlessExecutiveTravelNotifyHr: candidate["managerlessExecutiveTravelNotifyHr"] !== false,
    managerlessExecutiveAttendanceReviewerEmployeeId:
      typeof attendanceReviewer === "string" && attendanceReviewer.trim()
        ? attendanceReviewer.trim()
        : null,
  };
}
