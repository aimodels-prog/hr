import type { AuditWriter } from "../data/audit-service.ts";
import { getApplicationDataServices } from "../data/application-data.ts";
import { LocalRepository } from "../data/repository.ts";
import type { VersionedStorageService } from "../data/storage.ts";
import type { ActorContext } from "../data/types.ts";
import type {
  IntegrationCapability,
  IntegrationOperation,
  IntegrationOperationStatus,
} from "./types.ts";

export interface IntegrationOperationServiceOptions {
  storage?: VersionedStorageService;
  audit?: AuditWriter;
  now?: () => string;
  createId?: () => string;
}

export interface StartIntegrationOperationInput {
  operationType: IntegrationCapability;
  relatedEntityType: string;
  relatedEntityId: string;
  providerName: string;
  requestSummary: Record<string, unknown>;
  initialStatus?: Extract<IntegrationOperationStatus, "Not Required" | "Pending" | "Ready to Sync">;
}

export class IntegrationOperationService {
  private readonly repository: LocalRepository<IntegrationOperation>;
  private readonly now: () => string;

  constructor(options: IntegrationOperationServiceOptions = {}) {
    const applicationServices =
      options.storage && options.audit ? undefined : getApplicationDataServices();
    const storage = options.storage ?? applicationServices!.storage;
    const audit = options.audit ?? applicationServices!.audit;
    this.now = options.now ?? (() => new Date().toISOString());
    this.repository = new LocalRepository<IntegrationOperation>(
      "integration_operations",
      storage,
      audit,
      {
        module: "integrations",
        entityType: "integration-operation",
        now: this.now,
        ...(options.createId ? { createId: options.createId } : {}),
      },
    );
  }

  list(): IntegrationOperation[] {
    return this.repository.list();
  }

  getById(id: string): IntegrationOperation | null {
    return this.repository.getById(id);
  }

  listForRecord(entityType: string, entityId: string): IntegrationOperation[] {
    return this.list()
      .filter(
        (operation) =>
          operation.relatedEntityType === entityType && operation.relatedEntityId === entityId,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  start(input: StartIntegrationOperationInput, context: ActorContext): IntegrationOperation {
    return this.repository.create(
      {
        operationType: input.operationType,
        relatedEntityType: input.relatedEntityType,
        relatedEntityId: input.relatedEntityId,
        providerName: input.providerName,
        status: input.initialStatus ?? "Pending",
        requestSummary: input.requestSummary,
        retryCount: 0,
      },
      context,
    );
  }

  beginAttempt(id: string, context: ActorContext): IntegrationOperation {
    const operation = this.requireOperation(id);
    return this.repository.update(
      id,
      {
        status: "Pending",
        attemptedAt: this.now(),
        retryCount: operation.retryCount,
        failureReason: undefined,
      },
      { ...context, reason: context.reason ?? "Integration attempt started" },
    );
  }

  complete(
    id: string,
    responseSummary: Record<string, unknown>,
    context: ActorContext,
    options: {
      status?: Extract<IntegrationOperationStatus, "Simulated" | "Completed">;
      externalReference?: string | undefined;
    } = {},
  ): IntegrationOperation {
    return this.repository.update(
      id,
      {
        status: options.status ?? "Completed",
        responseSummary,
        completedAt: this.now(),
        failureReason: undefined,
        ...(options.externalReference !== undefined
          ? { externalReference: options.externalReference }
          : {}),
      },
      { ...context, reason: context.reason ?? "Integration operation completed" },
    );
  }

  fail(id: string, error: unknown, context: ActorContext): IntegrationOperation {
    const message = error instanceof Error ? error.message : String(error);
    return this.repository.update(
      id,
      {
        status: "Failed",
        failureReason: message,
        completedAt: this.now(),
      },
      { ...context, reason: `Integration operation failed: ${message}` },
    );
  }

  retry(id: string, context: ActorContext): IntegrationOperation {
    const operation = this.requireOperation(id);
    if (operation.status !== "Failed") {
      throw new Error("Only failed integration operations can be retried.");
    }
    return this.repository.update(
      id,
      {
        status: "Pending",
        attemptedAt: this.now(),
        completedAt: undefined,
        failureReason: undefined,
        retryCount: operation.retryCount + 1,
      },
      { ...context, reason: context.reason ?? "Integration operation retried" },
    );
  }

  markReadyToSync(id: string, context: ActorContext): IntegrationOperation {
    return this.repository.update(
      id,
      { status: "Ready to Sync" },
      { ...context, reason: context.reason ?? "Ready for a future external provider" },
    );
  }

  private requireOperation(id: string): IntegrationOperation {
    const operation = this.repository.getById(id);
    if (!operation) throw new Error(`Integration operation ${id} was not found.`);
    return operation;
  }
}
