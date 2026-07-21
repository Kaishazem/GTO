import { createContext, useContext, useState, useEffect } from "react";
import {
  collection,
  getDocs,
  setDoc,
  updateDoc,
  doc,
  query,
  where,
  serverTimestamp,
  Timestamp,
  getDoc,
  increment,
  limit,
  startAfter,
  onSnapshot,
  runTransaction,
  QueryDocumentSnapshot,
  DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "./AuthContext";
import { userReward } from "@/lib/utils";
import { inferTaskType } from "@/lib/taskType";
import { getSettings } from "@/lib/settings";

export interface Task {
  id: string;
  title: string;
  description: string;
  type: "simple" | "premium";
  taskType: "manual" | "platform";
  status: "draft" | "published";
  manualAdminRate?: number;
  manualUserSharePercent?: number;
  reward: number;
  url: string;
  platform: string;
  active: boolean;
  networkStatus: "pending" | "approved" | "rejected";
  createdAt: Date;
  // Fields imported from ad platforms via the Universal Platform Engine
  category?: string;
  countries?: string[];
  devices?: string[];
  requirements?: string;
  image?: string;
  conversionType?: string;
  externalId?: string;
  // Investigation fields — stored in Firestore but previously missing from interface
  trackingUrl?: string;
  previewUrl?: string;
  payout?: number;
  platformId?: string;
  rawPlatformResponse?: string;
}

/**
 * Task completion lifecycle statuses.
 *
 * Platform task state machine:
 *   started → user_confirmed ──────────────────┐
 *   started → postback_verified → platform_approved → approved
 *           user_confirmed ← postback arrives ──┘
 *
 * Manual task state machine:
 *   pending → approved | rejected
 */
export type TaskCompletionStatus =
  | "started"           // User clicked "Start Task" — completion record created, awaiting both events
  | "user_confirmed"    // User clicked "Completed Task" — waiting for CPA postback
  | "postback_verified" // CPA postback received and approved — waiting for user to confirm
  | "pending"           // Manual task submitted — awaiting admin review
  | "platform_pending"  // Legacy: equivalent to started+user_confirmed combined (pre-redesign records)
  | "platform_approved" // Both user confirmed AND postback verified — awaiting admin settlement
  | "approved"          // Admin settled — reward moved to balance
  | "rejected";         // Rejected by platform or admin

export interface TaskCompletion {
  id: string;
  taskId: string;
  userId: string;
  completedAt: Date;
  reward: number;
  status: TaskCompletionStatus;
  taskTitle?: string;
  taskDescription?: string;
  taskType?: "manual" | "platform";
  verifiedBy?: string;
}

const PAGE_SIZE = 50;

interface TaskContextType {
  tasks: Task[];
  completions: TaskCompletion[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  fetchTasks: () => Promise<void>;
  loadMoreTasks: () => Promise<void>;
  fetchCompletions: () => Promise<void>;
  /** Create a TaskCompletion record immediately when user opens the offer URL. */
  startTask: (taskId: string) => Promise<void>;
  /** Mark user confirmation and advance lifecycle state. */
  completeTask: (taskId: string) => Promise<void>;
  canDoMoreTasks: boolean;
}

const TaskContext = createContext<TaskContextType | null>(null);

/**
 * Deterministic document ID for a task completion.
 *
 * Using a fixed ID instead of Firestore auto-IDs guarantees:
 *   - At most ONE document per (userId, taskId)
 *   - setDoc() is idempotent for creation
 *   - getDoc() can look up the document without a query
 *
 * Format: `${userId}_${taskId}`
 * Both Firestore UID and auto-ID characters are alphanumeric + hyphen/underscore —
 * no separator collision risk.
 */
function completionDocId(userId: string, taskId: string): string {
  return `${userId}_${taskId}`;
}

export function TaskProvider({ children }: { children: React.ReactNode }) {
  const { user, profile, refreshProfile } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [completions, setCompletions] = useState<TaskCompletion[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);

  // No daily limits — users can complete unlimited tasks
  const canDoMoreTasks = true;

  function mapTask(d: QueryDocumentSnapshot<DocumentData>): Task {
    const data = d.data();
    const toStringArray = (v: unknown): string[] | undefined => {
      if (!v) return undefined;
      if (Array.isArray(v)) {
        const arr = v.map(String).filter(Boolean);
        return arr.length > 0 ? arr : undefined;
      }
      const s = String(v).trim();
      if (!s) return undefined;
      return s.split(/[,;|]/).map((x) => x.trim()).filter(Boolean);
    };
    return {
      id: d.id,
      title: data.title || "",
      description: data.description || "",
      type: data.type || "simple",
      taskType: (data.taskType as Task["taskType"]) || "platform",
      status: (data.status as Task["status"]) || "published",
      manualAdminRate: typeof data.manualAdminRate === "number" ? data.manualAdminRate : undefined,
      manualUserSharePercent: typeof data.manualUserSharePercent === "number" ? data.manualUserSharePercent : undefined,
      reward: data.reward || 0,
      url: data.url || "",
      platform: data.platform || "",
      active: data.active ?? true,
      networkStatus: data.networkStatus || "pending",
      createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
      category: data.category ? String(data.category) : undefined,
      countries: toStringArray(data.countries),
      devices: toStringArray(data.devices),
      requirements: data.requirements ? String(data.requirements) : undefined,
      image: data.image ? String(data.image) : undefined,
      conversionType: data.conversionType ? String(data.conversionType) : undefined,
      externalId: data.externalId ? String(data.externalId) : undefined,
      trackingUrl: data.trackingUrl ? String(data.trackingUrl) : undefined,
      previewUrl: data.previewUrl ? String(data.previewUrl) : undefined,
      payout: data.payout !== undefined && data.payout !== null ? (typeof data.payout === 'number' ? data.payout : parseFloat(String(data.payout)) || 0) : undefined,
      platformId: data.platformId ? String(data.platformId) : undefined,
      rawPlatformResponse: data.rawPlatformResponse ? String(data.rawPlatformResponse) : undefined,
    };
  }

  async function fetchTasks() {
    setLoading(true);
    try {
      // Single-field filter to avoid composite index requirement; filter networkStatus client-side
      const q = query(
        collection(db, "tasks"),
        where("active", "==", true),
        limit(PAGE_SIZE)
      );
      const snap = await getDocs(q);
      const fetched = snap.docs
        .map(mapTask)
        .filter((t) => t.networkStatus === "approved" && t.status === "published");
      fetched.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setTasks(fetched);
      setLastDoc(snap.docs[snap.docs.length - 1] || null);
      setHasMore(snap.docs.length === PAGE_SIZE);
    } finally {
      setLoading(false);
    }
  }

  async function loadMoreTasks() {
    if (!lastDoc || loadingMore) return;
    setLoadingMore(true);
    try {
      const q = query(
        collection(db, "tasks"),
        where("active", "==", true),
        startAfter(lastDoc),
        limit(PAGE_SIZE)
      );
      const snap = await getDocs(q);
      const fetched = snap.docs
        .map(mapTask)
        .filter((t) => t.networkStatus === "approved" && t.status === "published");
      fetched.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setTasks((prev) => [...prev, ...fetched]);
      setLastDoc(snap.docs[snap.docs.length - 1] || null);
      setHasMore(snap.docs.length === PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  }

  async function fetchCompletions() {
    if (!user) return;
    const q = query(
      collection(db, "taskCompletions"),
      where("userId", "==", user.uid)
    );
    const snap = await getDocs(q);
    const fetched: TaskCompletion[] = snap.docs.map((d) => ({
      id: d.id,
      taskId: d.data().taskId,
      userId: d.data().userId,
      completedAt: (d.data().completedAt as Timestamp)?.toDate() || new Date(),
      reward: d.data().reward || 0,
      status: (d.data().status as TaskCompletionStatus) || "pending",
      taskTitle: d.data().taskTitle,
      taskDescription: d.data().taskDescription,
      taskType: d.data().taskType,
      verifiedBy: d.data().verifiedBy,
    }));
    fetched.sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());
    setCompletions(fetched);
  }

  /**
   * Called when the user clicks "Start Task" and the offer URL is opened.
   *
   * Creates a TaskCompletion with status `started` immediately so that:
   * - A CPA postback arriving before the user confirms can be matched.
   * - The "Completed Task" button becomes visible without relying on localStorage.
   *
   * Uses a DETERMINISTIC document ID (userId_taskId) so:
   * - Only one document can ever exist per (user, task) pair.
   * - The operation is idempotent: if the document already exists, it is left unchanged.
   * - Queries against React state are NOT used — Firestore is the source of truth.
   */
  async function startTask(taskId: string) {
    if (!user || !profile) throw new Error("You must be logged in");

    const taskDoc = await getDoc(doc(db, "tasks", taskId));
    if (!taskDoc.exists()) throw new Error("Task not found");
    const rawTask = taskDoc.data() as Record<string, unknown>;
    const taskData = taskDoc.data() as Task;

    if (taskData.networkStatus !== "approved") throw new Error("This task is not approved yet");
    if (taskData.status && taskData.status !== "published") throw new Error("This task is not published yet");

    const taskType = inferTaskType(rawTask);

    // Only platform tasks need a `started` record — manual tasks have no postback.
    // Manual tasks create their completion at the "Completed Task" step.
    if (taskType !== "platform") return;

    const adminReward = Number(taskData.reward || 0);
    const settings = await getSettings();
    const earned = userReward(adminReward, "platform", {
      platformUserSharePercent: settings.platformTaskUserSharePercent,
    });

    const uid = user.uid; // capture before nested async functions lose TS narrowing
    const docId = completionDocId(uid, taskId);
    const completionRef = doc(db, "taskCompletions", docId);

    // Atomic check-and-create: if the document already exists (any status),
    // leave it untouched — the user may have already confirmed or the
    // postback may have already arrived. Never overwrite a further-along state.
    // Retry helper — Firestore transactions can fail on transient network errors.
    // Retry up to 3 times with short exponential back-off before giving up.
    async function attemptTransaction(attempt: number): Promise<void> {
      console.log(`[startTask] runTransaction attempt ${attempt}`, {
        path: `taskCompletions/${docId}`,
      });
      await runTransaction(db, async (tx) => {
        let snap: Awaited<ReturnType<typeof tx.get>>;
        try {
          snap = await tx.get(completionRef);
        } catch (e: unknown) {
          const err = e as { code?: string; message?: string };
          console.error(`[startTask] tx.get FAILED (attempt ${attempt})`, { code: err.code, message: err.message });
          throw e;
        }

        if (snap.exists()) {
          console.log("[startTask] tx.get found existing doc — no-op", { currentStatus: (snap.data() as Record<string, unknown>)?.status });
          return;
        }

        console.log("[startTask] tx.set — creating started doc", { path: `taskCompletions/${docId}` });
        tx.set(completionRef, {
          taskId,
          userId: uid,
          startedAt: serverTimestamp(),
          completedAt: serverTimestamp(),
          reward: earned,
          adminReward,
          status: "started" satisfies TaskCompletionStatus,
          taskTitle: taskData.title,
          taskDescription: taskData.description || "",
          taskType,
          taskPlatform: taskData.platform,
          platformId: taskData.platformId ?? null,
          importedFrom: (taskData as unknown as Record<string, unknown>).importedFrom ?? null,
          sourceType: (taskData as unknown as Record<string, unknown>).sourceType ?? null,
          manualAdminRate: taskData.manualAdminRate ?? null,
          manualUserSharePercent: taskData.manualUserSharePercent ?? null,
        });
      });
    }

    const MAX_ATTEMPTS = 3;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await attemptTransaction(attempt);
        console.log("[startTask] ✅ runTransaction DONE — doc written at", `taskCompletions/${docId}`);
        lastErr = null;
        break;
      } catch (e: unknown) {
        lastErr = e;
        const err = e as { code?: string; message?: string };
        console.error(`[startTask] attempt ${attempt}/${MAX_ATTEMPTS} FAILED`, { code: err.code, message: err.message });
        if (attempt < MAX_ATTEMPTS) {
          // Exponential back-off: 400 ms, 800 ms
          await new Promise<void>((res) => setTimeout(res, 400 * attempt));
        }
      }
    }
    if (lastErr) {
      const err = lastErr as { code?: string; message?: string; stack?: string };
      console.error("[startTask] ALL attempts failed — tracking doc NOT created", { code: err.code, message: err.message });
      throw lastErr;
    }

    // pendingBalance is NOT incremented here — only when the user confirms.
  }

  /**
   * Called when the user clicks "Completed Task".
   *
   * SOURCE OF TRUTH: reads from Firestore directly — never from React state.
   * This eliminates the stale-state bug that caused duplicate document creation.
   *
   * Uses a DETERMINISTIC document ID (userId_taskId):
   * - getDoc() lookup instead of a collection query (O(1))
   * - setDoc() on creation guarantees no duplicates even under rapid calls
   * - runTransaction() makes status advancement + pendingBalance atomic
   *
   * Platform tasks:
   *   - If `started`          → user_confirmed   (waiting for postback)
   *   - If `postback_verified`→ platform_approved (both done — ready for admin)
   *   - If `platform_pending` → user_confirmed   (legacy record — treat as started)
   *
   * Manual tasks (no existing record):
   *   - Creates a new `pending` completion for admin review.
   *
   * pendingBalance is incremented here (first time user signals they finished).
   */
  async function completeTask(taskId: string) {
    if (!user || !profile) throw new Error("You must be logged in");

    const docId = completionDocId(user.uid, taskId);
    const completionRef = doc(db, "taskCompletions", docId);
    const userRef = doc(db, "users", user.uid);

    // ── STEP 1: getDoc (deterministic path) ──────────────────────────────
    console.log("[completeTask] getDoc", {
      op: "get",
      path: `taskCompletions/${docId}`,
      note: "deterministic ID lookup — NOT React state",
    });
    let completionSnap: Awaited<ReturnType<typeof getDoc>>;
    try {
      completionSnap = await getDoc(completionRef);
      console.log("[completeTask] getDoc result", {
        exists: completionSnap.exists(),
        currentStatus: completionSnap.exists() ? (completionSnap.data() as Record<string, unknown>)?.status : "(doc does not exist)",
      });
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string; stack?: string };
      console.error("[completeTask] getDoc FAILED", {
        path: `taskCompletions/${docId}`,
        code: err.code,
        message: err.message,
        stack: err.stack,
      });
      throw e;
    }

    if (completionSnap.exists()) {
      const snapData = completionSnap.data() as Record<string, unknown>;
      const currentStatus = snapData.status as TaskCompletionStatus;
      const earned = Number(snapData.reward) || 0;

      if (currentStatus === "user_confirmed" || currentStatus === "platform_approved" || currentStatus === "approved") {
        throw new Error("You have already submitted this task");
      }
      if (currentStatus === "rejected") {
        throw new Error("This task was rejected and cannot be resubmitted");
      }

      const newStatus: TaskCompletionStatus =
        currentStatus === "postback_verified" ? "platform_approved" : "user_confirmed";

      // ── STEP 2A: runTransaction — update existing doc ─────────────────
      console.log("[completeTask] runTransaction (existing doc path)", {
        op: "runTransaction",
        path: `taskCompletions/${docId}`,
        currentStatus,
        targetStatus: newStatus,
      });
      try {
        await runTransaction(db, async (tx) => {
          console.log("[completeTask] tx.get (re-read inside tx)", {
            op: "get",
            path: `taskCompletions/${docId}`,
          });
          let fresh: Awaited<ReturnType<typeof tx.get>>;
          try {
            fresh = await tx.get(completionRef);
          } catch (e: unknown) {
            const err = e as { code?: string; message?: string; stack?: string };
            console.error("[completeTask] tx.get FAILED inside transaction", {
              path: `taskCompletions/${docId}`,
              code: err.code,
              message: err.message,
              stack: err.stack,
            });
            throw e;
          }
          if (!fresh.exists()) throw new Error("Task completion not found");

          const freshData = fresh.data() as Record<string, unknown>;
          const freshStatus = freshData.status as TaskCompletionStatus;
          console.log("[completeTask] tx.get result", { freshStatus });

          if (freshStatus === "user_confirmed" || freshStatus === "platform_approved" || freshStatus === "approved") {
            throw new Error("You have already submitted this task");
          }
          if (freshStatus === "rejected") {
            throw new Error("This task was rejected and cannot be resubmitted");
          }

          const resolvedNew: TaskCompletionStatus =
            freshStatus === "postback_verified" ? "platform_approved" : "user_confirmed";

          console.log("[completeTask] tx.update (completion doc)", {
            op: "update",
            path: `taskCompletions/${docId}`,
            currentStatus: freshStatus,
            targetStatus: resolvedNew,
          });
          tx.update(completionRef, {
            status: resolvedNew,
            completedAt: serverTimestamp(),
            userConfirmedAt: serverTimestamp(),
          });

          console.log("[completeTask] tx.update (user doc)", {
            op: "update",
            path: `users/${user.uid}`,
            field: "pendingBalance",
            increment: earned,
          });
          tx.update(userRef, {
            pendingBalance: increment(earned),
          });
        });
        console.log("[completeTask] runTransaction DONE (existing doc path)");
      } catch (e: unknown) {
        const err = e as { code?: string; message?: string; stack?: string };
        console.error("[completeTask] runTransaction FAILED (existing doc path)", {
          code: err.code,
          message: err.message,
          stack: err.stack,
        });
        throw e;
      }

      await fetchCompletions();
      await refreshProfile();
      return;
    }

    // ── STEP 2B: legacy query fallback ───────────────────────────────────
    console.log("[completeTask] getDocs (legacy query — deterministic doc not found)", {
      op: "getDocs",
      collection: "taskCompletions",
      where: { userId: user.uid, taskId },
    });
    let legacySnap: Awaited<ReturnType<typeof getDocs>>;
    try {
      legacySnap = await getDocs(
        query(
          collection(db, "taskCompletions"),
          where("userId", "==", user.uid),
          where("taskId", "==", taskId),
          limit(1)
        )
      );
      console.log("[completeTask] getDocs result", {
        empty: legacySnap.empty,
        count: legacySnap.docs.length,
        firstDocId: legacySnap.empty ? "(none)" : legacySnap.docs[0].id,
        firstDocStatus: legacySnap.empty ? "(none)" : (legacySnap.docs[0].data() as Record<string, unknown>)?.status,
      });
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string; stack?: string };
      console.error("[completeTask] getDocs FAILED (legacy query)", {
        code: err.code,
        message: err.message,
        stack: err.stack,
      });
      throw e;
    }

    if (!legacySnap.empty) {
      const legacyDoc = legacySnap.docs[0];
      const legacyData = legacyDoc.data() as Record<string, unknown>;
      const currentStatus = legacyData.status as TaskCompletionStatus;
      const earned = Number(legacyData.reward) || 0;

      if (currentStatus === "user_confirmed" || currentStatus === "platform_approved" || currentStatus === "approved") {
        throw new Error("You have already submitted this task");
      }
      if (currentStatus === "rejected") {
        throw new Error("This task was rejected and cannot be resubmitted");
      }

      const newStatus: TaskCompletionStatus =
        currentStatus === "postback_verified" ? "platform_approved" : "user_confirmed";

      console.log("[completeTask] runTransaction (legacy doc migration)", {
        op: "runTransaction",
        legacyDocPath: `taskCompletions/${legacyDoc.id}`,
        canonicalDocPath: `taskCompletions/${docId}`,
        currentStatus,
        targetStatus: newStatus,
        note: "tx.set on canonical path (create rule), tx.update on user doc",
      });
      try {
        await runTransaction(db, async (tx) => {
          console.log("[completeTask] tx.set (canonical doc)", {
            op: "set",
            path: `taskCompletions/${docId}`,
            currentStatus: "(none — creating canonical)",
            targetStatus: newStatus,
          });
          tx.set(completionRef, {
            ...(legacyDoc.data() as Record<string, unknown>),
            status: newStatus,
            completedAt: serverTimestamp(),
            userConfirmedAt: serverTimestamp(),
          });

          console.log("[completeTask] tx.update (user doc)", {
            op: "update",
            path: `users/${user.uid}`,
            field: "pendingBalance",
            increment: earned,
          });
          tx.update(userRef, {
            pendingBalance: increment(earned),
          });
        });
        console.log("[completeTask] runTransaction DONE (legacy migration)");
      } catch (e: unknown) {
        const err = e as { code?: string; message?: string; stack?: string };
        console.error("[completeTask] runTransaction FAILED (legacy migration)", {
          code: err.code,
          message: err.message,
          stack: err.stack,
        });
        throw e;
      }

      await fetchCompletions();
      await refreshProfile();
      return;
    }

    // ── STEP 2C: no record at all — create fresh ─────────────────────────
    console.log("[completeTask] no existing doc found — will create fresh completion", {
      userId: user.uid,
      taskId,
    });

    const taskDoc = await getDoc(doc(db, "tasks", taskId));
    if (!taskDoc.exists()) throw new Error("Task not found");
    const rawTask = taskDoc.data() as Record<string, unknown>;
    const taskData = taskDoc.data() as Task;

    if (taskData.networkStatus !== "approved") throw new Error("This task is not approved yet");
    if (taskData.status && taskData.status !== "published") throw new Error("This task is not published yet");

    const taskType = inferTaskType(rawTask);
    const adminReward = Number(taskData.reward || 0);
    const settings = await getSettings();

    const earned =
      taskType === "manual"
        ? userReward(adminReward, "manual", {
            manualUserSharePercent: taskData.manualUserSharePercent,
            manualAdminRate: taskData.manualAdminRate,
          })
        : userReward(adminReward, "platform", {
            platformUserSharePercent: settings.platformTaskUserSharePercent,
          });

    const initialStatus: TaskCompletionStatus =
      taskType === "platform" ? "user_confirmed" : "pending";

    console.log("[completeTask] runTransaction (fresh create)", {
      op: "runTransaction",
      path: `taskCompletions/${docId}`,
      currentStatus: "(none)",
      targetStatus: initialStatus,
      taskType,
    });
    try {
      await runTransaction(db, async (tx) => {
        console.log("[completeTask] tx.get (race-check inside tx)", {
          op: "get",
          path: `taskCompletions/${docId}`,
        });
        let fresh: Awaited<ReturnType<typeof tx.get>>;
        try {
          fresh = await tx.get(completionRef);
        } catch (e: unknown) {
          const err = e as { code?: string; message?: string; stack?: string };
          console.error("[completeTask] tx.get FAILED (fresh create race-check)", {
            path: `taskCompletions/${docId}`,
            code: err.code,
            message: err.message,
            stack: err.stack,
          });
          throw e;
        }

        if (fresh.exists()) {
          const freshConcurrentData = fresh.data() as Record<string, unknown>;
          const freshStatus = freshConcurrentData.status as TaskCompletionStatus;
          console.log("[completeTask] tx.get: doc appeared concurrently", { freshStatus });
          if (freshStatus === "user_confirmed" || freshStatus === "platform_approved" || freshStatus === "approved") {
            throw new Error("You have already submitted this task");
          }
          if (freshStatus === "rejected") {
            throw new Error("This task was rejected and cannot be resubmitted");
          }
          const freshEarned = Number(freshConcurrentData.reward) || earned;
          const resolvedNew: TaskCompletionStatus =
            freshStatus === "postback_verified" ? "platform_approved" : "user_confirmed";
          console.log("[completeTask] tx.update (concurrent doc)", {
            op: "update",
            path: `taskCompletions/${docId}`,
            currentStatus: freshStatus,
            targetStatus: resolvedNew,
          });
          tx.update(completionRef, {
            status: resolvedNew,
            completedAt: serverTimestamp(),
            userConfirmedAt: serverTimestamp(),
          });
          tx.update(userRef, { pendingBalance: increment(freshEarned) });
          return;
        }

        console.log("[completeTask] tx.set (new doc)", {
          op: "set",
          path: `taskCompletions/${docId}`,
          currentStatus: "(none)",
          targetStatus: initialStatus,
        });
        tx.set(completionRef, {
          taskId,
          userId: user.uid,
          completedAt: serverTimestamp(),
          userConfirmedAt: serverTimestamp(),
          reward: earned,
          adminReward,
          status: initialStatus,
          taskTitle: taskData.title,
          taskDescription: taskData.description || "",
          taskType,
          manualAdminRate: taskData.manualAdminRate ?? null,
          manualUserSharePercent: taskData.manualUserSharePercent ?? null,
          taskPlatform: taskData.platform,
        });

        console.log("[completeTask] tx.update (user doc)", {
          op: "update",
          path: `users/${user.uid}`,
          field: "pendingBalance",
          increment: earned,
        });
        tx.update(userRef, { pendingBalance: increment(earned) });
      });
      console.log("[completeTask] runTransaction DONE (fresh create)");
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string; stack?: string };
      console.error("[completeTask] runTransaction FAILED (fresh create)", {
        code: err.code,
        message: err.message,
        stack: err.stack,
      });
      throw e;
    }

    await fetchCompletions();
    await refreshProfile();
  }

  // Real-time listeners — auto-refresh tasks and completions whenever Firestore changes
  useEffect(() => {
    if (!user) {
      setTasks([]);
      setCompletions([]);
      return;
    }
    setLoading(true);

    const tasksQ = query(collection(db, "tasks"), where("active", "==", true));
    const unsubTasks = onSnapshot(tasksQ, (snap) => {
      const fetched = snap.docs
        .map(mapTask)
        .filter((t) => t.networkStatus === "approved" && t.status === "published");
      fetched.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setTasks(fetched);
      setLastDoc(snap.docs[snap.docs.length - 1] || null);
      setHasMore(snap.docs.length >= PAGE_SIZE);
      setLoading(false);
    });

    const completionsQ = query(
      collection(db, "taskCompletions"),
      where("userId", "==", user.uid)
    );
    const unsubCompletions = onSnapshot(completionsQ, (snap) => {
      const fetched: TaskCompletion[] = snap.docs.map((d) => ({
        id: d.id,
        taskId: d.data().taskId,
        userId: d.data().userId,
        completedAt: (d.data().completedAt as Timestamp)?.toDate() || new Date(),
        reward: d.data().reward || 0,
        status: (d.data().status as TaskCompletionStatus) || "pending",
        taskTitle: d.data().taskTitle,
        taskDescription: d.data().taskDescription,
        taskType: d.data().taskType,
        verifiedBy: d.data().verifiedBy,
      }));
      fetched.sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());
      setCompletions(fetched);
    });

    return () => {
      unsubTasks();
      unsubCompletions();
    };
  }, [user]);

  return (
    <TaskContext.Provider
      value={{
        tasks, completions, loading, loadingMore, hasMore,
        fetchTasks, loadMoreTasks, fetchCompletions, startTask, completeTask, canDoMoreTasks
      }}
    >
      {children}
    </TaskContext.Provider>
  );
}

export function useTask() {
  const ctx = useContext(TaskContext);
  if (!ctx) throw new Error("useTask must be used within TaskProvider");
  return ctx;
}
