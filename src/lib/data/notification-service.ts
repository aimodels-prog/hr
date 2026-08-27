import type { AuditWriter } from "./audit-service.ts";
import { LocalRepository, type NewRecord } from "./repository.ts";
import type { VersionedStorageService } from "./storage.ts";
import type { ActorContext, Notification } from "./types.ts";

export const NOTIFICATION_COLLECTION = "notifications";

export class NotificationService {
  private readonly repository: LocalRepository<Notification>;
  private readonly now: () => string;

  constructor(
    storage: VersionedStorageService,
    private readonly audit: AuditWriter,
    options: { now?: () => string; createId?: () => string } = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.repository = new LocalRepository(NOTIFICATION_COLLECTION, storage, this.audit, {
      module: "notifications",
      entityType: "notification",
      ...options,
    });
  }

  list(): Notification[] {
    return this.repository.list();
  }

  listForUser(userId: string, includeDismissed = false): Notification[] {
    return this.repository
      .list()
      .filter(
        (notification) =>
          notification.recipientUserId === userId &&
          (includeDismissed || notification.status !== "Dismissed"),
      );
  }

  listForContext(context: ActorContext, includeDismissed = false): Notification[] {
    return this.listForUser(context.actor.userId, includeDismissed);
  }

  create(input: NewRecord<Notification>, context: ActorContext): Notification {
    if (input.deduplicationKey) {
      const existing = this.repository
        .list()
        .find(
          (notification) =>
            notification.recipientUserId === input.recipientUserId &&
            notification.deduplicationKey === input.deduplicationKey &&
            notification.status !== "Dismissed",
        );
      if (existing) return existing;
    }
    const notification = this.repository.create(input, context);
    this.emitChange();
    return notification;
  }

  markRead(id: string, context: ActorContext): Notification {
    this.requireOwner(id, context);
    const notification = this.repository.update(
      id,
      { status: "Read", readAt: this.now() },
      context,
    );
    this.emitChange();
    return notification;
  }

  markUnread(id: string, context: ActorContext): Notification {
    this.requireOwner(id, context);
    const notification = this.repository.update(id, { status: "Unread" }, context);
    this.emitChange();
    return notification;
  }

  dismiss(id: string, context: ActorContext): Notification {
    this.requireOwner(id, context);
    const notification = this.repository.update(
      id,
      { status: "Dismissed", dismissedAt: this.now() },
      context,
    );
    this.emitChange();
    return notification;
  }

  private requireOwner(id: string, context: ActorContext): void {
    const notification = this.repository.getById(id);
    if (!notification) throw new Error("Notification not found.");
    if (notification.recipientUserId === context.actor.userId) return;
    this.repositoryAuditDenied(id, context);
    throw new Error("You can change only your own notifications.");
  }

  private repositoryAuditDenied(id: string, context: ActorContext): void {
    this.audit.record({
      context,
      action: "access-denied",
      module: "notifications",
      entityType: "notification",
      entityId: id,
      reason: "Attempted to change another user's notification.",
      riskLevel: "High",
    });
  }

  private emitChange(): void {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("via_hr:notifications_changed"));
    }
  }
}
