# VIA HR System — Production Readiness Plan

Author's framing: this is written as a senior PM would scope it — sequenced by risk and dependency, not by module popularity. The prototype's _data modeling_ is in surprisingly good shape (see Appendix A); the gap to production is mostly **trust boundary** work: nothing currently stops a browser from lying about who it is, and nothing currently stores a bank account number, passport number, or salary figure anywhere but a browser tab. That reframes the plan: schema migration is the easy 20%, and auth/authorization/security is the hard 80%.

Companion documents: `PRODUCT_IMPLEMENTATION_PLAN.md` (target product spec), `IMPLEMENTATION_PROMPT_PLAYBOOK.md` (original build steps), `IMPLEMENTATION_PROGRESS.md` (stale — do not trust it; see the analysis note added 2026-08-18).

---

## 0. Ground truth before anything else (1 week)

You cannot build production infrastructure on top of code that doesn't reliably run. Fix the prototype bugs found in the 2026-08-18 audit first, or every phase below inherits them silently:

1. **Routing**: several parent route files (`travel.tsx`, `onboarding.tsx`, `attendance.tsx`, `performance.tsx`, `candidates.tsx`, `recommendations.tsx`, `settings.tsx`) render content directly instead of `<Outlet/>`, permanently hiding their real child pages. `payroll.tsx` redirects unconditionally, killing the Overtime Ledger page.
2. **Dashboards** (Step 43) call service methods that don't exist (`listReviews`, `listRequests`, `listPeriods`, `getEvents`) — will throw for HR/Accounts/Admin/Manager roles.
3. **Access-control bug**: `getScopedEmployees` leaks the full employee list to the Accounts role (failing test already exists — `tests/permissions.test.ts:122`).
4. **366 TypeScript errors** — get this to zero and add it as a CI gate before writing a single line of DB code. A schema migration on top of an unchecked codebase compounds every mismatch.

Exit criterion: `npm run typecheck`, `npm run lint`, `npm test` all pass; every sidebar nav item resolves to its intended page.

---

## 1. Guiding decisions to lock in first (product + eng, 1–2 days of workshops)

These block schema design, so decide them before Phase 2:

| Decision                                                           | Why it matters                                                                                                       | Recommendation                                                                                                                                                                      |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single-tenant or multi-tenant (multiple client companies)?         | Determines whether every table needs `organisationId`                                                                | If this ever sells beyond one company, add `organisationId` now — retrofitting tenancy later touches every table and every query                                                    |
| Source of identity: Google Workspace only, or also email/password? | Determines auth architecture                                                                                         | Spec already assumes Workspace-only (Section 4) — keep it, it removes password-storage risk entirely                                                                                |
| Where does payroll money actually get paid from?                   | Determines whether payroll module needs to integrate with a real payroll processor or stays "input preparation" only | Confirm scope stays "prepare & export inputs," not "run payroll" — the spec already says this (Section 11), just get explicit sign-off since it changes compliance scope enormously |
| Data residency / hosting region                                    | HR data (passports, bank details, medical) is regulated in most jurisdictions                                        | Pick the DB region before Phase 2; changing it later means a data migration                                                                                                         |
| Retention policy for leavers' data                                 | Legal requirement varies by country                                                                                  | Get a number (e.g., 7 years post-termination) before building the archive/delete jobs in Phase 7                                                                                    |

---

## 2. Data layer migration (2–3 weeks)

### 2.1 Why the current modeling is a good starting point

`src/lib/data/types.ts` and the sibling `*-types.ts` files already define ~35 well-normalized entities with `BaseRecord` conventions (`id`, `createdAt/By`, `updatedAt/By`, `archivedAt`, `recordVersion`) baked in, plus a documented collection list (`PRODUCT_IMPLEMENTATION_PLAN.md` §20.1). This is unusually close to a real ERD already. Treat it as the first draft of the Postgres schema, not a throwaway prototype shape.

### 2.2 Stack recommendation

