import type { Role } from "../data/types.ts";

export interface HelpWalkthrough {
  before: string[];
  image?: { name: string; alt: string; width: number; height: number };
  fields?: { label: string; meaning: string }[];
  flow?: string[];
}

// Images are empty forms captured from the isolated demo workspace, not customer records.
export const helpWalkthroughs: Record<string, HelpWalkthrough> = {
  leave: {
    before: [
      "Have your absence dates ready. Check your balance and that HR has confirmed your employment details.",
      "Arrange a covering colleague if required and have any supporting document ready.",
    ],
    image: {
      name: "request-leave",
      alt: "Request Leave form with leave type, start and end dates, reason, covering colleague and Submit Request.",
      width: 600,
      height: 532,
    },
    fields: [
      {
        label: "Leave Type",
        meaning:
          "Choose why you will be away. The type determines the allowance and evidence needed.",
      },
      {
        label: "Start Date / End Date",
        meaning:
          "Enter the first and last day of your requested absence. Check the calculated working days before submitting.",
      },
      {
        label: "Reason for Leave / Covering Colleague",
        meaning:
          "Complete these when required for the chosen leave type. Open Search covering colleague and type their name, employee number or work email, then select the correct person. This is the person covering your work, not your approver.",
      },
      {
        label: "Submit Request",
        meaning: "Sends the request for review. It does not mean your leave has been approved.",
      },
    ],
    flow: ["Submit request", "Required reviews", "Read final decision"],
  },
  "quick-visit": {
    before: [
      "Know the destination and whether you are leaving from home or the office. For an office departure, clock in normally first.",
    ],
    image: {
      name: "quick-visit",
      alt: "Quick visit form showing visit type, destination, Home or Office, optional timing details and Send to HR.",
      width: 576,
      height: 470,
    },
    fields: [
      {
        label: "Visit type / Site or Destination",
        meaning:
          "Choose Site visit, Ministry visit, Client visit or Other duty, then name where you are going.",
      },
      {
        label: "Starting from",
        meaning:
          "Choose your real starting point. This changes how the attendance record is handled.",
      },
      {
        label: "Change time, return or add details",
        meaning:
          "Open this only if the suggested time or return plan needs changing. The quick form starts with today and now.",
      },
      {
        label: "Send to HR",
        meaning:
          "Notifies HR and your supervisor. Check the visit status. The stated default close is 5 pm after HR confirmation.",
      },
    ],
  },
  "hr-leave-review": {
    before: [
      "For a late sick-leave permission, confirm the employee’s exact sick dates and why they could not apply on time. Another HR colleague must authorise your own case.",
    ],
    image: {
      name: "sick-leave-permission",
      alt: "Permit backdated sick leave form with employee, first sick day, last sick day, reason and Grant permission.",
      width: 512,
      height: 510,
    },
    fields: [
      {
        label: "Employee",
        meaning: "Choose the person who needs permission, not the person granting it.",
      },
      {
        label: "First sick day / Last sick day",
        meaning:
          "The permission is for these exact dates; it is not permission to submit any past absence.",
      },
      {
        label: "Grant permission",
        meaning:
          "Allows one application within 14 days. Tell the employee to submit it with the required medical evidence. Normal approvals still apply.",
      },
    ],
    flow: ["HR permits late application", "Employee applies", "Normal leave reviews"],
  },
  "hr-library": {
    before: [
      "Have the approved original document as a PDF up to 10 MB. Decide whether it is for all staff or HR only.",
    ],
    image: {
      name: "company-document",
      alt: "Upload document form showing document name, document area, category, reader audience, original PDF and Save draft.",
      width: 512,
      height: 608,
    },
    fields: [
      {
        label: "Document name / Category",
        meaning:
          "Use a clear title people would search for, such as Annual Leave Policy. The category groups similar documents.",
      },
      {
        label: "Document area",
        meaning:
          "Choose SOP or policy for employee instructions, or the company-document area for company records. The fields shown can change with this choice.",
      },
      {
        label: "Who can read it?",
        meaning:
          "Check the audience before publishing. Do not share a private HR record with all staff.",
      },
      {
        label: "Save draft",
        meaning:
          "Uploads a draft, not a published policy. Review the document and its prepared text before publishing.",
      },
    ],
    flow: ["Upload draft", "Review and correct", "Publish to chosen audience"],
  },
  "hr-payslip": {
    before: [
      "Use your Finance role. Have one employee’s correct PDF payslip ready, up to 10 MB, and confirm the pay month.",
    ],
    image: {
      name: "finance-payslip",
      alt: "Finance payslip upload showing the employee selector, pay month, PDF chooser and Upload and share button.",
      width: 960,
      height: 362,
    },
    fields: [
      {
        label: "Manage employee payslips",
        meaning:
          "Choose this on My Payslips to switch from your personal payslips to Finance’s employee view.",
      },
      {
        label: "Employee / Pay month",
        meaning:
          "Select the owner of the payslip and the month the pay relates to. Do not leave the suggested month unchecked.",
      },
      {
        label: "Upload & share",
        meaning:
          "Makes the file available to that employee immediately. Check the person and PDF before pressing it.",
      },
      {
        label: "Replace / History",
        meaning:
          "Replace corrects an issued payslip with a recorded reason. History lets Finance review older versions.",
      },
    ],
    flow: ["Select employee and month", "Check their PDF", "Upload and share"],
  },
  "hr-finance": {
    before: [
      "Use the Finance role. Confirm the pay period and planned payment date, and identify a different authorised Finance person to review your prepared period.",
      "Check that the required timesheets and overtime have completed their approvals. Do not use raw attendance as approved overtime.",
    ],
    image: {
      name: "payroll-period",
      alt: "Create Payroll Period form with period name, start, end, cutoff and payment dates, and Create Period.",
      width: 512,
      height: 380,
    },
    fields: [
      {
        label: "Period Name / Start Date / End Date",
        meaning:
          "Give the period a recognisable name and set the dates covered by this payroll. The pictured dates are examples only.",
      },
      {
        label: "Cutoff Date / Payment Date",
        meaning:
          "Enter the agreed date for collecting payroll information and the planned payment date. Check suggested dates rather than accepting them automatically.",
      },
      {
        label: "Collect Inputs",
        meaning:
          "Collects the payroll information and refreshes the list of issues to review. It does not pay employees.",
      },
      {
        label: "Approve Payroll / Lock Period / Export CSV",
        meaning:
          "A different Finance person approves. Lock the approved period before exporting the pay information. Exporting a file is not a bank payment.",
      },
    ],
    flow: ["Prepare and check", "Different Finance reviewer approves", "Lock and export"],
  },
  timesheets: {
    before: [
      "Choose the correct week and confirm your hours, leave and breaks. Attendance suggestions still need your review.",
    ],
    flow: ["Employee submits", "Manager reviews", "HR approves", "Finance uses approved record"],
  },
  "missing-clockout": {
    before: [
      "Confirm yesterday’s real finishing time. If you are unsure, ask HR rather than guessing.",
    ],
    flow: ["Enter actual clock-out", "Submit to HR", "HR reviews correction"],
  },
  "hr-offers": {
    before: [
      "Check the candidate, agreed terms and assigned manager. The manual-sending form does not send an email for you.",
    ],
    flow: [
      "HR prepares",
      "Assigned manager approves",
      "HR sends email",
      "HR records sending evidence",
    ],
  },
  "hr-screening": {
    before: [
      "Check that the vacancy requirements and latest CV are correct. Resolve unreadable documents and uncertain compulsory criteria.",
    ],
    flow: ["Upload current CV", "Review preparation", "Compare with role", "HR selects candidates"],
  },
  "finance-settlement": {
    before: [
      "Have the approved travel case, actual expenses, receipts and any advance details ready.",
    ],
    flow: ["Review expenses", "Resolve differences", "Record settlement", "Close case"],
  },
  "hr-offboarding": {
    before: [
      "Check the leaving date and that the case is active, not cancelled. Confirm the owners of the handover and clearance tasks.",
    ],
    flow: ["Assign clearances", "Owners complete tasks", "HR checks evidence", "HR completes case"],
  },
};

