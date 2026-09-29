import assert from "node:assert/strict";
import postgres from "postgres";

// Opt test employees into biometric charts/corrections explicitly, never in production seeds.
export async function configureAttendanceFixture() {
  const url = process.env["VIA_HR_TEST_DATABASE_URL"];
  if (!url) return;
  assert.match(new URL(url).pathname.toLowerCase(), /(test|scratch)/);
  const sql = postgres(url, { max: 1 });
  try {
    const people = await sql<{ id: string; organisation_id: string; location_id: string }[]>`
      SELECT id, organisation_id, location_id FROM employees
      WHERE lower(work_email) IN ('omar.rahman@via-int.com', 'rana.nair@via-int.com')
        AND archived_at IS NULL
      ORDER BY work_email
    `;
    assert.equal(people.length, 2, "Import the deterministic browser seed first");
    assert.equal(people[0]!.organisation_id, people[1]!.organisation_id);
    const policy = {
      headOfficeLocationId: people[0]!.location_id,
      effectiveFrom: "2020-01-01",
      revision: 1,
      assignments: people.map((person) => ({
        employeeId: person.id,
        effectiveFrom: "2020-01-01",
        mode: "Head Office biometric",
        source: "override",
      })),
    };
    await sql`UPDATE app_settings SET additional_settings = additional_settings ||
      ${sql.json({ attendanceTracking: policy })}::jsonb
      WHERE organisation_id = ${people[0]!.organisation_id}`;
  } finally {
    await sql.end();
  }
}
