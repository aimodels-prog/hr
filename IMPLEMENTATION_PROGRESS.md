# VIA HR System Implementation Progress

This checklist tracks the prompts in `IMPLEMENTATION_PROMPT_PLAYBOOK.md`. A step is marked complete only after its implementation and verification finish.

- [x] Step 01 - Create the implementation foundation and progress tracker
- [x] Step 02 - Development identity, permissions, and role preview
- [x] Step 03 - Complete responsive application shell and navigation
- [x] Step 04 - Organisation settings and master data
- [x] Step 05 - Employee directory page
- [x] Step 06 - Create and manage employee records
- [x] Step 07 - Employee profile and self-service profile
- [x] Step 08 - Digital employee files and document versions
- [x] Step 09 - Document expiry centre and reminders
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
- [x] Step 24 - Employee annual-leave request and automatic refusal
- [x] Step 25 - Leave manager and Super Admin approvals
- [x] Step 26 - Leave administration, cancellation, and calendar
- [x] Step 27 - Timesheet setup and project/activity controls
- [x] Step 28 - Employee weekly timesheet page
- [x] Step 29 - Manager timesheet approval and corrections
- [x] Step 30 - Attendance records and correction requests
- [x] Step 30A - Office geofence, sign-out reminders, and site-visit attendance
- [x] Step 31 - Overtime requests and approval
- [x] Step 32 - Employee travel pre-authorisation request
- [x] Step 33 - HR and Accounts travel approvals
- [x] Step 34 - Post-trip expenses and Super Admin closure
- [x] Step 35 - Payroll preparation and restricted access
- [x] Step 36 - Candidate-to-employee conversion
- [x] Step 37 - Onboarding templates and case workflow
- [x] Step 38 - Offboarding and clearance
- [x] Step 39 - Performance review cycles
- [x] Step 40 - Training catalogue and employee records
- [x] Step 41 - Notification centre and task inbox
- [x] Step 42 - Audit history and record activity timelines
- [x] Step 43 - Role-specific dashboards
- [x] Step 44 - Reports and role-safe exports
- [x] Step 45 - Full application quality and completion pass
- [x] Step 46 - Google Workspace portal authentication through VIA Portal SSO
- [ ] Step 47 - External AI, email, and Google Calendar integrations
- [ ] Step 48 - Production backend and launch readiness

### Production database sequence (`IMPLEMENTATION_PROMPT_PLAYBOOK_V3.md`)

- [ ] Step H3.1 - PostgreSQL and Drizzle foundation (local/repository work complete; managed staging environment pending the approved provider and data-residency region)
- [x] Step H3.1B - Contabo Node runtime and isolated production deployment package
- [x] Step H3.2 - Master data, app-managed dropdowns, projects and employee schema
- [x] Step H3.3 - Remaining module schemas and append-only audit controls
- [x] Step H3.4 - Deterministic staging-data importer
- [x] Step H3.5 - Incremental service migration and browser-storage cutover

### Internal completion sequence

- [x] Completion Step 01 - Integration-ready providers and persisted operation states
- [x] Completion Step 02 - Recommender-to-employee linkage and source directory
- [x] Completion Step 03 - Weighted vacancy-specific interview scoring
- [x] Completion Step 04 - Accepted-offer conversion and Workspace provisioning queue
- [x] Completion Step 05 - Onboarding activation and verification workflow
- [x] Completion Step 06 - Projects, unified leave, and geofenced attendance
- [x] Completion Step 07 - Training catalogue and assignments
- [x] Completion Step 08 - Notification triggers and record audit timelines
- [x] Completion Step 09 - Reports, filters, saved views, print, and safe exports
- [x] Completion Step 10 - Placeholder removal, quality gates, and role acceptance

## Verification log

### Step 01

### H3.5C — recruitment CV intake slice (in progress)

- [x] Direct HR CV intake saves the original PDF/DOC/DOCX in encrypted object storage and creates a PostgreSQL CV record and durable extraction job in one controlled flow.
- [x] Local deterministic extraction runs through a retryable worker with stale-lock recovery and explicit review/failed states.
- [x] HR confirmation creates or links the Candidate Pool profile, application, CV linkage, applicant count, and audit event atomically.
- [ ] Recommended-candidate recommender, manual inclusion, screening, assessment, shortlist, interviews, scorecards, offers, conversion, import, and full PostgreSQL/MinIO journey remain to be migrated.
- [x] Verification: typecheck, targeted ESLint/Prettier, migration generation/application, and live PostgreSQL/MinIO CV-worker test passed.

### H3.5C — Core HR document security slice (in progress)

- [x] Added a server-only employee-document upload transaction: tenant/employee authorization, encrypted object storage, PostgreSQL metadata, initial version history, and audit event commit together.
- [x] Added a server-only document replacement transaction: old version is marked Replaced, replacement metadata and version are created, and the object is cleaned up if the transaction fails.
- [ ] Onboarding/offboarding cases, templates, tasks, self-service forms, assets, expiry/anniversary workers, and recruitment-to-employee UUID conversion still require service cutover and UI integration.
- [x] Verification: TypeScript and targeted ESLint pass.

### H3.5C — Leave transaction slice (in progress)

- [x] Added server-side leave request creation with employee ownership, policy validation, public-holiday exclusion, working-day calculation, automatic 14/60-day refusal, attachment ownership checks, and audit logging.
- [x] Added server-side Supervisor → HR approval/decline with actual reporting-line verification and balance deduction guarded by an atomic conditional update.
- [x] Added idempotent PostgreSQL annual entitlement/carry-forward rollover and a protected server function for it.
- [ ] Existing Leave UI/service, office-wide notifications, cancellation/amendment flow, durable scheduled worker dispatch, PostgreSQL export and complete permission/browser tests still require cutover.
- [x] Verification: TypeScript and ESLint pass.

### H3.5C — Timesheet transaction slice (in progress)

- [x] Added server-side timesheet entry persistence with open-period, employee-ownership, date-range, hours, and active project/cost-centre/activity/location validation.
- [x] Added server-side submission with closed-period protection.
- [x] Added Supervisor → HR approval/return transaction with actual reporting-line enforcement and immutable audit events.
- [ ] Period creation/closure, payroll locking, reopening/correction chains, attendance reconciliation, reminders/escalation workers, Accounts payroll feed, UI cutover, and role/concurrency browser tests remain.
- [x] Verification: TypeScript and targeted ESLint pass.

### H3.5C — Attendance and site-visit PostgreSQL cutover (complete)

- [x] Added server-side office punch capture with configured clock-in-site lookup, geofence distance validation, captured coordinates/accuracy, duplicate-punch protection, and audit events.
- [x] Added server-side missed-punch correction creation with employee ownership, explanation/date validation, and audit events.
- [x] PostgreSQL is authoritative for daily attendance records, immutable punch events, HR manual entry/edit, atomic validated CSV import, audited server export, corrections, site visits, attendance policy, and office-origin exception cases.
- [x] Office geofence configuration and every employee punch are validated server-side. Production anti-spoofing uses the approved office public network together with the configured GPS geofence; reverse-proxy settings prevent a browser-supplied forwarded IP from being trusted.
- [x] Missed sign-out follows the actual Supervisor → HR approval chain, recomputes hours in the organisation timezone, prevents self-approval, stores evidence in encrypted object storage, and permits only the employee, assigned supervisor, HR or Super Admin to retrieve it through an audited server operation.
- [x] The durable background worker delivers exactly three deduplicated sign-out reminders, creates and completes home-origin site-visit attendance, opens persistent office-origin exception cases, and performs attendance/timesheet reconciliation without requiring a browser tab to remain open.
- [x] Employees can submit and cancel future site visits; HR/Super Admin can approve or reject them; exception investigation, ownership and resolution persist with immutable audit events.
- [x] Verification: TypeScript and targeted ESLint pass; 239 environment-free tests pass; the live PostgreSQL attendance transaction/worker test passes; both the dedicated PostgreSQL attendance browser journey and the wider Time & Travel browser journey pass.
- [ ] Repository-wide lint and the unrelated recruitment browser failure remain programme-level gates under Modules 17 and 1 respectively; neither is an Attendance defect.