- **Postgres** (not a NoSQL store) — the data is heavily relational (employee → manager, requests → approval chains, review cycles → reviews → sections) and needs real foreign keys and transactions for approval workflows.
- **Drizzle ORM** over Prisma, given the app already runs on TanStack Start/Nitro (lightweight, edge-friendly, avoids a heavy codegen step, and its schema-as-TS style will map almost 1:1 onto the existing `*-types.ts` files).
- Keep the **repository pattern** that already exists (`src/lib/data/*-service.ts`) — swap its internals from `localStorage` reads to Drizzle queries. This means route/component code barely changes; only the service layer's implementation changes. That's the single biggest reason this migration is tractable instead of a rewrite.

### 2.3 Schema work

1. Convert every `*-types.ts` interface to a Drizzle table definition. Mechanical for most; decide per-entity whether embedded arrays become JSONB or real child tables:
   - **Keep as JSONB** (rarely queried independently, always loaded with parent): `Vacancy.skills`, `LeaveRequest.chainApprovals`, `JobOffer.history`, `InterviewEvent.history`, `PerformanceReview.sections`, `Employee.emergencyContacts`/`dependants`, `AttendanceCorrection` evidence.
   - **Promote to real tables** (need independent querying, reporting, or referential integrity): `TimesheetEntry` (currently "embedded for simplicity" per its own code comment — reports need to sum hours by project/cost-centre across employees, which is painful against JSONB), `ExpenseLine` (needed for the travel variance/reimbursement reports in §16.6), `OnboardingTask` (needed for the "overdue tasks" dashboard widgets and cross-employee task reporting), `PayrollException`/`PayrollManualAdjustment` (needed for the payroll exception report).
2. Add production-only columns everywhere: `organisationId` (if multi-tenant, per §1), proper `uuid` primary key type, indexes on every foreign key and every field used in a dashboard/report filter (`employeeId`, `status`, `date` ranges, `department`).
3. Fields to **add** that the current model is missing, found while cross-checking against the reports/dashboard spec (§16.6):
   - `Employee.nationality`, `Employee.dateOfBirth`, `Employee.gender` — headcount reports explicitly require "nationality" and demographic breakdowns; `Employee` currently has neither (Candidate has `nationality`, Employee doesn't — an oversight, since employees are converted from candidates).
   - `Employee.terminationDate`, `Employee.terminationReason` — needed for "leavers" reporting and offboarding, not currently modeled.
   - `AuditEvent` needs a durable `ipAddress`/`userAgent` for real security audit value (currently just actor + before/after).
   - A first-class `Session` table (see Phase 3) — doesn't exist at all in the prototype since there's no real login.
4. Encrypt at column level (via pgcrypto or application-layer encryption before write) rather than plaintext: `BankDetails.accountNumber`, `BankDetails.iban`, `Employee.passportNumber`, `Employee.nationalId`, `EmployeeSalary.baseMonthly`. These are flagged "sensitive" in code comments already (`JobOffer.salary // sensitive`) — that comment is currently the _only_ protection they get. In production it needs to be enforced at the data layer, not just by UI redaction.
5. File metadata (`FileMetadata`) moves from IndexedDB to pointing at object storage (Phase 4) — keep the table, change what `fileId` resolves to.

### 2.4 Migration mechanics

1. Stand up Postgres (managed — RDS/Neon/Supabase/Cloud SQL, not self-hosted, for a first production launch).
2. Write Drizzle schema + migrations, generate from the `*-types.ts` files so field names stay consistent (reduces route/component churn).
3. Build a one-time seed importer that takes the existing deterministic demo seed (`seed-service.ts`) and loads it into Postgres for staging — this becomes the staging dataset, and doubles as the migration script's first test.
4. Rewrite each `*-service.ts` file's storage calls from the local `repository.ts`/`storage.ts` primitives to Drizzle queries, one module at a time, in this order (matches dependency order — later modules reference earlier ones): master data → employees → recruitment → leave → timesheets/attendance/overtime → travel/payroll → onboarding/offboarding → performance/training → notifications/audit.
5. Each module's service migration must keep the exact same public method signatures the routes already call — this is what makes the migration incremental instead of a big-bang rewrite. (Side benefit: it will immediately surface every dashboard method-name mismatch found in the Phase 0 audit, since Drizzle will fail loudly on a genuinely missing method in a way `any`-typed localStorage code didn't.)

