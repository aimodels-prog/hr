import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { closeDatabaseConnection, getDatabaseClient } from "../src/lib/db/client.ts";
import { listVacancyPublicationDatesForOrganisation } from "../src/lib/db/repositories/vacancy-publication.repository.server.ts";
import { organisations } from "../src/lib/db/schema/organisation.ts";
import { auditEvents } from "../src/lib/db/schema/system.ts";
import { sortPublicVacanciesNewestFirst } from "../src/lib/data/public-vacancy-date.ts";

const databaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (databaseUrl) process.env["DATABASE_URL"] = databaseUrl;

class TestRollback extends Error {}

test(
  "first public posting orders vacancies, ignoring draft age, edits and reopening",
  { skip: !databaseUrl },
  async () => {
    assert.match(new URL(databaseUrl!).pathname, /(test|scratch)/i);
    const db = getDatabaseClient();
    try {
      const [organisation] = await db.select({ id: organisations.id }).from(organisations).limit(1);
      assert.ok(organisation, "Seed the isolated test database first.");
      const newlyPostedId = randomUUID();
      const olderPostedId = randomUUID();
      try {
        await db.transaction(async (tx) => {
          await tx.insert(auditEvents).values([
            {
              organisationId: organisation.id,
              actorDisplayName: "Vacancy publication test",
              action: "update",
              module: "recruitment",
              entityType: "vacancy",
              entityId: newlyPostedId,
              afterSummary: { status: "Open" },
              occurredAt: "2026-01-01T09:00:00.000Z",
            },
            {
              organisationId: organisation.id,
              actorDisplayName: "Vacancy publication test",
              action: "publish",
              module: "recruitment",
              entityType: "vacancy",
              entityId: olderPostedId,
              afterSummary: { status: "Open" },
              occurredAt: "2026-02-01T09:00:00.000Z",
            },
            {
              organisationId: organisation.id,
              actorDisplayName: "Vacancy publication test",
              action: "change-status",
              module: "recruitment",
              entityType: "vacancy",
              entityId: newlyPostedId,
              afterSummary: { status: "Open" },
              occurredAt: "2026-03-01T09:00:00.000Z",
            },
            {
              organisationId: organisation.id,
              actorDisplayName: "Vacancy publication test",
              action: "change-status",
              module: "recruitment",
              entityType: "vacancy",
              entityId: newlyPostedId,
              afterSummary: { status: "Open" },
              occurredAt: "2026-04-01T09:00:00.000Z",
            },
          ]);
          const dates = await listVacancyPublicationDatesForOrganisation(organisation.id, tx);
          assert.equal(dates.get(newlyPostedId), "2026-03-01T09:00:00.000Z");
          assert.equal(dates.get(olderPostedId), "2026-02-01T09:00:00.000Z");
          const sorted = sortPublicVacanciesNewestFirst([
            { id: olderPostedId, publishedAt: dates.get(olderPostedId) },
            { id: newlyPostedId, publishedAt: dates.get(newlyPostedId) },
          ]);
          assert.equal(sorted[0]?.id, newlyPostedId);
          throw new TestRollback();
        });
        assert.fail("The isolated test transaction must roll back.");
      } catch (error) {
        if (!(error instanceof TestRollback)) throw error;
      }
    } finally {
      await closeDatabaseConnection();
    }
  },
);
