import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { mutableRecordColumns } from "./common.ts";

export const organisations = pgTable(
  "organisations",
  {
    ...mutableRecordColumns,
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [
    uniqueIndex("organisations_slug_unique").on(sql`lower(${table.slug})`),
    check("organisations_name_not_blank", sql`btrim(${table.name}) <> ''`),
    check("organisations_slug_format", sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
    check("organisations_record_version_positive", sql`${table.recordVersion} >= 1`),
  ],
);

export const appSettings = pgTable(
  "app_settings",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict", onUpdate: "cascade" }),
    timezone: text("timezone").notNull(),
    baseCurrency: text("base_currency").notNull(),
    workingDays: integer("working_days").array().notNull(),
    standardDailyHours: numeric("standard_daily_hours", { precision: 5, scale: 2 }).notNull(),
    standardWeeklyHours: numeric("standard_weekly_hours", { precision: 6, scale: 2 }).notNull(),
    leaveYearStart: text("leave_year_start").notNull(),
    leaveYearEnd: text("leave_year_end").notNull(),
    documentReminderDays: integer("document_reminder_days").array().notNull(),
    employeeNumberFormat: text("employee_number_format").notNull(),
    candidateReferenceFormat: text("candidate_reference_format").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    requireOnboardingCompletionBeforeDashboard: boolean(
      "require_onboarding_completion_before_dashboard",
    )
      .notNull()
      .default(true),
    // Reserved for organisation-controlled settings that do not deserve a new
    // column. Dropdown option records belong in master-data tables, never here.
    additionalSettings: jsonb("additional_settings")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (table) => [
    uniqueIndex("app_settings_organisation_unique").on(table.organisationId),
    index("app_settings_organisation_idx").on(table.organisationId),
    check("app_settings_currency_format", sql`${table.baseCurrency} ~ '^[A-Z]{3}$'`),
    check(
      "app_settings_daily_hours_range",
      sql`${table.standardDailyHours} > 0 AND ${table.standardDailyHours} <= 24`,
    ),
    check(
      "app_settings_weekly_hours_range",
      sql`${table.standardWeeklyHours} >= ${table.standardDailyHours} AND ${table.standardWeeklyHours} <= 168`,
    ),
    check(
      "app_settings_leave_year_start_format",
      sql`${table.leaveYearStart} ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'`,
    ),
    check(
      "app_settings_leave_year_end_format",
      sql`${table.leaveYearEnd} ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'`,
    ),
    check("app_settings_schema_version_positive", sql`${table.schemaVersion} >= 1`),
    check("app_settings_record_version_positive", sql`${table.recordVersion} >= 1`),
  ],
);

export type OrganisationRow = typeof organisations.$inferSelect;
export type NewOrganisationRow = typeof organisations.$inferInsert;
export type AppSettingsRow = typeof appSettings.$inferSelect;
