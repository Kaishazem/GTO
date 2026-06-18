import { useState } from "react";
import {
  Bell,
  CheckCheck,
  Trash2,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNotifications } from "@/contexts/NotificationContext";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

export default function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount, markRead, markAllRead, deleteNotif } =
    useNotifications();

  function handleOpen() {
    setOpen(true);
  }

  return (
    <>
      {/* Bell icon trigger */}
      <button
        onClick={handleOpen}
        data-testid="button-notifications"
        aria-label="Open notifications"
        className="relative p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/8 transition-all"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-red-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center px-1 leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Notification panel */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="bg-slate-900 border-l border-white/10 text-white w-full sm:max-w-sm p-0 flex flex-col gap-0"
          data-testid="panel-notifications"
        >
          {/* Header */}
          <SheetHeader className="px-5 py-4 border-b border-white/10 shrink-0">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-white text-base font-bold flex items-center gap-2">
                <Bell className="w-4 h-4 text-white/60" />
                Notifications
                {unreadCount > 0 && (
                  <span className="text-xs bg-red-500/20 text-red-300 border border-red-500/30 px-1.5 py-0.5 rounded-full font-medium">
                    {unreadCount} new
                  </span>
                )}
              </SheetTitle>
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={markAllRead}
                  data-testid="button-mark-all-read"
                  className="text-white/40 hover:text-white text-xs h-7 px-2"
                >
                  <CheckCheck className="w-3.5 h-3.5 mr-1" />
                  Mark all read
                </Button>
              )}
            </div>
          </SheetHeader>

          {/* Body */}
          {notifications.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-white/25 p-10">
              <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center">
                <Bell className="w-8 h-8 opacity-40" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-white/40">No notifications yet</p>
                <p className="text-xs text-white/25 mt-1 leading-relaxed">
                  Activity alerts will appear here in real time — no page refresh needed.
                </p>
              </div>
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="py-2 px-2 space-y-0.5">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    data-testid={`notif-item-${n.id}`}
                    onClick={() => { if (!n.read) markRead(n.id); }}
                    className={cn(
                      "flex items-start gap-3 px-3 py-3 rounded-xl transition-all group cursor-pointer select-none",
                      n.read
                        ? "hover:bg-white/5"
                        : "bg-white/[0.06] hover:bg-white/[0.09]"
                    )}
                  >
                    {/* Icon */}
                    <div className="text-xl shrink-0 mt-0.5 w-8 text-center leading-none">
                      {n.icon}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p
                          className={cn(
                            "text-sm font-semibold leading-snug",
                            n.read ? "text-white/55" : "text-white"
                          )}
                        >
                          {n.title}
                        </p>
                        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                          {!n.read && (
                            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteNotif(n.id);
                            }}
                            data-testid={`button-delete-notif-${n.id}`}
                            className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-white/30 hover:text-red-400 transition-all"
                            aria-label="Delete notification"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-white/40 mt-0.5 leading-relaxed">
                        {n.message}
                      </p>
                      <p className="text-xs text-white/20 mt-1.5">
                        {formatDate(n.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Footer hint */}
              {notifications.length > 0 && (
                <div className="px-5 py-3 border-t border-white/5 mt-1">
                  <p className="text-xs text-white/20 text-center flex items-center justify-center gap-1">
                    <MessageSquare className="w-3 h-3" />
                    Notifications are personalised and only visible to you
                  </p>
                </div>
              )}
            </ScrollArea>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
