import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import postgres from "postgres";
import { listTrackedRequests } from "../src/lib/db/repositories/request-tracking.repository.server.ts";
import { enqueueWorkflowEmails } from "../src/lib/db/repositories/workflow-email.repository.server.ts";

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
        "employeeVisit",
        "ownVisit",
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
      const hrStandInTasks = await listTasksForActorInDatabase(ids.org!, {
        ...managerActor,
        activeRole: "HR",
        roles: ["Employee", "HR"],
      });
      assert.ok(
        hrStandInTasks.some((task) => task.id === `leave-manager-${ids.request}`),
        "An assigned HR supervisor must find their manager-stage decision in the inbox",
      );
      const superAdminTasks = await listTasksForActorInDatabase(ids.org!, {
        ...managerActor,
        activeRole: "Super Admin",
        roles: ["Employee", "Super Admin"],
      });
      assert.equal(
        superAdminTasks.some((task) => task.id === `leave-manager-${ids.request}`),
        false,
        "A Super Admin with the same reporting line must not receive an approval task",
      );
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
      const employeeActor = {
        ...managerActor,
        userId: ids.employeeUser,
        employeeId: ids.employee,
        activeRole: "Accounts" as const,
      };
      const own = await listTrackedRequests(ids.org!, employeeActor, { scope: "my", page: 1 });
      assert.ok(own.rows.some((row) => row.id === ids.request));
      const managerOwn = await listTrackedRequests(ids.org!, managerActor, {
        scope: "my",
        page: 1,
      });
      assert.equal(
        managerOwn.rows.some((row) => row.id === ids.request),
        false,
      );
      await assert.rejects(
        () => listTrackedRequests(ids.org!, employeeActor, { scope: "organisation", page: 1 }),
        /Only HR/,
      );
      const organisation = await listTrackedRequests(
        ids.org!,
        { ...managerActor, activeRole: "HR" },
        { scope: "organisation", page: 1, module: "Leave" },
      );
      assert.equal(organisation.total, 1);
      const [before] =
        await sql`SELECT count(*)::int count FROM notifications WHERE organisation_id=${ids.org} AND type='workflow.request_update'`;
      await sql`UPDATE leave_requests SET reason='Updated reason' WHERE id=${ids.request}`;
      const [unchanged] =
        await sql`SELECT count(*)::int count FROM notifications WHERE organisation_id=${ids.org} AND type='workflow.request_update'`;
      assert.equal(unchanged!.count, before!.count);
      await sql`INSERT INTO google_calendar_connections (organisation_id,account_email,refresh_token_encrypted,connected_by,email_enabled_at) VALUES (${ids.org},'hr@via-int.com','test-not-a-real-token',${ids.managerUser},now())`;
      await sql`UPDATE leave_requests SET status='Pending HR', chain_approvals=${JSON.stringify([
        {
          role: "Line Manager",
          status: "Approved",
          approvedBy: ids.managerUser,
          date: "2026-11-02T09:00:00.000Z",
        },
        { role: "HR", status: "Pending" },
      ])}::jsonb WHERE id=${ids.request}`;
      const superAdminAtHrStage = await listTasksForActorInDatabase(ids.org!, {
        ...managerActor,
        activeRole: "Super Admin",
        roles: ["Employee", "Super Admin"],
      });
      assert.equal(
        superAdminAtHrStage.some((task) => task.id === `leave-hr-${ids.request}`),
        false,
        "Super Admin must not receive HR's final approval task",
      );
      await sql`INSERT INTO audit_events (organisation_id,actor_user_id,actor_employee_id,actor_display_name,active_role,actor_roles,action,module,entity_type,entity_id,reason)
        VALUES (${ids.org},${ids.managerUser},${ids.manager},'Task Manager','Line Manager',ARRAY['Employee','Line Manager'],'approve','leave','leave-request',${ids.request},'Manager approved this leave')`;
      const reviewed = await listTrackedRequests(ids.org!, managerActor, {
        scope: "reviewed",
        page: 1,
        includeDetails: true,
      });
      assert.equal(reviewed.total, 1);
      assert.equal(reviewed.rows[0]?.id, ids.request);
      assert.equal(reviewed.rows[0]?.waitingFor, "HR");
      assert.deepEqual(reviewed.rows[0]?.approvedBy, ["Task Manager"]);
      assert.equal(reviewed.rows[0]?.createdByName, "Task Employee");
      assert.equal(reviewed.rows[0]?.details["Reason"], "Updated reason");
      assert.ok(
        reviewed.rows[0]?.events.some((event) => event.comment === "Manager approved this leave"),
      );
      const exactDecision = await listTrackedRequests(ids.org!, managerActor, {
        scope: "reviewed",
        page: 1,
        module: "Leave",
        requestId: ids.request,
      });
      assert.equal(exactDecision.total, 1);
      const wrongRole = await listTrackedRequests(
        ids.org!,
        { ...managerActor, activeRole: "Accounts" },
        { scope: "reviewed", page: 1, module: "Leave", requestId: ids.request },
      );
      assert.equal(wrongRole.total, 0, "A Finance role cannot reopen a manager's leave decision");
      const employeeProgress = await listTrackedRequests(ids.org!, employeeActor, {
        scope: "my",
        page: 1,
      });
      assert.deepEqual(employeeProgress.rows[0]?.approvedBy, ["Task Manager"]);
      assert.equal(
        employeeProgress.rows[0]?.actionUrl,
        `/staff/me/leave-balances#request=${ids.request}`,
      );
      const reviewerInEmployeeMode = await listTrackedRequests(
        ids.org!,
        { ...managerActor, activeRole: "Employee", roles: ["Employee"] },
        { scope: "reviewed", page: 1, module: "Leave", requestId: ids.request },
      );
      assert.equal(
        reviewerInEmployeeMode.total,
        1,
        "An actual reviewer can still see their decision in Employee mode",
      );
      const unrelatedEmployeeReview = await listTrackedRequests(
        ids.org!,
        { ...employeeActor, activeRole: "Employee" },
        { scope: "reviewed", page: 1, module: "Leave", requestId: ids.request },
      );
      assert.equal(unrelatedEmployeeReview.total, 0);
      await enqueueWorkflowEmails();
      const [queued] =
        await sql`SELECT count(*)::int count FROM workflow_notification_emails WHERE organisation_id=${ids.org}`;
      assert.equal(
        queued!.count,
        1,
        "Only new workflow notifications are queued, not historic backlog",
      );
      await enqueueWorkflowEmails();
      const [again] =
        await sql`SELECT count(*)::int count FROM workflow_notification_emails WHERE organisation_id=${ids.org}`;
      assert.equal(again!.count, 1);
      // Administrative access alone is not an email duty. Keep personal receipts.
      await sql`INSERT INTO user_roles (organisation_id,user_id,role_id,assigned_by,reason)
        SELECT ${ids.org},${ids.managerUser},id,${ids.managerUser},'Email routing test' FROM roles WHERE code='Super Admin' ON CONFLICT DO NOTHING`;
      await sql`DELETE FROM user_roles WHERE organisation_id=${ids.org} AND user_id=${ids.managerUser} AND role_id IN (SELECT id FROM roles WHERE code='Line Manager')`;
      const hrNotice = randomUUID();
      const personalNotice = randomUUID();
      await sql`INSERT INTO notifications (id,organisation_id,recipient_user_id,type,title,message,link,created_by,updated_by) VALUES
        (${hrNotice},${ids.org},${ids.managerUser},'employee-document.approval_required','Review document','HR review required',${sql.json({ entityType: "employee-document", entityId: randomUUID() })},${ids.managerUser},${ids.managerUser}),
        (${personalNotice},${ids.org},${ids.managerUser},'employee-document.approved','Your document was approved','Personal employee update',${sql.json({ entityType: "employee-document", entityId: randomUUID() })},${ids.managerUser},${ids.managerUser})`;
      await processTaskAutomationInDatabase(ids.org!);
      await enqueueWorkflowEmails();
      const adminEmails =
        await sql`SELECT n.id,n.type FROM workflow_notification_emails q JOIN notifications n ON n.id=q.notification_id WHERE n.organisation_id=${ids.org} AND n.recipient_user_id=${ids.managerUser}`;
      assert.ok(
        adminEmails.some((n) => n.id === personalNotice),
        "Super Admin retains personal employee emails",
      );
      assert.ok(
        !adminEmails.some((n) => n.id === hrNotice),
        "Super Admin alone must not receive HR broadcast emails",
      );
      assert.ok(
        !adminEmails.some((n) => n.type === "approval.reminder"),
        "Super Admin-only approval reminders must not be emailed",
      );
      await sql`INSERT INTO user_roles (organisation_id,user_id,role_id,assigned_by,reason)
        SELECT ${ids.org},${ids.managerUser},id,${ids.managerUser},'HR email duty' FROM roles WHERE code='HR' ON CONFLICT DO NOTHING`;
      await processTaskAutomationInDatabase(ids.org!);
      await enqueueWorkflowEmails();
      const hrEmails =
        await sql`SELECT n.id,n.type FROM workflow_notification_emails q JOIN notifications n ON n.id=q.notification_id WHERE n.organisation_id=${ids.org} AND n.recipient_user_id=${ids.managerUser}`;
      assert.ok(
        hrEmails.some((n) => n.id === hrNotice),
        "An explicit HR role enables HR email even if Super Admin is also assigned",
      );
      assert.ok(
        hrEmails.some((n) => n.type === "approval.reminder"),
        "HR receives its approval reminders",
      );
      await sql`INSERT INTO site_visit_requests
        (id,organisation_id,employee_id,date,start_time,end_time,origin,destination,purpose,status,requested_at,created_by,updated_by)
        VALUES
        (${ids.employeeVisit},${ids.org},${ids.employee},CURRENT_DATE+1,'09:00','12:00','Office','Client office','Project meeting','Pending HR',now(),${ids.employeeUser},${ids.employeeUser}),
        (${ids.ownVisit},${ids.org},${ids.manager},CURRENT_DATE+1,'09:00','12:00','Office','Client office','Project meeting','Pending HR',now(),${ids.managerUser},${ids.managerUser})`;
      const hrVisitTasks = await listTasksForActorInDatabase(ids.org!, {
        ...managerActor,
        activeRole: "HR",
        roles: ["Employee", "Line Manager", "HR", "Super Admin"],
      });
      assert.ok(hrVisitTasks.some((task) => task.sourceId === ids.employeeVisit));
      assert.ok(
        !hrVisitTasks.some((task) => task.sourceId === ids.ownVisit),
        "HR cannot review their own visit",
      );
      const adminVisitTasks = await listTasksForActorInDatabase(ids.org!, {
        ...managerActor,
        activeRole: "Super Admin",
        roles: ["Employee", "Line Manager", "HR", "Super Admin"],
      });
      assert.ok(
        !adminVisitTasks.some((task) => task.sourceType === "site-visit-request"),
        "Super Admin access alone cannot review visits",
      );
      await sql`UPDATE employees SET employment_confirmation_status='Pending HR Review',
        proposed_employment_details=${sql.json({
          legalName: "Task Employee",
          preferredName: "Task Employee",
          staffEntryType: "Existing Employee",
          startDate: "2025-01-01",
          departmentId: ids.department,
          positionId: ids.position,
          locationId: ids.location,
          employmentTypeId: ids.employmentType,
          lineManagerId: ids.manager,
          lineManagerEmail: "task-mgr@viahr.test",
          visaRequired: false,
        })} WHERE id=${ids.employee}`;
      const employmentTask = (
        await listTasksForActorInDatabase(ids.org!, {
          ...managerActor,
          activeRole: "HR",
          roles: ["Employee", "HR"],
        })
      ).find((task) => task.id === `employment-hr-${ids.employee}`);
      assert.equal(
        employmentTask?.actionUrl,
        `/staff/employees/${ids.employee}#section=employment`,
      );
      assert.equal(employmentTask?.sourceType, "employee");
      assert.equal(
        (
          await listTasksForActorInDatabase(ids.org!, {
            ...managerActor,
            activeRole: "Super Admin",
            roles: ["Employee", "Super Admin"],
          })
        ).some((task) => task.id === `employment-hr-${ids.employee}`),
        false,
      );
      await sql`UPDATE employees SET employment_confirmation_status='Confirmed' WHERE id=${ids.employee}`;
      assert.equal(
        (
          await listTasksForActorInDatabase(ids.org!, {
            ...managerActor,
            activeRole: "HR",
            roles: ["Employee", "HR"],
          })
        ).some((task) => task.id === `employment-hr-${ids.employee}`),
        false,
      );
      await sql`INSERT INTO hr_independent_review_assignments
        (organisation_id,module,request_id,requester_employee_id,reviewer_employee_id,stage,created_by,updated_by)
        VALUES (${ids.org},'Leave',${ids.request},${ids.employee},${ids.manager},'HR',${ids.managerUser},${ids.managerUser})`;
      const beforeHrStage = await listTasksForActorInDatabase(ids.org!, {
        ...managerActor,
        activeRole: "Employee",
        roles: ["Employee"],
      });
      assert.equal(
        beforeHrStage.some((task) => task.id === `independent-hr-review-Leave-${ids.request}`),
        false,
        "The named HR reviewer must not receive the task before the HR stage begins",
      );
      await sql`UPDATE leave_requests SET status='Pending HR',
        chain_approvals=${sql.json([
          { role: "Line Manager", status: "Approved", approvedBy: ids.managerUser },
          { role: "HR", status: "Pending" },
        ])}
        WHERE id=${ids.request}`;
      const independentTasks = await listTasksForActorInDatabase(ids.org!, {
        ...managerActor,
        activeRole: "Employee",
        roles: ["Employee"],
      });
      assert.ok(
        independentTasks.some((task) => task.id === `independent-hr-review-Leave-${ids.request}`),
        "The named reviewer sees HR-stage work in Employee mode",
      );
      const genericHrTasks = await listTasksForActorInDatabase(ids.org!, {
        ...managerActor,
        activeRole: "HR",
        roles: ["Employee", "HR"],
      });
      assert.equal(
        genericHrTasks.some((task) => task.id === `leave-hr-${ids.request}`),
        false,
        "HR's shared queue must not expose a privately assigned decision",
      );
      const assignedProgress = await listTrackedRequests(ids.org!, employeeActor, {
        scope: "my",
        page: 1,
        module: "Leave",
        requestId: ids.request,
      });
      assert.equal(assignedProgress.rows[0]?.waitingFor, "Task Manager");
      await sql`UPDATE leave_requests SET archived_at=now() WHERE id=${ids.request}`;
      const archivedHistory = await listTrackedRequests(ids.org!, employeeActor, {
        scope: "my",
        page: 1,
        module: "Leave",
        requestId: ids.request,
      });
      assert.equal(archivedHistory.total, 1);
      assert.equal(archivedHistory.rows[0]?.group, "Closed");
    } finally {
      await sql`DELETE FROM google_calendar_connections WHERE organisation_id=${ids.org}`;
      await sql.end({ timeout: 5 });
    }
  },
);
