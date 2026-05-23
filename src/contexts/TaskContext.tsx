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
  QueryDocumentSnapshot,
  DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "./AuthContext";
import { userReward } from "@/lib/utils";

export interface Task {
  id: string;
  title: string;
  description: string;
  type: "simple" | "premium";
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
  status: "pending" | "approved" | "rejected";
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
        .filter((t) => t.networkStatus === "approved");
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
        .filter((t) => t.networkStatus === "approved");
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
    const taskData = taskDoc.data() as Task;

    if (taskData.networkStatus !== "approved") {
      throw new Error("This task is not approved yet");
    }

    const earned = userReward(taskData.reward);

    await addDoc(collection(db, "taskCompletions"), {
      taskId,
      userId: user.uid,
      completedAt: serverTimestamp(),
      reward: earned,
      status: "pending",
      taskTitle: taskData.title,
      taskType: taskData.type,
      taskPlatform: taskData.platform,
    });

    await updateDoc(doc(db, "users", user.uid), {
      pendingBalance: increment(earned),
    });

    await fetchCompletions();
    await refreshProfile();
  }

  // Only fetch tasks when the user is authenticated — Firestore rules require auth
  useEffect(() => {
    if (user) {
      fetchTasks();
      fetchCompletions();
    } else {
      setTasks([]);
      setCompletions([]);
    }
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
