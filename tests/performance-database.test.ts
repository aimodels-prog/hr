import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import postgres from "postgres";

import type { PerformanceReview } from "../src/lib/data/performance-types.ts";
import { closeDatabaseConnection } from "../src/lib/db/client.ts";
import {
  actOnPerformanceReviewInDatabase,
  archiveGoalInDatabase,
  changePerformanceCycleStatusInDatabase,
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
  async (t) => {
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
      const createCycle = (status: "Draft" | "Active" = "Active") =>
        savePerformanceCycleInDatabase(
          ids.org!,
          {
            name: `Objective gate ${randomUUID()}`,
            templateId: initial.templates[0]!.id,
            status,
            departments: [ids.department!],
            employmentTypes: [ids.employmentType!],
            selfAssessmentDeadline: "2026-11-30",
            managerReviewDeadline: "2026-12-15",
            discussionDeadline: "2026-12-31",
            requiresModeration: false,
          },
          hrActor,
        );
      const goalInput = (cycleId: string, weight: number) => ({
        employeeId: ids.employee!,
        cycleId,
        title: `Delivery objective ${weight}`,
        description: "Deliver the agreed measurable outcomes.",
        successMeasure: "Verified quarterly quality results.",
        targetValue: "At least 95 percent",
        startDate: "2026-09-01",
        dueDate: "2026-11-30",
        weight,
      });
      const addGoal = (cycleId: string, weight: number) =>
        saveGoalInDatabase(ids.org!, goalInput(cycleId, weight), employeeActor);
      const getReview = async (cycleId: string) =>
        (await listPerformanceForActor(ids.org!, employeeActor)).reviews.find(
          (item) =>
            item.cycleId === cycleId && item.employeeId === ids.employee && !item.archivedAt,
        )!;
      const rawReview = async (cycleId: string) =>
        (
          await sql`select * from performance_reviews where organisation_id=${ids.org} and employee_id=${ids.employee} and cycle_id=${cycleId} and archived_at is null`
        )[0]!;
      const submitSelf = async (cycleId: string) => {
        const review = await getReview(cycleId);
        return actOnPerformanceReviewInDatabase(
          ids.org!,
          review.id,
          review.recordVersion,
          { type: "self", sections: assessedSections(review.sections, "self") },
          employeeActor,
        );
      };
      const approve = (id: string) =>
        decideGoalInDatabase(ids.org!, id, "approve", undefined, managerActor);

      await t.test(
        "omitting the deadline cannot bypass objectives, including legacy self-assessment rows",
        async () => {
          const cycle = await createCycle();
          assert.equal((await rawReview(cycle)).status, "Objectives Pending");
          await assert.rejects(submitSelf(cycle), /approve objectives totalling 100%/);
          await sql`update performance_reviews set status='Self Assessment Pending' where employee_id=${ids.employee} and cycle_id=${cycle}`;
          assert.equal((await getReview(cycle)).status, "Objectives Pending");
          await assert.rejects(submitSelf(cycle), /approve objectives totalling 100%/);
          assert.equal((await rawReview(cycle)).overall_self_score, null);
          assert.equal((await rawReview(cycle)).record_version, 1);
        },
      );
      await t.test(
        "returned objectives can be resubmitted without resetting approved objectives",
        async () => {
          const cycle = await createCycle(),
            first = await addGoal(cycle, 60),
            second = await addGoal(cycle, 40);
          await submitGoalsInDatabase(ids.org!, ids.employee!, cycle, employeeActor);
          await approve(first);
          await assert.rejects(submitSelf(cycle), /approve objectives totalling 100%/);
          await decideGoalInDatabase(
            ids.org!,
            second,
            "return",
            "Clarify the success measure.",
            managerActor,
          );
          const [before] = await sql`select * from employee_goals where id=${first}`;
          await saveGoalInDatabase(
            ids.org!,
            { ...goalInput(cycle, 40), goalId: second, targetValue: "At least 97 percent" },
            employeeActor,
          );
          await submitGoalsInDatabase(ids.org!, ids.employee!, cycle, employeeActor);
          assert.deepEqual((await sql`select * from employee_goals where id=${first}`)[0], before);
          const [notices] = await sql`select count(*)::integer as count from notifications
            where organisation_id=${ids.org} and recipient_user_id=${ids.managerUser}
              and type='performance-objectives' and link->>'entityId'=${cycle}`;
          assert.equal(
            notices!.count,
            2,
            "A returned set must notify the manager again when resubmitted.",
          );
          await approve(second);
          assert.equal((await rawReview(cycle)).status, "Self Assessment Pending");
          const ready = await getReview(cycle);
          assert.ok(
            ready.sections
              .flatMap((section) => section.items)
              .some((item) => item.description.includes("97 percent")),
          );
        },
      );
      await t.test(
        "simultaneous final approvals reliably open self-assessment exactly once",
        async () => {
          for (let attempt = 0; attempt < 3; attempt++) {
            const cycle = await createCycle(),
              first = await addGoal(cycle, 60),
              second = await addGoal(cycle, 40);
            await submitGoalsInDatabase(ids.org!, ids.employee!, cycle, employeeActor);
            await Promise.all([approve(first), approve(second)]);
            const saved = await rawReview(cycle);
            assert.equal(saved.status, "Self Assessment Pending");
            assert.equal(saved.record_version, 2);
            const goalItems = (await getReview(cycle)).sections
              .flatMap((section) => section.items)
              .filter((item) => item.templateItemId.startsWith("goal-"));
            assert.deepEqual(
              goalItems.map((item) => item.templateItemId).sort(),
              [`goal-${first}`, `goal-${second}`].sort(),
            );
          }
        },
      );
      await t.test(
        "incomplete imported approvals and concurrent overweight inserts cannot bypass the gate",
        async () => {
          const cycle = await createCycle(),
            only = await addGoal(cycle, 50);
          await assert.rejects(
            submitGoalsInDatabase(ids.org!, ids.employee!, cycle, employeeActor),
            /total 100%/,
          );
          await sql`update employee_goals set status='Pending Approval' where id=${only}`;
          await approve(only);
          assert.equal((await rawReview(cycle)).status, "Objectives Pending");
          await assert.rejects(submitSelf(cycle), /approve objectives totalling 100%/);
          const concurrentCycle = await createCycle();
          const results = await Promise.allSettled([
            addGoal(concurrentCycle, 60),
            addGoal(concurrentCycle, 60),
          ]);
          assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
          const [total] =
            await sql`select sum(weight)::integer as weight from employee_goals where cycle_id=${concurrentCycle} and employee_id=${ids.employee}`;
          assert.equal(total!.weight, 60);
        },
      );
      await t.test(
        "approved goals before launch open immediately even with an objectives deadline",
        async () => {
          const cycle = await createCycle("Draft");
          await sql`update performance_cycles set objective_setting_deadline='2026-09-30' where id=${cycle}`;
          await sql`insert into employee_goals (organisation_id,employee_id,cycle_id,title,description,success_measure,target_value,start_date,due_date,weight,status,approved_at,approved_by,created_by,updated_by)
          values (${ids.org},${ids.employee},${cycle},'Existing agreed objective','Deliver agreed work','Measured quarterly','95 percent','2026-09-01','2026-11-30',100,'Active',now(),${ids.managerUser},${ids.employeeUser},${ids.employeeUser})`;
          await changePerformanceCycleStatusInDatabase(ids.org!, cycle, "Active", 1, hrActor);
          assert.equal((await rawReview(cycle)).status, "Self Assessment Pending");
          const other = await createCycle();
          await assert.rejects(submitSelf(other), /approve objectives totalling 100%/);
        },
      );
      await t.test(
        "completion-pending objectives remain approved and appraised targets cannot be rewritten",
        async () => {
          const cycle = await createCycle(),
            goal = await addGoal(cycle, 100);
          await submitGoalsInDatabase(ids.org!, ids.employee!, cycle, employeeActor);
          await approve(goal);
          await recordGoalProgressInDatabase(
            ids.org!,
            goal,
            100,
            "Outcome is ready for confirmation.",
            undefined,
            employeeActor,
          );
          assert.equal((await getReview(cycle)).status, "Self Assessment Pending");
          await submitSelf(cycle);
          const before = await rawReview(cycle);
          await decideGoalInDatabase(
            ids.org!,
            goal,
            "return",
            "Please provide the final evidence.",
            managerActor,
          );
          assert.equal(
            (await sql`select status from employee_goals where id=${goal}`)[0]!.status,
            "Active",
          );
          await assert.rejects(
            saveGoalInDatabase(
              ids.org!,
              { ...goalInput(cycle, 100), goalId: goal, targetValue: "Changed after appraisal" },
              employeeActor,
            ),
            /cannot change after self-assessment/,
          );
          await assert.rejects(
            archiveGoalInDatabase(ids.org!, goal, employeeActor),
            /cannot change after self-assessment/,
          );
          await assert.rejects(addGoal(cycle, 1), /cannot change after self-assessment/);
          assert.deepEqual(await rawReview(cycle), before);
        },
      );
      await t.test(
        "objective identity, cycle participation, archived goals and closed cycles are enforced",
        async () => {
          const cycle = await createCycle(),
            goal = await addGoal(cycle, 100),
            otherCycle = await createCycle();
          await assert.rejects(
            saveGoalInDatabase(
              ids.org!,
              { ...goalInput(otherCycle, 100), goalId: goal },
              employeeActor,
            ),
            /does not belong/,
          );
          await assert.rejects(
            saveGoalInDatabase(
              ids.org!,
              { ...goalInput(cycle, 100), employeeId: ids.otherManager!, goalId: goal },
              otherManagerActor,
            ),
            /does not belong/,
          );
          await archiveGoalInDatabase(ids.org!, goal, employeeActor);
          await assert.rejects(approve(goal), /not found/);
          await assert.rejects(
            saveGoalInDatabase(ids.org!, { ...goalInput(cycle, 100), goalId: goal }, employeeActor),
            /does not belong/,
          );
          await assert.rejects(submitSelf(cycle), /approve objectives totalling 100%/);
          const replacement = await addGoal(cycle, 100);
          await sql`update performance_cycles set status='Completed' where id=${cycle}`;
          await assert.rejects(
            submitGoalsInDatabase(ids.org!, ids.employee!, cycle, employeeActor),
            /active performance cycle/,
          );
          await assert.rejects(
            archiveGoalInDatabase(ids.org!, replacement, employeeActor),
            /active performance cycle/,
          );
          await sql`update performance_reviews set archived_at=now() where employee_id=${ids.employee} and cycle_id=${otherCycle}`;
          await assert.rejects(addGoal(otherCycle, 100), /not included/);
        },
      );
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
      assert.equal(snapshot.goals.filter((goal) => goal.cycleId === cycleId).length, 2);
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
      await closeDatabaseConnection();
    }
  },
);
