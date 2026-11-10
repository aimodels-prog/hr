import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, isNull, sql } from "drizzle-orm";

import { closeDatabaseConnection, getDatabaseClient } from "../src/lib/db/client.ts";
import { employees, users } from "../src/lib/db/schema/employee.ts";
import { appSettings, organisations } from "../src/lib/db/schema/organisation.ts";
import { auditEvents } from "../src/lib/db/schema/system.ts";
import { parseApprovalRoutingSettings } from "../src/lib/data/approval-routing-settings.ts";

const DEPLOYMENT_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Options = {
  reviewerEmail: string;
  expectedName: string;
  organisationId?: string;
  apply: boolean;
};

function normaliseName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

export function parseOptions(args: string[]): Options {
  const optionPrefixes = ["--reviewer-email=", "--expected-name=", "--organisation-id="];
  const value = (key: string) => {
    const item = args.find((arg) => arg.startsWith(`${key}=`));
    return item?.slice(key.length + 1).trim();
  };
  const reviewerEmail = value("--reviewer-email")?.toLowerCase();
  const expectedName = value("--expected-name");
  const organisationId = value("--organisation-id");
  const apply = args.includes("--apply");
  const dryRun = args.includes("--dry-run");
  const allowed = args.every(
    (arg) =>
      ["--apply", "--dry-run"].includes(arg) ||
      optionPrefixes.some((prefix) => arg.startsWith(prefix)),
  );
  const uniqueOptions = optionPrefixes.every(
    (prefix) => args.filter((arg) => arg.startsWith(prefix)).length <= 1,
  );
  if (
    !allowed ||
    !uniqueOptions ||
    (apply && dryRun) ||
    !reviewerEmail ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reviewerEmail) ||
    !expectedName ||
    (organisationId && !UUID.test(organisationId))
  ) {
    throw new Error(
      "Usage: node --experimental-transform-types scripts/configure-independent-hr-reviewer.ts " +
        "--reviewer-email=address@via-int.com --expected-name='Full Name' " +
        "[--organisation-id=UUID] [--dry-run|--apply]",
    );
  }
  return { reviewerEmail, expectedName, organisationId, apply };
}

async function run(options: Options): Promise<void> {
  const db = getDatabaseClient();
  const identityConditions = and(
    eq(employees.workEmail, options.reviewerEmail),
    eq(users.workspaceEmail, options.reviewerEmail),
    eq(employees.status, "Active"),
    isNull(employees.archivedAt),
    eq(users.status, "Active"),
    isNull(users.archivedAt),
    eq(organisations.isActive, true),
    isNull(organisations.archivedAt),
    ...(options.organisationId ? [eq(employees.organisationId, options.organisationId)] : []),
  );

  const preview = await db
    .select({
      organisationId: employees.organisationId,
      employeeId: employees.id,
      userId: users.id,
      legalName: employees.legalName,
      preferredName: employees.preferredName,
      displayName: users.displayName,
      workEmail: employees.workEmail,
    })
    .from(employees)
    .innerJoin(
      users,
      and(eq(users.employeeId, employees.id), eq(users.organisationId, employees.organisationId)),
    )
    .innerJoin(organisations, eq(organisations.id, employees.organisationId))
    .where(identityConditions);
  if (preview.length !== 1)
    throw new Error(`Expected one active employee and sign-in account; found ${preview.length}.`);
  const person = preview[0]!;
  if (normaliseName(person.legalName) !== normaliseName(options.expectedName))
    throw new Error(
      `The active account's legal name is "${person.legalName}", not "${options.expectedName}". No change made.`,
    );

  const [settings] = await db
    .select({
      id: appSettings.id,
      additionalSettings: appSettings.additionalSettings,
    })
    .from(appSettings)
    .where(
      and(eq(appSettings.organisationId, person.organisationId), isNull(appSettings.archivedAt)),
    )
    .limit(1);
  if (!settings) throw new Error("This organisation has no active application settings.");
  const existing = parseApprovalRoutingSettings(settings.additionalSettings["approvalRouting"]);
  if (
    existing.hrOwnRequestReviewerEmployeeId &&
    existing.hrOwnRequestReviewerEmployeeId !== person.employeeId
  )
    throw new Error("A different independent reviewer is already configured. Use Company Setup.");

  console.log(
    `Verified ${person.legalName} <${person.workEmail}> in organisation ${person.organisationId}; employee ${person.employeeId}.`,
  );
  if (existing.hrOwnRequestReviewerEmployeeId === person.employeeId) {
    console.log("Already configured; no change needed.");
    return;
  }
  if (!options.apply) {
    console.log("Dry run only. Repeat with --apply after verifying the identity above.");
    return;
  }

  await db.transaction(async (tx) => {
    const [lockedSettings] = await tx
      .select()
      .from(appSettings)
      .where(and(eq(appSettings.id, settings.id), isNull(appSettings.archivedAt)))
      .for("update")
      .limit(1);
    if (!lockedSettings) throw new Error("Application settings changed before apply.");

    const liveMatches = await tx
      .select({
        organisationId: employees.organisationId,
        employeeId: employees.id,
        userId: users.id,
        legalName: employees.legalName,
      })
      .from(employees)
      .innerJoin(
        users,
        and(eq(users.employeeId, employees.id), eq(users.organisationId, employees.organisationId)),
      )
      .innerJoin(organisations, eq(organisations.id, employees.organisationId))
      .where(identityConditions)
      .for("share");
    if (
      liveMatches.length !== 1 ||
      liveMatches[0]?.employeeId !== person.employeeId ||
      liveMatches[0]?.userId !== person.userId ||
      normaliseName(liveMatches[0]?.legalName ?? "") !== normaliseName(options.expectedName)
    )
      throw new Error("The account changed after preview. No change made.");

    const previous = parseApprovalRoutingSettings(
      lockedSettings.additionalSettings["approvalRouting"],
    );
    if (previous.hrOwnRequestReviewerEmployeeId)
      throw new Error("A reviewer is already configured. No change made.");
    const next = { ...previous, hrOwnRequestReviewerEmployeeId: person.employeeId };
    const [saved] = await tx
      .update(appSettings)
      .set({
        additionalSettings: { ...lockedSettings.additionalSettings, approvalRouting: next },
        updatedAt: new Date(),
        updatedBy: DEPLOYMENT_ACTOR_ID,
        recordVersion: sql`${appSettings.recordVersion} + 1`,
      })
      .where(eq(appSettings.id, lockedSettings.id))
      .returning({ id: appSettings.id });
    if (!saved) throw new Error("The reviewer setting could not be saved.");
    await tx.insert(auditEvents).values({
      organisationId: person.organisationId,
      actorUserId: DEPLOYMENT_ACTOR_ID,
      actorDisplayName: "VIA deployment configuration",
      activeRole: "System",
      actorRoles: ["System"],
      action: "configure-independent-hr-reviewer",
      module: "settings",
      entityType: "app_settings",
      entityId: lockedSettings.id,
      beforeSummary: { approvalRouting: previous },
      afterSummary: { approvalRouting: next },
      reason: `One-time verified setup for ${person.legalName} (${person.workEmail}).`,
      riskLevel: "High",
    });
  });
  console.log("Independent HR reviewer configured and audited.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await run(parseOptions(process.argv.slice(2)));
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : cause);
    process.exitCode = 1;
  } finally {
    await closeDatabaseConnection();
  }
}
