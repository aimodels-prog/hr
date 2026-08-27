# VIA HR System - Copy-and-Paste Implementation Playbook

## How to use this playbook

Use one implementation chat for the project if possible. Paste the **Operating instruction** once, then paste one numbered implementation prompt at a time. Do not paste several implementation steps together.

After each step:

1. Let the coding agent finish the implementation and verification.
2. Open and test the new page manually.
3. Ask the agent to fix any issue before continuing.
4. Continue only when the step's acceptance checklist passes.
5. Paste the next numbered prompt.

The prompts deliberately postpone Google Workspace authentication until the application is otherwise complete. During development, the app uses a clearly labelled role/person preview switcher. This switcher is not production authentication.

The source of truth for product rules is [PRODUCT_IMPLEMENTATION_PLAN.md](./PRODUCT_IMPLEMENTATION_PLAN.md). If a prompt conflicts with that plan, the more specific business rule in the product plan wins unless the user explicitly changes it.

---

## Operating instruction - paste this once before Step 01

```text
We are implementing VIA HR System incrementally in the existing repository.

Before every step:
- Read AGENTS.md, PRODUCT_IMPLEMENTATION_PLAN.md, IMPLEMENTATION_PROMPT_PLAYBOOK.md, and the existing code relevant to the step.
- Inspect the current working tree and preserve all completed work and unrelated user changes.
- Work only on the numbered step I provide. Do not begin later modules.
- Reuse the existing design system, components, layout, colours, logo, routing conventions, and TypeScript patterns.
- Make every page responsive, accessible, and consistent with the rest of VIA HR System.
- Use realistic VIA sample data, not lorem ipsum.
- Do not implement Google Workspace authentication yet. Use the development role/person preview context already created by the foundation steps.
- Do not add a backend yet. Use the shared versioned local repository layer for structured records and IndexedDB for file blobs.
- Components must not call localStorage directly.
- Enforce permissions in shared selectors/services as well as in the visible UI.
- Every material create, edit, submit, approval, rejection, override, correction, import, export, archive, and access-denied action must write an audit event through the shared audit service.
- Add validation, empty states, error states, confirmation dialogs, success feedback, and loading states where applicable.
- Do not leave primary actions as decorative buttons or fake success toasts. Persist their result and make it visible after refresh.
- Do not delete or weaken working features from previous steps.

At the end of every step:
- Run the available formatter, lint, typecheck, tests, and production build. If dependencies or environment limitations prevent a command, state that clearly.
- Test the new flow with every affected role.
- Summarise files changed, behaviour implemented, verification performed, and any remaining limitations.
- Update IMPLEMENTATION_PROGRESS.md with the step number, completion status, verification, and decisions made.
- Stop and wait for my next prompt.
```

---

# Stage A - Application foundation

## Step 01 - Create the implementation foundation and progress tracker

```text
Implement Step 01: VIA HR System application foundation.

Create IMPLEMENTATION_PROGRESS.md with a checklist for every step in IMPLEMENTATION_PROMPT_PLAYBOOK.md. Mark only Step 01 complete when it is genuinely complete.

Build a versioned browser data architecture:
- Define shared TypeScript types for BaseRecord, User, Role, Employee, Notification, AuditEvent, AppSettings, and FileMetadata.
- Give mutable records UUID IDs, createdAt, createdBy, updatedAt, updatedBy, archivedAt, and recordVersion fields where appropriate.
- Create repository interfaces and a central storage service. UI components must never access localStorage directly.
- Namespace all keys with via_hr and add schema versioning plus migration hooks.
- Add an IndexedDB file repository for uploads, with file ID, name, MIME type, size, checksum if practical, created date, and owner record.
- Add safe seed-data initialisation that runs only when storage is empty.
- Add backup export, restore validation/preview, and reset-demo-data service functions, but do not build their final settings UI yet.
- Create an audit service that records actor, active role, action, module, entity type/ID, old/new summaries, reason, and timestamp.
- Create a notification service with unread/read status and related-record links.
- Add unit tests for persistence, migration, archive behaviour, and audit creation if the project test setup supports them. If no test runner exists, add the lightest suitable test setup compatible with the repository.

Do not redesign existing pages in this step. Preserve the current recruitment demo while introducing the foundation alongside it.

Acceptance:
- Seeded data survives refresh.
- Reset restores a deterministic seed dataset.
- Invalid restore data is rejected without overwriting current data.
- A sample repository mutation creates an audit event.
- Existing routes still compile and render.
```

## Step 02 - Development identity, permissions, and role preview

```text
Implement Step 02: development identity context and permissions, without authentication.

Create a development-only current-user system that loads one seeded employee/user and supports switching between Employee, Line Manager, HR, Accounts, and Super Admin sample identities. Clearly label it "Development role preview" and ensure it can be removed when Google Workspace authentication is connected.

Implement:
- A current-user provider containing user ID, employee ID, assigned roles, active preview role, and permissions.
- A central permission catalogue and helpers such as can(), canViewEmployee(), canManageCandidate(), and canAccessPayroll().
- Record-scope selectors: Employee sees self; Line Manager sees self plus direct reports; HR sees authorised HR records; Accounts sees payroll/travel finance fields only; Super Admin sees all.
- Route guards and an access-denied page.
- Field-level redaction for salary, bank, passport, performance, recruitment notes, and payroll information.
- A development role/person switcher accessible from the app header.
- Seed users representing all five roles and several manager-report relationships.
- Audit access-denied events and development identity changes, but label preview switching as a development action.

Do not create a login page, usernames, passwords, Google OAuth buttons, or Workspace integration.

Acceptance:
- Each preview identity sees different navigation and data.
- Employee cannot access another employee by editing a URL.
- Line Manager sees only direct reports.
- HR cannot open payroll preparation.
- Accounts cannot see private HR/recruitment notes.
- Super Admin can access every current internal route.
```

## Step 03 - Complete responsive application shell and navigation

```text
Implement Step 03: the complete VIA HR System application shell.

Create role-aware navigation for:
- Dashboard
- Recruitment: Vacancies, Candidates, Contact Tracker, Recommendations, Interviews, Offers
- Employees: Directory, Employee Files, Document Expiry
- Leave
- Timesheets
- Attendance and Overtime
- Travel and Reimbursements
- Payroll Preparation
- Onboarding
- Offboarding
- Performance
- Training
- Reports
- Audit History
- Settings
- Public Careers Portal

Requirements:
- Keep the VIA logo and VIA HR System name.
- Support expanded/collapsed desktop sidebar and mobile drawer.
- Show breadcrumbs, page title area, notification button, current preview person/role, and user menu.
- Hide modules that the current role cannot access.
- Add placeholder route pages for future steps, clearly marked "Not implemented yet" instead of broken links.
- Add a reusable page header, filter bar, status badge system, data-table shell, empty state, and permission-denied state.
- Preserve the working public career pages and current recruitment pages.

Acceptance:
- No navigation link produces a 404.
- Navigation is usable on mobile and desktop.
- Switching preview roles immediately changes visible modules.
- Keyboard focus, labels, and contrast are usable.
```