### H3.5C — Overtime transaction slice (in progress)

- [x] Added server-side overtime claim persistence with employee ownership, future-date/hours/reason validation, evidence ownership verification, compensation type and audit logging.
- [x] Added Supervisor → HR approval/rejection enforcement using the actual reporting line, with self-approval blocked regardless of role combination.
- [x] Added atomic TOIL balance credit and leave transaction creation when an approved claim has a matching compensation/time-off policy.
- [ ] Payment payroll-ledger assignment, correction history, notifications/reminders/escalation, UI cutover and browser role tests remain.
- [x] Verification: TypeScript and targeted ESLint pass.

### H3.5C — Travel, Finance, Talent and Notifications transaction foundations (in progress)

- [x] Added PostgreSQL travel request creation with employee ownership, date/amount/currency validation and audit logging.
- [x] Added concurrency-safe dual HR/Accounts travel approval with explicit `Pre-authorised` transition only after both approvals, decision history and self-approval protection.
- [x] Added PostgreSQL expense persistence with trip-date, positive amount, bill-reference and receipt ownership validation.
- [x] Added PostgreSQL notification status changes and user-scoped notification reads with audit events.
- [ ] Training catalogue/assignments/certificates, organisation-wide notification/task cutover, reports/audit/backup administration, remaining durable workers, security/code-quality gates and final browser/deployment journeys remain.
- [x] Verification: TypeScript and targeted ESLint pass for these new repositories.

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

- Status: Complete on 2026-08-31 after an independent remediation and verification pass.
- Scope:
  - Created transactional server-only PostgreSQL repositories (`src/lib/db/repositories/master-data.repository.server.ts` and `src/lib/db/repositories/settings.repository.server.ts`) for app settings and all 11 master data collections (departments, locations, positions, grades, employment types, cost centres, projects, working times, public holidays, currencies, activity codes).
  - Enforced atomic transaction boundaries (`db.transaction`) writing data updates and immutable `audit_events` rows within the exact same database transaction.
  - Added server-side role verification (`verifyServerActorRole` in `src/lib/db/utils.server.ts`) querying `users`, `user_roles`, and `roles` in PostgreSQL to eliminate client role-spoofing.
  - Created strict Zod-validated TanStack Start server functions (`src/lib/server-functions/master-data.server.ts` and `src/lib/server-functions/settings.server.ts`).
  - PostgreSQL is authoritative in browser use. The staff shell loads organisation settings and every master-data collection before rendering a module; the browser repository is refreshed only as a compatibility read cache for synchronous modules awaiting their own H3.5 cutover.
  - Removed silent production fallback. Database and server-function failures now display a retryable organisation-data error instead of showing stale browser records or pretending that a write succeeded.
  - Master-data update, archive and restore actions no longer require a matching record in the current browser before the server is called. Server validation and PostgreSQL dependency checks are authoritative, so records created in another administrator's browser remain manageable.
  - Office attendance geofence coordinates and radius now use the same PostgreSQL master-data write path and refresh the compatibility cache after success.
  - Preserved legacy master-data IDs in the compatibility cache while retaining each PostgreSQL UUID for server writes. Existing browser-local leave, timesheet, overtime and travel records therefore keep resolving their project, cost-centre, activity and location names during the remaining module cutovers.
  - Added unambiguous organisation resolution: write operations derive the organisation from the verified database user, and read operations refuse to guess when more than one active organisation exists unless `VIA_HR_ORGANISATION_ID` is configured.
  - Resolved asynchronous promise bugs in `src/routes/staff.tsx` and `src/routes/staff/reports.tsx`, ensuring consistent loading state.
  - Isolated `tests/db-master-data-settings.test.ts` from the development database. It now requires `VIA_HR_TEST_DATABASE_URL` with `test` or `scratch` in the database name and verifies role rejection, actor-to-organisation resolution, audit rollback, geofence persistence, record-version increments and ambiguous-organisation refusal.
  - Removed 13 synthetic `H35A` organisations and their 256 test audit events that the earlier test had left in the local development database. One active VIA organisation remains.
  - Repaired deterministic seed coverage for currencies, working times, public holidays, report saved views, training relationships and source-ID mapping. Document-expiry dates now use a fixed seed reference rather than changing every day.
  - Rebuilt the local demo database from the migrations and deterministic importer after taking a recoverable pre-rebuild PostgreSQL dump. The final verification reconciled all 75 source records with zero conflicts.
- Verification:
  - `npx tsc --noEmit`: Passed with 0 errors.
  - Targeted ESLint on every H3.5A runtime, UI and test file: Passed with 0 errors and 0 warnings.
  - `node --test tests/db-master-data-settings.test.ts`: Passed against a fresh disposable PostgreSQL database; the database was removed after verification.
  - Environment-free `npm test`: Passed (239 passed, 0 failed, 4 optional live-database suites skipped).
  - All five Playwright browser journeys passed with PostgreSQL-backed organisation settings and master data, covering Core HR, recruitment, both Talent journeys and Time & Travel.
  - Production build: Passed.
  - Repository-wide lint still reports 72 established errors and 15 warnings in older recruitment, employee-form and formatting files. Every file changed for H3.5A passes targeted ESLint; the repository-wide debt remains part of the final quality gate.
- Remaining limitation:
  - H3.5A migrates only organisation settings and master data. Employee, recruitment, lifecycle, Time & Travel, Talent, notifications, reports and audit service records still require their H3.5 server-repository cutovers before production use.

### Step H3.5B - Core HR PostgreSQL cutover

- Status: In progress on 2026-08-31. This section is intentionally not marked complete while onboarding/offboarding-owned employee transitions still await H3.5D.
- Completed scope:
  - Added server-only, organisation-scoped employee and user repositories with strict server functions for Core HR snapshots, employee creation, employment changes, user-access changes, personal-record corrections, employee profile-change requests and HR approval/rejection decisions.
  - Made PostgreSQL authoritative for the Employee Directory and User Management browser views. Legacy identifiers are retained only in a refreshed compatibility cache while each record carries its authoritative database UUID.
  - Employee creation is one database transaction covering employee, user, Employee responsibility, reporting line, supervisor responsibility, initial employment history, encrypted salary/bank/identity records and immutable audit history.
  - Employment changes update reporting-line history, encrypted compensation, employment history and audit history transactionally. Server-side validation independently enforces active master data, manager validity, hierarchy-cycle prevention, role boundaries and project/cost-centre validity.
  - Profile changes now remain pending in PostgreSQL until HR/Super Admin approval. Submission, approval/rejection, employee updates, notifications and audit events use database transactions.
  - User Management now persists access and responsibility changes in PostgreSQL, protects the final Super Admin, prevents self-editing, protects Super Admin accounts from HR changes and prevents supervisor access removal while direct reports remain assigned.
  - Expanded shared employee redaction so unrelated users do not receive personal email, phone, address, family, birth, demographic or statutory fields. Salary/bank, identity and performance data retain their existing self/HR/Accounts/supervisor boundaries.
  - Removed a keyed development-provider remount that caused repeated staff-shell bootstrapping whenever the compatibility cache changed.
- Verification so far:
  - TypeScript typecheck passed.
  - Targeted ESLint passed with zero findings on the H3.5B runtime, UI and test files.
  - A live disposable-database test passed for employee creation, encrypted fields, reporting lines, employment changes, user access, profile request/approval, notifications and audit history.
  - Raw PostgreSQL ciphertext verification confirmed that salary, bank-account and passport plaintext values were absent.
  - The complete Core HR Playwright journey passed against PostgreSQL-backed organisation, master data, employees and users.
- Remaining before H3.5B can be marked complete:
  - Move onboarding-owned self-service employee intake and offboarding-owned terminal status/finalisation to their PostgreSQL transactions in H3.5D.
  - Complete recruitment conversion UUID linkage in H3.5C so accepted offers create employees without compatibility identifiers.

### Step H3.5C - Recruitment and secure-file PostgreSQL cutover

