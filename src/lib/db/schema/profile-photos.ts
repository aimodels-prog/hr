import { pgTable, uuid, timestamp } from "drizzle-orm/pg-core";
import { employees } from "./employee.ts";
import { organisations } from "./organisation.ts";
import { fileMetadata } from "./documents.ts";

export const employeeProfilePhotos = pgTable("employee_profile_photos", {
  employeeId: uuid("employee_id")
    .primaryKey()
    .references(() => employees.id),
  organisationId: uuid("organisation_id")
    .notNull()
    .references(() => organisations.id),
  fileId: uuid("file_id")
    .notNull()
    .references(() => fileMetadata.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
