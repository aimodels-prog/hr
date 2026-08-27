# VIA HR System - Complete Product and Implementation Plan

## 1. Product objective

VIA HR System will manage the complete people lifecycle in one system:

1. A vacancy is requested, drafted, approved, and published.
2. Candidates are collected from the careers portal, an existing database, email attachments, spreadsheets, and referrals.
3. HR records every contact, scores candidates, shortlists them, schedules interviews, and records the hiring decision.
4. The selected candidate receives an offer and becomes an employee through onboarding.
5. Employees use self-service for leave, timesheets, travel, reimbursements, documents, training, and reviews.
6. Managers, HR, Accounts, and Super Admin complete controlled approvals.
7. Attendance, overtime, approved leave, timesheets, and reimbursements feed payroll-input preparation.
8. Document expiries, onboarding, offboarding, performance, training, reporting, and audit history remain connected to the employee record.

The first implementation is a browser-based prototype. Structured records will be stored in `localStorage`; uploaded files will be stored in IndexedDB because `localStorage` is too small for CVs, passports, invoices, and contracts.

> Authentication is provided by the organisation's existing Google Workspace portal. VIA HR System must not display a second login page or store passwords. Browser storage still cannot provide confidential file protection or enforceable role permissions, so production must validate the Workspace identity and permissions on the server and use encrypted storage and backups.

---

## 2. Roles and access model

### 2.1 Roles

#### Employee

- Sees only their own employee profile and requests.
- Updates permitted personal information.
- Submits leave, timesheets, overtime, travel, reimbursement, documents, self-assessments, and assigned training evidence.
- Cannot view another employee's private records.

#### Line Manager

- Has all Employee capabilities for their own account.
- Sees an operational summary for direct reports only.
- Reviews leave and timesheets for direct reports.
- Reviews or recommends overtime according to company settings.
- Completes manager portions of performance reviews.
- Completes assigned onboarding and offboarding tasks.
- Cannot access payroll or unrelated employee files.

#### HR

- Manages recruitment, employee records, documents, leave administration, attendance administration, onboarding, offboarding, performance, and training.
- Approves the HR stage of travel pre-authorisation.
- Monitors timesheet completion but does not approve timesheets unless separately assigned as a line manager.
- Cannot access payroll-input amounts unless a field is explicitly marked HR-visible.
- Cannot manage Super Admin accounts.

#### Accounts

- Approves the Accounts stage of travel pre-authorisation.
- Sees approved reimbursement and payroll-input records.
- Prepares payroll inputs, exports payroll reports, and locks payroll periods.
- Does not see private HR notes, recruitment assessments, performance notes, or unrelated employee documents.

#### Super Admin

- Has complete system access.
- Creates employees and user accounts.
- Links employees to their verified Google Workspace email identities.
- Assigns roles and line managers.
- Performs final leave approval.
- Closes or rejects reimbursement claims.
- Manages settings, master data, access, audit review, and exceptional corrections.

### 2.2 Access rules

1. Every user record is linked to one employee record, except a setup-only Super Admin account.
2. A user can have more than one role, such as Employee plus Line Manager.
3. The effective permissions are the union of assigned roles, except sensitive modules that require explicit access.
4. Direct reports are determined by `employee.lineManagerId`.
5. Employees can query only records where `employeeId` equals their own employee ID.
6. Line Managers can query only records for employees whose `lineManagerId` equals their own employee ID.
7. Payroll routes and data are restricted to Accounts and Super Admin.
8. Navigation visibility, route guards, action-button guards, and record-query filters must all apply the same permission rules.
9. Permission failures show an access-denied page and create an audit event.
10. Changes to roles, Workspace email mappings, account status, and line managers require an audit reason.

---

## 3. Global application structure

### 3.1 Public portal

- Careers home
- Vacancy search and filters
- Vacancy details
- Application form
- Application confirmation and reference number

### 3.2 Employee portal

- My dashboard
- My profile
- My documents
- My leave
- My timesheets
- My attendance and overtime
- My travel and reimbursements
- My onboarding or offboarding
- My performance reviews
- My training
- My notifications

### 3.3 Staff portal

- Dashboard
- Recruitment
  - Vacancies
  - Candidate database
  - Contact tracker
  - Recommendations and sources
  - Interviews
  - Offers
- Employees
  - Directory
  - Digital employee files
  - Document expiry
- Leave administration
- Timesheet administration
- Attendance and overtime
- Travel and reimbursements
- Payroll preparation
- Onboarding
- Offboarding
- Performance
- Training
- Reports
- Audit history
- Users, roles, and settings

---

## 4. Google Workspace portal access and user administration

### 4.1 Authentication boundary

1. The organisation's existing portal performs Google Workspace authentication.
2. VIA HR System does not ask for a username or password and does not implement password reset, MFA, or account recovery.
3. After portal sign-in, the app receives the verified Workspace identity, at minimum the primary email, display name, and stable Google subject/account ID where available.
4. Production must receive that identity through a server-validated session or signed identity token. It must never trust an email supplied only through a URL, browser form, or editable local storage.
5. The app matches the verified Workspace identity to an internal user and employee record.
6. The internal record supplies VIA HR System roles, employee ID, line manager, status, and permissions.
7. The user enters the shared app shell and can open every module permitted by their roles without signing in again.
8. If no internal mapping exists, show **Access not configured** with instructions to contact Super Admin. Do not create access automatically.
9. If the internal account or employee is suspended/inactive, deny access even when Google authentication succeeds.
10. Portal sign-out or session expiry ends access to VIA HR System.

### 4.2 First-time system setup

1. Configure the approved Google Workspace domain or domains.
2. Configure one initial Super Admin Workspace email through deployment/setup configuration.
3. On first authenticated access, create or link that internal Super Admin record.
4. Ask for organisation name, timezone, working week, default hours, leave year, base currency, and reminder intervals.
5. Save a `system_initialized` audit event with the verified Workspace identity.

### 4.3 App-entry flow after portal sign-in