- Status: Recruitment-owned cutover complete on 2026-09-01. The final browser assertion inside the newly created onboarding case remains a cross-module H3.5D acceptance item, so the programme-level recruitment-through-onboarding journey is not yet closed.
  - Added private S3-compatible object storage to local and production Compose using a dedicated MinIO volume and backend-only network access.
  - File content is encrypted by VIA with authenticated AES-256-GCM before it reaches object storage. PostgreSQL stores metadata and the plaintext checksum; authenticated retrieval decrypts and verifies the original size and checksum before returning content.
  - Upload, read, owner reassignment and deletion create immutable PostgreSQL audit events. The live object-storage integration test passed against MinIO and the scratch PostgreSQL database.
  - Public careers applications no longer create browser-local Candidate Pool or IndexedDB records. The server validates the real file signature, saves the encrypted original CV, creates or reconciles the Candidate Pool person, creates the vacancy application and CV version, encrypts salary expectations, increments the vacancy count, creates the HR notification and queues CV preparation in one controlled database flow.
  - Application failure removes the unattached encrypted object. Duplicate vacancy applications are rejected before a new file is stored.
  - Added a live PostgreSQL test proving Candidate Pool, application, CV, durable preparation queue and immutable audit records are created together and the original encrypted CV can be authenticated and retrieved.
  - HR and Super Admin recruitment bootstrap now reads candidates, applications, CV records, preparation runs, inclusion records, assessment batches, scores, interview recommendations, contact history and recommender history from PostgreSQL into the temporary compatibility cache.
  - Candidate CV download now falls back to the permission-checked server path, so PostgreSQL/MinIO CVs do not depend on the current browser's IndexedDB.
  - Candidate stage changes, HR ownership reassignment, contact history, follow-up notifications, recommendation records and candidate CSV export now execute through role-verified PostgreSQL services. Export excludes salary data and writes its own immutable high-risk audit event.
  - Removed the incorrect organisation-wide unique CV checksum constraint. Identical CV bytes may legitimately belong to separate applications; processing reuse remains a preparation concern rather than incorrectly sharing one file owner. Migration `0004_new_gravity.sql` replaces it with a normal lookup index.
  - The live public-application test now also verifies server-side screening, ownership, contact, recommendation and audited export transactions.
  - Candidate recruitment-detail editing now uses a role-verified PostgreSQL transaction with normalized identity fields, duplicate email/phone protection, active-project validation, encrypted salary values and redacted audit summaries.
  - Candidate merging now locks both profiles and moves applications where safe, contact history, recommendations, CV history, preparation/assessment records, interviews, dispositions, offers and hiring-decision references in one PostgreSQL transaction. Same-vacancy duplicate applications are retained as archived history, and the duplicate profile receives a permanent merge pointer and critical audit event.
  - The live recruitment persistence test now covers encrypted candidate correction and atomic merge-history preservation.
  - HR-confirmed CV review, manual Candidate Pool inclusion, preliminary screening, the 1-10 assessment group, pinned recommended/HR-added candidates, deterministic detailed scoring, shortlist overrides and shortlist finalisation now use PostgreSQL transactions. Application stage changes commit in the shortlist transaction.
  - Interview templates, scheduled and manual interviews, panel-conflict checks, candidate responses, rescheduling, cancellations, no-shows, panel drafts/submissions/reopening, dispositions and future-consideration history now use PostgreSQL. Assigned panelists receive a row- and field-scoped database view rather than the HR recruitment snapshot.
  - Hiring recommendations, final decisions, override/waiver reasons, encrypted offers, controlled state changes and audited offer-document export now use PostgreSQL. A selected manual interview can create its closed administrative vacancy and final hiring decision in one transaction.
  - Accepted offer to employee, user, Employee responsibility, candidate/application linkage and onboarding case/tasks is one atomic PostgreSQL transaction.
  - Candidate spreadsheet parsing now runs on the server with XLSX/CSV signature, size, sheet, row, column, duplicate-heading and spreadsheet-formula protections. HR reviews the parsed preview; the reviewed commit rechecks duplicates and writes candidates, merges and the batch audit transactionally.
  - The candidate CV worker has durable claim locks, stale-lock recovery, exponential retry, final failure state and a standalone process. Original CVs and offer/file content remain encrypted in object storage.
  - Removed the last browser confirmation and remaining production UI calls to synchronous interview/scorecard/offer mutations. Compatibility collections are read caches only for the migrated screens.
  - Contact dates and follow-ups are server validated; backdated logs cannot replace the current latest-contact summary. Candidate CSV cells are protected against spreadsheet formula execution.
  - Verification: repository TypeScript passes; environment-free suite passes after preserving local-only unit-test templates; the fresh PostgreSQL/MinIO lifecycle test passes, including public CV, worker, screening, shortlist, scheduled and manual interviews, scorecards, direct hire, decision, encrypted offer, audited document generation and atomic conversion; the PostgreSQL-backed Playwright recruitment journey passes through the new Directory employee.
- Remaining cross-module acceptance:
  - After H3.5D makes onboarding pages PostgreSQL-authoritative, extend the passing Playwright journey from the Directory assertion into the generated onboarding case and employee self-service form.

### Step H3.5D - Core HR lifecycle PostgreSQL cutover

- Status: Core HR lifecycle persistence complete on 2026-09-01; final cross-module browser acceptance remains in Step 18.
- Scope:
  - Onboarding and offboarding cases, templates, tasks, checkpoints, self-service employee forms, assets, document verification/replacement/version history, confidentiality controls and final access suspension now use role-verified PostgreSQL transactions.
  - Passport, visa, ID, contract, bank and task evidence use encrypted object storage with ownership checks, authenticated retrieval and audit events.
  - Departing employees remain active for their assigned handover work; final deactivation and access suspension commit with offboarding completion.
  - Document-expiry and anniversary recovery now run in the durable server worker rather than depending on a page being open.
  - Direct employee creation and spreadsheet onboarding create PostgreSQL onboarding cases through the same lifecycle path.
- Verification:
  - Fresh disposable PostgreSQL and MinIO Core HR lifecycle test passed.
  - Employee spreadsheet import tests passed 7/7 after the server-backed onboarding handoff.
  - TypeScript typecheck passed.
- Remaining cross-module acceptance:
  - The final Employee, Line Manager, HR, Accounts and Super Admin browser journey remains part of Step 18.

### Step H3.5E - Leave PostgreSQL cutover

- Status: Leave persistence and workflow cutover complete on 2026-09-01; final browser acceptance remains in Step 18.
- Scope:
  - Policies, employee overrides, balances, balance activity, requests, evidence, automatic refusal, amendments, withdrawals and cancellations now use PostgreSQL as the authoritative store.
  - Employee ownership, the actual assigned Supervisor then HR approval chain, public holidays, configured working days, evidence ownership and balance deductions are enforced inside server transactions.
  - Concurrent final approval cannot deduct a balance twice. Approved-leave notifications, policy entitlement changes, manual balance changes and server-derived exports are persisted and audited.
  - Annual rollover and completed-leave processing run idempotently in the durable worker.
  - Removed the misleading HR supervisor-recovery UI; HR cannot bypass the employee's assigned Supervisor.
- Verification:
  - Fresh disposable PostgreSQL test passed required evidence, public-holiday exclusion, role denial, Supervisor to HR approval, concurrent approval, one-time deduction, office notification, policy adjustment, audited export, rollover and cancellation restoration.
  - Existing browser-local Leave tests remain green in the environment-free suite.
  - TypeScript typecheck and targeted formatting/lint passed.

### Step H3.5F - Timesheet PostgreSQL cutover

- Status: Timesheet-owned persistence and workflow complete on 2026-09-01. Payroll-feed completion is tracked in Step 8; final browser acceptance remains in Step 18.
- Scope:
  - Settings, weekly periods, employee drafts, normalized entries, incomplete draft rows, submission, Supervisor review, HR approval, returns, period closing/reopening and payroll locking now use PostgreSQL.
  - Employee ownership and actual reporting relationships are enforced server-side. HR cannot complete the Supervisor stage and no approver can approve their own timesheet.
  - Entry dates, hours, active projects, cost centres, activity codes and work locations are validated server-side. Expected hours use the organisation working week and exclude public holidays and approved leave.
  - Draft saves atomically replace normalized entries while retaining incomplete draft rows in PostgreSQL. Simply viewing periods remains read-only.
  - Payroll-locked corrections atomically preserve the original as immutable corrected history and create a linked correction in the same period with the original dates intact.
  - Attendance reconciliation is recalculated by the server before each approval. Submission reminders, manager escalations and reconciliation recovery now run in the durable worker with deduplication.
  - Accounts has server-scoped read access and can initiate a payroll-locked correction; only HR or Super Admin can perform a manual payroll lock.
