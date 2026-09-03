import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import postgres from "postgres";

import type { PerformanceReview } from "../src/lib/data/performance-types.ts";
import {
  actOnPerformanceReviewInDatabase,
  decideGoalInDatabase,
  listPerformanceForActor,
  recordGoalProgressInDatabase,
  saveGoalInDatabase,
  savePerformanceCycleInDatabase,
  submitGoalsInDatabase,
} from "../src/lib/db/repositories/performance.repository.server.ts";

const testDatabaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (testDatabaseUrl) process.env["DATABASE_URL"] = testDatabaseUrl;

function assessedSections(
  sections: PerformanceReview["sections"],
  kind: "self" | "manager" | "both",
) {
  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) => ({
      ...item,
      ...(kind === "self" || kind === "both"
        ? { selfRating: 4, selfComment: "Delivered the agreed result with recorded evidence." }
        : {}),
      ...(kind === "manager" || kind === "both"
        ? { managerRating: 4, managerComment: "Performance was demonstrated consistently." }
        : {}),
    })),
  }));
}

test(
  "performance objectives and reviews preserve role scope, lifecycle and correction history",
  { skip: !testDatabaseUrl },
  async () => {
    assert.match(new URL(testDatabaseUrl!).pathname.slice(1).toLowerCase(), /(test|scratch)/);
    const sql = postgres(testDatabaseUrl!, { max: 5, prepare: false });
    const ids = Object.fromEntries(
      [
        "org",
        "department",
        "position",
        "employmentType",
        "location",
        "employee",
        "employeeUser",
        "manager",
        "managerUser",
        "otherManager",
        "otherManagerUser",
        "hr",
        "hrUser",
      ].map((key) => [key, randomUUID()]),
    ) as Record<string, string>;
    const actor = (
      user: string,
      employee: string,
      activeRole: "Employee" | "Line Manager" | "HR",
    ) => ({
      userId: ids[user],
      employeeId: ids[employee],
      displayName: `${activeRole} performance actor`,
      activeRole,
      roles: activeRole === "Employee" ? ["Employee"] : ["Employee", activeRole],
    });
    const employeeActor = actor("employeeUser", "employee", "Employee");
    const managerActor = actor("managerUser", "manager", "Line Manager");
    const otherManagerActor = actor("otherManagerUser", "otherManager", "Line Manager");
    const hrActor = actor("hrUser", "hr", "HR");

    try {
      await sql`INSERT INTO organisations (id,name,slug,is_active,created_by,updated_by) VALUES (${ids.org},'Performance Test',${`performance-${ids.org}`},true,${ids.hrUser},${ids.hrUser})`;
      for (const [table, key, name, code] of [
        ["departments", "department", "Operations", "OPS"],
        ["positions", "position", "Specialist", "SPEC"],
        ["employment_types", "employmentType", "Full-time", "FT"],
      ] as const)
        await sql.unsafe(
          `INSERT INTO ${table} (id,organisation_id,name,code,is_active,order_index,created_by,updated_by) VALUES ($1,$2,$3,$4,true,1,$5,$5)`,
          [ids[key], ids.org, name, code, ids.hrUser],
        );
      await sql`INSERT INTO locations (id,organisation_id,name,code,is_active,order_index,latitude,longitude,radius_meters,is_clock_in_site,created_by,updated_by) VALUES (${ids.location},${ids.org},'Dubai Office','DXB',true,1,25.2,55.27,150,true,${ids.hrUser},${ids.hrUser})`;
      for (const [employeeKey, userKey, name, managerId] of [
        ["manager", "managerUser", "Line Manager", null],
        ["employee", "employeeUser", "Employee", ids.manager],
        ["otherManager", "otherManagerUser", "Other Manager", null],
        ["hr", "hrUser", "HR Partner", null],
      ] as const) {
        await sql`INSERT INTO employees (id,organisation_id,employee_number,legal_name,preferred_name,work_email,department_id,position_id,location_id,employment_type_id,line_manager_id,status,start_date,created_by,updated_by) VALUES (${ids[employeeKey]},${ids.org},${`PF-${ids[employeeKey]!.slice(0, 6)}`},${name},${name},${`${ids[employeeKey]}@viahr.test`},${ids.department},${ids.position},${ids.location},${ids.employmentType},${managerId},'Active','2025-01-01',${ids.hrUser},${ids.hrUser})`;
        await sql`INSERT INTO users (id,organisation_id,employee_id,display_name,workspace_email,status,created_by,updated_by) VALUES (${ids[userKey]},${ids.org},${ids[employeeKey]},${name},${`${ids[employeeKey]}@viahr.test`},'Active',${ids.hrUser},${ids.hrUser})`;
      }
      const roleRows = await sql<{ id: string; code: string }[]>`
        SELECT id,code FROM roles WHERE code IN ('Employee','Line Manager','HR')
      `;
      const roleIds = Object.fromEntries(roleRows.map((row) => [row.code, row.id]));
      for (const [userKey, codes] of [
        ["employeeUser", ["Employee"]],
        ["managerUser", ["Employee", "Line Manager"]],
        ["otherManagerUser", ["Employee", "Line Manager"]],
        ["hrUser", ["Employee", "HR"]],
      ] as const)
        for (const code of codes)
          await sql`INSERT INTO user_roles (organisation_id,user_id,role_id,assigned_by,reason) VALUES (${ids.org},${ids[userKey]},${roleIds[code]},${ids.hrUser},'Performance test access') ON CONFLICT DO NOTHING`;

      const initial = await listPerformanceForActor(ids.org!, hrActor);
      assert.equal(initial.templates.length, 1);
      const cycleId = await savePerformanceCycleInDatabase(
        ids.org!,
        {
          name: "2026 Annual Review",
          templateId: initial.templates[0]!.id,
          status: "Active",
          departments: [ids.department!],
          employmentTypes: [ids.employmentType!],
          objectiveSettingDeadline: "2026-09-30",
          selfAssessmentDeadline: "2026-11-30",
          managerReviewDeadline: "2026-12-15",
          discussionDeadline: "2026-12-31",
          requiresModeration: true,
          employeeCanSeeManagerRatings: true,
        },
        hrActor,
      );
      const goalIds = [];
      for (const [title, weight] of [
        ["Improve delivery accuracy", 60],
        ["Strengthen customer updates", 40],
      ] as const)
        goalIds.push(
          await saveGoalInDatabase(
            ids.org!,
            {
              employeeId: ids.employee!,
              cycleId,
              title,
              description: `${title} across the annual review period.`,
              successMeasure: "Achieve the agreed quarterly quality target.",
              targetValue: "At least 95 percent",
              startDate: "2026-09-01",
              dueDate: "2026-11-30",
              weight,
            },
            employeeActor,
          ),
        );
      await assert.rejects(
        () =>
          saveGoalInDatabase(
            ids.org!,
            {
              employeeId: ids.employee!,
              cycleId,
              title: "Unauthorised objective",
              description: "Attempt to write another employee record.",
              successMeasure: "This must be rejected by the repository.",
              targetValue: "Rejected",
              startDate: "2026-09-01",
              dueDate: "2026-11-30",
              weight: 10,
            },
            otherManagerActor,
          ),
        /only their own objectives/i,
      );
      await submitGoalsInDatabase(ids.org!, ids.employee!, cycleId, employeeActor);
      await assert.rejects(
        () => decideGoalInDatabase(ids.org!, goalIds[0]!, "approve", undefined, otherManagerActor),
        /assigned supervisor/i,
      );
      await decideGoalInDatabase(ids.org!, goalIds[0]!, "approve", undefined, managerActor);
      await decideGoalInDatabase(ids.org!, goalIds[1]!, "approve", undefined, managerActor);

      let snapshot = await listPerformanceForActor(ids.org!, employeeActor);
      let review = snapshot.reviews.find(
        (item) => item.employeeId === ids.employee && item.cycleId === cycleId && !item.archivedAt,
      )!;
      assert.equal(review.status, "Self Assessment Pending");
      assert.equal(snapshot.goals.length, 2);
      await actOnPerformanceReviewInDatabase(
        ids.org!,
        review.id,
        review.recordVersion,
        { type: "self", sections: assessedSections(review.sections, "self") },
        employeeActor,
      );
      snapshot = await listPerformanceForActor(ids.org!, managerActor);
      review = snapshot.reviews.find((item) => item.id === review.id)!;
      const managerAction = {
        type: "manager" as const,
        sections: assessedSections(review.sections, "manager"),
        summary: "The employee delivered strong and reliable results throughout the cycle.",
        developmentPlan: "Build broader planning responsibility during the next review period.",
      };
      const race = await Promise.allSettled([
        actOnPerformanceReviewInDatabase(
          ids.org!,
          review.id,
          review.recordVersion,
          managerAction,
          managerActor,
        ),
        actOnPerformanceReviewInDatabase(
          ids.org!,
          review.id,
          review.recordVersion,
          managerAction,
          managerActor,
        ),
      ]);
      assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);

      snapshot = await listPerformanceForActor(ids.org!, employeeActor);
      review = snapshot.reviews.find((item) => item.id === review.id)!;
      assert.equal(review.status, "Moderation Pending");
      assert.equal(review.managerSummaryComment, undefined);
      assert.equal(review.sections[0]?.items[0]?.managerComment, undefined);
      snapshot = await listPerformanceForActor(ids.org!, hrActor);
      review = snapshot.reviews.find((item) => item.id === review.id)!;
      await actOnPerformanceReviewInDatabase(
        ids.org!,
        review.id,
        review.recordVersion,
        { type: "moderate", comment: "Ratings are consistent with the submitted evidence." },
        hrActor,
      );
      snapshot = await listPerformanceForActor(ids.org!, managerActor);
      review = snapshot.reviews.find((item) => item.id === review.id)!;
      await actOnPerformanceReviewInDatabase(
        ids.org!,
        review.id,
        review.recordVersion,
        {
          type: "discussion",
          heldAt: "2026-09-01T08:00:00.000Z",
          notes: "The results, ratings and next-cycle development priorities were discussed.",
        },
        managerActor,
      );
      snapshot = await listPerformanceForActor(ids.org!, employeeActor);
      review = snapshot.reviews.find((item) => item.id === review.id)!;
      assert.ok(review.managerSummaryComment);
      await actOnPerformanceReviewInDatabase(
        ids.org!,
        review.id,
        review.recordVersion,
        { type: "acknowledge", agrees: false, comment: "I would like one rating reviewed." },
        employeeActor,
      );
      snapshot = await listPerformanceForActor(ids.org!, hrActor);
      review = snapshot.reviews.find((item) => item.id === review.id)!;
      await actOnPerformanceReviewInDatabase(
        ids.org!,
        review.id,
        review.recordVersion,
        { type: "lock" },
        hrActor,
      );
      snapshot = await listPerformanceForActor(ids.org!, hrActor);
      review = snapshot.reviews.find((item) => item.id === review.id)!;
      const correctedId = await actOnPerformanceReviewInDatabase(
        ids.org!,
        review.id,
        review.recordVersion,
        {
          type: "correct",
          sections: assessedSections(review.sections, "both"),
          summary: "The corrected final summary preserves the agreed performance outcome.",
          developmentPlan: "The corrected development plan records the agreed next steps.",
          reason: "Correct the recorded rating after HR verified the meeting notes.",
        },
        hrActor,
      );
      assert.notEqual(correctedId, review.id);

      await recordGoalProgressInDatabase(
        ids.org!,
        goalIds[0]!,
        100,
        "The delivery accuracy target was achieved.",
        undefined,
        employeeActor,
      );
      await decideGoalInDatabase(
        ids.org!,
        goalIds[0]!,
        "complete",
        "Completion evidence verified.",
        managerActor,
      );
      snapshot = await listPerformanceForActor(ids.org!, hrActor);
      const history = snapshot.reviews.filter(
        (item) => item.employeeId === ids.employee && item.cycleId === cycleId,
      );
      assert.equal(history.length, 2);
      assert.ok(history.some((item) => item.status === "Corrected" && item.archivedAt));
      assert.ok(history.some((item) => item.id === correctedId && item.status === "Locked"));
      const [counts] = await sql`
        SELECT
          (SELECT count(*)::int FROM audit_events WHERE organisation_id=${ids.org} AND module='performance') AS audits,
          (SELECT count(*)::int FROM notifications WHERE organisation_id=${ids.org}) AS notifications
      `;
      assert.ok(counts!.audits >= 15);
      assert.ok(counts!.notifications >= 8);
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);
