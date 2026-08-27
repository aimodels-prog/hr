# VIA HR System - Implementation Playbook V3 (Auth, PostgreSQL, Production)

## Scope and sequencing

This file covers what `IMPLEMENTATION_PROMPT_PLAYBOOK_V2.md` explicitly deferred: real authentication, a real database, and production launch readiness. It operationalizes `PRODUCTION_READINESS_PLAN.md` as copy-paste prompts, in the same style as the other playbook files.

**Do not start Stage H2 until Stage H1 passes for real** - verified by running the commands yourself, not by trusting a prior step's claimed status. As of 2026-08-18, `npx tsc --noEmit` still reports 366 errors and the Accounts record-scope test still fails identically to the original audit, meaning V2 has not actually been applied to this working tree yet, whatever the state of any other copy of this code. Layering a real database and real authentication on top of an unverified permission bug is how that bug reaches production data.

Same discipline as before: one implementation chat, paste the Operating Instruction once, then one numbered step at a time, verify, then continue.

---

## Operating instruction - paste this once before Step H1

```text
We are moving VIA HR System from a local-storage prototype to a production-ready application with real authentication and a real database. This is higher-stakes than earlier steps: mistakes here can expose real employee PII (salary, bank details, passport numbers, medical/performance notes) or real credentials.

Before every step:
- Read AGENTS.md, PRODUCT_IMPLEMENTATION_PLAN.md, PRODUCTION_READINESS_PLAN.md, and this file's entry for the step.
- Run `npx tsc --noEmit`, `npm run lint`, and `npm test` before you start and report the actual current output - do not assume a previous step's acceptance note still holds.
- Never invent an authentication or authorization shortcut. If a required piece of information (a Workspace domain, an API key, a hosting decision) is missing, stop and ask rather than stubbing it with something that looks real.
- Every schema change must have a reversible migration. Never hand-edit production data directly.
- Every permission/authorization check must be enforced server-side. Client-side checks are UX only, never the actual control.
- Secrets (DB credentials, OAuth client secret, API keys) go in environment variables loaded server-side only - never committed, never sent to the client bundle.
- Do not delete the local-storage prototype code path until the database migration for that module is verified working end-to-end; keep both functioning in parallel behind a clear switch until cutover.
- End every step with the specific verification commands listed in its acceptance criteria, actually run, with real output - not "should work."
```

---

## Stage H1 - Verified stabilization gate

```text
Implement Step H1: verify, do not assume, that IMPLEMENTATION_PROMPT_PLAYBOOK_V2.md's Steps 03A through 45 are actually complete in this working tree.

Run `npx tsc --noEmit`, `npm run lint`, and `npm test` and report exact output. Manually click through: /staff/travel, /staff/onboarding, /staff/attendance, /staff/performance/team, /staff/recommendations, /staff/candidates, /staff/payroll/overtime, /staff/leave, /staff/files, /staff/offers, /staff/offboarding under at least two different preview roles, confirming none show "Not implemented yet" and none crash. Confirm the Accounts-role preview sees only its own record in the Employee Directory (the record-scope test).

If anything is still broken, fix it now using IMPLEMENTATION_PROMPT_PLAYBOOK_V2.md as the reference - do not proceed to Step H2 with known-broken permission logic or unreachable pages.

Acceptance:
- `npx tsc --noEmit` exits 0.
- `npm run lint` exits 0.
- `npm test` exits 0, all 15+ tests passing including the record-scope test.
- Every route listed above renders real content, not a placeholder, under a role that has permission to view it.
```

---

## Stage H2 - Decisions that block schema design (not code - a written decision log)

```text
Implement Step H2: produce a short written decision log (add it to PRODUCTION_READINESS_PLAN.md Section 1 or a new DECISIONS.md) answering these questions before any schema work starts, since retrofitting the answers later touches every table:

1. Single-tenant (one company) or multi-tenant (this product serves multiple client companies)? If multi-tenant, every table needs an organisationId column and every query needs a tenant filter.
2. Confirm authentication stays Google Workspace-only (per PRODUCT_IMPLEMENTATION_PLAN.md Section 4) - no separate email/password path.
3. Confirm payroll scope stays "prepare and export inputs," not "execute payment runs" - this bounds how much financial-services compliance applies.
4. Data residency / hosting region for the database, given HR data includes passports, bank details, and medical information.
5. Retention policy for a leaver's data after termination (a specific number, e.g. 7 years) - needed to build the archive/purge job later.
6. Google Cloud project / Workspace admin access - who provisions the OAuth client and confirms the allowed Workspace domain(s)?

Acceptance:
- Every question above has a specific, written answer, not "TBD."
- The answers are referenced by number in every later step that depends on them.
```

