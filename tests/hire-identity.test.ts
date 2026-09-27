import assert from "node:assert/strict";
import test from "node:test";
import {
  assertReusableEmployeeIdentity,
  resolveHireIdentity,
} from "../src/lib/recruitment/hire-identity.ts";
import { ConversionService } from "../src/lib/data/conversion-service.ts";
import { OfferService } from "../src/lib/data/offer-service.ts";
import { configureApplicationDataServices } from "../src/lib/data/application-data.ts";
import { AuditService } from "../src/lib/data/audit-service.ts";
import { MemoryStorageDriver } from "../src/lib/data/storage-driver.ts";
import { VersionedStorageService } from "../src/lib/data/storage.ts";
import type { ActorContext } from "../src/lib/data/types.ts";

test("linked internal applicants keep their identity without a new email", () => {
  assert.deepEqual(resolveHireIdentity(undefined, "existing", "via-int.com"), {
    kind: "Existing",
    employeeId: "existing",
  });
  assert.throws(
    () =>
      resolveHireIdentity({ workspaceEmail: "invented@via-int.com" }, "existing", "via-int.com"),
    /must keep/,
  );
  assert.throws(
    () =>
      resolveHireIdentity(
        { existingEmployeeId: "other", identityConfirmed: true },
        "existing",
        "via-int.com",
      ),
    /must keep/,
  );
});

test("new hires require an explicitly confirmed work email", () => {
  for (const input of [
    undefined,
    {},
    { workspaceEmail: "assigned@via-int.com" },
    { identityConfirmed: true },
  ]) {
    assert.throws(() => resolveHireIdentity(input, undefined, "via-int.com"));
  }
  assert.deepEqual(
    resolveHireIdentity(
      { workspaceEmail: "  Assigned@VIA-INT.COM  ", identityConfirmed: true },
      undefined,
      "via-int.com",
    ),
    { kind: "New", workspaceEmail: "assigned@via-int.com" },
  );
});

test("personal, lookalike and malformed addresses cannot become VIA login identities", () => {
  for (const workspaceEmail of [
    "candidate@gmail.com",
    "person@via-int.com.evil.test",
    "person@other-via-int.com",
    "bad..name@via-int.com",
    "Name <person@via-int.com>",
    "person@via-int.com\nother@via-int.com",
  ]) {
    assert.throws(
      () =>
        resolveHireIdentity({ workspaceEmail, identityConfirmed: true }, undefined, "via-int.com"),
      /assigned work email/,
    );
  }
});

test("HR may explicitly link a legacy candidate to the same existing person", () => {
  assert.deepEqual(
    resolveHireIdentity(
      { existingEmployeeId: "existing", identityConfirmed: true },
      undefined,
      "via-int.com",
    ),
    { kind: "Existing", employeeId: "existing" },
  );
  assert.throws(
    () => resolveHireIdentity({ existingEmployeeId: "existing" }, undefined, "via-int.com"),
    /Confirm/,
  );
  assert.throws(
    () =>
      resolveHireIdentity(
        {
          existingEmployeeId: "existing",
          workspaceEmail: "another@via-int.com",
          identityConfirmed: true,
        },
        undefined,
        "via-int.com",
      ),
    /not both/,
  );
});

test("internal reuse never reactivates an inactive or suspended identity", () => {
  const employee = { status: "Active", workEmail: "person@via-int.com" };
  const account = { status: "Active", workspaceEmail: employee.workEmail };
  assert.doesNotThrow(() => assertReusableEmployeeIdentity(employee, account));
  for (const status of ["Inactive", "Archived", "Notice"])
    assert.throws(
      () => assertReusableEmployeeIdentity({ ...employee, status }, account),
      /not available/,
    );
  assert.throws(
    () => assertReusableEmployeeIdentity(employee, { ...account, status: "Suspended" }),
    /active linked/,
  );
  assert.throws(() => assertReusableEmployeeIdentity(employee, undefined), /active linked/);
  assert.throws(
    () =>
      assertReusableEmployeeIdentity(employee, { ...account, workspaceEmail: "other@via-int.com" }),
    /identities disagree/,
  );
});

