# VIA HR System Implementation Progress

This checklist tracks the prompts in `IMPLEMENTATION_PROMPT_PLAYBOOK.md`. A step is marked complete only after its implementation and verification finish.

- [x] Step 01 - Create the implementation foundation and progress tracker
- [x] Step 02 - Development identity, permissions, and role preview
- [x] Step 03 - Complete responsive application shell and navigation
- [x] Step 04 - Organisation settings and master data
- [ ] Step 05 - Employee directory page
- [ ] Step 06 - Create and manage employee records
- [ ] Step 07 - Employee profile and self-service profile
- [ ] Step 08 - Digital employee files and document versions
- [ ] Step 09 - Document expiry centre and reminders
- [x] Step 10 - Vacancy list and vacancy lifecycle
- [x] Step 11 - Vacancy creation and AI-draft UI
- [x] Step 12 - Public careers portal refresh
- [x] Step 13 - Public candidate application flow
- [x] Step 14 - Candidate database and profile
- [x] Step 15 - Candidate spreadsheet import wizard
- [x] Step 16 - Candidate contact tracker
- [x] Step 17 - Recommendations and recruitment sources
- [x] Step 18 - Candidate scanning and explainable scoring
- [x] Step 19 - Shortlist selection and HR overrides
- [x] Step 20 - Interview scheduling
- [x] Step 21 - Interview scorecards
- [x] Step 22 - Hiring decision and offers
- [x] Step 23 - Leave policies and balance ledger
- [ ] Step 24 - Employee annual-leave request and automatic refusal
- [ ] Step 25 - Leave manager and Super Admin approvals
- [ ] Step 26 - Leave administration, cancellation, and calendar
- [x] Step 27 - Timesheet setup and project/activity controls
- [ ] Step 28 - Employee weekly timesheet page
- [ ] Step 29 - Manager timesheet approval and corrections
- [x] Step 30 - Attendance records and correction requests
- [x] Step 30A - Office geofence, sign-out reminders, and site-visit attendance
- [ ] Step 31 - Overtime requests and approval
- [ ] Step 32 - Employee travel pre-authorisation request
- [ ] Step 33 - HR and Accounts travel approvals
- [ ] Step 34 - Post-trip expenses and Super Admin closure
- [ ] Step 35 - Payroll preparation and restricted access
- [x] Step 36 - Candidate-to-employee conversion
- [x] Step 37 - Onboarding templates and case workflow
- [ ] Step 38 - Offboarding and clearance
- [x] Step 39 - Performance review cycles
- [x] Step 40 - Training catalogue and employee records
- [x] Step 41 - Notification centre and task inbox
- [ ] Step 42 - Audit history and record activity timelines
- [ ] Step 43 - Role-specific dashboards
- [x] Step 44 - Reports and role-safe exports
- [ ] Step 45 - Full application quality and completion pass
- [ ] Step 46 - Google Workspace portal authentication
- [ ] Step 47 - External AI, email, and Google Calendar integrations
- [ ] Step 48 - Production backend and launch readiness

### Production database sequence (`IMPLEMENTATION_PROMPT_PLAYBOOK_V3.md`)

- [ ] Step H3.1 - PostgreSQL and Drizzle foundation (local/repository work complete; managed staging environment pending the approved provider and data-residency region)
- [x] Step H3.1B - Contabo Node runtime and isolated production deployment package
- [x] Step H3.2 - Master data, app-managed dropdowns, projects and employee schema
- [x] Step H3.3 - Remaining module schemas and append-only audit controls
- [x] Step H3.4 - Deterministic staging-data importer
- [ ] Step H3.5 - Incremental service migration and browser-storage cutover

### Internal completion sequence

- [x] Completion Step 01 - Integration-ready providers and persisted operation states
- [x] Completion Step 02 - Recommender-to-employee linkage and source directory
- [x] Completion Step 03 - Weighted vacancy-specific interview scoring
- [x] Completion Step 04 - Accepted-offer conversion and Workspace provisioning queue
- [x] Completion Step 05 - Onboarding activation and verification workflow
- [ ] Completion Step 06 - Projects, unified leave, and geofenced attendance
- [x] Completion Step 07 - Training catalogue and assignments
- [ ] Completion Step 08 - Notification triggers and record audit timelines
- [x] Completion Step 09 - Reports, filters, saved views, print, and safe exports
- [ ] Completion Step 10 - Placeholder removal, quality gates, and role acceptance

## Verification log

### Step 01

- Status: Complete on 2026-08-16
- Scope: Versioned structured storage, repositories, IndexedDB files, deterministic seeds, backup/restore/reset, audit, notifications, tests, and app initialisation.
- Verification:
  - `npm test`: 6/6 foundation tests passed.
  - Strict isolated TypeScript check for `src/lib/data/index.ts` and its complete dependency graph: passed.
  - Targeted ESLint for all Step 01 TypeScript and the root initialiser: passed with no warnings.
  - `npm run build`: production client, SSR, and Nitro build passed.
  - Runtime smoke test: `/`, `/staff`, `/staff/candidates`, `/staff/interviews`, and `/jobs/log-ops-lead` returned HTTP 200 with HTML.
  - `git diff --check`: passed.
  - Full `npm run typecheck`: the Step 01 data layer passes a strict isolated TypeScript check; the repository-wide command remains blocked by two pre-existing typed links to `/staff/onboarding`, whose route is intentionally not built until its planned later step.
  - Full `npm run lint`: Step 01 files pass targeted lint; the repository-wide command remains blocked by pre-existing CRLF/Prettier mismatches and six existing Fast Refresh warnings. Unrelated files were not bulk-reformatted.
- Decisions:
  - Google Workspace authentication remains deferred.
  - Node's built-in test runner is used with its TypeScript transform flag, avoiding a new test-framework dependency.
  - Structured records use versioned `via_hr:*` keys; binary uploads use the `via_hr_files` IndexedDB database.
  - Demo seed IDs and values are deterministic. Reset clears file blobs, restores the same seed records, and writes a new reset audit event through the application-level service.
  - Existing recruitment UI remains unchanged and continues using its current demo data until the planned recruitment repository migration steps.

### Step 02

- Status: Complete on 2026-08-16
- Scope: Central permission catalogue, role-to-permission mapping for all 5 roles, record-scope selectors, field-level redaction (salary, bank, passport, performance, recruitment notes), route guards, audited access-denied page, development role preview switcher, and unit test suite.
- Verification:
  - `npm test`: 15/15 tests passed across foundation and permissions test suites.
  - `npx tsc --noEmit`: 100% clean across the entire repository with `exactOptionalPropertyTypes: true`.
  - Targeted ESLint: 0 errors, 0 warnings across all Step 02 TypeScript and React components.
  - `npm run build`: production client, SSR, and Nitro worker build passed.
  - `git diff --check`: passed.
- Decisions:
  - Authentication remains deferred to Step 46. The development role preview switcher is placed in the header with unambiguous labels ("Development role preview" / "Simulated identity context").
  - Preview state is stored in browser storage (`via_hr:dev_preview_state`) so identity switches persist across page reloads.
  - Identity switches emit `preview_identity_change` audit events; route guard blocks emit `access_denied` audit events.
  - Route guards on `/staff/candidates`, `/staff/interviews`, `/staff/vacancy`, and `/staff/payroll` actively restrict access and present an actionable `<AccessDenied />` UI with one-click preview switcher buttons.

### Completion Step 01

- Status: Complete on 2026-08-20
- Scope: Replaceable integration-provider contracts, deterministic local providers, central registry and gateway, persisted integration-operation states, retry/failure handling, audit coverage, and wiring for job-description drafting, candidate scoring, and interview availability.
- Verification:
  - `npm test`: 20/20 tests passed, including five integration-provider and operation-state tests.
  - `npm run typecheck`: passed repository-wide with no TypeScript errors.
  - Targeted ESLint for the new integration layer, AI/scoring adapters, and integration tests: passed with no errors or warnings.
  - `npm run build`: production client, SSR, and Nitro build passed.
  - Full `npm run lint`: remains blocked by the repository's existing formatting and explicit-`any` backlog outside this completion step; no lint suppression was added.
- Decisions:
  - No external credentials, network calls, Google events, Meet links, emails, Workspace accounts, or external AI requests were added.
  - Local provider outcomes are persisted as `Simulated`; external providers can later report `Completed` without changing calling components.
  - Provider operations use `Not Required`, `Pending`, `Simulated`, `Ready to Sync`, `Completed`, and `Failed` states and retain request/response summaries, references, attempt timestamps, failure reasons, and retry counts.
  - Recommendation probation, retention, performance, and offboarding outcomes remain out of scope as requested.

### Recruitment completion pass (Steps 10-22, 36; Completion Steps 02-05)

- Status: Complete on 2026-08-20 for the browser-only implementation.
- Scope:
  - Enforced vacancy and offer state machines, persistent draft-offer editing, Ready-to-Send delivery, response outcomes, and automatic accepted-offer conversion.
  - Persisted simulated calendar events, Google Meet records, candidate/panel invitations, offer delivery, Workspace provisioning, and onboarding welcome delivery through replaceable providers.
  - Vacancy/stage-specific scorecard templates with criterion weights, minimum scores, critical criteria, blind scoring, and configurable AI/interview decision weights.
  - Recommendation source types, active-user ownership, role-safe commercial terms, permanent candidate/recommendation/employee linkage, and employee-to-source navigation. Probation, retention, performance, and offboarding source outcomes were intentionally not added.
  - Deterministic employee number and Workspace email creation, employee/user mapping, automatic onboarding case creation, and mandatory personal, bank, passport, visa, national-ID, and contract intake tasks.
  - Real vacancy applications, interviews, activity, and versions content replaced the vacancy-detail placeholders.
  - Candidate import now uses the active HR actor and creates a batch audit event; the supplied workbook was read successfully with six sheets and 479 total worksheet rows including headings.
- Verification:
  - `npm test`: 24/24 tests passed, including connected recruitment tests for vacancy-to-shortlist, spreadsheet import, interview/integration records, weighted critical scoring, offer lifecycle, automatic conversion, source linkage, Workspace mapping, and onboarding creation.
  - `npm run typecheck`: passed repository-wide.
  - Targeted ESLint for the new and materially changed recruitment services, offer/settings/interview UI, employee source panel, and recruitment tests: passed with no errors or warnings.
  - `npm run build`: production client, SSR, and Nitro build passed.
  - Full `npm run lint`: still fails on the repository-wide historical formatting and explicit-`any` backlog (4,850 findings); this pass did not bulk-rewrite unrelated user work.
- Decisions:
  - External Google Workspace, Calendar, Meet, email, and AI calls remain deferred. The complete workflow executes locally and persists simulated operation records so providers can be replaced later.
  - An accepted offer now initiates conversion and onboarding immediately; the separate conversion page remains only as a recoverable/manual fallback for legacy accepted records.
  - Commercial recommendation terms are returned by the shared service only for the active HR, Accounts, or Super Admin context, rather than being protected solely by hidden UI.

### UI excellence pass — brand, careers and shared application shell

- Status: Complete on 2026-08-20.
- Scope:
  - Replaced the Lovable-runtime logo reference with the supplied VIA International logo as a local, production-built asset.
  - Introduced a more confident VIA visual foundation across typography, colour, spacing, focus treatment, cards, page headers, table shells and empty states.
  - Refined the staff sidebar and header, removed the duplicate identity/avatar treatment and removed the non-functional account menu while authentication remains deferred.
  - Rebuilt the public careers home as a responsive employer-brand experience with a stronger hero, VIA principles, accessible filters, premium vacancy cards, purposeful zero-vacancy and no-results states, and a branded footer.
  - Improved the staff dashboard hierarchy and quick-access navigation without changing role permissions, storage or workflow behaviour.
- Verification:
  - Targeted Prettier: completed for every file changed by the UI pass.
  - Targeted ESLint: no errors; one pre-existing Fast Refresh warning remains in the shared button module because it exports both the component and its variant helper.
  - `npm run typecheck`: passed repository-wide.
  - `npm test`: 24/24 tests passed.
  - `npm run build`: production client, SSR and Nitro builds passed; the VIA logo is emitted as a versioned production asset.
  - Visual smoke tests: public careers and employee staff shell rendered successfully in headless Chrome at 1440px width; the public careers responsive layout was also checked at a 500px narrow viewport.
  - Full `npm run lint`: remains blocked by the existing repository-wide formatting and explicit-`any` backlog in unrelated modules; this pass did not bulk-reformat or weaken those files.
- Decisions:
  - The development identity switcher remains available until Google Workspace authentication is implemented, but is presented as a compact workspace control rather than primary product chrome.
  - The supplied horizontal logo is used full-colour on white and as a reversed mark on the navy sidebar/footer.
  - Recruitment and HR business logic were deliberately preserved; this pass changes presentation and shared interaction quality only.

### Employee profile world-class redesign