1. User signs in once through the organisation portal using Google Workspace.
2. User opens VIA HR System from the portal.
3. App validates the existing portal session.
4. App reads the verified Workspace identity.
5. App loads the matching internal employee/user mapping.
6. App composes effective permissions from all assigned internal roles.
7. App loads the correct navigation, dashboard, record scope, and pending tasks.
8. Employee-only users see their own records and requests.
9. Line Managers additionally see their direct reports and approval queues.
10. HR, Accounts, and Super Admin see only their authorised modules and fields.
11. Audit successful app entry, access denial, role context, and sign-out/session expiry.

### 4.4 Create employee and access mapping flow

1. Super Admin selects **Create employee**.
2. Enter employee number, legal name, preferred name, verified Workspace email, phone, department, position, location, employment type, start date, and line manager.
3. Assign one or more internal roles.
4. Validate that the Workspace email is unique within VIA HR System and belongs to an approved domain.
5. Where the portal provides directory lookup, confirm the Workspace identity and store its stable account ID.
6. Validate that the manager is active and that circular reporting lines are not created.
7. Save employee and access-mapping records together.
8. The employee receives no separate VIA HR System password; access starts through the existing portal when the mapping becomes active.
9. Audit employee creation, Workspace identity mapping, manager assignment, and role assignment separately.

### 4.5 Access maintenance

- Activate, suspend, archive, and relink an internal access mapping.
- Change roles with a required reason.
- Change line manager with effective date and reason.
- Update a Workspace email/account link only after verifying the replacement identity.
- Revoke VIA HR System access without deleting or disabling the person's Google Workspace account.
- Never delete historical users referenced by audit records; archive them.

---

## 5. Recruitment module

### 5.1 Vacancy creation flow

1. HR selects **New vacancy**.
2. Enter vacancy title, department, project, location, employment type, requested headcount, target start date, salary range, hiring manager, and reason for hiring.
3. Enter required education, experience, certifications, technical skills, languages, responsibilities, and optional preferences.
4. Save as `Draft`.
5. Select **Draft with AI**.
6. The system builds an AI request from the entered facts without inventing requirements.
7. AI returns a role summary, responsibilities, minimum requirements, preferred requirements, benefits placeholder, and screening questions.
8. HR reviews and edits every section.
9. Show changes between HR input and AI output.
10. HR selects **Submit for approval** if vacancy approval is enabled; otherwise select **Publish**.
11. Approved vacancies become `Open` and appear on the public careers portal.
12. Record version history for every job-description change.

Vacancy states:

`Draft -> Pending Approval -> Open -> Paused -> Closed -> Archived`

### 5.2 Public application flow

1. Candidate searches vacancies by keyword, department, location, project, and employment type.
2. Candidate opens a vacancy and sees duties, requirements, location, and closing date.
3. Candidate selects **Apply**.
4. Enter name, email, phone, nationality, current location, notice period, current company, experience, and salary expectation where permitted.
5. Upload CV and optional cover note.
6. Accept privacy and data-processing notice.
7. System checks for likely duplicates by normalized email and phone.
8. Create or link a candidate profile.
9. Create an application linked to the vacancy.
10. Generate a reference number and show confirmation.
11. Notify HR of the new application.
12. Audit submission source as `Career portal`.

### 5.3 Candidate database and spreadsheet import

The supplied `Candidates 2025.xlsx` has multiple sheets and inconsistent layouts. Import must normalize data without discarding source values.

1. HR opens **Import candidates** and selects an XLSX or CSV file.
2. System lists workbook sheets with row counts.
3. HR selects one or more sheets.
4. System detects the header row and proposes column mappings.
5. Map spreadsheet columns to candidate fields, including shortlist status, status, project, type, position, name, company, experience, nationality, location, visa, marital status, notice, current salary, expected/accepted salary, last contacted, interview, remarks, phone, and email.
6. Preview valid records, warnings, and rejected rows.
7. Normalize phone numbers, whitespace, dates, experience years, and currencies while retaining `originalImportValues`.
8. Find duplicate candidates using exact email, normalized phone, and possible name/company matches.
9. HR chooses `Merge`, `Skip`, or `Create separate` for possible duplicates.
10. Import valid rows in one batch.
11. Store file name, sheet name, row number, import batch ID, import date, and importing user.
12. Display a completion report and allow error-row export.
13. Create audit events for the batch and each merge.

### 5.4 Email and CV ingestion flow

Prototype:

1. HR manually uploads email attachments or CV files.
2. Select or create the related vacancy.
3. System stores file metadata locally and creates an ingestion record.
4. A simulated parser proposes candidate details.
5. HR confirms before adding the candidate.

Production:

1. Connect an approved careers mailbox.
2. Read only configured folders or labels.
3. Extract supported attachments.
4. Detect duplicates and malware-scan files.
5. Parse CV data and attach source email metadata.
6. Never send an email automatically unless HR confirms the template and recipient.

### 5.5 Candidate contact tracker

1. HR opens a candidate or contact queue.
2. System shows the latest contact, owner, result, related vacancy, and next action.
3. Before a new contact, warn if the candidate was contacted recently, has a pending follow-up, or is marked `Do not contact`.
4. HR chooses channel: phone, WhatsApp, email, SMS, LinkedIn, in person, or other.
5. Enter date/time, outcome, notes, vacancy, and next follow-up date.
6. Outcomes include `No answer`, `Interested`, `Not interested`, `Follow-up required`, `Interview arranged`, `Unavailable`, `Invalid contact`, and `Do not contact`.
7. Save an append-only contact event.
8. Update `candidate.lastContactedAt`, `lastContactedBy`, and `nextFollowUpAt`.
9. Notify the assigned HR owner when follow-up becomes due.
10. Show a shared activity timeline so another HR user does not call the candidate twice.

### 5.6 Recommendation and source tracking

