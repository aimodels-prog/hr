import { useEffect, useMemo, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bell, Check, Trash2 } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { getApplicationDataServices } from "@/lib/data/application-data";
import { employeeDocumentLink } from "@/lib/data/document-links";
import { getEmployeeDocumentsFn } from "@/lib/server-functions/core-hr-lifecycle.server";
import { notificationServerActor } from "@/lib/data/notification-cache";
import {
  browserApprovalAlertHistoryKey,
  browserApprovalAlertsKey,
  claimBrowserApprovalTasks,
  newlyArrivedUnread,
  newlyAssignedApprovalTasks,
} from "@/lib/data/notification-popup";
import type { ActorContext, Notification as AppNotification } from "@/lib/data/types";
import { formatDistanceToNow } from "date-fns";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { getApprovalInboxFn } from "@/lib/server-functions/request-tracking.server";
import {
  approvalActionUrl,
  approvalTaskForNotification,
  isApprovalNotification,
  leaveRequestHistoryUrl,
} from "@/lib/data/approval-links";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function NotificationDrawer() {
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const openRef = useRef(open);
  const [, setTicker] = useState(0); // force refresh after repository mutations
  const [isLoading, setIsLoading] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);
  const [browserAlertsEnabled, setBrowserAlertsEnabled] = useState(false);
  const [browserPermission, setBrowserPermission] = useState<
    NotificationPermission | "unsupported"
  >("unsupported");
  const knownApprovalTaskIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    const refresh = () => setTicker((value) => value + 1);
    window.addEventListener("via_hr:notifications_changed", refresh);
    return () => window.removeEventListener("via_hr:notifications_changed", refresh);
  }, []);

  const { notifications: notifService } = getApplicationDataServices();
  const actorKey = JSON.stringify(currentUser.getActorContext());
  const actorContext = useMemo(() => JSON.parse(actorKey) as ActorContext, [actorKey]);
  const activeRole = actorContext.actor.activeRole ?? actorContext.actor.roles[0] ?? "Employee";
  const canReceiveApprovalAlerts = activeRole !== "Super Admin";

  useEffect(() => {
    if (!canReceiveApprovalAlerts || !("Notification" in window) || !window.isSecureContext) {
      setBrowserPermission("unsupported");
      setBrowserAlertsEnabled(false);
      return;
    }
    setBrowserPermission(window.Notification.permission);
    try {
      setBrowserAlertsEnabled(
        window.Notification.permission === "granted" &&
          window.localStorage.getItem(browserApprovalAlertsKey(actorContext.actor.userId)) === "1",
      );
    } catch {
      setBrowserAlertsEnabled(false);
    }
  }, [actorContext.actor.userId, canReceiveApprovalAlerts]);

  useEffect(() => {
    if (!open || !("Notification" in window)) return;
    setBrowserPermission(window.Notification.permission);
    if (window.Notification.permission !== "granted") setBrowserAlertsEnabled(false);
  }, [open]);

  const approvalInbox = useQuery({
    queryKey: ["approval-inbox", actorKey],
    queryFn: async () =>
      getApprovalInboxFn({ data: { actor: await notificationServerActor(actorContext) } }),
    enabled: open || browserAlertsEnabled,
    staleTime: 15_000,
    refetchInterval: open || browserAlertsEnabled ? 30_000 : false,
    refetchIntervalInBackground: browserAlertsEnabled,
  });

  useEffect(() => {
    knownApprovalTaskIds.current = null;
  }, [actorKey, browserAlertsEnabled]);

  useEffect(() => {
    if (!browserAlertsEnabled || !approvalInbox.data) return;
    const newTasks = newlyAssignedApprovalTasks(approvalInbox.data, knownApprovalTaskIds.current);
    knownApprovalTaskIds.current = new Set(approvalInbox.data.map((task) => task.id));
    if (newTasks.length === 0 || browserPermission !== "granted") return;
    let tasksToNotify = newTasks;
    try {
      tasksToNotify = claimBrowserApprovalTasks(
        newTasks,
        window.localStorage,
        browserApprovalAlertHistoryKey(actorContext.actor.userId, activeRole),
      );
    } catch {
      // Storage can be unavailable in private browsing; the current tab still works.
    }
    if (tasksToNotify.length === 0 || open) return;
    const openNewApproval = () => {
      if (tasksToNotify.length !== 1) {
        void navigate({ to: "/staff/requests", search: { view: "approvals" } });
        return;
      }
      const [path, hash = ""] = approvalActionUrl(tasksToNotify[0]!).split("#");
      void navigate({ to: path!, hash });
    };
    if (document.visibilityState === "visible" && document.hasFocus()) {
      toast.info(
        tasksToNotify.length === 1
          ? "New request waiting for your review"
          : `${tasksToNotify.length} new requests need your review`,
        {
          action: { label: "Review", onClick: openNewApproval },
          duration: 8_000,
        },
      );
      return;
    }
    try {
      const alert = new window.Notification("VIA HR Application", {
        body:
          tasksToNotify.length === 1
            ? "A new request is waiting for your review."
            : `${tasksToNotify.length} new requests are waiting for your review.`,
        icon: "/favicon.png",
        tag: `via-hr-approvals-${actorContext.actor.userId}-${activeRole}`,
      });
      alert.onclick = () => {
        alert.close();
        window.focus();
        openNewApproval();
      };
    } catch {
      // Some mobile browsers grant permission but cannot construct page notifications.
      // The in-app notification bell remains available in those browsers.
      setBrowserAlertsEnabled(false);
      setBrowserPermission("unsupported");
    }
  }, [
    actorContext.actor.userId,
    activeRole,
    approvalInbox.data,
    browserAlertsEnabled,
    browserPermission,
    navigate,
    open,
  ]);
  const notifications = notifService
    .listForContext(actorContext)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const unreadCount = notifications.filter((n) => n.status === "Unread").length;

  useEffect(() => {
    let cancelled = false;
    let refreshing = false;
    let knownIds: Set<string> | null = null;
    let hasLoaded = false;
    let reportedInitialError = false;
    setIsLoading(true);
    const refresh = async () => {
      if (cancelled || refreshing || document.visibilityState === "hidden") return;
      refreshing = true;
      try {
        const latest = await notifService.hydrateCompatibilityCache(actorContext, () => !cancelled);
        if (cancelled) return;
        const arrived = newlyArrivedUnread(latest, knownIds).filter(
          (notification) => !browserAlertsEnabled || !isApprovalNotification(notification),
        );
        knownIds = new Set(latest.map((notification) => notification.id));
        hasLoaded = true;
        if (openRef.current) return;
        if (arrived.length === 1) {
          toast.info(arrived[0]!.title, {
            description: arrived[0]!.message.slice(0, 180),
            action: { label: "View", onClick: () => setOpen(true) },
            duration: 8_000,
          });
        } else if (arrived.length > 1) {
          toast.info(`${arrived.length} new notifications`, {
            description: "Open your notifications to review the latest requests and updates.",
            action: { label: "View", onClick: () => setOpen(true) },
            duration: 8_000,
          });
        }
      } catch (error) {
        if (!cancelled && !hasLoaded && !reportedInitialError) {
          reportedInitialError = true;
          toast.error(
            error instanceof Error ? error.message : "Notifications could not be loaded.",
          );
        }
      } finally {
        refreshing = false;
        if (!cancelled) setIsLoading(false);
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    void refresh();
    const interval = window.setInterval(refreshWhenVisible, 30_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [actorContext, browserAlertsEnabled, notifService]);

  const handleMarkAsRead = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await notifService.markReadAsync(id, currentUser.getActorContext());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Notification could not be updated.");
    }
  };

  const handleDismiss = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await notifService.dismissAsync(id, currentUser.getActorContext());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Notification could not be dismissed.");
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await notifService.markAllReadAsync(currentUser.getActorContext());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Notifications could not be updated.");
    }
  };

  const handleDismissAll = async () => {
    try {
      const count = await notifService.dismissAllAsync(currentUser.getActorContext());
      setConfirmClear(false);
      toast.success(`${count} notification${count === 1 ? "" : "s"} cleared`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Notifications could not be cleared.");
    }
  };

  const handleEnableBrowserAlerts = async () => {
    if (!canReceiveApprovalAlerts || !("Notification" in window) || !window.isSecureContext) return;
    try {
      // The browser permission prompt must be triggered directly by this click.
      const permission = await window.Notification.requestPermission();
      setBrowserPermission(permission);
      if (permission !== "granted") return;
      try {
        window.localStorage.setItem(browserApprovalAlertsKey(actorContext.actor.userId), "1");
      } catch {
        // If storage is blocked, alerts can still run until this tab closes.
      }
      setBrowserAlertsEnabled(true);
      toast.success("Browser alerts are on for requests waiting for your review.");
    } catch {
      toast.error("Browser alerts are unavailable. Your in-app notifications still work.");
    }
  };

  const handleDisableBrowserAlerts = () => {
    try {
      window.localStorage.removeItem(browserApprovalAlertsKey(actorContext.actor.userId));
    } catch {
      // The current-session setting can still be disabled if storage is unavailable.
    }
    setBrowserAlertsEnabled(false);
  };

  const handleClick = async (notif: AppNotification) => {
    if (notif.status === "Unread") {
      try {
        await notifService.markReadAsync(notif.id, currentUser.getActorContext());
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Notification could not be updated.");
      }
    }
    if (notif.link) {
      let destination = notif.link.path;
      let matchedApprovalTask = false;
      if (isApprovalNotification(notif)) {
        try {
          const tasks = await getApprovalInboxFn({
            data: { actor: await notificationServerActor(currentUser.getActorContext()) },
          });
          const task = approvalTaskForNotification(notif, tasks);
          if (task) {
            destination = approvalActionUrl(task);
            matchedApprovalTask = true;
          }
        } catch {
          // The original notification link remains available if the approval inbox cannot refresh.
        }
      }
      if (
        !matchedApprovalTask &&
        notif.link.entityType === "leave-request" &&
        notif.link.entityId
      ) {
        destination = leaveRequestHistoryUrl(notif.link.entityId);
      }
      if (
        (["employee-document", "document_expiry"].includes(notif.link.entityType ?? "") ||
          notif.type === "document_expiry") &&
        notif.link.entityId
      ) {
        try {
          const documents = await getEmployeeDocumentsFn({
            data: { actor: await notificationServerActor(currentUser.getActorContext()) },
          });
          const document = documents.find(
            (item) =>
              item.id === notif.link!.entityId ||
              (notif.type === "document_expiry" && notif.deduplicationKey?.includes(item.id)),
          );
          if (!document) {
            toast.error("This document is unavailable or you do not have access.");
            return;
          }
          destination = employeeDocumentLink(document.employeeId, document.id);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Document could not be opened.");
          return;
        }
      }
      if (!destination) return;
      setOpen(false);
      const [path, hash = ""] = destination.split("#");
      navigate({ to: path!, hash });
    }
  };

  const openApproval = (url: string) => {
    setOpen(false);
    const [path, hash = ""] = url.split("#");
    void navigate({ to: path!, hash });
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Open notifications">
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <Badge className="absolute -top-1 -right-1 px-1.5 py-0.5 text-[10px] min-w-[18px] h-[18px] flex items-center justify-center bg-rose-600">
              {unreadCount}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md flex flex-col p-0">
        <SheetHeader className="p-4 border-b space-y-0 flex-row items-center justify-between">
          <SheetTitle>Notifications</SheetTitle>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleMarkAllAsRead()}
                className="h-8 text-xs"
              >
                Mark all as read
              </Button>
            )}
            {notifications.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmClear(true)}
                className="h-8 text-xs"
              >
                Clear all
              </Button>
            )}
          </div>
        </SheetHeader>
        <ScrollArea className="flex-1">
          <div className="flex flex-col">
            {canReceiveApprovalAlerts && browserPermission !== "unsupported" && (
              <section className="border-b p-4" aria-label="Browser approval alerts">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">Browser alerts</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Pop-ups for new approvals while the app is open. No employee details shown.
                    </p>
                  </div>
                  {browserPermission === "denied" ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      Blocked by browser
                    </span>
                  ) : browserAlertsEnabled ? (
                    <Button size="sm" variant="outline" onClick={handleDisableBrowserAlerts}>
                      Turn off
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleEnableBrowserAlerts()}
                    >
                      Turn on
                    </Button>
                  )}
                </div>
              </section>
            )}
            {approvalInbox.data && approvalInbox.data.length > 0 && (
              <section className="border-b bg-primary/5 p-4" aria-label="Approvals waiting for you">
                <h3 className="mb-3 text-sm font-semibold">
                  Approvals waiting for you ({approvalInbox.data.length})
                </h3>
                <div className="space-y-2">
                  {approvalInbox.data.slice(0, 5).map((task) => (
                    <div key={task.id} className="rounded-lg border bg-card p-3">
                      <p className="text-sm font-medium">{task.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {task.subjectName ?? task.description}
                      </p>
                      <Button
                        size="sm"
                        className="mt-2"
                        onClick={() => openApproval(approvalActionUrl(task))}
                      >
                        Review request
                      </Button>
                    </div>
                  ))}
                  {approvalInbox.data.length > 5 && (
                    <Button
                      variant="link"
                      size="sm"
                      onClick={() => {
                        setOpen(false);
                        void navigate({ to: "/staff/requests", search: { view: "approvals" } });
                      }}
                    >
                      See all approvals
                    </Button>
                  )}
                </div>
              </section>
            )}
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                Loading notifications…
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                You're all caught up.
              </div>
            ) : (
              notifications.map((notif) => (
                <div
                  key={notif.id}
                  className={`p-4 border-b hover:bg-muted/50 cursor-pointer transition-colors relative group ${notif.status === "Unread" ? "bg-primary/5" : ""}`}
                  onClick={() => handleClick(notif)}
                >
                  {notif.status === "Unread" && (
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary"></div>
                  )}
                  <div className="flex justify-between items-start mb-1">
                    <div className="font-semibold text-sm flex items-center gap-2">
                      {notif.title}
                      {notif.priority === "High" || notif.priority === "Critical" ? (
                        <Badge variant="destructive" className="px-1 py-0 text-[10px]">
                          Important
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {notif.status === "Unread" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-primary"
                          onClick={(e) => void handleMarkAsRead(notif.id, e)}
                          title="Mark as read"
                        >
                          <Check className="w-3 h-3" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-rose-600"
                        onClick={(e) => void handleDismiss(notif.id, e)}
                        title="Dismiss"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground">{notif.message}</div>
                  {approvalTaskForNotification(notif, approvalInbox.data ?? []) && (
                    <span className="mt-2 inline-block text-xs font-semibold text-primary">
                      Open approval
                    </span>
                  )}
                  <div className="text-xs text-muted-foreground mt-2 flex justify-between">
                    <span>
                      {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true })}
                    </span>
                    <span>{notificationArea(notif.type)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </SheetContent>
      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all notifications?</AlertDialogTitle>
            <AlertDialogDescription>
              This hides every notification in your current inbox. The related records and audit
              history are not removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep notifications</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleDismissAll()}>Clear all</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

function notificationArea(type: string): string {
  const area = type.split(/[.-]/)[0] || "Update";
  return area.charAt(0).toUpperCase() + area.slice(1);
}
