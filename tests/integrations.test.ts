import assert from "node:assert/strict";
import test from "node:test";

import { AuditService } from "../src/lib/data/audit-service.ts";
import { generateDraftJobDescription } from "../src/lib/data/ai-provider.ts";
import { MemoryStorageDriver } from "../src/lib/data/storage-driver.ts";
import { VersionedStorageService } from "../src/lib/data/storage.ts";
import type { Candidate, Vacancy } from "../src/lib/data/types.ts";
import {
  configureIntegrationProviders,
  getIntegrationProviderRegistry,
  IntegrationGateway,
  IntegrationOperationService,
  LocalAiProvider,
  LocalCalendarProvider,
  LocalEmailProvider,
  resetIntegrationProviders,
  type AiProvider,
} from "../src/lib/integrations/index.ts";

const actorContext = {
  actor: {
    userId: "user-hr-test",
    displayName: "HR Test User",
    activeRole: "HR" as const,
    roles: ["HR" as const],
  },
};

function createOperationHarness() {
  const driver = new MemoryStorageDriver();
  const now = () => "2026-08-20T08:00:00.000Z";
  const storage = new VersionedStorageService(driver, { now });
  storage.initialize();
  let auditIndex = 0;
  const audit = new AuditService(storage, {
    now,
    createId: () => `audit-integration-${++auditIndex}`,
  });
  let operationIndex = 0;
  const operations = new IntegrationOperationService({
    storage,
    audit,
    now,
    createId: () => `integration-operation-${++operationIndex}`,
  });
  return { storage, audit, operations };
}

test("provider registry uses local providers and accepts a replaceable override", () => {
  resetIntegrationProviders();
  assert.equal(getIntegrationProviderRegistry().ai.metadata.name, "via-local-ai");
  assert.equal(getIntegrationProviderRegistry().calendar.metadata.mode, "local");

  const replacement: AiProvider = {
    metadata: {
      name: "test-external-ai",
      mode: "external",
      capabilities: ["job_description", "candidate_scoring"],
    },
    generateJobDescription: async () => ({
      summary: "External test result",
      responsibilities: [],
      requirements: [],
    }),
    scoreCandidate: (candidate, vacancy) =>
      new LocalAiProvider().scoreCandidate(candidate, vacancy),
  };

  configureIntegrationProviders({ ai: replacement });
  assert.equal(getIntegrationProviderRegistry().ai.metadata.name, "test-external-ai");
  resetIntegrationProviders();
  assert.equal(getIntegrationProviderRegistry().ai.metadata.name, "via-local-ai");
});

test("job-description generation restores every compulsory criterion omitted by a provider", async () => {
  const { operations } = createOperationHarness();
  const omittingProvider: AiProvider = {
    metadata: {
      name: "test-omitting-ai",
      mode: "external",
      capabilities: ["job_description", "candidate_scoring"],
    },
    generateJobDescription: async () => ({
      summary: "A generated role summary.",
      responsibilities: ["Coordinate daily operations."],
      requirements: ["General logistics experience"],
    }),
    scoreCandidate: (candidate, vacancy) =>
      new LocalAiProvider().scoreCandidate(candidate, vacancy),
  };
  const result = await generateDraftJobDescription(
    {
      title: "Logistics Coordinator",
      department: "Operations",
      location: "Dubai",
      employmentType: "Full-time",
      education: "Diploma",
      minimumExperience: "3 years",
      skills: { required: ["Freight coordination"], preferred: [] },
      languages: ["English"],
      mandatoryCriteria: ["Valid UAE driving licence", "Able to work night shifts"],
    },
    {
      context: actorContext,
      operations,
      providers: { ...getIntegrationProviderRegistry(), ai: omittingProvider },
    },
  );

  assert.ok(result.requirements.includes("Valid UAE driving licence"));
  assert.ok(result.requirements.includes("Able to work night shifts"));
});

test("integration operation state persists and every transition is audited", () => {
  const { storage, audit, operations } = createOperationHarness();
  const started = operations.start(
    {
      operationType: "email_delivery",
      relatedEntityType: "candidate",
      relatedEntityId: "candidate-1",
      providerName: "via-local-email",
      requestSummary: { recipientCount: 1, template: "interview-invitation" },
    },
    actorContext,
  );
  operations.beginAttempt(started.id, actorContext);
  const completed = operations.complete(started.id, { acceptedRecipients: 1 }, actorContext, {
    status: "Simulated",
    externalReference: "local-email-1",
  });

  const reloaded = new IntegrationOperationService({ storage, audit });
  assert.equal(reloaded.getById(started.id)?.status, "Simulated");
  assert.equal(completed.externalReference, "local-email-1");
  assert.equal(completed.completedAt, "2026-08-20T08:00:00.000Z");
  assert.equal(audit.list().filter((event) => event.module === "integrations").length, 3);
});

