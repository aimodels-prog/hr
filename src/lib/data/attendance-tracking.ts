export type AttendanceTrackingMode = "Head Office biometric" | "Not required";
export interface AttendanceTrackingAssignment {
  employeeId: string;
  effectiveFrom: string;
  mode: AttendanceTrackingMode;
  source: "location" | "override";
}
export interface AttendanceTrackingPolicy {
  headOfficeLocationId: string;
  effectiveFrom: string;
  revision: number;
  assignments: AttendanceTrackingAssignment[];
}
export function readAttendanceTracking(
  additional: Record<string, unknown> | undefined,
): AttendanceTrackingPolicy | null {
  const value = additional?.["attendanceTracking"] as AttendanceTrackingPolicy | undefined;
  return value?.headOfficeLocationId && Array.isArray(value.assignments) ? value : null;
}
export function trackingAssignment(
  policy: AttendanceTrackingPolicy | null,
  employeeId: string,
  date: string,
) {
  return policy?.assignments
    .filter((item) => item.employeeId === employeeId && item.effectiveFrom <= date)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
}
export function isAttendanceTracked(
  policy: AttendanceTrackingPolicy | null,
  employeeId: string,
  date: string,
): boolean {
  if (!policy) return false; // No eligibility configured: never infer absence for everyone.
  if (date < policy.effectiveFrom) return false; // No inferred absence before eligibility starts; raw punches remain stored.
  return trackingAssignment(policy, employeeId, date)?.mode === "Head Office biometric";
}
export function setTrackingAssignment(
  policy: AttendanceTrackingPolicy,
  assignment: AttendanceTrackingAssignment,
): AttendanceTrackingPolicy {
  return {
    ...policy,
    revision: policy.revision + 1,
    assignments: [
      ...policy.assignments.filter(
        (item) =>
          !(
            item.employeeId === assignment.employeeId &&
            item.effectiveFrom === assignment.effectiveFrom
          ),
      ),
      assignment,
    ],
  };
}