- Status: Complete on 2026-08-20.
- Scope:
  - Replaced the overcrowded horizontal profile navigation with a grouped, sticky desktop navigation and a compact mobile section selector.
  - Added an employee-centred identity banner with employment status, role, department, location, email, employee number, manager and system-access context.
  - Consolidated profile, work/development, history and restricted areas so the information architecture remains understandable as modules grow.
  - Restricted payroll navigation and content to contexts with `payroll:view`, and audit navigation/content to contexts with `system:audit_view`.
  - Rebuilt training and certification as a focused development workspace with a meaningful empty state, compact live metrics and a responsive records table.
  - Added a persistent Add Certification workflow with required-field validation, success/error feedback and repository audit creation through `TrainingService`.
- Verification:
  - Targeted Prettier completed for both changed profile files.
  - Targeted ESLint for the rewritten training workflow passed. The legacy profile container still reports its existing explicit-`any` and hook-dependency backlog outside the new presentation block.
  - `npm run typecheck`: passed repository-wide.
  - `npm test`: 24/24 tests passed.
  - `npm run build`: production client, SSR and Nitro builds passed.
  - Full `npm run lint`: remains blocked by the repository-wide historical formatting and explicit-`any` backlog in unrelated and legacy modules.
- Decisions:
  - The raw horizontal scrollbar is no longer part of primary profile navigation.
  - Empty certification data no longer renders an empty table or oversized zero-only cards.
  - Adding a certification persists immediately and remains visible after refresh; certificate-file upload continues through the existing document workflow.

### HR candidate tracker field alignment

- Status: Complete on 2026-08-20.
- Scope:
  - Treated `Candidates 2025.xlsx` strictly as HR's schema and sample-data reference.
  - Added distinct candidate fields for shortlist marker, HR tracker status, project name, project type, interview date and lossless original import values, alongside the existing position, company, experience, nationality, location, visa, marital status, notice, salary, contact and remarks fields.
  - Corrected spreadsheet mappings so Project is no longer stored as Source and Status is no longer conflated with Shortlisted or the internal recruitment workflow stage.
  - Added multi-row heading detection for sheets such as HQ, exact-header priority for Contact Number versus Last Contacted, source-row provenance and safe preservation of unmapped original values.
  - Expanded the candidate HR record editor and detail card to display and persist the supplied fields, with repository audit creation on every edit.
  - Updated the contact queue to search the additional HR fields, show imported project/type and tracker status, respect imported last-contact values and correctly classify overdue follow-ups.
- Verification:
  - The supplied six-sheet workbook was parsed directly; headings were detected on row 1 for the standard/legacy sheets and row 3 for HQ, with Contact, Contact Number and Last Contacted mapped to their correct distinct fields.
  - `npm test`: 24/24 tests passed, including a workbook-shaped recruitment import test covering the new fields, workflow-stage derivation, provenance and audit creation.
  - `npm run typecheck`: passed repository-wide.
  - Targeted Prettier and ESLint for all changed TypeScript/TSX files: passed.
  - `npm run build`: production client, SSR and Nitro builds passed.
  - Full `npm run lint`: remains blocked by the existing repository-wide formatting and explicit-`any` backlog (4,548 findings); no unrelated files or lint rules were changed.
- Decisions:
  - HR tracker status and shortlist markers are preserved as supplied free text; the app's controlled recruitment stage remains a separate field.
  - Imported last-contact data does not fabricate a contact event. Future calls and emails remain append-only contact records with actor, outcome, notes and follow-up date.
  - Project text is retained even when it does not match a configured project; HR can link the candidate to project master data later without losing the workbook value.

### Manual and offline interview path

- Status: Complete on 2026-08-20.
- Scope:
  - Added a first-class `Manual / Offline` interview source that does not require a vacancy or application and records the actual interview date, duration, timezone, method, location, position, project, panel, notes and HR-selected scoring template.
  - Manual interview creation explicitly avoids availability checks, calendar events, Meet creation, invitations, applications and shortlist records.
  - Assigned panel members receive normal private scorecards in the Interviews workspace; `Selected` is rejected until every assigned scorecard has been submitted.
  - Added controlled manual outcomes: `Proceed`, `Hold`, `Reject` and `Selected`, each with a mandatory decision reason and corresponding candidate-stage update.
  - Added a `Proceed to hire` flow that confirms position, department, location, employment type and grade. Where no vacancy exists, the system creates a closed administrative direct-hire record with zero applicants, then creates a finalized manual-interview hiring decision.
  - The selected candidate continues through the existing job-offer workflow. Offer acceptance therefore continues to use the existing automatic employee conversion, Workspace-email preparation and onboarding-case creation.
  - Removed the candidate-page shortcut that attached scheduled interviews to the first global vacancy. Scheduled interviews now use the candidate's own application vacancy and are disabled when the candidate has no application; HR is directed to the manual path instead.
  - Updated candidate and company-wide interview views to distinguish manual records and show their position, project, outcome and scorecard completion.
- Verification:
  - `npm test`: 25/25 tests passed, including a connected manual-interview test proving that no application, shortlist or integration operation is created before the selected candidate enters the controlled offer path.
  - `npm run typecheck`: passed repository-wide.
  - Targeted Prettier and ESLint for all changed interview, offer, candidate and test files: passed.
  - `npm run build`: production client, SSR and Nitro builds passed.
  - Full `npm run lint`: remains blocked by the existing repository-wide formatting and explicit-`any` backlog (4,548 findings); the manual-interview files add no targeted lint findings.
- Decisions:
  - A closed administrative vacancy is created only after HR selects `Proceed to hire`; it exists to preserve offer, conversion, reporting and onboarding referential integrity and never appears as a public vacancy.
  - A historical manual interview is stored as `Completed` with an outcome of `Pending` until HR records its decision; completion describes the meeting while outcome describes the hiring decision.
  - Existing scheduled interview records remain compatible because a missing source is treated as the legacy scheduled-recruitment path.

### Role-specific operational dashboard expansion

- Status: Complete on 2026-08-20.
- Scope:
  - Rebuilt the staff landing page as a role-specific operational command centre using live records from the existing browser repository services; no fabricated trend percentages or decorative actions were added.
  - Added shared responsive dashboard primitives for attention queues, metric strips, compact breakdown bars, progress rings and accessible panel actions.
  - HR now sees recruitment funnel health, upcoming and manual interviews, genuinely overdue scorecards, active offers, workforce distribution, onboarding progress and document-expiry risk.
  - Line Managers now see direct-report leave and timesheet approvals, recent attendance exceptions, overtime claims, team absence and per-employee workflow readiness.
  - Employees now see their own leave balance, current timesheet, recent requests, attendance alerts, overtime, training and document-expiry actions.
  - Accounts now sees travel budget approvals, payroll status, timesheet readiness, approved overtime and payroll exceptions. Reimbursement closure remains visible only as a monitoring count because the closing decision belongs to Super Admin.
  - Super Admin now sees active headcount, final leave approvals, payroll approvals, reimbursements awaiting closure, audit alerts, onboarding, open vacancies, workforce distribution and document risk.
  - Replaced the generic shortcut area with permission-aligned quick actions for HR, Line Manager, Accounts, Super Admin and Employee preview contexts.
- Verification:
  - Targeted Prettier and ESLint for all dashboard and staff landing-page files: passed with no errors or warnings.
  - `npm run typecheck`: passed repository-wide.
  - `npm test`: 25/25 tests passed, including role permissions, record scoping and connected recruitment/onboarding workflows.
  - `npm run build`: production client, SSR and Nitro worker builds passed.
  - Full `npm run lint`: remains blocked by the existing repository-wide formatting and explicit-`any` backlog (4,512 findings); none are in the dashboard files changed by this pass.
- Decisions:
  - Dashboard counts are computed from persisted local services and respect the active development role/person context; Google Workspace authentication and other external integrations remain deferred.
  - Attendance alerts are limited to the most recent 30 days so historical exceptions do not overwhelm current operational work.
  - Scheduled interviews appear as awaiting scorecards only after their confirmed meeting time has passed; completed and manual interviews continue to follow the existing controlled scoring process.
  - Accounts cannot navigate to or perform the Super Admin reimbursement-closure action from its dashboard.

### Steps 30 and 30A - Attendance, office geofence, and site visits

- Status: Complete on 2026-08-20 for the browser-only implementation.
- Scope:
  - Replaced mock attendance capture with an audited attendance ledger that rejects duplicate employee/date records, validates shifts, punches and breaks, supports overnight calculations, recalculates late/early indicators and reconciles VIA's configured working days, approved leave and structured public holidays.
  - Added an HR attendance command centre with daily roster and exception filters, CSV validation/preview/import, manual hardware/HR entry, date export, site-visit approvals, policy settings and office-geofence setup.
  - Added office setup that captures the administrator's current high-accuracy browser location and radius. Employee web clock-in/out is hard-blocked outside every configured office zone or when GPS uncertainty exceeds policy, and every blocked attempt is audited with coordinates and nearest-zone distance.
  - Added employee self-service clock-in/out, monthly summaries, daily records, correction history and evidence-backed punch corrections. The previous virtual-absence and rejected-correction deadlocks are fixed.
  - Implemented missed-sign-out handling: an earlier open record cannot be closed directly; the employee supplies actual punches, justification and optional evidence, the assigned Line Manager endorses or rejects, and HR makes the final decision. Approval applies the corrected sign-out and recalculates hours while preserving original values.
  - Added exactly three sign-out reminders after the employee completes the configured eight working hours (initial, +15 minutes and +30 minutes), deduplicated as in-app notifications while the portal is running.
  - Added HR-approved site visits with Office and Home origins. Office-origin visits require a verified office clock-in and close automatically at the approved visit end; Home-origin visits create scheduled automatic clock-in/out records without fabricating GPS coordinates.
  - Added Public Holidays master data with a structured holiday date and corrected weekend reconciliation to use organisation working-day settings (Sunday-Thursday in the VIA seed) instead of a hard-coded Saturday/Sunday weekend.
  - Added granular attendance permissions and service-level actor, active-role, self-scope and direct-report enforcement. Denied mutations are audited.
  - Added global portal reconciliation so approved site visits and sign-out reminders continue processing while any staff page is open; the notification drawer refreshes when new reminders are generated.
- Verification:
  - `npm test`: 32/32 tests passed, including seven new attendance tests for geofence denial/audit, three reminder delivery, clock lifecycle, missed sign-out approval, rejection/resubmission, home-origin automatic site attendance, service permission enforcement and atomic duplicate CSV rejection.
  - `npm run typecheck`: passed repository-wide.
  - Targeted Prettier and ESLint for the attendance domain, Employee/Manager/HR UI, permissions, global reconciliation, notification refresh, settings and tests: passed with no attendance findings.
  - `npm run build`: production client, SSR and Nitro worker builds passed.
  - Full `npm run lint`: remains blocked by the repository-wide historical formatting and explicit-`any` backlog (4,051 findings); the targeted attendance files pass.
- Decisions and limitations:
  - The user's instruction to make the office their current location supersedes the earlier map-picker design: HR captures the physical office coordinates from the browser while standing in the office, then sets the permitted radius.
  - HR-approved home-origin attendance uses the approved schedule, destination and audit trail; it is not treated as an office GPS punch.
  - Browser-only storage cannot execute code while every user's portal is closed. Reminders and scheduled site punches reconcile while the portal is open and immediately on the next opening. A future backend worker or push-notification provider can use the same persisted policy and workflow records for true offline/background delivery.
  - Google Workspace authentication and external notification services remain deferred as requested.

### Steps 28-30 enhancement - Timesheet and attendance reconciliation

- Status: Complete on 2026-08-20.
- Scope:
  - Connected weekly timesheets to the attendance ledger through a derived daily reconciliation; attendance remains the evidence of physical presence and the timesheet remains the allocation of worked hours to projects, cost centres, activities and locations.
  - Added configurable daily variance tolerance, defaulting to 0.25 hours, and comparisons for matched hours, variances, missing attendance, missing timesheet allocation, incomplete punches, leave, holidays and rest days.
  - Added an employee reconciliation panel with attendance hours, project hours, daily differences and persistent explanations. Material differences require a meaningful explanation before submission.
  - Added the same daily evidence to the Line Manager review page. Unresolved differences disable approval in the interface and are independently rejected by the service.
  - Reconciliation is recalculated from current attendance before manager approval, so an approved attendance correction or later HR attendance edit cannot silently leave a stale timesheet comparison.
  - Saved a reconciliation snapshot on submission and approval for audit/history while continuing to show the current live comparison.
  - Added service-level self, HR/Super Admin configuration and direct-report approval boundaries. Denied timesheet mutations create high-risk audit events.