---

## Stage H3 - Database: schema and migration tooling

## Step H3.1 - Stand up Postgres and the ORM

```text
Implement Step H3.1: introduce Postgres and Drizzle ORM without touching any feature code yet.

Add `drizzle-orm`, `drizzle-kit`, and a Postgres driver (`postgres` or `pg`) as dependencies. Stand up a local Postgres instance (Docker Compose for local dev) and a managed staging instance (per Step H2's region decision). Create `src/lib/db/client.ts` exporting a single configured Drizzle client reading `DATABASE_URL` from environment. Create `drizzle.config.ts` and the migrations directory. Do not yet define any tables - this step is only the plumbing.

Acceptance:
- `drizzle-kit generate` runs successfully against an empty schema.
- The app boots locally against the Docker Postgres instance with zero schema (a trivial connectivity smoke test, e.g. `SELECT 1`).
- DATABASE_URL and any DB credentials are read from environment variables only, never hard-coded.
```

## Step H3.2 - Convert master data and Employee schema

```text
Implement Step H3.2: convert the first two entities to real Postgres tables, as the template for every later conversion.

Convert `MasterRecord`-based collections (departments, locations, costCentres, positions, grades) and `Project` from `src/lib/data/types.ts` into Drizzle table definitions in `src/lib/db/schema/master-data.ts`, matching field names exactly. Convert `Employee` into `src/lib/db/schema/employee.ts`, adding the production-only fields identified in PRODUCTION_READINESS_PLAN.md Appendix A: `nationality`, `dateOfBirth`, `gender`, `terminationDate`, `terminationReason`. Add proper foreign keys (`lineManagerId` -> employees.id, `costCentreId`/`projectId` -> their tables), and indexes on every field used as a list-page filter (department, location, status, lineManagerId).

Encrypt at the column level (pgcrypto, or application-layer encryption before write - pick one and use it consistently for every sensitive field going forward): `Employee.passportNumber`, `Employee.nationalId`, `EmployeeSalary.baseMonthly` (store as an encrypted JSON blob or a dedicated encrypted-columns table), `BankDetails.accountNumber`/`iban`.

Write the Drizzle migration. Do not wire any route to this yet - this step only proves the schema is correct and migratable.

Acceptance:
- Migration applies cleanly to a fresh database and is reversible.
- A manually inserted test employee round-trips correctly, including the encrypted fields (verify you cannot read the sensitive values directly with a raw SQL SELECT, only through the application's decrypt path).
```

## Step H3.3 - Convert the remaining entity groups

```text
Implement Step H3.3: convert every remaining entity from src/lib/data/*-types.ts into Drizzle schema, in this dependency order (each group references entities from the ones before it): recruitment (Vacancy, Candidate, CandidateContact, CandidateRecommendation, CandidateApplication, CandidateScoreRun, ShortlistSnapshot, InterviewEvent, InterviewTemplate, InterviewScorecard, HiringDecisionSnapshot, JobOffer) -> leave (LeavePolicy, LeaveTransaction, LeaveRequest) -> timesheets/attendance/overtime (TimesheetSettings/Period/Timesheet, promote TimesheetEntry to a real child table per PRODUCTION_READINESS_PLAN.md Section 2.3, AttendanceRecord, AttendanceCorrection, OvertimeClaim) -> travel/payroll (TravelRequest, promote ExpenseLine to a real child table, PayrollPeriod, promote PayrollException/PayrollManualAdjustment to real child tables) -> onboarding/offboarding (OnboardingTemplate/Case/Task, and whatever OffboardingCase/Task shape V2 Step 38 produced) -> performance/training (ReviewTemplate/Cycle/Review, TrainingRecord, plus the TrainingCourse/TrainingAssignment catalogue from V2 Step 40) -> notifications/audit (Notification, AuditEvent - add ipAddress/userAgent columns per PRODUCTION_READINESS_PLAN.md Section 6.1, and make this table INSERT-only at the database grant level, no UPDATE/DELETE permission for the application role).

For every embedded array in the original TypeScript types, apply the same JSONB-vs-real-table judgement already made in PRODUCTION_READINESS_PLAN.md Section 2.3 - do not re-decide this per field, follow that document.

Acceptance:
- Every collection in PRODUCT_IMPLEMENTATION_PLAN.md Section 20.1 has a corresponding Drizzle table.
- All migrations apply cleanly in order to a fresh database.
- `auditEvents` has no UPDATE/DELETE grant for the application's database role - verify with a raw query attempt that fails.
```

