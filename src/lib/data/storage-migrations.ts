import { trainingCourses } from "./seeds.ts";
import type { StorageMigration } from "./storage.ts";

/** Application migrations are additive and never replace an existing collection. */
export const VIA_HR_STORAGE_MIGRATIONS: StorageMigration[] = [
  {
    fromVersion: 1,
    toVersion: 2,
    migrate: (collections) => {
      const managerIds = new Set(
        (collections["employees"] ?? []).flatMap((item) => {
          const managerId = (item as { lineManagerId?: unknown }).lineManagerId;
          return typeof managerId === "string" ? [managerId] : [];
        }),
      );
      const users = (collections["users"] ?? []).map((item) => {
        const user = item as { employeeId?: unknown; roles?: unknown };
        if (
          typeof user.employeeId !== "string" ||
          !managerIds.has(user.employeeId) ||
          !Array.isArray(user.roles) ||
          user.roles.includes("Line Manager")
        )
          return item;
        return { ...(item as Record<string, unknown>), roles: [...user.roles, "Line Manager"] };
      });
      return {
        ...collections,
        users,
        training_courses: collections["training_courses"] ?? structuredClone(trainingCourses),
        training_requests: collections["training_requests"] ?? [],
        training_sessions: collections["training_sessions"] ?? [],
        training_enrollments: collections["training_enrollments"] ?? [],
        training_records: collections["training_records"] ?? [],
      };
    },
  },
];
