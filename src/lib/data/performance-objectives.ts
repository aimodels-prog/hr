/** Completion review does not undo the supervisor's approval of an objective. */
export const APPROVED_OBJECTIVE_STATUSES = ["Active", "Completion Pending", "Completed"] as const;

export function objectivesReadyForAppraisal(
  goals: readonly { status: string; weight: number; archivedAt?: unknown }[],
): boolean {
  const included = goals.filter((goal) => !goal.archivedAt && goal.status !== "Cancelled");
  return (
    included.length > 0 &&
    included.every(
      (goal) =>
        Number.isInteger(goal.weight) &&
        goal.weight > 0 &&
        APPROVED_OBJECTIVE_STATUSES.some((status) => status === goal.status),
    ) &&
    included.reduce((sum, goal) => sum + goal.weight, 0) === 100
  );
}
