import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { mutableRecordColumns } from "./common.ts";
import { users } from "./employee.ts";
import { organisations } from "./organisation.ts";
import {
  departments,
  employmentTypes,
  grades,
  locations,
  positions,
  projects,
} from "./master-data.ts";
import { employees } from "./employee.ts";

export const vacancyStatus = pgEnum("vacancy_status", [
  "Draft",
  "Pending Approval",
  "Open",
  "Paused",
  "Closed",
  "Archived",
]);

export const vacancies = pgTable(
  "vacancies",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "restrict" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    positionId: uuid("position_id")
      .notNull()
      .references(() => positions.id, { onDelete: "restrict" }),
    gradeId: uuid("grade_id")
      .notNull()
      .references(() => grades.id, { onDelete: "restrict" }),
    employmentTypeId: uuid("employment_type_id")
      .notNull()
      .references(() => employmentTypes.id, { onDelete: "restrict" }),
    hiringManagerId: uuid("hiring_manager_id").references(() => employees.id, {
      onDelete: "restrict",
    }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "restrict" }),
    targetStartDate: date("target_start_date", { mode: "string" }),
    assignedOwnerId: uuid("assigned_owner_id").references(() => employees.id, {
      onDelete: "restrict",
    }),
    status: vacancyStatus("status").notNull(),
    summary: text("summary").notNull(),
    responsibilities: jsonb("responsibilities").$type<string[]>().notNull(),
    requirements: jsonb("requirements").$type<string[]>().notNull(),
    applicantCount: integer("applicant_count").notNull().default(0),
    headcount: integer("headcount").notNull().default(1),
    /** AES-256-GCM envelope containing the internal salary range and currency. */
    salaryRangeEncrypted: text("salary_range_encrypted"),
    salaryVisibleToPublic: boolean("salary_visible_to_public").notNull().default(false),
    hiringReason: text("hiring_reason").notNull(),
    education: text("education").notNull(),
    minimumExperience: text("minimum_experience").notNull(),
    skills: jsonb("skills").$type<{ required: string[]; preferred: string[] }>().notNull(),
    certifications: jsonb("certifications").$type<string[]>().notNull().default([]),
    languages: jsonb("languages").$type<string[]>().notNull().default([]),
    mandatoryCriteria: jsonb("mandatory_criteria").$type<string[]>(),
    notes: text("notes").notNull().default(""),
    screeningQuestions: jsonb("screening_questions").$type<string[]>().notNull().default([]),
  },
  (table) => [
    index("vacancies_org_status_idx").on(table.organisationId, table.status),
    index("vacancies_org_hiring_manager_idx").on(table.organisationId, table.hiringManagerId),
    check("vacancies_title_not_blank", sql`btrim(${table.title}) <> ''`),
    check("vacancies_applicant_count_non_negative", sql`${table.applicantCount} >= 0`),
    check("vacancies_headcount_positive", sql`${table.headcount} > 0`),
    check(
      "vacancies_public_salary_requires_value",
      sql`NOT ${table.salaryVisibleToPublic} OR ${table.salaryRangeEncrypted} IS NOT NULL`,
    ),
    check("vacancies_record_version_positive", sql`${table.recordVersion} >= 1`),
  ],
);

export const vacancyVersions = pgTable(
  "vacancy_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    vacancyId: uuid("vacancy_id")
      .notNull()
      .references(() => vacancies.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    responsibilities: jsonb("responsibilities").$type<string[]>().notNull(),
    requirements: jsonb("requirements").$type<string[]>().notNull(),
    mandatoryCriteria: jsonb("mandatory_criteria").$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by").notNull(),
  },
  (table) => [
    uniqueIndex("vacancy_versions_vacancy_version_unique").on(table.vacancyId, table.versionNumber),
    index("vacancy_versions_org_vacancy_idx").on(table.organisationId, table.vacancyId),
    check("vacancy_versions_version_positive", sql`${table.versionNumber} >= 1`),
  ],
);

export const candidateStage = pgEnum("candidate_stage", [
  "Sourced",
  "Applied",
  "Screened",
  "Shortlisted",
  "Interview",
  "Offer",
  "Hired",
  "On Hold",
  "Not Selected",
  "Withdrawn",
  "Archived",
]);

export const visaStatus = pgEnum("visa_status", [
  "Own Visa",
  "Company Visa",
  "Freelance Visa",
  "Visit Visa",
  "Requires Sponsorship",
  "Omani (No Visa Required)",
  "Not Applicable",
  "Other",
]);