1. HR selects **Add recommended candidate** or adds a recommendation to an existing candidate.
2. Capture recommender type: employee, external person, agency, client, supplier, or company.
3. Capture recommender name, company, position, phone, email, relationship, date, vacancy, and recommendation notes.
4. Capture any commercial terms or agency fee separately with restricted visibility.
5. Candidate enters the normal scoring and shortlist process; referral does not guarantee selection.
6. Mark the profile with a visible source badge.
7. If hired, connect later probation and performance outcomes to the source for reporting.
8. Reports show submissions, interviews, hires, probation outcomes, retention, and performance by source.
9. When performance is poor, HR can see the source contact and supporting history, but the application must not automatically assign blame.

### 5.7 AI scoring flow

1. HR chooses a vacancy and selects **Run candidate scan**.
2. System gathers eligible candidates from applications, imported database records, uploaded CVs, email ingestion, and referrals.
3. Exclude withdrawn, do-not-contact, archived, and legally ineligible candidates where recorded.
4. Score each candidate against published vacancy criteria.
5. Recommended weighted categories:
   - Required experience: 25%
   - Technical/domain skills: 20%
   - Systems and tools: 15%
   - Qualifications/certifications: 10%
   - Leadership: 10%
   - Location/visa/availability: 10%
   - Preferred requirements: 10%
6. Show overall score, category scores, evidence, missing information, strengths, risks, and source.
7. Clearly label inferred or missing facts; missing data must not be presented as confirmed.
8. Rank the best ten by default.
9. Allow HR to change the displayed shortlist size from 1 to 10.
10. Allow manual additions and removals.
11. Require a reason when HR advances a candidate below a configured threshold or excludes a top-ranked candidate.
12. Save the job-description version, scoring model version, timestamp, and result so later changes remain explainable.

### 5.8 Shortlist flow

1. HR reviews ranked candidates and evidence.
2. Select **Pre-select top N**.
3. Add or remove candidates individually.
4. Review duplicate, contact, consent, salary, notice, visa, and availability warnings.
5. Confirm the shortlist.
6. Move selected applications to `Shortlisted`.
7. Mark others `On hold` or `Not selected`; do not silently delete them.
8. Optionally prepare communication templates for HR confirmation.
9. Audit the selection and any override reasons.

### 5.9 Interview scheduling flow

1. HR selects shortlisted candidates.
2. Choose interview stage, duration, panel, date range, location or video method, and candidate timezone.
3. Prototype proposes sample available times; production reads connected Google Calendar free/busy data.
4. System finds times when all required panel members are free.
5. HR reviews proposed slots.
6. Candidate availability is confirmed manually or through a future booking link.
7. HR confirms bookings.
8. Production creates Google Calendar events and meeting links.
9. Notify candidate and panel.
10. Rescheduling cancels or updates the prior event and retains history.
11. Interview states are `Proposed`, `Awaiting Candidate`, `Scheduled`, `Completed`, `Cancelled`, and `No Show`.

### 5.10 Interview scorecard flow

1. HR configures criteria and panel members for each interview stage.
2. After the manually conducted interview, each panel member opens their scorecard.
3. Score each criterion from 1 to 5 and add evidence-based notes.
4. Require an overall recommendation: `Strong yes`, `Yes`, `Unsure`, or `No`.
5. Save drafts privately until submission if independent scoring is enabled.
6. Submitted scorecards become read-only; corrections require a reason.
7. System calculates panel average and displays disagreements.
8. HR marks the interview completed only when required scorecards are submitted.
9. Audit submission and later corrections.

### 5.11 Hiring decision flow

1. System combines the configured AI score and interview score.
2. Show the recommended candidate and explain the calculation.
3. HR reviews compensation, availability, references, risks, and panel comments.
4. HR selects a candidate for offer.
5. If the selection differs from the system recommendation, require an override reason.
6. An optional hiring-manager approval can be configured.
7. Selected candidate moves to `Offer`; others move to `Reserve`, `On hold`, or `Not selected`.
8. Audit the recommendation, human decision, and reason.

### 5.12 Offer flow

1. HR creates an offer from an approved template.
2. Enter position, grade, salary, allowances, benefits, start date, probation, location, and conditions.
3. Route for internal approval if configured.
4. Mark as `Ready to send` after approval.
5. Record sent date, response deadline, and delivery method.
6. Candidate outcome is `Accepted`, `Declined`, `Expired`, or `Withdrawn`.
7. A declined offer captures a reason.
8. An accepted offer creates an onboarding case and reserves an employee number.

---

## 6. Employee profiles and digital employee files

### 6.1 Candidate-to-employee conversion

1. HR opens an accepted offer and selects **Start onboarding**.
2. System copies approved candidate identity and contact fields into a draft employee record.
3. HR reviews rather than blindly copying unverified CV data.
4. Assign employee number, department, position, grade, location, project, line manager, start date, and employment status.
5. Link the employee back to candidate, application, interview, and offer history.
6. Create an onboarding case and required document checklist.
7. Super Admin links the employee's verified Workspace identity and assigns internal roles.
8. Activate employee status on the official start date.

### 6.2 Employee profile tabs

- Overview
- Employment and reporting line
- Personal and contact information
- Emergency contacts and dependants
- Contract and compensation summary
- Documents
- Leave and balances
- Timesheets
- Attendance and overtime
- Travel and reimbursements
- Payroll inputs, restricted by role
- Performance
- Training
- Equipment and access
- Onboarding/offboarding
- Activity and audit history

### 6.3 Profile editing

1. Employee may update permitted fields such as preferred name, phone, address, emergency contact, and bank-change request.
2. Sensitive changes enter `Pending verification` rather than replacing verified data immediately.
3. HR reviews supporting evidence and approves or rejects the change.
4. Employment, manager, grade, salary, role, and status changes are staff-only and require effective dates.
5. All verified-field changes retain old and new values in audit history.

### 6.4 Digital document flow

1. User selects document type.
2. Upload a file and enter document number, issue date, expiry date, issuing authority/country, and notes.
3. Validate required metadata and allowed file types/sizes.
4. Store file in IndexedDB and metadata in structured storage.
5. Set verification status to `Pending` for employee uploads.
6. HR verifies or rejects with a reason.
7. Replacement documents create a new version; old versions remain archived.
8. Permissions are applied by document type.