## Step 04 - Organisation settings and master data

```text
Implement Step 04: Settings and Master Data pages for Super Admin.

Build tabs for Organisation, Departments, Locations, Projects, Cost Centres, Positions, Grades, Employment Types, Working Time, Public Holidays, Currencies, and Numbering.

Allow Super Admin to create, edit, archive, restore, search, and reorder master records. Prevent archiving a record that is actively required unless the user confirms and selects a replacement where necessary.

Organisation settings must include name, timezone, default currency, workweek, standard daily/weekly hours, leave year dates, employee-number format, candidate-reference format, and reminder thresholds.

Projects need code, name, client, type, location, start/end date, cost centre, manager, and active state. This supports the project data found in Candidates 2025.xlsx and future timesheets.

Add a Data Management tab for backup export, restore preview/confirmation, storage usage, and demo reset. Restrict it to Super Admin and audit every change/export/reset.

Acceptance:
- New master records appear immediately in relevant selectors.
- Archived records remain readable on historical records but cannot be selected for new transactions.
- Changes survive refresh and create audit events.
```

---

# Stage B - Employee records

## Step 05 - Employee directory page

```text
Implement Step 05: Employee Directory at /staff/employees.

Build a responsive employee table/card view with search, sorting, pagination, saved filter state, and filters for status, department, location, project, manager, employment type, and role.

Show employee number, name, position, department, location, line manager, start date, status, and document-risk indicator. Apply role scoping: Employee sees only their own shortcut/profile, Line Manager sees direct reports, HR sees all normal employee directory data, Accounts sees only payroll-relevant identity fields, and Super Admin sees all.

Add active, onboarding, probation, notice, inactive, and archived statuses. Include empty states and CSV export with role-safe columns.

Clicking a row must open the employee profile route. Add a Super Admin-only Create Employee action that links to the next step.

Acceptance:
- Filters and pagination work together.
- URL or stored view state preserves useful filters after navigation.
- Export never includes fields hidden from the active role.
```

## Step 06 - Create and manage employee records

```text
Implement Step 06: Create Employee and employment administration.

Build a multi-section form for Super Admin to create an employee with employee number, legal/preferred name, Workspace email placeholder, phone, department, position, grade, location, project, employment type, start date, probation end date, line manager, status, and internal roles.

Do not connect Google authentication. The Workspace email is only the future identity-mapping field.

Validate unique employee number and Workspace email, required master records, start/probation dates, active manager, and circular reporting lines. Save employee and internal user/access mapping records atomically through services.

Add edit flows for reporting line, position, department, project, grade, location, employment type, and status. Every employment change requires effective date and reason and must create an employment-history record rather than overwriting history silently.

Add activate, suspend app access, archive, and restore actions with confirmations. Do not permanently delete employees.

Acceptance:
- Created employee appears in the directory after refresh.
- Manager hierarchy validation prevents self-management and cycles.
- History shows old/new assignment, effective date, actor, and reason.
```

## Step 07 - Employee profile and self-service profile

```text
Implement Step 07: complete Employee Profile page.

Create tabs for Overview, Employment, Personal, Emergency Contacts, Dependants, Documents, Leave, Timesheets, Attendance/Overtime, Travel, Payroll Inputs, Performance, Training, Equipment, Onboarding/Offboarding, and Activity.

Build Overview and Personal/Employment tabs fully in this step; later modules will populate their own tabs. Overview should show identity, contact, position, manager, project, employment dates, quick status cards, upcoming tasks, and alerts.

Employees may edit only permitted self-service fields: preferred name, personal phone, address, emergency contacts, and dependant details. Sensitive or verified changes should create a Pending Verification request for HR rather than immediately replacing verified data.

HR can approve/reject profile changes with a reason. Super Admin manages employment fields. Apply redaction and role scoping.

Acceptance:
- Employee sees only their own profile.
- Manager sees direct-report operational information but not restricted fields.
- Pending changes display old/proposed values and approval status.
- Approved changes update the profile and audit history.
```

## Step 08 - Digital employee files and document versions

```text
Implement Step 08: Employee Documents and digital employee files.

Support document types including contract, passport, visa, national ID, work permit, driving licence, medical, education certificate, professional certificate, bank evidence, and other.

Build upload with document number, issue date, expiry date, issuing country/authority, notes, visibility classification, and file. Store file blobs through IndexedDB and metadata through repositories. Validate type, maximum size, required fields, and date order.

Employee uploads become Pending Verification. HR can verify or reject with a required reason. Replacing a document creates a new version and archives the prior version. Provide secure-looking preview/download controls respecting permissions, missing-document states, and a full version timeline.

Statuses: Missing, Pending Verification, Valid, Expiring, Expired, Rejected, Replaced.

Acceptance:
- Uploaded files and metadata survive refresh.
- Replacing a document retains the previous version.
- Restricted documents are not exposed to unauthorised roles or exports.
```

## Step 09 - Document expiry centre and reminders

```text
Implement Step 09: Document Expiry Centre.

Create /staff/document-expiry for HR and Super Admin with KPI cards and a filterable table grouped by Expired, 1-7 days, 8-30 days, 31-60 days, 61-90 days, and Valid. Include employee, document type, number redaction, expiry date, days remaining, manager, location, owner, and reminder status.

Implement a deterministic reminder engine that creates notifications at configured thresholds without duplicates. Notify employee and HR; notify the manager only for operationally relevant document types. Critical expired passport, visa, work permit, national ID, contract, licence, or mandatory certificate should show escalation.

Allow HR to assign follow-up owner, record contact/action, snooze with reason, and resolve only when a replacement is verified or an authorised waiver is recorded.

Acceptance:
- Status changes automatically based on the current date.
- Running reminder checks twice does not duplicate notifications.
- Employee dashboard shows only their own expiry warnings.
```

---

# Stage C - Recruitment

## Step 10 - Vacancy list and vacancy lifecycle

