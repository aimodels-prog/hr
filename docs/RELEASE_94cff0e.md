# Contabo release 94cff0e — 2026-09-14

- Active release: `/opt/via/apps/hr/releases/94cff0e`; `current` updated.
- Previous release `f048e5d` and images retained for rollback.
- Linux application, tools and worker images built successfully.
- Encrypted database backup, verified by decryption before migration:
  `/opt/via/apps/hr/shared/predeploy-backups/release-94cff0e-1PuK5YIK`.
  This is a local backup, not an off-server backup or full restore drill.
- Migration 0037 applied successfully.
- Only HR app, careers app and background worker recreated; other apps and
  shared proxy/database/object-storage services were not restarted.
- All three HR containers healthy. Public staff readiness, worker health and
  careers homepage returned 200 after a brief proxy startup 503.
- Unauthenticated dashboard redirects to VIA Portal; Calendar API returns 401 JSON.
- Nine targeted Gemini/Calendar tests passed in the Linux tools image.

Google credentials remain local and were not copied to Contabo. The Calendar
connection remains disabled pending completion of interview sync jobs/status UI,
callback logging and security-header review, and real Google/browser acceptance.
The existing `form-action 'self'` policy must be checked for OAuth form redirect
compatibility before enabling connection. Neither invitation delivery nor full
browser acceptance is claimed verified by this deployment.