Document statuses:

`Missing`, `Pending Verification`, `Valid`, `Expiring`, `Expired`, `Rejected`, `Replaced`

### 6.5 Expiry reminder flow

1. Daily prototype check compares document expiry dates with configured thresholds.
2. Create reminders at 90, 60, 30, 14, 7, and 1 day where configured.
3. Notify employee and HR; notify manager only for operationally relevant documents.
4. Escalate expired visa, work permit, passport, contract, ID, licence, or mandatory certificate.
5. Mark reminder resolved only after a replacement is verified or an authorised waiver is recorded.

---

## 7. Leave management

### 7.1 Leave setup

Super Admin or HR configures:

- Leave year and carry-forward rules.
- Leave types and whether each is paid or unpaid.
- Annual entitlement by employee group.
- Whether weekends and public holidays count.
- Whether attachments are required.
- Whether negative balances are allowed.
- Annual-leave advance-notice rules.
- Approval chain and delegates.

### 7.2 Leave balance calculation

Display to every employee:

`Available = entitlement + carried forward + earned/accrued + adjustments - taken - approved future leave`

Also display:

- Pending days separately.
- Projected balance if pending requests are approved.
- Leave taken this year.
- Upcoming approved leave.
- Carry-forward expiry where applicable.
- A transaction ledger explaining every balance change.

### 7.3 Employee leave request flow

1. Employee opens **My Leave** and immediately sees leave balances.
2. Select leave type, start date, end date, partial day if permitted, reason, handover contact, and attachment if required.
3. System calculates requested days using configured workdays and holidays.
4. System checks date order, overlap, balance, active employment, and required attachment.
5. For annual leave, calculate advance notice from submission date to start date.
6. Apply mandatory rules:
   - More than 5 days requires at least 60 days' advance notice.
   - 5 days or fewer requires at least 14 days' advance notice.
7. If outside the rule, automatically create the request as `Automatically Refused`, show the exact calculation and rule, notify the employee, and audit the refusal. It must not enter an approval queue.
8. If valid, show balance impact and approval path.
9. Employee confirms submission.
10. Status becomes `Pending Line Manager` and the manager is notified.

### 7.4 Line Manager approval

1. Manager opens the request from the direct-report queue.
2. View dates, duration, balance, reason, attachment, handover, team calendar, and overlapping team leave.
3. Manager selects `Approve` or `Reject`.
4. Rejection requires a reason.
5. Approval moves request to `Pending Super Admin`.
6. Rejection ends the request and notifies the employee.
7. Audit the action.

### 7.5 Super Admin final approval

1. Super Admin reviews the request and manager decision.
2. Select `Approve` or `Reject` with required rejection reason.
3. Approval marks the request `Approved` and reserves the balance.
4. Rejection marks it `Super Admin Rejected` without reducing the balance.
5. Notify employee, manager, HR, and payroll-related views as appropriate.
6. Add approved leave to team calendars and attendance expectations.

### 7.6 Cancellation and amendment

1. Employee requests cancellation or amendment.
2. Pending requests can be withdrawn directly.
3. Approved leave requires manager and/or Super Admin review according to settings.
4. Approved cancellation restores the balance.
5. Past taken leave cannot be deleted; HR creates a correction transaction with a reason.

Leave states:

`Draft`, `Automatically Refused`, `Pending Line Manager`, `Manager Rejected`, `Pending Super Admin`, `Super Admin Rejected`, `Approved`, `Cancellation Pending`, `Cancelled`, `Taken`

---

## 8. Timesheets

Timesheets record where time was spent. Attendance records presence. They are related but not interchangeable.

### 8.1 Timesheet setup

- Weekly or monthly submission period; weekly is recommended.
- Standard hours per workday and week.
- Active projects, phases, cost centres, and activity codes.
- Timesheet deadline and reminders.
- Overtime thresholds.
- Whether zero-hour/non-working days require entries.
- Payroll cutoff and locking rules.

### 8.2 Employee timesheet flow

1. Employee opens the current week.
2. System pre-fills employee, manager, dates, approved leave, public holidays, and optionally prior-week project rows.
3. For each work entry, select date, project, cost centre, activity, regular hours, location, and notes.
4. Add overtime separately so it can follow the overtime workflow.
5. Allow multiple projects per day.
6. Save as draft at any time.
7. Validate no overlapping time ranges, no negative hours, no inactive project, and no regular work on approved full-day leave.
8. Warn when recorded hours differ from attendance or expected hours.
9. Display totals by day, week, project, regular time, overtime, leave, and training.
10. Employee certifies accuracy and submits.
11. Status becomes `Pending Manager` and edits are locked.

### 8.3 Manager review

1. Manager sees submitted, late, missing, and returned timesheets for direct reports.
2. Open a timesheet and review daily totals, projects, attendance comparison, leave, overtime, and notes.
3. Select `Approve` or `Return for correction`.
4. Return requires a reason and unlocks the sheet for the employee.
5. Approval locks employee editing and marks entries available for project and payroll reporting.
6. Audit the decision.

### 8.4 Correction and locking

1. Before payroll lock, an approved sheet can be reopened only by an authorised manager or Super Admin with a reason.
2. After payroll lock, create a correction record rather than modifying the original silently.
3. Corrections flow to the next open payroll period if the closed period cannot be changed.

Timesheet states:

`Draft`, `Pending Manager`, `Returned`, `Approved`, `Payroll Locked`, `Corrected`

---

## 9. Attendance and overtime

### 9.1 Attendance record flow

1. HR imports or manually records scheduled shift, clock-in, clock-out, break, location, and source.
2. System calculates worked hours, lateness, early departure, absence, and missing punches.
3. Compare the record with approved leave and public holidays.
4. Employee can raise a correction request with explanation and evidence.
5. Manager reviews the correction.
6. HR finalises exceptional attendance changes where required.
7. Approved records become available for payroll input.

