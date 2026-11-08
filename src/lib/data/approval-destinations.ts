/** Match dashboard approval categories to the page that can act on them. */
export function approvalDestination(name: string): string {
  if (name.startsWith("Leave")) return "/staff/leave-approvals";
  if (name.startsWith("Overtime")) return "/staff/overtime-approvals";
  if (name.startsWith("Timesheets")) return "/staff/timesheet-approvals";
  if (name.startsWith("Attendance corrections")) return "/staff/attendance/corrections";
  if (name.startsWith("Travel closure")) return "/staff/travel-closures";
  if (name.startsWith("Travel") && name.includes("Finance"))
    return "/staff/travel-accounts-approvals";
  if (name.startsWith("Travel") && name.includes("Manager")) return "/staff/travel-approvals";
  if (name.startsWith("Travel")) return "/staff/travel-hr-approvals";
  if (name.startsWith("Training")) return "/staff/training";
  if (name.startsWith("Visits")) return "/staff/attendance#section=site-visits";
  if (name.startsWith("Time away")) return "/staff/time-away";
  if (name.startsWith("Documents") || name.startsWith("Employment details"))
    return "/staff/employees";
  if (name.startsWith("Objectives")) return "/staff/performance/team";
  if (name.startsWith("Performance")) return "/staff/performance";
  if (name.startsWith("Referrals")) return "/staff/recommendations";
  if (name.startsWith("Offers")) return "/staff/offers";
  if (name.startsWith("Payroll")) return "/staff/payroll";
  return "/staff/requests?view=organisation";
}
