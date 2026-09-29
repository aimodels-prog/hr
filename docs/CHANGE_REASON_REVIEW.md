# Reason-field review

Reviewed the user-facing reason fields, service validation and server actions on 2026-09-29.
Optional notes do not disable permissions, approval routing, effective dates, confirmation dialogs or audit records.

## Optional notes

- Employment: location, project and cost-centre updates; initial employment setup while awaiting HR confirmation. Compensation always needs a reason. Unchanged fields submitted by a full form must not turn a location edit into a contract change.
- Personal records: preferred name, phone, personal email, address and emergency contacts. Sensitive identity/eligibility/dependant changes still require an explanation.
- Training: free active catalogue courses; HR assignment of a mandatory course. Paid discretionary requests and assignments require justification.
- Unused training course archive/restore: optional note; previous requests or sessions make a reason necessary. Existing active-assignment protection remains.
- Vacancies: submission/publication, archiving a closed vacancy, or closing an open/paused vacancy when recorded hires meet the complete headcount. Early closure, pausing and reopening need a reason.

## Already optional or automatic

- Annual leave notes; withdrawing pending leave.
- Normal approval comments (rejection/return comments remain required).
- Training-request withdrawal notes.
- Routine candidate details/ownership edits, document downloads, imports and checklist/scorecard-template archive actions already supply automatic audit descriptions rather than user-entered reasons.

## Intentionally retained

- Payroll adjustments, payslip replacement, salary changes and reopening locked records.
- Confirmed employment terms, reporting-line changes and employee status/access changes.
- Manual attendance corrections, terminal identity mapping, attendance-policy exceptions and approved duty changes.
- Approved-leave cancellation/amendment, leave balance adjustments, late-submission permissions and policy exceptions.
- Overtime justification; travel purpose, expense returns and approval rejections.
- Recruitment ranking overrides, interview/hiring decisions, missing-evidence waivers and scorecard reopening.
- Document rejection/replacement and expiry waivers; onboarding/offboarding cancellation or waived clearance requirements.

Pending leave currently supports withdrawal without a reason, not direct date editing. Employees can withdraw and resubmit; approved date changes retain the existing explanation and reapproval flow.

The database determines conditional requirements from stored records, not a client-provided optional/required flag. Automatic descriptions are used only for routine actions; they never satisfy a required explanation on the caller's behalf.