- Verification:
  - `npm test`: 36/36 tests passed, including matching attendance, unexplained submission blocking, explained variance approval, live recalculation after attendance changes and access-denied auditing.
  - `npm run typecheck`: passed repository-wide.
  - Targeted Prettier and ESLint for the timesheet domain, employee entry page, manager review, settings and integration tests: passed.
  - `npm run build`: production client, SSR and Nitro worker builds passed.
  - Full `npm run lint`: remains blocked by 3,757 historical repository findings (3,735 errors and 22 warnings) in unrelated/legacy files; the targeted files changed for this integration pass cleanly.
- Decisions:
  - Leave and public-holiday hours remain non-project time and are displayed separately rather than being treated as physical attendance.
  - A difference can be submitted when the employee supplies a meaningful explanation; the Line Manager remains accountable for accepting or returning that explanation.
  - The integration does not overwrite either source record. This preserves attendance corrections and project allocation history independently.

### Leave entitlement persistence repair

- Status: Complete on 2026-08-23.
- Scope:
  - Migrated leave policies saved by older browser schemas so missing visibility, statutory and balance-tracking fields are restored without overwriting HR-edited policy values.
  - Added any policy definitions absent from an older saved dataset while preserving existing and archived policy records.
  - Reconciled current-year annual entitlements per active employee and eligible policy, rather than only when the entire leave transaction collection is empty.
  - Employees created through onboarding or added after initial setup now receive each applicable current-year entitlement exactly once.
  - Existing leave transactions, adjustments, carry-forward, approved leave and genuine HR policy changes remain unchanged.
- Verification:
  - Targeted Prettier and ESLint: passed.
  - `npm run typecheck`: passed.
  - `npm test`: 43/43 tests passed, including legacy-policy visibility and post-seed employee entitlement regressions.
  - `npm run build`: production client, SSR and Nitro worker builds passed.
- Decisions:
  - Missing legacy fields are backfilled from the approved VIA policy definitions; values already present in browser storage always win.
  - Entitlement repair is idempotent by employee, policy and calendar year, preventing duplicate grants on refresh.

### HR leave balance register and controlled editing

- Status: Complete on 2026-08-23.
- Scope:
  - Replaced the technical manual-transaction workflow with an HR balance register containing every active employee and eligible balance-tracked leave type.
  - Added employee/number search, department and leave-type filters, responsive table scrolling and 12-row pagination.
  - Added row-level Edit actions showing the current available balance, requested new balance and calculated difference before saving.
  - Balance corrections append an audited Manual Adjustment transaction; they never overwrite entitlement, carry-forward, usage or earlier correction history.
  - Added service validation for eligibility, editable policy scope, negative-balance limits, meaningful reasons and HR/Super Admin permissions. Denied attempts are audited.
  - Changed My Leave's HR action to open the complete balance register and corrected Leave Administration route access to use `leave:admin_all`.
- Verification:
  - Targeted Prettier and ESLint: passed without findings.
  - `npm run typecheck`: passed.
  - `npm test`: 45/45 tests passed, including successful audited correction and employee-role access denial.
  - `npm run build`: production client, SSR and Nitro worker builds passed.
- Decisions:
  - HR edits the understandable final available balance; VIA computes the underlying positive or negative adjustment.
  - Per-event leave such as maternity or marriage leave remains governed by its policy and is not presented as an editable running balance.

### Leave history tabs and plain-language product copy

- Status: Complete on 2026-08-23.
- Scope:
  - Combined Request History and Balance Activity into one responsive Leave History card with two tabs, clear record counts and independent pagination.
  - Request History is the default view; Balance Activity explains additions, usage, carry-forward and HR corrections in employee-friendly language.
  - Removed exposed implementation terminology from leave balances, final approvals, audit history, role preview, data backup/reset, vacancy scoring, interview scheduling, onboarding messages, reports and unfinished-page notices.
  - Reworded saved-data and backup compatibility errors so administrators receive clear next steps without internal storage terminology.
- Verification:
  - Targeted Prettier: passed.
  - Targeted ESLint for the leave page and clean copy-updated modules: passed. A broader targeted pass also surfaced only the existing explicit-`any` and hook-dependency backlog in legacy vacancy, report, audit and leave-approval files; no new lint findings were introduced by the copy changes.
  - `npm run typecheck`: passed.
  - `npm test`: 45/45 tests passed.
  - `npm run build`: production client, SSR and Nitro worker builds passed.
- Decisions:
  - Audit remains visible as a business accountability term required by HR; engineering terms such as ledger, schema, seed data, deterministic scoring and simulated operation are no longer shown in product copy.
  - Necessary device instructions, such as allowing location access for office attendance, remain because employees need them to complete the task.

### Plain, natural wording across VIA HR System

- Status: Complete on 2026-08-23.
- Scope:
  - Replaced overly formal leave wording: entitlement/granted/deducted/restoration/adjustment now appears as allowance/added/used/returned/correction.
  - Simplified leave-policy administration, annual rollover instructions, onboarding settings, attendance/timesheet comparisons and correction messages.
  - Reworded travel pre-approval actions, employee and recruitment confirmations, document actions, payroll corrections, performance submissions and vacancy decisions.
  - Shortened repetitive success messages so confirmations state the outcome directly.
  - Kept official policy names, legal references and workflow statuses where changing them would weaken accuracy or make approvals inconsistent.
- Verification:
  - Targeted Prettier: passed.
  - Targeted ESLint for the primary rewritten modules: passed. Legacy files included in the copy sweep retain their existing explicit-`any` and hook-dependency findings.
  - `npm run typecheck`: passed.
  - `npm test`: 45/45 tests passed.
  - `npm run build`: production client, SSR and Nitro worker builds passed.

### Employee portal-access wording and role selection

- Status: Complete on 2026-08-23.
- Scope:
  - Removed “System Mapping,” “System Roles,” “internal roles” and “user mapping” from the New Employee page.
  - Replaced the section with Portal Access and plain explanations of what each access choice allows the employee to do.
  - Employee self-service access is shown as included by default rather than as a disabled technical checkbox.
  - Line Manager, HR, Accounts and Super Admin are presented as optional responsibility cards with clear descriptions and selected-state styling.
- Verification:
  - Targeted Prettier: passed.
  - `npm run typecheck`: passed.
  - `npm test`: 45/45 tests passed.
  - `npm run build`: production client, SSR and Nitro worker builds passed.
  - The New Employee route retains its existing explicit-`any` lint backlog; this wording and UI change introduced no type or build failures.

### Employee-first access and User Management

- Status: Complete on 2026-08-23.
- Scope:
  - Every new employee now receives Employee access only, whether added directly or converted from recruitment.
  - Removed access selection from the New Employee form so employment details and access decisions are handled separately.
  - Added a dedicated User Management page for HR and Super Admin with search, access status, additional responsibility choices and a required reason for every change.
  - HR can assign Line Manager, HR, Accounts and IT access. Only a Super Admin can grant Super Admin access or change a Super Admin account.
  - Employee access cannot be removed, the final active Super Admin is protected, and denied access changes are recorded.
- Decisions:
  - An employee’s job title does not automatically grant wider access; HR or Super Admin must make that decision in User Management.
  - Super Admin access has a stricter control than normal operational access to prevent accidental full-system access.
- Verification:
  - Targeted Prettier and ESLint passed.
  - The repository-wide lint command still reports the existing formatting and legacy lint backlog outside this change (7,946 findings); no changed file in this feature has a targeted lint finding.
  - TypeScript typecheck passed.
  - 47/47 automated tests passed, including Employee-access retention and denied HR changes to Super Admin accounts.
  - Production client, server and worker builds passed, including the new `/staff/users` route.

### Leave evidence and public-holiday calculations

- Status: Complete on 2026-08-23.
- Scope:
  - Leave types requiring evidence now show a real PDF/JPG/PNG upload with file type and 10 MB size validation.
  - Evidence is stored in the browser file repository and linked to the leave request; submission is blocked in both the form and leave service when required evidence is missing.
  - Failed requests remove any newly uploaded orphan file.
  - Approvers can open supporting evidence directly from the request review card.
  - Active dates maintained under Public Holidays are excluded from full-day and half-day leave calculations.
- Decisions:
  - Older imported attachment links remain readable, while all new leave evidence uses the shared file repository.
  - An inactive public-holiday record does not affect leave calculations.
- Verification:
  - Targeted Prettier and ESLint passed for the leave service, request form, approval page and tests.
  - TypeScript typecheck passed.
  - 49/49 automated tests passed, including required-evidence rejection and public-holiday exclusion.
  - Production client, server and worker builds passed.

### Leave request and approval security

- Status: Complete on 2026-08-23.
- Scope:
  - The leave service now accepts employee submissions only when the signed-in employee matches the employee on the request.
  - Withdrawal and cancellation are protected by the same ownership rule.
  - A manager-stage decision is accepted only from the employee’s assigned line manager.
  - Final approval, final rejection and cancellation decisions require the active Super Admin role.
  - Approval steps are recorded consistently as Line Manager followed by Super Admin.
  - Every denied submission or decision is recorded in Audit History without changing the request.
- Decisions:
  - Having a managerial title or HR access does not allow someone to approve another manager’s direct report.
  - Having Super Admin assigned is insufficient when another role is active; the user must intentionally act as Super Admin for a final decision.
- Verification:
  - Targeted Prettier and ESLint passed.
  - TypeScript typecheck passed.
  - 51/51 automated tests passed, including cross-employee submission denial, incorrect-manager denial and Super Admin final approval enforcement.
  - Production client, server and worker builds passed.

### Role dashboards and operational accuracy

- Status: Complete on 2026-08-24.
- Scope:
  - Audited the Employee, IT, Line Manager, HR, Accounts and Super Admin dashboard experiences against live local records, route permissions and the implemented workflows.
  - Corrected employee leave and onboarding actions so they open the working self-service pages, and made the latest timesheet status and next approved leave accurate.
  - Corrected manager team scope and “On Leave Now” so future leave and former employees are not counted as current absences or direct-report headcount.
  - Gave IT users the Employee self-service dashboard instead of an empty dashboard area.
  - Corrected HR leave and timesheet monitoring actions so global counts open the organisation-wide pages HR is permitted to use, without implying HR is the final leave approver.
  - Aligned Leave Admin and Timesheet Monitoring navigation guards with the existing `leave:admin_all` and `timesheet:admin_all` permissions.
  - Defined current headcount consistently as employees who have started and remain employed, including onboarding, probation and notice statuses while excluding future joiners, inactive staff and archived staff.
  - Limited Accounts’ approved-overtime metric to the current open payroll period.
  - Excluded completed and cancelled onboarding cases and former employees’ document expiries from active operational counts.
  - Reworded permanent high-risk audit records so they are not presented as unresolved alerts, and clarified that document risk includes expired documents as well as documents due within 30 days.
  - Improved dashboard metric layouts for seven- and eight-card role views and removed the misleading page-render time labelled as a workspace update.
- Decisions:
  - Leave now follows the assigned Supervisor and then HR confirmation. Super Admin retains override access, but is no longer the normal final stage.
  - Audit events remain permanent history; the dashboard does not claim they have a resolution state that the data model does not support.
  - Google Workspace and production database connections remain deferred as requested; dashboard behaviour continues to use the local provider and browser repository layers.
- Verification:
  - Added focused tests for workforce scope, current leave ranges, payroll-period overtime and chronological upcoming leave.
  - Targeted Prettier and ESLint passed.
  - The repository-wide lint command still reports the existing formatting and legacy lint backlog outside this dashboard work (7,901 findings); the dashboard-focused lint set has no findings.
  - TypeScript typecheck passed.
  - 55/55 automated tests passed.
  - Production client, server and worker builds passed.

### Employee profile and digital employee file

- Status: Complete on 2026-08-24.
- Scope:
  - Audited the employee profile as one connected record across overview, employment, personal details, contacts, dependants, documents, leave, timesheets, attendance, travel, payroll, performance, training, equipment, onboarding and offboarding.
  - Enforced employee record scope before rendering a profile and recorded denied profile access in Audit History.
  - Separated personal-detail corrections, employment changes, pay changes and employment-status changes so each action follows the correct active-role permission and requires a meaningful reason where appropriate.
  - Employees can request changes only to their own personal details. HR and Super Admin can approve, refuse or directly correct those details, and the employee can see the outcome and reviewer explanation.
  - Profile update requests create in-app review notifications for active HR and Super Admin users. Approval or refusal creates an in-app notification for the employee with a direct link back to My Profile.
  - Pay is visible only to authorised payroll users. Salary history is no longer exposed inside general job history, and pay editing on the profile is restricted to Super Admin.
  - Employment-status changes can no longer bypass offboarding. Notice requires an active offboarding case, and a person can become inactive only after the case is completed.
  - Document upload, replacement, verification, refusal and download now enforce role and employee scope in the service as well as on screen. Uploaded files are validated, stored against the employee, and every file opening is audited.
  - Training certificates now store the real uploaded file, can be opened from the profile, and can be verified only by HR or Super Admin.
  - Equipment changes are restricted to HR and Super Admin and remain auditable.
  - Every profile summary action now opens the correct employee, manager, HR, Accounts or Super Admin destination. Employees and managers are no longer sent to HR-only onboarding or offboarding case pages.
  - Removed page reloads, browser prompts and technical product wording from the updated profile workflows. Dialogs retain current saved values and refresh the visible record after a successful change.
