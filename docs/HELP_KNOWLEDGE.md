# Help & Knowledge

The authenticated `/staff/help` page provides searchable, task-based employee and HR guides. HR and Super Admin default to the HR guide, which includes employee guidance. Every article's role restriction applies even inside the HR guide: HR cannot browse, search or open Finance-only instructions. Finance sees its own responsibilities plus personal employee guidance, not HR administration. Everyone retains personal payslip help. Guide content contains instructions, never live employee records.

## Content ownership

- `src/lib/help/employee-guide.ts`: personal employee workflows.
- `src/lib/help/hr-guide.ts`: HR workflows and company setup procedures.
- `src/lib/help/responsibilities-guide.ts`: manager, Finance and IT tasks, restricted by active role in the guide.
- `src/lib/help/detailed-guide.ts`: supporting procedures and troubleshooting.
- `src/lib/help/basics-guide.ts`: form basics, searching for colleagues and understanding request statuses.
- `src/lib/help/walkthroughs.ts`: role-specific first-use checklists, preparation, approval flows and field explanations.
- `public/help/`: small screenshots of empty demo forms; no real employee records.
- `src/lib/help/catalog.ts`: combined articles and additional covered destinations.
- `src/lib/help/guide.ts`: role selection and local ranked search, including common search alternatives.

Keep instructions in everyday language. Every article needs steps, an expected outcome, troubleshooting checks and a real app destination. Describe the current UI, not a planned feature. In particular, offer sending currently records manual sending; it does not send the offer email itself. Company Setup remains restricted to Super Admin even though HR can read its instructions.

## Updating a workflow

1. Update its article in the same change as the workflow.
2. Verify menu labels, required fields, approval stages and who can perform each action.
3. Add common employee search phrases to the article keywords.
4. Keep IDs stable so saved article links continue to work.
5. Run `tests/help-guide.test.ts` and `tests/e2e/help-guide.spec.ts`.

The coverage test checks all role sidebars and every current Company Setup section. This detects missing topic coverage, not every possible business-rule discrepancy; changes still need a human content review. Browser tests cover employee search, reload/back navigation, restricted HR links and mobile HR help. No extra staff modules or external AI service are required to search the guides.

## Visual examples

Run `tests/e2e/help-capture.spec.ts` with `VIA_HR_CAPTURE_HELP=1` against the seeded, loopback test database and development server used by the browser suite. The capture tool refuses non-loopback/test database targets. It only opens empty forms and does not submit them. Review every generated image for accuracy and privacy, update its dimensions in `walkthroughs.ts`, then run Help tests. Never capture production records or edit a screenshot to invent a control. Images are loaded only on the relevant article and can be enlarged; field explanations remain available if an image fails.

## Human acceptance check (not yet completed)

Automated checks cannot establish that every person will understand every task. Before claiming training-free operation, ask an employee, HR user and Finance user to complete these tasks in a test workspace using only Help, without spoken instructions:

- Employee: find the correct leave type, choose a covering colleague, submit a request, find its reviewer/status, correct a missed clock-out and submit a timesheet.
- HR: find and confirm an employment record, review a request, grant late sick-leave permission, publish a policy to its intended audience and route an offer for independent approval.
- Finance: find an employee, upload the right payslip, replace an incorrect one, prepare payroll and identify the independent approval step.
- Each role: search using their own words on a phone, enlarge an example, return to the task and confirm the outcome. They must not receive another role's restricted articles.

Record where participants hesitate and improve those articles and screens before marking this acceptance check complete.
