/** HR receives topic summaries; other staff receive one combined daily summary. */
export function emailDigestTopic(isHr: boolean, type: string, entityType = ""): string {
  if (!isHr) return "Your daily updates";
  const value = `${type} ${entityType}`.toLowerCase();
  if (/document.*expir|expir.*document/.test(value)) return "Expiring documents";
  if (/document|profile|dependant|employment/.test(value)) return "Employee records and documents";
  if (/leave/.test(value)) return "Leave requests";
  if (/timesheet/.test(value)) return "Timesheets";
  if (/overtime/.test(value)) return "Overtime";
  if (/attendance|clockout|time.away|site.visit/.test(value)) return "Attendance and time away";
  if (/travel/.test(value)) return "Travel";
  if (/training/.test(value)) return "Training";
  if (/offer|candidate|recruit|application|referral/.test(value)) return "Recruitment";
  if (/performance|goal/.test(value)) return "Performance";
  if (/onboarding|offboarding/.test(value)) return "Joining and leaving";
  return "Other HR updates";
}
