import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import postgres from "postgres";

import {
  checkAuditIntegrityInDatabase,
  exportAuditCsvInDatabase,
  listAuditEventsInDatabase,
} from "../src/lib/db/repositories/audit.repository.server.ts";

const testDatabaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (testDatabaseUrl) process.env["DATABASE_URL"] = testDatabaseUrl;

test(
  "audit history is immutable, scoped, redacted, filterable and export audited in PostgreSQL",
  { skip: !testDatabaseUrl },
  async () => {
    assert.match(new URL(testDatabaseUrl!).pathname.slice(1).toLowerCase(), /(test|scratch)/);
    const query = postgres(testDatabaseUrl!, { max: 3, prepare: false });
    try {
      const [organisation] = await query<{ id: string }[]>`select id from organisations limit 1`;
      assert.ok(organisation);
      const people = await query<
        { userId: string; employeeId: string; displayName: string; role: string }[]
      >`select distinct on (r.code) u.id as "userId",u.employee_id as "employeeId",u.display_name as "displayName",r.code::text as role from users u join user_roles ur on ur.user_id=u.id join roles r on r.id=ur.role_id where u.organisation_id=${organisation.id} and r.code in ('Employee','HR','Accounts','Super Admin') order by r.code,u.created_at`;
      const actorFor = (role: "Employee" | "HR" | "Accounts" | "Super Admin") => {
        const person = people.find((item) => item.role === role);
        assert.ok(person, `${role} seed user is required`);
        return {
          userId: person.userId,
          employeeId: person.employeeId,
          displayName: person.displayName,
          activeRole: role,
          roles: [role],
        };
      };
      const employee = actorFor("Employee");
      const hr = actorFor("HR");
      const accounts = actorFor("Accounts");
      const admin = actorFor("Super Admin");
      const [otherEmployee] = await query<
        { id: string }[]
      >`select id from employees where organisation_id=${organisation.id} and id<>${employee.employeeId} limit 1`;
      const [vacancy] = await query<
        { id: string }[]
      >`select id from vacancies where organisation_id=${organisation.id} limit 1`;
      assert.ok(otherEmployee && vacancy);

      const policyId = randomUUID();
      const leaveId = randomUUID();
      const policyName = `Audit Test Leave ${policyId.slice(0, 6)}`;
      await query`insert into leave_policies (id,organisation_id,code,name,type,category,description,is_paid,scope,accrual_mode,approval_chain,created_by,updated_by) values (${policyId},${organisation.id},${`AUD-${policyId.slice(0, 6)}`},${policyName},'Annual','Paid','Audit lifecycle',true,'Annual','Upfront','["Line Manager","HR"]',${hr.userId},${hr.userId})`;
      await query`insert into leave_requests (id,organisation_id,employee_id,policy_id,start_date,end_date,working_days_requested,reason,status,policy_snapshot,created_by,updated_by) values (${leaveId},${organisation.id},${employee.employeeId},${policyId},current_date+20,current_date+21,2,'Audit verification','Approved','{"name":"Audit Test Leave"}',${employee.userId},${hr.userId})`;

      const eventIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
      for (const [index, action] of ["create", "submit", "approve"].entries())
        await query`insert into audit_events (id,organisation_id,actor_user_id,actor_employee_id,actor_display_name,active_role,actor_roles,action,module,entity_type,entity_id,after_summary,reason,risk_level) values (${eventIds[index]},${organisation.id},${index === 2 ? hr.userId : employee.userId},${index === 2 ? hr.employeeId : employee.employeeId},${index === 2 ? hr.displayName : employee.displayName},${index === 2 ? "HR" : "Employee"},${index === 2 ? ["HR"] : ["Employee"]},${action},'leave','leave-request',${leaveId},${query.json({ employeeId: employee.employeeId, salary: 9000, passportNumber: "P-SECRET" })},'Leave lifecycle verification',${index === 2 ? "High" : "Medium"})`;
      for (const [index, action] of ["create", "publish"].entries())
        await query`insert into audit_events (id,organisation_id,actor_user_id,actor_employee_id,actor_display_name,active_role,actor_roles,action,module,entity_type,entity_id,after_summary,reason,risk_level) values (${eventIds[index + 3]},${organisation.id},${hr.userId},${hr.employeeId},${hr.displayName},'HR',array['HR'],${action},'recruitment','vacancy',${vacancy.id},${query.json({ title: "Audit recruitment history" })},'Recruitment lifecycle verification','High')`;

      const leaveHistory = await listAuditEventsInDatabase(
        organisation.id,
        { global: false, entityType: "leave-request", entityId: leaveId },
        employee,
      );
      assert.deepEqual(
        new Set(leaveHistory.map((event) => event.action)),
        new Set(["create", "submit", "approve"]),
      );
      assert.equal((leaveHistory[0]!.after as Record<string, unknown>)["salary"], "Restricted");
      assert.equal(
        (leaveHistory[0]!.after as Record<string, unknown>)["passportNumber"],
        "Restricted",
      );

      const recruitmentHistory = await listAuditEventsInDatabase(
        organisation.id,
        { global: true, module: "recruitment", entityType: "vacancy" },
        admin,
      );
      assert.ok(
        eventIds.slice(3).every((id) => recruitmentHistory.some((event) => event.id === id)),
      );

      await assert.rejects(
        () =>
          listAuditEventsInDatabase(
            organisation.id,
            { global: false, entityType: "leave-request", entityId: leaveId },
            accounts,
          ),
        /cannot view|outside|restricted/i,
      );
      await assert.rejects(
        () =>
          listAuditEventsInDatabase(
            organisation.id,
            { global: false, entityType: "employee", entityId: otherEmployee.id },
            employee,
          ),
        /cannot view/i,
      );

      const filtered = await listAuditEventsInDatabase(
        organisation.id,
        {
          global: true,
          actorId: hr.userId,
          role: "HR",
          module: "leave",
          action: "approve",
          risk: "High",
        },
        admin,
      );
      assert.ok(filtered.some((event) => event.id === eventIds[2]));
      assert.ok(
        filtered.every((event) => event.actor.userId === hr.userId && event.action === "approve"),
      );

      await assert.rejects(
        () => query`update audit_events set reason='tampered' where id=${eventIds[0]}`,
        /immutable|not permitted|audit/i,
      );

      const orphanId = randomUUID();
      const orphanEventId = randomUUID();
      await query`insert into audit_events (id,organisation_id,actor_user_id,actor_employee_id,actor_display_name,active_role,actor_roles,action,module,entity_type,entity_id,reason,risk_level) values (${orphanEventId},${organisation.id},${admin.userId},${admin.employeeId},${admin.displayName},'Super Admin',array['Super Admin'],'update','recruitment','vacancy',${orphanId},'Integrity verification','High')`;
      const integrity = await checkAuditIntegrityInDatabase(organisation.id, admin);
      assert.ok(integrity.some((issue) => issue.eventId === orphanEventId));

      const exported = await exportAuditCsvInDatabase(
        organisation.id,
        { global: true, module: "leave" },
        admin,
      );
      assert.ok(exported.rowCount >= 3);
      assert.match(exported.csv, /Leave lifecycle verification/);
      const [exportAudit] = await query<
        { count: number }[]
      >`select count(*)::integer as count from audit_events where organisation_id=${organisation.id} and actor_user_id=${admin.userId} and action='export' and module='audit'`;
      assert.ok(exportAudit!.count >= 1);
    } finally {
      await query.end();
    }
  },
);
