# VIA HR System PostgreSQL setup

This step adds PostgreSQL plumbing only. Existing pages continue to use the
versioned browser repository until their services are migrated and verified one
module at a time.

Production runs as a Node/Nitro container on Contabo. See
`CONTABO_DEPLOYMENT.md`; this file describes local development only.

## Local database

1. Copy `.env.database.example` to `.env.database`.
2. Replace the local-only password in both `VIA_HR_POSTGRES_PASSWORD` and
   `DATABASE_URL`.
3. Start Docker Desktop.
4. Run `docker compose --env-file .env.database up -d postgres`.
5. Set `DATABASE_URL` and `DATABASE_POOL_SIZE` in the terminal environment used
   for the application and Drizzle commands. Do not prefix either value with
   `VITE_`.
6. Run `npm run db:smoke` and expect `PostgreSQL is reachable`.

The example uses host port `55432` to avoid colliding with another PostgreSQL
installation that may already use the standard `5432` port.

## Schema workflow

- `npm run db:generate` creates a new migration from the Drizzle schema.
- `npm run db:migrate` applies pending migrations to `DATABASE_URL`.
- `npm run db:studio` opens Drizzle Studio for an authorised development database.

Every schema migration is committed. Credentials, `.env.database`, database
volumes and production data are never committed.

## Dropdown ownership

Business lists such as departments, locations, positions, grades, employment
types, cost centres, projects, currencies, activity codes, working times and
public holidays remain managed from VIA HR System. Their PostgreSQL tables and
administration services are introduced in Step H3.2; no page will contain a
separate hard-coded copy after its module is migrated.

Workflow states such as `Pending`, `Approved`, `Rejected` and `Payroll Locked`
are controlled by server workflow rules. They are not ordinary dropdown values
that an administrator can rename or remove because doing so would break approval
logic and audit history.

## Staging

The staging database must be a managed PostgreSQL instance in the approved data
residency region. Store `DATABASE_URL` in the hosting platform's secret manager,
enable encrypted connections and automated backups, then run the same migration
and smoke-test commands. Do not place staging credentials in this repository.

## Deterministic staging dataset

The H3.4 importer reads the versioned browser seed and maps every current seed
record to its PostgreSQL table. It never reads encryption keys from source code.
Set `DATABASE_URL`, `VIA_HR_ACTIVE_FIELD_ENCRYPTION_KEY_ID` and
`VIA_HR_FIELD_ENCRYPTION_KEYS` in the terminal environment before using it.

Run the commands in this order against a migrated, backed-up staging database:

1. `npm run db:seed:preview` performs a read-only reconciliation and shows what
   would be inserted. It writes no organisation, business, audit or batch rows.
2. Review every collection. Resolve any `CONFLICT`; the importer deliberately
   refuses to overwrite an existing deterministic or natural-key record.
3. `npm run db:seed:import` commits the complete dataset in one transaction.
   Sensitive identifiers, salary, bank details and vacancy salary ranges are
   encrypted before PostgreSQL receives them.
4. `npm run db:seed:verify` performs a read-only exact verification. Missing or
   changed seed records produce a non-zero exit code.

Every successful import invocation creates a separate completed import batch and
started/completed audit events. A repeat import inserts no duplicate business
records and records the source records as unchanged. A failed repeat attempt is
recorded as failed when the staging organisation already exists. Newly non-empty
seed collections without an approved table mapping stop the import rather than
being reported as false zero rows.

The seeded employee-document entries create metadata placeholders only. They do
not invent document bytes; actual file migration is handled by the later object
storage step.
