# VIA HR System - Implementation Playbook V2 (current-state edition, 2026-08-18)

## Why this file exists

`IMPLEMENTATION_PROMPT_PLAYBOOK.md` (the original) was written against an empty repository and assumes each step builds its module from scratch. That is no longer true: a full audit of the working tree on 2026-08-18 found that almost every module already has real, substantial code behind it (see the status table below), but three different classes of problems accumulated as later steps modified shared services without updating every consumer:

1. **A routing bug** hides several fully-built pages behind a placeholder (Travel, Onboarding, Attendance, Performance, Candidates, Recommendations, Settings sub-pages, Payroll Overtime).
2. **Foundational API drift** - core primitives (`LocalRepository`, `VersionedStorageService`, `AuditService`, `EmployeeService`) don't have the methods a large number of feature services now call on them, and the `Employee` type's real field names (`legalName`/`preferredName`, `department`, `lineManagerId`) don't match what dozens of list/detail pages display (`firstName`/`lastName`, `departmentId`, `managerId`). This is not cosmetic - it means many pages currently render broken data or throw at runtime.
3. **Real product gaps** - Offboarding has no data model at all; the employee Leave Request page, Employee Files hub, and Offers workflow render placeholders despite supporting code existing nearby; Training has no course catalogue.

This file replaces Steps 01-45 of the original playbook with current-state-aware prompts: verify-only where code is already correct, precise fix instructions where it's broken (naming the exact wrong call and the exact right one, from direct inspection of the service source), and build instructions only where something is genuinely missing. **Steps 46-48 (Google Workspace auth, external integrations, production backend) are unchanged - use the original file for those, unmodified, once you reach that stage.**

`PRODUCT_IMPLEMENTATION_PLAN.md` remains the source of truth for business rules. This file only changes *how* you get there from here.

## How to use this playbook

Same discipline as the original: one implementation chat, paste the Operating Instruction once, then paste one numbered step at a time. Let the agent finish and verify, test the page yourself, only then paste the next step. Do not batch steps.

---

## Operating instruction - paste this once before Step 03A

```text
We are stabilizing and completing VIA HR System in the existing repository before adding authentication or a real database. Almost every module already has code behind it - your job on each step is to inspect what's actually there first, and fix or complete it, not to rewrite working code from scratch.

Before every step:
- Read AGENTS.md, PRODUCT_IMPLEMENTATION_PLAN.md, and this file's entry for the step, plus the actual current source of every file the step names.
- Run `npx tsc --noEmit` scoped to the files you're about to touch before you start, so you know your true starting point, not what a previous step's acceptance note claimed.
- Reuse existing services, types, components, and routing conventions. Do not introduce a second implementation of something that already exists - fix the real one.
- When a step says a method or field doesn't exist, use the exact real name given; if you find the guidance is stale (the code has moved on since this audit), trust the current source and use the closest correct equivalent, and note the discrepancy in your summary.
- Do not implement Google Workspace authentication yet; keep using the development role/person preview context.
- Do not add a backend yet; keep using the shared versioned local repository layer and IndexedDB for file blobs.
- Every material create, edit, submit, approval, rejection, override, correction, import, export, archive, and access-denied action must write an audit event through `AuditService.record(...)` - not `.log()`, `.logEvent()`, or `.getEvents()`, which do not exist on that class.
- Do not leave primary actions as decorative buttons or fake success toasts. Persist their result and make it visible after refresh.
- Do not delete or weaken working features from previous steps.
- End every step by running `npx tsc --noEmit` again scoped to the files you touched (zero errors), plus `npm test` and a manual click-through of the affected pages under at least two different preview roles.
```

---

## Status table

Legend: ✅ working, verify only · 🟠 built but broken (real defect found and named below) · 🔴 missing, build it · ⏭ deferred, unchanged from the original playbook.

