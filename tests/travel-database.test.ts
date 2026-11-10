import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import postgres from "postgres";
import { officeCredits } from "../src/lib/db/repositories/office-exception.repository.server.ts";
import { listTasksForActorInDatabase } from "../src/lib/db/repositories/task.repository.server.ts";

import {
  assignTravelReimbursementsToPayrollInDatabase,
  closeTravelReimbursementInDatabase,
  createTravelRequestInDatabase,
  decideTravelRequestInDatabase,
  listTravelRequestsForActor,
  processTravelWorker,
  submitTravelExpensesInDatabase,
  changeTravelBookingInDatabase,
  listTravelBookingQueue,
  closeTravelWithoutExpensesInDatabase,
  withdrawTravelRequestInDatabase,
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
        "foreignCurrency",
        "employee",
        "employeeUser",
        "managerEmployee",
        "managerUser",
        "participantManagerEmployee",
        "participantManagerUser",
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
      activeRole: "Employee" | "Line Manager" | "HR" | "Accounts" | "Super Admin" | "Travel Admin",
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
        ["currencies", "foreignCurrency", "British pound", "GBP"],
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
        ["participantManagerEmployee", "participantManagerUser", "Participant Manager"],
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
        [ids.participantManagerUser, "Line Manager"],
        [ids.hrUser, "HR"],
        [ids.accountsUser, "Accounts"],
        [ids.adminUser, "Super Admin"],
      ] as const)
        await sql`INSERT INTO user_roles (organisation_id,user_id,role_id,assigned_by) VALUES (${ids.organisation},${userId},${roleIds[code]},${ids.adminUser})`;
      await sql`UPDATE employees SET line_manager_id=${ids.managerEmployee} WHERE id=${ids.employee}`;
      await sql`UPDATE employees SET employment_confirmation_status='Confirmed' WHERE organisation_id=${ids.organisation}`;
      await sql`UPDATE employees SET line_manager_id=${ids.participantManagerEmployee} WHERE id=${ids.adminEmployee}`;
      await sql`INSERT INTO payroll_periods (id,organisation_id,name,start_date,end_date,cutoff_date,payment_date,status,created_by,updated_by) VALUES (${ids.payrollPeriod},${ids.organisation},'September Payroll','2026-09-01','2026-09-30','2026-09-25','2026-09-30','Collecting Inputs',${ids.accountsUser},${ids.accountsUser})`;

      const employee = actor(ids.employeeUser!, ids.employee!, "Employee");
      await sql`INSERT INTO app_settings (organisation_id,timezone,base_currency,working_days,standard_daily_hours,standard_weekly_hours,leave_year_start,leave_year_end,document_reminder_days,employee_number_format,candidate_reference_format,created_by,updated_by) VALUES (${ids.organisation},'Asia/Muscat','OMR',ARRAY[0,1,2,3,4,5,6],8,40,'01-01','12-31',ARRAY[30],'EMP-{0000}','CAN-{0000}',${ids.adminUser},${ids.adminUser})`;
      const manager = actor(ids.managerUser!, ids.managerEmployee!, "Line Manager");
      const hr = actor(ids.hrUser!, ids.hrEmployee!, "HR");
      const accounts = actor(ids.accountsUser!, ids.accountsEmployee!, "Accounts");
      const admin = actor(ids.adminUser!, ids.adminEmployee!, "Super Admin");
      const dateAfter = (days: number) =>
        new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
      const tripStart = dateAfter(14);
      const tripEnd = dateAfter(16);
      const expenseStart = dateAfter(-16);
      const expenseEnd = dateAfter(-14);
      const expenseDate = dateAfter(-15);
      const requestId = await createTravelRequestInDatabase(
        ids.organisation!,
        {
          employeeId: ids.employee!,
          participantIds: [ids.adminEmployee!],
          purpose: "Client implementation review",
          destination: "Muscat, Oman",
          startDate: tripStart,
          endDate: tripEnd,
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
      await assert.rejects(
        decideTravelRequestInDatabase(ids.organisation!, requestId, "HR", "approve", "Dates", hr),
        /supervisors/,
      );
      await decideTravelRequestInDatabase(
        ids.organisation!,
        requestId,
        "Manager",
        "approve",
        "Participation confirmed",
        actor(ids.participantManagerUser!, ids.participantManagerEmployee!, "Line Manager"),
      );
      await assert.rejects(
        decideTravelRequestInDatabase(
          ids.organisation!,
          requestId,
          "HR",
          "approve",
          "Same person",
          actor(ids.managerUser!, ids.managerEmployee!, "HR"),
        ),
        /supervisor who approved/,
      );
      await decideTravelRequestInDatabase(
        ids.organisation!,
        requestId,
        "HR",
        "approve",
        "Dates verified",
        hr,
      );
      await assert.rejects(
        decideTravelRequestInDatabase(
          ids.organisation!,
          requestId,
          "Accounts",
          "approve",
          "Same person",
          actor(ids.hrUser!, ids.hrEmployee!, "Accounts"),
        ),
        /different Finance reviewer/,
      );
      await decideTravelRequestInDatabase(
        ids.organisation!,
        requestId,
        "Accounts",
        "approve",
        "Budget verified",
        accounts,
      );
      assert.equal(
        (
          await listTravelRequestsForActor(
            ids.organisation!,
            actor(ids.adminUser!, ids.adminEmployee!, "Employee"),
          )
        ).length,
        1,
      );
      await assert.rejects(
        changeTravelBookingInDatabase(
          ids.organisation!,
          {
            requestId,
            action: "request",
            kind: "Flight",
            name: "Over budget",
            details: "Test",
            estimate: 301,
          },
          employee,
        ),
        /exceed.*trip budget/,
      );
      await changeTravelBookingInDatabase(
        ids.organisation!,
        {
          requestId,
          action: "request",
          kind: "Car",
          name: "Shared car",
          details: "Office pickup for both travellers",
          estimate: 25,
        },
        employee,
      );
      const booking = (await listTravelRequestsForActor(ids.organisation!, employee))[0]!
        .bookings![0]!;
      const financeBookingTask = (
        await listTasksForActorInDatabase(ids.organisation!, accounts)
      ).find((task) => task.id === `travel-booking-accounts-${booking.id}`);
      assert.equal(financeBookingTask?.sourceId, requestId);
      assert.equal(
        financeBookingTask?.actionUrl,
        `/staff/travel/${requestId}#booking-${booking.id}`,
      );
      const bookingNotices = await sql<{ link: { path: string } }[]>`
        SELECT link FROM notifications
        WHERE organisation_id=${ids.organisation}
          AND recipient_user_id=${ids.accountsUser}
          AND deduplication_key LIKE ${`travel-booking-${requestId}-%`}
        ORDER BY created_at DESC LIMIT 1
      `;
      assert.equal(bookingNotices[0]?.link.path, financeBookingTask?.actionUrl);
      assert.equal(
        (await listTasksForActorInDatabase(ids.organisation!, employee)).some(
          (task) => task.id === `travel-booking-accounts-${booking.id}`,
        ),
        false,
      );
      const travelAdmin = actor(ids.adminUser!, ids.adminEmployee!, "Travel Admin");
      assert.equal((await listTravelBookingQueue(ids.organisation!, travelAdmin)).length, 0);
      await assert.rejects(
        changeTravelBookingInDatabase(
          ids.organisation!,
          { requestId, action: "confirm", bookingId: booking.id, confirmation: "CAR-01" },
          travelAdmin,
        ),
        /Finance/,
      );
      await changeTravelBookingInDatabase(
        ids.organisation!,
        { requestId, action: "approve", bookingId: booking.id },
        accounts,
      );
      assert.equal(
        (await listTasksForActorInDatabase(ids.organisation!, accounts)).some(
          (task) => task.id === `travel-booking-accounts-${booking.id}`,
        ),
        false,
      );
      await assert.rejects(
        changeTravelBookingInDatabase(
          ids.organisation!,
          { requestId, action: "approve", bookingId: booking.id },
          accounts,
        ),
        /already/,
      );
      assert.equal((await listTravelBookingQueue(ids.organisation!, travelAdmin)).length, 1);
      await changeTravelBookingInDatabase(
        ids.organisation!,
        {
          requestId,
          action: "confirm",
          bookingId: booking.id,
          confirmation: "CAR-01. Pickup at 08:00",
        },
        travelAdmin,
      );
      assert.equal(
        (await listTravelRequestsForActor(ids.organisation!, employee))[0]!.bookings![0]!.status,
        "Confirmed",
      );
      assert.equal(
        (await listTravelRequestsForActor(ids.organisation!, employee))[0]?.status,
        "Pre-authorised",
      );
      const credits = await officeCredits(
        ids.organisation!,
        [ids.employee!, ids.adminEmployee!],
        tripStart,
        tripEnd,
      );
      assert.equal(credits.length, 6);
      assert.ok(credits.every((c) => c.hours === 8 && c.label.startsWith("Official duty")));
      // Simulate the passage of time without waiting for the future trip dates.
      await sql`UPDATE travel_requests SET start_date=${expenseStart},end_date=${expenseEnd} WHERE id=${requestId}`;

      await assert.rejects(
        submitTravelExpensesInDatabase(
          ids.organisation!,
          requestId,
          [
            {
              id: randomUUID(),
              category: "Transport",
              amount: 5,
              currencyId: ids.foreignCurrency!,
              reference: "FX-001",
              date: expenseDate,
              receiptFileId: randomUUID(),
            },
          ],
          "",
          employee,
        ),
        /approved trip currency/,
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
            date: expenseDate,
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
            amount: 110.123,
            currencyId: ids.currency!,
            reference: "INV-002",
            date: expenseDate,
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
        await sql`SELECT tr.status,tr.payroll_period_id,r.status AS reimbursement_status,r.amount::text AS reimbursement_amount FROM travel_requests tr JOIN reimbursements r ON r.travel_request_id=tr.id WHERE tr.id=${requestId}`;
      assert.equal(final?.status, "Closed");
      assert.equal(final?.payroll_period_id, ids.payrollPeriod);
      assert.equal(final?.reimbursement_status, "Included in Payroll");
      assert.equal(final?.reimbursement_amount, "110.123");
      await sql`UPDATE travel_requests SET updated_at=${new Date(Date.now() - 72 * 60 * 60 * 1000)},status='Pending Super Admin Closure' WHERE id=${requestId}`;
      assert.ok((await processTravelWorker()).reminders > 0);
      assert.equal((await processTravelWorker()).reminders, 0);

      const noClaimId = await createTravelRequestInDatabase(
        ids.organisation!,
        {
          employeeId: ids.employee!,
          purpose: "No-cost client meeting",
          destination: "Sohar",
          startDate: dateAfter(30),
          endDate: dateAfter(31),
          estTransport: 0,
          estAccommodation: 0,
          estPerDiem: 0,
          estOther: 0,
          currencyId: ids.currency!,
        },
        employee,
      );
      await decideTravelRequestInDatabase(
        ids.organisation!,
        noClaimId,
        "Manager",
        "approve",
        "Approved",
        manager,
      );
      await decideTravelRequestInDatabase(
        ids.organisation!,
        noClaimId,
        "HR",
        "approve",
        "Approved",
        hr,
      );
      await decideTravelRequestInDatabase(
        ids.organisation!,
        noClaimId,
        "Accounts",
        "approve",
        "Approved",
        accounts,
      );
      await sql`UPDATE travel_requests SET start_date=${dateAfter(-20)},end_date=${dateAfter(-19)} WHERE id=${noClaimId}`;
      await closeTravelWithoutExpensesInDatabase(ids.organisation!, noClaimId, employee);
      const [noClaim] = await sql`SELECT status,actual_total_omr::text AS amount,
        (SELECT count(*)::int FROM reimbursements WHERE travel_request_id=${noClaimId}) AS reimbursements
        FROM travel_requests WHERE id=${noClaimId}`;
      assert.equal(noClaim?.status, "Closed");
      assert.equal(noClaim?.amount, "0.000");
      assert.equal(noClaim?.reimbursements, 0);

      const cancelId = await createTravelRequestInDatabase(
        ids.organisation!,
        {
          employeeId: ids.employee!,
          purpose: "Client visit that was cancelled",
          destination: "Salalah",
          startDate: dateAfter(35),
          endDate: dateAfter(36),
          estTransport: 10,
          estAccommodation: 0,
          estPerDiem: 0,
          estOther: 0,
          currencyId: ids.currency!,
        },
        employee,
      );
      await decideTravelRequestInDatabase(
        ids.organisation!,
        cancelId,
        "Manager",
        "approve",
        "Approved",
        manager,
      );
      await decideTravelRequestInDatabase(
        ids.organisation!,
        cancelId,
        "HR",
        "approve",
        "Approved",
        hr,
      );
      await decideTravelRequestInDatabase(
        ids.organisation!,
        cancelId,
        "Accounts",
        "approve",
        "Approved",
        accounts,
      );
      await changeTravelBookingInDatabase(
        ids.organisation!,
        {
          requestId: cancelId,
          action: "request",
          kind: "Car",
          name: "Airport car",
          details: "Pickup",
          estimate: 10,
        },
        employee,
      );
      const cancelBooking = (await listTravelRequestsForActor(ids.organisation!, employee)).find(
        (request) => request.id === cancelId,
      )!.bookings![0]!;
      await changeTravelBookingInDatabase(
        ids.organisation!,
        {
          requestId: cancelId,
          action: "approve",
          bookingId: cancelBooking.id,
        },
        accounts,
      );
      await changeTravelBookingInDatabase(
        ids.organisation!,
        {
          requestId: cancelId,
          action: "confirm",
          bookingId: cancelBooking.id,
          confirmation: "CAR-02",
        },
        travelAdmin,
      );
      await assert.rejects(
        withdrawTravelRequestInDatabase(ids.organisation!, cancelId, employee),
        /cancel confirmed arrangements/,
      );
      await changeTravelBookingInDatabase(
        ids.organisation!,
        {
          requestId: cancelId,
          action: "cancel",
          bookingId: cancelBooking.id,
          confirmation: "Provider confirmed cancellation CAR-02",
        },
        travelAdmin,
      );
      await withdrawTravelRequestInDatabase(ids.organisation!, cancelId, employee);
      assert.equal(
        (await listTravelRequestsForActor(ids.organisation!, employee)).find(
          (request) => request.id === cancelId,
        )?.status,
        "Withdrawn",
      );

      // When HR is the assigned supervisor, one HR decision must not create a
      // second HR approval task. Finance remains an independent final reviewer.
      await sql`UPDATE employees SET line_manager_id=${ids.hrEmployee} WHERE id=${ids.employee}`;
      const standInTripId = await createTravelRequestInDatabase(
        ids.organisation!,
        {
          employeeId: ids.employee!,
          participantIds: [],
          purpose: "Stand-in supervisor project visit",
          destination: "Salalah, Oman",
          startDate: dateAfter(45),
          endDate: dateAfter(47),
          estTransport: 20,
          estAccommodation: 0,
          estPerDiem: 0,
          estOther: 0,
          currencyId: ids.currency!,
        },
        employee,
      );
      assert.ok(
        (await listTasksForActorInDatabase(ids.organisation!, hr)).some(
          (task) => task.id === `travel-manager-${standInTripId}`,
        ),
      );
      await decideTravelRequestInDatabase(
        ids.organisation!,
        standInTripId,
        "Manager",
        "approve",
        "Business need and HR review confirmed",
        hr,
      );
      const [standInReviewed] = await sql<
        {
          manager_approval_status: string;
          hr_approval_status: string;
          accounts_approval_status: string;
        }[]
      >`SELECT manager_approval_status,hr_approval_status,accounts_approval_status FROM travel_requests WHERE id=${standInTripId}`;
      assert.equal(standInReviewed?.manager_approval_status, "Approved");
      assert.equal(standInReviewed?.hr_approval_status, "Approved");
      assert.equal(standInReviewed?.accounts_approval_status, "Pending");
      assert.equal(
        (await listTasksForActorInDatabase(ids.organisation!, hr)).some(
          (task) => task.id === `travel-hr-${standInTripId}`,
        ),
        false,
      );
      await decideTravelRequestInDatabase(
        ids.organisation!,
        standInTripId,
        "Accounts",
        "approve",
        "Budget verified",
        accounts,
      );
      const [standInAuthorised] = await sql<
        { status: string }[]
      >`SELECT status FROM travel_requests WHERE id=${standInTripId}`;
      assert.equal(standInAuthorised?.status, "Pre-authorised");

      // HR may supervise one traveller in a shared trip. Record that review,
      // but do not release the trip to Finance before every supervisor agrees.
      await sql`UPDATE employees SET line_manager_id=${ids.managerEmployee} WHERE id=${ids.employee}`;
      await sql`UPDATE employees SET line_manager_id=${ids.hrEmployee} WHERE id=${ids.adminEmployee}`;
      const sharedTripId = await createTravelRequestInDatabase(
        ids.organisation!,
        {
          employeeId: ids.employee!,
          participantIds: [ids.adminEmployee!],
          purpose: "Shared implementation workshop",
          destination: "Nizwa, Oman",
          startDate: dateAfter(60),
          endDate: dateAfter(62),
          estTransport: 30,
          estAccommodation: 0,
          estPerDiem: 0,
          estOther: 0,
          currencyId: ids.currency!,
        },
        employee,
      );
      await decideTravelRequestInDatabase(
        ids.organisation!,
        sharedTripId,
        "Manager",
        "approve",
        "Participant approved by HR supervisor",
        hr,
      );
      const [waitingForOwner] = await sql<
        {
          manager_approval_status: string;
          hr_approval_status: string;
          hr_approved_by: string | null;
        }[]
      >`SELECT manager_approval_status,hr_approval_status,hr_approved_by FROM travel_requests WHERE id=${sharedTripId}`;
      assert.equal(waitingForOwner?.manager_approval_status, "Pending");
      assert.equal(waitingForOwner?.hr_approval_status, "Pending");
      assert.equal(waitingForOwner?.hr_approved_by, ids.hrUser);
      await decideTravelRequestInDatabase(
        ids.organisation!,
        sharedTripId,
        "Manager",
        "approve",
        "Organiser approved",
        manager,
      );
      const [allSupervisorsDone] = await sql<
        {
          manager_approval_status: string;
          hr_approval_status: string;
          accounts_approval_status: string;
        }[]
      >`SELECT manager_approval_status,hr_approval_status,accounts_approval_status FROM travel_requests WHERE id=${sharedTripId}`;
      assert.equal(allSupervisorsDone?.manager_approval_status, "Approved");
      assert.equal(allSupervisorsDone?.hr_approval_status, "Approved");
      assert.equal(allSupervisorsDone?.accounts_approval_status, "Pending");
      const [sharedHrDecision] = await sql<
        { decided_by: string }[]
      >`SELECT decided_by FROM travel_approvals WHERE travel_request_id=${sharedTripId} AND stage='HR'`;
      assert.equal(sharedHrDecision?.decided_by, ids.hrUser);

      // A managerless CEO uses the organisation's selected reviewer, without
      // manufacturing supervisor/HR decisions. HR receives an information notice.
      const ceoPositionId = randomUUID();
      await sql`INSERT INTO positions (id,organisation_id,name,code,is_active,order_index,created_by,updated_by) VALUES (${ceoPositionId},${ids.organisation},'CEO','CEO',true,2,${ids.adminUser},${ids.adminUser})`;
      await sql`UPDATE employees SET position_id=${ceoPositionId},line_manager_id=NULL WHERE id=${ids.adminEmployee}`;
      const executiveTripId = await createTravelRequestInDatabase(
        ids.organisation!,
        {
          employeeId: ids.adminEmployee!,
          purpose: "Executive client meeting",
          destination: "Sohar, Oman",
          startDate: dateAfter(90),
          endDate: dateAfter(91),
          estTransport: 40,
          estAccommodation: 0,
          estPerDiem: 0,
          estOther: 0,
          currencyId: ids.currency!,
        },
        admin,
      );
      const [executiveSubmitted] = await sql<
        {
          approval_route: { kind: string; reviewerRole: string; notifyHr: boolean };
          manager_approval_status: string;
          hr_approval_status: string;
          accounts_approval_status: string;
        }[]
      >`SELECT approval_route,manager_approval_status,hr_approval_status,accounts_approval_status FROM travel_requests WHERE id=${executiveTripId}`;
      assert.deepEqual(executiveSubmitted?.approval_route, {
        kind: "Managerless Executive",
        reviewerRole: "Accounts",
        notifyHr: true,
      });
      assert.equal(executiveSubmitted?.manager_approval_status, "Not Required");
      assert.equal(executiveSubmitted?.hr_approval_status, "Not Required");
      assert.equal(executiveSubmitted?.accounts_approval_status, "Pending");
      await assert.rejects(
        decideTravelRequestInDatabase(
          ids.organisation!,
          executiveTripId,
          "HR",
          "approve",
          "No review",
          hr,
        ),
        /not required/,
      );
      const [hrInformation] = await sql<
        { id: string }[]
      >`SELECT id FROM notifications WHERE organisation_id=${ids.organisation} AND recipient_user_id=${ids.hrUser} AND deduplication_key=${`travel-executive-hr-info-${executiveTripId}`}`;
      assert.ok(hrInformation);
      await decideTravelRequestInDatabase(
        ids.organisation!,
        executiveTripId,
        "Accounts",
        "approve",
        "Within budget",
        accounts,
      );
      const [executiveApproved] = await sql<
        {
          status: string;
          manager_approved_by: string | null;
          hr_approved_by: string | null;
          accounts_approved_by: string | null;
        }[]
      >`SELECT status,manager_approved_by,hr_approved_by,accounts_approved_by FROM travel_requests WHERE id=${executiveTripId}`;
      assert.equal(executiveApproved?.status, "Pre-authorised");
      assert.equal(executiveApproved?.manager_approved_by, null);
      assert.equal(executiveApproved?.hr_approved_by, null);
      assert.equal(executiveApproved?.accounts_approved_by, ids.accountsUser);

      const sharedExecutiveTripId = await createTravelRequestInDatabase(
        ids.organisation!,
        {
          employeeId: ids.adminEmployee!,
          participantIds: [ids.employee!],
          purpose: "Shared executive client review",
          destination: "Nizwa, Oman",
          startDate: dateAfter(120),
          endDate: dateAfter(121),
          estTransport: 25,
          estAccommodation: 0,
          estPerDiem: 0,
          estOther: 0,
          currencyId: ids.currency!,
        },
        admin,
      );
      await assert.rejects(
        decideTravelRequestInDatabase(
          ids.organisation!,
          sharedExecutiveTripId,
          "Accounts",
          "approve",
          "Too soon",
          accounts,
        ),
        /supervisors/,
      );
      await decideTravelRequestInDatabase(
        ids.organisation!,
        sharedExecutiveTripId,
        "Manager",
        "approve",
        "Colleague approved",
        manager,
      );
      const [afterColleagueReview] = await sql<
        {
          manager_approval_status: string;
          manager_approved_by: string | null;
        }[]
      >`SELECT manager_approval_status,manager_approved_by FROM travel_requests WHERE id=${sharedExecutiveTripId}`;
      assert.equal(afterColleagueReview?.manager_approval_status, "Approved");
      assert.equal(afterColleagueReview?.manager_approved_by, null);
      await decideTravelRequestInDatabase(
        ids.organisation!,
        sharedExecutiveTripId,
        "Accounts",
        "approve",
        "Budget approved",
        accounts,
      );
      const [sharedExecutiveApproved] = await sql<
        { status: string }[]
      >`SELECT status FROM travel_requests WHERE id=${sharedExecutiveTripId}`;
      assert.equal(sharedExecutiveApproved?.status, "Pre-authorised");

      const reviewerPolicy = JSON.stringify({
        hrOwnRequestReviewerEmployeeId: ids.managerEmployee,
        managerlessExecutiveTravelReviewerRole: "Accounts",
        managerlessExecutiveTravelNotifyHr: true,
      });
      await sql`UPDATE app_settings SET additional_settings=jsonb_set(coalesce(additional_settings,'{}'::jsonb),'{approvalRouting}',${reviewerPolicy}::jsonb,true) WHERE organisation_id=${ids.organisation}`;
      const hrOwnTripId = await createTravelRequestInDatabase(
        ids.organisation!,
        {
          employeeId: ids.hrEmployee!,
          purpose: "HR conference",
          destination: "Salalah, Oman",
          startDate: dateAfter(150),
          endDate: dateAfter(151),
          estTransport: 35,
          estAccommodation: 0,
          estPerDiem: 0,
          estOther: 0,
          currencyId: ids.currency!,
        },
        hr,
      );
      const [hrOwnSubmitted] = await sql<
        {
          approval_route: { kind: string; reviewerEmployeeId: string; reviewerName: string };
          manager_approval_status: string;
          hr_approval_status: string;
          accounts_approval_status: string;
        }[]
      >`SELECT approval_route,manager_approval_status,hr_approval_status,accounts_approval_status FROM travel_requests WHERE id=${hrOwnTripId}`;
      assert.equal(hrOwnSubmitted?.approval_route.kind, "HR Own Travel");
      assert.equal(hrOwnSubmitted?.approval_route.reviewerEmployeeId, ids.managerEmployee);
      assert.equal(hrOwnSubmitted?.approval_route.reviewerName, "Line Manager");
      assert.equal(hrOwnSubmitted?.manager_approval_status, "Pending");
      assert.equal(hrOwnSubmitted?.hr_approval_status, "Not Required");
      assert.equal(hrOwnSubmitted?.accounts_approval_status, "Pending");
      await assert.rejects(
        decideTravelRequestInDatabase(
          ids.organisation!,
          hrOwnTripId,
          "HR",
          "approve",
          "Self review",
          hr,
        ),
        /own travel request/,
      );
      const independentReviewerInEmployeeMode = actor(
        ids.managerUser!,
        ids.managerEmployee!,
        "Employee",
      );
      assert.ok(
        (
          await listTravelRequestsForActor(ids.organisation!, independentReviewerInEmployeeMode)
        ).some((trip) => trip.id === hrOwnTripId),
      );
      await decideTravelRequestInDatabase(
        ids.organisation!,
        hrOwnTripId,
        "Manager",
        "approve",
        "Conference justified",
        independentReviewerInEmployeeMode,
      );
      await decideTravelRequestInDatabase(
        ids.organisation!,
        hrOwnTripId,
        "Accounts",
        "approve",
        "Cost approved",
        accounts,
      );
      const [hrOwnApproved] = await sql<
        {
          status: string;
          manager_approved_by: string | null;
          hr_approved_by: string | null;
          accounts_approved_by: string | null;
        }[]
      >`SELECT status,manager_approved_by,hr_approved_by,accounts_approved_by FROM travel_requests WHERE id=${hrOwnTripId}`;
      assert.equal(hrOwnApproved?.status, "Pre-authorised");
      assert.equal(hrOwnApproved?.manager_approved_by, ids.managerUser);
      assert.equal(hrOwnApproved?.hr_approved_by, null);
      assert.equal(hrOwnApproved?.accounts_approved_by, ids.accountsUser);
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);
