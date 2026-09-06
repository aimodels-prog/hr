# VIA HR System on Contabo

VIA HR System is deployed as a long-running Node/Nitro service behind the
server's existing HTTPS reverse proxy. It has an isolated PostgreSQL database,
database role, Docker network and persistent volume. PostgreSQL and encrypted
object storage are the authoritative production stores for every operational
module. VIA Portal is the only production login authority. The development
identity preview is disabled in production, and this application does not
implement its own Google OAuth or normal password login.

## Required decisions before production data

- Confirm the Contabo server country and that it satisfies VIA's HR-data
  residency requirements.
- Confirm available CPU, RAM and disk headroom alongside the other applications.
- Identify the existing reverse proxy and an unused loopback port.
- Public careers hostname: `careers.via-int.com`.
- Private staff-system hostname: `hr.via-int.com`.
- Agree backup retention, off-server backup destination and restore owner.

Use [the release acceptance record](docs/CONTABO_RELEASE_ACCEPTANCE.md) for the
staging rehearsal and every production release. A release is not complete until
the automated evidence, five-role UAT, restore drill, rollback rehearsal and
named approvals are recorded there.

Do not load real passport, bank, salary, medical or employee records until these
decisions, VIA Portal SSO, encrypted backup and access-control checks are complete.

## Isolation from other applications

- Use `compose.production.yaml`; do not add VIA services to another application's
  Compose file.
- Keep the database on the internal `backend` network. The production Compose
  file publishes no PostgreSQL port.
- Give VIA its own database, PostgreSQL role, password and named volume.
- Keep both optional host health ports bound to `127.0.0.1`. The private staff container uses the
  `via-hr-app` proxy alias and the public careers container uses `via-careers-app`. Both share VIA
  HR's PostgreSQL and object storage, but each container rejects the other surface's routes.
- Never reuse another application's database credentials or encryption keys.

The applications may share the Contabo host and reverse proxy. They must not
share tables, credentials, writable volumes or public internal-service ports.

## VIA Portal single sign-on

VIA Portal authenticates the person; VIA HR remains responsible for deciding what that person may
see and do. The Portal must launch this application with a signed, 120-second HS256 token whose
issuer is `via-portal`, audience and `appSlug` are `via-hr`, and email belongs to `via-int.com`.
Unknown Portal role values never grant elevated HR access. Employee, Line Manager, HR, Accounts
and Super Admin access continue to come from VIA HR user management.

The initial production Super Admin identities are explicitly controlled by
`VIA_HR_SUPER_ADMIN_EMAILS`. A listed `@via-int.com` address receives Employee and Super Admin
access atomically on its first verified Portal sign-in, and the assignment is recorded as a
critical security audit event. Portal JWT role text cannot grant this access. Removing an address
from the environment does not revoke an already assigned role; revoke it deliberately in User
Management so the change and reason remain auditable.

Production URLs:

- Public vacancies and applications: `https://careers.via-int.com`
- Private staff origin: `https://hr.via-int.com`
- Portal callback: `https://hr.via-int.com/auth/portal/callback`
- Post-login dashboard: `https://hr.via-int.com/dashboard`
- Post-logout destination: `https://portal.via-int.com`

Before deployment:

- Set `APP_ORIGIN=https://hr.via-int.com` and
  `VIA_HR_CAREERS_ORIGIN=https://careers.via-int.com`, without trailing paths.
- Register `https://hr.via-int.com/auth/portal/callback` in VIA Portal as the exact callback URL.
- Generate one dedicated random secret of at least 32 bytes and transfer it to both systems through
  the approved secret channel. Put it only in the owner-readable `.env.production`; never commit it.
- Keep `VIA_HR_ALLOW_PASSWORD_LOGIN=false`. VIA HR has no normal production password login and
  does not implement Google OAuth directly.
- Configure the existing Caddy gateway from `deploy/contabo/Caddyfile.via-hr.example`. Its access-log
  filter replaces the short-lived `portal_token` value with `REDACTED` before writing the event.

