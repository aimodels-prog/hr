export function newlyArrivedUnread<T extends { id: string; status: string }>(
  notifications: readonly T[],
  knownIds: ReadonlySet<string> | null,
): T[] {
  if (!knownIds) return [];
  return notifications.filter(
    (notification) => notification.status === "Unread" && !knownIds.has(notification.id),
  );
}

/** Only new tasks assigned to the active reviewer should trigger browser alerts. */
export function newlyAssignedApprovalTasks<T extends { id: string }>(
  tasks: readonly T[],
  knownIds: ReadonlySet<string> | null,
): T[] {
  if (!knownIds) return [];
  return tasks.filter((task) => !knownIds.has(task.id));
}

export function browserApprovalAlertsKey(userId: string): string {
  return `via-hr:approval-browser-alerts:${userId}`;
}

export function browserApprovalAlertHistoryKey(userId: string, activeRole: string): string {
  return `via-hr:shown-approval-alerts:${userId}:${activeRole}`;
}

/**
 * Deduplicate across open tabs without storing request text or employee details.
 * The notification tag is a second guard if two tabs poll at almost the same time.
 */
export function claimBrowserApprovalTasks<T extends { id: string }>(
  tasks: readonly T[],
  storage: Pick<Storage, "getItem" | "setItem">,
  key: string,
): T[] {
  let priorIds: string[] = [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? "[]");
    if (Array.isArray(parsed))
      priorIds = parsed.filter((id): id is string => typeof id === "string");
  } catch {
    // A damaged old preference should not block new alerts.
  }
  const seen = new Set(priorIds);
  const claimed = tasks.filter((task) => {
    if (seen.has(task.id)) return false;
    seen.add(task.id);
    return true;
  });
  if (claimed.length > 0) {
    storage.setItem(
      key,
      JSON.stringify([...priorIds, ...claimed.map((task) => task.id)].slice(-200)),
    );
  }
  return claimed;
}
