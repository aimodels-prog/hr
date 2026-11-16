export const ATTENDANCE_FOLLOW_UP_MESSAGE =
  "We do not yet have your Head Office clock-in for today. If you are on approved leave, working remotely, or on an official visit, please check that your request is recorded in VIA HR Application. Otherwise, please reply to HR with your work arrangement for today. This is a record check, not an absence decision.";

export function attendanceMorningFollowUpEligible(input: {
  afterCutoff: boolean;
  workday: boolean;
  tracked: boolean;
  hasPunch: boolean;
  leaveFraction: number;
  remote: boolean;
  approvedActivity: boolean;
  pendingActivity: boolean;
  specialDay: boolean;
  holiday: boolean;
  activeAccount: boolean;
}): boolean {
  return (
    input.afterCutoff &&
    input.workday &&
    input.tracked &&
    !input.hasPunch &&
    input.leaveFraction === 0 &&
    !input.remote &&
    !input.approvedActivity &&
    !input.pendingActivity &&
    !input.specialDay &&
    !input.holiday &&
    input.activeAccount
  );
}