After successful verification, VIA HR replaces the callback URL immediately with `/dashboard`,
creates an opaque database-backed session valid for no more than eight hours, and stores only a
hash of the session token. The `__Host-via_hr_session` cookie is HttpOnly, Secure, SameSite=Lax and
Path=/. Signing out revokes only this local session and returns the browser to VIA Portal.

## First deployment

The commands below assume the repository is deployed to `/opt/via-hr-system` and
Docker Engine with the Compose plugin is already installed.

1. Clone or update the approved release in `/opt/via-hr-system`. Confirm the
   GitHub `VIA HR quality gate` passed for the exact commit before continuing.
2. Copy `.env.production.example` to `.env.production`.
3. Generate a long random database password. Put the same URL-encoded password
   in `VIA_HR_DATABASE_URL` and keep the raw value in
   `VIA_HR_POSTGRES_PASSWORD`.
4. Generate a separate 32-byte field-encryption key with
   `openssl rand -base64 32`. Store it under a versioned key ID in
   `VIA_HR_FIELD_ENCRYPTION_KEYS` and set that ID as
   `VIA_HR_ACTIVE_FIELD_ENCRYPTION_KEY_ID`. Never reuse the database password
   or remove an older key while records still depend on it.
   Generate the separate Portal SSO secret, configure the final HR origin and callback values, and
   confirm the same secret is active in VIA Portal before continuing.
5. Run `chmod 600 .env.production`.
6. Run VIA's fail-fast production preflight. It validates configuration without
   printing secrets and stops on placeholders, mismatched credentials, unsafe
   network binding, reused encryption keys, mutable image tags or an on-server
   backup destination:

   ```bash
   npm run production:preflight
   ```

7. Validate the final Compose interpolation without starting containers:

   ```bash
   docker compose --env-file .env.production -f compose.production.yaml config --quiet
   ```

8. Build the exact release images, including the migration tools image:

   ```bash
   docker compose --env-file .env.production -f compose.production.yaml build tools app careers-app background-worker
   ```

9. Start only the private dependencies and wait until they are healthy:

   ```bash
   docker compose --env-file .env.production -f compose.production.yaml up -d postgres object-storage malware-scanner
   docker compose --env-file .env.production -f compose.production.yaml ps
   ```

10. Apply migrations once from the release being deployed. The app and worker
    must not be started against an unmigrated database:

```bash
docker compose --env-file .env.production -f compose.production.yaml --profile tools run --rm tools npm run db:migrate
```

11. For a new staging environment, preview, import and verify the deterministic
    VIA dataset. Do not seed a live production database that will receive an
    approved real-data import:

    ```bash
    docker compose --env-file .env.production -f compose.production.yaml --profile tools run --rm tools npm run db:seed:preview
    docker compose --env-file .env.production -f compose.production.yaml --profile tools run --rm tools npm run db:seed:import
    docker compose --env-file .env.production -f compose.production.yaml --profile tools run --rm tools npm run db:seed:verify
    ```

12. Start the web application and durable background worker:

    ```bash
    docker compose --env-file .env.production -f compose.production.yaml up -d app careers-app background-worker
    ```

13. Confirm the complete stack is healthy:

```bash
docker compose --env-file .env.production -f compose.production.yaml ps
curl --fail http://127.0.0.1:8082/health/live
curl --fail http://127.0.0.1:8082/health/ready
curl --fail http://127.0.0.1:8082/health/worker
curl --fail http://127.0.0.1:8083/health/ready
```

14. Back up `/opt/via/proxy/Caddyfile`, append the complete block from
    `deploy/contabo/Caddyfile.via-hr.example`, validate it inside the existing `via-caddy` container,
    and reload Caddy only after validation succeeds. Caddy obtains and renews the
    `careers.via-int.com` and `hr.via-int.com` TLS certificates after both DNS records point to this
    server.
