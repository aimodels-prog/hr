import type { Role } from "../data/types.ts";

export function canReadEmploymentHistory(
  field: string,
  employeeId: string,
  managerId: string | undefined,
  viewer: { employeeId?: string | undefined; activeRole: Role },
) {
  if (viewer.employeeId === employeeId || viewer.activeRole === "Super Admin") return true;
  if (field === "salary") return viewer.activeRole === "Accounts";
  return (
    viewer.activeRole === "HR" ||
    (viewer.activeRole === "Line Manager" &&
      Boolean(viewer.employeeId) &&
      managerId === viewer.employeeId)
  );
}