- Verification:
  - Fresh database `via_hr_timesheet_test_20260901_03` migrated through `0010_happy_the_phantom.sql` and passed the complete PostgreSQL lifecycle: draft, 40 validated hours, attendance reconciliation, wrong-manager denial, concurrent manager decision, HR approval, payroll lock, Accounts correction, same-period/date preservation, scoped employee read and idempotent worker reminders.
  - Repository TypeScript typecheck passed.
  - Targeted Prettier and ESLint passed for the Timesheet repository, server functions, compatibility service, routes, schema, worker and test.
  - Environment-free suite: 238 passed, 11 database-dependent tests skipped and one pre-existing Travel/Payroll carry-over assertion remains failing. That failure is owned by Steps 7 and 8 and is not a Timesheet failure.
- Remaining cross-module acceptance:
  - Generate the final payroll input/feed from PostgreSQL-approved timesheets during Step 8.
  - Complete the role-based PostgreSQL/MinIO browser journey during Step 18.

### Step H3.5G - Overtime PostgreSQL cutover

- Status: Overtime-owned persistence and workflow complete on 2026-09-01. Final payroll-input consolidation is tracked in Step 8; browser acceptance remains in Step 18.
- Scope:
  - Claims, encrypted supporting evidence, approval history, corrections, reminders and payroll-ledger state now use PostgreSQL as the authoritative store.
  - Employees can submit only for themselves. An actual assigned Supervisor, HR or Super Admin may submit on behalf of an employee, and the server independently validates the employee, reporting line, date, hours and active project, cost-centre, activity and work-location references.
  - The Supervisor then HR/Super Admin approval chain is enforced inside row-locked transactions. No actor can approve their own claim in any role combination, and concurrent final decisions cannot approve or credit a claim twice.
  - Payment and time-off-in-lieu are explicit choices. Final time-off approval credits the configured leave policy and balance ledger atomically; correcting that claim reverses the original credit before creating the replacement.
  - Approved-claim correction archives the original and creates its linked replacement in one transaction. Supporting files are owner-checked, encrypted in object storage and retrieved only through the permission-checked audited server path.
  - Accounts and Super Admin receive a server-scoped payroll ledger. Payroll assignment locks eligible payment claims, prevents duplicate assignment and excludes time-off claims. Server-derived filtered CSV export is audited.
  - PostgreSQL Timesheet and Attendance records produce cross-check warnings. Durable, deduplicated Supervisor and HR overdue reminders run through the worker.
- Verification:
  - Fresh database `via_hr_overtime_test_20260901_02` passed ownership/scoping, wrong-manager and self-approval denial, Supervisor approval, concurrency-safe HR approval, payment payroll assignment, audited export, time-off credit, atomic correction and reversal, replacement linkage and idempotent worker reminders.
  - Repository TypeScript typecheck passed.
  - Targeted Prettier and ESLint passed for the Overtime repository, server functions, compatibility service, routes and database test.
- Remaining cross-module acceptance:
  - Consolidate approved overtime into PostgreSQL payroll inputs during Step 8.
  - Complete Employee, Supervisor, HR, Accounts and Super Admin browser journeys during Step 18.

### Step H3.5H - Travel and reimbursement PostgreSQL cutover

- Status: Travel and reimbursement persistence and workflow complete on 2026-09-01. Consolidated payroll-input generation remains in Step 8; final browser acceptance remains in Step 18.
- Scope:
  - Travel requests, HR decisions, Accounts decisions, authorised-budget snapshots, expense lines, reimbursement closure and payroll assignment now use PostgreSQL as the authoritative store.
  - The server permits self-service submission only for the verified employee, validates active employees, projects, cost centres and currencies, rejects overlapping trips and negative estimates, and verifies optional encrypted evidence ownership.
  - HR and Accounts complete independent, row-locked approval stages. Both approvals are required before the request becomes `Pre-authorised`; self-approval, repeated decisions, stale decisions and reasonless rejections are refused server-side.
  - Post-trip expenses can be submitted only after the trip end date. Every line requires a positive amount, trip-date match, bill reference, active currency, verified OMR conversion and an encrypted PDF/JPG/PNG receipt whose file signature and ownership are checked.
  - Super Admin closure is row-locked and cannot be self-approved. Closing creates the PostgreSQL reimbursement feed; returning a claim deletes stale expense rows and clears every stale total before employee correction and resubmission.
  - Accounts or Super Admin can assign only closed, verified OMR reimbursements to an open payroll period. Duplicate or cross-period assignment is refused.
  - Evidence and receipts are retrieved only through the permission-checked, integrity-verified and audited object-storage path. Failed request or expense submissions remove newly uploaded unattached files.
  - PostgreSQL notifications cover initial review, each approval outcome, final closure/return and post-trip expense submission. Durable, deduplicated approval, closure and post-trip reminders run in the worker.
  - The legacy carry-forward regression was corrected: a reimbursement for travel from an earlier payroll cycle is identified and reconciled even when it is closed during the current payroll period; reimbursement remains OMR while salary retains its own currency.
- Verification:
  - Fresh database `via_hr_travel_test_20260901_04` passed scoped reads, self-approval denial, concurrent HR and Accounts approval, `Pre-authorised` transition, verified receipt submission, rejected-expense stale-data cleanup, corrected resubmission, Super Admin closure, reimbursement creation, payroll assignment and idempotent worker reminders.
  - All 20 existing Travel and payroll-boundary unit tests passed, including the previously failing late-closed reimbursement case.
  - Environment-free suite passed: 239 passed, 13 optional live-database suites skipped, 0 failed.
  - Repository TypeScript typecheck, targeted Prettier/ESLint and the production Nitro build passed.
- Remaining cross-module acceptance:
  - Generate and reconcile the consolidated PostgreSQL payroll input during Step 8.
  - Add the role-based PostgreSQL/MinIO browser journey during Step 18.

### Step H3.5I - Payroll and Finance PostgreSQL cutover

- Status: Payroll-owned persistence, consolidation and controlled completion workflow complete on 2026-09-01. The programme-wide browser journeys remain tracked in Step 18.
- Scope:
  - Payroll periods, normalized employee inputs, exceptions and manual adjustments now use PostgreSQL as the authoritative store. Browser storage is refreshed only as a compatibility read cache for the existing screens.
  - Accounts and Super Admin restrictions are enforced on every repository read and mutation, not only in navigation or route components. Employee direct access is denied by the database repository.
  - Row-locked input collection consolidates approved payable overtime, unpaid leave, closed reimbursements and signed manual adjustments. Source claims are linked to one period in the same transaction and repeated or concurrent collection does not duplicate payroll rows.
  - The exception workbench flags missing timesheets and bank data, unresolved attendance, pending leave, unclosed travel, joiners/leavers, expired contracts, invalid currencies, extreme values and prior-period overtime or reimbursements. Every blocking item must be resolved in its source module or acknowledged with notes.
  - Every manual allowance, deduction and correction requires an employee, positive amount, salary currency, reason and PDF/JPG/PNG evidence. Evidence is signature-checked, encrypted in object storage, owner-validated in the transaction and downloaded only through an audited Accounts/Super Admin server path. Failed mutations remove unattached uploads.
  - The controlled flow is prepare, documented exception resolution, independent Super Admin approval, Accounts/Super Admin lock, server-derived formula-safe CSV export, and Super Admin reasoned reopening for correction.
  - Every register view, create, adjustment, collection, exception acknowledgement, approval, lock, export and reopen action writes a PostgreSQL audit event.