Attendance statuses:

`Present`, `Absent`, `On Leave`, `Holiday`, `Rest Day`, `Late`, `Missing Punch`, `Correction Pending`, `Corrected`

### 9.2 Overtime request flow

1. Employee or manager records overtime date, start/end or hours, project, reason, and evidence.
2. System compares it with attendance and timesheet data.
3. Prevent duplicate overtime for the same period.
4. Line Manager approves or rejects with a reason.
5. HR verifies policy compliance if configured.
6. Approved overtime becomes a payroll input.
7. Accounts sees approved amount/hours during payroll preparation.
8. Changes after approval require a correction audit.

---

## 10. Travel pre-authorisation and reimbursement

### 10.1 Pre-authorisation request

1. Employee selects **New travel request**.
2. Enter business purpose, destination, start/end dates, project/cost centre, transport, accommodation, estimated per diem, other costs, currency, and supporting documents.
3. System validates dates, required fields, overlapping travel, and total estimate.
4. Employee certifies and submits.
5. Status becomes `Pending HR and Accounts`.
6. HR and Accounts receive independent approval tasks.

### 10.2 HR approval

1. HR checks business purpose, policy, employee/document readiness, travel dates, and required evidence.
2. HR approves or rejects.
3. Rejection requires a reason and ends the request.
4. Approval records HR approver and time; it does not alone make the trip pre-authorised.

### 10.3 Accounts approval

1. Accounts checks budget, cost centre, estimate, currency, and financial policy.
2. Accounts approves or rejects.
3. Rejection requires a reason and ends the request.
4. Approval records Accounts approver and time.

### 10.4 Pre-authorised state

1. The system checks both approval records after every decision.
2. Only when HR and Accounts have both approved does status become `Pre-authorised`.
3. Notify employee and approvers.
4. Record the authorised estimate and approved budget as a locked snapshot.

### 10.5 Post-trip reimbursement

1. Until the trip end date has passed, bill-submission controls remain disabled.
2. After the end date, employee selects **Submit expenses**.
3. Enter final bill amount, currency, invoice/bill references, category breakdown, and notes.
4. Upload invoices, receipts, and supporting evidence.
5. System compares actual with pre-authorised estimate and highlights variances.
6. Require a reason for variance above the configured threshold.
7. Employee submits and status becomes `Pending Super Admin Closure`.
8. Super Admin reviews authorisations, dates, receipts, totals, and variance.
9. Super Admin selects `Close` or `Reject`.
10. Closure records approved reimbursement and sends it to payroll/accounts reporting.
11. Rejection requires a reason and notifies the employee.

Travel states:

`Draft`, `Pending HR and Accounts`, `HR Approved`, `Accounts Approved`, `Pre-authorised`, `Rejected`, `Trip Completed`, `Expenses Draft`, `Pending Super Admin Closure`, `Closed`, `Reimbursement Rejected`

---

## 11. Payroll-input preparation

This module prepares approved inputs; it does not calculate statutory payroll or execute bank payments.

### 11.1 Access

- Only Accounts and Super Admin may open payroll routes or read payroll values.
- HR may provide approved source records without seeing the payroll compilation screen.
- Every view, edit, export, lock, and unlock is audited.

### 11.2 Payroll period flow

1. Accounts creates a payroll period with start date, end date, cutoff, and payment date.
2. System identifies active employees included in the period.
3. Import approved inputs:
   - Regular hours where required.
   - Approved overtime.
   - Unpaid leave and absence.
   - Approved allowances and deductions.
   - Closed reimbursements.
   - Joiners, leavers, and prorating indicators.
4. Show missing timesheets, unresolved attendance, pending leave, unclosed travel, expired contracts, and incomplete employee bank data as exceptions.
5. Accounts reviews and resolves or documents every blocking exception.
6. Manual adjustments require type, amount, reason, employee, and supporting evidence.
7. Run validation for duplicates, invalid currency, missing employee, negative or extreme amount, and inputs outside the period.
8. Accounts marks the period `Prepared`.
9. Super Admin reviews and marks it `Approved` if dual control is required.
10. Lock the period.
11. Export payroll input in CSV/XLSX-compatible format.
12. Any post-lock correction creates an adjustment for a later period or an audited unlock.

Payroll states:

`Draft`, `Collecting Inputs`, `Exceptions`, `Prepared`, `Approved`, `Locked`, `Exported`, `Corrected`

---

## 12. Onboarding

### 12.1 Template setup

Create templates by country, legal entity, department, role, and employment type. Tasks have an owner role, due-date offset, evidence requirement, dependency, and mandatory flag.

Suggested groups:

- Personal and legal documents
- Contract and payroll
- Visa/work permit/ID
- IT accounts and equipment
- Office/site access
- Health, safety, and induction
- Department introduction
- Line-manager plan
- Probation goals

### 12.2 Onboarding case flow

1. Accepted offer creates a draft onboarding case.
2. HR selects the correct template.
3. System calculates task due dates relative to start date.
4. Assign tasks to Employee, HR, Line Manager, Accounts, IT placeholder, and Super Admin.
5. Employee accesses the app through the existing Workspace portal and completes personal forms and document uploads.
6. HR verifies documents and contract requirements.
7. Accounts verifies bank/payroll data without exposing it broadly.
8. Manager completes role plan, team introduction, and probation goals.
9. Task dependencies prevent completion out of order where necessary.
10. Dashboard shows completion percentage, overdue tasks, blockers, and start-date risk.
11. On the start date, activate employee status after mandatory legal and access tasks pass.
12. Conduct configured check-ins, such as day 1, week 1, day 30, day 60, and day 90.
13. Complete onboarding only when all mandatory tasks are completed or an authorised waiver is recorded.

---

## 13. Offboarding

### 13.1 Start offboarding

1. HR records resignation, termination, contract end, retirement, transfer, or other reason.
2. Enter notice date, last working date, reason category, eligibility for rehire, and confidentiality level.
3. Select an offboarding template.
4. System assigns tasks and due dates.