test("failed operations preserve the error and retry count", () => {
  const { operations } = createOperationHarness();
  const started = operations.start(
    {
      operationType: "workspace_identity",
      relatedEntityType: "employee",
      relatedEntityId: "employee-1",
      providerName: "via-local-workspace",
      requestSummary: { primaryEmail: "new.hire@via.example" },
    },
    actorContext,
  );
  operations.beginAttempt(started.id, actorContext);
  const failed = operations.fail(started.id, new Error("Directory unavailable"), actorContext);
  assert.equal(failed.status, "Failed");
  assert.equal(failed.failureReason, "Directory unavailable");

  const retried = operations.retry(started.id, actorContext);
  assert.equal(retried.status, "Pending");
  assert.equal(retried.retryCount, 1);
  assert.equal(retried.failureReason, undefined);
  assert.throws(() => operations.retry(started.id, actorContext), /Only failed/);
});

test("local providers return deterministic job, scoring, calendar, and email results", async () => {
  const ai = new LocalAiProvider();
  const facts = {
    title: "Logistics Operations Lead",
    department: "Operations",
    location: "Muscat",
    employmentType: "Full-time",
    education: "Bachelor's degree",
    minimumExperience: "5 years",
    skills: { required: ["Freight operations"], preferred: ["CargoWise"] },
    languages: ["English"],
    mandatoryCriteria: ["Available for GCC travel"],
  };
  assert.deepEqual(await ai.generateJobDescription(facts), await ai.generateJobDescription(facts));

  const candidate = {
    id: "candidate-1",
    firstName: "Nadia",
    lastName: "Saleh",
    email: "nadia@example.com",
    phone: "+96890000000",
    location: "Muscat",
    yearsOfExperience: 7,
    currentTitle: "Logistics Operations Supervisor",
  } as Candidate;
  const vacancy = {
    id: "vacancy-1",
    title: "Logistics Operations Lead",
    location: "Muscat",
    minimumExperience: "5 years",
    skills: { required: ["Freight operations"], preferred: [] },
    screeningQuestions: [],
  } as unknown as Vacancy;
  const firstScore = ai.scoreCandidate(candidate, vacancy);
  const secondScore = ai.scoreCandidate(candidate, vacancy);
  assert.equal(firstScore.overallScore, secondScore.overallScore);
  assert.deepEqual(firstScore.categoryScores, secondScore.categoryScores);

  const calendar = new LocalCalendarProvider();
  const availabilityRequest = {
    panelUserIds: ["user-1", "user-2"],
    candidateId: candidate.id,
    startDate: new Date("2099-01-10T00:00:00.000Z"),
    endDate: new Date("2099-01-11T00:00:00.000Z"),
    durationMinutes: 45,
    timezone: "Asia/Muscat",
  };
  assert.deepEqual(
    await calendar.findAvailability(availabilityRequest),
    await calendar.findAvailability(availabilityRequest),
  );

  const email = new LocalEmailProvider();
  const emailRequest = {
    to: ["nadia@example.com"],
    subject: "Interview invitation",
    textBody: "Your interview is ready to schedule.",
  };
  assert.deepEqual(await email.send(emailRequest), await email.send(emailRequest));
});

test("integration gateway persists local delivery and provisioning results as simulated", async () => {
  resetIntegrationProviders();
  const { operations } = createOperationHarness();
  const gateway = new IntegrationGateway(getIntegrationProviderRegistry(), operations);

  const email = await gateway.sendEmail(
    {
      to: ["new.hire@example.com"],
      subject: "Welcome to VIA",
      textBody: "Your onboarding record is ready.",
    },
    { entityType: "employee", entityId: "employee-new-hire" },
    actorContext,
  );
  await gateway.provisionWorkspaceIdentity(
    {
      employeeId: "employee-new-hire",
      primaryEmail: "new.hire@via.example",
      displayName: "New Hire",
    },
    { entityType: "employee", entityId: "employee-new-hire" },
    actorContext,
  );

  assert.match(email.deliveryReference, /^local-email-/);
  const records = operations.listForRecord("employee", "employee-new-hire");
  assert.equal(records.length, 2);
  assert.deepEqual(
    records.map((record) => record.status),
    ["Simulated", "Simulated"],
  );
  assert.deepEqual(
    new Set(records.map((record) => record.operationType)),
    new Set(["email_delivery", "workspace_identity"]),
  );
});