export const candidateMaritalStatus = pgEnum("candidate_marital_status", [
  "Single",
  "Married",
  "Married (With Family)",
  "Not Specified",
]);

export const candidateConsentStatus = pgEnum("candidate_consent_status", [
  "Confirmed",
  "Privacy Notice Sent",
  "Awaiting Confirmation",
  "Refused",
  "Expired",
]);

export const recruitmentDocuments = pgTable(
  "recruitment_documents",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    checksum: text("checksum"),
    ownerEntityType: text("owner_entity_type").notNull(),
    ownerEntityId: uuid("owner_entity_id").notNull(),
  },
  (table) => [
    index("recruitment_documents_org_owner_idx").on(
      table.organisationId,
      table.ownerEntityType,
      table.ownerEntityId,
    ),
    uniqueIndex("recruitment_documents_org_checksum_unique")
      .on(table.organisationId, table.checksum)
      .where(sql`${table.checksum} IS NOT NULL`),
    check("recruitment_documents_name_not_blank", sql`btrim(${table.name}) <> ''`),
    check("recruitment_documents_mime_not_blank", sql`btrim(${table.mimeType}) <> ''`),
    check("recruitment_documents_size_positive", sql`${table.size} > 0`),
    check("recruitment_documents_record_version_positive", sql`${table.recordVersion} >= 1`),
  ],
);

export const candidates = pgTable(
  "candidates",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
    nationality: text("nationality"),
    location: text("location").notNull(),
    currentCompany: text("current_company"),
    currentTitle: text("current_title"),
    linkedInUrl: text("linked_in_url"),
    cvFileId: uuid("cv_file_id").references(() => recruitmentDocuments.id, {
      onDelete: "restrict",
    }),
    yearsOfExperience: integer("years_of_experience").notNull().default(0),
    stage: candidateStage("stage").notNull(),
    doNotContact: boolean("do_not_contact").notNull().default(false),
    hrOwnerId: uuid("hr_owner_id").references(() => employees.id, { onDelete: "restrict" }),
    recommender: text("recommender"),
    visaStatus: visaStatus("visa_status"),
    maritalStatus: candidateMaritalStatus("marital_status"),
    lastContactAt: timestamp("last_contact_at", { withTimezone: true, mode: "string" }),
    followUpStatus: text("follow_up_status"),
    source: text("source"),
    aiScoreRange: text("ai_score_range"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "restrict" }),
    projectName: text("project_name"),
    projectType: text("project_type"),
    shortlistStatus: text("shortlist_status"),
    trackerStatus: text("tracker_status"),
    noticePeriod: text("notice_period"),
    currentSalaryEncrypted: text("current_salary_encrypted"),
    expectedSalaryEncrypted: text("expected_salary_encrypted"),
    acceptedSalaryEncrypted: text("accepted_salary_encrypted"),
    interviewDate: date("interview_date", { mode: "string" }),
    remarks: text("remarks"),
    importProvenance: text("import_provenance"),
    originalImportValues: jsonb("original_import_values").$type<Record<string, string>>(),
    convertedToEmployeeId: uuid("converted_to_employee_id").references(() => employees.id, {
      onDelete: "restrict",
    }),
    mergedIntoId: uuid("merged_into_id").references((): AnyPgColumn => candidates.id, {
      onDelete: "restrict",
    }),
    skills: jsonb("skills").$type<string[]>(),
    education: jsonb("education").$type<string[]>(),
    certifications: jsonb("certifications").$type<string[]>(),
    languages: jsonb("languages").$type<string[]>(),
    availability: text("availability"),
    workEligibility: text("work_eligibility"),
    talentPools: jsonb("talent_pools").$type<string[]>(),
    consentStatus: candidateConsentStatus("consent_status"),
    consentUpdatedAt: timestamp("consent_updated_at", { withTimezone: true, mode: "string" }),
    latestCvRecordId: uuid("latest_cv_record_id").references(
      (): AnyPgColumn => candidateCvRecords.id,
      { onDelete: "set null" },
    ),
  },
  (table) => [
    uniqueIndex("candidates_org_email_unique_idx").on(
      table.organisationId,
      sql`lower(${table.email})`,
    ),
    uniqueIndex("candidates_org_phone_unique_idx").on(table.organisationId, table.phone),
    index("candidates_org_stage_idx").on(table.organisationId, table.stage),
    index("candidates_org_hr_owner_idx").on(table.organisationId, table.hrOwnerId),
    check("candidates_email_normalized", sql`${table.email} = lower(btrim(${table.email}))`),
    check("candidates_experience_non_negative", sql`${table.yearsOfExperience} >= 0`),
    check(
      "candidates_merge_not_self",
      sql`${table.mergedIntoId} IS NULL OR ${table.mergedIntoId} <> ${table.id}`,
    ),
    check("candidates_record_version_positive", sql`${table.recordVersion} >= 1`),
  ],
);