```text
Implement Step 10: Vacancies management page and lifecycle.

Create /staff/vacancies with list/table views, search, filters, applicant totals, hiring manager, project, target start, owner, and status. Support Draft, Pending Approval, Open, Paused, Closed, and Archived.

Add vacancy detail with Overview, Job Description, Requirements, Applications, Shortlist, Interviews, Offer, Activity, and Versions tabs. Implement pause, reopen, close, duplicate, and archive actions with confirmations and audit reasons.

Preserve the existing sample vacancies by migrating them into the repository seed. Existing public job URLs must continue to work.

Acceptance:
- Status transitions follow valid paths.
- Public portal displays only Open vacancies.
- Closed/archived vacancies retain historical applications.
```

## Step 11 - Vacancy creation and AI-draft UI

```text
Implement Step 11: complete New Vacancy flow.

Build sections for business request, role facts, requirements, compensation visibility, screening questions, job-description editor, preview, approval, and publication.

Fields must include title, department, project, location, employment type, headcount, target date, salary range with visibility setting, hiring manager, HR owner, hiring reason, education, minimum experience, required/preferred skills, certifications, languages, responsibilities, and notes.

Keep AI drafting as a provider interface. For local implementation, use a clearly labelled simulated provider that generates a deterministic editable draft from entered facts; do not fake a real network AI integration. Never invent requirements not supplied by HR. Show generated sections, review status, and version comparison.

Implement save draft, validate, preview public listing, submit/approve if configured, and publish. Persist all actions.

Acceptance:
- Refresh does not lose draft work.
- Published output reflects HR edits, not hidden template text.
- Each published edit creates a job-description version.
```

## Step 12 - Public careers portal refresh

```text
Implement Step 12: connect and complete the public careers portal.

Use repository vacancies rather than hard-coded arrays. Build search and filters for keyword, department, location, project, and employment type. Show open-role count, clear-filters action, meaningful empty state, accessible cards, and responsive layout.

Vacancy detail must show summary, responsibilities, minimum/preferred requirements, location, employment type, and closing information. Do not expose internal scoring, salary when hidden, approvers, or HR notes.

Preserve VIA branding, useful page metadata, 404 behaviour for invalid/closed roles, and links back to all vacancies.

Acceptance:
- Publishing/pausing a vacancy immediately changes the public portal.
- Filters work in combination.
- No internal fields leak into page content or metadata.
```

## Step 13 - Public candidate application flow

```text
Implement Step 13: real local public application flow.

Replace the current toast-only form with persisted candidate and application records. Collect full name, email, phone, nationality if required, location, current company/title, years of experience, notice period, salary expectation if enabled, CV, cover note, screening answers, and privacy consent.

Validate required fields, email/phone format, file type/size, consent, and vacancy state. Check exact duplicate email/phone and show a safe message without exposing existing private data. Link to an existing candidate where appropriate and create a separate application for the vacancy.

Generate a human-readable application reference and confirmation page. Save source as Career Portal and notify the HR owner. Do not build a candidate login.

Acceptance:
- Submission survives refresh and appears in the vacancy Applications tab.
- CV is retrievable through the candidate record.
- Duplicate application rules prevent accidental repeated submissions.
```

## Step 14 - Candidate database and profile

```text
Implement Step 14: Candidate Database and Candidate Profile.

Create /staff/candidates with filters for name, position, project, source, stage, location, nationality, visa, experience, score range, last contact, follow-up status, HR owner, and recommender. Provide safe CSV export.

Candidate profile tabs: Overview, Applications, CV/Documents, Contact History, Recommendations, AI Scores, Interviews, Offers, and Activity. Show canonical details and original source values. Support edit, archive, merge-review entry point, do-not-contact, and owner assignment.

Stages: Sourced, Applied, Screened, Shortlisted, Interview, Offer, Hired, On Hold, Not Selected, Withdrawn, Archived. Candidate stage and per-vacancy application stage must not be confused.

Acceptance:
- One candidate can have applications to multiple vacancies.
- Source history and original imports remain visible.
- Do-not-contact is prominent and enforced by contact actions.
```

## Step 15 - Candidate spreadsheet import wizard

```text
Implement Step 15: XLSX/CSV candidate import wizard using Candidates 2025.xlsx as the reference structure.

Add a suitable client-side spreadsheet parser. Build steps: Select File, Select Sheets, Detect Headers, Map Columns, Preview, Duplicate Review, Import, Results.

Support mappings for Shortlisted, Status, Project, Type, Position, Name, Company, Experience, Nationality, Location, Visa, Marital Status, Notice, Current Salary, Expected/Accepted Salary, Last Contacted, Interview, Remarks, Contact, and Email. Handle different headers across sheets. Preserve original cell values plus file/sheet/row provenance.

Normalize whitespace, phone, date, currency, and experience where safe. Never silently guess uncertain values. Duplicate rules: exact normalized email, exact phone, and possible name/company matches. Let HR Merge, Skip, or Create Separate.

Create an import report with totals, warnings, rejected rows, and downloadable errors. Audit batch and merges.

Acceptance:
- The supplied workbook can be previewed without changing data.
- Importing selected sheets creates searchable candidates.
- Re-import identifies duplicates instead of blindly duplicating records.
```

## Step 16 - Candidate contact tracker

```text
Implement Step 16: shared Candidate Contact Tracker.

Create a queue page showing due today, overdue, upcoming, recently contacted, never contacted, and do-not-contact candidates. Include vacancy, HR owner, last contact, outcome, next follow-up, phone/email, and duplicate-contact warning.

Build Add Contact with channel, date/time, contacted by, related vacancy, outcome, notes, and next follow-up. Outcomes: No Answer, Interested, Not Interested, Follow-up Required, Interview Arranged, Unavailable, Invalid Contact, Do Not Contact.

Before contact, show the most recent history and block Do Not Contact. Warn when another HR user has a pending follow-up or recent contact. Save append-only events; do not overwrite history. Add owner reassignment and follow-up notifications.

Acceptance:
- Two HR users see the same persisted history.
- Candidate last-contact fields derive from contact events.
- Overdue follow-ups appear on HR dashboard/notifications.
```

## Step 17 - Recommendations and recruitment sources

```text
Implement Step 17: Recommendations and Sources module.

Create recommendation records linked to a candidate and optionally a vacancy. Capture recommender type, name, company, position, phone, email, relationship, date, notes, HR owner, commercial terms with restricted visibility, and source outcome.

Allow adding a recommended new candidate or attaching a recommendation to an existing candidate. Run normal duplicate review. Clearly mark referrals but do not automatically shortlist or inflate scores.

Build recommender profile/history showing candidates introduced, stages, hires, probation outcomes, retention, and later performance summaries. Keep reporting factual and include warnings that one outcome does not establish recommender quality.

Acceptance:
- HR can identify exactly who recommended a candidate and how to contact them.
- Accounts-only commercial fields are not exposed to normal HR users unless explicitly permitted.
- Hired candidate outcomes remain linked to the original source.
```