Exit criterion: every route works identically against Postgres in a staging environment; local-storage code path is deleted, not left dormant.

---

## 3. Authentication & authorization (2–3 weeks) — the actual hard part

This is the biggest gap between prototype and production. Today, "who am I" is a value in `localStorage` the browser sets itself (`dev-preview-context.tsx`), and every permission check (`RequirePermission`, `can()`, `getScopedEmployees`) runs **only in the browser**. A production app cannot ship this: anyone can open devtools and grant themselves Super Admin.

1. **Real authentication**: implement the Google Workspace OAuth flow already specified in `PRODUCT_IMPLEMENTATION_PLAN.md` §4 (Step 46 in the playbook, currently deferred). Server-side session issuance (signed, httpOnly cookie), not client-stored role state.
2. **Server-side authorization**: every data-mutating and data-reading operation must re-check permissions **on the server**, using the session's real role/employeeId — not trust a role string the client sends. Concretely: move the `can()`/`getScopedEmployees()`/redaction logic (already well-written in `src/lib/auth/`) to run inside TanStack Start server functions / API routes, called before any DB query executes. The existing logic doesn't need a rewrite — it needs a new place to run.
3. Keep the dev-preview role switcher **only** behind a build-time flag (`import.meta.env.DEV` or a staging-only feature flag), never shippable to production — currently nothing prevents it from being included in a prod build.
4. `User.workspaceEmail`/`workspaceSubject` already model the Workspace identity link (§4.4) — wire the real OAuth callback to populate it instead of the seed data.
5. Field-level redaction (already implemented in `src/lib/auth/redaction.ts`) must also move server-side — redact before the payload leaves the server, not after it arrives in the browser. Client-side-only redaction of salary/bank/passport fields is not a real control; the unredacted data would still transit the network.
6. Rate-limit auth endpoints and sensitive export endpoints (reports, payroll) to blunt credential-stuffing/scraping.

Exit criterion: a modified `fetch()` call from devtools claiming a different role/employeeId cannot access another employee's data — verified by a dedicated penetration-style test suite, not just unit tests of the permission functions in isolation.

---

## 4. File storage (1 week)