15. Allow public firewall access only to SSH, HTTP and HTTPS as required by the
    existing server policy. Do not open ports `3000`, `5432` or VIA's loopback
    port to the internet.

## Attendance network verification

Production attendance uses two independent checks: the employee must be inside
an office geofence and the request must arrive through an office network saved
in Attendance Administration. Record each office's public egress address as a
single-address CIDR such as `203.0.113.24/32`, or use the approved corporate CIDR
provided by the network administrator.

Keep `VIA_HR_ATTENDANCE_NETWORK_ENFORCEMENT=true` and
`VIA_HR_TRUST_PROXY=true` in production. The reverse proxy must overwrite
`X-Real-IP`; it must never trust an `X-Real-IP` value supplied by the browser. The selected Caddy
configuration sets `X-Real-IP` from the direct remote address. Caddy manages the standard
forwarding headers itself. If another trusted load balancer sits in front of Caddy, define its
trusted proxy addresses explicitly before changing this configuration.

## ZKTeco door-terminal bridge

The ZKTeco terminal is never exposed to Contabo or the public internet. The VIA Attendance
Connector runs on one always-on Windows office computer or NAS, reads the terminal on LAN port
4370, and sends signed batches outbound to:

```text
POST https://hr.via-int.com/api/integrations/zkteco/punches
```

The preferred installation does not ask an administrator to copy a permanent secret. In VIA HR,
HR or Super Admin registers the terminal under **Attendance Administration > Door Terminals** and
selects **Connect**. VIA HR displays a one-time code that expires after 15 minutes. Run
`deploy/Install VIA Attendance.cmd` on the office computer, open the guided setup page, enter the
terminal details and the one-time code, then select **Connect**. The connector exchanges the code
once for a terminal-specific credential and stores it only on that office computer.

The installer starts the connector automatically with Windows and adds a **VIA
Attendance** desktop shortcut. The guided page can search the local network for common ZKTeco
terminals; UDP-only or unusual networks may still require the terminal IP, port and COMKey to be
entered manually. The COMKey and fingerprint templates stay in the office and are never sent to
Contabo.

`VIA_HR_ZKTECO_INGEST_SECRET` remains a deployment-managed compatibility credential for an older
collector. It must still be a dedicated value of at least 32 random characters and must not equal
the Portal SSO, database, object-storage, field-encryption or backup secret. New connectors use the
one-time pairing flow and do not receive this global credential.

Exact VIA email and employee-number matches are automatic; all other terminal IDs remain in the HR
review queue until HR explicitly matches them. Repeated pulls are safe because both the connector
and PostgreSQL use a deterministic event identifier.

This is the selected first production anti-spoofing control. Managed-device or
trusted-mobile attestation can be added later without replacing the network and
geofence evidence already stored with each immutable punch event.

## Loading the staging dataset

The runtime image intentionally contains only the built application. The
`tools` Compose profile uses the private build stage and database network for
migrations and the one-time staging importer without publishing PostgreSQL.

After taking and verifying a database backup, run:

```bash
docker compose --env-file .env.production -f compose.production.yaml --profile tools run --rm tools npm run db:migrate
docker compose --env-file .env.production -f compose.production.yaml --profile tools run --rm tools npm run db:seed:preview
docker compose --env-file .env.production -f compose.production.yaml --profile tools run --rm tools npm run db:seed:import
docker compose --env-file .env.production -f compose.production.yaml --profile tools run --rm tools npm run db:seed:verify
```

Do not run the import when preview reports a conflict. Never place a database
password or field-encryption key directly in the command or Git history; the
tools container receives them from the protected `.env.production` file. The
importer logs only the database host/name, checksum, counts and batch ID.

## Request and upload security

- The application and Caddy both enforce request limits. Keep Caddy's `request_body max_size`
  aligned with `VIA_HR_MAX_REQUEST_BYTES`; the default is 16 MB so a 10 MB file can be carried in
  an encoded server request.
