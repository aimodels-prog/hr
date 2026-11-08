export function newlyArrivedUnread<T extends { id: string; status: string }>(
  notifications: readonly T[],
  knownIds: ReadonlySet<string> | null,
): T[] {
  if (!knownIds) return [];
  return notifications.filter(
    (notification) => notification.status === "Unread" && !knownIds.has(notification.id),
  );
}