export const applicationStatus = pgEnum("application_status", [
  "New",
  "Shortlisted",
  "On Hold",
  "Interviewing",
  "Offered",
  "Hired",
  "Rejected",
  "Withdrawn",
]);

export const candidateApplications = pgTable(
  "candidate_applications",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    referenceId: text("reference_id").notNull(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "restrict" }),
    vacancyId: uuid("vacancy_id")
      .notNull()
      .references(() => vacancies.id, { onDelete: "restrict" }),
    status: applicationStatus("status").notNull(),
    cvFileId: uuid("cv_file_id")
      .notNull()
      .references(() => recruitmentDocuments.id, { onDelete: "restrict" }),
    coverNote: text("cover_note"),
    noticePeriod: text("notice_period").notNull(),
    /** AES-256-GCM envelope; salary expectations must never be stored as plaintext. */
    salaryExpectationEncrypted: text("salary_expectation_encrypted"),
    screeningAnswers: jsonb("screening_answers")
      .$type<{ question: string; answer: string }[]>()
      .notNull()
      .default([]),
    source: text("source").notNull(),
    consentGiven: boolean("consent_given").notNull().default(false),
    consentedAt: timestamp("consented_at", { withTimezone: true, mode: "string" }).notNull(),
    hrInterviewRecommendationId: uuid("hr_interview_recommendation_id").references(
      (): AnyPgColumn => candidateInterviewRecommendations.id,
      { onDelete: "set null" },
    ),
    assessmentScoreId: uuid("assessment_score_id").references(
      (): AnyPgColumn => candidateScoreRuns.id,
      { onDelete: "set null" },
    ),
    preparationRunId: uuid("preparation_run_id").references(
      (): AnyPgColumn => candidatePreparationRuns.id,
      { onDelete: "set null" },
    ),
    preparationStatus: text("preparation_status"),
    screeningDecision: text("screening_decision"),
  },
  (table) => [
    uniqueIndex("candidate_applications_org_reference_unique").on(
      table.organisationId,
      table.referenceId,
    ),
    uniqueIndex("cand_app_cand_vac_unique_idx").on(table.candidateId, table.vacancyId),
    index("candidate_applications_org_status_idx").on(table.organisationId, table.status),
    index("candidate_applications_vacancy_idx").on(table.vacancyId),
    check("candidate_applications_reference_not_blank", sql`btrim(${table.referenceId}) <> ''`),
    check("candidate_applications_record_version_positive", sql`${table.recordVersion} >= 1`),
  ],
);

export const candidateCvSource = pgEnum("candidate_cv_source", [
  "Careers Portal",
  "Direct Email",
  "WhatsApp",
  "Employee Referral",
  "Agency",
  "Walk-in",
  "HR Upload",
  "Other",
]);

export const cvProcessingStatus = pgEnum("cv_processing_status", [
  "Uploaded",
  "Extracting",
  "Awaiting HR Review",
  "Ready",
  "Processing Failed",
]);

export const recommenderType = pgEnum("recommender_type", [
  "Agency",
  "Employee Referral",
  "External Person",
  "Client",
  "Supplier",
  "Company",
]);

export const candidateRecommendations = pgTable(
  "candidate_recommendations",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "restrict" }),
    vacancyId: uuid("vacancy_id").references(() => vacancies.id, { onDelete: "restrict" }),
    recommenderType: recommenderType("recommender_type").notNull(),
    recommenderName: text("recommender_name").notNull(),
    recommenderCompany: text("recommender_company"),
    recommenderPosition: text("recommender_position"),
    recommenderEmail: text("recommender_email").notNull(),
    recommenderPhone: text("recommender_phone"),
    relationship: text("relationship"),
    date: date("date", { mode: "string" }).notNull(),
    notes: text("notes").notNull(),
    hrOwnerId: uuid("hr_owner_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    commercialTerms: text("commercial_terms"),
    sourceOutcome: text("source_outcome").notNull(),
    employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "restrict" }),
  },
  (table) => [index("candidate_recommendations_org_idx").on(table.organisationId)],
);

