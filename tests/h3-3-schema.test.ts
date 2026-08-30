import assert from "node:assert/strict";
import { test } from "node:test";

import { getTableName } from "drizzle-orm";

import * as schema from "../src/lib/db/schema/index.ts";

test("H3.3 maps every structured product collection to a Drizzle table", () => {
  const collectionTables = {
    appSettings: schema.appSettings,
    users: schema.users,
    workspaceIdentityMappings: schema.workspaceIdentityMappings,
    portalSessions: schema.portalSessions,
    roles: schema.roles,
    employees: schema.employees,
    employmentChanges: schema.employmentChanges,
    employeeDocuments: schema.employeeDocuments,
    documentVersions: schema.documentVersions,
    vacancies: schema.vacancies,
    vacancyVersions: schema.vacancyVersions,
    candidates: schema.candidates,
    candidateContacts: schema.candidateContacts,
    recommendations: schema.candidateRecommendations,
    applications: schema.candidateApplications,
    candidateScores: schema.candidateScoreRuns,
    shortlistDecisions: schema.shortlistSnapshots,
    interviews: schema.interviews,
    scorecards: schema.interviewScorecards,
    offers: schema.jobOffers,
    leavePolicies: schema.leavePolicies,
    leaveBalances: schema.leaveBalances,
    leaveTransactions: schema.leaveTransactions,
    leaveRequests: schema.leaveRequests,
    projects: schema.projects,
    costCentres: schema.costCentres,
    timesheetPeriods: schema.timesheetPeriods,
    timesheets: schema.timesheets,
    timesheetEntries: schema.timesheetEntries,
    attendanceRecords: schema.attendanceRecords,
    attendanceCorrections: schema.attendanceCorrections,
    overtimeRequests: schema.overtimeClaims,
    travelRequests: schema.travelRequests,
    travelApprovals: schema.travelApprovals,
    expenseItems: schema.expenseItems,
    reimbursements: schema.reimbursements,
    payrollPeriods: schema.payrollPeriods,
    payrollInputs: schema.payrollInputs,
    onboardingCases: schema.onboardingCases,
    offboardingCases: schema.offboardingCases,
    workflowTasks: schema.workflowTasks,
    performanceCycles: schema.performanceCycles,
    performanceReviews: schema.performanceReviews,
    trainingCourses: schema.trainingCourses,
    trainingAssignments: schema.trainingAssignments,
    notifications: schema.notifications,
    auditEvents: schema.auditEvents,
    importBatches: schema.importBatches,
  };

  assert.equal(Object.keys(collectionTables).length, 48);
  for (const [collection, table] of Object.entries(collectionTables)) {
    assert.ok(getTableName(table), `${collection} must have a database table`);
  }
  assert.equal(new Set(Object.values(collectionTables).map(getTableName)).size, 48);
});

test("reportable embedded records are promoted to relational child tables", () => {
  assert.deepEqual(
    [
      schema.timesheetEntries,
      schema.expenseItems,
      schema.onboardingTasks,
      schema.offboardingTasks,
      schema.payrollExceptions,
      schema.payrollManualAdjustments,
    ].map(getTableName),
    [
      "timesheet_entries",
      "expense_items",
      "onboarding_tasks",
      "offboarding_tasks",
      "payroll_exceptions",
      "payroll_manual_adjustments",
    ],
  );
});
