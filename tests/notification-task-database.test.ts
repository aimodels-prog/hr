import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import postgres from "postgres";

import {
  listNotificationsForUserInDatabase,
  setAllNotificationStatusesInDatabase,
  setNotificationStatusInDatabase,
} from "../src/lib/db/repositories/notification.repository.server.ts";
import {
  listTasksForActorInDatabase,
  processTaskAutomationInDatabase,
} from "../src/lib/db/repositories/task.repository.server.ts";

const testDatabaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (testDatabaseUrl) process.env["DATABASE_URL"] = testDatabaseUrl;

test(
  "notifications and task inboxes are PostgreSQL-authoritative and role scoped",
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
        "manager",
        "managerUser",
        "employee",
        "employeeUser",
        "policy",
        "request",
        "notification",
        "otherNotification",
      ].map((key) => [key, randomUUID()]),
    ) as Record<string, string>;
    const managerActor = {
      userId: ids.managerUser,
      employeeId: ids.manager,
      displayName: "Task Manager",
      activeRole: "Line Manager" as const,
      roles: ["Employee", "Line Manager"],
    };
    try {
      await sql`INSERT INTO organisations (id,name,slug,is_active,created_by,updated_by) VALUES (${ids.org},'Task Test',${`task-${ids.org}`},true,${ids.managerUser},${ids.managerUser})`;
      for (const [table, key, name, code] of [
        ["departments", "department", "Operations", "OPS"],
        ["positions", "position", "Coordinator", "COORD"],
        ["employment_types", "employmentType", "Full-time", "FT"],
      ] as const)
        await sql.unsafe(
          `INSERT INTO ${table} (id,organisation_id,name,code,is_active,order_index,created_by,updated_by) VALUES ($1,$2,$3,$4,true,1,$5,$5)`,
          [ids[key], ids.org, name, code, ids.managerUser],
        );
      await sql`INSERT INTO locations (id,organisation_id,name,code,is_active,order_index,latitude,longitude,radius_meters,is_clock_in_site,created_by,updated_by) VALUES (${ids.location},${ids.org},'Dubai Office','DXB',true,1,25.2,55.27,150,true,${ids.managerUser},${ids.managerUser})`;
      for (const [employee, user, number, name, manager] of [
        [ids.manager, ids.managerUser, "TASK-MGR", "Task Manager", null],
        [ids.employee, ids.employeeUser, "TASK-EMP", "Task Employee", ids.manager],
      ]) {
        await sql`INSERT INTO employees (id,organisation_id,employee_number,legal_name,preferred_name,work_email,department_id,position_id,location_id,employment_type_id,line_manager_id,status,start_date,created_by,updated_by) VALUES (${employee},${ids.org},${number},${name},${`${number!.toLowerCase()}@viahr.test`},${`${number!.toLowerCase()}@viahr.test`},${ids.department},${ids.position},${ids.location},${ids.employmentType},${manager},'Active','2025-01-01',${ids.managerUser},${ids.managerUser})`;
        await sql`INSERT INTO users (id,organisation_id,employee_id,display_name,workspace_email,status,created_by,updated_by) VALUES (${user},${ids.org},${employee},${name},${`${number!.toLowerCase()}@viahr.test`},'Active',${ids.managerUser},${ids.managerUser})`;
      }
      const roleRows = await sql<
        { id: string; code: string }[]
      >`SELECT id,code FROM roles WHERE code IN ('Employee','Line Manager')`;
      const roleIds = Object.fromEntries(roleRows.map((row) => [row.code, row.id]));
      for (const [user, codes] of [
        [ids.managerUser, ["Employee", "Line Manager"]],
        [ids.employeeUser, ["Employee"]],
      ] as const)
        for (const code of codes)
          await sql`INSERT INTO user_roles (organisation_id,user_id,role_id,assigned_by,reason) VALUES (${ids.org},${user},${roleIds[code]},${ids.managerUser},'Task test access') ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO leave_policies (id,organisation_id,code,name,type,category,description,is_paid,scope,accrual_mode,approval_chain,created_by,updated_by) VALUES (${ids.policy},${ids.org},'ANNUAL','Annual Leave','Annual','Paid','Annual leave policy',true,'Annual','Upfront','["Line Manager","HR"]',${ids.managerUser},${ids.managerUser})`;
      await sql`INSERT INTO leave_requests (id,organisation_id,employee_id,policy_id,start_date,end_date,working_days_requested,reason,status,policy_snapshot,created_by,updated_by) VALUES (${ids.request},${ids.org},${ids.employee},${ids.policy},CURRENT_DATE+30,CURRENT_DATE+31,2,'Family commitment','Pending Line Manager','{"name":"Annual Leave"}',${ids.employeeUser},${ids.employeeUser})`;
      await sql`INSERT INTO notifications (id,organisation_id,recipient_user_id,type,title,message,priority,status,created_by,updated_by) VALUES (${ids.notification},${ids.org},${ids.managerUser},'test','Review required','A request is waiting','Normal','Unread',${ids.managerUser},${ids.managerUser}),(${ids.otherNotification},${ids.org},${ids.employeeUser},'test','Private update','Only the owner may change this','Normal','Unread',${ids.managerUser},${ids.managerUser})`;

      const tasks = await listTasksForActorInDatabase(ids.org!, managerActor);
      assert.ok(tasks.some((task) => task.sourceId === ids.request && task.module === "Leave"));
      const employeeTasks = await listTasksForActorInDatabase(ids.org!, {
        userId: ids.employeeUser,
        employeeId: ids.employee,
        displayName: "Task Employee",
        activeRole: "Employee",
        roles: ["Employee"],
      });
      assert.equal(
        employeeTasks.some((task) => task.sourceId === ids.request),
        false,
      );

      await setNotificationStatusInDatabase(ids.org!, ids.notification!, "Read", managerActor, 1);
      await assert.rejects(
        () =>
          setNotificationStatusInDatabase(ids.org!, ids.notification!, "Unread", managerActor, 1),
        /changed after you opened it/i,
      );
      await assert.rejects(
        () =>
          setNotificationStatusInDatabase(ids.org!, ids.otherNotification!, "Read", managerActor),
        /only update your own/i,
      );
      const [denial] =
        await sql`SELECT id FROM audit_events WHERE organisation_id=${ids.org} AND action='access-denied' AND entity_id=${ids.otherNotification}`;
      assert.ok(denial);
      await setAllNotificationStatusesInDatabase(ids.org!, "Dismissed", managerActor);
      const notices = await listNotificationsForUserInDatabase(ids.org!, ids.managerUser!);
      assert.equal(
        notices.every((notice) => notice.status === "Dismissed"),
        true,
      );

      const firstWorker = await processTaskAutomationInDatabase(ids.org!);
      const secondWorker = await processTaskAutomationInDatabase(ids.org!);
      assert.ok(firstWorker.tasksOpen >= 1);
      assert.equal(secondWorker.remindersCreated, 0);
      const [projection] =
        await sql`SELECT id FROM workflow_tasks WHERE organisation_id=${ids.org} AND entity_id=${ids.request} AND assigned_user_id=${ids.managerUser} AND status='Open'`;
      assert.ok(projection);
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);