- Verification:
  - Fresh database `via_hr_payroll_test_20260901_05` migrated through the complete migration history and passed restricted reads, feed consolidation, two concurrent recalculations, source assignment, exception acknowledgement, Super Admin approval, lock, export, reasoned reopen, correction and duplicate-prevention checks.
  - TypeScript typecheck and targeted ESLint passed for the Payroll repository, server functions, compatibility service, routes, types and database lifecycle test.
  - Environment-free suite passed: 239 passed, 14 optional live-database suites skipped, 0 failed.
  - Production Nitro build passed.
- Deferred programme-wide quality gate:
  - Repository-wide ESLint still reports 924 established findings across older modules. The Payroll files have no targeted findings; clearing the complete backlog remains explicitly tracked under Module 17 before launch.
  - Employee, HR, Accounts and Super Admin browser/direct-URL acceptance remains explicitly tracked under Module 18.

### Step H3.5J - Performance PostgreSQL cutover

- Status: Performance-owned persistence and lifecycle complete on 2026-09-01. Final Employee, Line Manager and HR browser acceptance remains tracked in Step 18.
- Scope:
  - Performance templates, cycles, employee objectives, progress check-ins, self-assessments, supervisor assessments, HR moderation, review discussions, employee acknowledgement, locking and corrections now use PostgreSQL as the authoritative store.
  - Employees can create, edit, submit and update only their own objectives. Objective sets must total 100%, and only the employee's actual assigned supervisor can approve, return or confirm completion.
  - Cycle launch creates the eligible employee review population transactionally. Approved objectives become the objective section of the employee's review, with immutable review structure and score snapshots.
  - Self, supervisor, moderation, discussion, acknowledgement and lock stages are enforced by role, relationship, status and record version inside row-locked transactions. Concurrent submissions cannot advance the same review twice.
  - Manager ratings, comments, summaries, development plans and moderation notes are redacted from employee queries until the acknowledgement stage. Employee and Line Manager reads are scoped by employee identity and current reporting relationships; HR and Super Admin retain organisation-wide oversight.
  - Correcting a locked review archives the original as `Corrected` and creates a linked locked version in one transaction, preserving the full revision history.
  - Objective evidence uses encrypted object storage with file ownership validation and permission-controlled audited retrieval. Workflow handoffs and progress/completion events create PostgreSQL notifications.
  - The existing Talent screens now hydrate from PostgreSQL and send every material template, cycle, objective and review mutation through verified server functions; the browser repository is only a temporary compatibility view cache.
- Verification:
  - Fresh database `via_hr_performance_test_20260901_02` migrated through `0013_tough_naoko.sql` and passed the complete lifecycle: cycle launch, two weighted objectives, cross-employee denial, wrong-manager denial, approval, self-assessment, concurrent supervisor submission, confidential-data redaction, HR moderation, discussion, employee disagreement, lock, correction history, progress completion, notifications and audit history.
  - TypeScript typecheck and targeted Prettier/ESLint passed for the Performance schema, repository, server functions, cache bridge, services, routes, components and database test.
  - Environment-free regression suite passed with the new live-database test safely skipped when no explicit test database is supplied.
  - Production Nitro build passed.
- Remaining cross-module acceptance:
  - Complete the PostgreSQL-backed Employee, Line Manager and HR browser journeys and direct-URL denial tests during Step 18.

### Step H3.5K - Training and Certifications PostgreSQL cutover

- Status: Training and certification persistence, workflows and automation complete on 2026-09-01. Programme-wide direct-URL and deployment acceptance remains tracked in Step 18.
- Scope:
  - Training courses, sessions, employee requests, Supervisor and HR decisions, assignments, attendance, completions and certification records now use PostgreSQL as the authoritative store.
  - Employees can request only for themselves; Line Managers can assign and decide only for their direct reports; HR and Super Admin manage the organisation catalogue, sessions, attendance, completion and verification. Self-approval and unrelated-manager access are rejected by the server.
  - Course roles use VIA system roles. Required locations, projects and currencies must be active organisation master data and are checked again in the server transaction. Duplicate open requests and assignments are prevented, including under concurrent attempts.
  - HR can archive and restore courses, cancel sessions and enrolments with reasons, record attendance/no-shows, complete assignments and verify or reject certificates.
  - PDF/JPG/PNG certificates are signature-checked, encrypted in object storage, linked to their training record and available only through permission-controlled, integrity-checked, audited retrieval.
  - Mandatory training assignment and certification renewal/expiry recovery now run in the durable worker with deduplication. Missed expiry dates generate one recoverable expired notice instead of depending on the portal being open on the exact day.
  - The existing Talent screens hydrate from PostgreSQL and send material training mutations through verified server functions; browser collections remain compatibility read caches only.
- Verification:
  - Fresh database `via_hr_training_test_20260901_02` passed employee request, wrong-manager denial, Supervisor to HR approval, scheduling and capacity, attendance, completion, certificate ownership and verification, mandatory assignments, deduplicated reminders and scoped reads.
  - The PostgreSQL-backed Talent Playwright journey passed 2/2, covering objectives through acknowledgement and certificate upload/HR verification, plus intended-role access to Team Performance and Training Records.
  - TypeScript typecheck passed after the final validation and workflow changes.
- Remaining cross-module acceptance:
  - Complete the programme-wide role/direct-URL matrix, accessibility review and production deployment journey during Step 18.

### Step H3.5L - Notifications and My Tasks PostgreSQL cutover

- Status: Notification persistence and the role-scoped task inbox are complete on 2026-09-01. Programme-wide direct-URL and deployment acceptance remains tracked in Step 18.
- Scope:
  - PostgreSQL notifications are now the authoritative inbox. A user can read, unread or dismiss only their own notification; single-record changes use optimistic version checks and write audit events.
  - Mark-all-read and confirmed clear-all operations are server transactions scoped to the verified user and audited once with the affected count. The notification drawer hydrates from PostgreSQL and shows real loading and failure feedback.
  - My Tasks is now derived on the server from authoritative Leave, Timesheet, Attendance, Overtime, Travel, Payroll, Core HR, Performance, Training and Recruitment workflow rows.
  - Employee ownership, actual Supervisor reporting lines, active role, named lifecycle assignees and interview-panel membership are applied inside the PostgreSQL query before task rows are returned. Employee search remains personal; broader employee-name search is available only in approval roles.
  - Task urgency is calculated from server dates into Open, Due Soon, Overdue and Blocked. Deep links point to the corresponding deployed VIA routes and continue to work after refresh.
  - The durable worker reconciles the PostgreSQL `workflow_tasks` projection every five minutes, completes stale projection rows and creates deduplicated due-soon/overdue reminders. The former browser attendance/reminder timer was removed.
- Verification:
  - Fresh PostgreSQL test passed direct-report task visibility, unrelated employee denial, notification ownership, optimistic concurrency, persisted access-denied audit, bulk dismissal, durable task projection and idempotent reminder generation.
  - Playwright passed the PostgreSQL task and notification UI for Employee, Line Manager, HR, Accounts and Super Admin.
  - Repository TypeScript typecheck and targeted ESLint passed.
  - Environment-free suite passed: 239 passed, 17 optional live-database suites skipped, 0 failed.
  - Production Nitro build passed.
- Remaining cross-module acceptance:
  - Programme-wide direct-URL denial, accessibility, responsive-layout and deployment tests remain in Step 18.

### Step H3.5M - Reports and Exports PostgreSQL cutover

- Status: Report persistence, permission filtering and audited export are complete on 2026-09-02. Programme-wide report reconciliation and deployment acceptance remain tracked in Step 18.
- Scope:
  - Recruitment, headcount, Leave, Attendance, Overtime, Timesheet, Travel, Payroll, Onboarding, Offboarding, Performance, Training and document-expiry reports are now rebuilt from organisation-scoped PostgreSQL queries. The Reports screen no longer reads browser collections to produce operational results.
  - HR receives the approved HR catalogue, Accounts receives only Travel and Payroll reports, and Super Admin receives the full catalogue. The repository rejects unauthorised report IDs and records the denial in immutable PostgreSQL audit history.
  - Employee names and operational values are selected only after role access is checked. Salary, bank, passport, identity and confidential performance comments are not selected into any report result. Payroll inputs remain restricted to Accounts and Super Admin.
  - Search, date, department and status filters execute on the server before rows are returned. Saved views are user-owned PostgreSQL records with archive history; one user cannot read or remove another user's views.
  - CSV content is generated on the server from the permission-filtered result, protected against spreadsheet-formula execution and returned only after a high-risk export audit event has been committed. The browser no longer creates a sensitive CSV before auditing it.
  - Migration `0015_talented_lenny_balinger.sql` adds the versioned `report_saved_views` table and was applied successfully to the local VIA PostgreSQL database.
