import { createContext, useContext, useState, useEffect } from "react";
import {
  collection,
  getDocs,
  addDoc,
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
}

export interface TaskCompletion {
  id: string;
  taskId: string;
  userId: string;
  completedAt: Date;
  reward: number;
  status: "pending" | "platform_pending" | "platform_approved" | "approved" | "rejected";
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
  completeTask: (taskId: string) => Promise<void>;
  canDoMoreTasks: boolean;
}

const TaskContext = createContext<TaskContextType | null>(null);

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
      status: d.data().status || "pending",
      taskTitle: d.data().taskTitle,
      taskDescription: d.data().taskDescription,
      taskType: d.data().taskType,
      verifiedBy: d.data().verifiedBy,
    }));
    fetched.sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());
    setCompletions(fetched);
  }

  async function completeTask(taskId: string) {
    if (!user || !profile) throw new Error("You must be logged in");

    const alreadyDone = completions.find(
      (c) => c.taskId === taskId && c.userId === user.uid
    );
    if (alreadyDone) throw new Error("You have already completed this task");

    const taskDoc = await getDoc(doc(db, "tasks", taskId));
    if (!taskDoc.exists()) throw new Error("Task not found");
    const rawTask = taskDoc.data() as Record<string, unknown>;
    const taskData = taskDoc.data() as Task;

    if (taskData.networkStatus !== "approved") {
      throw new Error("This task is not approved yet");
    }

    if (taskData.status && taskData.status !== "published") {
      throw new Error("This task is not published yet");
    }

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

    await addDoc(collection(db, "taskCompletions"), {
      taskId,
      userId: user.uid,
      completedAt: serverTimestamp(),
      reward: earned,
      adminReward,
      status: taskType === "platform" ? "platform_pending" : "pending",
      taskTitle: taskData.title,
      taskDescription: taskData.description || "",
      taskType,
      manualAdminRate: taskData.manualAdminRate ?? null,
      manualUserSharePercent: taskData.manualUserSharePercent ?? null,
      taskPlatform: taskData.platform,
    });

    await updateDoc(doc(db, "users", user.uid), {
      pendingBalance: increment(earned),
    });

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
        status: d.data().status || "pending",
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
        fetchTasks, loadMoreTasks, fetchCompletions, completeTask, canDoMoreTasks
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
