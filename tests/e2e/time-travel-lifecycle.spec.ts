import { expect, test, type Page } from "@playwright/test";

type PreviewRole = "Employee" | "Line Manager" | "HR" | "Accounts" | "Super Admin";

async function previewAs(page: Page, userId: string, activeRole: PreviewRole, path: string) {
  await page.evaluate(
    ({ selectedUserId, selectedRole }) => {
      localStorage.setItem(
        "via_hr:dev_preview_state",
        JSON.stringify({ userId: selectedUserId, activeRole: selectedRole }),
      );
    },
    { selectedUserId: userId, selectedRole: activeRole },
  );
  await page.goto(path);
}

test("leave, timesheet, attendance, overtime and travel complete their role workflows", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const suffix = Date.now().toString().slice(-6);
  const labels = {
    leave: `E2E family appointment ${suffix}`,
    correction: `E2E missed punch correction ${suffix}`,
    overtime: `E2E urgent shipment release ${suffix}`,
    travel: `E2E client workshop ${suffix}`,
  };

  await page.goto("/staff");
  await expect(page.getByText("VIA HR System").first()).toBeVisible();
  await expect(page.getByText("VIA HR System").first()).toBeVisible();

  const records = await page.evaluate(
    async ({ labels }) => {
      const { initializeApplicationData } = await import("/src/lib/data/application-data.ts");
      const { LeaveService } = await import("/src/lib/data/leave-service.ts");
      const { AttendanceService } = await import("/src/lib/data/attendance-service.ts");
      const { TimesheetService } = await import("/src/lib/data/timesheet-service.ts");
      const { OvertimeService } = await import("/src/lib/data/overtime-service.ts");
      const { TravelService } = await import("/src/lib/data/travel-service.ts");
      const { EmployeeService } = await import("/src/lib/data/employee-service.ts");
      const { MasterDataService } = await import("/src/lib/data/master-data.ts");
      initializeApplicationData();

      const employee = {
        actor: {
          userId: "user-omar",
          employeeId: "employee-omar",
          displayName: "Omar Rahman",
          workspaceEmail: "omar.rahman@via.example",
          activeRole: "Employee" as const,
          roles: ["Employee" as const],
        },
      };
      const hr = {
        actor: {
          userId: "user-rana",
          employeeId: "employee-rana",
          displayName: "Rana Nair",
          workspaceEmail: "rana.nair@via.example",
          activeRole: "HR" as const,
          roles: ["Employee" as const, "HR" as const],
        },
      };

      await new EmployeeService().hydrateCompatibilityCache(hr);
      await new MasterDataService().hydrateCompatibilityCache();
      const leaveService = new LeaveService();
      await leaveService.hydrateCompatibilityCache(employee);
      const annualPolicy = leaveService
        .getEligiblePolicies("employee-omar", employee)
        .find((policy) => policy.type === "Annual");
      if (!annualPolicy) throw new Error("Annual leave policy is missing from demo data.");
      const leave = await leaveService.submitLeaveRequest(
        {
          employeeId: "employee-omar",
          policyId: annualPolicy.id,
          startDate: "2026-11-09",
          endDate: "2026-11-09",
          reason: labels.leave,
          handoverContactId: "employee-layla",
        },
        employee,
      );

      const attendanceService = new AttendanceService();
      await attendanceService.hydrateFromDatabase(hr);
      const attendance = await attendanceService.saveRecordAsync(
        {
          employeeId: "employee-omar",
          date: "2026-06-03",
          expectedClockIn: "09:00",
          expectedClockOut: "18:00",
          clockIn: "09:30",
          clockOut: "18:00",
          breakMinutes: 60,
          location: "Muscat Office",
          locationId: "loc-muscat",
          source: "Manual Entry",
          workMode: "Office",
          status: "Late",
          calculatedHours: 7.5,
          isLate: true,
          isEarlyDeparture: false,
        },
        hr,
      );
      const correction = await attendanceService.requestCorrectionAsync(
        attendance.id,
        "09:00",
        "18:00",
        labels.correction,
        employee,
      );

      const timesheetService = new TimesheetService(attendanceService);
      await timesheetService.hydrateCompatibilityCache(hr);
      await timesheetService.generatePeriodsAsync("2026-06-01", "2026-06-07", hr);
      const period = timesheetService
        .getPeriods()
        .find((item) => item.startDate === "2026-06-01" && item.endDate === "2026-06-07");
      if (!period) throw new Error("The browser test timesheet period was not generated.");
      const timesheet = await timesheetService.getOrCreateTimesheetAsync(
        "employee-omar",
        period.id,
        employee,
      );
      const workHours: Record<string, number> = {};
      const explanations: Record<string, string> = {};
      for (
        let cursor = new Date(`${period.startDate}T12:00:00`);
        cursor <= new Date(`${period.endDate}T12:00:00`);
        cursor.setDate(cursor.getDate() + 1)
      ) {
        if (![5, 6].includes(cursor.getDay())) {
          const date = cursor.toISOString().slice(0, 10);
          workHours[date] = 8;
          explanations[date] = "Browser workflow test uses an approved manual attendance setup.";
        }
      }
      timesheet.entries.push({
        id: crypto.randomUUID(),
        projectId: "proj-001",
        costCentreId: "cc-operations",
        activityCodeId: "activity-delivery",
        locationCodeId: "loc-muscat",
        hours: workHours,
        total: Object.values(workHours).reduce((sum, hours) => sum + hours, 0),
        notes: "Client delivery and operational coordination.",
      });
      timesheet.attendanceDiscrepancyExplanations = explanations;
      const savedTimesheet = await timesheetService.saveTimesheetDraftAsync(timesheet, employee);
      const submittedTimesheet = await timesheetService.submitTimesheetAsync(
        savedTimesheet.id,
        employee,
      );

      timesheetService.saveSettings(
        { ...timesheetService.getSettings(), requireHrOvertimeVerification: true },
        hr,
      );
      const overtimeService = new OvertimeService();
      await overtimeService.hydrateCompatibilityCache(employee);
      const overtime = await overtimeService.submitClaim(
        {
          employeeId: "employee-omar",
          date: "2026-06-04",
          hours: 2,
          reason: labels.overtime,
          projectId: "proj-001",
          costCentreId: "cc-operations",
          activityCodeId: "activity-delivery",
          locationCodeId: "loc-muscat",
          compensationType: "Payment",
        },
        employee,
      );

      const travelService = new TravelService();
      await travelService.hydrateCompatibilityCache(employee);
      const travel = await travelService.submitRequest(
        {
          employeeId: "employee-omar",
          purpose: labels.travel,
          destination: "Dubai, UAE",
          startDate: "2026-06-10",
          endDate: "2026-06-12",
          currency: "OMR",
          costCentreId: "cc-operations",
          estTransport: 120,
          estAccommodation: 240,
          estPerDiem: 60,
          estOther: 0,
        },
        employee,
      );

      return {
        leaveId: leave.id,
        correctionId: correction.id,
        timesheetId: submittedTimesheet.id,
        overtimeId: overtime.id,
        travelId: travel.id,
      };
    },
    { labels },
  );

  // Supervisor decisions: the employee's actual reporting line is checked by every service.
  await previewAs(page, "user-layla", "Line Manager", "/staff/leave-approvals");
  await expect(page.getByRole("heading", { name: "Leave Approvals" })).toBeVisible();
  const leaveCard = page
    .getByText(labels.leave)
    .locator("xpath=ancestor::div[.//button[normalize-space()='Approve']][1]");
  await expect(leaveCard).toBeVisible();
  await leaveCard.getByRole("button", { name: "Approve" }).click();
  await expect(leaveCard).toBeHidden();

  await previewAs(page, "user-layla", "Line Manager", "/staff/attendance/corrections");
  const correctionRow = page.getByRole("row").filter({ hasText: labels.correction });
  await correctionRow.getByRole("button", { name: "Review" }).click();
  const managerCorrectionDialog = page.getByRole("dialog", { name: "Manager Review" });
  await managerCorrectionDialog
    .getByPlaceholder("Required decision notes")
    .fill("Punch checked with the employee and endorsed.");
  await managerCorrectionDialog.getByRole("button", { name: "Endorse to HR" }).click();
  await expect(managerCorrectionDialog).toBeHidden();

  await previewAs(page, "user-layla", "Line Manager", "/staff/overtime-approvals");
  const overtimeRow = page.getByRole("row").filter({ hasText: labels.overtime });
  await expect(overtimeRow).toBeVisible();
  await overtimeRow.getByRole("button", { name: "Approve" }).click();
  await expect(overtimeRow).toBeHidden();

  await previewAs(
    page,
    "user-layla",
    "Line Manager",
    `/staff/timesheet-approvals/${records.timesheetId}`,
  );
  await expect(page.getByRole("button", { name: "Send to HR" })).toBeEnabled();
  await page.getByRole("button", { name: "Send to HR" }).click();
  await expect(page.getByText("Pending HR", { exact: true }).first()).toBeVisible();

  // HR completes the second-stage people and time approvals.
  await previewAs(page, "user-rana", "HR", "/staff/leave-approvals");
  await page.getByRole("tab", { name: /HR Confirmation/ }).click();
  const finalLeaveCard = page
    .getByText(labels.leave)
    .locator("xpath=ancestor::div[.//button[normalize-space()='Approve']][1]");
  await finalLeaveCard.getByRole("button", { name: "Approve" }).click();
  await expect(finalLeaveCard).toBeHidden();

  await previewAs(page, "user-rana", "HR", "/staff/attendance/corrections");
  await page.getByRole("tab", { name: /HR Finalisation/ }).click();
  const finalCorrectionRow = page.getByRole("row").filter({ hasText: labels.correction });
  await finalCorrectionRow.getByRole("button", { name: "Review" }).click();
  const hrCorrectionDialog = page.getByRole("dialog", { name: "HR Final Decision" });
  await hrCorrectionDialog
    .getByPlaceholder("Required decision notes")
    .fill("Correction evidence and supervisor endorsement reviewed.");
  await hrCorrectionDialog.getByRole("button", { name: "Approve & Apply" }).click();
  await expect(hrCorrectionDialog).toBeHidden();

  await previewAs(page, "user-rana", "HR", "/staff/overtime-approvals");
  await page.getByRole("tab", { name: /HR Verification/ }).click();
  const finalOvertimeRow = page.getByRole("row").filter({ hasText: labels.overtime });
  await finalOvertimeRow.getByRole("button", { name: "Verify" }).click();
  const overtimeDialog = page.getByRole("dialog", { name: "Verify Overtime" });
  await overtimeDialog
    .getByRole("textbox")
    .fill("Operational exception reviewed against the available time records.");
  await overtimeDialog.getByRole("button", { name: "Confirm Verification" }).click();
  await expect(overtimeDialog).toBeHidden();

  // Finance receives only the fully approved paid claim. The dedicated ledger resolves allocation
  // names, exposes the review details and remains unavailable to HR by navigation or direct URL.
  await previewAs(page, "user-mariam", "Accounts", "/staff/payroll/overtime");
  await expect(page.getByRole("heading", { name: "Overtime Payroll Ledger" })).toBeVisible();
  const payrollOvertimeRow = page.getByRole("row").filter({ hasText: labels.overtime });
  await expect(payrollOvertimeRow).toContainText("Payment");
  await expect(payrollOvertimeRow).toContainText("Ready for payroll");
  await expect(payrollOvertimeRow).toContainText("Al Mouj Phase 3");
  await payrollOvertimeRow.getByRole("button", { name: "Details" }).click();
  await expect(page.getByRole("dialog", { name: "Overtime Record" })).toContainText(
    "Payroll status",
  );
  await page.keyboard.press("Escape");

  await previewAs(page, "user-rana", "HR", "/staff/payroll/overtime");
  await expect(page.getByText("Access Denied", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Overtime Payroll Ledger" })).toHaveCount(0);

  await previewAs(page, "user-rana", "HR", `/staff/timesheet-approvals/${records.timesheetId}`);
  await page.getByRole("button", { name: "Approve Timesheet" }).click();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();

  // Travel needs independent HR and Accounts decisions before it is pre-authorised.
  await previewAs(page, "user-rana", "HR", "/staff/travel-hr-approvals");
  const hrTravelRow = page.getByRole("row").filter({ hasText: labels.travel });
  await hrTravelRow.getByRole("button", { name: "Approve Dates" }).click();
  const hrTravelDialog = page.getByRole("dialog", { name: "Approve Travel Policy" });
  await hrTravelDialog.getByRole("textbox").fill("Dates and travel policy requirements confirmed.");
  await hrTravelDialog.getByRole("button", { name: "Confirm HR Approval" }).click();
  await expect(hrTravelDialog).toBeHidden();

  await previewAs(page, "user-mariam", "Accounts", "/staff/travel-accounts-approvals");
  const accountsTravelRow = page
    .getByRole("row")
    .filter({ hasText: "Dubai, UAE" })
    .filter({ hasText: "420 OMR" });
  await accountsTravelRow.getByRole("button", { name: "Approve Budget" }).click();
  const accountsTravelDialog = page.getByRole("dialog", { name: "Approve Budget Estimate" });
  await accountsTravelDialog
    .getByRole("textbox")
    .fill("Budget and cost centre allocation confirmed.");
  await accountsTravelDialog.getByRole("button", { name: "Confirm Budget Approval" }).click();
  await expect(accountsTravelDialog).toBeHidden();

  // Post-trip expenses and final closure complete the reimbursement lifecycle.
  await previewAs(page, "user-omar", "Employee", `/staff/travel/${records.travelId}`);
  await expect(page.getByText("Pre-authorised", { exact: true }).first()).toBeVisible();
  await page.evaluate(
    async ({ travelId }) => {
      const { TravelService } = await import("/src/lib/data/travel-service.ts");
      const expenseLineId = crypto.randomUUID();
      const receipt = new File(["%PDF-1.4\nE2E taxi receipt\n%%EOF"], "e2e-taxi-receipt.pdf", {
        type: "application/pdf",
      });
      const receiptFiles = new Map<string, File>([[expenseLineId, receipt]]);
      await new TravelService().submitExpenses(
        travelId,
        [
          {
            id: expenseLineId,
            category: "Transport",
            date: "2026-06-11",
            amount: 110,
            currency: "OMR",
            reference: "E2E-TAXI-110",
          },
        ],
        "Actual cost remained below the approved estimate.",
        {
          actor: {
            userId: "user-omar",
            employeeId: "employee-omar",
            displayName: "Omar Rahman",
            workspaceEmail: "omar.rahman@via.example",
            activeRole: "Employee",
            roles: ["Employee"],
          },
        },
        receiptFiles,
      );
    },
    { travelId: records.travelId },
  );

  await previewAs(page, "user-super-admin", "Super Admin", "/staff/travel-closures");
  const closureRow = page
    .getByRole("row")
    .filter({ hasText: "Dubai, UAE" })
    .filter({ hasText: "110" });
  await closureRow.getByRole("button", { name: "Close" }).click();
  const closureDialog = page.getByRole("dialog", { name: "Close Reimbursement" });
  await closureDialog
    .getByRole("textbox")
    .fill("Expense references reviewed and reimbursement cleared.");
  await closureDialog.getByRole("button", { name: "Confirm Closure" }).click();
  await expect(closureDialog).toBeHidden();

  // Final records persist and are visible to their employee after role changes and reloads.
  await previewAs(page, "user-omar", "Employee", "/staff/me/leave-balances");
  await page.getByRole("tab", { name: /Request history/i }).click();
  await expect(page.getByText(labels.leave)).toBeVisible();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();

  await page.goto("/staff/me/attendance");
  await page.getByRole("button", { name: "Previous" }).click();
  await page.getByRole("button", { name: "Previous" }).click();
  await page.getByRole("button", { name: "Previous" }).click();
  const correctedAttendanceRow = page.getByRole("row").filter({ hasText: "03 Jun" });
  await expect(correctedAttendanceRow).toContainText("Present");
  await expect(correctedAttendanceRow).toContainText("09:00");
  await expect(correctedAttendanceRow).toContainText("18:00");
  await expect(correctedAttendanceRow).toContainText("Approved");
  await page.goto("/staff/me/overtime");
  await expect(page.getByText(labels.overtime)).toBeVisible();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
  await page.goto(`/staff/travel/${records.travelId}`);
  await expect(page.getByText("Closed", { exact: true }).first()).toBeVisible();

  // The setup IDs prove all independent records were created rather than using demo rows.
  expect(Object.values(records).every(Boolean)).toBe(true);
});