## Step 18 - Candidate scanning and explainable scoring

```text
Implement Step 18: vacancy-specific candidate scanning and explainable scoring.

Replace hard-coded ranking with a deterministic local scoring service based on vacancy requirements and structured candidate data. Keep a provider interface for future real AI. Scan eligible candidates from applications, imports, uploads, and referrals.

Use configurable weighted categories from the product plan. Store overall/category scores, evidence, missing data, strengths, risks, model/rules version, vacancy-description version, and timestamp. Never present missing or inferred information as confirmed.

Show the ranked top ten by default, source coverage, score breakdown, why each person ranks there, watch-outs, and an explanation drawer. Add rescan with confirmation and preserve previous score runs.

Acceptance:
- Scores respond predictably to candidate/vacancy data.
- Old score runs remain explainable after requirements change.
- Referral source alone does not increase score.
```

## Step 19 - Shortlist selection and HR overrides

```text
Implement Step 19: shortlist workflow.

Let HR choose shortlist size from 1 to 10, pre-select top N, then add/remove any candidate manually. Show eligibility, duplicate, contact, consent, salary, notice, visa, availability, and missing-data warnings.

Require an override reason when HR excludes a configured top result, adds a low-scoring candidate, or advances a manually added candidate without a completed score. Confirming updates application stages and saves a shortlist decision snapshot containing ranked results, selected IDs, actor, date, and override reasons.

Unselected candidates must become On Hold or Not Selected according to HR choice; never delete them. Communication remains prepared/draft unless HR explicitly confirms sending in a future integration.

Acceptance:
- Selection persists after refresh.
- Audit shows system recommendation versus human choice.
- Manual recommendations can join the same process transparently.
```

## Step 20 - Interview scheduling

```text
Implement Step 20: Interview Scheduling page.

For shortlisted candidates, create interview stages with stage name, duration, required panel, date range, timezone, location/video method, and notes. Use a scheduling-provider interface. Implement a deterministic local availability simulator now; leave real Google Calendar integration for a future integration step.

Support Proposed, Awaiting Candidate, Scheduled, Completed, Cancelled, and No Show states. Let HR propose, confirm, reschedule, cancel, and record candidate response. Preserve event history. Show panel conflicts and candidate timezone.

Do not claim that a real Calendar event or Meet link was created. Label simulated availability clearly.

Acceptance:
- Interview records persist and appear on vacancy/candidate views.
- Rescheduling keeps prior slot history.
- Only authorised HR can confirm or cancel interviews.
```

## Step 21 - Interview scorecards

```text
Implement Step 21: structured Interview Scorecards.

Create reusable interview templates and criteria. For each scheduled/completed interview, assign required panel members. Score criteria 1-5, require evidence notes where configured, capture overall recommendation Strong Yes/Yes/Unsure/No, and allow draft then submit.

Support independent scoring: submitted panel scores remain hidden from other panel members until they submit, if enabled. Submitted scorecards become read-only. Corrections require HR/Super Admin reopening with a reason and must preserve the original values.

Calculate averages, completion status, and disagreement indicators. Do not allow HR to mark the interview fully completed until required scorecards exist or a waiver is recorded.

Acceptance:
- Scores persist and recalculate correctly.
- A panel member can access only assigned scorecards.
- Corrections are traceable in audit history.
```

## Step 22 - Hiring decision and offers

```text
Implement Step 22: Hiring Decision and Offer workflow.

Build a decision view combining the configured candidate score and interview result. Show calculation, evidence, risks, missing scorecards, compensation, availability, references, and panel recommendations.

System recommends the highest eligible candidate. HR can select someone else but must enter an override reason. Save the system recommendation and human decision separately.

Build offer creation with template, position, grade, salary, allowances, benefits, start date, probation, location, conditions, internal approval status, sent date, response deadline, and outcome. Sensitive compensation must follow permissions.

Offer states: Draft, Pending Approval, Approved, Ready to Send, Sent, Accepted, Declined, Expired, Withdrawn. Accepted creates a draft onboarding case; declined requires a reason.

Acceptance:
- Decision is blocked when required interview data is missing unless an authorised waiver is recorded.
- HR override is visible in audit.
- Accepted offer can start candidate-to-employee conversion.
```

---

# Stage D - Leave and time management

## Step 23 - Leave policies and balance ledger

```text
Implement Step 23: Leave Policies and employee leave balances.

Build HR/Super Admin policy settings for leave year, leave types, paid/unpaid, entitlement, accrual, carry-forward, workdays, public holidays, negative-balance rule, attachment requirements, and approval chain.

Implement a transaction-ledger balance model rather than one editable number. Transactions include entitlement, carry-forward, accrual, approved leave, cancellation restoration, expiry, and manual adjustment. Manual adjustments require reason and permission.

Display to every employee: entitlement, carried forward, accrued, adjustments, taken, approved future, pending, available, projected if pending is approved, and a ledger explanation.

Seed realistic balances for every sample employee.

Acceptance:
- Balance totals reconcile exactly to ledger transactions.
- Employee sees only their own balance.
- HR/Super Admin can report balances without editing calculated totals directly.
```

## Step 24 - Employee annual-leave request and automatic refusal

```text
Implement Step 24: employee Leave Request flow.

Create My Leave with prominent balance cards, upcoming leave, request history, status timeline, and Request Leave action. Form fields: leave type, start/end, partial day when allowed, reason, handover contact, and attachment when required.

Calculate duration using configured working days/holidays. Check overlap, balance, employment dates, date order, and attachments.

Enforce annual-leave rules exactly:
- More than 5 requested working days requires at least 60 calendar days between submission and start date.
- 5 working days or fewer requires at least 14 calendar days.
- Outside the rule, save as Automatically Refused, show the exact requested days, notice days, required notice, and reason; notify employee and audit it; do not send it to approvers.

Valid requests show balance impact and approval chain before confirmation, then become Pending Line Manager.

Acceptance:
- Test 5 days at 13/14 days and 6 days at 59/60 days.
- Automatically refused requests never appear as approvable.
- Approved-future and projected balances are explained correctly.
```

## Step 25 - Leave manager and Super Admin approvals

