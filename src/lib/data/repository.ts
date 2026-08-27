import type { AuditWriter } from "./audit-service.ts";
import type { VersionedStorageService } from "./storage.ts";
import type { ActorContext, BaseRecord } from "./types.ts";

export type NewRecord<T extends BaseRecord> = Omit<
  T,
  "id" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy" | "archivedAt" | "recordVersion"
> & {
  id?: string;
};

export type RecordChanges<T extends BaseRecord> = Partial<
  Omit<T, "id" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy" | "recordVersion">
>;

export interface ListOptions {
  includeArchived?: boolean;
}

export interface Repository<T extends BaseRecord> {
  list(options?: ListOptions): T[];
  getById(id: string, options?: ListOptions): T | null;
  create(input: NewRecord<T>, context: ActorContext): T;
  update(id: string, changes: RecordChanges<T>, context: ActorContext): T;
  archive(id: string, context: ActorContext): T;
  restore(id: string, context: ActorContext): T;
}

export interface LocalRepositoryOptions {
  module: string;
  entityType: string;
  now?: () => string;
  createId?: () => string;
}

function defaultId(): string {
  return crypto.randomUUID();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class LocalRepository<T extends BaseRecord> implements Repository<T> {
  private readonly now: () => string;
  private readonly createId: () => string;

  constructor(
    private readonly collection: string,
    private readonly storage: VersionedStorageService,
    private readonly audit: AuditWriter,
    private readonly options: LocalRepositoryOptions,
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? defaultId;
  }

  list(options: ListOptions = {}): T[] {
    const records = this.storage.readCollection<T>(this.collection);
    return clone(
      options.includeArchived
        ? records
        : records.filter((record) => record.archivedAt === undefined),
    );
  }

  getById(id: string, options: ListOptions = {}): T | null {
    return this.list(options).find((record) => record.id === id) ?? null;
  }

  create(input: NewRecord<T>, context: ActorContext): T {
    const records = this.storage.readCollection<T>(this.collection);
    const id = input.id ?? this.createId();
    if (records.some((record) => record.id === id)) {
      throw new Error(`${this.options.entityType} ${id} already exists.`);
    }

    const now = this.now();
    const record = {
      ...clone(input),
      id,
      createdAt: now,
      createdBy: context.actor.userId,
      updatedAt: now,
      updatedBy: context.actor.userId,
      recordVersion: 1,
    } as T;

    this.commitWithAudit(records, [...records, record], {
      context,
      action: "create",
      entityId: id,
      after: record,
    });
    return clone(record);
  }

  update(id: string, changes: RecordChanges<T>, context: ActorContext): T {
    return this.updateWithAction(id, changes, context, "update");
  }

  archive(id: string, context: ActorContext): T {
    const record = this.requireRecord(id, true);
    if (record.archivedAt) return record;
    return this.updateWithAction(
      id,
      { archivedAt: this.now() } as RecordChanges<T>,
      { ...context, reason: context.reason ?? "Archived" },
      "archive",
    );
  }

  restore(id: string, context: ActorContext): T {
    const records = this.storage.readCollection<T>(this.collection);
    const index = records.findIndex((record) => record.id === id);
    if (index < 0) throw new Error(`${this.options.entityType} ${id} was not found.`);
    const before = records[index]!;
    if (before.archivedAt === undefined) return clone(before);

    const { archivedAt: _archivedAt, ...activeFields } = before;
    const restored = {
      ...activeFields,
      updatedAt: this.now(),
      updatedBy: context.actor.userId,
      recordVersion: before.recordVersion + 1,
    } as T;
    const next = [...records];
    next[index] = restored;

    this.commitWithAudit(records, next, {
      context,
      action: "restore",
      entityId: id,
      before,
      after: restored,
    });
    return clone(restored);
  }

  // Atomically creates one new record and applies changes to an existing record in the SAME
  // collection, via a single storage.writeCollection() call. Because storage reads/writes are
  // synchronous and JS is single-threaded, nothing can interleave between building the combined
  // "next" array and that one write - so this is genuinely atomic, unlike calling create() then
  // update() as two separate commits (which leaves a window where the create has landed but the
  // update hasn't, or vice versa, if anything after the first commit throws).
  createWithSideEffect(
    input: NewRecord<T>,
    sideEffect: { id: string; changes: RecordChanges<T> },
    context: ActorContext,
  ): { created: T; updated: T } {
    const records = this.storage.readCollection<T>(this.collection);

    const newId = input.id ?? this.createId();
    if (records.some((record) => record.id === newId)) {
      throw new Error(`${this.options.entityType} ${newId} already exists.`);
    }
    const index = records.findIndex((record) => record.id === sideEffect.id);
    if (index < 0) throw new Error(`${this.options.entityType} ${sideEffect.id} was not found.`);

    const now = this.now();
    const created = {
      ...clone(input),
      id: newId,
      createdAt: now,
      createdBy: context.actor.userId,
      updatedAt: now,
      updatedBy: context.actor.userId,
      recordVersion: 1,
    } as T;

    const before = records[index]!;
    const updated = {
      ...before,
      ...clone(sideEffect.changes),
      id: before.id,
      createdAt: before.createdAt,
      createdBy: before.createdBy,
      updatedAt: now,
      updatedBy: context.actor.userId,
      recordVersion: before.recordVersion + 1,
    } as T;

    const next = [...records];
    next[index] = updated;
    next.push(created);

    this.storage.writeCollection(this.collection, next);
    let createAuditWritten = false;
    try {
      this.audit.record({
        context,
        action: "create",
        module: this.options.module,
        entityType: this.options.entityType,
        entityId: newId,
        after: created,
      });
      createAuditWritten = true;
      this.audit.record({
        context,
        action: "update",
        module: this.options.module,
        entityType: this.options.entityType,
        entityId: sideEffect.id,
        before,
        after: updated,
      });
    } catch (error) {
      this.storage.writeCollection(this.collection, records);
      // If the "create" audit entry already landed before the "update" one failed, the data
      // write above is now rolled back but that first audit entry is a permanent, already-
      // persisted record - audit logs are append-only, so it cannot be un-written. Add a
      // compensating entry instead of leaving the log silently inconsistent with reality. This is
      // itself best-effort: if it also throws (e.g. storage is genuinely out of space), swallow
      // that secondary failure and surface the original error, which is the one the caller needs.
      if (createAuditWritten) {
        try {
          this.audit.record({
            context,
            action: "rollback",
            module: this.options.module,
            entityType: this.options.entityType,
            entityId: newId,
            reason: `Reverted: the paired update to ${sideEffect.id} could not be recorded (${error instanceof Error ? error.message : "unknown error"}).`,
          });
        } catch {
          // best-effort only - do not let a secondary audit failure mask the original error
        }
      }
      throw error;
    }

    return { created: clone(created), updated: clone(updated) };
  }

  private updateWithAction(
    id: string,
    changes: RecordChanges<T>,
    context: ActorContext,
    action: string,
  ): T {
    const records = this.storage.readCollection<T>(this.collection);
    const index = records.findIndex((record) => record.id === id);
    if (index < 0) throw new Error(`${this.options.entityType} ${id} was not found.`);

    const before = records[index]!;
    const updated = {
      ...before,
      ...clone(changes),
      id: before.id,
      createdAt: before.createdAt,
      createdBy: before.createdBy,
      updatedAt: this.now(),
      updatedBy: context.actor.userId,
      recordVersion: before.recordVersion + 1,
    } as T;
    const next = [...records];
    next[index] = updated;

    this.commitWithAudit(records, next, {
      context,
      action,
      entityId: id,
      before,
      after: updated,
    });
    return clone(updated);
  }

  private requireRecord(id: string, includeArchived: boolean): T {
    const record = this.getById(id, { includeArchived });
    if (!record) throw new Error(`${this.options.entityType} ${id} was not found.`);
    return record;
  }

  private commitWithAudit(
    beforeRecords: T[],
    afterRecords: T[],
    input: {
      context: ActorContext;
      action: string;
      entityId: string;
      before?: T;
      after?: T;
    },
  ): void {
    this.storage.writeCollection(this.collection, afterRecords);
    try {
      this.audit.record({
        context: input.context,
        action: input.action,
        module: this.options.module,
        entityType: this.options.entityType,
        entityId: input.entityId,
        ...(input.before ? { before: input.before } : {}),
        ...(input.after ? { after: input.after } : {}),
      });
    } catch (error) {
      this.storage.writeCollection(this.collection, beforeRecords);
      throw error;
    }
  }
}
