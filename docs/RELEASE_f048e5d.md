# Contabo release f048e5d — 2026-09-13

- Server: 169.58.112.30; SSH uses port 2222.
- Active release: `/opt/via/apps/hr/releases/f048e5d`; `current` points there.
- Previous release: `1e9e0c2`, retained for recovery.
- Staff and careers images: `via-hr-system:f048e5d`.
- Worker image: `via-hr-system-worker:f048e5d`.
- Unchanged production CV processor and infrastructure were not restarted.
- Applied migrations 0033–0036; production migration count is 37.
- Encrypted, owner-only local pre-migration database backup:
  `/opt/via/apps/hr/shared/predeploy-backups/release-f048e5d-WoddfHB9`.
  This is not an off-server disaster-recovery backup or a completed restore drill.

## Verification

- Linux application/tools/worker builds passed on Contabo.
- Isolated PostgreSQL/MinIO suite initially reported 349 passed, 2 failed, 2 skipped.
- Both failures were corrected and retested: missing test leave-year settings, and missing version/tenant guards on CV extraction and vacancy-match tables.
- A separate CV processor enabled the skipped CV tests. CV intake passed. The public recruitment journey passed on a fresh test database after correcting a Buffer/Uint8Array assertion (test-only Git commit `4775731`).
- This was a combination of full-suite and targeted reruns, not one clean full-suite rerun. Full browser acceptance was not run; GitHub's earlier MinIO startup problem is not claimed resolved.
- Staff `/health/live`, `/health/ready`, `/health/worker`, and careers `/` returned HTTP 200 after restart.
- HR root redirected to `/dashboard`; unauthenticated dashboard redirected to VIA Portal SSO.
- Updated staff, careers and worker containers reported healthy.
- Other application container uptimes remained unchanged.

Temporary `via-hr-acceptance-*` containers were stopped, not deleted; test data and logs remain available for investigation. No production test data was created.

Historical non-January leave balances still require reconciliation if previously calculated incorrectly. Existing offers may require independent approval/dispatch evidence, and existing prepared payroll without preparer provenance requires recollection before approval.
