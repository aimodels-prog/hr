import { SYSTEM_CONTEXT } from "../src/lib/data/types.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { configureApplicationDataServices } from "../src/lib/data/application-data.ts";
import { AuditService } from "../src/lib/data/audit-service.ts";
import { DocumentService } from "../src/lib/data/document-service.ts";
import type { FileRepository, SaveFileInput } from "../src/lib/data/file-repository.ts";
import { NotificationService } from "../src/lib/data/notification-service.ts";
import { initializeSeedData } from "../src/lib/data/seed-service.ts";
import { MemoryStorageDriver } from "../src/lib/data/storage-driver.ts";
import { VersionedStorageService } from "../src/lib/data/storage.ts";
import type { ActorContext, FileMetadata } from "../src/lib/data/types.ts";

const employee: ActorContext = {
  actor: {
    userId: "user-omar",
    employeeId: "employee-omar",
    displayName: "Omar Rahman",
    activeRole: "Employee",
    roles: ["Employee"],
  },
};

function fakeFileRepository(): FileRepository {
  const files = new Map<string, { metadata: FileMetadata; blob: Blob }>();
  let counter = 0;
  return {
    async save(input: SaveFileInput, context) {
      const id = `file-${++counter}`;
      const metadata: FileMetadata = {
        id,
        name: input.name,
        mimeType: input.mimeType ?? "application/octet-stream",
        size: input.blob.size,
        owner: input.owner,
        createdAt: new Date().toISOString(),
        createdBy: context.actor.userId,
      } as FileMetadata;
      files.set(id, { metadata, blob: input.blob });
      return metadata;
    },
    async getMetadata(id: string) {
      return files.get(id)?.metadata ?? null;
    },
    async getBlob(id: string) {
      return files.get(id)?.blob ?? null;
    },
    async listByOwner(owner) {
      return [...files.values()]
        .filter(
          (f) =>
            f.metadata.owner.entityType === owner.entityType &&
            f.metadata.owner.entityId === owner.entityId,
        )
        .map((f) => f.metadata);
    },
    async delete(id: string) {
      files.delete(id);
    },
    async clear() {
      files.clear();
    },
  };
}

function setup() {
  const storage = new VersionedStorageService(new MemoryStorageDriver());
  initializeSeedData(storage);
  const audit = new AuditService(storage);
  const notifications = new NotificationService(storage, audit);
  configureApplicationDataServices({
    storage,
    audit,
    notifications,
    files: fakeFileRepository(),
  });
  return { audit, notifications };
}

test("uploading a passport without a document number is rejected", async () => {
  setup();
  const documents = new DocumentService();
  const countBefore = documents.getDocumentRepository(SYSTEM_CONTEXT).list().length;

  await assert.rejects(
    documents.uploadDocument(
      "employee-omar",
      new Blob(["test"], { type: "application/pdf" }),
      "passport.pdf",
      { type: "passport", visibility: "Restricted" },
      employee,
    ),
    /document number is required for passport/i,
  );

  // Confirm no document record was created for the rejected upload.
  assert.equal(documents.getDocumentRepository(SYSTEM_CONTEXT).list().length, countBefore);
});

test("uploading a document with issue date after expiry date is rejected", async () => {
  setup();
  const documents = new DocumentService();

  await assert.rejects(
    documents.uploadDocument(
      "employee-omar",
      new Blob(["test"], { type: "application/pdf" }),
      "passport.pdf",
      {
        type: "passport",
        documentNumber: "P1234567",
        issueDate: "2030-01-01",
        expiryDate: "2020-01-01",
        visibility: "Restricted",
      },
      employee,
    ),
    /issue date cannot be after the expiry date/i,
  );
});

test("uploading a valid passport persists documentNumber and issuingCountry", async () => {
  setup();
  const documents = new DocumentService();

  const doc = await documents.uploadDocument(
    "employee-omar",
    new Blob(["test"], { type: "application/pdf" }),
    "passport.pdf",
    {
      type: "passport",
      documentNumber: "P1234567",
      issuingAuthority: "Ministry of Interior",
      issuingCountry: "Oman",
      issueDate: "2020-01-01",
      expiryDate: "2030-01-01",
      visibility: "Restricted",
    },
    employee,
  );

  assert.equal(doc.documentNumber, "P1234567");
  assert.equal(doc.issuingCountry, "Oman");

  const stored = documents.getDocumentRepository(SYSTEM_CONTEXT).getById(doc.id);
  assert.equal(stored?.issuingCountry, "Oman");
});

test("document types that don't require a document number still upload without one", async () => {
  setup();
  const documents = new DocumentService();

  const doc = await documents.uploadDocument(
    "employee-omar",
    new Blob(["test"], { type: "application/pdf" }),
    "contract.pdf",
    { type: "contract", visibility: "Restricted" },
    employee,
  );

  assert.equal(doc.type, "contract");
  assert.equal(doc.documentNumber, undefined);
});

test("replaceDocument marks the old document Replaced and links it to the new one", async () => {
  setup();
  const documents = new DocumentService();

  const original = await documents.uploadDocument(
    "employee-omar",
    new Blob(["v1"], { type: "application/pdf" }),
    "passport-v1.pdf",
    {
      type: "passport",
      documentNumber: "P1234567",
      issuingAuthority: "Ministry of Interior",
      issueDate: "2020-01-01",
      expiryDate: "2025-01-01",
      visibility: "Restricted",
    },
    employee,
  );

  const replacement = await documents.replaceDocument(
    original.id,
    new Blob(["v2"], { type: "application/pdf" }),
    "passport-v2.pdf",
    {
      type: "passport",
      documentNumber: "P7654321",
      issuingAuthority: "Ministry of Interior",
      issueDate: "2025-01-02",
      expiryDate: "2035-01-02",
      visibility: "Restricted",
    },
    employee,
  );

  const oldReloaded = documents.getDocumentRepository(SYSTEM_CONTEXT).getById(original.id);
  assert.equal(oldReloaded?.status, "Replaced");
  assert.equal(oldReloaded?.replacedById, replacement.id);
  assert.equal(replacement.documentNumber, "P7654321");
  assert.equal(replacement.status, "Pending Verification");
});

test.after(() => configureApplicationDataServices(undefined));
