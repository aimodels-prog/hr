import type { ActorContext, AuditEvent, AuditRiskLevel } from "./types.ts";
import { SYSTEM_ACTOR } from "./types.ts";
import type { VersionedStorageService } from "./storage.ts";

export const AUDIT_COLLECTION = "auditEvents";

export interface AuditInput {
  context?: ActorContext;
  action: string;
  module: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  riskLevel?: AuditRiskLevel;
}

export interface AuditWriter {
  record(input: AuditInput): AuditEvent;
}

export interface AuditServiceOptions {
  now?: () => string;
  createId?: () => string;
}

function defaultId(): string {
  return crypto.randomUUID();
}

export class AuditService implements AuditWriter {
  private readonly now: () => string;
  private readonly createId: () => string;

  constructor(
    private readonly storage: VersionedStorageService,
    options: AuditServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? defaultId;
  }

  list(): AuditEvent[] {
    return this.storage.readCollection<AuditEvent>(AUDIT_COLLECTION);
  }

  record(input: AuditInput): AuditEvent {
    const reason = input.reason ?? input.context?.reason;
    const event: AuditEvent = {
      id: this.createId(),
      occurredAt: this.now(),
      actor: structuredClone(input.context?.actor ?? SYSTEM_ACTOR),
      action: input.action,
      module: input.module,
      entityType: input.entityType,
      entityId: input.entityId,
      riskLevel: input.riskLevel ?? "Low",
      ...(input.before === undefined ? {} : { before: structuredClone(input.before) }),
      ...(input.after === undefined ? {} : { after: structuredClone(input.after) }),
      ...(reason ? { reason } : {}),
    };

    const events = this.list();
    this.storage.writeCollection(AUDIT_COLLECTION, [...events, event]);
    return structuredClone(event);
  }
}

// Shared helper so every service records access-denied attempts the same way, instead of each
// one growing its own ad hoc version of this call.
export function recordAccessDenied(
  audit: AuditWriter,
  params: {
    module: string;
    entityType: string;
    entityId: string;
    action: string;
    context: ActorContext;
  },
): void {
  audit.record({
    context: params.context,
    action: params.action,
    module: params.module,
    entityType: params.entityType,
    entityId: params.entityId,
    riskLevel: "High",
  });
}