```text
Implement Step 25: Leave Approval workflow.

Line Manager queue must include only direct reports. Show request, balance, team calendar, overlap warnings, handover, attachments, and rule calculation. Manager approves or rejects; rejection requires a reason. Approval moves to Pending Super Admin.

Super Admin final queue shows the employee request and manager decision. Approval reserves balance and adds the absence to calendars/attendance expectations. Rejection requires a reason and does not reduce balance.

Implement notifications, status timeline, audit history, and separation-of-duty handling when an approver is also the requester. Configure an alternate approver rather than allowing self-approval.

Acceptance:
- State flow is Employee -> Line Manager -> Super Admin.
- Manager cannot see or approve unrelated employees.
- Only final approval changes official leave reservation.
```

## Step 26 - Leave administration, cancellation, and calendar

```text
Implement Step 26: Leave Administration and Team Calendar.

Build HR/Super Admin leave list with filters, balance warnings, pending stages, automatically refused requests, absence calendar, department/team views, and export.

Implement employee withdrawal of pending requests. Approved-leave cancellation becomes Cancellation Pending and follows configured approval. On approved cancellation, restore balance through a ledger transaction. Past taken leave cannot be deleted; HR/Super Admin creates a correction with reason.

Add leave Taken transition based on dates, carry-forward expiry handling, manager delegation, and audit-friendly policy snapshot on every request.

Acceptance:
- Cancellation restores exactly the reserved amount.
- Historical calculations do not change when current policy changes.
- Calendar respects role scope and does not expose private leave reasons unnecessarily.
```

## Step 27 - Timesheet setup and project/activity controls

```text
Implement Step 27: Timesheet configuration.

Build settings for weekly periods, standard hours, submission deadline, active projects, cost centres, activity codes, location codes, overtime thresholds, copy-previous-week permission, and payroll lock behaviour.

Create timesheet periods automatically across the configured date range. Add states Draft, Pending Manager, Returned, Approved, Payroll Locked, and Corrected. Ensure archived projects remain on history but cannot receive new time.

Create monitoring page for HR showing expected, draft, submitted, late, returned, approved, and locked counts without granting HR approval power unless the user is also the line manager.

Acceptance:
- Period and expected-hour generation respects workweek and holidays.
- Master-data changes appear in employee entry selectors.
```

## Step 28 - Employee weekly timesheet page

```text
Implement Step 28: Employee Weekly Timesheet.

Build a weekly grid suitable for desktop and a day-card view for mobile. Allow multiple entries per day with project, cost centre, activity, regular hours or start/end time, work location, and notes. Pre-fill public holidays and approved leave. Support save draft and copy prior week.

Validate no overlap, negative/excessive time, inactive project, work on full-day approved leave, duplicate rows, or missing required notes. Warn about differences from expected hours and attendance without silently changing data. Show daily/weekly totals by regular, leave, training, and overtime.

Employee certifies accuracy and submits; submission locks editing and notifies manager.

Acceptance:
- Draft survives refresh.
- Totals are mathematically correct.
- Employee cannot edit another person's sheet or an approved/locked sheet.
```

## Step 29 - Manager timesheet approval and corrections

```text
Implement Step 29: Manager Timesheet Review.

Create manager queue for direct reports with missing, late, submitted, returned, and approved filters. Detail view compares expected hours, timesheet entries, approved leave, attendance data if available, and overtime.

Manager approves the whole period or returns it with a required reason. Returned timesheet unlocks for the employee and retains submission history. Approved sheet is locked from employee edits and becomes available to reporting/payroll.

Before payroll lock, authorised reopening requires a reason. After payroll lock, create a correction record and preserve the original; route adjustment to the configured open period.

Acceptance:
- Manager sees only direct reports.
- Every submit/return/resubmit/approve/reopen/correct event is audited.
- Approved totals feed project reporting without duplication.
```

## Step 30 - Attendance records and correction requests

```text
Implement Step 30: Attendance module.

Build HR attendance import/manual-entry UI for date, employee, shift, clock-in/out, break, location, and source. Calculate worked hours, lateness, early departure, absence, and missing punch. Reconcile approved leave and holidays.

Employee view shows own daily/monthly attendance and permits a correction request with explanation and evidence. Line Manager reviews direct-report corrections; HR finalises policy-sensitive changes where configured.

Statuses: Present, Absent, On Leave, Holiday, Rest Day, Late, Missing Punch, Correction Pending, Corrected.

Add filters, monthly summary, exception queue, and export. Do not treat timesheet hours as attendance punches.

Acceptance:
- Leave dates display as On Leave rather than absence.
- Corrections preserve original values and approvals.
```

## Step 30A - Geofenced location-based attendance clock-in

```text
Implement Step 30A: Geofenced clock-in. This extends the Locations master data (Step 04) and the Attendance module (Step 30) with mandatory location verification for employee self-service clock-in/out.

Locations master data (Settings > Master Data > Locations):
- Add fields to the Location record: latitude, longitude, radiusMeters, isClockInSite (boolean).
- Add a "Set on map" control to the Location create/edit form using Leaflet with OpenStreetMap tiles (no API key or billing account required): address search via the free Nominatim geocoding API, a draggable pin, and a circle overlay that resizes live as the radius (meters) input changes, so HR can see exactly what area is covered.
- Radius must support small precise zones and large ones (e.g. up to 1000+ metres) so a single large office building/floor can be fully covered by one location.
- Multiple locations can be active clock-in sites simultaneously (HQ, Site A, Site B, Warehouse, client sites, etc.). There is no "assigned location per employee" — any active, isClockInSite=true location qualifies. An employee visiting a site for supervision can clock in there if physically present, without HR pre-assigning them to it.
- Only users with system:settings_manage (HR/Super Admin) can create, edit, or archive locations and their geofence.

Attendance data model:
- Add locationId (FK to the matched Location), capturedLatitude, capturedLongitude, and capturedAccuracyMeters to the attendance record, populated only for Web-source clock-ins/outs that passed geofence validation. Keep the existing free-text location field as a display fallback for non-geofenced sources.

Employee clock-in/out flow (My Attendance, Web source only):
- On Clock In and Clock Out, request the browser Geolocation API. Reject readings with accuracy worse than 100 metres and prompt the employee to move outdoors or near a window and retry, rather than accepting a low-confidence position.
- Compute distance (Haversine formula) from the captured coordinate to every active, clock-in-enabled location. If the employee is within at least one location's radius, allow the action and record which location matched.
- If the employee is not within any active location's radius, hard-block the clock-in/out. No manual override or bypass exists in the employee UI. Show the nearest valid location's name and how far short the employee currently is (e.g. "You are 340m from Site A — move within 150m to clock in").
- If geolocation permission is denied or unavailable, block the action with clear instructions to enable location services. Never allow a clock-in/out without a valid, sufficiently accurate position.
- Hardware Terminal, Manual Entry (HR-entered), and Import attendance sources are explicitly exempt from this rule — it applies only to Web self-service clock-in/out.

Audit and correction path:
- Log every blocked attempt as an audit event, including the attempted coordinates and the nearest location/distance, so HR can spot miscalibrated radii or genuine policy issues.
- The only way to record an out-of-geofence attendance after the fact is the existing HR/Line Manager attendance-correction workflow from Step 30 (explanation, evidence, approval) — this is a retroactive correction, never a live bypass.

Setup prerequisite: none beyond adding the `leaflet` package — OpenStreetMap tiles and Nominatim search require no API key or billing account. The browser Geolocation API requires HTTPS in production (localhost is exempt for local development).

Acceptance:
- HR can create a Location, place it precisely with the map picker, and set a radius that visibly covers a large office floor.
- An employee physically outside every active location's radius cannot clock in or out; the block message names the nearest valid location and the missing distance.
- An employee physically inside any one active location's radius can clock in there even if it isn't a location they're normally based at, and the resulting attendance record stores which location matched plus the captured coordinates/accuracy.
- Hardware Terminal, Manual Entry, and Import attendance sources are unaffected.
- Every blocked geofence attempt is captured in the audit log with coordinates and nearest-location distance.
```

