# Workflow controls: findings 6–10

Implemented locally; not deployed or migrated against production.

- Leave: individual self-adjustments are denied. Another authorised HR/Super Admin must perform the adjustment. Requests, approvals, adjustments, rollover, onboarding entitlement and overtime leave credits use the configured entitlement-year boundary. Cross-year requests must be split; amendments cannot transfer an existing deduction to another entitlement year. The balance screen uses the organisation timezone and shared year helper.
- Travel: pending-stage labels name Manager, HR and Finance as applicable. Reminders use stage-specific recipients, links and deduplication keys; closure reminders include Accounts and Super Admin. Existing database status codes are retained for compatibility.
- Training: transaction-scoped advisory locking gives concurrent duplicate submissions a clear response. A partial unique index independently prevents duplicate open employee/course requests.
- Audit: interactive retrieval still caps at 5,000, with a visible limit warning; CSV queries all matching permission-filtered records and audits the export count.
- Business authority confirmed by the user: Finance (the existing Accounts role) approves payroll; HR completes offboarding. Payroll preparers and exception reviewers cannot approve that period. Offboarding retains clearance, last-working-date and own-case restrictions.

## Deployment and acceptance

Apply migration `0035_shallow_cassandra_nova.sql` after the existing migrations. It adds payroll preparer provenance and the open-training uniqueness constraint. If historical open training duplicates exist, migration fails explicitly: reconcile them with HR instead of deleting records automatically. Existing prepared payroll periods without provenance have a Collect Inputs action to prepare again before independent approval.

Run the PostgreSQL integration suite against an isolated migrated test database. Added/updated tests cover concurrent training requests, audit exports exceeding 5,000 events, Finance independence and HR offboarding. These tests were skipped locally because a dedicated test database was not configured. Browser role journeys and deployed worker delivery still need acceptance testing.

Review historical leave balances for non-January organisations before deployment: this code change does not automatically rewrite prior deductions or entitlements that may have been assigned to the wrong year.

Local verification: typecheck, lint and production build passed; the automated suite reported 321 passed, 26 skipped and zero failed. No Git push or Contabo deployment performed for these changes.