export const candidateCvRecords = pgTable(
  "candidate_cv_records",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    candidateId: uuid("candidate_id").references(() => candidates.id, { onDelete: "restrict" }),
    applicationId: uuid("application_id").references(() => candidateApplications.id, {
      onDelete: "restrict",
    }),
    vacancyId: uuid("vacancy_id").references(() => vacancies.id, { onDelete: "restrict" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => recruitmentDocuments.id, { onDelete: "restrict" }),
    originalFileName: text("original_file_name").notNull(),
    source: candidateCvSource("source").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "string" }).notNull(),
    processingStatus: cvProcessingStatus("processing_status").notNull(),
    extractionMethod: text("extraction_method").notNull(),
    extractedFields: jsonb("extracted_fields").notNull().default({}),
    fieldConfidence: jsonb("field_confidence").notNull().default({}),
    extractionWarnings: jsonb("extraction_warnings").$type<string[]>().notNull().default([]),
    consentStatus: candidateConsentStatus("consent_status").notNull(),
    notes: text("notes"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "string" }),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    recommendationPending: boolean("recommendation_pending"),
    recommendationId: uuid("recommendation_id").references(() => candidateRecommendations.id, {
      onDelete: "set null",
    }),
  },
  (table) => [index("candidate_cv_records_org_idx").on(table.organisationId)],
);

export const candidatePreparationRuns = pgTable(
  "candidate_preparation_runs",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    vacancyId: uuid("vacancy_id")
      .notNull()
      .references(() => vacancies.id, { onDelete: "restrict" }),
    vacancyRecordVersion: integer("vacancy_record_version").notNull(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "restrict" }),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => candidateApplications.id, { onDelete: "restrict" }),
    cvRecordId: uuid("cv_record_id")
      .notNull()
      .references(() => candidateCvRecords.id, { onDelete: "restrict" }),
    cvFileId: uuid("cv_file_id")
      .notNull()
      .references(() => recruitmentDocuments.id, { onDelete: "restrict" }),
    cvChecksum: text("cv_checksum"),
    status: text("status").notNull(),
    documentRoute: text("document_route").notNull(),
    preparationMethod: text("preparation_method").notNull(),
    extractedProfile: jsonb("extracted_profile").notNull().default({}),
    fieldConfidence: jsonb("field_confidence").notNull().default({}),
    preliminaryScore: numeric("preliminary_score"),
    band: text("band"),
    compulsoryChecks: jsonb("compulsory_checks").notNull().default([]),
    matchedSkills: jsonb("matched_skills").$type<string[]>().notNull().default([]),
    missingRequiredSkills: jsonb("missing_required_skills").$type<string[]>().notNull().default([]),
    evidence: jsonb("evidence").$type<string[]>().notNull().default([]),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    reusedFromPreparationRunId: uuid("reused_from_preparation_run_id").references(
      (): AnyPgColumn => candidatePreparationRuns.id,
      { onDelete: "set null" },
    ),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
    failureReason: text("failure_reason"),
  },
  (table) => [
    index("candidate_preparation_runs_org_idx").on(table.organisationId),
    check(
      "candidate_preparation_runs_score_range",
      sql`${table.preliminaryScore} IS NULL OR (${table.preliminaryScore} >= 0 AND ${table.preliminaryScore} <= 100)`,
    ),
    check(
      "candidate_preparation_runs_date_order",
      sql`${table.startedAt} IS NULL OR ${table.completedAt} IS NULL OR ${table.startedAt} <= ${table.completedAt}`,
    ),
  ],
);

export const candidateAssessmentBatches = pgTable(
  "candidate_assessment_batches",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    vacancyId: uuid("vacancy_id")
      .notNull()
      .references(() => vacancies.id, { onDelete: "restrict" }),
    vacancyRecordVersion: integer("vacancy_record_version").notNull(),
    targetSize: integer("target_size").notNull(),
    rankedCandidateIds: jsonb("ranked_candidate_ids").$type<string[]>().notNull().default([]),
    selectedCandidateIds: jsonb("selected_candidate_ids").$type<string[]>().notNull().default([]),
    recommendedCandidateIds: jsonb("recommended_candidate_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    hrAddedCandidateIds: jsonb("hr_added_candidate_ids").$type<string[]>().notNull().default([]),
    preparationRunIds: jsonb("preparation_run_ids").$type<string[]>().notNull().default([]),
    detailedScoreIds: jsonb("detailed_score_ids").$type<string[]>().notNull().default([]),
    status: text("status").notNull(),
  },
  (table) => [
    index("candidate_assessment_batches_org_idx").on(table.organisationId),
    check(
      "candidate_assessment_batches_target_size",
      sql`${table.targetSize} >= 1 AND ${table.targetSize} <= 10`,
    ),
  ],
);

