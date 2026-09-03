import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import postgres from "postgres";

import {
  addTrainingRecordInDatabase,
  completeTrainingAssignmentInDatabase,
  createTrainingRequestInDatabase,
  decideTrainingRecordInDatabase,
  decideTrainingRequestInDatabase,
  listTrainingForActor,
  processTrainingAutomationInDatabase,
  recordTrainingAttendanceInDatabase,
  saveTrainingCourseInDatabase,
  saveTrainingSessionInDatabase,
  scheduleTrainingAssignmentInDatabase,
} from "../src/lib/db/repositories/training.repository.server.ts";

const testDatabaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (testDatabaseUrl) process.env["DATABASE_URL"] = testDatabaseUrl;

test(
  "training requests, assignments, certificates and automation are role-safe in PostgreSQL",
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
        "project",
        "costCentre",
        "currency",
        "employee",
        "employeeUser",
        "manager",
        "managerUser",
        "otherManager",
        "otherManagerUser",
        "hr",
        "hrUser",
        "certificate",
      ].map((key) => [key, randomUUID()]),
    ) as Record<string, string>;
    const actor = (
      user: string,
      employee: string,
      activeRole: "Employee" | "Line Manager" | "HR",
    ) => ({
      userId: ids[user],
      employeeId: ids[employee],
      displayName: `${activeRole} training actor`,
      activeRole,
      roles: activeRole === "Employee" ? ["Employee"] : ["Employee", activeRole],
    });
    const employeeActor = actor("employeeUser", "employee", "Employee");
    const managerActor = actor("managerUser", "manager", "Line Manager");
    const otherManagerActor = actor("otherManagerUser", "otherManager", "Line Manager");
    const hrActor = actor("hrUser", "hr", "HR");
    const today = new Date().toISOString().slice(0, 10);
    const future = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const futureEnd = new Date(Date.now() + 2 * 86_400_000 + 3_600_000).toISOString();
    try {
      await sql`INSERT INTO organisations (id,name,slug,is_active,created_by,updated_by) VALUES (${ids.org},'Training Test',${`training-${ids.org}`},true,${ids.hrUser},${ids.hrUser})`;
      for (const [table, key, name, code] of [
        ["departments", "department", "Operations", "OPS"],
        ["positions", "position", "Specialist", "SPEC"],
        ["employment_types", "employmentType", "Full-time", "FT"],
        ["cost_centres", "costCentre", "Operations", "CC-OPS"],
      ] as const)
        await sql.unsafe(
          `INSERT INTO ${table} (id,organisation_id,name,code,is_active,order_index,created_by,updated_by) VALUES ($1,$2,$3,$4,true,1,$5,$5)`,
          [ids[key], ids.org, name, code, ids.hrUser],
        );
      await sql`INSERT INTO locations (id,organisation_id,name,code,is_active,order_index,latitude,longitude,radius_meters,is_clock_in_site,created_by,updated_by) VALUES (${ids.location},${ids.org},'Dubai Office','DXB',true,1,25.2,55.27,150,true,${ids.hrUser},${ids.hrUser})`;
      await sql`INSERT INTO currencies (id,organisation_id,name,code,is_active,order_index,symbol,decimal_places,created_by,updated_by) VALUES (${ids.currency},${ids.org},'UAE Dirham','AED',true,1,'AED',2,${ids.hrUser},${ids.hrUser})`;
      await sql`INSERT INTO projects (id,organisation_id,name,code,is_active,order_index,cost_centre_id,created_by,updated_by) VALUES (${ids.project},${ids.org},'GCC Operations','GCC-OPS',true,1,${ids.costCentre},${ids.hrUser},${ids.hrUser})`;
      for (const [employeeKey, userKey, name, managerId] of [
        ["manager", "managerUser", "Line Manager", null],
        ["employee", "employeeUser", "Employee", ids.manager],
        ["otherManager", "otherManagerUser", "Other Manager", null],
        ["hr", "hrUser", "HR Partner", null],
      ] as const) {
        await sql`INSERT INTO employees (id,organisation_id,employee_number,legal_name,preferred_name,work_email,department_id,position_id,location_id,employment_type_id,line_manager_id,project_id,cost_centre_id,status,start_date,created_by,updated_by) VALUES (${ids[employeeKey]},${ids.org},${`TR-${ids[employeeKey]!.slice(0, 6)}`},${name},${name},${`${ids[employeeKey]}@viahr.test`},${ids.department},${ids.position},${ids.location},${ids.employmentType},${managerId},${ids.project},${ids.costCentre},'Active','2025-01-01',${ids.hrUser},${ids.hrUser})`;
        await sql`INSERT INTO users (id,organisation_id,employee_id,display_name,workspace_email,status,created_by,updated_by) VALUES (${ids[userKey]},${ids.org},${ids[employeeKey]},${name},${`${ids[employeeKey]}@viahr.test`},'Active',${ids.hrUser},${ids.hrUser})`;
      }
      const roleRows = await sql<
        { id: string; code: string }[]
      >`SELECT id,code FROM roles WHERE code IN ('Employee','Line Manager','HR')`;
      const roleIds = Object.fromEntries(roleRows.map((row) => [row.code, row.id]));
      for (const [userKey, codes] of [
        ["employeeUser", ["Employee"]],
        ["managerUser", ["Employee", "Line Manager"]],
        ["otherManagerUser", ["Employee", "Line Manager"]],
        ["hrUser", ["Employee", "HR"]],
      ] as const)
        for (const code of codes)
          await sql`INSERT INTO user_roles (organisation_id,user_id,role_id,assigned_by,reason) VALUES (${ids.org},${ids[userKey]},${roleIds[code]},${ids.hrUser},'Training test access') ON CONFLICT DO NOTHING`;

      const courseId = await saveTrainingCourseInDatabase(
        ids.org!,
        {
          code: "SAFE-101",
          title: "Operational Safety Essentials",
          description: "Practical operational safety and incident prevention for VIA teams.",
          provider: "VIA Academy",
          category: "Safety",
          deliveryType: "Classroom",
          durationHours: 8,
          cost: 150,
          currency: "AED",
          validityMonths: 12,
          renewalIntervalMonths: 12,
          requiredRoles: [],
          requiredLocations: [],
          requiredProjects: [],
          isMandatory: false,
          isActive: true,
        },
        hrActor,
      );
      const requestId = await createTrainingRequestInDatabase(
        ids.org!,
        {
          employeeId: ids.employee!,
          courseId,
          reason: "Build practical safety knowledge for site operations.",
          origin: "Employee Request",
        },
        employeeActor,
      );
      await assert.rejects(
        () =>
          decideTrainingRequestInDatabase(
            ids.org!,
            requestId,
            "Supervisor",
            "Approve",
            "Supported for development",
            otherManagerActor,
          ),
        /assigned supervisor/i,
      );
      await decideTrainingRequestInDatabase(
        ids.org!,
        requestId,
        "Supervisor",
        "Approve",
        "Supported for operational development",
        managerActor,
      );
      await decideTrainingRequestInDatabase(
        ids.org!,
        requestId,
        "HR",
        "Approve",
        "Budget and development need approved",
        hrActor,
      );
      let snapshot = await listTrainingForActor(ids.org!, hrActor);
      const assignment = snapshot.enrollments.find((item) => item.requestId === requestId)!;
      assert.equal(assignment.status, "Assigned");
      const sessionId = await saveTrainingSessionInDatabase(
        ids.org!,
        {
          courseId,
          title: "September safety workshop",
          startAt: future,
          endAt: futureEnd,
          location: "Dubai training room",
          facilitator: "VIA Safety Lead",
          capacity: 1,
        },
        hrActor,
      );
      await scheduleTrainingAssignmentInDatabase(ids.org!, assignment.id, sessionId, hrActor);
      await sql`UPDATE training_sessions SET start_at=now()-interval '2 days',end_at=now()-interval '1 day' WHERE id=${sessionId}`;
      await assert.rejects(
        () =>
          recordTrainingAttendanceInDatabase(
            ids.org!,
            assignment.id,
            true,
            "Attendance confirmed",
            employeeActor,
          ),
        /Only HR or Super Admin/i,
      );
      await recordTrainingAttendanceInDatabase(
        ids.org!,
        assignment.id,
        true,
        "Attendance confirmed",
        hrActor,
      );
      const completionRecordId = await completeTrainingAssignmentInDatabase(
        ids.org!,
        assignment.id,
        "Passed",
        today,
        145,
        hrActor,
      );
      assert.ok(completionRecordId);

      const manualRecordId = randomUUID();
      await sql`INSERT INTO file_metadata (id,organisation_id,name,mime_type,size,checksum,storage_key,storage_status,owner_entity_type,owner_entity_id,created_by,updated_by) VALUES (${ids.certificate},${ids.org},'certificate.pdf','application/pdf',4,'training-test',${`tests/training/${ids.certificate}`},'Available','training-record',${manualRecordId},${ids.employeeUser},${ids.employeeUser})`;
      await addTrainingRecordInDatabase(
        ids.org!,
        {
          recordId: manualRecordId,
          employeeId: ids.employee!,
          title: "International Trade Compliance",
          provider: "GCC Logistics Institute",
          completionDate: today,
          expiryDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
          certificateFileId: ids.certificate!,
        },
        employeeActor,
      );
      await assert.rejects(
        () =>
          decideTrainingRecordInDatabase(
            ids.org!,
            manualRecordId,
            "Verify",
            "Certificate verified",
            employeeActor,
          ),
        /Only HR or Super Admin/i,
      );
      await decideTrainingRecordInDatabase(
        ids.org!,
        manualRecordId,
        "Verify",
        "Certificate and completion details verified",
        hrActor,
      );

      const mandatoryCourseId = await saveTrainingCourseInDatabase(
        ids.org!,
        {
          code: "MAND-001",
          title: "Mandatory Workplace Conduct",
          description: "Required workplace conduct training for every active VIA employee.",
          provider: "VIA People Operations",
          category: "Compliance",
          deliveryType: "Self-paced",
          durationHours: 2,
          cost: 0,
          currency: "AED",
          requiredRoles: ["Employee"],
          requiredLocations: [ids.location!],
          requiredProjects: [],
          isMandatory: true,
          isActive: true,
        },
        hrActor,
      );
      assert.ok(mandatoryCourseId);
      const firstWorker = await processTrainingAutomationInDatabase(ids.org!, hrActor, today);
      const secondWorker = await processTrainingAutomationInDatabase(ids.org!, hrActor, today);
      assert.equal(firstWorker.assignmentsCreated, 4);
      assert.equal(secondWorker.assignmentsCreated, 0);
      assert.ok(firstWorker.remindersCreated >= 3);
      assert.equal(secondWorker.remindersCreated, 0);

      snapshot = await listTrainingForActor(ids.org!, employeeActor);
      assert.ok(snapshot.records.some((item) => item.id === manualRecordId && item.hrVerified));
      const unrelated = await listTrainingForActor(ids.org!, otherManagerActor);
      assert.equal(
        unrelated.records.some((item) => item.employeeId === ids.employee),
        false,
      );
      const [counts] = await sql`
        SELECT
          (SELECT count(*)::int FROM audit_events WHERE organisation_id=${ids.org} AND module='training') AS audits,
          (SELECT count(*)::int FROM notifications WHERE organisation_id=${ids.org} AND type='training') AS notifications,
          (SELECT count(*)::int FROM training_assignments WHERE organisation_id=${ids.org} AND course_id=${mandatoryCourseId}) AS mandatory_assignments
      `;
      assert.ok(counts!.audits >= 15);
      assert.ok(counts!.notifications >= 10);
      assert.equal(counts!.mandatory_assignments, 4);
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);
