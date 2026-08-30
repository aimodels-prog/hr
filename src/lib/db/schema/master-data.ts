import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  type ExtraConfigColumn,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  time,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { mutableRecordColumns } from "./common.ts";
import { organisations } from "./organisation.ts";

const masterColumns = {
  ...mutableRecordColumns,
  organisationId: uuid("organisation_id")
    .notNull()
    .references(() => organisations.id, { onDelete: "restrict", onUpdate: "cascade" }),
  name: text("name").notNull(),
  code: text("code"),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  orderIndex: integer("order_index").notNull().default(0),
};

interface MasterIndexColumns {
  organisationId: ExtraConfigColumn;
  name: ExtraConfigColumn;
  code: ExtraConfigColumn;
  isActive: ExtraConfigColumn;
  orderIndex: ExtraConfigColumn;
  recordVersion: ExtraConfigColumn;
}

function masterIndexes(tableName: string, table: MasterIndexColumns) {
  return [
    uniqueIndex(`${tableName}_organisation_name_unique`).on(
      table.organisationId,
      sql`lower(${table.name})`,
    ),
    uniqueIndex(`${tableName}_organisation_code_unique`)
      .on(table.organisationId, sql`lower(${table.code})`)
      .where(sql`${table.code} IS NOT NULL`),
    index(`${tableName}_active_order_idx`).on(
      table.organisationId,
      table.isActive,
      table.orderIndex,
    ),
    check(`${tableName}_name_not_blank`, sql`btrim(${table.name}) <> ''`),
    check(`${tableName}_code_length`, sql`${table.code} IS NULL OR length(${table.code}) <= 30`),
    check(`${tableName}_order_non_negative`, sql`${table.orderIndex} >= 0`),
    check(`${tableName}_record_version_positive`, sql`${table.recordVersion} >= 1`),
  ];
}

export const departments = pgTable("departments", masterColumns, (table) =>
  masterIndexes("departments", table),
);

export const costCentres = pgTable("cost_centres", masterColumns, (table) =>
  masterIndexes("cost_centres", table),
);

export const grades = pgTable("grades", masterColumns, (table) => masterIndexes("grades", table));

export const employmentTypes = pgTable("employment_types", masterColumns, (table) =>
  masterIndexes("employment_types", table),
);

export const currencies = pgTable(
  "currencies",
  {
    ...masterColumns,
    symbol: text("symbol"),
    decimalPlaces: integer("decimal_places").notNull().default(2),
  },
  (table) => [
    ...masterIndexes("currencies", table),
    check("currencies_iso_code", sql`${table.code} IS NULL OR ${table.code} ~ '^[A-Z]{3}$'`),
    check(
      "currencies_decimal_places_range",
      sql`${table.decimalPlaces} >= 0 AND ${table.decimalPlaces} <= 4`,
    ),
  ],
);

export const activityCodes = pgTable("activity_codes", masterColumns, (table) =>
  masterIndexes("activity_codes", table),
);

export const positions = pgTable(
  "positions",
  {
    ...masterColumns,
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
  },
  (table) => [
    ...masterIndexes("positions", table),
    index("positions_department_idx").on(table.organisationId, table.departmentId),
  ],
);

export const locations = pgTable(
  "locations",
  {
    ...masterColumns,
    address: text("address"),
    city: text("city"),
    country: text("country"),
    timezone: text("timezone"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    radiusMeters: integer("radius_meters"),
    isClockInSite: boolean("is_clock_in_site").notNull().default(false),
  },
  (table) => [
    ...masterIndexes("locations", table),
    check(
      "locations_latitude_range",
      sql`${table.latitude} IS NULL OR (${table.latitude} >= -90 AND ${table.latitude} <= 90)`,
    ),
    check(
      "locations_longitude_range",
      sql`${table.longitude} IS NULL OR (${table.longitude} >= -180 AND ${table.longitude} <= 180)`,
    ),
    check(
      "locations_radius_range",
      sql`${table.radiusMeters} IS NULL OR (${table.radiusMeters} >= 25 AND ${table.radiusMeters} <= 50000)`,
    ),
    check(
      "locations_clock_site_complete",
      sql`NOT ${table.isClockInSite} OR (${table.latitude} IS NOT NULL AND ${table.longitude} IS NOT NULL AND ${table.radiusMeters} IS NOT NULL)`,
    ),
  ],
);

export const workingTimes = pgTable(
  "working_times",
  {
    ...masterColumns,
    startTime: time("start_time", { withTimezone: false }).notNull(),
    endTime: time("end_time", { withTimezone: false }).notNull(),
    breakMinutes: integer("break_minutes").notNull().default(0),
    workingDays: integer("working_days").array().notNull(),
  },
  (table) => [
    ...masterIndexes("working_times", table),
    check(
      "working_times_break_range",
      sql`${table.breakMinutes} >= 0 AND ${table.breakMinutes} < 1440`,
    ),
    check("working_times_start_before_end", sql`${table.startTime} < ${table.endTime}`),
  ],
);

export const publicHolidays = pgTable(
  "public_holidays",
  {
    ...masterColumns,
    holidayDate: date("holiday_date", { mode: "string" }).notNull(),
    locationId: uuid("location_id").references(() => locations.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
  },
  (table) => [
    ...masterIndexes("public_holidays", table),
    uniqueIndex("public_holidays_scope_date_unique").on(
      table.organisationId,
      table.holidayDate,
      sql`coalesce(${table.locationId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    index("public_holidays_date_idx").on(table.organisationId, table.holidayDate),
  ],
);

export const projects = pgTable(
  "projects",
  {
    ...masterColumns,
    client: text("client"),
    type: text("type"),
    locationId: uuid("location_id").references(() => locations.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    startDate: date("start_date", { mode: "string" }),
    endDate: date("end_date", { mode: "string" }),
    costCentreId: uuid("cost_centre_id").references(() => costCentres.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    // The employee FK is added by the generated migration after employees exists.
    managerId: uuid("manager_id"),
    additionalAttributes: jsonb("additional_attributes")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (table) => [
    ...masterIndexes("projects", table),
    index("projects_cost_centre_idx").on(table.organisationId, table.costCentreId),
    index("projects_location_idx").on(table.organisationId, table.locationId),
    index("projects_manager_idx").on(table.organisationId, table.managerId),
    check(
      "projects_date_order",
      sql`${table.endDate} IS NULL OR ${table.startDate} IS NULL OR ${table.endDate} > ${table.startDate}`,
    ),
  ],
);

export type DepartmentRow = typeof departments.$inferSelect;
export type LocationRow = typeof locations.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