### 13.2 Offboarding tasks

- Manager handover and knowledge transfer.
- Project reassignment.
- Asset and equipment return.
- Access and account removal.
- Visa/work permit cancellation where applicable.
- Leave and attendance reconciliation.
- Final payroll-input preparation.
- Expense and advance clearance.
- Exit interview.
- Experience/service letter.
- Document archive and retention decision.

### 13.3 Completion

1. Owners complete tasks with evidence.
2. Blocking items are escalated.
3. Accounts confirms financial clearance.
4. HR confirms legal and document closure.
5. Super Admin revokes the employee's VIA HR System access mapping at the configured time; any separate Google Workspace account closure remains an external portal/IT process.
6. Employee becomes `Inactive` but historical records remain.
7. Audit the final closure and any waived tasks.

---

## 14. Performance reviews

### 14.1 Review setup

1. HR creates a review cycle and eligible population.
2. Select template, rating scale, competencies, goals, reviewers, dates, and visibility rules.
3. System creates one review case per employee.
4. Notify employees and managers.

### 14.2 Review flow

1. Employee completes self-assessment and submits.
2. Line Manager reviews goals, ratings, evidence, and development needs.
3. Manager submits assessment.
4. HR monitors completion and may moderate where policy allows.
5. Manager and employee hold the review discussion.
6. Employee acknowledges receipt; acknowledgement does not necessarily mean agreement.
7. Record final rating, goals, development plan, and comments.
8. Lock the completed review.
9. Corrections require HR/Super Admin permission and an audit reason.

Performance information must not automatically affect recruitment-source reputation without contextual human review.

---

## 15. Training records

### 15.1 Training setup

- Course title, provider, category, delivery type, duration, cost, validity, required roles, and renewal interval.
- Mandatory courses can be assigned by role, location, or project.

### 15.2 Training flow

1. HR or manager assigns training, or employee submits a training request.
2. Required approvals are completed where cost is involved.
3. Record enrolment date, schedule, attendance, completion, result, and cost.
4. Employee uploads certificate or evidence.
5. HR verifies completion.
6. If certification expires, create document-style renewal reminders.
7. Dashboard reports overdue mandatory training and expiring certification.

---

## 16. Dashboards and reports

### 16.1 Employee dashboard

- Available annual leave, pending days, projected balance, and upcoming leave.
- Current-week timesheet status and missing hours.
- Attendance exceptions and overtime status.
- Travel/reimbursement status.
- Expiring documents.
- Onboarding, review, and training tasks.
- Notifications and due dates.

### 16.2 Line Manager dashboard

- Direct-report list.
- Leave approvals and team absence calendar.
- Missing or pending timesheets.
- Attendance exceptions and overtime requests.
- Onboarding/offboarding tasks.
- Reviews and training due.

### 16.3 HR dashboard

- Headcount, joiners, leavers, and employment status.
- Vacancy and candidate funnel.
- Candidate follow-ups due and recent-contact warnings.
- Interviews, offers, and onboarding progress.
- Leave status and absence trends.
- Missing and expiring documents.
- Timesheet completion monitoring.
- Performance and training completion.

### 16.4 Accounts dashboard

- Travel requests awaiting Accounts approval.
- Reimbursements and payroll inputs.
- Missing approved timesheets or attendance exceptions affecting payroll.
- Payroll period status and unresolved exceptions.

### 16.5 Super Admin dashboard

- Final leave approvals.
- Reimbursements awaiting closure.
- User/access warnings.
- Critical document expiries.
- Payroll period approvals.
- Audit anomalies and overdue workflow items.

### 16.6 Reports

- Recruitment funnel, time-to-hire, source effectiveness, recommender outcomes, candidate contact activity, and HR workload.
- Headcount by department, project, location, nationality, employment type, and manager where legally appropriate.
- Leave balances, leave usage, absence, and upcoming leave.
- Timesheet completion, project hours, cost-centre hours, missing time, and returned sheets.
- Attendance exceptions and overtime.
- Travel estimates, actuals, variance, approval time, and closed reimbursements.
- Document expiry and missing documents.
- Onboarding/offboarding completion and overdue tasks.
- Performance distribution and completion.
- Training completion, cost, mandatory gaps, and expiring certificates.
- Payroll-input summary and exception report, restricted to Accounts/Super Admin.

Every report should support appropriate filters, saved views, printing, and CSV export. Sensitive columns must be removed based on role before export.

---

## 17. Notifications, tasks, and escalation

### 17.1 Notification centre

Each notification contains recipient, type, title, message, linked record, created time, read time, priority, and due date.

### 17.2 Notification triggers

- Candidate follow-up due.
- New application or referral.
- Interview scheduled, changed, or cancelled.
- Scorecard due.
- Offer approaching expiry.
- Onboarding/offboarding task assigned or overdue.
- Leave submitted, automatically refused, approved, rejected, or cancelled.
- Timesheet due, late, submitted, returned, approved, or locked.
- Attendance correction and overtime decision.
- Travel approval needed or reimbursement available after trip.
- Document expiring or expired.
- Performance review or training due.
- Payroll exception or period lock.
- Account lock or role change.

### 17.3 Escalation

1. Notify owner at task creation.
2. Remind before due date.
3. Mark overdue after due date.
4. Escalate to manager or module owner after configured delay.
5. Avoid duplicate notifications for the same event and threshold.

---

## 18. Audit history

### 18.1 Audit event content

- Unique event ID.
- Actor user, employee, and active roles.
- Timestamp and verified portal session identifier where available.
- Action and module.
- Record type and record ID.
- Old and new values for changed fields.
- Reason, comment, or approval decision.
- Related employee, candidate, vacancy, project, and workflow where applicable.

### 18.2 Audited actions