1. Replace the IndexedDB blob store (`file-repository.ts`) with S3-compatible object storage (S3, R2, or GCS).
2. Uploads go through the server (signed upload URL pattern), never directly client-to-bucket for anything containing PII, so you can virus-scan and enforce file-type/size limits server-side.
3. Downloads use short-lived signed URLs, permission-checked per request (a Line Manager should not be able to guess another employee's passport-scan URL).
4. Keep the existing `FileMetadata` table (checksum, mimeType, owner) — it already models what's needed; only the storage backend changes.

---

## 5. Notifications & integrations (2–3 weeks, can run parallel to Phase 3)

Maps to playbook Step 47 (currently deferred):

1. Transactional email (approvals, document-expiry reminders, offer letters) — pick a provider (SES/Postmark/SendGrid), template the existing `Notification` entity's content.
2. Google Calendar sync for interview scheduling (`InterviewEvent.confirmedSlot`) — currently just stored data with no external effect.
3. AI scoring provider (`ai-provider.ts` already exists as an abstraction) — connect a real model behind it for `CandidateScoreRun`; keep the existing "evidence/strengths/risks" explainability fields, since that's a real differentiator worth preserving, not simplifying away.
4. Escalation jobs (§17.3) need a real scheduler (cron/queue), not a client-side check-on-page-load — e.g., overdue approvals, expiring documents, unresolved payroll exceptions.

---

## 6. Security & compliance hardening (2 weeks, before any real employee data loads)

1. **Audit log integrity**: make `auditEvents` append-only at the DB level (no UPDATE/DELETE grant for the app role) — right now it's just another mutable collection.
2. **Encryption at rest** for the DB (managed Postgres providers do this by default — confirm it) plus the column-level encryption from §2.3 for the most sensitive fields.
3. **Backups**: automated, tested restores (not just "backups exist") — the current prototype's "backup" is a client-side JSON export, which is not a production backup strategy.
4. **Secrets management**: DB credentials, OAuth client secret, storage keys — a real secrets manager (not `.env` committed anywhere), rotated on a schedule.
5. **PII minimization/retention**: implement the retention decision from §1 as a scheduled job — archive/purge leaver data per policy, don't keep it forever by default.
6. **Dependency/security scanning** in CI (`npm audit` / Snyk/Dependabot).
7. Run the actual `/security-review` skill against the branch once Phases 2–4 land, before first production data load.

---

## 7. Testing & QA (ongoing, gate every phase)

1. Expand `tests/*.test.ts` beyond the current foundation/permissions suites to cover every service's business rules — especially the approval-chain logic (leave, travel, payroll) and leave-balance math, since those are the most calculation-heavy and least forgiving of bugs (wrong pay, wrong leave balance = real employee trust damage).
2. Add integration tests that hit the real Postgres schema (via a test container), not just the unit-level logic tests that exist today.
3. Add end-to-end tests (Playwright) covering one full flow per module end-to-end with a real (test) role/session — this is also what will catch routing regressions like the Phase 0 Outlet bug automatically going forward.
4. Add the failing `record-scope` test back as a permanent regression guard once fixed — this class of bug (over-broad data scope) is exactly what e2e + integration tests should make impossible to reintroduce silently.
5. CI gate: typecheck + lint + unit + integration + e2e all required to merge to main.

---

## 8. Observability & operations (1 week)

1. Structured server-side logging (request id, actor, module) — currently only the in-app `AuditEvent` log exists, which is a business record, not an ops log.
2. Error tracking (Sentry or similar) for both server and client.
3. Uptime/health checks, DB connection pool monitoring, slow-query logging (payroll/report queries will be the first to need this).
4. Dashboards for the ops team: error rate, p95 latency on report/export endpoints, failed login attempts.

---

## 9. Deployment & release (1–2 weeks)

1. Environments: local → staging (seeded demo data, real infra) → production (empty, real org data only).
2. CI/CD pipeline: typecheck/lint/test → build → deploy to staging automatically; production deploy gated on manual approval.
3. Nitro already supports multiple deploy presets — pick one target (e.g., a Node server on a managed platform, or a serverless preset) and commit to it; don't leave it undecided into launch week.
4. Migration cutover plan: freeze writes to the prototype's local-storage mode (there shouldn't be any real data in it anyway — confirm), run the Postgres migration, smoke-test every module against staging, then flip DNS/env to production.
5. Rollback plan documented before go-live, not improvised during an incident.

---

## 10. Launch readiness checklist (maps to playbook Step 48)

- [ ] Phase 0 bugs fixed, zero typecheck/lint errors, all tests green
- [ ] Real Postgres schema live in staging with the full seed dataset
- [ ] Google Workspace login working end-to-end; dev-preview switcher excluded from prod build
- [ ] All permission checks re-verified server-side (Phase 3 exit criterion)
- [ ] File uploads/downloads on real object storage with signed URLs
- [ ] Sensitive fields encrypted at rest; audit log append-only
- [ ] Automated backups with a tested restore
- [ ] Email notifications sending from staging
- [ ] E2E suite green in CI; CI gates required checks on `main`
- [ ] Error tracking + uptime monitoring wired up
- [ ] Retention/compliance policy signed off and its purge job scheduled
- [ ] Rollback plan written down

---

## Appendix A — Field audit per module (what exists vs what's missing)

Fields already modeled well in `src/lib/data/*-types.ts` are marked **✓ modeled**; gaps found during this audit are marked **⚠ add**. This is not a re-design — it's a checklist to review against, since the existing modeling is the strongest part of the current codebase.

### Employee profile

✓ modeled: employee number, legal/preferred name, work email/phone, department, position, grade, location, employment type, dates (start/probation), line manager, status, salary block, bank details, passport/national ID, performance rating/notes, project, address, emergency contacts, dependants.
⚠ add: `nationality`, `dateOfBirth`, `gender`, `terminationDate`/`terminationReason`, `userId` back-reference for fast session→employee lookup.

### Recruitment (Vacancy → Candidate → Application → Interview → Scorecard → Offer)