- Decisions:
  - Employee access is the default portal access. Additional responsibilities continue to be managed separately in User Management.
  - Accounts can work with pay through the payroll workflow; the employee profile does not give Accounts wider access to the employee directory.
  - Managers can see public documents for their direct reports, but restricted identity, medical and financial files remain limited to the employee, HR and Super Admin.
  - Google Workspace identity/provisioning and the production database remain deferred. The profile uses the existing development identity context, browser repositories and IndexedDB file store until those connections are added.
- Verification:
  - Targeted Prettier passed for the changed profile services, routes, tabs, progress record and tests.
  - Targeted ESLint passed without findings. Profile form controls, document metadata, route destinations and error handling no longer rely on explicit `any` casts.
  - Repository-wide lint remains blocked by the existing formatting and legacy lint backlog outside the completed profile scope: 7,603 findings (7,587 errors and 16 warnings).
  - TypeScript typecheck passed.
  - 60/60 automated tests passed, including profile ownership, personal-field restrictions, review and decision notifications, active-role decisions, pay/employment separation, offboarding gates, cross-employee training/equipment denial and protected document upload.
  - Production client, server and worker builds passed.

### My Tasks, notifications and lifecycle task security

- Status: Complete on 2026-08-24.
- Scope:
  - Rebuilt My Tasks as a single, role-aware inbox derived from real leave, timesheet, attendance, overtime, travel, payroll, employee record, document, training, performance, recruitment, interview, onboarding and offboarding records.
  - Added useful Open, Due Soon, Overdue and Blocked states, summary counts, search, area filters, responsive task cards, loading and error states, empty states, refresh behaviour and direct links to the correct working page.
  - Task visibility now follows the user's active role. Employees see only their own work, Line Managers see only direct-report work, and specialist tasks appear only for the named user or responsible role.
  - Candidate follow-ups respect the named HR owner. Super Admin receives profile reviews and payroll exceptions that the role is authorised to complete without inheriting unrelated HR or Accounts work.
  - Secured onboarding and offboarding task updates in the service layer. A user can complete only their own, explicitly assigned or active-role tasks; only HR and Super Admin can waive tasks, and every denied action is audited.
  - Employee onboarding tasks validate the saved profile, bank details or uploaded document instead of allowing a button click to pretend the work is complete.
  - Added real task evidence uploads through the shared browser file repository, including file validation, record ownership and orphan-file cleanup when an action fails.
  - Secured offboarding financial clearance to Accounts or Super Admin, legal and document clearance to HR or Super Admin, and final completion to Super Admin.
  - Restricted onboarding and offboarding case pages by employee, direct manager, explicit assignee and active role. Confidential notes and clearance controls are hidden and protected outside their permitted roles.
  - Protected notification read, unread and dismissal actions so users cannot change another person's notifications; denied attempts are recorded in Audit History and notification counts update immediately.
- Decisions:
  - My Tasks shows actionable work rather than copying notifications. Notifications remain the event and reminder feed, while tasks are derived from current workflow state and disappear when the underlying work is completed.
  - Blocked tasks remain visible with the dependency explanation so staff know why they cannot proceed.
  - Google Workspace email, Calendar, Meet and push delivery remain deferred. Current task links and notifications work fully inside the app using the development identity and local integration providers.
  - The production database remains deferred; structured task state uses the shared browser repositories and evidence uses IndexedDB.
- Verification:
  - Targeted Prettier and ESLint passed for every changed Task, notification, onboarding and offboarding file.
  - Repository-wide lint remains blocked by the existing formatting backlog outside this module: 7,373 errors, primarily line-ending findings. No Task-focused file has a lint finding.
  - TypeScript typecheck passed.
  - 65/65 automated tests passed, including active-role inbox scope, direct-report scope, blocked tasks, lifecycle task ownership, offboarding clearance permissions, notification ownership and denied-action auditing.
  - Production client, server and worker builds passed.

### Onboarding templates and employee journey

- Status: Complete on 2026-08-24.
- Scope:
  - Audited the full journey from accepted offer or direct hire through employee conversion, onboarding checklist creation, self-service information, document verification, payroll preparation, first-day readiness, manager check-ins and completion.
  - Accepted offers and direct hires with Onboarding status continue to create the employee, Employee portal access and onboarding case automatically. Duplicate active cases are refused.
  - Rebuilt the HR onboarding dashboard with progress, ready-to-start, attention and completed totals; active, at-risk, completed, cancelled and all-case views; employee search; clear status, overdue and blocked indicators; and a working Start Onboarding dialog.
  - Restricted the organisation onboarding dashboard and navigation to HR and Super Admin. Employee, manager, Accounts and IT access remains limited to their own assigned case work through My Onboarding and My Tasks.
  - Replaced the decorative checklist settings with working template creation, editing, copying and archiving. Templates support country, VIA entity, department, position and employment-type matching.
  - Checklist tasks now support group, checkpoint, active role, optional named owner, start-date offset, dependency, required flag, evidence requirement and instructions. Invalid owners, duplicate names, impossible offsets, broken dependencies and dependency loops are rejected.
  - Expanded the standard checklist across personal and legal documents, contract and payroll, visa and identity records, IT and equipment, building and system access, induction, department welcome, manager planning, probation goals, day 30, day 60 and day 90 reviews.
  - Assigned employee, HR and direct-manager tasks to named users when the case starts. Accounts, IT and Super Admin work remains available to users actively working in the responsible role. Missing line managers are shown as a case risk without breaking automatic candidate conversion.
  - Fixed employee onboarding document submission so the real IndexedDB file ID is linked to the task. Passport, visa, national ID and work-permit submissions require document number, issuing authority, issue date and expiry date in both the page and shared service.
  - Employee uploads become pending verification. HR checklist completion is blocked until the matching document is Valid, and Accounts confirmation is blocked until complete bank details exist. Bank information is shown only as a masked summary to Accounts and Super Admin.
  - Evidence files can be opened from the case only by someone who can access that case. File access and denied access are recorded in Audit History.
  - Task dependencies, blockers, required evidence, authorised waivers, completion percentage and start-date readiness are enforced in the onboarding service rather than only on the page.
  - Open task dates can be recalculated after an employee start-date change. Older cases recover missing offsets from their original template where possible.
  - When the employee start date is reached and all required pre-arrival work is complete, the local employee status moves automatically from Onboarding to Probation or Active and the change is audited.
  - Cancelling onboarding requires a reason, closes the case, makes the local employee record inactive, suspends VIA portal access and retains the complete history. Google Workspace account changes remain deferred.
  - Added onboarding assignment, readiness, completion, cancellation and employee-activation notifications with direct record links and deduplication.
  - Completed and cancelled employee onboarding pages are read-only and explain the appropriate next step. Employees can submit onboarding fields only for their own active case; denied attempts are audited.
- Decisions:
  - My Tasks remains the operational inbox for Employee, Line Manager, HR, Accounts, IT and Super Admin task owners; the onboarding dashboard is the HR and Super Admin oversight page.
  - Every employee created in an established organisation must have a supervisor. Accepted-offer conversion uses the vacancy hiring manager first and the HR employee completing conversion as a safe fallback; HR can correct that reporting line before work begins.
  - Uploading an employee document completes the employee submission task but does not pretend the document is verified. A separate HR task requires the real document status to be Valid.
  - The “Confirm Work Email Is Ready” task represents the local/manual readiness checkpoint. Real Workspace account creation, email delivery and directory identity remain prepared through the integration provider layer but are not connected yet.
  - Structured onboarding data continues to use the shared browser repository and files continue to use IndexedDB until the production database is connected.
- Verification:
  - Targeted Prettier and ESLint passed without findings for every changed onboarding, employee, navigation and test file.
  - Repository-wide lint remains blocked by the existing formatting backlog outside this module: 7,055 errors, primarily line-ending findings. No onboarding-focused file has a lint finding.
  - TypeScript typecheck passed.
  - 71/71 automated tests passed, including automatic accepted-offer conversion, template validation, duplicate-case prevention, Employee/Line Manager/HR/Accounts/IT/Super Admin task scope, bank and verified-document gates, start-date activation, cancellation, access suspension and denied-action auditing.
  - Production client, server and worker builds passed.

### Employee-first access, supervisor routing, leave and timesheet approvals

- Status: Complete on 2026-08-24 for the requested workflow correction. Steps 25 and 29 remain unchecked because their wider playbook scope still includes additional administration and correction features beyond this correction.
- Scope:
  - Removed employee-name searching and employee subject labels from the Employee view of My Tasks. Employee search now covers only that person's own tasks.
  - Removed Leave Approvals and Timesheet Approvals from Employee navigation and added direct route guards. Employees cannot browse another employee's approval work.
  - Kept Employee as the mandatory base access for every user. Assigning an employee as another person's supervisor now automatically adds Supervisor (`Line Manager` internally) access without removing Employee access.
  - Made Supervisor a required reporting-line field when creating employees in an established organisation, validated reporting lines in the shared employee service and surfaced Supervisor consistently in employee records and the directory.
  - Timesheets now follow Employee submission → assigned Supervisor review → HR final approval. Supervisor review no longer marks a timesheet approved.
  - Finance (`Accounts` internally) has read-only organisation timesheet visibility for payroll preparation and cannot approve or return a timesheet.
  - Leave now follows Employee submission → assigned Supervisor approval → HR confirmation. Existing browser records awaiting the former Super Admin stage are accepted by the HR queue for a safe transition.
  - After HR approves leave, the employee receives confirmation and active colleagues in the same office location receive a privacy-safe availability notice. The assigned handover colleague also receives a direct notification.
  - Supervisor, HR, employee and office notifications use real user IDs, direct record links and deduplication keys. Repository mutations and denied actions remain audited.
- Decisions:
  - `Line Manager` remains the internal role identifier to preserve stored data and permission compatibility; working screens use the clearer term `Supervisor`.
  - Super Admin retains control and can complete the HR final stage as an override. The normal operational owner remains HR.
  - Office-wide leave notices include only the employee name and absence dates; they do not expose the leave type or private reason.
  - Google Workspace authentication/notifications and the production database remain deferred. The complete workflow currently uses the development identity, browser repositories and in-app notifications.
- Verification:
  - Targeted Prettier and ESLint passed without findings for all changed workflow, permission, task, employee, leave, timesheet and test files.
  - Repository-wide lint still reports the existing unrelated formatting backlog: 7,038 findings (7,026 errors and 12 warnings), primarily line endings. No targeted file has a lint finding.
  - TypeScript typecheck passed.
  - 72/72 automated tests passed, including supervisor/HR stage enforcement, same-office leave notification, Finance read-only visibility and denied Finance approval.
  - Production client, server and worker builds passed.

### Recruitment completion and integrity pass

- Status: Complete on 2026-08-24 for the browser-local implementation. Google Workspace and the production database remain intentionally deferred.
- Scope:
  - Confirmed the candidate profile has dedicated Offers and complete Activity views, including offer actions and the auditable candidate timeline.
  - Confirmed the top-level recommended-candidate intake, duplicate review, candidate merge, HR ownership reassignment, candidate interview responses and panel scheduling conflict checks are working.
  - Restricted shortlist size to 1–10 candidates and moved override detection into the shared shortlist service. Excluding a top-ranked candidate, including a lower-ranked candidate or selecting an unscored candidate now requires a recorded reason regardless of the page used.
  - Made accepted-offer conversion transactional for browser storage. If employee, user, onboarding or Workspace-readiness preparation fails, all local conversion changes are restored and the rollback is audited.
  - Added advanced candidate filters for vacancy, stage, nationality, visa status, HR owner, recommender, follow-up status, last-contact period, experience and AI score.
  - Reconciled a returning applicant's latest consented profile details when the same email address or phone number applies again, while retaining one candidate identity and adding the new application.
  - Improved candidate merge handling so duplicate applications to the same vacancy are archived instead of leaving two active applications.
  - Moved candidate CSV generation into the shared candidate service. Export is audited, and the standard export deliberately excludes salary and compensation information.
  - Added contact owner visibility, required actual contact date/time, a 48-hour recent-contact warning for another HR owner and follow-up status based only on the latest contact.
  - Confirmed recruitment screens no longer rely on browser prompts, browser confirmations or full-page reloads for their working actions.
- Decisions:
  - A standard candidate export contains operational recruitment fields only. Compensation data requires a future separately permissioned report rather than being exposed from the candidate page.
  - Browser-local accepted-offer conversion uses a complete VIA storage snapshot as its transaction boundary until a production database supplies native transactions.
  - Existing integration-provider boundaries remain ready for Google Calendar, Meet, Workspace identity and email, but no external integration was connected in this pass.
