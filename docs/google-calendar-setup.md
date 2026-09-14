# Google Calendar connection

VIA Portal remains the only HR login. Google authorisation connects the shared
`hr@via-int.com` calendar; it does not create an HR login or grant an HR role.

## Administrator preparation

1. Create/select the company Google Cloud project and enable Google Calendar API.
2. Configure the OAuth consent audience for the company's Workspace organisation.
3. Create a Web application OAuth client with this exact authorised redirect URI:
   `https://hr.via-int.com/auth/google-calendar/callback`.
4. Set server-only `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET`.
   Set `APP_ORIGIN=https://hr.via-int.com`. Never use VITE-prefixed secrets.
5. Apply migration 0037 and retain the existing database encryption keys.
6. Configure proxy/access/error logging to omit the entire query string for
   `/auth/google-calendar/callback`. Never log authorisation codes or token bodies.
7. Deploy the application. HR opens Interviews, saves any pending edits, and
   chooses Connect Google Calendar & Meet. Authorise using `hr@via-int.com`.

The callback requires the same active VIA session and HR/Super Admin membership,
consumes a ten-minute single-use PostgreSQL state, checks Google account ownership
and the granted Calendar scope, and encrypts the refresh token in PostgreSQL.
It always redirects to a clean interview URL. Errors do not log provider payloads.

## Acceptance still required

Implementation checkpoint: the HR connection card, OAuth exchange, encrypted
credential persistence and a retry-aware Calendar event adapter are implemented.
The adapter is not yet invoked by the interview workflow or background worker.
Do not describe this checkpoint as working invitation delivery. Durable sync
jobs, per-interview sync status/retry UI, lifecycle wiring and browser acceptance
must be completed before enabling delivery. HR should save interview edits before
connecting; unsaved dialog state is not yet resumed automatically.

Test consent denial, wrong Google account, revoked access, expired VIA session,
replayed state, cross-role denial and successful connection with a real Workspace
account. Test create/reschedule/cancel invitations and Meet links before enabling
production interview delivery. Connecting alone must never imply an invitation
was sent. Calendar invitations are not proof of email inbox delivery.

References:

- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/identity/protocols/oauth2/resources/best-practices
- https://developers.google.com/workspace/calendar/api/guides/create-events