## Step H3.4 - Seed importer and staging dataset

```text
Implement Step H3.4: build a one-time importer that reads the existing deterministic demo seed (src/lib/data/seed-service.ts / seeds.ts) and loads it into Postgres, producing the staging dataset.

This script doubles as the first real integration test of the full schema - if any seed record fails to import, that's a schema bug to fix before proceeding.

Acceptance:
- Running the importer against a fresh database populates every table with the existing demo dataset.
- Row counts match the in-memory seed counts exactly per collection.
```

## Step H3.5 - Migrate services module by module

```text
Implement Step H3.5: rewrite each src/lib/data/*-service.ts file's storage calls from the local repository/storage primitives to Drizzle queries, one module at a time, in the same dependency order as Step H3.3. Keep every public method's signature identical to what routes already call - this is what makes the migration incremental. Do this in small batches (2-3 services per batch) and run the full route click-through after each batch, not all at once at the end.

For each service, when its Drizzle version is verified working, delete its local-storage version - do not leave two implementations of the same service coexisting past the batch that migrates it.

Acceptance (per batch):
- Every route depending on the migrated services works identically against Postgres as it did against local storage.
- `npx tsc --noEmit` and `npm test` stay clean after each batch, not just at the end.
- No route silently falls back to local storage if a Postgres query fails - errors surface visibly.
```

---

## Stage H4 - Authentication

## Step H4.1 - Google Workspace OAuth

```text
Implement Step H4.1: implement the Google Workspace OAuth flow specified in PRODUCT_IMPLEMENTATION_PLAN.md Section 4, using the Google Cloud project and allowed Workspace domain(s) confirmed in Step H2.

Server-side OAuth callback validates the ID token, confirms the email domain matches an allowed Workspace domain, and issues a signed, httpOnly, secure session cookie - not a client-readable token. Populate `User.workspaceEmail`/`workspaceSubject` (already modeled in types.ts) from the real OAuth identity instead of seed data. Build the first-time setup flow (Section 4.2) and the "create employee, link to Workspace email" flow (Section 4.4) for Super Admin.

Add a `sessions` table (does not exist in the prototype) with a reasonable expiry and server-side revocation support.

Acceptance:
- A real Google Workspace account can sign in and receive a session; an account outside the allowed domain(s) is rejected.
- The session cookie is httpOnly and not readable from client JavaScript.
- Signing out invalidates the session server-side, not just client-side.
```

## Step H4.2 - Retire the dev-preview switcher from production builds

```text
Implement Step H4.2: gate the entire dev-preview role-switcher system (src/lib/auth/dev-preview-*) behind a build-time flag that is false in production builds. Confirm via a production build that the switcher's UI and its underlying context are not present in the client bundle at all - not just hidden, actually absent.

Every route/component that currently reads identity from the dev-preview context must instead read it from the real server session established in Step H4.1.

Acceptance:
- `npm run build` (production mode) output contains no dev-preview switcher code, verified by inspecting the built bundle.
- The app is fully unusable without a real Workspace session in a production build.
```

---

## Stage H5 - Server-side authorization

## Step H5.1 - Move permission checks server-side

```text
Implement Step H5.1: this is the most important security step in this playbook. Today, `can()`, `getScopedEmployees()`/`getScopedCandidates()`, and the field-level redaction in src/lib/auth/redaction.ts all run only in the browser, trusting whatever role/employeeId the client claims.

Move every one of these checks to run server-side, using TanStack Start server functions: the server function reads the real session (Step H4.1) to get the actual role/employeeId, applies `can()`/scoping/redaction using that server-verified identity, and only then queries or returns data. The client-side versions of these functions may remain for UI purposes (hiding buttons, etc.) but must never be the actual control - every server function must independently re-check, assuming the client is hostile.

Acceptance:
- A modified fetch/request from devtools claiming a different role or employeeId cannot access another employee's data or another role's permissions - verify this directly by attempting it, not just by reading the code.
- Field-level redaction (salary, bank, passport, performance notes) happens server-side before the response is serialized - confirm by inspecting actual network response payloads for a redacted field, not just the rendered UI.
```

## Step H5.2 - Rate limiting and abuse controls

```text
Implement Step H5.2: rate-limit the authentication endpoints and any bulk-export endpoint (reports, payroll exports) to blunt credential-stuffing and data-scraping. Add basic anomaly logging (e.g. many failed logins, unusually large export requests) feeding into the audit system.

Acceptance:
- Repeated rapid requests to the login endpoint are throttled.
- A single session cannot download an unreasonable volume of records in a short window without triggering a logged event.
```