- Verification:
  - Targeted Prettier and ESLint passed for every changed recruitment service, route and test file.
  - TypeScript typecheck passed.
  - 77/77 automated tests passed, including 10 recruitment workflow tests covering shortlist overrides, safe export, returning applicants, conversion rollback, interview responses and scheduling conflicts.
  - Production client, server and worker builds passed.
  - Repository-wide lint still reports the existing formatting backlog: 7,019 findings (7,006 errors and 13 warnings), primarily line-ending findings in files outside this recruitment pass. No targeted recruitment file has a lint finding.

### Audit History professional presentation

- Status: Complete on 2026-08-25 for the browser-local implementation.
- Scope:
  - Replaced the raw audit-event timeline with a compact, responsive activity table showing date and time, person, plain-language activity, area, record and result.
  - Added separate People, Automated and All activity views. Background reminders, scheduled work and system initialization are treated as automated activity even when a browser process originally recorded the current user as actor.
  - Added search plus area, activity, attention-level and date filters, with a clear empty state and 15-row pagination.
  - Added a responsive mobile activity list and a keyboard-accessible row interaction.
  - Added a details drawer with actor, active role, date, time, area, affected record, reason, clean field changes and audit references.
  - Removed `null`-to-value noise, record IDs, timestamps, version fields and serialized JSON from the working view. Collections and nested records are summarized rather than dumped onto the page.
  - Resolved employee, candidate, user and leave-policy references to readable names wherever saved records permit it.
  - Restricted salary, compensation, payroll, bank and identity values in change details unless the viewer also has payroll access.
  - Replaced the browser export confirmation with an accessible in-app security warning. Export remains audited and the generated object URL is now released after download.
- Decisions:
  - The append-only audit records were not altered, deleted or migrated; this pass changes only how authorised users search and understand them.
  - Human activity is the default global view so routine system setup and reminder records do not bury approvals and employee decisions. Automated activity remains fully available from its own tab.
  - Technical audit references remain available in a collapsed section for investigations without exposing internal implementation language in the main experience.
- Verification:
  - Targeted Prettier and ESLint passed for the Audit History route, viewer, presentation helpers and tests.
  - TypeScript typecheck passed.
  - 126/126 automated tests passed, including five focused audit-presentation tests for plain language, system separation, clean create events, financial redaction and leave-balance summaries.
  - Production client, server and worker builds passed.
  - Repository-wide lint remains blocked by 7,031 existing findings (7,017 errors and 14 warnings) outside this Audit History change, primarily the established line-ending and formatting backlog.

### Candidate Pool, CV intake and HR interview recommendation

- Status: Complete on 2026-08-25 for the browser-local implementation. Production Python/OCR, hosted AI and database storage remain intentionally deferred behind the new provider and repository boundaries.
- Scope:
  - Replaced the recruitment candidate list wording with Candidate Pool and kept one person profile across multiple CV versions, vacancy applications and recruitment activity.
  - Connected every careers-portal application to a versioned Candidate Pool CV record. The original uploaded file remains in IndexedDB and the structured candidate, application and CV links remain in the shared VIA repository.
  - Added a dedicated Incoming CVs flow for CVs received by direct email, WhatsApp, employee referral, agency, walk-in or HR upload. HR records the source, received date, consent, optional vacancy and source notes.
  - Added a resumable review inbox. A saved incoming CV remains visible after refresh until HR confirms the candidate information, including when automatic extraction needs manual review.
  - Added a replaceable CV-extraction provider. The local preview extracts only information it can find and never invents missing values; HR must confirm first name, surname, email, phone, location and other proposed profile information before it becomes candidate data.
  - Added duplicate review using email and phone. HR must link the CV to the existing candidate or explicitly confirm that it belongs to a different person.
  - Added Candidate Pool fields for skills, education, certifications, languages, availability, work eligibility, consent and named talent pools, plus a visible versioned CV history on the candidate profile.
  - Added a low-cost role-relevance pass before detailed candidate assessment. Profiles not relevant to the selected vacancy remain safely in the Candidate Pool and are not rejected, archived or deleted.
  - Improved local detailed assessment to compare confirmed skills, experience, title and application answers against the vacancy. This is the prepared boundary for the later Python pre-filter and hosted AI assessment services.
  - Added an HR interview-recommendation action on the candidate profile. HR selects the vacancy and CV, records the business reason, and the existing interview scheduler opens after VIA attaches the correct assessment.
  - Streamlined interview recommendation so HR no longer chooses technical assessment handling. VIA automatically reuses a current assessment only when it matches the same candidate, vacancy, CV file and vacancy version; otherwise it completes a new assessment before opening interview scheduling.
  - Added consent, vacancy, status, permission and file checks; transactional browser-storage rollback for portal CV registration and direct-CV finalisation; notifications to the hiring manager; and audit events for upload, extraction review, profile creation/update, recommendation, download and denied access.
  - Preserved the existing vacancies, candidates, contacts, recommendations, interviews, offers, onboarding and every non-recruitment module.
- Decisions:
  - A Candidate is the person, a CV record is a version of their document and an Application is that person's interest in one vacancy. One person can therefore have several CVs and several applications without duplicate identities.
  - A directly received CV can enter the general Candidate Pool without becoming a vacancy application. Creating an application requires confirmed candidate consent.
  - HR may recommend a Candidate Pool person directly for interview, but every recommendation requires a current role-and-CV assessment. Proceeding without an assessment is not presented as a routine option.
  - The browser implementation uses a local extraction provider because external services and the production database are out of scope until connection work begins. The provider interface can be replaced with Python/OCR and hosted AI without redesigning the screens or candidate records.
- Verification:
  - Targeted Prettier and ESLint passed for every Candidate Pool, extraction, scoring, interview recommendation, navigation and recruitment-test file changed in this pass.
  - TypeScript typecheck passed.
  - 133/133 automated tests passed, including portal CV registration, direct CV extraction and review, duplicate prevention, HR interview recommendation, Employee permission denial and the full existing recruitment/HR suite.
  - Production client, server and worker builds passed.
  - Repository-wide lint still reports the existing unrelated formatting backlog: 7,036 findings (7,022 errors and 14 warnings), primarily established line-ending and formatting findings outside this Candidate Pool change. No targeted file has a lint finding.

### Vacancy compulsory criteria and protected job-description generation

- Status: Complete on 2026-08-26 for the browser-local implementation. The same protection is ready to wrap the future hosted AI provider.
- Scope:
  - Added a prominent Compulsory Criteria field to New Vacancy. HR enters one non-negotiable requirement per line before generating or publishing the vacancy.
  - The description generator receives the compulsory criteria as structured role facts and includes every statement in the generated requirements.
  - Added provider-independent protection: if a current or future AI provider omits a compulsory criterion, the shared generation service restores it before returning the draft to HR.
  - Added a live completeness message in the Job Description Editor showing whether every compulsory criterion is still present after HR edits the generated description.
  - Publishing is blocked by the vacancy service if no compulsory criterion exists or if any approved criterion is missing from the final public requirements. This protection applies regardless of which page calls the service.
  - Corrected the New Vacancy publish action so it completes the required draft and publication status transitions instead of attempting an invalid direct Draft-to-Open change.
  - Added a separate Compulsory Criteria presentation on the internal vacancy record while preventing duplicate display under Other Requirements. Public listings continue to show the criteria naturally in the requirements list.
  - Added compulsory criteria to the deterministic VIA vacancy examples and preserved them when a vacancy is copied.
- Decisions:
  - Compulsory criteria are stored separately from the editable generated description so VIA can verify that HR-approved requirements have not disappeared or been weakened.
  - Drafts may still be saved while incomplete. Generation and publication require at least one compulsory criterion.
  - Compulsory statements are preserved using normalized exact matching. Case, punctuation and bullet formatting do not matter, but changing the meaning or turning a compulsory item into a preference will not satisfy the check.
- Verification:
  - Targeted Prettier and ESLint passed for all changed vacancy, description-generation, integration and recruitment-test files.
  - TypeScript typecheck passed.
  - 135/135 automated tests passed, including provider omission recovery and service-level publication blocking.
  - Production client, server and worker builds passed.
  - Repository-wide lint remains blocked by the existing unrelated backlog: 7,011 findings (6,997 errors and 14 warnings), primarily established formatting and line-ending findings outside this change.

### Staged Candidate Pool screening, selected-group assessment and interview outcomes

- Status: Complete on 2026-08-26 for the browser-local implementation. Production Python/OCR, hosted AI, a durable background worker and the production database remain intentionally deferred behind provider and repository boundaries.
- Scope:
  - Changed careers-portal submission to save the candidate, vacancy application and original CV first. Portal submission does not run detailed AI assessment and does not wait for CV preparation.
  - Added a persistent preparation queue with document routing for direct text, Word documents, searchable PDFs, scanned/OCR-required files and checksum-reused CVs. Processing problems never remove the application.
  - Added reusable prepared Candidate Pool profiles, preliminary compulsory-criteria checks, experience and skill matching, evidence, confidence, warnings, preliminary scores and clear match/review bands.
  - Restricted vacancy preparation to applications connected to that vacancy plus candidates HR explicitly adds from the Candidate Pool. Unrelated Candidate Pool profiles are not assessed or rejected.
  - Added an HR-controlled 1-10 person detailed-assessment group. Recommended and HR-added candidates are pinned and count within the selected total; the highest preliminary matches fill the remaining places.
  - Added an audited adjustment flow so HR can replace candidates or change the group before detailed assessment, with a required reason. Pinned candidates cannot be removed.
  - Removed the former direct candidate-scanning shortcut. Detailed assessment can now run only through a recorded assessment batch, only for its selected people, only after CV preparation and only against the unchanged vacancy version.
  - Made detailed assessment transactional in browser storage and enriched every result with compulsory-criteria evidence from the preparation run. The resulting draft shortlist retains its pinned candidates.
  - Reworked HR recommendation so it guarantees fair consideration, not a higher score or an interview bypass. The person is pinned into screening, receives the same objective assessment and becomes ready for scheduling only after that assessment completes.
  - Upgraded Add Recommended Candidate to require the original PDF/DOC/DOCX, select an open vacancy, record consent and complete recommender details, prepare proposed CV fields for HR review, detect duplicates, retain the exact file and add the confirmed person to vacancy screening.
  - Added a permanent post-interview recommendation record covering next interview, offer, future consideration, another role, hold, decline, withdrawal and no-show. The candidate and application status are updated while previous interview decisions remain visible.
  - Preserved every existing recruitment and staff module.
- Decisions:
  - OCR runs only for scanned or image-based documents; searchable files use their existing text. A checksum prevents repeat CV extraction, while vacancy relevance is recalculated when role requirements change.
  - A CV-only compulsory-criterion miss is marked for HR review and never used as an automatic rejection. Candidate-confirmed application answers remain authoritative.
  - The current browser provider is deliberately labelled as a local preview. The later Python parser, OCR service, local embedding/reranking service and hosted AI provider can replace the prepared boundaries without changing this workflow.
  - Recommended and manually included candidates receive honest scores. Their tag explains why they are guaranteed consideration but never changes ranking evidence.
- Verification:
  - Targeted Prettier and ESLint passed for all changed recruitment services, routes, interview components and recruitment tests.
  - Repository-wide lint remains blocked by 7,010 pre-existing findings (6,996 errors and 14 warnings), mainly the established line-ending and formatting backlog outside this change.
  - TypeScript typecheck passed.
  - All 135 automated tests passed, including save-before-assessment, Candidate Pool CV intake, pinned recommendation, selected-group detailed assessment, shortlist enforcement, duplicate protection and permanent interview disposition.
  - Production client, server and Cloudflare worker builds passed.

### Direct CV recommendation handoff

- Status: Complete on 2026-08-26 for the browser-local implementation.
- Scope:
  - Added a clear “Was this candidate recommended to VIA?” choice to Add a CV to the Candidate Pool.
  - Recommended CVs must be connected to an open vacancy and are visibly marked while HR reviews the candidate information.
  - Added the recommender form directly to Add a CV to the Candidate Pool. It appears immediately when HR chooses “Yes, recommended,” so HR does not leave the intake page, upload the file twice or retype the candidate details.
  - Reordered the page into a single vertical sequence: CV and vacancy details, inline recommender details, Upload CV and prepare candidate details, candidate review, then the final save. The preparation action no longer appears beside or ahead of information HR must complete first.
  - The inline form records the person's name, type, company, position, relationship, notes and either an email or phone number. One save action links the recommender to the CV, Candidate Pool profile, vacancy application and screening record.
  - Removed the consent question from the HR-managed CV and recommendation screens. A CV received directly from the candidate is treated as authorised for this internal recruitment flow.
  - Corrected Word-file intake when a browser supplies no MIME type, and corrected same-day received-date handling that could incorrectly reject a CV as future-dated.
  - Kept duplicate-candidate review and the original-file record intact throughout the handoff.