✓ modeled: extremely thorough — vacancy salary range with public visibility flag, screening questions, candidate scoring with evidence/strengths/risks, shortlist overrides with reasons, interview slots/history, blind scorecards with revision history, offer status lifecycle with history log.
⚠ add: nothing structurally significant found; this is the most complete module in the schema. Priority here is wiring it to a real DB and a real AI provider, not adding fields.

### Leave

✓ modeled: policy accrual modes, carry-forward limits, negative-balance rules, notice-period rules, transaction ledger (entitlement/accrual/adjustment all separately typed), request approval chain with policy snapshot (protects historical requests from later policy changes — good design, keep it).
⚠ add: nothing major; consider a `blackoutPeriods` field on `LeavePolicy` if the business has seasonal no-leave windows (confirm with HR stakeholders during §1 workshops).

### Timesheets

✓ modeled: settings (period start day, overtime threshold, lock behaviour), period/timesheet/entry split.
⚠ add: promote `TimesheetEntry` to a real child table in Postgres (see §2.3) — the current "embedded for simplicity" note in the code is explicitly a prototype shortcut that will hurt reporting.

### Attendance & Overtime

✓ modeled: clock in/out, source (hardware/manual/web/import), lateness flags, correction workflow with manager+HR notes, overtime claims with cross-check warnings and correction lineage (`originalClaimId`).
⚠ add: geofenced clock-in (decided 2026-08-18 — see `IMPLEMENTATION_PROMPT_PLAYBOOK.md` Step 30A). `Location` master data needs `latitude`/`longitude`/`radiusMeters`/`isClockInSite`; `AttendanceRecord` needs `locationId`/`capturedLatitude`/`capturedLongitude`/`capturedAccuracyMeters`. Hard-block enforcement, any active clock-in-enabled location qualifies (not a per-employee assignment), HR places locations via a free Leaflet/OpenStreetMap picker (no API key/billing) with a live radius circle. Build this in the current prototype architecture before the Phase 2 DB migration, so the migration inherits the finished schema instead of retrofitting it.

### Travel & Reimbursement

✓ modeled: dual-track HR/Accounts approval, estimate vs actual split, expense line items with receipts, variance explanation.
⚠ add: promote `ExpenseLine` to a real child table (needed for the variance/actuals report in §16.6).

### Payroll input prep

✓ modeled: period status lifecycle, exceptions with severity/acknowledgement, manual adjustments with evidence, compiled input snapshot per employee.
⚠ add: promote `PayrollException`/`PayrollManualAdjustment` to real child tables for the exception report.

### Onboarding / Offboarding

✓ modeled (onboarding): template-driven tasks by checkpoint/group/owner role, dependency chains, evidence requirement, readiness-for-start-date computation.
⚠ add: **Offboarding has no dedicated type file at all** — it's referenced in the collection list (§20.1: `offboardingCases`) and playbook Step 38, but unlike every other module has no `offboarding-types.ts` and no built case-workflow UI (confirmed in the 2026-08-18 audit). This needs to be modeled from scratch, likely mirroring `OnboardingCase`/`OnboardingTask` shape (clearance tasks by department: IT equipment return, access revocation, final settlement, exit interview) rather than invented independently.

### Performance

✓ modeled: template-driven weighted sections/items, self vs manager scoring, moderation/discussion stages, acknowledgement, correction lineage.
⚠ add: none significant.

### Training

✓ modeled: minimal but sufficient (title, provider, completion/expiry, certificate file, HR verification).
⚠ add: a `TrainingCourse`/mandatory-course-catalogue relationship — the collection list mentions `trainingCourses` and `trainingAssignments` separately, but the only type found (`TrainingRecord`) models a flat completed-training log, not an assignable catalogue with due dates. Needed for the "mandatory training gaps" report in §16.6.

### Master data (departments, locations, cost centres, positions, grades, projects)

✓ modeled: generic `MasterRecord` (name, code, description, active flag, order) covers all of these except `Project`, which has its own richer type (client, dates, cost centre, manager).
⚠ add: none.

### Notifications / Audit

✓ modeled: notification priority/status/dedup key/deep link; audit event with actor snapshot, before/after, risk level.
⚠ add: `ipAddress`/`userAgent` on `AuditEvent` for real security value (see §6.1).