- All uploaded files pass through the private ClamAV service before encryption,
  object storage or PostgreSQL metadata creation. Production fails closed when
  the scanner is unavailable or returns an uncertain result.
- ClamAV signatures persist in the dedicated scanner volume and the scanner has
  outbound access only to retrieve definition updates. It publishes no host
  port. Alert if the scanner is unhealthy or its definitions stop updating.
- Run `npm run security:audit` before each release. A moderate, high or critical
  dependency advisory blocks release until reviewed and resolved.
- The application adds CSP, anti-framing, MIME-sniffing, referrer, permissions
  and HSTS headers. The reverse proxy replaces forwarded-address headers and
  applies an additional per-IP request limit.

## Health endpoints

- `/health/live` confirms the Node service can answer requests.
- `/health/ready` confirms the service can reach PostgreSQL.

Neither endpoint returns database addresses, credentials or raw errors. Container
or external monitoring should use readiness for traffic decisions and liveness
for process restarts.

## Deploying an update

1. Record the currently deployed Git commit and image tag.
2. Back up PostgreSQL and confirm the backup reached the encrypted off-server
   destination.
3. Pull the approved release.
4. Review pending migration SQL before applying it.
5. Build the new image with a unique `VIA_HR_IMAGE_TAG`.
6. Run `npm run production:preflight` and stop if it reports any failure.
7. Run database migrations once from the approved release.
8. Recreate both `app` and `background-worker`, then wait for `/health/ready`
   and `/health/worker` to return 200.
9. Smoke-test the public portal and one permitted page for every affected role.

Never run `docker compose down -v`: the `-v` flag deletes the PostgreSQL volume.

## Rollback

- Application rollback: restore the previous Git commit/image tag and recreate
  both the `app` and `background-worker` services so they run the same release.
- Database rollback: use the reviewed reverse migration only when it is proven
  safe. If a destructive migration cannot be reversed, stop writes and restore
  the verified pre-deployment backup.
- Record the incident, operator, reason, timestamps and validation results.

The production database must not silently fall back to browser storage after a
migrated module fails. Errors must remain visible until the database problem is
resolved or the entire approved release is rolled back.

## Backups and monitoring

- Configure the `VIA_HR_BACKUP_*` values in `.env.production` for a bucket hosted
  outside the Contabo VPS. The backup key must be different from the database,
  MinIO and field-encryption credentials.
- Run an encrypted PostgreSQL and object backup daily and before every migration:

  ```bash
  docker compose --env-file .env.production -f compose.production.yaml --profile administration run --rm backup
  ```

- Apply retention after confirming a recent backup completed. The command only
  removes backup objects older than `VIA_HR_BACKUP_RETENTION_DAYS`:

  ```bash
  docker compose --env-file .env.production -f compose.production.yaml --profile administration run --rm backup npm run backup:prune
  ```

- Test restoration into a newly created, empty database whose name includes
  `restore`, `drill`, `test` or `scratch`. Never point the drill at the live URL.
  Use a separate empty object bucket when `--restore-objects` is supplied:

  ```bash
  docker compose --env-file .env.production -f compose.production.yaml --profile administration run --rm \
    -e VIA_HR_RESTORE_DATABASE_URL='postgresql://.../via_hr_restore_drill' \
    -e VIA_HR_RESTORE_OBJECT_STORAGE_BUCKET='via-hr-restore-drill' \
    backup npm run backup:restore-drill -- --backup-id BACKUP_ID --restore-objects
  ```

- Record the backup ID, completion output, restore-drill output, operator and
  reconciliation decision in the deployment log. A locally stored copy is not
  accepted as the off-server backup.
- Monitor disk space, memory, container restarts, `/health/ready`, PostgreSQL
  connection usage and backup completion.
- Configure log rotation; the production Compose file limits each container to
  five 10 MB JSON log files.

All production uploads already use permission-controlled, malware-scanned,
encrypted object storage with PostgreSQL metadata. Files must never be placed in
the application's read-only container or another application's volume.