- Verification:
  - Fresh database `via_hr_reports_test_20260901` migrated through the full schema history and reconciled every report query against PostgreSQL without SQL or schema errors.
  - The database test passed the complete report catalogue, headcount-to-source reconciliation, server-side filtering, Accounts denial and denial audit, Payroll field restrictions, saved-view ownership, archived views and audited CSV export.
  - Playwright passed Employee direct-route denial, HR catalogue and headcount display, Accounts finance-only catalogue, and Super Admin Payroll report display.
  - TypeScript typecheck passed. Targeted ESLint passed after resolving the report-screen hook warning.
- Remaining cross-module acceptance:
  - Run the complete multi-module report-to-source reconciliation matrix, accessibility/responsive review and production Compose/Contabo journey during Step 18.

### Step H3.5N - Audit History PostgreSQL cutover

- Status: Immutable Audit History reads, timelines, filters, integrity review and export are complete on 2026-09-02. Programme-wide acceptance remains tracked in Step 18.
- Scope:
  - The global Audit History and embedded record timelines now load immutable `audit_events` from PostgreSQL rather than the browser audit collection.
  - Complete organisation history remains Super Admin-only. Embedded timelines enforce HR payroll restrictions, Accounts finance-module restrictions, employee ownership, actual Supervisor relationships and recruitment access inside the server repository. Denied reads create immutable high-risk audit events.
  - Actor, active role, module, action, record type, attention level, search and date filters are applied by PostgreSQL before matching rows reach the browser. People/automation and activity-group presentation filters remain available for readable review.
  - Before/after summaries are recursively redacted on the server. Salary, compensation, payroll, bank, identity, confidential offboarding and private performance details do not enter an unauthorised response.
  - Record activity timelines use the same PostgreSQL repository and authoritative database UUIDs. Employee profile timelines now prefer the employee's PostgreSQL UUID over the temporary compatibility ID.
  - Integrity checking resolves supported entity links in batched, organisation-scoped PostgreSQL queries and reports preserved audit events whose source record cannot be resolved.
  - Audit CSV is generated on the server from the permission-filtered result, protects spreadsheet cells and commits a high-risk PostgreSQL event recording the audit export itself before returning the file.
- Verification:
  - The live database test passed global and entity reads, complete Leave create/submit/approve history, complete Recruitment vacancy history, employee ownership, Accounts denial, persisted denial events, actor/role/module/action/risk filters, server redaction, immutable update rejection, broken-link detection and self-audited CSV export.
  - Playwright passed Employee direct-route denial, Super Admin PostgreSQL history loading, availability of every required filter and the audited server-download journey.
  - TypeScript typecheck and targeted ESLint passed for the repository, server functions, Audit Viewer, route and tests.
- Remaining cross-module acceptance:
  - The programme-wide role/direct-URL matrix, reconciliation, accessibility, responsive layout and deployment acceptance remain in Step 18.

### Step H3.5O - Production backup, restore and retention administration

- Status: Server-controlled backup, restore-drill, retention and non-production reset tooling complete on 2026-09-02. The real off-server provider and Contabo restore rehearsal remain deployment acceptance items in Step 19.
- Scope:
  - Removed the browser JSON export, restore upload and sample-workspace reset from the working Settings screen. A browser can no longer replace PostgreSQL records or omit protected documents while presenting the result as a production backup.
  - Added a consistent PostgreSQL custom-format backup using an exported repeatable-read snapshot. Exact per-table record counts are captured from the same snapshot as the dump.
  - Database dumps and manifests use streaming AES-256-GCM encryption with a versioned backup keyring. The backup key is separate from field encryption, PostgreSQL and object-storage credentials; prior key versions can remain available during rotation.
  - Encrypted MinIO source objects are copied to a separately configured S3-compatible off-server endpoint. The source and backup endpoints cannot be the same, object links are retained in the encrypted manifest, and the manifest is uploaded last as the completion marker.
  - Restore accepts only a named backup, verifies the encrypted dump checksum and authenticated manifest, refuses the live database, requires an empty database whose name clearly identifies a restore/test environment, and refuses the live or non-empty object bucket.
  - Recovery reconciliation compares exact counts for every PostgreSQL table and verifies every restored object's encrypted size. Successful backup and restore-drill operations create critical PostgreSQL administration audit events without recording credentials.
  - Added configurable off-server retention pruning, protected deployment commands and an approved retention/disposal policy covering legal holds, linked database/file disposal and key rotation.
  - Added a server/CLI-only demo reset. It is impossible in `production` and additionally requires an explicit enable flag, a clearly non-production database name and an exact database-name confirmation before dropping and rebuilding the schema.
  - Existing staged import preview, conflict detection, apply and verification commands remain the controlled data-import path; no arbitrary production restore is exposed in the application UI.
- Verification:
  - Backup-envelope tests passed byte-for-byte round-trip, encrypted-manifest round-trip, authentication failure after tampering, password removal from command arguments, live-target refusal and ambiguous-target refusal.
  - A production tools image with PostgreSQL client utilities built successfully.
  - The second isolated end-to-end recovery drill created backup `20260902011234-4d43a14c-a4cb-423c-9604-779d0cccf45f`, restored and exactly reconciled 97 PostgreSQL tables and 46 encrypted objects, and wrote both backup and restore-drill audit events.
  - The isolated restore databases, restore buckets and temporary backup MinIO container were removed after verification; the live VIA HR PostgreSQL and object-storage volumes were not reset or replaced.
  - TypeScript typecheck, targeted ESLint, encryption/restore-guard tests and the Docker production build passed.
- Deployment acceptance still required:
  - Configure credentials for an S3-compatible destination physically outside the Contabo VPS, schedule daily/pre-migration backup and retention commands, and repeat the proven drill against that real destination on staging. This cannot be truthfully completed from the local development environment without the external backup account.

### Step H3.5P - Durable background workers and operational monitoring

- Status: Complete on 2026-09-02. External-provider recovery remains intentionally deferred with the Google and Gemini integrations; worker deployment acceptance remains tracked in Step 19.
- Scope:
  - Replaced the former in-memory worker loop with PostgreSQL worker instances, heartbeats, database-backed schedules, leases and bounded task-run history. Multiple worker replicas cannot execute the same scheduled task concurrently.
  - Added durable schedules for CV processing, workflow notifications and tasks, leave rollover, attendance reminders and site visits, timesheet reminders and reconciliation, overtime, travel, document expiry, anniversaries, training and certification reminders, offer deadlines, stale-job recovery, orphan-file cleanup and worker-history retention.
  - Failed scheduled work uses exponential retry. Abandoned queue leases are recovered, exhausted jobs become visible dead letters, and inactive worker instances are marked stale.
  - Offer deadlines now expire sent offers transactionally and create deduplicated HR/Super Admin reminders for expired or soon-due responses.
  - Orphan cleanup removes only old, unlinked uploads after exhaustive PostgreSQL reference checks and records the deletion in immutable audit history. Linked records and recent uploads are preserved.
  - Added `/health/worker`, a deployment health command and a Settings monitor showing active/stale workers, queued/retrying/failed jobs and overdue schedules without exposing job payloads or error details.
  - Migration `0016_great_nekra.sql` adds the worker instance, schedule and task-run tables and was applied to the local PostgreSQL database.
- Verification:
  - The live worker database test passed schedule contention, exactly-once lease ownership, failure backoff, stale-job recovery, dead-letter handling, safe orphan cleanup and health monitoring.
  - The offer-deadline test passed expiry, audit creation and reminder idempotency.
  - An actual worker process registered, completed the recovery and cleanup schedules, reported healthy through the CLI and stopped gracefully.
  - TypeScript, targeted Prettier/ESLint and the production Nitro build passed.
  - Environment-free regression suite passed: 244 passed, 21 optional live-database suites skipped, 0 failed.