- App entry, portal-session expiry/sign-out, identity-mapping failure, and access denial.
- Workspace identity mapping, account status, role, and manager changes.
- Candidate imports, merges, contacts, recommendations, scoring, shortlists, and overrides.
- Interview scores and hiring decisions.
- Employee profile and document changes.
- Every submission, approval, rejection, return, cancellation, reopening, lock, and correction.
- Payroll viewing, changes, exports, and locks.
- Report exports containing personal information.
- Settings and master-data changes.

Audit records must never be editable from the normal UI. The prototype can make them append-only through the storage service; production must enforce immutability on the server.

---

## 19. Master data and policy settings

Super Admin manages:

- Legal entities, departments, locations, projects, cost centres, positions, grades, and employment types.
- Workweek, holidays, shifts, standard hours, and timezone.
- Leave types, entitlements, accrual, carry-forward, and notice rules.
- Timesheet periods, activities, submission deadlines, and overtime rules.
- Travel categories, currencies, variance thresholds, and approval rules.
- Document types and reminder thresholds.
- Recruitment score weights, interview templates, offer templates, and rejection reasons.
- Onboarding/offboarding templates.
- Performance templates and rating scales.
- Training catalogue and certification requirements.
- Notification and escalation intervals.
- Data-retention and archive settings.

Settings changes must be versioned and effective-dated where they could alter historical calculations.

---

## 20. Local data architecture

### 20.1 Structured collections

```text
appSettings
users
workspaceIdentityMappings
portalSessions
roles
employees
employmentChanges
employeeDocuments
documentVersions
vacancies
vacancyVersions
candidates
candidateContacts
recommendations
applications
candidateScores
shortlistDecisions
interviews
scorecards
offers
leavePolicies
leaveBalances
leaveTransactions
leaveRequests
projects
costCentres
timesheetPeriods
timesheets
timesheetEntries
attendanceRecords
attendanceCorrections
overtimeRequests
travelRequests
travelApprovals
expenseItems
reimbursements
payrollPeriods
payrollInputs
onboardingCases
offboardingCases
workflowTasks
performanceCycles
performanceReviews
trainingCourses
trainingAssignments
notifications
auditEvents
importBatches
```

### 20.2 Storage service rules

1. Components never call `localStorage` directly.
2. A repository/service layer owns reading, validation, migration, authorization filtering, and writing.
3. Use a namespaced, versioned storage key per collection.
4. Use UUIDs and ISO-8601 timestamps.
5. Store `createdAt`, `createdBy`, `updatedAt`, and `updatedBy` on mutable records.
6. Use `archivedAt` or `deletedAt` rather than destructive deletion for material records.
7. Write related business record and audit event in one logical service operation.
8. IndexedDB stores binary files; metadata contains the file record ID and checksum.
9. Provide encrypted production replacement later; browser prototype data must be labelled non-secure.
10. Provide backup export, restore preview, migration, demo reset, and storage-usage indicators.

### 20.3 Data isolation in the prototype

- Apply role-aware selectors before data reaches a page.
- Never rely only on hiding UI elements.
- Redact salary, bank, passport, performance, and medical fields by permission.
- Clear cached page state on logout and role switch.
- Include automated permission tests for every role and sensitive collection.

---

## 21. Cross-module rules

1. One person may have one canonical candidate record and later one linked employee record.
2. Duplicate detection never silently merges people.
3. Historical approved records retain the policy and calculation version used at the time.
4. Rejections, overrides, reopenings, and manual adjustments require reasons.
5. Approval users cannot approve on behalf of another role unless explicitly assigned that role.
6. A user cannot approve their own request where separation of duties is required; route it to an alternate approver.
7. Archived employees remain visible in historical reports according to permissions.
8. Dates use the organisation timezone; store timestamps in UTC.
9. All lists support search, filters, sorting, pagination, and export subject to permission.
10. Every empty, loading, error, access-denied, and no-results state must be designed.
11. Mobile views prioritise employee self-service; complex HR grids remain usable on tablet/desktop.
12. Destructive-looking actions require confirmation and explain consequences.

---

## 22. Implementation sequence

### Phase 0 - Policy confirmation and UX map

1. Confirm policy assumptions listed in Section 24.
2. Approve module navigation and terminology.
3. Define master data and sample users for all roles.
4. Create low-fidelity page flows and state diagrams.
5. Agree which data is too sensitive for the browser prototype.

### Phase 1 - Foundation

1. Create shared TypeScript entities and validation schemas.
2. Build versioned storage repositories and seed data.
3. Add IndexedDB file service.
4. Implement the portal-authentication adapter and a development-only mock verified Workspace session.
5. Implement permissions, route guards, and role-aware selectors.
6. Implement audit and notification services.
7. Add app settings, backup/restore, and demo reset.
8. Test reload persistence and every role boundary.

### Phase 2 - Employees and user administration

1. Employee directory and profile.
2. Employee creation and reporting line.
3. Workspace identity mapping, roles, activation, suspension, and access-denied handling.
4. Digital files, versioning, verification, and expiry reminders.
5. Employee self-service profile.

### Phase 3 - Recruitment data foundation

1. Replace hard-coded recruitment data with repositories.
2. Build candidate profile and application history.
3. Build contact tracker and follow-up queue.
4. Build recommendation/source records.
5. Build spreadsheet import, mapping, duplicate review, and import report using the supplied workbook structure.
6. Build manual CV/email ingestion prototype.

### Phase 4 - Recruitment workflow

1. Vacancy drafting, versioning, approval, and publication.
2. Public application and reference number.
3. Candidate scoring evidence and ranked top ten.
4. Configurable shortlist size and manual override.
5. Interview scheduling prototype and scorecards.
6. System recommendation, HR selection, and override reason.
7. Offer workflow and candidate-to-employee conversion.

### Phase 5 - Leave

1. Leave policy and balance ledger.
2. Employee leave dashboard.
3. Request form and automatic refusal engine.
4. Line Manager approval.
5. Super Admin final approval.
6. Cancellation, corrections, team calendar, notifications, and reports.

### Phase 6 - Timesheets

1. Projects, cost centres, activities, and periods.
2. Employee weekly entry and validation.
3. Manager approval and return.
4. Missing-timesheet reminders.
5. Locking, correction, project-hours reporting, and payroll feed.

