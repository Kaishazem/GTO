import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type NotifType =
  | "task_submitted"
  | "platform_approved"
  | "platform_rejected"
  | "platform_pending"
  | "admin_approved"
  | "admin_rejected"
  | "withdrawal_submitted"
  | "withdrawal_approved"
  | "withdrawal_rejected"
  | "new_task"
  | "system_message";

export interface NotifPayload {
  userId: string;
  type: NotifType;
  title: string;
  message: string;
  icon: string;
  taskId?: string;
  completionId?: string;
  dedupeKey: string;
}

/**
 * Create a notification document only if one with this dedupeKey doesn't already exist.
 * Uses a deterministic document ID for idempotency — safe to call multiple times.
 */
export async function createNotification(payload: NotifPayload): Promise<void> {
  const safeKey = payload.dedupeKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  const uidPrefix = payload.userId.slice(0, 12);
  const docId = `${uidPrefix}_${safeKey}`;
  const ref = doc(db, "notifications", docId);

  try {
    const existing = await getDoc(ref);
    if (existing.exists()) return;

    await setDoc(ref, {
      userId: payload.userId,
      type: payload.type,
      title: payload.title,
      message: payload.message,
      icon: payload.icon,
      taskId: payload.taskId ?? null,
      completionId: payload.completionId ?? null,
      dedupeKey: payload.dedupeKey,
      read: false,
      deletedForUser: false,
      createdAt: serverTimestamp(),
    });
  } catch {
    // Non-critical — silently ignore (e.g. offline, permission denied)
  }
}