- Remaining programme gates:
  - Repository-wide dependency, lint and security cleanup is tracked in Module 16 and Module 17.
  - Production worker health, restart and failure-recovery acceptance on Contabo remains tracked in Module 19.

### Step H3.5Q - Security and dependency hardening

- Status: Complete on 2026-09-02 for the application and local production stack. Google Workspace identity enforcement and the final Contabo perimeter review remain intentionally tracked in Step 19.
- Scope:
  - Replaced the vulnerable spreadsheet dependency with the maintained `read-excel-file` parser and resolved the remaining Drizzle Kit development dependency chain without weakening the audit threshold. `npm audit --audit-level=moderate` now reports zero known vulnerabilities.
  - Added production file-size limits and ClamAV streaming malware inspection before any uploaded object is stored or linked. Production fails closed when scanning is unavailable, times out or returns an invalid result.
  - Added application request-size enforcement, bounded mutation/read rate limits, request-origin/CSRF protection and a production Content Security Policy, HSTS, frame, MIME, referrer, permissions, opener and resource-isolation headers.
  - Added matching Nginx request limits, security headers and rate limiting. The production Compose stack includes a pinned, non-published, read-only ClamAV service with persistent signature data and health-gated application/worker startup.
  - Added recursive audit redaction for passwords, credentials, cookies, authorisation data, access/refresh/identity tokens and encryption/API keys. These values are never returned even to Super Admin.
  - Added PostgreSQL guards to prevent organisation reassignment and reject invalid record-version jumps across every versioned table. Existing row locks, organisation predicates and server role/relationship checks remain the authoritative mutation boundary.
  - Corrected defects exposed by the security verification: same-day candidate contact validation, zero-day rollover entries, complete demo schema reset, record-version-aware seed verification and deterministic CV-worker test selection.
  - Removed the obsolete `vite-tsconfig-paths` plugin and enabled Vite's native TypeScript path resolution.
- Verification:
  - Dependency audit passed with zero vulnerabilities and `drizzle-kit check` accepted the migration history.
  - ClamAV accepted a clean stream, rejected an infected stream and failed closed when unavailable in production. The pinned production container reached healthy status and successfully scanned a real file.
  - Security tests passed request-size/rate/header enforcement, audit-secret redaction and live PostgreSQL version/tenant guards.
  - Every PostgreSQL module suite passed sequentially against the isolated test database, including object storage, public applications, CV/worker processing, Attendance, Audit, Core HR, master data, Leave, Notifications/Tasks, Overtime, Payroll, Performance, Reports, Timesheets, Training and Travel.
  - Environment-free regression suite passed: 248 passed, 22 optional live-database suites skipped, 0 failed. TypeScript, targeted Prettier/ESLint and the production Nitro build passed.
- Remaining programme gates:
  - Repository-wide historical lint and formatting cleanup continues in Step 17.
  - Production identity, reverse-proxy, malware-signature-update and penetration acceptance remains part of the Contabo staging gate in Step 19.

### Step H3.5R - Repository-wide code quality and browser persistence cleanup

- Status: Complete on 2026-09-02. PostgreSQL and encrypted object storage remain the authoritative operational stores; Google Workspace authentication is still intentionally deferred to Step 19.
- Scope:
  - Cleared the complete ESLint backlog from 885 findings to zero errors and zero warnings. This included repository formatting, all explicit unsafe `any` uses, stale React effect dependencies and intentional handling for shared UI primitives that co-locate stable style exports.
  - Replaced unsafe form casts with typed Zod input/output forms, typed Candidate/Vacancy/Application records and `unknown` error handling. Corrected complete Directory search parameters while removing the former router casts.
  - Removed the obsolete TypeScript-path Vite plugin and its transitive packages; Vite now uses native TypeScript path resolution without a build warning.
  - Removed the obsolete browser backup, restore and demo-reset production functions. Protected database/object-storage backup and recovery remain server/CLI administrator operations only.
  - Operational browser compatibility data now uses a session-only memory cache hydrated from PostgreSQL. HR records no longer survive refresh in `localStorage` and therefore cannot silently become authoritative; only the explicitly temporary development identity preview remains a browser preference until Google authentication replaces it.
  - Confirmed that no React component accesses `localStorage` directly. Temporary IndexedDB upload staging remains only where a file is immediately transferred to encrypted object storage and removed after success; it is not the authoritative document store.
  - Replaced remaining user-facing implementation wording in public applications, attendance evidence, candidate import metadata and backup administration with plain HR language.
- Verification:
  - Repository-wide Prettier, ESLint and TypeScript checks passed with no findings.
  - Environment-free regression suite passed: 248 passed, 22 optional live-database suites skipped, 0 failed.
  - Production Nitro build passed without the obsolete path-plugin warning.
  - Dependency audit reported zero vulnerabilities and `drizzle-kit check` accepted the full migration history.
- Remaining programme gates:
  - Full multi-role PostgreSQL/MinIO browser, concurrency, deployment, accessibility and responsive acceptance continues in Step 18.
  - Real Google identity, production secrets and Contabo staging infrastructure remain Step 19 work.

### Step H3.5S - Final PostgreSQL/MinIO acceptance testing

- Status: Complete on 2026-09-02. All application-controlled functionality is accepted with PostgreSQL as the source of truth; Google Workspace identity and the real Contabo environment remain Step 19 external launch work.
- Scope and defects closed:
  - Rebuilt the public application -> CV processing -> shortlist -> interview -> scorecard -> offer -> employee -> onboarding browser journey around PostgreSQL and encrypted object storage.
  - Made candidate profile direct links and refreshes hydrate under the authenticated user context instead of reading temporary browser memory in a route loader.
  - Corrected Attendance approval recalculation so amended punches update worked hours, break deductions, late arrival and early departure flags.
  - Prevented protected Leave Administration queries from running before the page permission guard.
  - Limited employee profile reporting-manager display to the redacted reporting-line view instead of requesting the manager's full employee record.
  - Fixed TOIL policy selection so a Compensation Leave policy from another organisation can never be selected through SQL `OR` precedence.
  - Stabilised the production Nitro output as a single Node server bundle, eliminating an invalid generated SSR cross-chunk export found only by the Docker smoke test.
  - Added explicit five-role direct-URL denial acceptance and mobile viewport overflow, named-button and keyboard-focus checks.
- Verification:
  - Clean PostgreSQL/MinIO browser suite: 11 passed, 0 failed. Coverage includes Recruitment, Core HR, Leave, Timesheets, Attendance, Overtime, Travel, Talent, Reports, Notifications/My Tasks, Audit History, all five roles, direct-URL denials and mobile essentials.
  - Complete sequential service/repository suite with live PostgreSQL: 276 passed, 0 failed, 0 skipped. This includes concurrency, duplicate prevention, tenant isolation, immutable audit, worker recovery, secure file handling and role permissions.
  - Encrypted backup and restore drill succeeded: 100 PostgreSQL tables reconciled in a new isolated restore database; temporary backup and restore resources were removed afterward.
  - Production Compose smoke succeeded from fresh volumes: migrations, deterministic seed import, app HTTP 200, database readiness, malware scanner, MinIO and durable worker health all passed.
  - Repository ESLint and TypeScript checks passed. Dependency audit reported zero vulnerabilities. The final production build passed.
- Remaining programme gates:
  - VIA Portal SSO is now complete in Step 46. Configure external Gemini/Calendar/Meet/email providers when credentials are supplied.
  - Apply the verified stack to Contabo staging with real secrets, domain/TLS, firewall, off-server backup destination, monitoring, UAT and rollback rehearsal in Step 19.

### Step H3.5T - Contabo launch preparation