## Step 31 - Overtime requests and approval

```text
Implement Step 31: Overtime workflow.

Employee or manager records overtime date, start/end or total hours, project, reason, and evidence. Compare with attendance and timesheet entries. Prevent overlapping or duplicate claims and require explanation above configured thresholds.

Line Manager approves or rejects with reason. Add optional HR verification controlled by settings. Approved hours create a payroll input reference but not a salary amount unless Accounts configures a rate externally.

Provide Employee history, Manager queue, HR exception monitoring, and Accounts approved-overtime view. Corrections after approval must be separate audited records.

Acceptance:
- Only approved overtime reaches payroll preparation.
- Cross-module discrepancies are warnings requiring resolution, not silent recalculations.
```

---

# Stage E - Travel and payroll

## Step 32 - Employee travel pre-authorisation request

```text
Implement Step 32: Travel Pre-authorisation Request.

Employee enters purpose, destination, travel dates, project/cost centre, transport estimate, accommodation estimate, per diem, other costs, currency, notes, and supporting documents. Calculate total estimate and validate dates, overlap, active project, required fields, and attachment policy.

Show both required approvals before submission. Submission status becomes Pending HR and Accounts and creates two independent approval tasks. Employee can withdraw only before any approval unless policy says otherwise.

Build My Travel list/detail with status, approval timeline, estimate, actual placeholder, and next action.

Acceptance:
- Submitted request appears simultaneously in HR and Accounts queues.
- Employee sees only own travel records.
- Submission snapshot preserves the original estimate.
```

## Step 33 - HR and Accounts travel approvals

```text
Implement Step 33: dual Travel Approval workflow.

Build HR queue for policy, purpose, dates, employee readiness, and document checks. Build Accounts queue for budget, cost centre, estimate, currency, and finance policy. Each role approves or rejects independently; rejection requires reason and ends the request.

Approvals may happen in either order. The system computes Pre-authorised only after both HR Approved and Accounts Approved exist. One approval alone must never show Pre-authorised.

Show each approver, time, decision, comments, and locked approved-budget snapshot. Notify all relevant parties after decisions.

Acceptance:
- Test HR-first and Accounts-first sequences.
- Test rejection before and after the other role approves.
- An actor without the correct role cannot record that approval.
```

## Step 34 - Post-trip expenses and Super Admin closure

```text
Implement Step 34: Travel Reimbursement after trip.

Disable expense submission until the calendar day after the recorded trip end date and only for Pre-authorised travel. Employee adds expense lines with category, bill amount, currency, exchange-rate reference if needed, invoice/bill reference, date, notes, and receipt attachment.

Compare actual total with authorised estimate and show category/total variance. Require explanation over the configured variance threshold. Employee submits to Pending Super Admin Closure.

Super Admin reviews approvals, dates, receipts, references, totals, and variance, then selects Close or Reject. Rejection requires reason. Closed reimbursement creates an Accounts/payroll input reference.

Acceptance:
- Early expense submission is impossible.
- Both original estimate and final actual remain visible.
- Only Super Admin can close/reject final reimbursement.
```

## Step 35 - Payroll preparation and restricted access

```text
Implement Step 35: Payroll Input Preparation.

Restrict all routes, records, amounts, and exports to Accounts and Super Admin. Build payroll periods with start/end, cutoff, payment date, and states Draft, Collecting Inputs, Exceptions, Prepared, Approved, Locked, Exported, Corrected.

Collect approved overtime, unpaid leave/absence, approved allowances/deductions, closed reimbursements, joiners/leavers, timesheet status, and manual adjustments. Manual entries require type, amount, currency, reason, employee, and evidence.

Build an exception workbench for missing timesheets, attendance conflicts, pending leave, duplicate inputs, missing bank data, invalid currency, extreme values, and records outside the period. Require resolution or documented acknowledgement.

Support prepare, Super Admin approve if enabled, lock, role-safe CSV export, and post-lock correction. This is input preparation only—do not implement salary calculation or bank payment.

Acceptance:
- HR and Employee cannot access payroll via navigation or direct URL.
- Source records are linked and not duplicated across recalculation.
- Every view/export/edit/lock is audited.
```

---

# Stage F - Employee lifecycle and development

## Step 36 - Candidate-to-employee conversion

```text
Implement Step 36: convert an accepted candidate into an employee.

From an Accepted offer, build a review screen showing candidate data, verified/unverified status, offer facts, duplicate employee check, and fields needed for employee creation. HR must verify rather than blindly copying CV/import data.

Assign employee number, department, position, grade, location, project, manager, employment type, start date, and probation end. Keep the future Workspace email mapping field but do not authenticate it yet.

Create employee, employment history, onboarding case, document checklist, and candidate/offer links as one logical operation. Prevent conversion twice.

Acceptance:
- Employee profile links back to candidate, application, interviews, decision, and offer.
- Candidate stage becomes Hired without deleting recruitment history.
```

## Step 37 - Onboarding templates and case workflow

