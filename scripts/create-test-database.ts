import postgres from "postgres";

const sourceUrl = process.env["DATABASE_URL"]?.trim();
const targetName = process.argv[2]?.trim();
if (!sourceUrl) throw new Error("DATABASE_URL is required.");
if (!targetName || !/(test|scratch)/i.test(targetName) || !/^[a-z0-9_]+$/i.test(targetName)) {
  throw new Error("Use an explicit database name containing test or scratch.");
}
const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/postgres";
const sql = postgres(adminUrl.toString(), { max: 1, prepare: false });
try {
  const existing = await sql<{ exists: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = ${targetName}) AS exists
  `;
  if (!existing[0]?.exists) {
    await sql.unsafe(`CREATE DATABASE "${targetName}"`);
    process.stdout.write(`Created ${targetName}.\n`);
  } else {
    process.stdout.write(`${targetName} already exists.\n`);
  }
} finally {
  await sql.end();
}