- Status: Repository-side preparation complete on 2026-09-02. The production hostname is now `career.via-int.com`; external deployment is waiting for the Contabo host access, DNS/TLS activation, production secrets, off-server backup account and the intentionally deferred Gemini credentials.
- Scope:
  - Corrected the first-deployment order so PostgreSQL, MinIO and ClamAV start first, the release-specific tools image applies migrations, optional staging data is imported and verified, and only then are the web application and worker started.
  - Added worker release-tag propagation so worker health/history identifies the deployed image rather than reporting `development`.
  - Updated rollback instructions to keep the web application and background worker on the same release.
  - Updated the deployment guide to reflect that every operational module already uses PostgreSQL and encrypted object storage; production must never fall back to browser persistence.
  - Added `/health/worker` to the launch and update acceptance commands.
  - Added a fail-fast production preflight command that reads the protected environment file without printing secrets. It rejects placeholders, mutable image tags, public binding, invalid organisation scope, database URL/credential mismatches, weak or reused service secrets, malformed field/backup keyrings, an unsafe backup destination and inconsistent resource limits before any container starts.
  - Added a release acceptance record covering immutable release identity, automated gates, migration/data reconciliation, public security checks, five-role UAT, direct-URL denial, backup restoration, rollback rehearsal and named go/no-go approvals.
  - Added a GitHub quality gate for main-branch pushes, pull requests and manual release checks. It uses Node 24 with the locked dependency tree, blocks on formatting, lint, TypeScript, service tests, dependency advisories and the production build, then builds both Linux application and worker images from the same commit.
  - Strengthened the quality gate with isolated PostgreSQL 17 and MinIO services. The approved migration history and deterministic import run first, every service/repository test then runs sequentially against the authoritative stores, and CI fails if the TAP evidence contains any skipped infrastructure suite. The evidence artifact is retained for 30 days and Linux release images are built only after this gate passes.
  - Made the Playwright harness portable across Windows development and Linux release runners. CI now installs Chromium and provisions a separate migrated and seeded PostgreSQL/MinIO environment with live ClamAV scanning. It runs the complete database-backed browser journeys, then builds and launches the production Node server for a dedicated health, malware-scanned CV-intake and five-role smoke test. Focused tests are forbidden, failures retry once, and browser traces, screenshots, output and worker logs are retained. Release images are built only after both live service tests and both browser gates pass.
  - Corrected the production object-storage transport guard exposed by the compiled-server smoke. Explicitly opted-in Compose and loopback endpoints are accepted for private HTTP traffic, while arbitrary LAN/public HTTP endpoints and any endpoint without the opt-in remain rejected. Removed an unused Google Fonts request that the production CSP correctly blocked.
  - Removed the obsolete route-loader preview adapter after it caused Recommendations, Recommender Profile and Vacancy Detail to resolve a browser identity during server rendering. Those pages now read the already hydrated, permission-checked current-user context and return a useful missing-source state instead of an HTTP 500.
  - Hardened staff-portal organisation bootstrap against short development or deployment interruptions. Transient browser fetch failures are retried up to three times with a short bounded delay; persistent failures still show the existing honest error state and manual retry action.
- Verification:
  - Production Compose interpolation/configuration validation passed after the deployment changes.
  - Git whitespace validation passed; only Windows line-ending conversion notices were reported.
  - TypeScript validation passed after the deployment changes.
  - Four production-preflight tests passed, including adversarial placeholder, mutable-tag, database-isolation, off-server-backup and encryption-key-separation failures.
  - Repository lint and TypeScript checks passed; the environment-free suite passed with 252 tests, 22 expected live-infrastructure skips and zero failures; dependency audit reported zero vulnerabilities; the production build passed.
  - Rehearsed the new authoritative-store CI sequence locally against a newly created isolated PostgreSQL database and the live local MinIO service: all migrations applied, seed preview/import/verification passed, and the complete sequential suite reported 280 tests passed, zero failed and zero skipped. The temporary test database was verified removed after the run.
  - The complete database-backed browser suite passed all 11 journeys against PostgreSQL and MinIO. The separately compiled production Node server then passed its release smoke with live/readiness/worker health, a real ClamAV-scanned encrypted CV application and representative Employee, Line Manager, HR, Accounts and Super Admin access.
  - Final repository checks after the release-smoke correction passed: 253 environment-free tests, zero failures, 22 expected live-infrastructure skips, TypeScript, ESLint, the production build and dependency audit with zero vulnerabilities.
  - Added and passed a browser regression journey covering the Recommendations index, Vacancy Detail and missing Recommender Profile after PostgreSQL identity hydration.
  - Added and passed a browser regression that deliberately resets the first organisation-data request and verifies that the staff portal recovers automatically without displaying the unavailable-data screen.
- External inputs still required:
  - Contabo SSH access, server region/capacity confirmation and the directory/port allocated to VIA HR System.
  - DNS control and TLS activation for the selected `career.via-int.com` hostname.
  - Generated PostgreSQL, field-encryption, MinIO and off-server-backup credentials.
  - Approved office public network CIDRs for production attendance enforcement.
  - Final VIA HR hostname, the securely shared VIA Portal SSO secret and Portal callback registration.
  - Gemini/Calendar/Meet/email credentials when those external integrations begin.

### Step 46 - VIA Portal single sign-on

- Status: Repository implementation and production-mode acceptance complete on 2026-09-03. The selected production hostname is `career.via-int.com`; authentication activation now requires the shared secret supplied outside source control and registration of the exact callback URL in VIA Portal.
- Scope:
  - VIA Portal is the sole production login authority. VIA HR has no direct Google OAuth flow and normal password login remains disabled by default and is rejected by the production preflight when enabled.
  - Every protected browser route redirects an unauthenticated user to VIA Portal with the current destination encoded in `returnTo`. Unauthenticated API and server-function calls return JSON `401` responses instead of following an HTML login redirect.
  - The public careers pages, the stable public vacancy/application endpoints, health checks, callback/error routes and required static assets remain available without an HR session.
  - The callback verifies the Portal JWT signature with the maintained `jose` library and enforces HS256 only, issuer, audience, app slug, expiry, maximum token lifetime and the `via-int.com` email domain before trusting any claim.
  - A verified Portal identity is linked to an organisation-scoped PostgreSQL user. Existing VIA HR roles remain authoritative; unknown Portal roles receive only the baseline Employee role and cannot elevate themselves to HR, Accounts or Super Admin.
  - VIA HR creates an opaque local session whose raw value is held only in the `__Host-via_hr_session` cookie. PostgreSQL stores only its SHA-256 hash. The cookie is `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` and expires within eight hours.
  - Successful login redirects immediately to the clean `/dashboard` route. The incoming `portal_token` is never stored in browser storage, database identity records, analytics or browser-visible state. Callback access logging is disabled in the supplied Nginx configuration and authentication errors are redacted.
  - Logout revokes only the VIA HR session, expires the VIA HR cookie and redirects to `https://portal.via-int.com`. Invalid callbacks clear partial sessions and show a controlled error with a Portal link without creating a redirect loop.
  - Server mutations bind their actor to the verified Portal session, preventing a browser from impersonating another preview identity after production SSO is enabled. Development role/person preview remains available only outside SSO production mode.
- Verification:
  - Portal SSO and request-security suites passed valid login, wrong signature, wrong issuer, wrong audience, wrong app slug, expired and overlong tokens, missing token, external-domain email, clean redirect, protected-page redirect, API `401`, logout, cookie flags, public routes, loop prevention, CSRF/origin enforcement and production preflight validation.
  - The live PostgreSQL session test passed identity linking, safe baseline role mapping, session hashing, audit creation, session restoration and revocation against an isolated migrated database.
  - The compiled production browser smoke passed public careers/CV submission and authenticated Employee, Line Manager, HR, Accounts and Super Admin access using signed short-lived Portal tokens, with no preview-identity impersonation.
  - Final gates passed: Prettier, ESLint, TypeScript, 297 automated tests with 274 passed and 23 optional live-infrastructure suites skipped, production build and dependency audit with zero known vulnerabilities.
- External activation inputs:
  - The production origin is configured as `https://career.via-int.com`, with callback `https://career.via-int.com/auth/portal/callback` and dashboard `https://career.via-int.com/dashboard`.
  - Supply `PORTAL_SSO_SECRET` securely to both VIA Portal and VIA HR; it is intentionally absent from source control.
  - Register the exact production callback and app slug in VIA Portal, then complete the Contabo staging login/logout and role-scope UAT described in the release acceptance record.
