import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bell, Check, Trash2 } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { getApplicationDataServices } from "@/lib/data/application-data";
import type { Notification } from "@/lib/data/types";
import { formatDistanceToNow } from "date-fns";
import { useNavigate } from "@tanstack/react-router";

export function NotificationDrawer() {
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [, setTicker] = useState(0); // force refresh after repository mutations

  useEffect(() => {
    const refresh = () => setTicker((value) => value + 1);
    window.addEventListener("via_hr:notifications_changed", refresh);
    return () => window.removeEventListener("via_hr:notifications_changed", refresh);
  }, []);

  if (!currentUser) return null;

  const { notifications: notifService } = getApplicationDataServices();
  const actorContext = currentUser.getActorContext();
  const notifications = notifService
    .listForContext(actorContext)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const unreadCount = notifications.filter((n) => n.status === "Unread").length;

  const handleMarkAsRead = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    notifService.markRead(id, currentUser.getActorContext());
    setTicker((t) => t + 1);
  };

  const handleDismiss = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    notifService.dismiss(id, currentUser.getActorContext());
    setTicker((t) => t + 1);
  };

  const handleMarkAllAsRead = () => {
    notifications
      .filter((n) => n.status === "Unread")
      .forEach((n) => {
        notifService.markRead(n.id, currentUser.getActorContext());
      });
    setTicker((t) => t + 1);
  };

  const handleClick = (notif: Notification) => {
    if (notif.status === "Unread") {
      notifService.markRead(notif.id, currentUser.getActorContext());
    }
    setOpen(false);
    if (notif.link?.path) {
      navigate({ to: notif.link.path });
    }
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
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" onClick={handleMarkAllAsRead} className="h-8 text-xs">
              Mark all as read
            </Button>
          )}
        </SheetHeader>
        <ScrollArea className="flex-1">
          <div className="flex flex-col">
            {notifications.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                No notifications found.
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
                          onClick={(e) => handleMarkAsRead(notif.id, e)}
                          title="Mark as read"
                        >
                          <Check className="w-3 h-3" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-rose-600"
                        onClick={(e) => handleDismiss(notif.id, e)}
                        title="Dismiss"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground">{notif.message}</div>
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
    </Sheet>
  );
}

function notificationArea(type: string): string {
  const area = type.split(/[.-]/)[0] || "Update";
  return area.charAt(0).toUpperCase() + area.slice(1);
}