### Phase 7 - Attendance and overtime

1. Attendance import/manual-entry UI.
2. Exception detection and correction requests.
3. Overtime submission and approval.
4. Cross-checks with leave and timesheets.
5. Payroll feeds and reports.

### Phase 8 - Travel and reimbursement

1. Pre-authorisation request.
2. HR and Accounts independent approvals.
3. Computed pre-authorised state.
4. Post-trip expense entry and documents.
5. Super Admin closure/rejection.
6. Payroll/accounting feed and reports.

### Phase 9 - Payroll preparation

1. Restricted payroll area.
2. Period creation and source-input collection.
3. Exception workbench.
4. Manual adjustments with evidence.
5. Review, lock, export, and corrections.

### Phase 10 - Onboarding and offboarding

1. Templates and workflow tasks.
2. Candidate-to-onboarding handoff.
3. Employee, HR, Accounts, manager, and admin task views.
4. Start-date readiness and probation checkpoints.
5. Offboarding, clearance, access removal, and archive.

### Phase 11 - Performance and training

1. Performance templates, cycles, self-review, manager review, acknowledgement, and reporting.
2. Training catalogue, request/assignment, completion evidence, certificates, expiry, and reporting.

### Phase 12 - Dashboards and reporting

1. Complete role-specific dashboards.
2. Add filters, saved views, print layouts, and role-safe exports.
3. Add cross-module exception and overdue-work reports.
4. Validate all totals against source records.

### Phase 13 - Production migration

1. Design backend database and APIs from the validated prototype schema.
2. Integrate the existing portal's Google Workspace identity with server-validated sessions or signed tokens; password policy, MFA, and account recovery remain owned by Google Workspace/the portal.
3. Enforce authorization on every API.
4. Move documents to encrypted object storage with malware scanning.
5. Add database transactions, backups, disaster recovery, and immutable audit retention.
6. Connect approved AI provider, mailbox, Google Calendar, and notification services.
7. Conduct privacy, security, accessibility, load, and user-acceptance testing.
8. Migrate validated browser data or re-import authoritative sources.

---

## 23. Definition of done for every module

A module is complete only when:

1. All permitted roles can complete the happy path.
2. Unauthorised roles cannot see routes, actions, records, exports, or sensitive fields.
3. Draft, pending, approved, rejected, cancelled, corrected, and archived states behave correctly where applicable.
4. Required validations run before submission and again before approval.
5. Notifications reach the correct users without duplicates.
6. Every material change appears in audit history.
7. Records survive refresh and storage migration.
8. Empty, loading, error, overdue, and conflict states are handled.
9. Desktop, tablet, and employee mobile layouts are usable.
10. Search, filter, sort, and export follow permissions.
11. Automated tests cover calculations, state transitions, and access rules.
12. Product-owner acceptance scenarios pass with each user role.

---

## 24. Policy decisions to confirm

The plan uses the following safe defaults until the organisation confirms policy:

1. Annual-leave duration uses working days, excluding configured weekends and public holidays.
2. Advance notice is measured in calendar days from submission to leave start.
3. Exactly 5 annual-leave days requires 14 days' notice; 6 or more requires 60 days.
4. Automatic refusal applies only to annual leave, not sick, emergency, bereavement, or unpaid leave.
5. There is no normal override for an automatically refused request; Super Admin may record a separate exceptional leave adjustment if policy permits.
6. Pending leave does not reduce the official balance, but it reduces the displayed projected balance.
7. Approved future leave reserves the official available balance.
8. Timesheets are weekly and due on the first configured working day after week end.
9. Line Manager approves timesheets; HR monitors; Accounts consumes approved inputs.
10. HR and Accounts travel approvals may happen in either order, but both are mandatory.
11. Bills can be submitted beginning the calendar day after the recorded trip end date.
12. Super Admin is the final reimbursement closer and final leave approver.
13. Payroll functionality prepares inputs only and does not calculate statutory payroll or make payments.
14. Candidate marital status, nationality, salary, passport, visa, and similar sensitive data are restricted and collected only where legally and operationally justified.
15. Production retention periods, privacy consent, employee access rights, and local labour-law requirements require legal confirmation for each operating country.

These decisions should become configurable settings only where variation is genuinely required. Mandatory company rules should not be editable by ordinary users.

---

## 25. Final end-to-end operating process

1. Super Admin configures organisation, policies, master data, users, roles, and reporting lines.
2. HR creates and publishes an approved vacancy.
3. Candidates arrive from the portal, database import, uploaded email/CV, or recommendation.
4. HR checks duplicates and sees all previous contacts before outreach.
5. AI ranks candidates with evidence; HR selects the shortlist size and may make justified manual changes.
6. HR schedules interviews; panels submit scorecards.
7. System recommends the best candidate; HR makes and documents the final selection.
8. HR issues the offer; acceptance starts onboarding.
9. Candidate data is verified and converted into an employee profile.
10. Super Admin links the verified Workspace identity and assigns the line manager and internal roles; no second app password is created.
11. Employee completes onboarding, personal data, and required documents.
12. Employee sees their own leave balance, submits leave, and follows the Manager-to-Super-Admin approval chain.
13. Invalid annual-leave notice is automatically refused with a transparent reason.
14. Employee submits weekly project/activity timesheets; Line Manager approves or returns them.
15. Attendance and overtime are recorded, reconciled, and approved.
16. Employee submits travel pre-authorisation; HR and Accounts both approve before travel becomes pre-authorised.
17. After the trip, employee submits bills; Super Admin closes or rejects reimbursement.
18. Approved leave, time, overtime, attendance, adjustments, and reimbursements feed restricted payroll preparation.
19. HR monitors document expiries, training, performance, onboarding, and workforce reports.
20. When employment ends, offboarding controls handover, access, assets, documents, and final payroll inputs.
21. Every sensitive view, change, approval, rejection, override, correction, and export remains attributable through audit history.