export const candidateAssessmentInclusions = pgTable(
  "candidate_assessment_inclusions",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    vacancyId: uuid("vacancy_id")
      .notNull()
      .references(() => vacancies.id, { onDelete: "restrict" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "restrict" }),
    cvRecordId: uuid("cv_record_id")
      .notNull()
      .references(() => candidateCvRecords.id, { onDelete: "restrict" }),
    source: text("source").notNull(),
    reason: text("reason").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (table) => [index("candidate_assessment_inclusions_org_idx").on(table.organisationId)],
);

export const candidateScoreRuns = pgTable(
  "candidate_score_runs",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    vacancyId: uuid("vacancy_id")
      .notNull()
      .references(() => vacancies.id, { onDelete: "restrict" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "restrict" }),
    applicationId: uuid("application_id").references(() => candidateApplications.id, {
      onDelete: "restrict",
    }),
    cvRecordId: uuid("cv_record_id").references(() => candidateCvRecords.id, {
      onDelete: "restrict",
    }),
    cvFileId: uuid("cv_file_id").references(() => recruitmentDocuments.id, {
      onDelete: "restrict",
    }),
    vacancyRecordVersion: integer("vacancy_record_version"),
    assessmentBatchId: uuid("assessment_batch_id").references(() => candidateAssessmentBatches.id, {
      onDelete: "restrict",
    }),
    timestamp: timestamp("timestamp", { withTimezone: true, mode: "string" }).notNull(),
    modelRulesVersion: text("model_rules_version").notNull(),
    vacancyVersion: text("vacancy_version").notNull(),
    overallScore: numeric("overall_score").notNull(),
    categoryScores: jsonb("category_scores").notNull().default({}),
    strengths: jsonb("strengths").$type<string[]>().notNull().default([]),
    risks: jsonb("risks").$type<string[]>().notNull().default([]),
    missingData: jsonb("missing_data").$type<string[]>().notNull().default([]),
    evidence: text("evidence").notNull(),
  },
  (table) => [
    index("candidate_score_runs_org_idx").on(table.organisationId),
    check(
      "candidate_score_runs_positive",
      sql`${table.overallScore} >= 0 AND ${table.overallScore} <= 100`,
    ),
  ],
);

export const candidateInterviewRecommendations = pgTable(
  "candidate_interview_recommendations",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "restrict" }),
    vacancyId: uuid("vacancy_id")
      .notNull()
      .references(() => vacancies.id, { onDelete: "restrict" }),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => candidateApplications.id, { onDelete: "restrict" }),
    cvRecordId: uuid("cv_record_id").references(() => candidateCvRecords.id, {
      onDelete: "restrict",
    }),
    recommendedByUserId: uuid("recommended_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    assessmentScoreId: uuid("assessment_score_id").references(() => candidateScoreRuns.id, {
      onDelete: "set null",
    }),
    assessmentSource: text("assessment_source"),
    screeningDecision: text("screening_decision"),
    status: text("status").notNull(),
  },
  (table) => [index("candidate_interview_recommendations_org_idx").on(table.organisationId)],
);

export const contactChannel = pgEnum("contact_channel", [
  "Email",
  "Phone",
  "LinkedIn",
  "In-Person",
  "Other",
]);
export const contactOutcome = pgEnum("contact_outcome", [
  "No Answer",
  "Interested",
  "Not Interested",
  "Follow-up Required",
  "Interview Arranged",
  "Unavailable",
  "Invalid Contact",
  "Do Not Contact",
]);

export const candidateContacts = pgTable(
  "candidate_contacts",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "restrict" }),
    channel: contactChannel("channel").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    contactedByUserId: uuid("contacted_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    vacancyId: uuid("vacancy_id").references(() => vacancies.id, { onDelete: "restrict" }),
    outcome: contactOutcome("outcome").notNull(),
    notes: text("notes").notNull(),
    nextFollowUpDate: date("next_follow_up_date", { mode: "string" }),
  },
  (table) => [
    index("candidate_contacts_org_candidate_idx").on(table.organisationId, table.candidateId),
  ],
);

