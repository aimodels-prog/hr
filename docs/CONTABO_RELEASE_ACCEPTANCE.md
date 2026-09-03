# VIA HR System release acceptance record

Copy this document for each staging rehearsal and production release. Store the
completed copy with the release evidence, never with passwords, encryption keys,
access tokens, employee documents or database dumps.

## Release identity

| Item                      | Recorded value       |
| ------------------------- | -------------------- |
| Environment               | Staging / Production |
| Release tag               |                      |
| Git commit                |                      |
| Image digest: application |                      |
| Image digest: worker      |                      |
| Deployment date and time  |                      |
| Deployment operator       |                      |
| Approved hostname         | career.via-int.com   |
| Contabo region            |                      |
| Previous release tag      |                      |

Approved GitHub quality-gate run: `________________________________________`

The application and worker must use the same release tag. Record immutable image
digests after the images are built.

## Pre-deployment approval

- [ ] The HR-data residency location is approved.
- [ ] CPU, memory and disk capacity have been checked against the other hosted applications.
- [ ] VIA has its own PostgreSQL database, role, network and volumes.
- [ ] The approved release is reviewed and the working tree contains no unapproved changes.
- [ ] The GitHub quality gate passed for this exact commit.
- [ ] `.env.production` is owner-only and is not stored in Git.
- [ ] VIA Portal has the exact HR callback URL and the shared SSO secret was transferred outside Git.
- [ ] Password login is disabled and VIA HR contains no direct Google OAuth configuration.
- [ ] The field, database, object-storage and backup credentials are all different.
- [ ] The off-server backup destination and retention owner are confirmed.
- [ ] Office public network CIDRs are approved for attendance verification.
- [ ] A maintenance window and named rollback decision-maker are confirmed.

## Automated release evidence

Record the command result, timestamp and evidence location. A command marked
failed blocks deployment until it is corrected and rerun.

| Gate                     | Required command or evidence                                                          | Result | Timestamp / evidence |
| ------------------------ | ------------------------------------------------------------------------------------- | ------ | -------------------- |
| Production configuration | `npm run production:preflight`                                                        |        |                      |
| Compose interpolation    | `docker compose --env-file .env.production -f compose.production.yaml config --quiet` |        |                      |
| Formatting               | `npx prettier --check .`                                                              |        |                      |
| Lint                     | `npm run lint`                                                                        |        |                      |
| Type safety              | `npm run typecheck`                                                                   |        |                      |
| Service tests            | GitHub PostgreSQL/MinIO evidence: 0 failures and 0 skips                              |        |                      |
| Browser tests            | GitHub production-build browser evidence: 0 failures                                  |        |                      |
| Dependency security      | `npm run security:audit`                                                              |        |                      |
| Production build         | `npm run build`                                                                       |        |                      |
| Migration review         | Migration SQL and recovery effect reviewed                                            |        |                      |

## Deployment and data reconciliation

- [ ] A verified encrypted backup completed before migration. Backup ID: `________________`.
- [ ] PostgreSQL, object storage and malware scanner became healthy before migration.
- [ ] The approved release tools image applied all migrations exactly once.
- [ ] Staging seed import or approved real-data import was previewed before applying.
- [ ] Import reconciliation counts match the approved source totals.
- [ ] The application and worker started from the same release.
- [ ] `/health/live`, `/health/ready` and `/health/worker` returned success.
- [ ] PostgreSQL reports no unexpected migration, constraint or connection errors.
- [ ] The worker reports a current heartbeat with no unresolved failed jobs.

Record reconciliation totals:

| Record group                        | Approved source | PostgreSQL | Difference | Decision |
| ----------------------------------- | --------------: | ---------: | ---------: | -------- |
| Employees and users                 |                 |            |            |          |
| Candidates and applications         |                 |            |            |          |
| Leave balances and requests         |                 |            |            |          |
| Attendance and timesheets           |                 |            |            |          |
| Overtime, travel and payroll inputs |                 |            |            |          |
| Performance and training            |                 |            |            |          |
| Files and document metadata         |                 |            |            |          |