export function helpStart(role: Role) {
  switch (role) {
    case "HR":
      return {
        title: "Your HR starting checklist",
        ids: [
          "hr-start",
          "hr-employee",
          "hr-approvals",
          "hr-library",
          "hr-attendance",
          "getting-started",
        ],
      };
    case "Super Admin":
      return {
        title: "Your administration starting checklist",
        ids: [
          "hr-users",
          "setup-org",
          "setup-departments",
          "setup-locations",
          "hr-start",
          "getting-started",
        ],
      };
    case "Accounts":
      return {
        title: "Your Finance starting checklist",
        ids: [
          "hr-finance",
          "hr-payslip",
          "finance-travel",
          "finance-settlement",
          "finance-overtime-ledger",
          "getting-started",
        ],
      };
    case "Line Manager":
      return {
        title: "Your manager starting checklist",
        ids: [
          "manager-review",
          "manager-timesheets",
          "manager-travel",
          "manager-performance",
          "getting-started",
        ],
      };
    case "IT":
      return {
        title: "Your IT starting checklist",
        ids: ["assigned-tasks", "getting-started", "tasks"],
      };
    default:
      return {
        title: "Your employee starting checklist",
        ids: ["getting-started", "profile", "leave", "attendance", "timesheets", "tasks"],
      };
  }
}
