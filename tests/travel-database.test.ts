import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import postgres from "postgres";

import {
  assignTravelReimbursementsToPayrollInDatabase,
  closeTravelReimbursementInDatabase,
  createTravelRequestInDatabase,
  decideTravelRequestInDatabase,
  listTravelRequestsForActor,
  processTravelWorker,
  submitTravelExpensesInDatabase,
} from "../src/lib/db/repositories/travel.repository.server.ts";

const testDatabaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (testDatabaseUrl) process.env["DATABASE_URL"] = testDatabaseUrl;

test(
  "travel is supervisor, HR and Accounts approved, reimbursed and assigned to payroll in PostgreSQL",
  { skip: !testDatabaseUrl },
  async () => {
    assert.match(new URL(testDatabaseUrl!).pathname.slice(1).toLowerCase(), /(test|scratch)/);
    const sql = postgres(testDatabaseUrl!, { max: 5, prepare: false });
    const ids = Object.fromEntries(
      [
        "organisation",
        "department",
        "position",
        "employmentType",
        "location",
        "project",
        "costCentre",
        "currency",
        "employee",
        "employeeUser",
        "managerEmployee",
        "managerUser",
        "hrEmployee",
        "hrUser",
        "accountsEmployee",
        "accountsUser",
        "adminEmployee",
        "adminUser",
        "payrollPeriod",
      ].map((key) => [key, randomUUID()]),
    ) as Record<string, string>;
    const actor = (
      userId: string,
      employeeId: string,
      activeRole: "Employee" | "Line Manager" | "HR" | "Accounts" | "Super Admin",
    ) => ({
      userId,
      employeeId,
      displayName: `${activeRole} travel actor`,
      activeRole,
      roles:
        activeRole === "Employee" ? (["Employee"] as const) : (["Employee", activeRole] as const),
    });
    try {
      await sql`INSERT INTO organisations (id,name,slug,is_active,created_by,updated_by) VALUES (${ids.organisation},'Travel Test',${`travel-${ids.organisation}`},true,${ids.adminUser},${ids.adminUser})`;
      for (const [table, key, name, code] of [
        ["departments", "department", "Operations", "OPS"],
        ["positions", "position", "Coordinator", "COORD"],
        ["employment_types", "employmentType", "Full-time", "FT"],
        ["cost_centres", "costCentre", "Operations", "CC-OPS"],
        ["currencies", "currency", "Omani rial", "OMR"],
      ] as const)
        await sql.unsafe(
          `INSERT INTO ${table} (id,organisation_id,name,code,is_active,order_index,created_by,updated_by) VALUES ($1,$2,$3,$4,true,1,$5,$5)`,
          [ids[key], ids.organisation, name, code, ids.adminUser],
        );
      await sql`INSERT INTO locations (id,organisation_id,name,code,is_active,order_index,latitude,longitude,radius_meters,is_clock_in_site,created_by,updated_by) VALUES (${ids.location},${ids.organisation},'Dubai Office','DXB',true,1,25.2,55.27,150,true,${ids.adminUser},${ids.adminUser})`;
      await sql`INSERT INTO projects (id,organisation_id,name,code,is_active,order_index,cost_centre_id,created_by,updated_by) VALUES (${ids.project},${ids.organisation},'Client Visit','CLIENT',true,1,${ids.costCentre},${ids.adminUser},${ids.adminUser})`;
      for (const [employeeKey, userKey, name] of [
        ["employee", "employeeUser", "Employee"],
        ["managerEmployee", "managerUser", "Line Manager"],
        ["hrEmployee", "hrUser", "HR"],
        ["accountsEmployee", "accountsUser", "Accounts"],
        ["adminEmployee", "adminUser", "Super Admin"],
      ] as const) {
        await sql`INSERT INTO employees (id,organisation_id,employee_number,legal_name,preferred_name,work_email,department_id,position_id,location_id,employment_type_id,status,start_date,created_by,updated_by) VALUES (${ids[employeeKey]},${ids.organisation},${`TR-${ids[employeeKey]!.slice(0, 6)}`},${name},${name},${`${ids[employeeKey]}@viahr.test`},${ids.department},${ids.position},${ids.location},${ids.employmentType},'Active','2020-01-01',${ids.adminUser},${ids.adminUser})`;
        await sql`INSERT INTO users (id,organisation_id,employee_id,display_name,workspace_email,status,created_by,updated_by) VALUES (${ids[userKey]},${ids.organisation},${ids[employeeKey]},${name},${`${ids[employeeKey]}@viahr.test`},'Active',${ids.adminUser},${ids.adminUser})`;
      }
      const roleRows = await sql<
        { id: string; code: string }[]
      >`SELECT id,code FROM roles WHERE code IN ('Line Manager','HR','Accounts','Super Admin')`;
      const roleIds = Object.fromEntries(roleRows.map((row) => [row.code, row.id]));
      for (const [userId, code] of [
        [ids.managerUser, "Line Manager"],
        [ids.hrUser, "HR"],
        [ids.accountsUser, "Accounts"],
        [ids.adminUser, "Super Admin"],
      ] as const)
        await sql`INSERT INTO user_roles (organisation_id,user_id,role_id,assigned_by) VALUES (${ids.organisation},${userId},${roleIds[code]},${ids.adminUser})`;
      await sql`UPDATE employees SET line_manager_id=${ids.managerEmployee} WHERE id=${ids.employee}`;
      await sql`INSERT INTO payroll_periods (id,organisation_id,name,start_date,end_date,cutoff_date,payment_date,status,created_by,updated_by) VALUES (${ids.payrollPeriod},${ids.organisation},'September Payroll','2026-09-01','2026-09-30','2026-09-25','2026-09-30','Collecting Inputs',${ids.accountsUser},${ids.accountsUser})`;

      const employee = actor(ids.employeeUser!, ids.employee!, "Employee");
      const manager = actor(ids.managerUser!, ids.managerEmployee!, "Line Manager");
      const hr = actor(ids.hrUser!, ids.hrEmployee!, "HR");
      const accounts = actor(ids.accountsUser!, ids.accountsEmployee!, "Accounts");
      const admin = actor(ids.adminUser!, ids.adminEmployee!, "Super Admin");
      const requestId = await createTravelRequestInDatabase(
        ids.organisation!,
        {
          employeeId: ids.employee!,
          purpose: "Client implementation review",
          destination: "Muscat, Oman",
          startDate: "2026-08-01",
          endDate: "2026-08-03",
          estTransport: 100,
          estAccommodation: 150,
          estPerDiem: 50,
          estOther: 0,
          currencyId: ids.currency!,
          projectId: ids.project!,
          costCentreId: ids.costCentre!,
        },
        employee,
      );
      assert.equal((await listTravelRequestsForActor(ids.organisation!, employee)).length, 1);
      await assert.rejects(
        decideTravelRequestInDatabase(
          ids.organisation!,
          requestId,
          "HR",
          "approve",
          undefined,
          employee,
        ),
        /own|Only HR/,
      );
      await decideTravelRequestInDatabase(
        ids.organisation!,
        requestId,
        "Manager",
        "approve",
        "Business need confirmed",
        manager,
      );
      const decisions = await Promise.allSettled([
        decideTravelRequestInDatabase(
          ids.organisation!,
          requestId,
          "HR",
          "approve",
          "Dates verified",
          hr,
        ),
        decideTravelRequestInDatabase(
          ids.organisation!,
          requestId,
          "Accounts",
          "approve",
          "Budget verified",
          accounts,
        ),
      ]);
      assert.equal(decisions.filter((result) => result.status === "fulfilled").length, 2);
      assert.equal(
        (await listTravelRequestsForActor(ids.organisation!, employee))[0]?.status,
        "Pre-authorised",
      );

      const firstLine = randomUUID();
      const firstFile = randomUUID();
      await sql`INSERT INTO file_metadata (id,organisation_id,name,mime_type,size,checksum,storage_key,storage_status,owner_entity_type,owner_entity_id,created_by,updated_by) VALUES (${firstFile},${ids.organisation},'receipt.pdf','application/pdf',4,'test',${`test/${firstFile}`},'Available','travel-expense-receipt',${firstLine},${ids.employeeUser},${ids.employeeUser})`;
      await submitTravelExpensesInDatabase(
        ids.organisation!,
        requestId,
        [
          {
            id: firstLine,
            category: "Transport",
            amount: 120,
            currencyId: ids.currency!,
            reference: "INV-001",
            date: "2026-08-02",
            receiptFileId: firstFile,
          },
        ],
        "",
        employee,
      );
      await closeTravelReimbursementInDatabase(
        ids.organisation!,
        requestId,
        "reject",
        "Please correct the receipt",
        accounts,
      );
      const returned = (await listTravelRequestsForActor(ids.organisation!, employee))[0]!;
      assert.equal(returned.status, "Pre-authorised");
      assert.equal(returned.actualTotal, undefined);
      assert.equal(returned.expenses?.length, 0);

      const secondLine = randomUUID();
      const secondFile = randomUUID();
      await sql`INSERT INTO file_metadata (id,organisation_id,name,mime_type,size,checksum,storage_key,storage_status,owner_entity_type,owner_entity_id,created_by,updated_by) VALUES (${secondFile},${ids.organisation},'corrected.pdf','application/pdf',4,'test',${`test/${secondFile}`},'Available','travel-expense-receipt',${secondLine},${ids.employeeUser},${ids.employeeUser})`;
      await submitTravelExpensesInDatabase(
        ids.organisation!,
        requestId,
        [
          {
            id: secondLine,
            category: "Transport",
            amount: 110,
            currencyId: ids.currency!,
            reference: "INV-002",
            date: "2026-08-02",
            receiptFileId: secondFile,
          },
        ],
        "",
        employee,
      );
      await closeTravelReimbursementInDatabase(
        ids.organisation!,
        requestId,
        "close",
        "Receipts verified",
        accounts,
      );
      await assignTravelReimbursementsToPayrollInDatabase(
        ids.organisation!,
        [requestId],
        ids.payrollPeriod!,
        accounts,
      );
      const [final] =
        await sql`SELECT tr.status,tr.payroll_period_id,r.status AS reimbursement_status FROM travel_requests tr JOIN reimbursements r ON r.travel_request_id=tr.id WHERE tr.id=${requestId}`;
      assert.equal(final?.status, "Closed");
      assert.equal(final?.payroll_period_id, ids.payrollPeriod);
      assert.equal(final?.reimbursement_status, "Included in Payroll");
      await sql`UPDATE travel_requests SET updated_at=${new Date(Date.now() - 72 * 60 * 60 * 1000)},status='Pending Super Admin Closure' WHERE id=${requestId}`;
      assert.ok((await processTravelWorker()).reminders > 0);
      assert.equal((await processTravelWorker()).reminders, 0);
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);