```text
Implement Step 37: Onboarding.

Create template management by country/entity, department, role, and employment type. Tasks need group, owner role/person, due-date offset, dependency, mandatory flag, evidence requirement, and instructions.

Build onboarding case dashboard and detail with groups for personal/legal documents, contract/payroll, visa/work permit/ID, IT/equipment, access, HSE/induction, department introduction, manager plan, and probation goals.

Assign tasks to Employee, HR, Accounts, Line Manager, Super Admin, and optional external/IT placeholder. Calculate due dates from start date. Enforce dependencies, show completion percentage, overdue/blocking tasks, waivers with reason, and start-date readiness.

Add day 1, week 1, day 30, day 60, and day 90 checkpoints. Complete only when mandatory tasks are done or waived by an authorised user.

Acceptance:
- Each role sees only assigned/relevant tasks and permitted fields.
- Completion percentage and blockers recalculate correctly.
```

## Step 38 - Offboarding and clearance

```text
Implement Step 38: Offboarding.

HR starts a case for resignation, termination, contract end, retirement, transfer, or other. Capture notice date, last working date, reason category, confidential notes, and rehire eligibility.

Build template-driven tasks for manager handover, project reassignment, assets, access removal, visa/work permit cancellation, leave/attendance reconciliation, expenses/advances, final payroll input, exit interview, and service documents.

Track owners, due dates, dependencies, evidence, overdue items, blockers, and waivers. Accounts confirms financial clearance; HR confirms legal/document closure; Super Admin finalises and sets employee inactive. Keep Workspace account closure as an external future integration action.

Acceptance:
- Inactive employee loses app permission in development context but history remains.
- Final closure is blocked by mandatory tasks unless authorised waiver is recorded.
```

## Step 39 - Performance review cycles

```text
Implement Step 39: Performance Reviews.

HR creates templates with competencies, goals, weights, rating scale, evidence prompts, and visibility. Create review cycles with population, self-assessment dates, manager dates, discussion/acknowledgement dates, and moderation settings.

Employee completes and submits self-assessment. Line Manager completes manager ratings and comments for direct reports. HR monitors and moderates only where configured. Record review discussion and employee acknowledgement; acknowledgement must not imply agreement.

Lock completed reviews. Corrections require HR/Super Admin reason and preserve original values. Restrict sensitive content from Accounts and unrelated managers.

Acceptance:
- Weighted rating calculation is validated.
- Employee and manager workflows have clear pending/complete states.
- Recruitment source reports use only high-level authorised outcome data, not private review text.
```

## Step 40 - Training catalogue and employee records

```text
Implement Step 40: Training.

Build course catalogue with provider, category, delivery type, duration, cost, currency, validity, renewal interval, required roles/locations/projects, and active state.

Support HR/manager assignment and employee training requests. Add approval when cost is involved. Track enrolment, schedule, attendance, completion, result, cost, certificate upload, and HR verification.

Create mandatory-training matrix, overdue view, employee training history, and certification-expiry reminders integrated with document expiry. Archived courses remain on history.

Acceptance:
- Required training is assigned to eligible employees without duplicates.
- Completion evidence and certificate permissions work.
- Expiring certifications generate one reminder per threshold.
```

---

# Stage G - Operations, reporting, and completion

## Step 41 - Notification centre and task inbox

```text
Implement Step 41: global Notifications and My Tasks.

Build notification drawer/page with unread, read, priority, module, due date, and deep links. Build task inbox showing approvals, follow-ups, scorecards, onboarding/offboarding tasks, timesheets, document actions, reviews, training, payroll exceptions, and travel actions relevant to the current user.

Implement deterministic trigger deduplication, reminder thresholds, overdue state, escalation to appropriate manager/module owner, mark read/unread, dismiss where permitted, and bulk read.

Do not add email or external push yet. Notifications remain in-app until later integrations.

Acceptance:
- Counts update immediately after completing linked work.
- User never receives tasks they lack permission to complete.
- Running scheduled checks repeatedly does not create duplicates.
```

## Step 42 - Audit history and record activity timelines

```text
Implement Step 42: Audit History UI.

Create global /staff/audit for Super Admin with filters for actor, role, module, action, entity, employee/candidate, date, and risk level. Show timestamp, action, record, reason, and safe old/new value comparison. Add CSV export with confirmation and audit the export itself.

Add filtered Activity tabs to employee, candidate, vacancy, leave, timesheet, travel, payroll, onboarding, offboarding, performance, and training records.

Audit events must be append-only in normal UI. Add integrity checks that flag malformed or missing event links. Redact sensitive old/new values based on current viewer permissions.

Acceptance:
- Trace one complete leave approval and one hiring decision from start to finish.
- Normal users cannot edit/delete audit events.
- Restricted values remain redacted even inside audit details.
```

## Step 43 - Role-specific dashboards

```text
Implement Step 43: final role-specific dashboards.

Employee: leave available/projected, upcoming leave, current timesheet, attendance exceptions, overtime, travel, expiring documents, onboarding/review/training tasks.

Line Manager: direct reports, leave approvals/team calendar, missing timesheets, attendance/overtime exceptions, onboarding/offboarding tasks, reviews, training.

HR: headcount/joiners/leavers, recruitment funnel, contacts due, interviews/offers, onboarding, document expiry, leave, timesheet completion, performance/training.

Accounts: travel approvals, reimbursements, payroll periods, payroll exceptions, approved overtime and unpaid leave.

Super Admin: final leave approvals, reimbursement closures, payroll approvals, access warnings, critical expiries, overdue workflows, and audit alerts.

Use repository-derived totals, not hard-coded numbers. Every card links to a correctly filtered operational page.

Acceptance:
- Totals reconcile with source lists.
- Switching roles changes dashboard without leaking data.
- Empty states remain useful for new installations.
```

## Step 44 - Reports and role-safe exports

```text
Implement Step 44: Reports Centre.

Create reports specified in PRODUCT_IMPLEMENTATION_PLAN.md for recruitment, contact activity, source/recommender outcomes, headcount, leave, timesheets/project hours, attendance, overtime, travel variance, reimbursements, documents, onboarding/offboarding, performance, training, and payroll inputs.

Support date range, department, project, location, manager, status, and other relevant filters; saved views; summary cards; suitable tables/charts; print layout; and CSV export. Only use a chart when it improves understanding.

Apply field/row permissions before calculating totals and before export. Payroll reports remain Accounts/Super Admin only. Audit every export containing personal information.

Acceptance:
- Report totals can be traced to underlying records.
- Filter combinations are consistent.
- No export includes hidden fields or out-of-scope employees.
```

---

**Superseded:** the stabilization steps that were drafted here have been replaced by a more precise, evidence-grounded version in [IMPLEMENTATION_PROMPT_PLAYBOOK_V2.md](./IMPLEMENTATION_PROMPT_PLAYBOOK_V2.md), which covers Steps 01-45 against the current state of the codebase (not just the routing bug this stage originally targeted, but foundational service/repository API drift, an employee display-name bug spanning ~14 files, and several other defects found on closer inspection). Use that file for Steps 01-45; come back to this file only for Steps 46-48, which are unchanged.