- Decisions:
  - Selecting a vacancy alone does not identify a recommender. HR must choose “Yes, recommended” and complete the recommender section on the same CV intake page before VIA treats the person as recommended.
  - A recommendation guarantees inclusion in the selected assessment group but never changes the candidate's objective score.
  - Email is no longer compulsory when HR has a valid recommender phone number; at least one reliable contact method is required.
- Verification:
  - Targeted Prettier and ESLint passed for the changed Candidate Pool, recommendation, candidate profile and service files.
  - TypeScript typecheck passed.
  - All 136 automated tests passed, including a direct-CV-to-recommendation test that reuses the same Word CV, supports an empty browser MIME type and records a phone-only recommender.
  - Production client, server and Cloudflare worker builds passed.
  - Repository-wide lint remains blocked by 7,010 pre-existing findings (6,996 errors and 14 warnings), primarily the established line-ending and formatting backlog outside this change. No targeted changed file has a lint finding.

### Recruitment completion hardening and browser journey verification

- Status: Complete on 2026-08-26 for the browser-local implementation. Production database, durable server worker, Workspace authentication, Google services, Python/OCR and hosted AI remain intentionally deferred.
- Scope:
  - Public CV upload now accepts PDF, DOC and DOCX files when the browser supplies an empty MIME type by safely resolving the supported type from the file extension.
  - Failed or duplicate applications remove their unattached IndexedDB upload. Successful applications reassign the file from its temporary owner to the permanent Candidate Pool CV record, with an audit event.
  - CV preparation stores extracted information as a proposal and no longer changes confirmed Candidate Pool skills, education, certifications, languages, company or title before HR approves the extraction review.
  - The preparation queue is written before the applicant receives confirmation. Queued or interrupted records persist in versioned browser storage and resume when VIA HR System opens after a refresh or closed tab.
  - Candidate, interview, disposition, hiring-decision and offer read methods now require actor context and enforce HR/Super Admin or assigned-panel scope at the service layer. Denials are audited.
  - Route loaders resolve the validated development-preview actor and accept only a role actually assigned to that saved user. This boundary is ready to be replaced by the verified Workspace session.
  - Public vacancy links no longer depend on server-side access to browser storage. Opening or sharing `/jobs/{vacancy}` directly now loads the role in the browser and shows a professional unavailable state for a closed or missing vacancy.
  - Corrected the shortlist finalisation dialog crash caused by form labels being rendered outside a form provider.
  - Candidate interview lists now refresh immediately after scheduling instead of remaining at zero until a page reload.
  - Added Playwright and a browser journey covering public DOCX application, IndexedDB ownership, pending CV review, selected-group assessment, shortlist finalisation, interview scheduling, submitted scorecard, hiring decision, accepted offer and resulting onboarding record.
- Verification:
  - Empty-MIME CV, permanent file ownership, HR-confirmed enrichment, interrupted-queue resume and recruitment read-denial tests pass in the recruitment suite.
  - TypeScript typecheck passed.
  - All 138 service/unit tests passed.
  - The Playwright recruitment lifecycle passed in installed Google Chrome.
  - Production client, server and Cloudflare worker builds passed.
  - Repository-wide lint still reports the existing formatting backlog: 6,642 findings (6,628 errors and 14 warnings). The dominant findings are established CRLF/Prettier issues and unrelated existing files; this implementation did not bulk-reformat user-owned modules.

### Core HR completion hardening and browser journey verification

- Status: Complete on 2026-08-27 for the browser-local implementation. Production database storage, Workspace authentication and server-side scheduling remain intentionally deferred.
- Scope:
  - Closed raw-read paths for employees, users, employment history, personal-profile requests and employee documents. Page code now uses role- and relationship-scoped service methods; trusted raw repositories require the system context.
  - Added a deliberately limited company-directory lookup for operational screens that need employee names. It excludes compensation, banking, identity documents, personal contact details, family information, HR notes and statutory identifiers.
  - Made onboarding and offboarding case reads context-required. Employees, supervisors and shared-service roles see only cases or tasks that belong to them; rejected reads create access-denied audit records.
  - Kept restricted offboarding notes out of page state. Standard notes are available to HR and Super Admin, while Restricted notes are available only to Super Admin.
  - Kept departing employees' access active during Notice so they can finish handover work. Access is suspended only when employment becomes Inactive and archived when the employee record is archived.
  - Added offboarding-template selection, a named HR case owner and Standard/Restricted confidentiality when HR starts a case.
  - Validated onboarding and offboarding templates, protected the last active template and required named task owners to be active users holding the task's role.
  - Prevented departing employees from approving their own financial or HR clearance and prevented them from finalising their own departure, even when they hold an elevated role.
  - Prevented offboarding finalisation before the recorded last working date and retained the mandatory-task, financial-clearance and HR-closure gates.
  - Changed document-expiry reminders to use VIA's editable reminder-day settings and changed work-anniversary reminders to recover recently missed notification dates safely through deduplication.
  - Verified generic onboarding evidence belongs to the correct onboarding case before completion.
  - Made employee-document replacement recover as one logical operation: failed metadata/version updates restore browser records and remove the newly orphaned file blob.
  - Added a Playwright browser journey through Directory, Employee Files, Onboarding and Offboarding, including template selection and Restricted case handling.
- Decisions:
  - Active-role permissions are authoritative. Merely having HR or Super Admin among a user's assigned roles does not expose elevated data while that person is acting as Employee.
  - Company-directory access is separate from full employee-file access. Shared workflows can resolve names and work assignments without receiving the employee's private HR file.
  - Client-side reminder recovery is complete for the current browser version. A production database and server scheduler will later run reminders even when no one has the portal open.
- Verification:
  - Targeted Prettier completed for every changed TypeScript file.
  - TypeScript typecheck passed.
  - All 185 service and unit tests passed, including new raw-repository denial, active-role isolation and sanitised-directory coverage.
  - The Playwright Core HR journey passed in installed Google Chrome.
  - Production build passed.
  - Repository-wide lint remains blocked by the established backlog: 8,194 findings (8,172 errors and 22 warnings), predominantly existing Prettier, explicit-`any` and hook-rule findings across older screens and tests. The targeted changed-file run reports 70 existing `any`/hook-rule errors and 11 warnings, concentrated in older payroll, travel, performance and employee-form code rather than the completed Core HR workflow logic.

### Time & Travel audit remediation and lifecycle verification

- Status: Complete on 2026-08-28 for every actionable finding in `Time-and-Travel-Audit.pdf` within the browser-local application. Workspace authentication, production database storage and server-side scheduling remain intentionally deferred.
- Scope:
  - Enforced leave negative-balance caps, gave HR direct access to editable leave policies, added reason-controlled HR recovery for unavailable supervisors, and added employee-specific allowances for statutory per-event and once-per-service leave.
  - Removed the unused Leave placeholder, corrected request filters and status presentation, prevented cancellation of past approved leave, and kept historical approved requests readable as taken leave.
  - Corrected structured public-holiday prefilling, preserved current work when copying a previous timesheet, blocked closing periods with unfinished records, added reason-controlled period reopening, and repaired payroll-locked correction creation so it cannot duplicate a person and period or carry old dated hours forward.
  - Made current-period selection date-aware across approvals and monitoring, exposed manual payroll locking even after a settings change, added employee notifications for returned and reopened timesheets, and added audited HR recovery when the assigned supervisor is unavailable.
  - Changed stale open attendance punches to Missing Punch in every summary, allowed a new day's attendance while retaining the older missed-sign-out correction, added HR supervisor-stage recovery, and added validated HR editing with duplicate employee/date protection.
  - Moved HR overtime verification into Overtime Approvals, added the setting that controls that stage, made cost centre, activity and work location mandatory, completed HR/Super Admin/line-manager on-behalf recording, protected evidence ownership and access, and removed the unused Draft state.
  - Made overtime corrections and their original record update one recoverable operation, reversed a previous time-off credit before a corrected TOIL claim is reconsidered, notified every reviewer and employee stage, and carried late-approved overtime into the next payroll collection with a visible exception instead of losing it.
  - Restricted travel reads to the employee, their actual supervisor or authorised reviewers; corrected sidebar permissions; removed the unused direct-report approval permission; required and ownership-checked every receipt; and kept rejected requests out of the other reviewer's active queue.
  - Preserved the two independent travel approvals before Pre-authorised status, cleaned rejected reimbursement totals, kept explicit approval/rejection audit events and notifications, and made zero-estimate variance finite and understandable.
  - Updated deterministic VIA seed employee profiles with the gender data required to demonstrate gender-specific statutory leave eligibility.
- Decisions:
  - HR recovery never silently impersonates a supervisor. A meaningful explanation is required and the recovery decision is audited.
  - Recommended workflow rules are enforced in shared services, not only by hidden buttons or route guards.
  - Receipts and overtime evidence remain in IndexedDB and structured records retain only verified file references until the production file store is connected.
  - Browser-local automation is complete for the present build; reminders and automatic jobs can only become independent of an open browser after the deferred server scheduler is connected.
- Verification:
  - Targeted Prettier and ESLint passed for every Time & Travel source file and regression test changed in this remediation.
  - TypeScript typecheck passed.
  - All 203 service and unit tests passed, including new negative-cap, statutory-allowance, recovery, holiday, copying, attendance, TOIL, payroll carry-over, travel-privacy, receipt and variance coverage.
  - The Playwright Time & Travel lifecycle passed through Employee, Line Manager, HR, Accounts and Super Admin roles, including leave, attendance correction, timesheet, overtime, travel pre-authorisation, receipt-backed expenses and final reimbursement closure.
  - Production client, server and worker builds passed.
  - Repository-wide lint still reports 327 existing findings (308 errors and 19 warnings) in unrelated older performance screens, tests and configuration files. The targeted Time & Travel lint run is clean.

### Finance overtime ledger completion

- Status: Complete on 2026-08-28 for the browser-local Finance overtime ledger. Production database storage and Workspace authentication remain intentionally deferred.
- Scope:
  - Restricted the Finance Overtime Ledger navigation, route and service selector to Accounts and Super Admin. HR continues verification from Overtime Approvals and cannot retrieve the Finance ledger directly.
  - Prevented time off in lieu from entering payable payroll hours. Payroll assignment also rejects a TOIL claim supplied by any future caller before writing any claim in the batch.
  - Added permanent approval date and approver details to newly approved overtime claims.
  - Replaced the basic approved-claims table with a responsive Finance register showing payment versus time off, employee number, real project and allocation names, approved hours, warnings, supporting evidence and the payroll period already containing each claim.
  - Added Ready, Included, Time Off and Needs Attention views; employee/allocation search; date and payroll-period filters; summary totals; details; pagination; loading, empty and error feedback; and a service-generated CSV export.
  - Ledger views, access denials, evidence access and exports are permission-controlled and audited. CSV cells are protected against spreadsheet-formula execution.
  - Made payroll-period compilation and overtime assignment one recoverable browser-storage operation. If either collection write fails, both collections return to their prior state and the rollback is audited.
  - Added legacy protection: a historical TOIL claim already linked to payroll is clearly marked Review Needed instead of being presented as payable or silently changed.
- Decisions:
  - Accounts sees approved TOIL only as a non-payable reconciliation record. It never contributes to approved overtime hours in payroll preparation.
  - A processed payment claim remains available under Included with its payroll period and status; it no longer remains falsely labelled Ready for Payroll.
  - Overtime rates and salary amounts remain outside this register because VIA currently prepares approved hours rather than calculating statutory payroll or bank payments.
- Verification:
  - Targeted Prettier and ESLint passed for every changed source and test file.
  - TypeScript typecheck passed.
  - All 208 service and unit tests passed, including new Finance-role, TOIL exclusion, mixed-batch, audited export and cross-collection rollback coverage.
  - All three Playwright journeys passed. The Time & Travel journey now proves Accounts can review the ledger and HR receives Access Denied on the direct URL.
  - Production client, server and Cloudflare worker builds passed.
  - Repository-wide lint remains blocked by the established unrelated backlog: 327 findings (308 errors and 19 warnings), primarily older performance screens, formatting debt, tests and configuration files.

### Final Time, Travel and payroll hardening