---

## Stage H6 - File storage

```text
Implement Step H6: replace the IndexedDB blob store (src/lib/data/file-repository.ts) with S3-compatible object storage (per PRODUCTION_READINESS_PLAN.md Section 4).

Uploads go through a server function using a signed upload URL, never directly client-to-bucket, so file type/size can be enforced server-side before the object is accepted. Downloads use short-lived signed URLs, permission-checked per request through the Step H5.1 authorization layer - a Line Manager must not be able to construct or guess another employee's document URL. Keep the existing `FileMetadata` table (checksum, mimeType, owner) - only the storage backend changes.

Acceptance:
- Uploading a document (passport scan, CV, receipt) stores the file in object storage, not the browser.
- A signed download URL expires and permission is re-checked on every request, not cached client-side.
- Attempting to access another employee's document URL directly (without going through the app's permission-checked route) fails.
```

---

## Stage H7 - Security and compliance hardening

```text
Implement Step H7, covering PRODUCTION_READINESS_PLAN.md Section 6 items not already covered above:

1. Confirm managed Postgres provider's at-rest encryption is enabled (usually default - verify, don't assume).
2. Automated backups with at least one actually-tested restore into a scratch environment, not just a backup-exists check.
3. Move all secrets (DB credentials, OAuth client secret, object storage keys) into a real secrets manager, rotated on a defined schedule - not committed `.env` files.
4. Implement the retention/purge job for leaver data using the number decided in Step H2.
5. Add dependency/security scanning to CI (npm audit at minimum, Dependabot/Snyk if available).
6. Run the `/security-review` skill against the full branch once Stages H3-H6 are merged, before any real employee data is loaded into production.

Acceptance:
- A restore-from-backup has actually been performed once, successfully, into a non-production environment.
- No secret exists in any committed file, verified by a repo-wide secret scan.
- The retention job runs on a schedule and its effect is verifiable in a test environment.
```

---

## Stage H8 - Testing expansion

```text
Implement Step H8, per PRODUCTION_READINESS_PLAN.md Section 7:

1. Add integration tests that run against a real (test-container) Postgres instance for every migrated service's business rules - especially leave-balance ledger math, the 60/14-day notice boundaries, dual travel approvals, and payroll exception compilation, since these are the most calculation-heavy and least forgiving of silent bugs.
2. Add end-to-end tests (Playwright) covering one full flow per module against a real session (a test Workspace account or a test-mode auth bypass restricted to the E2E environment only, never production) - this is what will catch routing/permission regressions like the ones V2 fixed, automatically, going forward.
3. Re-add the record-scope regression test as a permanent CI gate (it should already exist from Step H1's verification - confirm it's part of the required check suite, not just runnable manually).
4. Make typecheck + lint + unit + integration + e2e all required CI checks before merge to main.

Acceptance:
- CI fails if any of the five check types fail.
- The Accounts over-exposure bug (or its equivalent in the new schema) cannot silently reappear without a test failing.
```

---

## Stage H9 - Observability

```text
Implement Step H9, per PRODUCTION_READINESS_PLAN.md Section 8: structured server-side request logging (request id, actor, module - distinct from the business-level AuditEvent log), error tracking (Sentry or equivalent) on both server and client, DB connection pool and slow-query monitoring, and basic ops dashboards (error rate, p95 latency on report/export endpoints, failed login attempts).

Acceptance:
- A deliberately triggered server error appears in the error tracker within seconds.
- A slow report query is visible in monitoring, not just in user complaints.
```

---

## Stage H10 - Deployment and launch

```text
Implement Step H10, per PRODUCTION_READINESS_PLAN.md Section 9 and the launch checklist in Section 10:

Stand up staging (seeded demo data, real infra) and production (empty, real org data only) environments. Wire CI/CD: typecheck/lint/test -> build -> auto-deploy to staging; production deploy gated on manual approval. Pick and commit to one Nitro deploy preset. Write down the migration cutover plan (freeze local-storage writes, run the Postgres migration, smoke-test every module in staging, then flip to production) and a rollback plan, before go-live week, not during it.

Walk the full launch checklist in PRODUCTION_READINESS_PLAN.md Section 10 item by item and confirm each one, not just the ones that are convenient to check.

Acceptance: every item in PRODUCTION_READINESS_PLAN.md Section 10's launch checklist is checked and verifiable, not assumed.
```
