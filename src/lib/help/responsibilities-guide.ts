import { article, type HelpArticle } from "./guide.ts";
import type { Role } from "../data/types.ts";

const manager: Role[] = ["Line Manager", "HR", "Super Admin"];
const finance: Role[] = ["Accounts", "Super Admin"];
const assigned = (item: HelpArticle, roles: Role[]): HelpArticle => ({ ...item, roles });

// These are employee responsibilities, shown only to the roles that perform them.
// HR's full guide does not bypass these role restrictions.
export const responsibilitiesGuide = [
  assigned(
    article(
      "manager-review",
      "employee",
      "Assigned responsibilities",
      "Review a request as a line manager",
      "Make a decision for the employees assigned to you.",
      "/staff/requests",
      "manager approve leave overtime travel correction direct report supervisor return",
      [
        "Select your Line Manager role where needed and open Requests & approvals.",
        "Open a request assigned to you and read its dates, details, evidence and outstanding stage.",
        "Approve it when correct, return it with a clear correction request where available, or decline with the required explanation.",
        "Check the new status. Leave, timesheets and other requests can still need HR or Finance action after your review.",
      ],
      "Being named as supervisor is not enough on its own; the app also checks your approval access and the assignment.",
      [
        "Do not approve another manager’s requests simply because you can see an employee’s name.",
        "Your own requests still need an independent authorised reviewer.",
      ],
      "employee:view_direct_reports",
    ),
    manager,
  ),
  assigned(
    article(
      "manager-timesheets",
      "employee",
      "Assigned responsibilities",
      "Review your team’s timesheets",
      "Check actual hours and return specific mistakes for correction.",
      "/staff/timesheet-approvals",
      "manager timesheet approval return hours manual automatic task",
      [
        "Open Timesheet Approvals and choose a submitted sheet assigned to you.",
        "Check the week, recorded hours, leave and any explanation of a difference from attendance.",
        "Return incorrect hours or details with a clear explanation, or complete your approval.",
        "Check that the sheet moves to the next required stage.",
      ],
      "HR must also approve the timesheet before Finance uses it. Automatically filled attendance hours do not bypass review.",
      [
        "A task description is not a blanket requirement. Ask for information that is needed to resolve an actual issue.",
        "Longer attendance is not an approved overtime request.",
      ],
      "timesheet:approve_direct_reports",
    ),
    manager,
  ),
  assigned(
    article(
      "manager-travel",
      "employee",
      "Assigned responsibilities",
      "Review team travel",
      "Check the business need and proposed dates before the other travel reviews.",
      "/staff/travel-approvals",
      "team travel manager review approve return trip",
      [
        "Open Team Travel Approvals and find the assigned request.",
        "Review the business purpose, dates, destination, expected cost and effect on team coverage.",
        "Complete your decision using the available action and give the required explanation.",
        "Read the remaining HR and Finance stages before telling the employee the trip is fully approved.",
      ],
      "Your decision is one part of the travel approval process, not confirmation of reimbursement.",
      [
        "For an unplanned local work visit, check whether the quick visit process is more appropriate.",
      ],
      "travel:manager_review",
    ),
    manager,
  ),
  assigned(
    article(
      "manager-performance",
      "employee",
      "Assigned responsibilities",
      "Agree objectives and review team performance",
      "Give employees clear goals and useful feedback within the review period.",
      "/staff/performance/team",
      "manager objective appraisal team review goals self assessment",
      [
        "Open Team Performance and choose the employee and review period.",
        "Review and agree the person’s objectives before completing their appraisal.",
        "Read the employee’s self-assessment and evidence, then complete your review against the agreed criteria.",
        "Submit the review and complete the follow-up or acknowledgement steps requested.",
      ],
      "HR manages the cycle and tracks completion. Your review should relate to the agreed objectives and period.",
      [
        "Ask HR if the employee or review is not assigned correctly. Do not review under another person’s login.",
      ],
      "performance:view_direct_reports",
    ),
    manager,
  ),
  assigned(
    article(
      "finance-travel",
      "employee",
      "Assigned responsibilities",
      "Review travel costs as Finance",
      "Complete the Finance stage without replacing the Manager or HR decision.",
      "/staff/travel-accounts-approvals",
      "finance accounts travel approval cost advance currency budget",
      [
        "Open Accounts Travel Approvals and choose the pending request.",
        "Review estimates, currency, requested advances and the supporting information.",
        "Approve or return the Finance stage using the available decision controls.",
        "Check the remaining reviews and leave the overall status to the supported approval process.",
      ],
      "Travel approval and later reimbursement closure are separate actions.",
      [
        "Use your own account even when more than one Finance person shares the work. Check the latest status before deciding.",
      ],
      "travel:finance_review",
    ),
    finance,
  ),
  assigned(
    article(
      "finance-settlement",
      "employee",
      "Assigned responsibilities",
      "Settle travel reimbursements",
      "Reconcile actual expenses, receipts and advances before closure.",
      "/staff/travel-closures",
      "finance accounts reimbursement settlement closure receipt payment advance",
      [
        "Open Reimbursement Settlement and choose the correct travel case.",
        "Review actual expenses and receipts against the approved trip and any advance.",
        "Request corrections for missing or inconsistent evidence, or enter the required settlement details.",
        "Complete the authorised closure action and verify the resulting status.",
      ],
      "Closure records the settlement stage. Keep the supporting payment and expense evidence requested by the app.",
      ["Do not mark a trip settled merely because the travel request was approved."],
      "travel:final_close",
    ),
    finance,
  ),
  assigned(
    article(
      "finance-overtime-ledger",
      "employee",
      "Assigned responsibilities",
      "Use the approved overtime ledger",
      "Use approved claims for payroll rather than raw clock-in records.",
      "/staff/payroll/overtime",
      "finance accounts overtime payroll ledger approved export paid",
      [
        "Open Overtime Ledger and select the relevant period or employee.",
        "Review claims that completed the required manager and HR approvals.",
        "Check that the hours belong to the correct payroll period and have not already been handled.",
        "Use the available Finance or export action and verify its result.",
      ],
      "An employee’s extra time in the office is not automatically added as payable overtime.",
      [
        "Your personal pending or rejected claims remain under My Overtime, not the approved Finance ledger.",
      ],
      "payroll:view",
    ),
    finance,
  ),
  assigned(
    article(
      "assigned-tasks",
      "employee",
      "Assigned responsibilities",
      "Complete an assigned equipment or access task",
      "Handle only the work assigned to you in a joining or leaving checklist.",
      "/staff/my-tasks",
      "it task equipment provision remove access onboarding offboarding assigned owner",
      [
        "Open My Tasks and choose your assigned item.",
        "Check the employee, requested action and due date before carrying out the work.",
        "Complete the required handover or access action and add the requested confirmation or evidence.",
        "Mark the task complete only when the work is genuinely finished. Tell HR if it is blocked.",
      ],
      "Completing your task does not finish the whole joining or leaving case; HR coordinates the remaining checks.",
      [
        "An IT task does not grant general access to private employee, recruitment or payroll records.",
      ],
      undefined,
    ),
    ["IT", "HR", "Super Admin"],
  ),
];
