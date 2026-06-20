import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  updateDoc,
  writeBatch,
  where,
  orderBy,
  limit,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "./AuthContext";
import { createNotification } from "@/lib/notifications";
import { formatCurrency } from "@/lib/utils";

export interface AppNotification {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  icon: string;
  taskId?: string;
  completionId?: string;
  read: boolean;
  deletedForUser: boolean;
  createdAt: Date;
}

interface NotificationContextType {
  notifications: AppNotification[];
  unreadCount: number;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  deleteNotif: (id: string) => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

type CompletionStatus =
  | "pending"
  | "platform_pending"
  | "platform_approved"
  | "approved"
  | "rejected";

function completionStatusToNotif(
  status: CompletionStatus,
  taskTitle: string,
  reward: number
): { type: string; title: string; message: string; icon: string } | null {
  const name = taskTitle ? `"${taskTitle}"` : "Your task";
  const amt = formatCurrency(reward);

  switch (status) {
    case "platform_pending":
      return {
        type: "platform_pending",
        title: "Task Submitted",
        message: `${name} has been submitted and is under review.`,
        icon: "⏳",
      };
    case "platform_approved":
      return {
        type: "platform_approved",
        title: "Task Under Review",
        message: `${name} is being reviewed. Your reward of ${amt} will be released once approved.`,
        icon: "🔄",
      };
    case "approved":
      return {
        type: "admin_approved",
        title: "Reward Approved 🎉",
        message: `${amt} has been added to your available balance for completing ${name}.`,
        icon: "💰",
      };
    case "rejected":
      return {
        type: "admin_rejected",
        title: "Task Rejected",
        message: `Your submission for ${name} was rejected. The ${amt} reward has been removed from pending balance.`,
        icon: "❌",
      };
    default:
      return null;
  }
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const completionInitRef = useRef(false);
  const taskInitRef = useRef(false);
  const systemInitRef = useRef(false);
  const withdrawalInitRef = useRef(false);
  const processedRef = useRef<Set<string>>(new Set());

  // ── 1. Realtime listener: user's notification documents ─────────────────
  useEffect(() => {
    if (!user) {
      setNotifications([]);
      return;
    }
    const q = query(
      collection(db, "notifications"),
      where("userId", "==", user.uid),
      where("deletedForUser", "==", false),
      orderBy("createdAt", "desc"),
      limit(100)
    );
    const unsub = onSnapshot(q, (snap) => {
      setNotifications(
        snap.docs.map((d) => ({
          id: d.id,
          userId: d.data().userId as string,
          type: d.data().type as string,
          title: d.data().title as string,
          message: d.data().message as string,
          icon: d.data().icon as string,
          taskId: d.data().taskId || undefined,
          completionId: d.data().completionId || undefined,
          read: (d.data().read as boolean) ?? false,
          deletedForUser: (d.data().deletedForUser as boolean) ?? false,
          createdAt: (d.data().createdAt as Timestamp)?.toDate() || new Date(),
        }))
      );
    });
    return () => unsub();
  }, [user]);

  // ── 2. Watch task completions for status changes ─────────────────────────
  useEffect(() => {
    if (!user) {
      completionInitRef.current = false;
      return;
    }
    completionInitRef.current = false;
    processedRef.current.clear();

    const q = query(
      collection(db, "taskCompletions"),
      where("userId", "==", user.uid)
    );

    const unsub = onSnapshot(q, (snap) => {
      const isInitial = !completionInitRef.current;

      for (const change of snap.docChanges()) {
        const data = change.doc.data();
        const completionId = change.doc.id;
        const status = (data.status as CompletionStatus) || "pending";
        const taskTitle = (data.taskTitle as string) || "";
        const reward = Number(data.reward || 0);
        const taskId = (data.taskId as string) || "";
        const stateKey = `comp_${completionId}_${status}`;

        if (processedRef.current.has(stateKey)) continue;

        if (change.type === "added" && isInitial) {
          // Track existing states without generating notifications
          processedRef.current.add(stateKey);
          continue;
        }

        if (change.type === "added" && !isInitial) {
          // Brand-new completion submitted
          processedRef.current.add(stateKey);
          const notif = completionStatusToNotif(status, taskTitle, reward);
          if (notif) {
            createNotification({
              userId: user.uid,
              type: notif.type as never,
              title: notif.title,
              message: notif.message,
              icon: notif.icon,
              taskId,
              completionId,
              dedupeKey: stateKey,
            });
          }
        }

        if (change.type === "modified") {
          processedRef.current.add(stateKey);
          const notif = completionStatusToNotif(status, taskTitle, reward);
          if (notif) {
            createNotification({
              userId: user.uid,
              type: notif.type as never,
              title: notif.title,
              message: notif.message,
              icon: notif.icon,
              taskId,
              completionId,
              dedupeKey: stateKey,
            });
          }
        }
      }

      if (isInitial) completionInitRef.current = true;
    });

    return () => {
      unsub();
      completionInitRef.current = false;
    };
  }, [user]);

  // ── 3. Watch new tasks being published ───────────────────────────────────
  useEffect(() => {
    if (!user) {
      taskInitRef.current = false;
      return;
    }
    taskInitRef.current = false;

    const q = query(
      collection(db, "tasks"),
      where("active", "==", true),
      orderBy("createdAt", "desc"),
      limit(20)
    );

    const unsub = onSnapshot(q, (snap) => {
      const isInitial = !taskInitRef.current;

      if (!isInitial) {
        for (const change of snap.docChanges()) {
          if (change.type !== "added") continue;
          const data = change.doc.data();
          if (data.networkStatus !== "approved") continue;
          const taskId = change.doc.id;
          const dedupeKey = `newtask_${taskId}`;
          if (processedRef.current.has(dedupeKey)) continue;
          processedRef.current.add(dedupeKey);

          createNotification({
            userId: user.uid,
            type: "new_task",
            title: "New Task Available 📋",
            message: `"${(data.title as string) || "A new task"}" is now available on the Tasks page.`,
            icon: "📋",
            taskId,
            dedupeKey,
          });
        }
      }

      if (isInitial) taskInitRef.current = true;
    });

    return () => {
      unsub();
      taskInitRef.current = false;
    };
  }, [user]);

  // ── 4. Watch system messages (admin broadcasts) ──────────────────────────
  useEffect(() => {
    if (!user) {
      systemInitRef.current = false;
      return;
    }
    systemInitRef.current = false;

    const q = query(
      collection(db, "systemMessages"),
      where("active", "==", true),
      orderBy("createdAt", "desc"),
      limit(10)
    );

    const unsub = onSnapshot(q, (snap) => {
      const isInitial = !systemInitRef.current;

      for (const change of snap.docChanges()) {
        if (change.type === "added" && !isInitial) {
          const data = change.doc.data();
          const msgId = change.doc.id;
          const dedupeKey = `sysmsg_${msgId}`;
          if (processedRef.current.has(dedupeKey)) continue;
          processedRef.current.add(dedupeKey);

          createNotification({
            userId: user.uid,
            type: "system_message",
            title: (data.title as string) || "System Message",
            message: (data.message as string) || "",
            icon: "📢",
            dedupeKey,
          });
        }
      }

      if (isInitial) systemInitRef.current = true;
    });

    return () => {
      unsub();
      systemInitRef.current = false;
    };
  }, [user]);

  // ── 5. Watch withdrawals for status changes ──────────────────────────────
  useEffect(() => {
    if (!user) {
      withdrawalInitRef.current = false;
      return;
    }
    withdrawalInitRef.current = false;

    const q = query(
      collection(db, "withdrawals"),
      where("userId", "==", user.uid)
    );

    const unsub = onSnapshot(q, (snap) => {
      const isInitial = !withdrawalInitRef.current;

      for (const change of snap.docChanges()) {
        const data = change.doc.data();
        const wId = change.doc.id;

        if (change.type === "added" && !isInitial) {
          const dedupeKey = `wd_submitted_${wId}`;
          if (!processedRef.current.has(dedupeKey)) {
            processedRef.current.add(dedupeKey);
            createNotification({
              userId: user.uid,
              type: "withdrawal_submitted",
              title: "Withdrawal Requested 💸",
              message: `Your withdrawal of ${formatCurrency(Number(data.amount || 0))} has been submitted and is pending admin review.`,
              icon: "💸",
              dedupeKey,
            });
          }
        }

        if (change.type === "modified") {
          const status = data.status as string;
          if (status === "approved") {
            const dedupeKey = `wd_approved_${wId}`;
            if (!processedRef.current.has(dedupeKey)) {
              processedRef.current.add(dedupeKey);
              createNotification({
                userId: user.uid,
                type: "withdrawal_approved",
                title: "Withdrawal Approved ✅",
                message: `Your withdrawal of ${formatCurrency(Number(data.netAmount || data.amount || 0))} has been approved.`,
                icon: "✅",
                dedupeKey,
              });
            }
          } else if (status === "rejected") {
            const dedupeKey = `wd_rejected_${wId}`;
            if (!processedRef.current.has(dedupeKey)) {
              processedRef.current.add(dedupeKey);
              createNotification({
                userId: user.uid,
                type: "withdrawal_rejected",
                title: "Withdrawal Rejected",
                message: `Your withdrawal was rejected. ${data.note ? `Reason: ${data.note}` : "Your funds have been returned to your available balance."}`,
                icon: "❌",
                dedupeKey,
              });
            }
          }
        }
      }

      if (isInitial) withdrawalInitRef.current = true;
    });

    return () => {
      unsub();
      withdrawalInitRef.current = false;
    };
  }, [user]);

  // ── User actions ──────────────────────────────────────────────────────────
  async function markRead(id: string) {
    await updateDoc(doc(db, "notifications", id), { read: true });
  }

  async function markAllRead() {
    const unread = notifications.filter((n) => !n.read);
    if (unread.length === 0) return;
    const batch = writeBatch(db);
    for (const n of unread) {
      batch.update(doc(db, "notifications", n.id), { read: true });
    }
    await batch.commit();
  }

  async function deleteNotif(id: string) {
    await updateDoc(doc(db, "notifications", id), { deletedForUser: true });
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider
      value={{ notifications, unreadCount, markRead, markAllRead, deleteNotif }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationProvider");
  return ctx;
}
