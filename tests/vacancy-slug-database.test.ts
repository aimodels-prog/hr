import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import postgres from "postgres";

import { closeDatabaseConnection } from "../src/lib/db/client.ts";
import { listVacanciesForOrganisation } from "../src/lib/db/repositories/vacancy.repository.server.ts";

const databaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (databaseUrl) process.env["DATABASE_URL"] = databaseUrl;

test(
  "PostgreSQL assigns stable, unique public links, including concurrent vacancies",
  { skip: !databaseUrl },
  async () => {
    assert.match(new URL(databaseUrl!).pathname, /(test|scratch)/i);
    const sql = postgres(databaseUrl!, { max: 8, prepare: false });
    const ids: string[] = [];
    try {
      const [seed] = await sql`
      SELECT id, organisation_id FROM vacancies
      WHERE archived_at IS NULL ORDER BY created_at LIMIT 1
    `;
      assert.ok(seed, "Seed the isolated test database first.");
      const insert = async (title: string) => {
        const id = randomUUID();
        ids.push(id);
        const [row] = await sql`
        INSERT INTO vacancies (
          id, created_by, updated_by, organisation_id, title, department_id, location_id,
          position_id, grade_id, employment_type_id, status, summary, responsibilities,
          requirements, hiring_reason, education, minimum_experience, skills
        )
        SELECT ${id}, created_by, updated_by, organisation_id, ${title}, department_id,
          location_id, position_id, grade_id, employment_type_id, 'Open', summary,
          responsibilities, requirements, hiring_reason, education, minimum_experience, skills
        FROM vacancies WHERE id = ${seed.id}
        RETURNING id, public_slug
      `;
        assert.ok(row);
        return row;
      };
      // Backfilled and future records must all have valid, organisation-unique references.
      const existing =
        await sql`SELECT public_slug FROM vacancies WHERE organisation_id = ${seed.organisation_id}`;
      assert.equal(new Set(existing.map((row) => row.public_slug)).size, existing.length);
      for (const row of existing) assert.match(row.public_slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);

      const unique = randomUUID().slice(0, 8);
      const base = `technical-director-${unique}`;
      const duplicates = await Promise.all(
        Array.from({ length: 8 }, () => insert(`Technical Director ${unique}`)),
      );
      assert.deepEqual(
        duplicates.map((row) => row.public_slug).sort(),
        [base, ...Array.from({ length: 7 }, (_, index) => `${base}-${index + 2}`)].sort(),
      );
      const [first] =
        await sql`SELECT id FROM vacancies WHERE public_slug = ${base} AND organisation_id = ${seed.organisation_id}`;
      const [renamed] = await sql`
      UPDATE vacancies SET title = 'Renamed Director', archived_at = now(),
        record_version = record_version + 1, updated_at = now()
      WHERE id = ${first.id} RETURNING public_slug
    `;
      assert.equal(renamed.public_slug, base);
      assert.equal((await insert(`Technical Director ${unique}`)).public_slug, `${base}-9`);
      await assert.rejects(
        sql`UPDATE vacancies SET public_slug = ${`changed-${unique}`}, record_version = record_version + 1 WHERE id = ${first.id}`,
        /public link cannot be changed/,
      );

      assert.match((await insert("Applied")).public_slug, /^applied-role(?:-\d+)?$/);
      assert.equal(
        (await insert(`  Ingénieur — QA/QC (${unique})  `)).public_slug,
        `ingenieur-qa-qc-${unique}`,
      );
      assert.match((await insert("مهندس")).public_slug, /^role(?:-\d+)?$/);
      assert.equal(
        (await insert("d73be084-39ed-4185-bb3a-e0619e69ea14")).public_slug,
        "d73be084-39ed-4185-bb3a-e0619e69ea14-role",
      );
      const long = await insert(`${"x".repeat(100)} - Engineer`);
      assert.match(long.public_slug, /^x{80}(?:-\d+)?$/);
      const [otherOrganisation] =
        await sql`SELECT via_hr_allocate_vacancy_slug(${randomUUID()}::uuid, ${`Technical Director ${unique}`}) AS slug`;
      assert.equal(otherOrganisation.slug, base);

      const listed = await listVacanciesForOrganisation(String(seed.organisation_id), false);
      for (const row of duplicates) {
        const vacancy = listed.find((item) => item.id === row.id);
        assert.equal(vacancy?.publicSlug, row.public_slug);
        assert.equal(vacancy?.databaseId, row.id, "Application identities must remain UUIDs.");
      }
    } finally {
      await sql`DELETE FROM vacancies WHERE id IN ${sql(ids.length ? ids : [randomUUID()])}`;
      await sql.end();
      await closeDatabaseConnection();
    }
  },
);