- Status: Complete on 2026-08-29 for all actionable browser-local gaps identified after the Time & Travel and Finance reviews. Workspace authentication, production database storage and an always-on server scheduler remain intentionally deferred.
- Scope:
  - Protected every payroll-period read and mutation inside `PayrollService`, including list/detail access, period creation, manual adjustments, input collection, exception resolution, locking and export. Every view, export and denied attempt is audited.
  - Validated payroll dates, employee status, adjustment amounts, reasons and salary currency. Manual adjustments can no longer smuggle a conflicting period ID or a currency different from the employee's salary currency.
  - Separated salary/manual-adjustment currency from reimbursement currency throughout payroll preparation, reports, workbench screens and CSV export. Verified travel reimbursements enter payroll only as OMR equivalents and unverified legacy totals are excluded with a visible exception.
  - Made closed travel reimbursements automatically enter the first eligible payroll period after closure. Payroll collection atomically links overtime and travel sources to the period and restores all collections if any write fails.
  - Added permanent travel approval, pre-authorisation and closure metadata, including each approver, decision time and a locked budget snapshot. Travel and expense dates, active currencies, categories, unique lines and estimate amounts are validated in the service.
  - Added timesheet due-soon, due-today and overdue reminders for employees, plus overdue notifications for their assigned supervisors. Reminder recovery is idempotent and does not create timesheets merely by checking deadlines.
  - Added employee-requested changes to future approved leave. The existing approved dates and balance remain in force until the assigned supervisor and HR approve the proposal; rejection preserves the original leave. Final approval rechecks the live calendar, overlap rules and balance before applying one audited ledger adjustment.
  - Moved protected screen data loading behind permission guards, replaced the remaining payroll browser alert with normal application feedback, and removed duplicate sidebar-key collisions.
- Decisions:
  - Recommended, manually selected and ordinary workflow records continue to use the same shared permission and audit services; hiding a button is never treated as security.
  - Reimbursements and salary inputs are never totalled or labelled as if they share a currency. A reimbursement without a verified OMR equivalent cannot enter payroll.
  - Browser reminder recovery is the complete implementation possible before the deferred production scheduler exists. It catches missed deadlines when the portal next opens, but cannot execute while every browser is closed.
- Verification:
  - Targeted Prettier and ESLint passed for all changed Time & Travel, payroll, dashboard, route and test files.
  - TypeScript typecheck passed.
  - All 216 service and unit tests passed, including leave-amendment race protection, timesheet reminder recovery, travel approval snapshots and currency rules, automatic payroll carry-over, payroll permission denials and atomic collection rollback.
  - All three Playwright browser journeys passed. The Time & Travel journey covers Employee, Line Manager, HR, Accounts and Super Admin through leave, attendance, timesheet, overtime, travel and reimbursement.
  - Production client, server and Cloudflare worker builds passed.
  - Repository-wide lint still reports 273 pre-existing errors outside this remediation, principally old performance and interview screens plus existing formatting debt. The targeted changed-file lint run is clean.

### Talent performance, learning and certification completion

- Status: Complete on 2026-08-29 for the browser-local My Performance, Team Performance, Performance Cycles, My Learning and Learning & Development workflows. Workspace authentication and production database storage remain intentionally deferred.
- Scope:
  - Rebuilt My Performance around Objectives, Reviews, Check-ins and Development Plan tabs.
  - Added measurable objectives with descriptions, success measures, targets, dates and weights. A complete set must total exactly 100% before submission.
  - Enforced employee-only objective creation, actual assigned-supervisor approval, reason-controlled returns, corrected-objective resubmission, progress check-ins, optional evidence and supervisor-confirmed completion inside shared services.
  - Corrected the lifecycle so self-assessment remains locked until every objective in the 100% set is approved.
  - Rebuilt Team Performance with direct-report objective approvals, completion confirmations, progress visibility and assigned employee reviews. HR and Super Admin now receive a safe organisation-wide monitoring view instead of a page error, while employee decisions remain restricted to the assigned supervisor.
  - Added permission-controlled, audited viewing for objective evidence by the employee, assigned supervisor and HR/Super Admin.
  - Completed the review sequence: self-assessment, supervisor assessment and development plan, optional HR moderation, recorded review discussion, employee agreement or disagreement acknowledgement, HR finalisation and locked-record correction history.
  - Added HR cycle population controls, exact employee preview, missing-supervisor warnings, draft save/edit/launch, ordered deadlines, template creation, completion controls and a visible moderation/finalisation queue. Cycle launch and review creation now roll back together if any part fails.
  - Replaced mock certification uploads with real IndexedDB file storage, secure audited viewing, HR verification or return-for-correction, expiry details and scoped Training Records access.
  - Completed the training catalogue with provider, category, delivery method, duration, cost/currency, certificate validity, renewal period, required roles/locations/projects and active/mandatory controls.
  - Added employee course requests, free-course automatic approval, assigned-supervisor decisions, HR approval for paid training, HR/supervisor assignment, withdrawal, notifications and My Tasks entries.
  - Prevented HR and Super Admin from approving, verifying, rejecting, attending, cancelling or completing their own training records; another authorised person must perform those decisions.
  - Added sessions, capacity controls, enrolment scheduling, future-session safeguards, attendance/no-show recording, cancellation, results, actual cost, completion history and automatic certificate expiry calculation.
  - Added employee My Learning tabs for the personal training plan, course catalogue, request history and certifications; added role-aware Team Training and Learning & Development workspaces for supervisors and HR/Super Admin.
  - Added deterministic training sample data and a schema-version migration that adds the catalogue and empty workflow collections to existing browser installations without replacing current records. The migration also grants Line Manager access to existing users who are already assigned as supervisors.
  - Added dedicated training self/direct-report/all-record permissions and service-level employee, assigned-supervisor and HR scope enforcement.
  - Mounted the existing application notification component so success and error feedback is now visible instead of being silently discarded.
  - Added role-aware performance tasks and notifications for objective setting, supervisor approval, self-assessment, supervisor review, moderation, discussion, acknowledgement and final locking.
- Decisions:
  - Active role is authoritative. Users complete their own objectives and acknowledgement while acting as Employee, supervisor stages while acting as Line Manager, and moderation/finalisation while acting as HR or Super Admin.
  - Training completion can create an employee training record without a certificate. A certificate becomes HR-verified only after the supporting file is uploaded and checked.
- Verification:
  - Targeted Prettier and ESLint passed for every Talent source and test file changed in this work.
  - TypeScript typecheck passed.
  - All 221 service and unit tests passed, including storage migration, objective ownership, 100% weighting, assigned-supervisor enforcement, secure objective evidence, full review lifecycle, training request approvals, scheduling, attendance, completion, file scope, verification and audit coverage.
  - Both Talent Playwright browser journeys passed. They cover Employee, Line Manager and HR from approved objectives through a locked review and verified certificate, and prove Team Performance/Training Records open correctly for Line Manager, HR and Super Admin.
  - Production client, server and Cloudflare worker builds passed.
  - Repository-wide lint still reports 167 established findings (150 errors and 17 warnings) in unrelated older recruitment, employee-form, configuration and test files. The targeted Talent lint run is clean.

### System administration, policies, audit and reports completion

- Status: Complete on 2026-08-30 for the browser-local Reports, User Management, Audit History, Leave Policies, Organisation Settings and Timesheet Settings workflows. Google Workspace authentication and production database storage remain intentionally deferred.
- Scope:
  - Restricted global Audit History to Super Admin, added actor, active-role, action, record-type, attention-level and custom-date filters, integrity warnings, protected CSV export and plain-language activity details.
  - Prevented users from changing their own access, preserved Employee access for everyone, protected Super Admin accounts, blocked deactivating supervisors with direct reports, validated employee status before activation, notified affected users and made archive/restore consistent.
  - Protected application settings, master data, backup export, restore and sample reset inside shared services. Added validation, duplicate checks, active-record dependency protection and in-app confirmation dialogs.
  - Added editable working days, expiry-reminder dates, organisation hours, leave year, currency, numbering, departments, locations, projects, cost centres, activity codes, positions, grades and public holidays.
  - Expanded leave-policy editing to cover allowance, carry-over, paid status, balance method, negative-balance cap, evidence, handover, eligibility, notice rules and sick-pay tiers. Policy and entitlement updates now roll back together if any part fails.
  - Completed timesheet setting validation, all seven week-start choices, period generation/lifecycle controls and project, cost-centre, activity and location master-data controls.
  - Expanded Reports Centre with recruitment source, recommender, contact, leave usage, project hours, attendance, overtime and offboarding reports; role-scoped finance access; reusable saved views; structured filters; summary cards; configured currency; printing; formula-safe CSV and audited exports.
  - Added permission-controlled travel-request activity history and remounted the application after a successful backup restore or sample reset without relying on a full-page reload.
- Verification:
  - Targeted Prettier and ESLint passed for every System source and regression test changed in this work.
  - TypeScript typecheck passed.
  - All 226 service and unit tests passed, including five new System administration tests covering settings, backups, master data, self-escalation, archive/restore, report boundaries, saved views, audit scope and policy validation.
  - Production client, server and Cloudflare worker builds passed.
  - Repository-wide lint remains blocked by 169 established findings outside this System work, mostly older recruitment/employee forms and formatting debt. The targeted System lint run is clean.

### Step H3.1 - PostgreSQL and Drizzle foundation

- Status: In progress on 2026-08-30. The complete local/repository foundation is verified; the managed staging database remains pending an approved hosting provider and data-residency region, so Step H3.1 is not marked complete.
- Scope:
  - Added Drizzle ORM, Drizzle Kit and the Cloudflare-compatible Postgres.js driver without changing any feature service to use PostgreSQL prematurely.
  - Added a server-only, lazy database client that reads `DATABASE_URL` and pool configuration only at call time, validates configuration, reuses one runtime connection and exposes a controlled health check and shutdown path.
  - Added version-controlled Drizzle configuration and an intentionally empty schema entry point. Business tables begin in H3.2 after the plumbing is independently proven.
  - Added a PostgreSQL 17 Docker Compose service with an isolated named volume, environment-only credentials and a health check. The example uses host port 55432 to avoid the existing PostgreSQL service on port 5432.
  - Added local setup, schema workflow and staging guidance. Real environment files are ignored while the safe example remains version controlled.
  - Recorded the dropdown decision: departments, locations, positions, grades, employment types, cost centres, projects, currencies, activity codes, working times and public holidays will be stored in PostgreSQL and managed through VIA HR System in H3.2. Protected workflow states remain server-controlled.
  - Added database configuration tests and a live connectivity smoke command.
  - Corrected three existing type-gate defects encountered during verification by using the trusted system context for document reminders and making Candidate Kanban stage changes type-safe.
- Verification:
  - `npm run db:generate` passed against the intentionally empty schema (`0 tables`, no pending migration).
  - Local PostgreSQL 17 container became healthy and `npm run db:smoke` passed with a real `SELECT 1` (46 ms).
  - Database foundation tests passed 4/4 against the local PostgreSQL instance.
  - Full unit/service suite passed: 229 passed, 0 failed, and the optional live-database case skipped in the environment-free run; the same case passed separately against local PostgreSQL.
  - TypeScript typecheck passed.
  - Database foundation formatting and targeted lint passed.
  - Production client, server and Cloudflare worker build passed.
  - Runtime smoke checks returned HTTP 200 for `/`, `/staff` and `/staff/settings` with PostgreSQL configured in the server environment. The development app is running at `http://localhost:8082`.
  - Repository-wide lint still reports 156 established findings in older recruitment, employee-form and formatting files. No unrelated file was mass-formatted or weakened to hide that debt.
- Decisions:
  - Existing browser-backed records remain the active source until each module is migrated and verified. There is no silent fallback after a migrated service fails.
  - Database secrets are never `VITE_` variables and are never committed.
  - A managed staging database will not be provisioned until VIA confirms the hosting provider and required data-residency region.

### Step H3.1B - Contabo Node runtime

- Status: Complete on 2026-08-30 for the repository and locally verified Linux deployment package. Deployment to the actual Contabo server remains an environment operation after its region, capacity, domain and reverse proxy are confirmed.
- Scope:
  - Replaced the Cloudflare production preset with Nitro's Node server preset and added the production `npm start` entry point.
  - Added a multi-stage Node 24 Alpine image that builds on Linux, runs as the unprivileged `node` user and contains only the generated Nitro output at runtime.
  - Added an isolated production Compose stack with a loopback-only application port, a public-facing frontend network for the host proxy, an internal application/database network and no published PostgreSQL port.
  - Added dedicated VIA database credentials, database volume, container health checks, restart policies, graceful stop periods, read-only application filesystem, temporary filesystem, no-new-privileges controls and log rotation.
  - Added safe `/health/live` and `/health/ready` endpoints before application routing. Readiness checks PostgreSQL but never returns connection details or raw errors; unsupported methods return 405.
  - Added graceful PostgreSQL connection shutdown for Node termination and interrupt signals.
  - Added a production environment template, Docker ignore rules, an Nginx reference configuration and a complete Contabo deployment, isolation, TLS, firewall, backup, update and rollback guide.
  - Preserved every feature page and the current browser-backed data path. No HR module was switched to PostgreSQL in this runtime step.