const hr: ActorContext = {
  actor: {
    userId: "hr",
    employeeId: "hr-employee",
    displayName: "HR",
    activeRole: "HR",
    roles: ["Employee", "HR"],
  },
};
function harness(internal = true) {
  const storage = new VersionedStorageService(new MemoryStorageDriver());
  storage.initialize();
  configureApplicationDataServices({ storage, audit: new AuditService(storage) });
  const base = {
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    createdBy: "hr",
    updatedBy: "hr",
    recordVersion: 1,
  };
  storage.writeCollection("employees", [
    {
      ...base,
      id: "existing",
      legalName: "Existing Employee",
      preferredName: "Existing",
      employeeNumber: "VIA-17",
      workEmail: "existing@via-int.com",
      workspaceEmail: "existing@via-int.com",
      personalEmail: "existing@example.test",
      status: "Active",
      startDate: "2020-01-01",
      department: "Finance",
      position: "Accountant",
      location: "Muscat",
      employmentType: "Full-time",
    },
  ]);
  storage.writeCollection("users", [
    {
      ...base,
      id: "existing-user",
      employeeId: "existing",
      displayName: "Existing Employee",
      workspaceEmail: "existing@via-int.com",
      status: "Active",
      roles: ["Employee", "Accounts"],
    },
  ]);
  storage.writeCollection("candidates", [
    {
      ...base,
      id: "candidate",
      firstName: "Existing",
      lastName: "Employee",
      email: "existing@example.test",
      phone: "123456789",
      location: "Muscat",
      stage: "Offer",
      yearsOfExperience: 6,
      doNotContact: false,
    },
  ]);
  storage.writeCollection("applications", [
    {
      ...base,
      id: "application",
      candidateId: "candidate",
      vacancyId: "vacancy",
      status: "Offered",
      ...(internal ? { internalApplicantEmployeeId: "existing" } : {}),
    },
  ]);
  storage.writeCollection("job_offers", [
    {
      ...base,
      id: "offer",
      candidateId: "candidate",
      vacancyId: "vacancy",
      status: "Accepted",
      position: "Finance Manager",
      startDate: "2099-01-01",
      history: [],
    },
  ]);
  return storage;
}

test("internal conversion reuses the record and keeps roles, tenure and job details unchanged", async () => {
  const storage = harness();
  const before = storage.readCollection("employees");
  const accounts = storage.readCollection("users");
  const converted = await new ConversionService().convertCandidateToEmployee(
    "candidate",
    "offer",
    {},
    hr,
  );
  assert.equal(converted, "existing");
  assert.deepEqual(storage.readCollection("employees"), before);
  assert.deepEqual(storage.readCollection("users"), accounts);
  assert.equal(storage.readCollection("onboardingCases").length, 0);
  assert.equal(
    storage.readCollection<{ convertedToEmployeeId: string }>("job_offers")[0]
      ?.convertedToEmployeeId,
    "existing",
  );
  assert.equal(storage.readCollection<{ status: string }>("applications")[0]?.status, "Hired");
  await assert.rejects(
    () => new ConversionService().convertCandidateToEmployee("candidate", "offer", {}, hr),
    /already converted/,
  );
  assert.equal(storage.readCollection("employees").length, 1);
});

test("internal offer acceptance does not provision a replacement account", async () => {
  const storage = harness();
  storage.writeCollection(
    "job_offers",
    storage
      .readCollection<Record<string, unknown>>("job_offers")
      .map((offer) => ({ ...offer, status: "Sent" })),
  );
  await new OfferService().transitionOffer("offer", "Accepted", undefined, hr);
  assert.equal(storage.readCollection("employees").length, 1);
  assert.equal(storage.readCollection("users").length, 1);
  assert.equal(storage.readCollection("integration_operations").length, 0);
});

test("repeated internal conversion cannot create a second record", async () => {
  const storage = harness();
  const results = await Promise.allSettled([
    new ConversionService().convertCandidateToEmployee("candidate", "offer", {}, hr),
    new ConversionService().convertCandidateToEmployee("candidate", "offer", {}, hr),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(storage.readCollection("employees").length, 1);
});

test("an internal source without its employee link cannot fall back to new-hire creation", async () => {
  const storage = harness(false);
  storage.writeCollection(
    "applications",
    storage
      .readCollection<Record<string, unknown>>("applications")
      .map((application) => ({ ...application, source: "Internal Application" })),
  );
  await assert.rejects(
    () =>
      new ConversionService().convertCandidateToEmployee("candidate", "offer", {}, hr, {
        workspaceEmail: "new@via-int.com",
        identityConfirmed: true,
      }),
    /missing its employee link/,
  );
});

test("new-hire conversion blocks candidate contact matches instead of inventing an email suffix", async () => {
  const storage = harness(false);
  await assert.rejects(
    () =>
      new ConversionService().convertCandidateToEmployee("candidate", "offer", {}, hr, {
        workspaceEmail: "new.identity@via-int.com",
        identityConfirmed: true,
      }),
    /already matches/,
  );
  assert.equal(storage.readCollection("employees").length, 1);
  assert.equal(storage.readCollection("users").length, 1);
});

test("wrong offers and unauthorised actors cannot link employee identities", async () => {
  const storage = harness();
  await assert.rejects(
    () =>
      new ConversionService().convertCandidateToEmployee(
        "candidate",
        "offer",
        {},
        { actor: { ...hr.actor, activeRole: "Employee", roles: ["Employee"] } },
      ),
    /Only HR/,
  );
  storage.writeCollection(
    "job_offers",
    storage
      .readCollection<Record<string, unknown>>("job_offers")
      .map((offer) => ({ ...offer, candidateId: "other" })),
  );
  await assert.rejects(
    () => new ConversionService().convertCandidateToEmployee("candidate", "offer", {}, hr),
    /does not belong/,
  );
});
