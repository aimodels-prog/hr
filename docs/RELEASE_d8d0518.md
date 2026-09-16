# Contabo terminal administration hotfix — 2026-09-16

- Active release: `/opt/via/apps/hr/releases/d8d0518`; `current` points there.
- Rollback release retained: `/opt/via/apps/hr/releases/a686acf`.
- Hotfix commit `d8d0518` was created in an isolated detached worktree at
  `C:\Users\Dell\AppData\Local\Temp\via-hr-terminal-release-79e9537c`.
  It is based on `a686acf` and contains only the terminal refresh/state fix,
  request timeout helper and its unit tests. It has not been pushed to GitHub.
- Main workspace's unrelated unfinished changes were not deployed; main HEAD
  remains `a686acf`. The same hotfix remains present in its working files.
- Staff/careers runtime image: `via-hr-system:d8d0518`.
- Worker: `via-hr-system-worker:d8d0518`; tools: `via-hr-system-tools:d8d0518`.
- Existing production environment retained, changing only VIA_HR_IMAGE_TAG.
  Existing live Compose configuration preserved (repository difference was CRLF).
- Existing CV processor image also tagged `via-hr-cv-processor:d8d0518` without
  restarting it. Database, storage, scanner, proxy and other apps were not restarted.
- No migrations, pairing changes, attendance replay or employee mapping changes.

## Checks

- Linux production build, typecheck and lint passed.
- Exact-image unit suite: 357 tests, 331 passed, 26 optional integration tests
  skipped, zero failed. Initial run had one missing-file failure because Docker
  excludes `.github`; rerun mounted release `.github` read-only and passed.
- Local focused browser tests before packaging: timeout/retry and terminal user
  matching passed. These ran in the working tree including the pending UI changes;
  no authenticated production browser session was used or fabricated.
- All three updated services healthy; public HR readiness/worker health and
  careers home returned success. HR root redirects to dashboard, which redirects
  unauthenticated users to VIA Portal.
- Deployed attendance asset contains the new terminal timeout message.
- Live read-only database check: Main Entrance F18 remains active, paired, not
  archived. 13 Applied and 72 Unmatched Employee punches remain.
- Last successful terminal receipt remains 2026-09-14 19:35:03 UTC. This hotfix
  repairs the administration page; it does not claim newer device synchronisation.

Server build/check logs: `/opt/via/apps/hr/shared/terminal-hotfix-d8d0518-*.log`.
User next step: hard-refresh HR Attendance → Door Terminals and inspect matching
list. Do not re-register, re-pair or clear terminal logs.

## Rollback

Use the retained a686acf environment and Compose file to recreate only app,
careers-app and background-worker with `up -d --no-deps --wait`; verify health,
then repoint `current` to a686acf. No schema rollback is needed.
