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
 *
 * WHY the two-step approach:
 * Firestore security rule: `allow read: if resource.data.userId == request.auth.uid`
 * When the document does NOT exist, `resource` is null → `resource.data` throws in the
 * rule evaluator → permission-denied is returned to the client.
 * So getDoc() throws for regular users on non-existent docs. We catch that and attempt
 * the write directly. The CREATE rule uses `request.resource.data` (the incoming data),
 * which is always defined, so it evaluates correctly.
 */
export async function createNotification(payload: NotifPayload): Promise<void> {
  const safeKey = payload.dedupeKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  const uidPrefix = payload.userId.slice(0, 12);
  const docId = `${uidPrefix}_${safeKey}`;
  const ref = doc(db, "notifications", docId);

  const data = {
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
  };

  try {
    // Step 1: Try to read the document to check if it already exists.
    // If it exists, return early to preserve the user's read/deleted state.
    // NOTE: this getDoc will throw "permission-denied" for regular users when
    // the document does NOT exist (Firestore rule evaluates resource.data on null).
    const existing = await getDoc(ref);
    if (existing.exists()) return;
    // Doc confirmed not to exist — create it.
    await setDoc(ref, data);
  } catch (err) {
    // getDoc threw — most likely because the doc doesn't exist and the Firestore
    // read rule evaluated resource.data on a null resource (permission-denied).
    // Fall through to a direct setDoc: the CREATE rule checks request.resource.data
    // (the incoming payload) which is always defined and matches the user's uid.
    const e = err as { code?: string; message?: string };
    console.warn(`[createNotification] getDoc failed (${e?.code}): ${e?.message} — attempting direct setDoc`, { docId, type: payload.type });
    try {
      await setDoc(ref, data);
    } catch (err2) {
      const e2 = err2 as { code?: string; message?: string };
      console.error(`[createNotification] setDoc FAILED (${e2?.code}): ${e2?.message}`, { docId, type: payload.type, userId: payload.userId });
    }
  }
}
