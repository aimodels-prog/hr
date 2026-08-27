import type { ActorContext, FileMetadata, FileOwner } from "./types.ts";
import type { AuditWriter } from "./audit-service.ts";

const DATABASE_NAME = "via_hr_files";
const DATABASE_VERSION = 1;
const FILE_STORE = "files";

interface StoredFile {
  metadata: FileMetadata;
  blob: Blob;
}

export interface SaveFileInput {
  blob: Blob;
  name: string;
  mimeType?: string;
  owner: FileOwner;
}

export interface FileRepository {
  save(input: SaveFileInput, context: ActorContext): Promise<FileMetadata>;
  getMetadata(id: string): Promise<FileMetadata | null>;
  getBlob(id: string): Promise<Blob | null>;
  listByOwner(owner: FileOwner): Promise<FileMetadata[]>;
  updateOwner(id: string, owner: FileOwner, context: ActorContext): Promise<FileMetadata>;
  delete(id: string, context: ActorContext): Promise<void>;
  clear(): Promise<void>;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("IndexedDB request failed.")),
    );
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted.")),
    );
    transaction.addEventListener("error", () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed.")),
    );
  });
}

async function sha256(blob: Blob): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) return undefined;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class IndexedDbFileRepository implements FileRepository {
  private databasePromise?: Promise<IDBDatabase>;

  constructor(
    private readonly options: {
      databaseName?: string;
      now?: () => string;
      createId?: () => string;
      audit?: AuditWriter;
    } = {},
  ) {}

  async save(input: SaveFileInput, context: ActorContext): Promise<FileMetadata> {
    const now = this.now();
    const id = this.createId();
    const checksum = await sha256(input.blob);
    const metadata: FileMetadata = {
      id,
      name: input.name,
      mimeType: input.mimeType || input.blob.type || "application/octet-stream",
      size: input.blob.size,
      owner: structuredClone(input.owner),
      createdAt: now,
      createdBy: context.actor.userId,
      updatedAt: now,
      updatedBy: context.actor.userId,
      recordVersion: 1,
      ...(checksum ? { checksum } : {}),
    };

    const database = await this.open();
    const transaction = database.transaction(FILE_STORE, "readwrite");
    transaction.objectStore(FILE_STORE).put({ metadata, blob: input.blob } satisfies StoredFile);
    await transactionComplete(transaction);
    try {
      this.options.audit?.record({
        context,
        action: "upload",
        module: "files",
        entityType: "file",
        entityId: id,
        after: metadata,
      });
    } catch (error) {
      await this.deleteStored(id);
      throw error;
    }
    return structuredClone(metadata);
  }

  async getMetadata(id: string): Promise<FileMetadata | null> {
    const stored = await this.getStored(id);
    return stored ? structuredClone(stored.metadata) : null;
  }

  async getBlob(id: string): Promise<Blob | null> {
    const stored = await this.getStored(id);
    return stored?.blob ?? null;
  }

  async listByOwner(owner: FileOwner): Promise<FileMetadata[]> {
    const database = await this.open();
    const transaction = database.transaction(FILE_STORE, "readonly");
    const records = await requestResult(transaction.objectStore(FILE_STORE).getAll());
    await transactionComplete(transaction);
    return (records as StoredFile[])
      .filter(
        (record) =>
          record.metadata.owner.entityType === owner.entityType &&
          record.metadata.owner.entityId === owner.entityId,
      )
      .map((record) => structuredClone(record.metadata));
  }

  async updateOwner(id: string, owner: FileOwner, context: ActorContext): Promise<FileMetadata> {
    const existing = await this.getStored(id);
    if (!existing) throw new Error("File not found.");
    const now = this.now();
    const updated: StoredFile = {
      blob: existing.blob,
      metadata: {
        ...existing.metadata,
        owner: structuredClone(owner),
        updatedAt: now,
        updatedBy: context.actor.userId,
        recordVersion: existing.metadata.recordVersion + 1,
      },
    };
    const database = await this.open();
    const transaction = database.transaction(FILE_STORE, "readwrite");
    transaction.objectStore(FILE_STORE).put(updated);
    await transactionComplete(transaction);
    try {
      this.options.audit?.record({
        context,
        action: "reassign_owner",
        module: "files",
        entityType: "file",
        entityId: id,
        before: existing.metadata,
        after: updated.metadata,
      });
    } catch (error) {
      const rollback = database.transaction(FILE_STORE, "readwrite");
      rollback.objectStore(FILE_STORE).put(existing);
      await transactionComplete(rollback);
      throw error;
    }
    return structuredClone(updated.metadata);
  }

  async delete(id: string, context: ActorContext): Promise<void> {
    const existing = await this.getStored(id);
    if (!existing) return;
    await this.deleteStored(id);
    try {
      this.options.audit?.record({
        context,
        action: "delete",
        module: "files",
        entityType: "file",
        entityId: id,
        before: existing.metadata,
        riskLevel: "Medium",
      });
    } catch (error) {
      const database = await this.open();
      const transaction = database.transaction(FILE_STORE, "readwrite");
      transaction.objectStore(FILE_STORE).put(existing);
      await transactionComplete(transaction);
      throw error;
    }
  }

  private async deleteStored(id: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(FILE_STORE, "readwrite");
    transaction.objectStore(FILE_STORE).delete(id);
    await transactionComplete(transaction);
  }

  async clear(): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(FILE_STORE, "readwrite");
    transaction.objectStore(FILE_STORE).clear();
    await transactionComplete(transaction);
  }

  private async getStored(id: string): Promise<StoredFile | null> {
    const database = await this.open();
    const transaction = database.transaction(FILE_STORE, "readonly");
    const result = await requestResult(transaction.objectStore(FILE_STORE).get(id));
    await transactionComplete(transaction);
    return (result as StoredFile | undefined) ?? null;
  }

  private open(): Promise<IDBDatabase> {
    if (!globalThis.indexedDB) {
      return Promise.reject(new Error("IndexedDB is unavailable in this environment."));
    }
    if (this.databasePromise) return this.databasePromise;

    this.databasePromise = new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open(
        this.options.databaseName ?? DATABASE_NAME,
        DATABASE_VERSION,
      );
      request.addEventListener("upgradeneeded", () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(FILE_STORE)) {
          database.createObjectStore(FILE_STORE, { keyPath: "metadata.id" });
        }
      });
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () =>
        reject(request.error ?? new Error("Unable to open IndexedDB.")),
      );
      request.addEventListener("blocked", () =>
        reject(new Error("IndexedDB upgrade is blocked by another tab.")),
      );
    });
    return this.databasePromise;
  }

  private now(): string {
    return this.options.now?.() ?? new Date().toISOString();
  }

  private createId(): string {
    return this.options.createId?.() ?? crypto.randomUUID();
  }
}