| Step | Module | Status |
|---|---|---|
| 01-03 | Foundation, permissions, shell | ✅ |
| 03A-03C | *(new)* Foundational data-layer repair | 🟠 - do this before anything else below |
| 04 | Org settings & master data | 🟠 - 3 tabs are literal placeholders |
| 04A | *(new)* Settings route de-duplication | 🟠 |
| 05 | Employee directory | ✅ |
| 06 | Create/manage employee | ✅ |
| 07 | Employee profile | 🟠 - missing `Link` import |
| 08 | Digital employee files (per-employee tab) | ✅ |
| 08A | *(new)* Employee Files cross-employee hub | 🔴 - nav points at a placeholder |
| 09 | Document expiry centre | ✅ |
| 10 | Vacancy list/lifecycle | ✅ |
| 11 | Vacancy creation/AI-draft UI | ✅ |
| 12 | Public careers portal | ✅ |
| 13 | Public application flow | ✅ |
| 14 | Candidate database/profile | 🟠 - routing bug (see 03D scope, folded into this step) |
| 15 | Candidate import wizard | ✅ (blocked by Step 14's routing bug until fixed) |
| 16 | Candidate contact tracker | 🟠 - nav points at the wrong URL |
| 17 | Recommendations/sources | 🟠 - routing bug |
| 18 | AI scoring | ✅ |
| 19 | Shortlist | ✅ |
| 20 | Interview scheduling | 🟠 - context-shape bug, fixed by 03B |
| 21 | Interview scorecards | 🟠 - context-shape bug, fixed by 03B |
| 22 | Hiring decision & offers | 🔴/🟠 - route is a placeholder; components exist but call broken service methods |
| 23 | Leave policies & ledger | 🟠 - field-name bugs in `leave-service.ts` |
| 24 | Employee leave request | 🔴 - route is a placeholder despite balances/approvals/admin all working |
| 25 | Leave manager/Super Admin approvals | 🟠 - depends on 03A's `EmployeeService.getById` fix |
| 26 | Leave admin & calendar | 🟠 - wrong field names, missing `DepartmentService` |
| 27 | Timesheet setup | 🟠 - Settings persistence is fully broken (calls storage methods that don't exist) |
| 28 | Employee weekly timesheet | 🟠 + nav item is a dead placeholder |
| 29 | Manager timesheet approval | 🟠 - display-name bug |
| 30 | Attendance | 🟠 + routing bug |
| 30A | Geofenced clock-in | 🔴 - specified, not built |
| 31 | Overtime | 🟠 - display-name and service-name bugs |
| 32 | Travel pre-authorisation | 🟠 + routing bug |
| 33 | HR/Accounts travel approvals | 🟠 - display-name bug |
| 34 | Post-trip expenses/closure | 🟠 - display-name bug |
| 35 | Payroll preparation | 🟠 + routing bug (unconditional redirect) |
| 36 | Candidate-to-employee conversion | 🟠 - four broken service calls |
| 37 | Onboarding templates & case | 🟠 + routing bug + orphaned template settings |
| 38 | Offboarding | 🔴 - no data model exists at all |
| 39 | Performance review cycles | 🟠 + routing bug + orphaned template settings |
| 40 | Training | 🟠 + 🔴 - no course catalogue/assignment layer |
| 41 | Notifications & My Tasks | 🟠 - task-generation service calls broken methods |
| 42 | Audit history | 🟠 - context-shape bug, fixed by 03B |
| 43 | Role dashboards | 🟠 - severe: 5 dashboards call methods that don't exist |
| 44 | Reports centre | 🟠 - report-service has 7 broken field/method references |
| 45 | Full completion pass | Run last, after everything above |
| 46-48 | Auth, integrations, production backend | ⏭ unchanged, use the original playbook |

---

# Stage 0 - Foundational data-layer repair

Do these three steps first. A large fraction of the "🟠" defects in every later module trace back to these three root causes.

## Step 03A - Repository, storage, and audit primitive gaps

```text
Implement Step 03A: fix the foundational service/repository gaps that a dozen downstream services already assume exist.

1. `src/lib/data/repository.ts` - `LocalRepository<T>` has no `delete` method (only `list`, `getById`, `create`, `update`, `archive`, `restore`). `goal-service.ts`, `onboarding-service.ts` (template deletion), and `performance-service.ts` (template deletion) currently call `.delete(...)`, which does not exist and will throw at runtime. Per PRODUCT_IMPLEMENTATION_PLAN.md Section 20.2 rule 6, material records must use `archivedAt`, not destructive deletion - so fix these three call sites to call `.archive(id, context)` instead of adding a real `.delete()` method to the base repository.

2. `src/lib/data/storage.ts` - `VersionedStorageService` has no `getItem`/`setItem` methods (it manages whole collections via `listCollections`/`exportState`/`replaceState`, not arbitrary key-value pairs). `timesheet-service.ts` `getSettings()`/`saveSettings()` call `storage.getItem("timesheetSettings")`/`storage.setItem(...)`, which do not exist - Timesheet Settings currently cannot be read or saved at all. Find how `AppSettings`/organisation settings are actually persisted elsewhere in the codebase (a single-record repository pattern) and migrate `getSettings`/`saveSettings` to that same pattern instead of a nonexistent key-value API.

3. `src/lib/data/audit-service.ts` - the only real methods are `list()` and `record(input: AuditInput)`. Three different files guess at a different API and are all wrong: `timesheet-service.ts` calls `audit.logEvent(...)`, `report-service.ts` calls `audit.log(...)`, `src/components/dashboards/admin-dashboard.tsx` calls `audit.getEvents()`. Fix all three to use `record(...)` for writes and `list()` for reads, matching the real `AuditInput`/`AuditEvent` shapes in `src/lib/data/types.ts`.

4. `src/lib/data/employee-service.ts` has no way to fetch a single employee by ID (only `getEmployees()`, the full list, and `getEmployeeRepository()`, whose returned repository does have `getById`). At least 7 call sites across `leave-approvals.tsx`, `leave-service.ts`, `payroll-service.ts`, and `performance/goals.tsx` call `employeeService.getById(...)`, which does not exist. Add a convenience `getById(id: string): Employee | null` method to `EmployeeService` that delegates to `this.getEmployeeRepository().getById(id)`, then confirm all existing call sites now resolve.

5. `timesheet-service.ts` has 8 uses of `ActorContext` with no import - add `import type { ActorContext } from "./types"`.

Acceptance:
- `npx tsc --noEmit` reports zero errors in repository.ts, storage.ts, audit-service.ts, employee-service.ts, timesheet-service.ts, goal-service.ts, onboarding-service.ts, and performance-service.ts.
- Timesheet Settings can be saved and reload correctly after a page refresh.
- Every audit-writing call across the codebase goes through `AuditService.record(...)`.
```

## Step 03B - Current-user/dev-preview context shape

```text
Implement Step 03B: fix the `useCurrentUser()` / dev-preview context value shape.

At least 9 files (`audit-viewer.tsx`, `notification-drawer.tsx`, `leave-approvals.tsx`, `me/leave-balances.tsx`, `my-tasks.tsx`, `onboarding/$caseId.tsx`, `performance/cycles/new.tsx`, `performance/reviews/$reviewId.tsx`, `offer-dialog.tsx`) reference `.roles` on the value returned by `useCurrentUser()`/the dev-preview context, `scorecard-form.tsx` references `.role`, and `reports.tsx` references `.id` - none of these exist on the current `DevPreviewContextValue` type in `src/lib/auth/dev-preview-context.tsx`.

Inspect what the context actually exposes today (likely nested under `currentUser.roles`/`currentUser.id` and a separate `activeRole`) versus what this many independent call sites expect. Given the number and consistency of consumers expecting flat `roles`, `role`, and `id` fields, the lower-risk fix is almost certainly to add/expose those fields on the context value to match caller expectations, rather than editing 9+ files individually - but confirm by reading 2-3 of the call sites to see how the field is actually used before deciding.

Acceptance:
- `npx tsc --noEmit` reports zero errors related to `DevPreviewContextValue` across the whole repository.
- Switching preview role/identity still works exactly as before in every affected page.
```

## Step 03C - Employee display-name sweep and stray missing imports

```text
Implement Step 03C: fix the Employee display-name mismatch and a handful of missing imports found by the audit.

`Employee` (src/lib/data/types.ts) has `legalName` and `preferredName` - it has no `firstName`/`lastName`. The following files currently read `employee.firstName`/`employee.lastName`, which are always `undefined`, meaning these pages currently render broken/blank employee names: `attendance/corrections.tsx`, `attendance/index.tsx`, `leave-admin.tsx`, `leave/leave-request-dialog.tsx`, `leave/manual-adjustment-dialog.tsx`, `overtime-approvals.tsx`, `payroll/overtime.tsx`, `payroll/periods/$periodId.tsx`, `timesheet-approvals/$timesheetId.tsx`, `timesheet-approvals/index.tsx`, `timesheet-monitoring.tsx`, `travel-accounts-approvals.tsx`, `travel-closures.tsx`, `travel-hr-approvals.tsx`. Replace every `${employee.firstName} ${employee.lastName}`-style usage with `employee.preferredName` (or `employee.legalName` where the surrounding context is a formal/legal document, e.g. offer letters or payroll records - use judgement per file, but be consistent within a file).

Also fix `leave-service.ts` and `leave-admin.tsx`, which reference `employee.managerId` (real field: `lineManagerId`) and `employee.departmentId` (real field: `department`, a plain string, not an ID) - and `leave-admin.tsx`'s reference to a `DepartmentService` that doesn't exist (use `getMasterDataRepository("departments")` the same way `settings.tsx` already does).

Fix these missing imports found by typecheck, each of which will throw a `ReferenceError` at runtime when that code path renders: `Link` in `employees/$employeeId.tsx`, `format` (from `date-fns`) in `performance/reviews/$reviewId.tsx`, `Plus` (from `lucide-react`) in `payroll/periods/$periodId.tsx`, `Badge` (from `@/components/ui/badge`) in `src/components/dashboards/accounts-dashboard.tsx`.

Acceptance:
- Every list/detail page that shows an employee's name shows a real name, not "undefined undefined".
- `npx tsc --noEmit` reports zero errors in every file named above.
```

---

# Steps 01-03 (already complete - verify only)

```text
Verify Steps 01-03 are still intact: run `npm test`, confirm the versioned storage/repository/audit/backup foundation, the permission catalogue and role mapping, and the responsive shell/navigation all still work exactly as their original acceptance notes describe. Do not modify unless you find a genuine regression - if you do, fix only the regression and note it.
```

---

# Step 04 - Org settings and master data

```text
Implement Step 04 (completion): staff/settings.tsx already implements Departments, Locations, Cost Centres, Positions, Grades, Leave Policies, and Data Management as real, working tabs. Three tabs are still literal placeholders showing "will be implemented here"/"will be built in the next sub-step": Organisation, Numbering, and Projects. Build these three out fully:
- Organisation: organisation name, timezone, base currency, working days, standard daily/weekly hours, leave year start/end, document reminder days - matching the `AppSettings` type in src/lib/data/types.ts exactly.
- Numbering: employee number format and candidate reference format, also from `AppSettings`.
- Projects: client, type, location, start/end date, cost centre, manager - matching the `Project` type, which already exists and is richer than the generic `MasterRecord` the other tabs use.

Acceptance:
- All ten Settings tabs are fully functional, none show placeholder text.
- Changes persist after refresh and are audited.
```

## Step 04A - Settings route de-duplication

```text
Implement Step 04A: fix Settings navigation duplication.

staff/settings/onboarding-templates.tsx and staff/settings/performance-templates.tsx are fully built, substantial pages (115 and 109 lines) that are currently unreachable because their parent, staff/settings.tsx, renders its own content directly instead of an `<Outlet/>`, and has no tabs for them either. Fold their content into the same tabbed Settings hub as two more tabs, matching the pattern established by the other tabs (each tab renders the already-built page's real logic, not a re-implementation). Remove the now-redundant nested route files once merged, and fix hr-sidebar.tsx so "Onboarding Templates" and "Performance Templates" navigate to the correct tab.

Acceptance:
- Every Settings-area nav item leads to real, working content in the one Settings hub.
- No setting exists in two competing places.
```

---

# Steps 05-13 (Employee directory through public application flow - verify only)

```text
Verify Steps 05 through 13 - Employee directory (employees/index.tsx), employee creation (employees/new.tsx), the employee profile Overview/Personal/Employment tabs, the per-employee Documents tab, Document Expiry centre, Vacancy list/lifecycle, Vacancy creation with AI-draft UI, the public careers portal, and the public application flow. These reported no TypeScript errors and returned real content in a live check. Confirm each against its original acceptance checklist in IMPLEMENTATION_PROMPT_PLAYBOOK.md (Steps 05-13) and fix only genuine regressions you find, not stylistic changes.

One exception within Step 07: employees/$employeeId.tsx is missing a `Link` import (see Step 03C) - confirm that's fixed before signing this off.
```

## Step 08A - Employee Files cross-employee hub

```text
Implement Step 08A: build the "Employee Files" hub, which currently renders only a placeholder at /staff/files despite being a real sidebar nav item.

This is distinct from the per-employee Documents tab (Step 08, already built) and Document Expiry (Step 09, already built): it's an HR-facing hub to search and filter documents across all employees at once, by type/status/expiry, for bulk review rather than one employee at a time. Reuse the existing `EmployeeDocument` type and `DocumentService` - do not introduce a new document model.

Acceptance:
- HR can find any employee's document by type/status without opening each profile individually.
- Respects the same visibility/permission rules as the per-employee Documents tab.
```

---

# Step 14 - Candidate database and profile

```text
Implement Step 14 (fix): staff/candidates.tsx currently renders a legacy, self-contained candidate list built against the old seed data (`@/lib/hr-data`), and does not render `<Outlet/>`. This permanently hides the real, repository-backed implementation already built in candidates/index.tsx, candidates/import.tsx, candidates/contacts.tsx, candidates/$candidateId.tsx, and candidates/$candidateId/convert.tsx.

Diff the legacy candidates.tsx against the nested pages - port over anything genuinely missing (there should be little; the nested pages use the real CandidateService/VacancyService), then delete the legacy inline implementation and turn candidates.tsx into a thin layout route rendering `<Outlet/>`.

Separately, fix the TypeScript errors already present in candidates/$candidateId.tsx (see typecheck output) before signing off.

Acceptance:
- /staff/candidates shows the real repository-backed candidate list, not the old seed-data page.
- No candidate functionality present in the old page is lost.
- `npx tsc --noEmit` is clean for the whole candidates/ route tree.
```

# Step 15 - Candidate spreadsheet import wizard

```text
Verify Step 15 (candidates/import.tsx, 376 lines) once Step 14's routing fix lands - it reported no TypeScript errors and appears complete, but has been unreachable until now. Confirm the full import flow (upload, column mapping, duplicate detection, commit) against its original Step 15 acceptance checklist.
```

# Step 16 - Candidate contact tracker

```text
Implement Step 16 (fix): the real Contact Tracker page (candidates/contacts.tsx, 222 lines) is complete and reachable once Step 14's routing fix lands at /staff/candidates/contacts - but the sidebar nav's "Contact Tracker" item points at /staff/tracker, a separate, unrelated 18-line placeholder file. Fix hr-sidebar.tsx to point at /staff/candidates/contacts, and delete the orphaned staff/tracker.tsx placeholder.

Acceptance:
- "Contact Tracker" in the sidebar opens the real, working tracker.
```

# Step 17 - Recommendations and recruitment sources

```text
Implement Step 17 (fix): recommendations/index.tsx and recommendations/$email.tsx are complete but unreachable because staff/recommendations.tsx renders a placeholder directly instead of `<Outlet/>`. Apply the same fix pattern as Step 14 (thin layout route, delete the placeholder body).

Acceptance: matches original Step 17 acceptance criteria, now actually reachable.
```

---

# Steps 18-19 (AI scoring, shortlist - verify only)

```text
Verify Steps 18 and 19 - AI scoring (scanCandidatesForVacancy in candidate-service.ts plus ai-provider.ts) and shortlist selection, both embedded in the vacancy detail page (vacancies/$vacancyId.tsx, 590 lines). No TypeScript errors reported. Confirm against original acceptance criteria.
```

# Step 20 - Interview scheduling

```text
Verify Step 20 (interviews.tsx, interview-dialog.tsx) after Step 03B lands - its only reported defect was the current-user context shape bug, which 03B fixes. Re-run typecheck on interview-dialog.tsx and confirm scheduling still works end to end.
```

# Step 21 - Interview scorecards

```text
Verify Step 21 (scorecard-form.tsx) after Step 03B lands, same as Step 20 - its only reported defect (`.role` on the context value) is fixed there. Confirm blind scoring and the revision-history/reason-required correction flow still work.
```

---

# Step 22 - Hiring decision and offers

```text
Implement Step 22 (fix + wire up): /staff/offers currently renders a placeholder, but src/components/offers/decision-panel.tsx and offer-dialog.tsx already exist with real implementations - they just aren't wired into a route, and both currently have type errors.

1. Fix offer-dialog.tsx's current-user context bug (see Step 03B).
2. Fix offer-service.ts's three broken calls: `candidateService.updateCandidateStage(...)` does not exist on CandidateService - either add it (updating the candidate's stage via the repository plus an audit event) or replace the call with the repository update it should perform. `shortlistService.getShortlistsForVacancy(...)` does not exist - use `getFinalizedForVacancy(vacancyId)`, which is the real, semantically-correct method for this use case. `offer.scoreRuns` is read from a type that doesn't have that field - locate the real relationship (probably via `CandidateScoreRun` records looked up by candidateId/vacancyId, not a field on the application) and fix the read.
3. Build the actual /staff/offers route using decision-panel.tsx and offer-dialog.tsx as the real page content, following Step 22's original spec (decision view combining score + interview result, system recommendation vs HR override with required reason, offer creation with full field set, offer state machine).

Acceptance: matches Step 22's original acceptance criteria (decision blocked on missing interview data unless waived, HR override visible in audit, accepted offer starts candidate-to-employee conversion).
```

---

# Step 23 - Leave policies and balance ledger

```text
Implement Step 23 (fix): fix leave-service.ts's broken field references (`employee.managerId` -> `lineManagerId`, `employee.departmentId` -> `department`, both also called out in Step 03C) and its two `employeeService.getById(...)` calls, which resolve once Step 03A adds that method. Also fix a narrower bug at line ~375-376: code reads `.approvedBy`/`.date` off a chain-approval entry typed as `{ role: string; status: "Pending" }` - that type needs to allow the full shape (`approvedBy`, `date` present once a stage is actually approved), matching the richer `chainApprovals` type already defined on `LeaveRequest` in leave-types.ts.

Also fix src/components/settings/leave-policy-config.tsx and src/components/leave/manual-adjustment-dialog.tsx, both reporting the same `employee.firstName`/`lastName` and context-shape bugs covered by Steps 03B/03C.

Acceptance: matches Step 23's original acceptance criteria (balance totals reconcile to ledger transactions).
```

# Step 24 - Employee annual-leave request and automatic refusal

```text
Implement Step 24 (build): /staff/leave currently renders a placeholder despite My Leave Balances (me/leave-balances.tsx), Leave Approvals, and Leave Admin all being real and working. Build the actual employee-facing Leave Request flow at a single canonical URL - either build it directly into /staff/leave, or fold it into me/leave-balances.tsx as the "Request Leave" action and redirect /staff/leave there. Do not leave two different "leave" landing destinations.

Reuse src/components/leave/leave-request-dialog.tsx, which already exists with real logic - fix its `employee.firstName`/`lastName` bug (Step 03C) rather than rewriting it.

Acceptance: matches Step 24's original acceptance criteria exactly (60-day notice rule for >5 working days, 14-day notice rule for <=5 working days, tested at the 59/60 and 13/14 boundaries; automatically-refused requests never appear as approvable; approved-future and projected balances explained correctly).
```

# Step 25 - Leave manager and Super Admin approvals

```text
Verify Step 25 (leave-approvals.tsx) after Step 03A adds `EmployeeService.getById` and Step 03B fixes the context-shape bug - both of its reported defects are fixed upstream. Re-run typecheck and confirm the direct-reports-only queue, approval chain, and Super-Admin final stage all work.
```

# Step 26 - Leave administration, cancellation, and calendar

```text
Implement Step 26 (fix): leave-admin.tsx has the same `employee.departmentId`/`managerId`/`firstName`/`lastName` bugs as Step 23/03C, plus a reference to a `DepartmentService` that doesn't exist anywhere in the codebase - replace it with `getMasterDataRepository("departments")`, the same pattern staff/settings.tsx already uses for the Departments tab.

Acceptance: matches Step 26's original acceptance criteria.
```

---

# Step 27 - Timesheet setup and project/activity controls

```text
Verify Step 27 (timesheet-settings.tsx, timesheet-monitoring.tsx) after Step 03A fixes TimesheetService's broken settings persistence (getSettings/saveSettings currently call storage methods that don't exist) - this was a functionally severe bug, not cosmetic: Timesheet Settings could not actually be saved before this fix. Confirm settings now save and reload correctly, and fix timesheet-monitoring.tsx's `employee.firstName`/`lastName` bug (Step 03C).
```

# Step 28 - Employee weekly timesheet page

```text
Implement Step 28 (fix): me/timesheets/index.tsx and me/timesheets/$periodId.tsx are real and substantial (104 and 352 lines) but have TypeScript errors that resolve once Step 03A/03C land (ActorContext import, employee display name). Verify after those steps.

Separately, /staff/timesheets (a different, flat route) still renders a placeholder even though the real timesheet UI lives at /staff/me/timesheets, creating a confusing duplicate sidebar entry. Turn staff/timesheets.tsx into a redirect to /staff/me/timesheets, the same pattern used to fix staff/payroll.tsx in Step 35, and remove the now-redundant sidebar nav item.

Acceptance:
- /staff/timesheets never shows "Not implemented yet."
- The sidebar has one unambiguous timesheet entry point per role.
```

# Step 29 - Manager timesheet approval and corrections

```text
Implement Step 29 (fix): timesheet-approvals/index.tsx and timesheet-approvals/$timesheetId.tsx have the `employee.firstName`/`lastName` bug (Step 03C) - fix and verify the manager queue, detail comparison view, and reopen/correction flow still work exactly as originally specified.
```

---

# Step 30 - Attendance records and correction requests

```text
Implement Step 30 (fix): attendance/index.tsx, attendance/corrections.tsx, and me/attendance.tsx are real and substantial (172, 190, 206 lines) with only the `employee.firstName`/`lastName` bug (Step 03C) and dependence on `attendance-service.ts`'s type errors, which should be re-checked after Step 03A/03C.

The bigger problem: staff/attendance.tsx renders a placeholder directly instead of `<Outlet/>`, hiding all of the above entirely. Apply the same routing fix as Step 14/17 (thin layout route with `<Outlet/>`, delete the placeholder body).

Acceptance: matches Step 30's original acceptance criteria, now actually reachable, with correct employee names displayed.
```

## Step 30A - Geofenced location-based attendance clock-in

```text
Implement Step 30A: Geofenced clock-in. This extends the Locations master data (Step 04) and the Attendance module (Step 30) with mandatory location verification for employee self-service clock-in/out.

Locations master data (Settings > Master Data > Locations):
- Add fields to the Location record: latitude, longitude, radiusMeters, isClockInSite (boolean).
- Add a "Set on map" control to the Location create/edit form using Leaflet with OpenStreetMap tiles (no API key or billing account required): address search via the free Nominatim geocoding API, a draggable pin, and a circle overlay that resizes live as the radius (meters) input changes, so HR can see exactly what area is covered.
- Radius must support small precise zones and large ones (e.g. up to 1000+ metres) so a single large office building/floor can be fully covered by one location.
- Multiple locations can be active clock-in sites simultaneously (HQ, Site A, Site B, Warehouse, client sites, etc.). There is no "assigned location per employee" - any active, isClockInSite=true location qualifies. An employee visiting a site for supervision can clock in there if physically present, without HR pre-assigning them to it.
- Only users with system:settings_manage (HR/Super Admin) can create, edit, or archive locations and their geofence.

Attendance data model:
- Add locationId (FK to the matched Location), capturedLatitude, capturedLongitude, and capturedAccuracyMeters to the attendance record, populated only for Web-source clock-ins/outs that passed geofence validation. Keep the existing free-text location field as a display fallback for non-geofenced sources.

Employee clock-in/out flow (My Attendance, Web source only):
- On Clock In and Clock Out, request the browser Geolocation API. Reject readings with accuracy worse than 100 metres and prompt the employee to move outdoors or near a window and retry, rather than accepting a low-confidence position.
- Compute distance (Haversine formula) from the captured coordinate to every active, clock-in-enabled location. If the employee is within at least one location's radius, allow the action and record which location matched.
- If the employee is not within any active location's radius, hard-block the clock-in/out. No manual override or bypass exists in the employee UI. Show the nearest valid location's name and how far short the employee currently is (e.g. "You are 340m from Site A - move within 150m to clock in").
- If geolocation permission is denied or unavailable, block the action with clear instructions to enable location services. Never allow a clock-in/out without a valid, sufficiently accurate position.
- Hardware Terminal, Manual Entry (HR-entered), and Import attendance sources are explicitly exempt from this rule - it applies only to Web self-service clock-in/out.

Audit and correction path:
- Log every blocked attempt as an audit event via `AuditService.record(...)`, including the attempted coordinates and the nearest location/distance, so HR can spot miscalibrated radii or genuine policy issues.
- The only way to record an out-of-geofence attendance after the fact is the existing HR/Line Manager attendance-correction workflow from Step 30 (explanation, evidence, approval) - this is a retroactive correction, never a live bypass.

Setup prerequisite: none beyond adding the `leaflet` package - OpenStreetMap tiles and Nominatim search require no API key or billing account. The browser Geolocation API requires HTTPS in production (localhost is exempt for local development).

Acceptance:
- HR can create a Location, place it precisely with the map picker, and set a radius that visibly covers a large office floor.
- An employee physically outside every active location's radius cannot clock in or out; the block message names the nearest valid location and the missing distance.
- An employee physically inside any one active location's radius can clock in there even if it isn't a location they're normally based at, and the resulting attendance record stores which location matched plus the captured coordinates/accuracy.
- Hardware Terminal, Manual Entry, and Import attendance sources are unaffected.
- Every blocked geofence attempt is captured in the audit log with coordinates and nearest-location distance.
```

# Step 31 - Overtime requests and approval

```text
Implement Step 31 (fix): me/overtime.tsx, overtime-approvals.tsx, and payroll/overtime.tsx have the `employee.firstName`/`lastName` bug (Step 03C) and depend on `overtime-service.ts`, which should be re-checked after Step 03A. Fix and verify the claim/cross-check-warning/approval flow still works exactly as originally specified.
```

---

# Step 32 - Employee travel pre-authorisation request

```text
Implement Step 32 (fix): travel/index.tsx, travel/new.tsx, and travel/$requestId.tsx are real and substantial (114, 199, 283 lines) but completely unreachable because staff/travel.tsx renders a placeholder directly instead of `<Outlet/>`. Apply the same routing fix as Steps 14/17/30 (thin layout route, delete the placeholder body).

Acceptance: matches Step 32's original acceptance criteria, now actually reachable.
```

# Step 33 - HR and Accounts travel approvals

```text
Implement Step 33 (fix): travel-hr-approvals.tsx and travel-accounts-approvals.tsx have the `employee.firstName`/`lastName` bug (Step 03C) - fix and verify the dual-track approval flow still works.
```

# Step 34 - Post-trip expenses and Super Admin closure

```text
Implement Step 34 (fix): travel-closures.tsx has the `employee.firstName`/`lastName` bug (Step 03C) - fix and verify the estimate-vs-actual variance, expense-line evidence, and closure flow still work.
```

---

# Step 35 - Payroll preparation and restricted access

```text
Implement Step 35 (fix): payroll/periods/index.tsx and payroll/periods/$periodId.tsx have the `employee.firstName`/`lastName` bug (Step 03C) plus other type errors in payroll-service.ts: `LeaveRequest.durationDays` doesn't exist (use `workingDaysRequested`), `LeaveRequest.type` doesn't exist (use `policySnapshot.type`), `EmployeeService.getEmployeeById` doesn't exist (use the `getById` method added in Step 03A), `PayrollPeriod` repository's `.getAll()` doesn't exist (use `.list()`), `OvertimeService.getAllRequests()` needs verifying against its real method name. Fix each.

Separately, staff/payroll.tsx unconditionally redirects every load - including nested paths - to /staff/payroll/periods, which means /staff/payroll/overtime (a real, working page) always bounces back to Periods. Move the redirect into a new payroll/index.tsx child route, and make payroll.tsx itself a thin layout with `<Outlet/>`.

Acceptance:
- /staff/payroll/overtime shows the Overtime Ledger, not a redirect to Periods.
- Payroll input compilation (overtime hours, unpaid leave days, reimbursements, manual adjustments) uses the correct real fields and produces correct totals.
```

---

# Step 36 - Candidate-to-employee conversion

```text
Implement Step 36 (fix): candidates/$candidateId/convert.tsx and conversion-service.ts have four broken service calls:
- `candidateService.getCandidate(id)` doesn't exist - add a convenience method delegating to `getCandidateRepository().getById(id)` (same pattern as Step 03A's EmployeeService fix), or use the repository accessor directly.
- `offerService.getOfferById(id)` doesn't exist - OfferService has `getOffersForCandidate(candidateId)`, which returns the relevant offers; use that and select the right one, or add a proper `getOfferById` convenience method for consistency with other services.
- `employeeService.addEmploymentHistory(...)` doesn't exist - check `employmentChanges`/`EmploymentHistory` in types.ts and add the missing method to EmployeeService, following the same repository + audit pattern as its other mutating methods.
- `candidateService.updateCandidateStage(...)` doesn't exist - same fix as Step 22's offer-service.ts reference to this method; implement it once, reuse in both places.
- `JobOffer.department` is read in convert.tsx but doesn't exist on that type (JobOffer has `position`/`grade`/`location`, not `department`) - source the department from the linked Vacancy or Employee record instead.

Acceptance: matches the original Step 36 acceptance criteria (conversion creates a linked employee record, preserves candidate/offer history, starts onboarding).
```

---

# Step 37 - Onboarding templates and case workflow

```text
Implement Step 37 (fix): onboarding/index.tsx and onboarding/$caseId.tsx are real (130 and 184 lines) but unreachable because staff/onboarding.tsx renders a placeholder instead of `<Outlet/>` - same routing fix as Steps 14/17/30/32. Fix onboarding-service.ts's `.delete()` call per Step 03A (should be `.archive()`), and the context-shape bug in onboarding/$caseId.tsx (Step 03B).

settings/onboarding-templates.tsx is separately orphaned - it's addressed by Step 04A (folded into the Settings hub as a tab).

Acceptance: matches Step 37's original acceptance criteria, now actually reachable.
```

---

# Step 38 - Offboarding and clearance

```text
Implement Step 38 (build from scratch): unlike every other module, there is currently no offboarding-types.ts, no offboarding-service.ts, and no offboarding case UI - only the placeholder at /staff/offboarding and the offboardingCases entry in the documented collection list (PRODUCT_IMPLEMENTATION_PLAN.md Section 20.1).

Model it directly after the already-built Onboarding module (OnboardingCase/OnboardingTask/OnboardingTemplate pattern in src/lib/data/onboarding-types.ts and onboarding-service.ts) rather than inventing a different shape: an OffboardingCase with template-driven OffboardingTask entries grouped by owner (manager handover, project reassignment, IT/assets, access removal, visa/work-permit cancellation, leave/attendance reconciliation, expenses/advances, final payroll input, exit interview, service documents), tracking owners, due dates, dependencies, evidence, overdue items, blockers, and waivers.

HR starts a case for resignation, termination, contract end, retirement, transfer, or other. Capture notice date, last working date, reason category, confidential notes, and rehire eligibility. Accounts confirms financial clearance; HR confirms legal/document closure; Super Admin finalises and sets the employee inactive. Keep Workspace account closure as an external future integration action.

Build nested routes mirroring onboarding's: offboarding/index.tsx (case list) and offboarding/$caseId.tsx (case detail), replacing the flat placeholder the same way earlier steps fixed the routing bug elsewhere - do not reintroduce the Outlet bug on this new module.

Acceptance:
- Inactive employee loses app permission in development context but history remains.
- Final closure is blocked by mandatory tasks unless an authorised waiver is recorded.
```

---

# Step 39 - Performance review cycles

```text
Implement Step 39 (fix): performance/team.tsx, performance/cycles/*, performance/goals.tsx, and performance/reviews/$reviewId.tsx are real and substantial but unreachable because staff/performance.tsx renders a placeholder instead of `<Outlet/>` - same routing fix as Steps 14/17/30/32/37.

Fix performance-service.ts's `.delete()` call per Step 03A (should be `.archive()`), the context-shape bugs (Step 03B) across reviews/$reviewId.tsx and cycles/new.tsx, the missing `format` import in reviews/$reviewId.tsx (Step 03C), and performance/goals.tsx's `employeeService.getEmployeeById` (use the `getById` added in Step 03A) and `.getActorContext()` (doesn't exist on the current-user context - check how other pages build an ActorContext from the current user and reuse that pattern).

settings/performance-templates.tsx is separately orphaned - addressed by Step 04A.

Acceptance: matches Step 39's original acceptance criteria, now actually reachable.
```

---

# Step 40 - Training catalogue and employee records

```text
Implement Step 40 (fix + complete): the current implementation only has a flat TrainingRecord (a completed-training log, in me/training.tsx and training/index.tsx) - it's missing the course catalogue and assignment layer that the documented collection list (trainingCourses, trainingAssignments) and this step's original spec both call for.

Fix training-service.ts's `documentService.createDocument(...)` call, which doesn't exist (use `replaceDocument`, or check whether a plain `create` exists for a first-time certificate upload versus a replacement), and me/training.tsx's context-shape bug (Step 03B).

Then add TrainingCourse (provider, category, delivery type, duration, cost, currency, validity, renewal interval, required roles/locations/projects, active state) and TrainingAssignment (employee, course, assigned by, due date, approval-if-cost-involved, enrolment/schedule/attendance/completion/result status) types and service methods, layered on top of the existing TrainingRecord which continues to represent completion evidence. Build the mandatory-training matrix, overdue view, and certification-expiry reminders integrated with the existing document-expiry reminder mechanism.

Acceptance: matches Step 40's original acceptance criteria (required training assigned without duplicates, completion evidence/certificate permissions work, one reminder per expiry threshold).
```

---

# Step 41 - Notification centre and task inbox

```text
Implement Step 41 (fix): task-service.ts (which powers My Tasks and notification generation) has three broken references: `timesheetService.getTimesheets(...)` doesn't exist (use `getAllTimesheets`), `leaveService.getLeaveRequests(...)` doesn't exist (use `getRequests`), and `OnboardingTask.ownerId`/`.description` don't exist on the real type (use `assignedUserId` and `title`/`instructions`, per onboarding-types.ts). This means task/notification generation for overdue timesheets, pending leave, and onboarding tasks is currently broken.

Also fix notification-drawer.tsx's and my-tasks.tsx's context-shape bugs (Step 03B).

Acceptance: matches Step 41's original acceptance criteria - once fixed, confirm overdue timesheets, pending leave approvals, and pending onboarding tasks all actually surface as notifications/tasks for the right people.
```

---

# Step 42 - Audit history and record activity timelines

```text
Verify Step 42 (audit.tsx, audit-viewer.tsx) after Step 03B fixes the context-shape bug (`.roles` reference) - that was its only reported defect. Confirm filtering, risk-level display, and per-record activity timelines still work.
```

---

# Step 43 - Role-specific dashboards

```text
Implement Step 43 (fix): the five role dashboards in src/components/dashboards/ (Employee, Manager, HR, Accounts, Super Admin) are wired into staff/index.tsx correctly, but call service methods that don't exist and will throw for most roles:
- `PerformanceService.listReviews()` -> use `getReviews()`/`getReviewsForEmployee()`/`getReviewsForManager()` as appropriate per dashboard.
- `TravelService.listRequests()`/`getRequests()` -> use `getAllRequests()`/`getRequestsForEmployee()`.
- `PayrollService.listPeriods()` -> use `getAllPeriods()`.
- `AuditService.getEvents()` -> use `list()` (see Step 03A).
- `import { Employee } from "@/lib/data/employee-types"` in employee-dashboard.tsx and manager-dashboard.tsx -> that module doesn't exist; import `Employee` from `@/lib/data/types`.
- Missing `Badge` import in accounts-dashboard.tsx (see Step 03C).
- Invalid route-path string literals (e.g. "/staff/me/leave", "/staff/me/travel", "/staff/me/my-tasks" don't match real routes) - use the actual route paths.

Acceptance:
- `npx tsc --noEmit` reports zero errors in src/components/dashboards and src/components/hr-sidebar.tsx.
- Loading /staff as each of the 5 roles renders that role's dashboard without a runtime error, with real numbers computed from repository data.
- Every dashboard link navigates to a real, correct destination.
```

---

# Step 44 - Reports and role-safe exports

```text
Implement Step 44 (fix): reports.tsx itself works and renders real content, but report-service.ts has seven broken references that make specific reports wrong or crash when generated:
- `LeaveService.getBalances(...)` doesn't exist - check LeaveService for the real balance-calculation method (likely returns `LeaveBalanceReport`) and use it.
- `import ... from "./employee-types"` doesn't exist - use `./types`.
- `TimesheetWithEntries.overtimeEntries` doesn't exist - compute overtime from the real `entries`/hours data instead.
- `CandidateApplication.stage` doesn't exist - stage lives on `Candidate`, not `CandidateApplication`; join through candidateId.
- `PerformanceService.listReviews()` -> `getReviews()` (same fix as Step 43).
- `DocumentService.listDocuments()` doesn't exist - check DocumentService for its real listing method.
- `TravelService.getRequests()` -> `getAllRequests()` (same fix as Step 43).
- `PayrollService.listPeriods()` -> `getAllPeriods()` (same fix as Step 43).
- `AuditService.log(...)` -> `record(...)` (see Step 03A).

Acceptance: matches Step 44's original acceptance criteria (report totals trace to underlying records, filters are consistent, no export includes hidden fields or out-of-scope employees) - re-verify every report category actually generates without error, not just the ones exercised in a quick smoke test.
```

---

# Step 45 - Full application quality and completion pass

```text
Implement Step 45 exactly as originally specified in IMPLEMENTATION_PROMPT_PLAYBOOK.md, now that Steps 03A-44 have closed the routing bug, the foundational API drift, and the genuine product gaps found by the 2026-08-18 audit. This step should now be a real final polish/verification pass, not a rediscovery of the same defects.

Run `npx tsc --noEmit`, `npm run lint`, and `npm test` repository-wide and confirm all three exit clean before starting the module-by-module acceptance walkthrough this step calls for.
```

---

# Steps 46-48

Unchanged. Use `IMPLEMENTATION_PROMPT_PLAYBOOK.md` for Step 46 (Google Workspace authentication), Step 47 (external AI/email/Calendar integrations), and Step 48 (production backend and launch readiness) once everything above is accepted. Consider running the phases in `PRODUCTION_READINESS_PLAN.md` alongside/after Step 48 for the Postgres migration itself.
