import type { AppTask } from "./task-service.ts";
import type { Notification } from "./types.ts";

const FOCUSABLE_APPROVAL_PATHS = new Set([
  "/staff/leave-approvals",
  "/staff/attendance/corrections",
  "/staff/overtime-approvals",
  "/staff/travel-approvals",
  "/staff/travel-hr-approvals",
  "/staff/travel-accounts-approvals",
  "/staff/travel-closures",
  "/staff/training",
  "/staff/recommendations",
  "/staff/performance/team",
  "/staff/offers",
]);

export function approvalActionUrl(task: Pick<AppTask, "actionUrl" | "sourceId">): string {
  const [path, hash = ""] = task.actionUrl.split("#");
  if (!path || !FOCUSABLE_APPROVAL_PATHS.has(path)) return task.actionUrl;
  const params = new URLSearchParams(hash);
  params.set("review", task.sourceId);
  return `${path}#${params.toString()}`;
}

export function focusedApprovalId(hash: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, "")).get("review");
}

export function leaveRequestHistoryUrl(requestId: string): string {
  return `/staff/request-detail/Leave/${encodeURIComponent(requestId)}`;
}

export function isApprovalNotification(
  notification: Pick<Notification, "type" | "title" | "message" | "link">,
): boolean {
  return Boolean(
    notification.link?.entityId &&
    !/no (?:hr )?action is required/i.test(notification.message) &&
    /approv|review|verif|decision|confirm/i.test(`${notification.type} ${notification.title}`),
  );
}

export function approvalTaskForNotification(
  notification: Pick<Notification, "type" | "title" | "message" | "link">,
  tasks: readonly AppTask[],
): AppTask | undefined {
  const link = notification.link;
  if (!link || !isApprovalNotification(notification)) return undefined;
  const entityType = link.entityType;
  // A trip may have several arrangements awaiting Finance. Never replace an exact
  // booking notification with the first task for that trip.
  const bookingHash = link.path?.split("#", 2)[1];
  if (entityType === "travel-request" && bookingHash?.startsWith("booking-")) {
    const bookingId = bookingHash.slice("booking-".length);
    return tasks.find(
      (task) =>
        task.id === `travel-booking-accounts-${bookingId}` &&
        task.sourceId === link.entityId &&
        task.sourceType === entityType,
    );
  }
  return tasks.find(
    (task) =>
      task.sourceId === link.entityId &&
      (task.sourceType === entityType ||
        (entityType === "site-visit" && task.sourceType === "site-visit-request")),
  );
}