export const shortlistSnapshots = pgTable(
  "shortlist_snapshots",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    vacancyId: uuid("vacancy_id")
      .notNull()
      .references(() => vacancies.id, { onDelete: "restrict" }),
    targetSize: integer("target_size").notNull(),
    rankedCandidateIds: jsonb("ranked_candidate_ids").$type<string[]>().notNull().default([]),
    selectedCandidateIds: jsonb("selected_candidate_ids").$type<string[]>().notNull().default([]),
    pinnedCandidateIds: jsonb("pinned_candidate_ids").$type<string[]>(),
    unselectedAction: text("unselected_action"),
    overrides: jsonb("overrides").notNull().default([]),
    status: text("status").notNull(),
  },
  (table) => [
    index("shortlist_snapshots_org_idx").on(table.organisationId),
    check(
      "shortlist_snapshots_size_check",
      sql`${table.targetSize} >= 1 AND ${table.targetSize} <= 10`,
    ),
  ],
);

export const interviewStatus = pgEnum("interview_status", [
  "Proposed",
  "Awaiting Candidate",
  "Scheduled",
  "Completed",
  "Cancelled",
  "No Show",
]);

export const interviewTemplates = pgTable(
  "interview_templates",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    criteria: jsonb("criteria").notNull().default([]),
    blindScoring: boolean("blind_scoring").notNull().default(false),
    vacancyId: uuid("vacancy_id").references(() => vacancies.id, { onDelete: "restrict" }),
    stageName: text("stage_name"),
    aiDecisionWeight: numeric("ai_decision_weight").notNull().default("0"),
    interviewDecisionWeight: numeric("interview_decision_weight").notNull().default("100"),
  },
  (table) => [
    index("interview_templates_org_idx").on(table.organisationId),
    check(
      "interview_templates_weights",
      sql`${table.aiDecisionWeight} >= 0 AND ${table.aiDecisionWeight} <= 100 AND ${table.interviewDecisionWeight} >= 0 AND ${table.interviewDecisionWeight} <= 100 AND ${table.aiDecisionWeight} + ${table.interviewDecisionWeight} = 100`,
    ),
  ],
);

export const interviews = pgTable(
  "interviews",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    vacancyId: uuid("vacancy_id").references(() => vacancies.id, { onDelete: "restrict" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "restrict" }),
    templateId: uuid("template_id").references(() => interviewTemplates.id, {
      onDelete: "restrict",
    }),
    source: text("source"),
    positionTitle: text("position_title"),
    projectName: text("project_name"),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }),
    manualOutcome: text("manual_outcome"),
    manualDecisionReason: text("manual_decision_reason"),
    stageName: text("stage_name").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    location: text("location").notNull(),
    videoMethod: text("video_method").notNull(),
    notes: text("notes").notNull(),
    status: interviewStatus("status").notNull(),
    confirmedSlot: jsonb("confirmed_slot"),
    proposedSlots: jsonb("proposed_slots").notNull().default([]),
    calendarEventReference: text("calendar_event_reference"),
    meetingReference: text("meeting_reference"),
    meetingJoinUrl: text("meeting_join_url"),
    invitationDeliveryReferences: jsonb("invitation_delivery_references").$type<string[]>(),
    candidateResponseStatus: text("candidate_response_status"),
    history: jsonb("history").notNull().default([]),
  },
  (table) => [
    index("interviews_org_status_idx").on(table.organisationId, table.status),
    index("interviews_org_candidate_idx").on(table.organisationId, table.candidateId),
    check("interviews_duration_positive", sql`${table.durationMinutes} > 0`),
  ],
);

export const interviewPanelists = pgTable(
  "interview_panelists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    interviewId: uuid("interview_id")
      .notNull()
      .references(() => interviews.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    role: text("role"),
  },
  (table) => [uniqueIndex("interview_panelists_unique_idx").on(table.interviewId, table.userId)],
);

export const interviewDispositionOutcome = pgEnum("interview_disposition_outcome", [
  "Proceed to Next Interview",
  "Recommend for Offer",
  "Future Consideration",
  "Recommend for Another Role",
  "Place on Hold",
  "Do Not Proceed",
  "Candidate Withdrew",
  "No Show",
]);