---

## Step 45 - Full application quality and completion pass

```text
Implement Step 45: full VIA HR System quality, consistency, and completion pass. Do not add authentication yet.

Audit every route, navigation link, button, form, dialog, table, filter, export, state transition, notification, audit event, and role boundary against PRODUCT_IMPLEMENTATION_PLAN.md and IMPLEMENTATION_PROMPT_PLAYBOOK.md.

Remove remaining hard-coded operational state and fake success-only actions. Fix broken links, placeholder routes, inconsistent labels, encoding problems, missing responsive states, accessibility issues, invalid calculations, duplicate records, stale dashboard totals, and storage migration problems.

Add/complete automated tests for:
- Role and record-scope permissions.
- Leave 5-day/6-day notice boundaries.
- Leave balance ledger and cancellation.
- Dual travel approvals.
- Post-trip date gating.
- Timesheet validation/approval/lock/correction.
- Payroll restriction and deduplication.
- Candidate duplicate import and scoring snapshots.
- Audit creation/redaction.
- Backup/restore migrations.

Run complete build and test suite. Produce a module-by-module acceptance report and list only genuine external-integration limitations.

Acceptance:
- No unfinished placeholder remains except explicitly deferred external integrations and authentication.
- All planned local workflows can be completed and persist after refresh.
- Every role passes its end-to-end scenario.
```

---

# Stage H - Deferred integrations

## Step 46 - Google Workspace portal authentication - do this last

```text
Implement Step 46 only after the rest of VIA HR System is accepted: integrate the existing Google Workspace-authenticated portal.

First inspect and document how the existing portal passes authenticated identity to this app. Do not invent an unsafe handoff. Require a server-validated session, signed token, or approved shared authentication mechanism. Confirm allowed Workspace domains and the stable identity claim.

Replace the development role/person preview with the verified portal identity in production. Match stable Google account ID and primary Workspace email to the internal workspaceIdentityMapping and employee record. Load internal roles, manager relationship, account status, and permissions. Do not store Google tokens in localStorage.

Flows:
- Valid mapped active user enters without a second login.
- Valid but unmapped Workspace user sees Access Not Configured.
- Suspended/inactive internal user is denied.
- Portal session expiry/sign-out clears app state and returns to the portal.
- Super Admin can map/relink verified Workspace identities but cannot manage Google passwords.

Keep the development preview available only behind an explicit non-production development flag. Add security tests for token/session validation, mapping, revoked access, direct URL access, and role scope.

Stop and request the actual portal integration contract if it cannot be discovered safely from the repository. Do not simulate completion of real authentication.
```

## Step 47 - External AI, email, and Google Calendar integrations

```text
Implement Step 47 only when approved credentials, APIs, privacy rules, and integration requirements are available.

Replace provider interfaces one at a time:
1. AI job-description drafting with structured output, prompt/version logging, human review, privacy controls, error handling, and no automatic publication.
2. AI/CV parsing and candidate scoring with evidence, model/version snapshots, bias review, human override, and no automatic hiring decision.
3. Careers mailbox ingestion with approved folders, attachment rules, duplicate detection, malware scanning, provenance, and no automatic outbound email.
4. Google Calendar scheduling with free/busy access, panel timezone, confirmed event creation, Meet links, reschedule/cancel synchronization, and failure reconciliation.

Keep the local deterministic providers as development/test fallbacks. Never put secrets in client code or localStorage. Add integration status, retry, reconciliation, and audit screens.

Acceptance:
- Each integration degrades safely when unavailable.
- The UI distinguishes Proposed, Pending Sync, Synced, Failed, and Needs Attention.
- No external message, calendar event, or hiring action occurs without the required human confirmation.
```

## Step 48 - Production backend and launch readiness

```text
Implement Step 48: production migration and launch readiness after prototype approval.

Design and implement server APIs and a transactional database from the validated local schema. Move files to encrypted object storage with malware scanning and signed access. Enforce Workspace identity and permissions server-side on every operation. Add immutable audit retention, backups, restore testing, monitoring, rate limiting, input validation, privacy retention, and environment configuration.

Build a controlled migration/import path from authoritative employee/candidate sources. Do not treat browser demo data as authoritative without review. Add staging, user-acceptance testing, security review, accessibility review, performance/load testing, disaster-recovery test, administrator training, support process, and phased rollout.

Produce final evidence:
- Role-permission matrix test results.
- Business-rule test results.
- Data migration reconciliation.
- Security/privacy sign-off.
- Backup/restore evidence.
- UAT sign-off by Employee, Manager, HR, Accounts, and Super Admin representatives.
- Go-live and rollback checklist.
```

---

## Final manual acceptance journeys

Before declaring the app ready, complete these journeys without changing data directly in storage:

1. HR creates, drafts, publishes, pauses, and closes a vacancy.
2. A public candidate applies with a CV and receives a reference.
3. HR imports the supplied workbook, reviews duplicates, and finds the imported candidate.
4. HR checks contact history, records outreach, and schedules follow-up without duplicate contact.
5. HR records a recommendation and later traces the recommender from the employee outcome.
6. Candidate scan produces an explainable top ten; HR chooses N and records an override.
7. HR schedules interviews; panel completes scorecards; HR selects a non-system candidate with reason.
8. Offer is accepted and candidate becomes an onboarding employee without duplicate records.
9. Employee sees their own leave balance and no one else's records.
10. A 5-day annual leave request at 13 days is automatically refused; at 14 days it proceeds.
11. A 6-day annual leave request at 59 days is automatically refused; at 60 days it proceeds.
12. Valid leave is approved by Line Manager and then Super Admin; balance and calendar update.
13. Employee submits a timesheet; manager returns it; employee corrects it; manager approves it.
14. Attendance correction and overtime approval retain original values and feed payroll correctly.
15. HR and Accounts approve travel in both possible orders; only two approvals produce Pre-authorised.
16. Expense submission is blocked until after trip end; Super Admin closes the valid claim.
17. Accounts prepares and locks payroll inputs; Employee and HR cannot access payroll.
18. Onboarding completes cross-role tasks and checkpoints.
19. Offboarding closes access, assets, documents, and financial clearance while preserving history.
20. Employee and manager complete a performance review and required training.
21. Document reminders appear once at each threshold and resolve after verified replacement.
22. Every action can be traced in audit history with sensitive values redacted by role.
23. Backup, reset, and restore return the application to the expected state.
24. Google Workspace user enters from the portal without a second login and receives the correct internal role scope.
