# Requests, approvals and email reminders

The Requests & approvals menu provides My Requests for employees in every role, a role-scoped approval inbox, and an HR organisation tracker. Decisions remain in their existing module screens with existing server-side permissions. Timelines only show recorded events; they do not invent historic approval dates.

The background task worker creates approval-required notifications and due-soon/overdue reminders. Deduplication is per recipient, stage, source record version and reminder state, not an email on every background poll. Existing HR leave-submission copies remain informational; they do not replace manager approval.

## Enable email after deployment

1. Apply migrations 0046 and 0047 and run the background worker.
2. Enable Gmail API in the existing Google Cloud project.
3. Add `https://www.googleapis.com/auth/gmail.send` to the OAuth app's Data Access scopes.
4. In the HR organisation tracker or interview connection panel, choose Enable approval emails and reminders. Sign into `hr@via-int.com` and grant sending permission. Calendar connection alone does not enable email.
5. Submit a test request and verify the approval inbox, delivery counts and recipient mailbox.

No inbox-reading scope is requested. Email contains a generic authenticated-app link, not medical, salary or candidate details. Notifications created before activation are not bulk emailed. Pausing email does not pause in-app notifications.

Queued messages await the worker. Sent means Google returned a message reference, not guaranteed inbox delivery or reading. Blocked indicates sender configuration/permission trouble; reconnect after fixing it. Failed needs administrator review. Uncertain means sending may have succeeded: check the sender's Sent folder using the notification Message-ID before any manual resend. Uncertain messages are not automatically resent.

These changes do not themselves deploy configuration, enable Gmail API, or obtain HR consent.