- Verification:
  - Production Compose configuration validation passed.
  - Five Contabo runtime/health tests passed, covering liveness independence, database readiness, safe failure output, method restrictions and application routing passthrough.
  - TypeScript typecheck passed.
  - Full unit/service suite passed: 234 passed, 0 failed and one optional live-database test skipped in the environment-free run.
  - Targeted ESLint and Prettier passed for every runtime source, configuration and test file they support.
  - Nitro production build passed with the `node-server` preset.
  - The Linux `via-hr-system:contabo-test` Docker image built successfully with a clean `npm ci` and Linux-native production build.
  - The exact production Compose stack started with healthy app and PostgreSQL containers. PostgreSQL showed no host binding; the app bound only to `127.0.0.1:8084` for the test.
  - Container smoke checks returned HTTP 200 for liveness, readiness, the public careers page and `/staff/settings`. The temporary test containers and networks were stopped and removed after verification; the test database volume was retained.
  - The regular development app remains available at `http://localhost:8082` and returned HTTP 200 after the production-stack test.
  - Repository-wide lint still reports 155 established findings in older recruitment, employee-form and formatting files. The Contabo runtime files are clean.
- Decisions:
  - Contabo is the production runtime target; Cloudflare-specific output is no longer built.
  - The host reverse proxy terminates TLS and forwards to a loopback-only VIA port. VIA does not claim ports used by other applications.
  - The PostgreSQL service is private and dedicated to VIA. Other applications may share the host but not VIA's database, role, password or volume.
  - Real HR data must not be loaded until the server's data-residency region is approved, off-server encrypted backups are operating, Google Workspace authentication is connected and the applicable module has completed database cutover.

### Step H3.2 - Master data, access and employee schema

- Status: Complete on 2026-08-30 for the schema-and-migration scope. Existing feature screens deliberately remain on the versioned browser repository until the later controlled service-cutover step.
- Scope:
  - Added 21 organisation-aware PostgreSQL tables for organisation settings, departments, office locations/geofences, cost centres, positions, grades, employment types, working times, public holidays, currencies, activity codes, projects, employees, reporting-line history, users, roles, role assignments and separated sensitive employee data.
  - Replaced free-text production employee relationships with UUID foreign keys for department, position, grade, location, employment type, working time, cost centre, project and line manager. Added list/report indexes and case-insensitive organisation-level duplicate protection.
  - Added employee nationality, date of birth, gender, marital status, termination date/reason, working hours and the other production employee fields identified in the readiness audit.
  - Added a current line-manager relationship plus dated reporting-line history. Database checks prevent self-management, multiple simultaneous primary supervisors and management cycles.
  - Added protected system roles and database-enforced base Employee access for every user. Employee access cannot be removed; additional HR, Line Manager, Accounts, IT or Super Admin access remains assignable.
  - Added same-organisation checks for employee, user, reporting-line, role-assignment and sensitive-data relationships to prevent cross-organisation references.
  - Added application-layer AES-256-GCM encryption with authenticated, versioned key envelopes for passport, national ID, social-insurance, salary and bank data. Keys remain in server environment variables and support rotation by key ID.
  - Added a generated forward migration, a separate manual rollback migration, schema guidance and Contabo/local encryption configuration examples. No actual secret was committed.
- Verification:
  - Drizzle generated the 21-table schema and a subsequent drift check reported no schema changes.
  - Applied the migration to a uniquely named fresh PostgreSQL 17 scratch database, completed a real manager/employee/user insert, confirmed the automatic Employee role, verified a management cycle was rejected and proved raw SQL contained ciphertext rather than salary values.
  - Decrypted the stored data only through the application's server-side decrypt path.
  - Ran the manual rollback and confirmed zero public business tables remained, then recreated the scratch database and cleanly re-applied all 21 tables. The scratch database was removed after verification.
  - Four H3.2 schema/encryption tests were added. Three pass in the environment-free suite; the live database case is intentionally skipped there and passed separately against PostgreSQL.
  - Full unit/service suite passed: 237 passed, 0 failed and 2 optional live-database tests skipped.
  - All five Playwright journeys passed, covering Recruitment, Core HR, Time & Travel and both Talent journeys. The Core HR cold-start assertion now allows the application boot process up to 20 seconds instead of failing after five seconds while the development server compiles its first staff route.
  - Targeted Prettier and ESLint passed for every H3.2 TypeScript, test, Markdown, JSON and Compose file they support.
  - TypeScript typecheck passed, the Nitro Node production build passed and the production Compose configuration validated with the new encryption variables.
  - Repository-wide lint still reports the same 155 established findings (140 errors and 15 warnings) in older recruitment, employee-form and formatting files. No unrelated user file was changed to conceal that debt.
- Decisions:
  - Business dropdown values are organisation-owned PostgreSQL records managed by VIA HR System. Protected workflow states and system roles are not user-editable dropdown data.
  - Organisation name is stored on the organisation record; organisation policy settings remain one-to-one through `app_settings`.
  - Database actor metadata uses UUID values without a foreign key so the trusted bootstrap/system actor can create the first access mapping and historical actor IDs remain stable.
  - The current UI has not been switched to PostgreSQL in this step. Master-data/settings service cutover comes next; claiming otherwise would risk mixing browser and database sources.

### Step H3.3 - Remaining module schemas and append-only audit controls

- Status: Complete on 2026-08-30 for the schema-and-migration scope. Feature services remain on the versioned browser repository until the incremental H3.5 cutover; Google Workspace authentication remains deferred to H4.
- Scope:
  - Added organisation-scoped Drizzle schemas for employee files/history/imports, recruitment, leave, timesheets, attendance, site visits, overtime, travel, reimbursements, payroll, onboarding, offboarding, performance, training, notifications, workflow tasks and audit history.
  - Added all 48 structured collections listed in `PRODUCT_IMPLEMENTATION_PLAN.md` Section 20.1, including Workspace identity mappings and revocable portal-session primitives without connecting Google authentication.
  - Promoted timesheet entries, travel expense items, onboarding/offboarding tasks, payroll exceptions and payroll manual adjustments into independently queryable child tables.
  - Replaced plaintext recruitment salary fields with authenticated encryption envelopes and added live round-trip verification proving raw PostgreSQL values do not contain the salary amounts.
  - Added missing recruitment relationships, organisation-scoped application references, vacancy versions, interview panel membership, shortlist limits, score/date checks and full recommendation, contact, disposition, decision and offer persistence.
  - Added database-generated same-organisation guards to every single-column foreign key between tenant-owned tables, so a valid record ID from another organisation is still rejected.
  - Added immutable audit records with IP address and user-agent context. Database triggers reject UPDATE/DELETE for all ordinary DML, and the `via_hr_runtime` role has INSERT/SELECT but no UPDATE/DELETE grant on audit history.
  - Replaced the unsafe combined migration with ordered H3.2 core, H3.3 module and H3.3 identity-primitives migrations. Added a transactional H3.3 rollback that removes its own Drizzle ledger entries so re-migration works.
  - Recreated the empty local development PostgreSQL database after verifying every existing public table contained zero rows. The obsolete one-file migration ledger was replaced with the three ordered migrations; browser-local prototype records were unaffected.
- Verification:
  - Fresh PostgreSQL migration passed and created 90 public business tables from three ordered migrations.
  - Transactional H3.3 rollback passed and reduced the database to exactly 21 H3.2 core tables; running `npm run db:migrate` immediately restored all 90 tables.
  - The full recruitment database journey passed against PostgreSQL, covering vacancy/version, original CV metadata, Candidate Pool, application, recommendation, preparation, shortlist selection, detailed score, interview recommendation, contact, panel, scorecard, disposition, hiring decision and encrypted offer.
  - The live test rejected a cross-organisation department reference, a shortlist size above 10, an audit UPDATE and an audit DELETE. Runtime audit grants were also verified directly.
  - Drizzle drift verification reported `No schema changes, nothing to migrate` across all 90 tables.
  - TypeScript typecheck and targeted ESLint passed.
  - Environment-free suite passed: 239 passed, 0 failed, 3 optional database tests skipped.
  - Full suite against PostgreSQL passed: 242 passed, 0 failed, 0 skipped.
  - Production Nitro Node build passed.
  - Repository-wide lint still reports 86 established findings (71 errors and 15 warnings) in unrelated older route and test files. The H3.3 schema and test files pass targeted ESLint and Prettier checks.
- Decisions:
  - H3.3 establishes schema and integrity only. Routes and services do not silently switch to PostgreSQL before their controlled H3.5 migration batch.
  - The migration connection remains separate from the restricted `via_hr_runtime` group role. The later server cutover must use a login inheriting the runtime role rather than the migration owner.
  - Audit history is immutable at both the privilege and trigger layers; corrections are represented by new compensating audit events, never by editing history.

### Step H3.4 - Deterministic staging-data importer

- Status: Complete on 2026-08-30 for the repository and verified against a fresh PostgreSQL database. It is intended for demonstration/staging data only; production service cutover remains H3.5.
- Scope:
  - Replaced the incomplete generated importer with a read-only preview, atomic import and independent read-only verification workflow.
  - Added RFC 4122 UUIDv5 mapping, canonical dataset checksums, natural-key collision detection and strict changed-record refusal. Existing records are never overwritten silently.
  - Replaced clock-relative demo dates with a fixed seed reference date so reset output, checksums and later verification remain deterministic across calendar days.
  - Mapped every current non-empty seed collection: organisation settings, attendance policy, all master data, projects, employees, reporting lines, protected identifiers, compensation, bank details, users, roles, role assignments, vacancies, employee documents and file placeholders, training courses/requests/sessions/assignments, notifications and seed audit history.
  - Added explicit guards for currently empty seed collections. If one later contains data without an approved mapping, import stops instead of falsely reporting zero rows.
  - Encrypted passport/national ID, salary, bank details, vacancy salary range and document numbers with the server keyring before insertion; repeat comparison decrypts only in the server process.
  - Added a separate import-batch record for every successful invocation, lifecycle audit events, failed-attempt recording when the organisation exists, exact source/inserted/unchanged/conflict counts and sanitized operator output.
  - Removed committed encryption material and Windows-only environment commands. Preview/import/verify now require secrets from the environment and run on Windows or Linux.
  - Added a private production Compose tools profile and local/Contabo operating instructions.
- Verification:
  - Fresh PostgreSQL preview completed with 76 mapped source records and left the database empty.
  - First import inserted all 76 source records plus required relational/encrypted derivatives; exact target counts matched the browser seed.
  - Verification passed without writes. A repeat import inserted zero business records, reconciled all 76 as unchanged and created a second completed attempt with its own audit events.
  - A manually changed department caused a non-zero conflict result, preserved the changed row and created a failed attempt record.
  - An injected end-of-import failure rolled back the missing business row while retaining a separate failed-attempt record.
  - Importer integration tests passed 6/6, including UUID format, preview safety, full coverage, encryption round-trip, repeat behaviour, conflict protection and atomic rollback.
- Decisions:
  - Seed document metadata is imported as `Pending Upload`; no file bytes are fabricated. Object-byte migration remains H6.
  - Migration-seeded protected role IDs are reused by role code so the importer respects database bootstrap identity.
  - The ordinary `npm test` run never falls back to or truncates the developer database. Live importer tests require an explicit `VIA_HR_TEST_DATABASE_URL` whose database name is visibly test-only.

### Step H3.5A - Organisation settings and master data cutover

- Status: Complete on 2026-08-30.
- Scope:
  - Created transactional server-only PostgreSQL repositories (`src/lib/db/repositories/master-data.repository.server.ts` and `src/lib/db/repositories/settings.repository.server.ts`) for app settings and all 11 master data collections (departments, locations, positions, grades, employment types, cost centres, projects, working times, public holidays, currencies, activity codes).
  - Enforced atomic transaction boundaries (`db.transaction`) writing data updates and immutable `audit_events` rows within the exact same database transaction.
  - Added server-side role verification (`verifyServerActorRole` in `src/lib/db/utils.server.ts`) querying `users`, `user_roles`, and `roles` in PostgreSQL to eliminate client role-spoofing.
  - Created strict Zod-validated TanStack Start server functions (`src/lib/server-functions/master-data.server.ts` and `src/lib/server-functions/settings.server.ts`).
  - Added dual-mode client services (`src/lib/data/settings-service.ts` and `src/lib/data/master-data.ts`) supporting live server RPC in application context and in-memory execution in unit test harness.
  - Resolved asynchronous promise bugs in `src/routes/staff.tsx` and `src/routes/staff/reports.tsx`, ensuring consistent loading state.
  - Added comprehensive PostgreSQL integration test suite in `tests/db-master-data-settings.test.ts` verifying direct PostgreSQL transactions, atomic audit events, dependency checks, rollback, and actor role enforcement.
  - All 243 business and database tests passing with 0 failures and 0 masked skips.
- Verification:
  - `npx tsc --noEmit`: Passed with 0 errors.
  - `npx eslint` on modified files: Passed with 0 errors and 0 warnings.
  - `node --test tests/db-master-data-settings.test.ts`: Passed against PostgreSQL.
  - `npm test`: Passed (240 passed, 0 failed, 3 optional environment-guarded skips).
  - `npm run build`: Production build succeeded in 765ms.