export const interviewDispositions = pgTable(
  "interview_dispositions",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    interviewId: uuid("interview_id")
      .notNull()
      .references(() => interviews.id, { onDelete: "restrict" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "restrict" }),
    vacancyId: uuid("vacancy_id").references(() => vacancies.id, { onDelete: "restrict" }),
    outcome: interviewDispositionOutcome("outcome").notNull(),
    reason: text("reason").notNull(),
    futureVacancyIds: jsonb("future_vacancy_ids").$type<string[]>().notNull().default([]),
    suggestedRoleTitles: jsonb("suggested_role_titles").$type<string[]>().notNull().default([]),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
    recordedByUserId: uuid("recorded_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
  },
  (table) => [index("interview_dispositions_org_idx").on(table.organisationId)],
);

export const scorecardRecommendation = pgEnum("scorecard_recommendation", [
  "Strong Yes",
  "Yes",
  "Unsure",
  "No",
]);

export const interviewScorecards = pgTable(
  "interview_scorecards",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    interviewId: uuid("interview_id")
      .notNull()
      .references(() => interviews.id, { onDelete: "restrict" }),
    panelUserId: uuid("panel_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    scores: jsonb("scores").notNull().default([]),
    overallRecommendation: scorecardRecommendation("overall_recommendation"),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }),
    revisionHistory: jsonb("revision_history").notNull().default([]),
  },
  (table) => [
    uniqueIndex("interview_scorecards_interview_panel_unique").on(
      table.interviewId,
      table.panelUserId,
    ),
    index("interview_scorecards_org_idx").on(table.organisationId),
  ],
);

export const hiringDecisions = pgTable(
  "hiring_decisions",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    vacancyId: uuid("vacancy_id")
      .notNull()
      .references(() => vacancies.id, { onDelete: "restrict" }),
    systemRecommendedCandidateId: uuid("system_recommended_candidate_id").references(
      () => candidates.id,
      { onDelete: "restrict" },
    ),
    finalSelectedCandidateId: uuid("final_selected_candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "restrict" }),
    overrideReason: text("override_reason"),
    waiverReason: text("waiver_reason"),
    decisionSource: text("decision_source"),
    interviewId: uuid("interview_id").references(() => interviews.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
  },
  (table) => [index("hiring_decisions_org_idx").on(table.organisationId)],
);

export const jobOfferStatus = pgEnum("job_offer_status", [
  "Draft",
  "Pending Approval",
  "Approved",
  "Ready to Send",
  "Sent",
  "Accepted",
  "Declined",
  "Expired",
  "Withdrawn",
]);

export const jobOffers = pgTable(
  "job_offers",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "restrict" }),
    vacancyId: uuid("vacancy_id")
      .notNull()
      .references(() => vacancies.id, { onDelete: "restrict" }),
    status: jobOfferStatus("status").notNull(),
    template: text("template").notNull(),
    position: text("position").notNull(),
    grade: text("grade").notNull(),
    salaryEncrypted: text("salary_encrypted").notNull(),
    currencyEncrypted: text("currency_encrypted").notNull(),
    allowancesEncrypted: text("allowances_encrypted").notNull(),
    benefitsEncrypted: text("benefits_encrypted").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    probation: text("probation").notNull(),
    location: text("location").notNull(),
    conditions: text("conditions").notNull(),
    sentDate: timestamp("sent_date", { withTimezone: true, mode: "string" }),
    deliveryReference: text("delivery_reference"),
    responseDeadline: timestamp("response_deadline", { withTimezone: true, mode: "string" }),
    declineReason: text("decline_reason"),
    history: jsonb("history").notNull().default([]),
    convertedToEmployeeId: uuid("converted_to_employee_id").references(() => employees.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    index("job_offers_org_status_idx").on(table.organisationId, table.status),
    check("job_offers_salary_not_blank", sql`btrim(${table.salaryEncrypted}) <> ''`),
    check("job_offers_currency_not_blank", sql`btrim(${table.currencyEncrypted}) <> ''`),
    check(
      "job_offers_response_after_sent",
      sql`${table.responseDeadline} IS NULL OR ${table.sentDate} IS NULL OR ${table.responseDeadline} >= ${table.sentDate}`,
    ),
    check("job_offers_record_version_positive", sql`${table.recordVersion} >= 1`),
  ],
);