## Public security checks

- [ ] DNS resolves only to the approved public host.
- [ ] HTTPS uses a valid certificate for the approved hostname.
- [ ] HTTP redirects to HTTPS.
- [ ] The application port, PostgreSQL, MinIO and ClamAV are not publicly reachable.
- [ ] Security headers, request limits and proxy rate limits are present.
- [ ] The reverse proxy replaces untrusted forwarded-address headers.
- [ ] An upload is rejected when malware scanning is unavailable.
- [ ] No secret, raw error, filesystem path or database detail appears in public responses.
- [ ] Protected browser pages launch VIA Portal and protected API requests return JSON 401.
- [ ] Valid Portal SSO reaches a clean `/dashboard` URL with no `portal_token` in URL, storage or logs.
- [ ] Invalid, expired, wrong-domain, wrong-issuer and wrong-audience tokens show a controlled error without a redirect loop.
- [ ] Logout revokes the VIA HR session and returns to `https://portal.via-int.com`.
- [ ] Container restart, disk, database, worker and backup alerts reach the named operator.

## Five-role UAT

Use separate test accounts. Record the tester and evidence for every role. Direct
URL denial must be tested as well as hidden navigation.

| Role         | Required acceptance journey                                                                             | Tester | Result / evidence |
| ------------ | ------------------------------------------------------------------------------------------------------- | ------ | ----------------- |
| Employee     | Profile, onboarding, leave, attendance, timesheet, overtime, travel, objectives, training and own tasks |        |                   |
| Line Manager | Direct-report visibility, leave approval, timesheet review, overtime approval and team performance      |        |                   |
| HR           | Recruitment through onboarding, employee files, HR approvals, policies, cycles, training and reports    |        |                   |
| Accounts     | Travel approval, payroll inputs, overtime ledger and finance-safe reports only                          |        |                   |
| Super Admin  | User access, settings, final reimbursement, audit, backups and organisation administration              |        |                   |

Cross-role acceptance:

- [ ] Employees cannot search for or open another employee's records.
- [ ] Managers see only actual direct reports.
- [ ] HR cannot use Accounts-only payroll operations.
- [ ] Accounts cannot view restricted HR documents or confidential notes.
- [ ] No role can approve its own request where separation of duties applies.
- [ ] Direct URLs and manipulated identifiers are denied by the server.
- [ ] Personal-data exports contain only fields permitted for the active role and are audited.
- [ ] Refresh and deep links preserve the correct page without using browser records as a fallback.

## Backup and rollback rehearsal

- [ ] The selected backup was restored into a new isolated database.
- [ ] Object files were restored into a new empty bucket.
- [ ] Restored table counts and object checksums reconciled.
- [ ] The prior application and worker images were restored together.
- [ ] The rollback decision, start, completion and validation times were recorded.
- [ ] The current release was reapplied successfully after the rehearsal.
- [ ] The restore and rollback met the agreed recovery objectives.

| Evidence                    | Recorded value |
| --------------------------- | -------------- |
| Backup ID                   |                |
| Restore database and bucket |                |
| Restore result and evidence |                |
| Rollback start / complete   |                |
| Recovery duration           |                |
| Data-loss window            |                |
| Rehearsal operator          |                |

## Launch decision

Open defects and accepted limitations:

| Item | Severity | Owner | Decision / target date |
| ---- | -------- | ----- | ---------------------- |
|      |          |       |                        |

Approval means every blocking item above has evidence and there is no unresolved
critical or high-severity defect.

| Responsibility          | Name | Decision         | Date |
| ----------------------- | ---- | ---------------- | ---- |
| HR owner                |      | Approve / Reject |      |
| Accounts owner          |      | Approve / Reject |      |
| Technical owner         |      | Approve / Reject |      |
| Privacy/security owner  |      | Approve / Reject |      |
| Final Super Admin owner |      | Go / No-go       |      |
