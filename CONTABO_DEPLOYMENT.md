# VIA HR System on Contabo

VIA HR System is deployed as a long-running Node/Nitro service behind the
server's existing HTTPS reverse proxy. It has an isolated PostgreSQL database,
database role, Docker network and persistent volume. Existing VIA pages still
use browser storage until the numbered database migration steps are completed.

## Required decisions before production data

- Confirm the Contabo server country and that it satisfies VIA's HR-data
  residency requirements.
- Confirm available CPU, RAM and disk headroom alongside the other applications.
- Identify the existing reverse proxy and an unused loopback port.
- Agree the subdomain, for example `hr.via-international.com`.
- Agree backup retention, off-server backup destination and restore owner.

Do not load real passport, bank, salary, medical or employee records until these
decisions and Google Workspace authentication are complete.

## Isolation from other applications

- Use `compose.production.yaml`; do not add VIA services to another application's
  Compose file.
- Keep the database on the internal `backend` network. The production Compose
  file publishes no PostgreSQL port.
- Give VIA its own database, PostgreSQL role, password and named volume.
- Bind the application to `127.0.0.1` so only the host reverse proxy can reach it.
- Never reuse another application's database credentials or encryption keys.

The applications may share the Contabo host and reverse proxy. They must not
share tables, credentials, writable volumes or public internal-service ports.

## First deployment

The commands below assume the repository is deployed to `/opt/via-hr-system` and
Docker Engine with the Compose plugin is already installed.

1. Clone or update the approved release in `/opt/via-hr-system`.
2. Copy `.env.production.example` to `.env.production`.
3. Generate a long random database password. Put the same URL-encoded password
   in `VIA_HR_DATABASE_URL` and keep the raw value in
   `VIA_HR_POSTGRES_PASSWORD`.
4. Generate a separate 32-byte field-encryption key with
   `openssl rand -base64 32`. Store it under a versioned key ID in
   `VIA_HR_FIELD_ENCRYPTION_KEYS` and set that ID as
   `VIA_HR_ACTIVE_FIELD_ENCRYPTION_KEY_ID`. Never reuse the database password
   or remove an older key while records still depend on it.
5. Run `chmod 600 .env.production`.
6. Validate configuration without starting containers:

   ```bash
   docker compose --env-file .env.production -f compose.production.yaml config --quiet
   ```

7. Build and start the private database and application:

   ```bash
   docker compose --env-file .env.production -f compose.production.yaml up -d --build
   ```

8. Confirm both services are healthy:

   ```bash
   docker compose --env-file .env.production -f compose.production.yaml ps
   curl --fail http://127.0.0.1:8082/health/live
   curl --fail http://127.0.0.1:8082/health/ready
   ```

9. Configure the existing reverse proxy using
   `deploy/contabo/nginx-via-hr.conf.example` as a reference. Replace the example
   hostname and port, validate the proxy configuration, then obtain or attach the
   site's TLS certificate.
10. Allow public firewall access only to SSH, HTTP and HTTPS as required by the
    existing server policy. Do not open ports `3000`, `5432` or VIA's loopback
    port to the internet.

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
6. Run database migrations once from the approved release.
7. Start the updated application and wait for `/health/ready` to return 200.
8. Smoke-test the public portal and one permitted page for every affected role.

Never run `docker compose down -v`: the `-v` flag deletes the PostgreSQL volume.

## Rollback

- Application rollback: restore the previous Git commit/image tag and recreate
  only the `app` service.
- Database rollback: use the reviewed reverse migration only when it is proven
  safe. If a destructive migration cannot be reversed, stop writes and restore
  the verified pre-deployment backup.
- Record the incident, operator, reason, timestamps and validation results.

The production database must not silently fall back to browser storage after a
migrated module fails. Errors must remain visible until the database problem is
resolved or the entire approved release is rolled back.

## Backups and monitoring

- Run encrypted PostgreSQL backups at least daily and before every migration.
- Copy backups off the Contabo VPS; a backup stored only beside the live database
  does not protect against host or disk loss.
- Test a restoration into an isolated database on a scheduled basis.
- Monitor disk space, memory, container restarts, `/health/ready`, PostgreSQL
  connection usage and backup completion.
- Configure log rotation; the production Compose file limits each container to
  five 10 MB JSON log files.

Object uploads will move to permission-controlled object storage in the later file
storage step. They must not be placed in the application's read-only container.
