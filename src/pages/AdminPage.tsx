import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useWallet } from "@/contexts/WalletContext";
import { useLocation } from "wouter";
import { formatCurrency, formatDate, userReward } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Loader2, CheckCircle, XCircle, Plus, Trash2, ShieldCheck,
  Clock, Settings, ThumbsUp, ThumbsDown, Download, Link2,
  RefreshCw, Zap, AlertCircle, ShieldX, ShieldOff,
  BarChart3, Copy, Users, DollarSign, TrendingUp, ArrowDownToLine,
  AlertTriangle, Scale, Filter, Search, ChevronLeft, ChevronRight,
  FileDown, Check
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  collection, addDoc, getDocs, updateDoc, doc, deleteDoc, setDoc,
  serverTimestamp, Timestamp, increment, getDoc
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Task } from "@/contexts/TaskContext";
import { getSettings, saveSettings, NetworkKeys } from "@/lib/settings";
import {
  fetchUserReconciliation,
  UserReconciliation,
  fetchGlobalReconciliation,
  GlobalReconciliation,
  comparePlatformReport,
  PlatformReportEntry,
  ReportComparisonResult,
} from "@/lib/reconciliation";

type TabType = "withdrawals" | "tasks" | "import" | "postbacks" | "settings" | "analytics" | "reconciliation" | "users";

type AdminUser = {
  uid: string; email: string; name: string; role: string;
  balance: number; deviceFingerprint: string; allowDuplicateDevice: boolean;
  registeredAt: Date;
};

const NETWORK_STATUS_CONFIG = {
  pending: { label: "Pending", cls: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
  approved: { label: "Approved", cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
  rejected: { label: "Rejected", cls: "bg-red-500/20 text-red-300 border-red-500/30" },
};

const AD_NETWORKS = [
  { id: "adgem", name: "AdGem", url: "https://adgem.com", apiBase: "https://api.adgem.com/v1/offers" },
  { id: "lootably", name: "Lootably", url: "https://lootably.com", apiBase: "https://api.lootably.com/api/v1/offers" },
  { id: "cpabuild", name: "CPABuild", url: "https://cpabuild.com", apiBase: "https://api.cpabuild.com/offers" },
  { id: "monetizer", name: "Monetizer", url: "https://monetizer.media", apiBase: "https://api.monetizer.media/v1/offers" },
  { id: "cpagrip", name: "CPAGrip", url: "https://cpagrip.com", apiBase: "https://www.cpagrip.com/api.php" },
];

interface PostbackEvent {
  id: string;
  network: string;
  userId: string;
  taskId: string;
  status: "approved" | "rejected";
  amount: number;
  reason?: string;
  receivedAt: string;
  processed: boolean;
}

interface AdminAlert {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  withdrawalId: string;
  withdrawalAmount: number;
  flaggedTaskCount: number;
  flaggedTasks: { taskTitle: string; reward: number; rejectReason: string }[];
  read: boolean;
  createdAt: Date;
}

export default function AdminPage() {
  const { profile, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { allWithdrawals, fetchAllWithdrawals, approveWithdrawal, rejectWithdrawal, loading } = useWallet();
  const { toast } = useToast();

  const [tab, setTab] = useState<TabType>("withdrawals");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNoteMap, setRejectNoteMap] = useState<Record<string, string>>({});
  const [withdrawalInstructionText, setWithdrawalInstructionText] = useState("Withdrawals are processed after advertiser approval and payment confirmation. Transfers are sent via TRC20 (TRON) network only.");
  const [networkKeys, setNetworkKeys] = useState<NetworkKeys>({});
  const [postbackSecret, setPostbackSecret] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [dashboardWarningEnabled, setDashboardWarningEnabled] = useState(false);
  const [dashboardWarningMessage, setDashboardWarningMessage] = useState("");

  const [newTask, setNewTask] = useState({ title: "", description: "", type: "simple" as "simple" | "premium", reward: 0.005, url: "", platform: "" });
  const [addingTask, setAddingTask] = useState(false);

  const [fetchingNetwork, setFetchingNetwork] = useState<string | null>(null);
  const [importedOffers, setImportedOffers] = useState<Record<string, unknown>[]>([]);
  const [selectedImportOffers, setSelectedImportOffers] = useState<Set<number>>(new Set());
  const [importingOffers, setImportingOffers] = useState(false);

  const [postbacks, setPostbacks] = useState<PostbackEvent[]>([]);
  const [loadingPostbacks, setLoadingPostbacks] = useState(false);
  const [processingPostback, setProcessingPostback] = useState<string | null>(null);

  const [bannedDevices, setBannedDevices] = useState<{ id: string; fingerprint: string; reason: string; bannedAt: Date }[]>([]);
  const [banInput, setBanInput] = useState("");
  const [banReason, setBanReason] = useState("");
  const [banning, setBanning] = useState(false);

  // Users management
  const [allUsers, setAllUsers] = useState<AdminUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [togglingUser, setTogglingUser] = useState<string | null>(null);

  // Withdrawal settings
  const [usdtEnabled, setUsdtEnabled] = useState(true);
  const [usdcEnabled, setUsdcEnabled] = useState(true);
  const [usdtMin, setUsdtMin] = useState(10);
  const [usdcMin, setUsdcMin] = useState(10);
  const [usdtGas, setUsdtGas] = useState(1.0);
  const [usdcTrc20Gas, setUsdcTrc20Gas] = useState(1.0);
  const [usdcErc20Gas, setUsdcErc20Gas] = useState(5.0);
  const [withdrawalFeePercent, setWithdrawalFeePercent] = useState(5);
  const [withdrawalSchedule, setWithdrawalSchedule] = useState<"instant" | "daily" | "weekly">("instant");
  const [allowDuplicateWallets, setAllowDuplicateWallets] = useState(false);

  // Analytics
  const [analytics, setAnalytics] = useState<{
    totalUsers: number;
    totalWithdrawalsAmount: number;
    totalWithdrawalsCount: number;
    pendingWithdrawalsAmount: number;
    approvedWithdrawalsAmount: number;
    totalRevenue: number;
  } | null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [totalUsers, setTotalUsers] = useState<number | null>(null);
  const [activeUsers7d, setActiveUsers7d] = useState<number | null>(null);

  // Reconciliation state — keyed by userId
  const [reconciliations, setReconciliations] = useState<Record<string, UserReconciliation>>({});
  const [loadingRecon, setLoadingRecon] = useState<Set<string>>(new Set());

  // Global reconciliation
  const [globalRecon, setGlobalRecon] = useState<GlobalReconciliation | null>(null);
  const [loadingGlobalRecon, setLoadingGlobalRecon] = useState(false);
  const [platformReportText, setPlatformReportText] = useState("");
  const [reportComparison, setReportComparison] = useState<ReportComparisonResult | null>(null);
  const [comparingReport, setComparingReport] = useState(false);

  // Auto-import
  const [autoImportStatus, setAutoImportStatus] = useState<"idle" | "running" | "completed" | "error">("idle");
  const [autoImportLog, setAutoImportLog] = useState<string[]>([]);
  const [lastAutoImport, setLastAutoImport] = useState<Date | null>(null);
  const [nextImportCountdown, setNextImportCountdown] = useState(30 * 60);

  // Fraud-detection alerts
  const [adminAlerts, setAdminAlerts] = useState<AdminAlert[]>([]);

  // Withdrawal filter / search / bulk / modals
  const [wFilter, setWFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");
  const [wSearch, setWSearch] = useState("");
  const [wDateFrom, setWDateFrom] = useState("");
  const [wDateTo, setWDateTo] = useState("");
  const [selectedWIds, setSelectedWIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [confirmApproveId, setConfirmApproveId] = useState<string | null>(null);
  const [rejectModalId, setRejectModalId] = useState<string | null>(null);
  const [rejectModalNote, setRejectModalNote] = useState("");
  const [rejectingModal, setRejectingModal] = useState(false);
  const [copiedWalletId, setCopiedWalletId] = useState<string | null>(null);
  const [paidMonthOffset, setPaidMonthOffset] = useState(0);

  useEffect(() => {
    // Wait until auth is fully resolved — prevents redirect when profile is
    // momentarily null during onAuthStateChanged re-initialization after login.
    if (authLoading || !profile) return;
    if (profile.role !== "admin") { setLocation("/dashboard"); return; }
    fetchAllWithdrawals();
    fetchTasks();
    fetchBannedDevices();
    fetchAdminAlerts();
    getSettings().then((s) => {
      setWithdrawalInstructionText(s.withdrawalInstructionText || "");
      setNetworkKeys(s.networkKeys || {});
      setPostbackSecret(s.networkKeys?.postbackSecret || "");
      setUsdtEnabled(s.usdtEnabled !== false);
      setUsdcEnabled(s.usdcEnabled !== false);
      setUsdtMin(s.usdtMin ?? 10);
      setUsdcMin(s.usdcMin ?? 10);
      setUsdtGas(s.usdtGas ?? 1.0);
      setUsdcTrc20Gas(s.usdcTrc20Gas ?? 1.0);
      setUsdcErc20Gas(s.usdcErc20Gas ?? 5.0);
      setWithdrawalFeePercent(s.withdrawalFeePercent ?? 5);
      setWithdrawalSchedule(s.withdrawalSchedule ?? "instant");
      setAllowDuplicateWallets(s.allowDuplicateWallets ?? false);
    });

    (async () => {
      // load raw settings doc for dashboard warning
      try {
        const snap = await getDoc(doc(db, "settings", "general"));
        if (snap.exists()) {
          const d = snap.data() as any;
          setDashboardWarningEnabled(Boolean(d.dashboardWarningEnabled));
          setDashboardWarningMessage(String(d.dashboardWarningMessage || ""));
        }
      } catch (e) {
        console.warn("failed to load dashboard warning setting", e);
      }

      // compute simple user stats (total users + active last 7 days)
      try {
        const usersSnap = await getDocs(collection(db, "users"));
        const now = Date.now();
        let active = 0;
        usersSnap.docs.forEach((ud) => {
          const data = ud.data() as any;
          const registeredAt = data.registeredAt?.toDate?.() || (data.registeredAt ? new Date(data.registeredAt) : null);
          const lastActive = data.lastActive?.toDate?.() || (data.lastActive ? new Date(data.lastActive) : null) || (data.lastLogin?.toDate?.() || null);
          if (lastActive) {
            if (now - lastActive.getTime() <= 7 * 24 * 60 * 60 * 1000) active++;
          } else if (registeredAt) {
            if (now - registeredAt.getTime() <= 7 * 24 * 60 * 60 * 1000) active++;
          }
        });
        setTotalUsers(usersSnap.size);
        setActiveUsers7d(active);
      } catch (e) {
        console.warn("failed to compute user stats", e);
      }
    })();
  }, [authLoading, profile]);

  // Auto-import: run on mount (when API keys are loaded) and every 30 minutes
  useEffect(() => {
    if (authLoading || !profile) return;
    if (profile.role !== "admin") return;
    const hasKeys = networkKeys.adgemKey || networkKeys.lootablyKey || networkKeys.cpagripKey;
    if (!hasKeys) return;
    runAutoImport(networkKeys);
    const interval = setInterval(() => runAutoImport(networkKeys), 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [networkKeys]);

  // Countdown timer to next auto-import
  useEffect(() => {
    const timer = setInterval(() => {
      setNextImportCountdown((prev) => (prev <= 1 ? 30 * 60 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  async function fetchAllUsers() {
    setLoadingUsers(true);
    try {
      const snap = await getDocs(collection(db, "users"));
      const list: AdminUser[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          uid: d.id,
          email: data.email as string || "",
          name: data.name as string || "",
          role: data.role as string || "user",
          balance: (data.balance as number) || 0,
          deviceFingerprint: (data.deviceFingerprint as string) || "",
          allowDuplicateDevice: data.allowDuplicateDevice === true,
          registeredAt: (data.registeredAt as Timestamp)?.toDate() || new Date(),
        };
      });
      list.sort((a, b) => b.registeredAt.getTime() - a.registeredAt.getTime());
      setAllUsers(list);
    } finally {
      setLoadingUsers(false);
    }
  }

  async function toggleDuplicateDevice(user: AdminUser) {
    setTogglingUser(user.uid);
    try {
      const newVal = !user.allowDuplicateDevice;
      await updateDoc(doc(db, "users", user.uid), { allowDuplicateDevice: newVal });
      // Also update device_fingerprints doc if it exists
      if (user.deviceFingerprint) {
        try {
          await updateDoc(doc(db, "device_fingerprints", user.deviceFingerprint), {
            allowDuplicateDevice: newVal,
          });
        } catch { /* doc may not exist yet — non-blocking */ }
      }
      setAllUsers((prev) =>
        prev.map((u) => u.uid === user.uid ? { ...u, allowDuplicateDevice: newVal } : u)
      );
      toast({
        title: newVal ? "Override enabled" : "Override disabled",
        description: newVal
          ? `${user.email} can now register on another device`
          : `${user.email} is restricted to their original device`,
      });
    } finally {
      setTogglingUser(null);
    }
  }

  async function fetchBannedDevices() {
    const snap = await getDocs(collection(db, "banned_devices"));
    const list = snap.docs.map((d) => ({
      id: d.id,
      fingerprint: d.data().fingerprint as string,
      reason: d.data().reason as string || "",
      bannedAt: (d.data().bannedAt as Timestamp)?.toDate() || new Date(),
    }));
    list.sort((a, b) => b.bannedAt.getTime() - a.bannedAt.getTime());
    setBannedDevices(list);
  }

  async function banDevice() {
    if (!banInput.trim()) {
      toast({ title: "Error", description: "Enter a device fingerprint to ban", variant: "destructive" });
      return;
    }
    setBanning(true);
    try {
      await addDoc(collection(db, "banned_devices"), {
        fingerprint: banInput.trim(),
        reason: banReason.trim() || "Banned by admin",
        bannedAt: serverTimestamp(),
        bannedBy: profile?.email || "admin",
      });
      await fetchBannedDevices();
      setBanInput("");
      setBanReason("");
      toast({ title: "✅ Device banned permanently" });
    } finally {
      setBanning(false);
    }
  }

  async function unbanDevice(id: string) {
    await deleteDoc(doc(db, "banned_devices", id));
    await fetchBannedDevices();
    toast({ title: "Device unbanned" });
  }

  async function banUserDevice(userId: string, userName: string) {
    try {
      const userSnap = await getDoc(doc(db, "users", userId));
      const fp = userSnap.data()?.deviceFingerprint as string | undefined;
      if (!fp) {
        toast({ title: "Error", description: "No device fingerprint found for this user", variant: "destructive" });
        return;
      }
      await addDoc(collection(db, "banned_devices"), {
        fingerprint: fp,
        reason: `Banned via admin panel — user: ${userName}`,
        bannedAt: serverTimestamp(),
        bannedBy: profile?.email || "admin",
        userId,
      });
      await fetchBannedDevices();
      toast({ title: `✅ ${userName}'s device permanently banned` });
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    }
  }

  async function fetchTasks() {
    setTasksLoading(true);
    const snap = await getDocs(collection(db, "tasks"));
    const fetched: Task[] = snap.docs.map((d) => ({
      id: d.id, ...(d.data() as Omit<Task, "id" | "createdAt">),
      networkStatus: (d.data().networkStatus as Task["networkStatus"]) || "pending",
      createdAt: (d.data().createdAt as Timestamp)?.toDate() || new Date(),
    }));
    fetched.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    setTasks(fetched);
    setTasksLoading(false);
  }

  async function fetchPostbacks() {
    setLoadingPostbacks(true);
    try {
      const secret = postbackSecret || networkKeys.postbackSecret || "change-me-in-admin-settings";
      const res = await fetch(`/api/postbacks?secret=${encodeURIComponent(secret)}`);
      if (!res.ok) throw new Error("Failed to fetch postbacks");
      const data = await res.json() as { events: PostbackEvent[] };
      setPostbacks(data.events || []);
    } catch {
      toast({ title: "Error", description: "Could not fetch postback events. Check your secret.", variant: "destructive" });
    } finally {
      setLoadingPostbacks(false);
    }
  }

  async function processPostback(event: PostbackEvent) {
    setProcessingPostback(event.id);
    try {
      if (event.status === "approved") {
        // Find the task completion and approve it
        const completionsSnap = await getDocs(
          collection(db, "taskCompletions")
        );
        const match = completionsSnap.docs.find(
          (d) => d.data().taskId === event.taskId && d.data().userId === event.userId && d.data().status === "pending"
        );
        if (match) {
          await updateDoc(doc(db, "taskCompletions", match.id), {
            status: "approved",
            verifiedBy: event.network,
            approvedAt: serverTimestamp(),
          });
          const completion = match.data();
          await updateDoc(doc(db, "users", event.userId), {
            pendingBalance: increment(-(completion.reward as number)),
            balance: increment(completion.reward as number),
          });
        }
      } else {
        // Rejected — remove pending balance
        const completionsSnap = await getDocs(collection(db, "taskCompletions"));
        const match = completionsSnap.docs.find(
          (d) => d.data().taskId === event.taskId && d.data().userId === event.userId && d.data().status === "pending"
        );
        if (match) {
          const completion = match.data();
          await updateDoc(doc(db, "taskCompletions", match.id), {
            status: "rejected",
            rejectedBy: event.network,
            rejectReason: event.reason || "Rejected by network",
            rejectedAt: serverTimestamp(),
          });
          await updateDoc(doc(db, "users", event.userId), {
            pendingBalance: increment(-(completion.reward as number)),
          });
        }
      }

      // Mark postback as processed
      const secret = postbackSecret || networkKeys.postbackSecret || "change-me-in-admin-settings";
      await fetch(`/api/postbacks/${event.id}/mark-processed?secret=${encodeURIComponent(secret)}`, { method: "POST" });
      setPostbacks((prev) => prev.filter((e) => e.id !== event.id));
      toast({ title: `✅ Processed — ${event.status}` });
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    } finally {
      setProcessingPostback(null);
    }
  }

  async function processAllPostbacks() {
    for (const event of postbacks) {
      await processPostback(event);
    }
  }

  async function fetchOffersFromNetwork(networkId: string) {
    const keyMap: Record<string, string | undefined> = {
      adgem: networkKeys.adgemKey,
      lootably: networkKeys.lootablyKey,
      cpabuild: networkKeys.cpabuildKey,
      monetizer: networkKeys.monetizerKey,
      cpagrip: networkKeys.cpagripKey,
    };
    const apiKey = keyMap[networkId];
    if (!apiKey) {
      toast({ title: "No API Key", description: `Enter ${AD_NETWORKS.find(n => n.id === networkId)?.name} API key in Settings first`, variant: "destructive" });
      return;
    }
    setFetchingNetwork(networkId);
    setImportedOffers([]);
    setSelectedImportOffers(new Set());
    try {
      const network = AD_NETWORKS.find((n) => n.id === networkId)!;
      let offers: Record<string, unknown>[] = [];

      if (networkId === "adgem") {
        const r = await fetch(`${network.apiBase}?api_key=${apiKey}&limit=50`);
        const d = await r.json() as { data?: Record<string, unknown>[] };
        offers = d.data || [];
      } else if (networkId === "lootably") {
        const r = await fetch(`${network.apiBase}?token=${apiKey}&limit=50`);
        const d = await r.json() as { offers?: Record<string, unknown>[] };
        offers = d.offers || [];
      } else if (networkId === "cpagrip") {
        const r = await fetch(`${network.apiBase}?user_id=${apiKey}&type=1&output=json`);
        const d = await r.json() as { offers?: Record<string, unknown>[] };
        offers = d.offers || [];
      } else {
        throw new Error("Direct API fetch not supported for this network due to CORS. Use the postback/webhook system instead.");
      }

      if (offers.length === 0) throw new Error("No offers returned. Check your API key.");
      setImportedOffers(offers);
      toast({ title: `✅ Found ${offers.length} offers` });
    } catch (e: unknown) {
      toast({ title: "Fetch Failed", description: e instanceof Error ? e.message : "Network error", variant: "destructive" });
    } finally {
      setFetchingNetwork(null);
    }
  }

  async function importSelectedOffers(networkId: string) {
    if (selectedImportOffers.size === 0) {
      toast({ title: "None selected", description: "Select at least one offer to import", variant: "destructive" });
      return;
    }
    setImportingOffers(true);
    try {
      const network = AD_NETWORKS.find((n) => n.id === networkId)!;
      let imported = 0;
      for (const idx of selectedImportOffers) {
        const offer = importedOffers[idx];
        if (!offer) continue;
        const title = (offer.name || offer.title || offer.offer_name || "Untitled Offer") as string;
        const payout = parseFloat(String(offer.payout || offer.reward || offer.amount || "0.005"));
        const url = (offer.link || offer.url || offer.offer_url || "") as string;
        const description = (offer.description || offer.requirements || "") as string;
        const platform = network.name;
        await addDoc(collection(db, "tasks"), {
          title, description, url, platform,
          reward: payout, type: payout >= 0.05 ? "premium" : "simple",
          active: true, networkStatus: "pending",
          importedFrom: networkId,
          offerId: String(offer.id || offer.offer_id || ""),
          createdAt: serverTimestamp(),
        });
        imported++;
      }
      await fetchTasks();
      setImportedOffers([]);
      setSelectedImportOffers(new Set());
      toast({ title: `✅ Imported ${imported} tasks`, description: "Set them to Approved in the Tasks tab when ready" });
    } finally {
      setImportingOffers(false);
    }
  }

  async function handleAddTask() {
    if (!newTask.title || !newTask.url || !newTask.platform) {
      toast({ title: "Error", description: "Please fill all required fields", variant: "destructive" });
      return;
    }
    setAddingTask(true);
    try {
      await addDoc(collection(db, "tasks"), { ...newTask, active: true, networkStatus: "pending", createdAt: serverTimestamp() });
      setNewTask({ title: "", description: "", type: "simple", reward: 0.005, url: "", platform: "" });
      await fetchTasks();
      toast({ title: "✅ Task added" });
    } finally { setAddingTask(false); }
  }

  async function handleSetNetworkStatus(id: string, status: Task["networkStatus"]) {
    await updateDoc(doc(db, "tasks", id), { networkStatus: status, networkStatusUpdatedAt: serverTimestamp() });
    await fetchTasks();
    toast({ title: status === "approved" ? "✅ Task Approved" : "Task Rejected" });
  }

  async function handleToggleTask(id: string, active: boolean) {
    await updateDoc(doc(db, "tasks", id), { active: !active });
    await fetchTasks();
  }

  async function handleDeleteTask(id: string) {
    await deleteDoc(doc(db, "tasks", id));
    await fetchTasks();
    toast({ title: "Deleted" });
  }

  async function handleSaveSettings() {
    setSavingSettings(true);
    try {
      await setDoc(doc(db, "settings", "general"), {
        withdrawalInstructionText,
        networkKeys: { ...networkKeys, postbackSecret },
        usdtEnabled,
        usdcEnabled,
        usdtMin,
        usdcMin,
        usdtGas,
        usdcTrc20Gas,
        usdcErc20Gas,
        withdrawalFeePercent,
        withdrawalSchedule,
        allowDuplicateWallets,
        dashboardWarningEnabled,
        dashboardWarningMessage,
      }, { merge: true });
      toast({ title: "✅ Settings saved" });
    } finally { setSavingSettings(false); }
  }
  const handleSaveWarning = async () => {
    setSavingSettings(true);
    try {
      await setDoc(doc(db, "settings", "general"), {
        dashboardWarningEnabled,
        dashboardWarningMessage,
      }, { merge: true });
      toast({ title: "✅ Dashboard warning saved successfully" });
    } catch (error) {
      toast({ title: "Error saving warning", description: String(error), variant: "destructive" });
    } finally {
      setSavingSettings(false);
    }
  };

  async function fetchAnalytics() {
    setLoadingAnalytics(true);
    try {
      const usersSnap = await getDocs(collection(db, "users"));
      const totalUsers = usersSnap.size;

      const wSnap = await getDocs(collection(db, "withdrawals"));
      let totalWithdrawalsAmount = 0;
      let pendingWithdrawalsAmount = 0;
      let approvedWithdrawalsAmount = 0;
      wSnap.docs.forEach((d) => {
        const amt = (d.data().amount as number) || 0;
        const st = d.data().status as string;
        totalWithdrawalsAmount += amt;
        if (st === "pending") pendingWithdrawalsAmount += amt;
        if (st === "approved") {
          approvedWithdrawalsAmount += amt;
        }
      });

      const completionsSnap = await getDocs(collection(db, "taskCompletions"));
      let totalRevenue = 0;
      completionsSnap.docs.forEach((d) => {
        if (d.data().status === "approved") {
          const reward = (d.data().reward as number) || 0;
          totalRevenue += reward * 0.35;
        }
      });

      setAnalytics({
        totalUsers,
        totalWithdrawalsAmount,
        totalWithdrawalsCount: wSnap.size,
        pendingWithdrawalsAmount,
        approvedWithdrawalsAmount,
        totalRevenue,
      });
    } finally {
      setLoadingAnalytics(false);
    }
  }

  async function handleApproveWithdrawal(id: string) {
    try { await approveWithdrawal(id); toast({ title: "✅ Approved" }); }
    catch (e: unknown) { toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" }); }
  }

  async function handleRejectWithdrawal(id: string) {
    setRejectingId(id);
    const note = rejectNoteMap[id] || "Rejected by admin";
    try {
      await rejectWithdrawal(id, note);
      setRejectNoteMap((prev) => { const n = { ...prev }; delete n[id]; return n; });
      toast({ title: "Rejected", description: note });
    }
    catch (e: unknown) { toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" }); }
    finally { setRejectingId(null); }
  }

  async function handleFetchGlobalRecon() {
    setLoadingGlobalRecon(true);
    try {
      const pendingTotal = allWithdrawals
        .filter((w) => w.status === "pending")
        .reduce((s, w) => s + w.amount, 0);
      const knownUserIds = [...new Set(allWithdrawals.map((w) => w.userId))];
      const result = await fetchGlobalReconciliation(pendingTotal, knownUserIds);
      setGlobalRecon(result);
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    } finally {
      setLoadingGlobalRecon(false);
    }
  }

  async function runAutoImport(keys: NetworkKeys) {
    const keyMap: Record<string, string | undefined> = {
      adgem: keys.adgemKey,
      lootably: keys.lootablyKey,
      cpagrip: keys.cpagripKey,
    };
    const activeNetworks = AD_NETWORKS.filter((n) => !!keyMap[n.id]);
    if (activeNetworks.length === 0) return;

    setAutoImportStatus("running");
    const log: string[] = [];

    try {
      const existingSnap = await getDocs(collection(db, "tasks"));
      const existingOfferIds = new Set(
        existingSnap.docs.map((d) => String(d.data().offerId || "")).filter(Boolean)
      );

      let totalImported = 0;

      for (const network of activeNetworks) {
        try {
          const apiKey = keyMap[network.id]!;
          let offers: Record<string, unknown>[] = [];

          if (network.id === "adgem") {
            const r = await fetch(`${network.apiBase}?api_key=${apiKey}&limit=50`);
            const d = await r.json() as { data?: Record<string, unknown>[] };
            offers = d.data || [];
          } else if (network.id === "lootably") {
            const r = await fetch(`${network.apiBase}?token=${apiKey}&limit=50`);
            const d = await r.json() as { offers?: Record<string, unknown>[] };
            offers = d.offers || [];
          } else if (network.id === "cpagrip") {
            const r = await fetch(`${network.apiBase}?user_id=${apiKey}&type=1&output=json`);
            const d = await r.json() as { offers?: Record<string, unknown>[] };
            offers = d.offers || [];
          }

          const newOffers = offers.filter((o) => {
            const oid = String(o.id || o.offer_id || "");
            return oid && !existingOfferIds.has(oid);
          });

          for (const offer of newOffers) {
            const title = String(offer.name || offer.title || offer.offer_name || "Untitled Offer");
            const payout = parseFloat(String(offer.payout || offer.reward || offer.amount || "0.005"));
            const url = String(offer.link || offer.url || offer.offer_url || "");
            const description = String(offer.description || offer.requirements || "");
            const offerId = String(offer.id || offer.offer_id || "");
            await addDoc(collection(db, "tasks"), {
              title, description, url,
              platform: network.name,
              reward: payout,
              type: payout >= 0.05 ? "premium" : "simple",
              active: true,
              networkStatus: "pending",
              importedFrom: network.id,
              offerId,
              createdAt: serverTimestamp(),
            });
            existingOfferIds.add(offerId);
            totalImported++;
          }

          log.push(`✅ ${network.name}: ${newOffers.length} new offer(s) imported`);
        } catch {
          log.push(`⚠ ${network.name}: fetch failed (check API key or CORS)`);
        }
      }

      if (totalImported > 0) await fetchTasks();
      log.push(`Total: ${totalImported} new task(s) added at ${new Date().toLocaleTimeString()}`);
      setAutoImportLog(log);
      setLastAutoImport(new Date());
      setNextImportCountdown(30 * 60);
      setAutoImportStatus("completed");
    } catch {
      setAutoImportStatus("error");
      setAutoImportLog(["❌ Auto-import failed. Check console for details."]);
    }
  }

  async function handleComparePlatformReport() {
    if (!platformReportText.trim()) {
      toast({ title: "Empty report", description: "Paste the platform's JSON payout report first.", variant: "destructive" });
      return;
    }
    setComparingReport(true);
    try {
      const entries = JSON.parse(platformReportText) as PlatformReportEntry[];
      if (!Array.isArray(entries)) throw new Error("Report must be a JSON array.");
      const result = await comparePlatformReport(entries);
      setReportComparison(result);
      toast({ title: result.isFullMatch ? "✅ Full match!" : "⚠ Discrepancies found", description: result.isFullMatch ? "Platform report matches our records." : `${result.mismatchedItems.length + result.missingInPlatform.length} issue(s) detected.` });
    } catch (e) {
      toast({ title: "Parse Error", description: e instanceof Error ? e.message : "Invalid JSON format.", variant: "destructive" });
    } finally {
      setComparingReport(false);
    }
  }

  async function fetchAdminAlerts() {
    try {
      const snap = await getDocs(collection(db, "adminAlerts"));
      const alerts: AdminAlert[] = snap.docs
        .filter((d) => !d.data().read)
        .map((d) => ({
          id: d.id,
          userId: d.data().userId as string,
          userEmail: d.data().userEmail as string,
          userName: d.data().userName as string,
          withdrawalId: d.data().withdrawalId as string,
          withdrawalAmount: (d.data().withdrawalAmount as number) || 0,
          flaggedTaskCount: (d.data().flaggedTaskCount as number) || 0,
          flaggedTasks: (d.data().flaggedTasks as AdminAlert["flaggedTasks"]) || [],
          read: (d.data().read as boolean) || false,
          createdAt: (d.data().createdAt as Timestamp)?.toDate() || new Date(),
        }));
      alerts.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setAdminAlerts(alerts);
    } catch { /* silently skip if rules deny access */ }
  }

  async function dismissAlert(alertId: string) {
    try {
      await updateDoc(doc(db, "adminAlerts", alertId), { read: true });
      setAdminAlerts((prev) => prev.filter((a) => a.id !== alertId));
      toast({ title: "Alert dismissed" });
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    }
  }

  async function dismissAllAlerts() {
    try {
      await Promise.all(adminAlerts.map((a) => updateDoc(doc(db, "adminAlerts", a.id), { read: true })));
      setAdminAlerts([]);
      toast({ title: "All alerts dismissed" });
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    }
  }

  const pendingWithdrawals = allWithdrawals.filter((w) => w.status === "pending");
  const processedWithdrawals = allWithdrawals.filter((w) => w.status !== "pending");

  // Filtered withdrawals for the tab view
  const filteredWithdrawals = allWithdrawals.filter((w) => {
    if (wFilter !== "all" && w.status !== wFilter) return false;
    if (wSearch.trim()) {
      const q = wSearch.toLowerCase();
      const addr = (w.walletAddress || w.trc20Address || "").toLowerCase();
      if (!w.userEmail.toLowerCase().includes(q) && !w.userName.toLowerCase().includes(q) && !addr.includes(q)) return false;
    }
    if (wDateFrom) {
      const from = new Date(wDateFrom);
      if (w.createdAt < from) return false;
    }
    if (wDateTo) {
      const to = new Date(wDateTo);
      to.setHours(23, 59, 59, 999);
      if (w.createdAt > to) return false;
    }
    return true;
  });

  // Auto-load reconciliation for all pending withdrawals whenever the list changes
  useEffect(() => {
    pendingWithdrawals.forEach((w) => {
      if (reconciliations[w.userId] || loadingRecon.has(w.userId)) return;
      setLoadingRecon((prev) => new Set([...prev, w.userId]));
      fetchUserReconciliation(w.userId)
        .then((recon) => setReconciliations((prev) => ({ ...prev, [w.userId]: recon })))
        .finally(() => setLoadingRecon((prev) => { const s = new Set(prev); s.delete(w.userId); return s; }));
    });
  }, [allWithdrawals]);
  const pendingNetworkTasks = tasks.filter((t) => t.networkStatus === "pending").length;
  const approvedNetworkTasks = tasks.filter((t) => t.networkStatus === "approved").length;

  const postbackBaseUrl = window.location.origin + "/api/postback";

  const pendingWithdrawalAmount = pendingWithdrawals.reduce((s, w) => s + w.amount, 0);
  const now = new Date();
  const paidMonthDate = new Date(now.getFullYear(), now.getMonth() + paidMonthOffset, 1);
  const paidThisMonth = allWithdrawals.filter((w) => {
    if (w.status !== "approved") return false;
    const d = w.processedAt || w.createdAt;
    return d.getFullYear() === paidMonthDate.getFullYear() && d.getMonth() === paidMonthDate.getMonth();
  });
  const paidThisMonthAmount = paidThisMonth.reduce((s, w) => s + w.amount, 0);

  function copyWallet(id: string, addr: string) {
    navigator.clipboard.writeText(addr);
    setCopiedWalletId(id);
    setTimeout(() => setCopiedWalletId(null), 2000);
  }

  function exportWithdrawalsCSV() {
    const rows = [
      ["ID", "User Name", "Email", "Wallet Address", "Currency", "Network", "Requested Amount", "Fee %", "Gas Fee", "Net Payout", "Status", "Request Date", "Processed Date", "Reject Note"],
      ...filteredWithdrawals.map((w) => {
        const commission = w.amount * ((w.feePercent || 5) / 100);
        const gas = w.gasFee || 1;
        const net = w.netAmount ?? Math.max(0, w.amount - commission - gas);
        const addr = w.walletAddress || w.trc20Address || "";
        return [
          w.id,
          w.userName,
          w.userEmail,
          addr,
          w.currency || "USDT",
          w.network || "TRC20",
          w.amount.toFixed(5),
          (w.feePercent || 5).toString(),
          gas.toFixed(2),
          net.toFixed(5),
          w.status,
          w.createdAt.toISOString(),
          w.processedAt?.toISOString() || "",
          w.note || "",
        ];
      }),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `withdrawals_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "CSV exported", description: `${filteredWithdrawals.length} row(s) downloaded` });
  }

  async function handleBulkApprove() {
    const toApprove = [...selectedWIds].filter((id) => {
      const w = allWithdrawals.find((x) => x.id === id);
      if (!w || w.status !== "pending") return false;
      const recon = reconciliations[w.userId];
      return recon?.status === "clean";
    });
    if (toApprove.length === 0) {
      toast({ title: "Nothing to approve", description: "Only verified (clean reconciliation) pending withdrawals can be bulk approved.", variant: "destructive" });
      return;
    }
    setBulkLoading(true);
    try {
      await Promise.all(toApprove.map((id) => approveWithdrawal(id)));
      setSelectedWIds(new Set());
      toast({ title: `✅ ${toApprove.length} withdrawal(s) approved` });
    } catch (e) {
      toast({ title: "Bulk approve failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBulkLoading(false);
    }
  }

  async function handleBulkReject() {
    const toReject = [...selectedWIds].filter((id) => {
      const w = allWithdrawals.find((x) => x.id === id);
      return w?.status === "pending";
    });
    if (toReject.length === 0) {
      toast({ title: "Nothing to reject", description: "No pending withdrawals selected.", variant: "destructive" });
      return;
    }
    setBulkLoading(true);
    try {
      await Promise.all(toReject.map((id) => rejectWithdrawal(id, "Bulk rejected by admin")));
      setSelectedWIds(new Set());
      toast({ title: `${toReject.length} withdrawal(s) rejected` });
    } catch (e) {
      toast({ title: "Bulk reject failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBulkLoading(false);
    }
  }

  async function handleConfirmApprove() {
    if (!confirmApproveId) return;
    const id = confirmApproveId;
    setConfirmApproveId(null);
    await handleApproveWithdrawal(id);
  }

  async function handleRejectModal() {
    if (!rejectModalId) return;
    setRejectingModal(true);
    try {
      await rejectWithdrawal(rejectModalId, rejectModalNote);
      toast({ title: "Withdrawal rejected", description: rejectModalNote ? `Reason: ${rejectModalNote}` : "No reason provided" });
      setRejectModalId(null);
      setRejectModalNote("");
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    } finally {
      setRejectingModal(false);
    }
  }

  const tabs: { id: TabType; label: string; alertCount?: number }[] = [
    { id: "withdrawals", label: `Withdrawals (${pendingWithdrawals.length})`, alertCount: adminAlerts.length },
    { id: "reconciliation", label: "Reconciliation" },
    { id: "tasks", label: "Tasks" },
    { id: "import", label: "Import Tasks" },
    { id: "postbacks", label: `Postbacks (${postbacks.length})` },
    { id: "analytics", label: "Analytics" },
    { id: "users", label: "Users" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
          <ShieldCheck className="w-5 h-5 text-purple-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Admin Panel</h1>
          <p className="text-white/40 text-sm">Platform management</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-white">{pendingWithdrawals.length}</div>
          <div className="text-xs text-amber-300/70 mt-1">Pending Withdrawals</div>
        </div>
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-white">{allWithdrawals.filter(w => w.status === "approved").length}</div>
          <div className="text-xs text-emerald-300/70 mt-1">Approved</div>
        </div>
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-white">{pendingNetworkTasks}</div>
          <div className="text-xs text-amber-300/70 mt-1">Tasks Pending</div>
        </div>
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-white">{approvedNetworkTasks}</div>
          <div className="text-xs text-blue-300/70 mt-1">Tasks Live</div>
        </div>
        {/* 💰 Admin Treasury Card */}
<div className="col-span-4 bg-gradient-to-br from-indigo-900/40 to-purple-900/40 border border-white/10 rounded-xl p-4 shadow-lg">
  <div className="flex items-center justify-between mb-2">
    <h3 className="text-xs font-semibold text-white/70 uppercase tracking-wider">Platform Treasury</h3>
    <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full text-white/80">Live</span>
  </div>
  
  <div className="space-y-2">
    {/* Total Income from Platform */}
    <div className="flex justify-between items-center">
      <span className="text-xs text-white/50">Verified Income</span>
      <span className="text-sm font-bold text-emerald-400">
        ${(globalRecon?.totalMatchedAmount || 0).toFixed(5)} USDT
      </span>
    </div>
    
    {/* Total Payouts to Users */}
    <div className="flex justify-between items-center">
      <span className="text-xs text-white/50">User Payouts</span>
      <span className="text-sm font-bold text-rose-400">
        -${(analytics?.approvedWithdrawalsAmount || 0).toFixed(5)} USDT
      </span>
    </div>
    
    <div className="border-t border-white/10 my-2"></div>
    
    {/* Net Profit */}
    <div className="flex justify-between items-center">
      <span className="text-xs font-medium text-white/80">Net Profit</span>
      <span className={`text-lg font-bold ${( (globalRecon?.totalMatchedAmount || 0) - (analytics?.approvedWithdrawalsAmount || 0) ) >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
        ${((globalRecon?.totalMatchedAmount || 0) - (analytics?.approvedWithdrawalsAmount || 0)).toFixed(5)} USDT
      </span>
    </div>
  </div>
</div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => {
            setTab(t.id);
            if (t.id === "postbacks") fetchPostbacks();
            if (t.id === "analytics") fetchAnalytics();
            if (t.id === "reconciliation") handleFetchGlobalRecon();
            if (t.id === "users") fetchAllUsers();
          }}
            className={cn("relative px-4 py-2 rounded-xl text-sm font-medium transition-all",
              tab === t.id ? "bg-emerald-500 text-white" : "bg-white/5 text-white/60 hover:bg-white/10")}>
            {t.label}
            {(t.alertCount ?? 0) > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
                {t.alertCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* === WITHDRAWALS === */}
      {tab === "withdrawals" && (
        <div className="space-y-4">
            {/* Admin Stats + Dashboard Warning */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                <p className="text-sm text-white/60">Total Users</p>
                <p className="text-2xl font-semibold text-white mt-2">{totalUsers ?? "—"}</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                <p className="text-sm text-white/60">Active (7d)</p>
                <p className="text-2xl font-semibold text-white mt-2">{activeUsers7d ?? "—"}</p>
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                         <div className="flex items-center justify-between mb-4">
             <h3 className="font-semibold text-white">Dashboard Warning</h3>
             <Button
               onClick={handleSaveWarning}
               disabled={savingSettings}
               size="sm"
               className="bg-emerald-600 hover:bg-emerald-500 text-white"
             >
               {savingSettings ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
               Save Warning
             </Button>
           </div>
           <div className="flex items-start gap-4">
                <div className="flex-1">
                  <label className="text-sm text-white/80 block mb-1">Enable Warning</label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setDashboardWarningEnabled((v) => !v)}
                      className={cn("relative shrink-0 mt-0.5 inline-flex h-6 w-11 items-center rounded-full border transition-colors", dashboardWarningEnabled ? "bg-amber-500 border-amber-400" : "bg-white/10 border-white/20")}
                    >
                      <span className={cn("inline-block h-4 w-4 rounded-full bg-white shadow transition-transform", dashboardWarningEnabled ? "translate-x-6" : "translate-x-1")} />
                    </button>
                    <p className="text-sm text-white/40">When enabled, this message appears on the main Dashboard for all users.</p>
                  </div>
                  <label className="text-sm text-white/80 block mt-3 mb-1">Warning Message</label>
                  <textarea
                    value={dashboardWarningMessage}
                    onChange={(e) => setDashboardWarningMessage(e.target.value)}
                    rows={3}
                    className="w-full bg-white/10 border border-white/20 text-white rounded-lg px-3 py-2 text-sm resize-none"
                  />
                </div>
              </div>
            </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-4 h-4 text-amber-400" />
                <span className="text-xs text-amber-300/70">Pending Count</span>
              </div>
              <div className="text-2xl font-bold text-white">{pendingWithdrawals.length}</div>
              <div className="text-xs text-white/40 mt-0.5">awaiting approval</div>
            </div>
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="w-4 h-4 text-red-400" />
                <span className="text-xs text-red-300/70">Total Pending Amount</span>
              </div>
              <div className="text-2xl font-bold text-white">{formatCurrency(pendingWithdrawalAmount)}</div>
              <div className="text-xs text-white/40 mt-0.5">on hold</div>
            </div>
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
                <span className="text-xs text-emerald-300/70">Paid This Month</span>
              </div>
              <div className="text-2xl font-bold text-white">{formatCurrency(paidThisMonthAmount)}</div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-white/40">{paidThisMonth.length} withdrawal(s)</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPaidMonthOffset((o) => o - 1)}
                    className="w-5 h-5 rounded flex items-center justify-center bg-white/10 hover:bg-white/20 transition-colors">
                    <ChevronLeft className="w-3 h-3 text-white/60" />
                  </button>
                  <span className="text-xs text-white/50 w-14 text-center">
                    {paidMonthDate.toLocaleString("default", { month: "short", year: "2-digit" })}
                  </span>
                  <button onClick={() => setPaidMonthOffset((o) => Math.min(0, o + 1))}
                    disabled={paidMonthOffset === 0}
                    className="w-5 h-5 rounded flex items-center justify-center bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                    <ChevronRight className="w-3 h-3 text-white/60" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Fraud Detection Alerts */}
          {adminAlerts.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-red-400 flex items-center gap-2 text-sm">
                  <AlertTriangle className="w-4 h-4" />
                  Fraud Detection Alerts ({adminAlerts.length})
                </h2>
                <button onClick={dismissAllAlerts}
                  className="text-xs text-red-400/70 hover:text-red-300 transition-colors underline underline-offset-2">
                  Dismiss all
                </button>
              </div>
              <div className="space-y-3">
                {adminAlerts.map((alert) => (
                  <div key={alert.id} className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-red-400 uppercase tracking-wide bg-red-500/20 px-2 py-0.5 rounded-full">FLAGGED</span>
                          <span className="text-sm font-medium text-white truncate">{alert.userName}</span>
                          <span className="text-xs text-white/50 truncate">{alert.userEmail}</span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-white/60 flex-wrap">
                          <span>Withdrawal: <span className="text-amber-300 font-medium">${alert.withdrawalAmount.toFixed(2)} USDT</span></span>
                          <span>Flagged tasks: <span className="text-red-300 font-medium">{alert.flaggedTaskCount}</span></span>
                          <span className="text-white/30">{alert.createdAt.toLocaleString()}</span>
                        </div>
                      </div>
                      <button onClick={() => dismissAlert(alert.id)}
                        className="shrink-0 text-xs bg-white/10 hover:bg-white/20 text-white/70 hover:text-white px-3 py-1.5 rounded-lg transition-colors font-medium">
                        Dismiss
                      </button>
                    </div>
                    {alert.flaggedTasks.length > 0 && (
                      <div className="border-t border-red-500/20 pt-3 space-y-1.5">
                        <p className="text-[11px] text-red-400/70 font-medium uppercase tracking-wide mb-2">Flagged task completions</p>
                        {alert.flaggedTasks.map((ft, i) => (
                          <div key={i} className="flex items-center justify-between gap-2 text-xs bg-black/20 rounded-lg px-3 py-2">
                            <span className="text-white/80 truncate flex-1">{ft.taskTitle}</span>
                            <span className="text-emerald-400 font-medium shrink-0">${ft.reward.toFixed(2)}</span>
                            {ft.rejectReason && <span className="text-red-400/70 shrink-0 truncate max-w-[140px]">{ft.rejectReason}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Filter / Search / Export toolbar */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Status filter */}
              <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
                {(["pending", "approved", "rejected", "all"] as const).map((s) => (
                  <button key={s} onClick={() => setWFilter(s)}
                    className={cn("px-3 py-1 rounded-lg text-xs font-medium capitalize transition-colors",
                      wFilter === s ? "bg-emerald-500 text-white" : "text-white/50 hover:text-white")}>
                    {s === "all" ? `All (${allWithdrawals.length})` : s === "pending" ? `Pending (${pendingWithdrawals.length})` : s === "approved" ? `Approved (${allWithdrawals.filter(x => x.status === "approved").length})` : `Rejected (${allWithdrawals.filter(x => x.status === "rejected").length})`}
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
                <Input value={wSearch} onChange={(e) => setWSearch(e.target.value)}
                  placeholder="Email, name or wallet..."
                  className="pl-8 bg-white/5 border-white/10 text-white text-xs placeholder:text-white/25 h-8" />
              </div>

              {/* Date range */}
              <input type="date" value={wDateFrom} onChange={(e) => setWDateFrom(e.target.value)}
                className="bg-white/5 border border-white/10 text-white/60 text-xs rounded-lg px-2 py-1.5 h-8" />
              <span className="text-white/30 text-xs">–</span>
              <input type="date" value={wDateTo} onChange={(e) => setWDateTo(e.target.value)}
                className="bg-white/5 border border-white/10 text-white/60 text-xs rounded-lg px-2 py-1.5 h-8" />

              {/* Clear filters */}
              {(wSearch || wDateFrom || wDateTo || wFilter !== "pending") && (
                <button onClick={() => { setWSearch(""); setWDateFrom(""); setWDateTo(""); setWFilter("pending"); }}
                  className="text-xs text-white/40 hover:text-white/70 underline underline-offset-2 transition-colors">
                  Clear
                </button>
              )}

              <div className="flex-1" />

              {/* Export CSV */}
              <Button size="sm" variant="outline" onClick={exportWithdrawalsCSV}
                className="border-white/20 text-white/60 hover:text-white h-8 gap-1.5">
                <FileDown className="w-3.5 h-3.5" />Export CSV
              </Button>

              {/* Refresh */}
              <Button size="sm" variant="outline" onClick={() => { fetchAllWithdrawals(); setSelectedWIds(new Set()); }}
                disabled={loading}
                className="border-white/20 text-white/60 hover:text-white h-8">
                <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
              </Button>
            </div>

            {/* Results count */}
            <p className="text-xs text-white/30">
              Showing {filteredWithdrawals.length} of {allWithdrawals.length} withdrawal(s)
            </p>
          </div>

          {/* Bulk actions toolbar */}
          {selectedWIds.size > 0 && (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="text-sm text-blue-300 font-medium">{selectedWIds.size} selected</span>
              <div className="flex-1" />
              <Button size="sm" onClick={handleBulkApprove} disabled={bulkLoading}
                className="bg-emerald-500 hover:bg-emerald-400 text-white h-7 text-xs">
                {bulkLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <CheckCircle className="w-3.5 h-3.5 mr-1" />}
                Bulk Approve (verified only)
              </Button>
              <Button size="sm" variant="outline" onClick={handleBulkReject} disabled={bulkLoading}
                className="border-red-500/30 text-red-400 hover:bg-red-500/10 h-7 text-xs">
                {bulkLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <XCircle className="w-3.5 h-3.5 mr-1" />}
                Bulk Reject
              </Button>
              <button onClick={() => setSelectedWIds(new Set())}
                className="text-xs text-white/40 hover:text-white/70 underline underline-offset-2">
                Deselect all
              </button>
            </div>
          )}

          {/* Withdrawals list */}
          <div className="space-y-3">
            {loading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
              </div>
            ) : filteredWithdrawals.length === 0 ? (
              <div className="bg-white/3 border border-white/8 rounded-2xl py-12 text-center">
                <Filter className="w-8 h-8 text-white/15 mx-auto mb-2" />
                <p className="text-white/40 text-sm">No withdrawals match your filters</p>
              </div>
            ) : filteredWithdrawals.map((w) => {
              const commission = w.amount * ((w.feePercent || 5) / 100);
              const gas = w.gasFee || 1;
              const totalDeductions = commission + gas;
              const netPayout = w.netAmount ?? Math.max(0, w.amount - totalDeductions);
              const addr = w.walletAddress || w.trc20Address || "";
              const addrShort = addr.length > 20 ? addr.slice(0, 10) + "…" + addr.slice(-10) : addr;
              const recon = reconciliations[w.userId];
              const isLoadingRecon = loadingRecon.has(w.userId);
              const isFlagged = recon?.status === "flagged";
              const isUnverified = recon?.status === "unverified";
              const isBlocked = isFlagged || isUnverified;
              const isPending = w.status === "pending";
              const isSelected = selectedWIds.has(w.id);

              return (
                <div key={w.id} className={cn(
                  "bg-white/5 border rounded-2xl p-4 space-y-3 transition-colors",
                  isSelected ? "border-blue-500/40 bg-blue-500/5" : "border-white/10",
                  w.status === "approved" && "border-emerald-500/15",
                  w.status === "rejected" && "border-red-500/10 opacity-75"
                )}>
                  {/* Row header */}
                  <div className="flex items-start gap-3">
                    {/* Checkbox (pending only) */}
                    {isPending && (
                      <button
                        onClick={() => setSelectedWIds((prev) => {
                          const s = new Set(prev);
                          s.has(w.id) ? s.delete(w.id) : s.add(w.id);
                          return s;
                        })}
                        className={cn(
                          "mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                          isSelected ? "bg-blue-500 border-blue-400" : "border-white/30 bg-white/5 hover:border-white/50"
                        )}>
                        {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                      </button>
                    )}

                    {/* User info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-white text-sm">{w.userName}</p>
                        <Badge className={cn("text-xs border", NETWORK_STATUS_CONFIG[w.status].cls)}>
                          {w.status.charAt(0).toUpperCase() + w.status.slice(1)}
                        </Badge>
                        <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30 text-xs">{w.currency || "USDT"} • {w.network || "TRC20"}</Badge>
                      </div>
                      <p className="text-xs text-white/50 mt-0.5">{w.userEmail}</p>
                      <p className="text-xs text-white/30 font-mono mt-0.5 truncate">ID: {w.userId.slice(0, 16)}…</p>
                    </div>

                    {/* Net payout highlight */}
                    <div className="text-right shrink-0">
                      {isLoadingRecon ? (
                        <div className="flex items-center gap-1 text-xs text-white/30">
                          <Loader2 className="w-3 h-3 animate-spin" />verifying
                        </div>
                      ) : recon?.status === "clean" ? (
                        <div>
                          <p className="text-xs text-white/40 mb-0.5">Net Payout</p>
                          <p className="font-bold text-emerald-400 text-base">${netPayout.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })} {w.currency || "USDT"}</p>
                        </div>
                      ) : isPending ? (
                        <div>
                          <p className="text-xs text-white/40 mb-0.5">Net Payout</p>
                          <p className="text-xs font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-lg">Pending Verification</p>
                        </div>
                      ) : (
                        <div>
                          <p className="text-xs text-white/40 mb-0.5">Net Payout</p>
                          <p className="font-bold text-white/70 text-base">${netPayout.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Wallet address row */}
                  <div className="bg-white/5 rounded-xl px-3 py-2 flex items-center gap-2">
                    <span className="text-xs text-white/30 shrink-0">Wallet</span>
                    <span className="text-xs font-mono text-white/70 flex-1 text-center">{addrShort}</span>
                    <button onClick={() => copyWallet(w.id, addr)}
                      className={cn(
                        "shrink-0 flex items-center gap-1 text-xs px-2 py-0.5 rounded-lg transition-all",
                        copiedWalletId === w.id
                          ? "text-emerald-300 bg-emerald-500/15"
                          : "text-white/40 hover:text-emerald-300 hover:bg-emerald-500/10"
                      )}>
                      {copiedWalletId === w.id ? <><Check className="w-3 h-3" />Copied!</> : <><Copy className="w-3 h-3" />Copy</>}
                    </button>
                    <span className="text-xs text-white/25">Requested: {formatDate(w.createdAt)}</span>
                    {w.processedAt && (
                      <span className="text-xs text-white/25">Processed: {formatDate(w.processedAt)}</span>
                    )}
                  </div>

                  {/* Breakdown details (collapsible-style always open) */}
                  <div className="bg-black/30 border border-purple-500/20 rounded-xl p-3 space-y-1.5">
                    <p className="text-xs text-purple-300/60 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                      <Scale className="w-3 h-3" />Breakdown
                    </p>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-white/40">Requested</span>
                        <span className="text-white font-medium">${w.amount.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/40">Advertiser rate</span>
                        <span className="text-amber-300/80">${(w.amount / 0.65).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/40">Fee ({w.feePercent || 5}%)</span>
                        <span className="text-red-400">−${commission.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/40">Platform profit (35%)</span>
                        <span className="text-emerald-300/70">+${(w.amount / 0.65 * 0.35).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/40">Gas ({w.network || "TRC20"})</span>
                        <span className="text-red-400">−${gas.toFixed(2)}</span>
                      </div>
                    </div>
                    <div className="border-t border-white/10 pt-1.5 flex justify-between text-sm font-bold">
                      <span className="text-white">Net Payout</span>
                      <span className="text-emerald-400">${netPayout.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })} {w.currency || "USDT"}</span>
                    </div>
                  </div>

                  {/* Reconciliation panel */}
                  {isPending && (
                    isLoadingRecon ? (
                      <div className="flex items-center gap-2 text-xs text-white/40 py-1">
                        <Loader2 className="w-3 h-3 animate-spin" />Checking reconciliation…
                      </div>
                    ) : recon ? (
                      <div className={cn("rounded-xl p-3 border text-xs space-y-2", {
                        "bg-emerald-500/10 border-emerald-500/20": recon.status === "clean",
                        "bg-amber-500/10 border-amber-500/20": recon.status === "unverified",
                        "bg-red-500/10 border-red-500/30": recon.status === "flagged",
                      })}>
                        <div className="flex items-center gap-2 font-medium">
                          {recon.status === "clean"
                            ? <><CheckCircle className="w-3.5 h-3.5 text-emerald-400" /><span className="text-emerald-300">Reconciliation: CLEAN — Safe to approve</span></>
                            : recon.status === "flagged"
                            ? <><AlertTriangle className="w-3.5 h-3.5 text-red-400" /><span className="text-red-300">Reconciliation: FLAGGED — Platform funds at risk</span></>
                            : <><AlertTriangle className="w-3.5 h-3.5 text-amber-400" /><span className="text-amber-300">Reconciliation: UNVERIFIED — Tasks not yet network-confirmed</span></>
                          }
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div className="text-center bg-black/20 rounded-lg py-1.5">
                            <div className="text-white/40 text-[10px] mb-0.5">Approved</div>
                            <div className="font-mono text-white text-xs">${recon.totalApprovedEarnings.toFixed(4)}</div>
                          </div>
                          <div className="text-center bg-black/20 rounded-lg py-1.5">
                            <div className="text-white/40 text-[10px] mb-0.5">Verified</div>
                            <div className={cn("font-mono text-xs", recon.platformVerifiedEarnings >= recon.totalApprovedEarnings - 0.000001 ? "text-emerald-400" : "text-amber-400")}>
                              ${recon.platformVerifiedEarnings.toFixed(4)}
                            </div>
                          </div>
                          <div className="text-center bg-black/20 rounded-lg py-1.5">
                            <div className="text-white/40 text-[10px] mb-0.5">Unverified</div>
                            <div className={cn("font-mono text-xs", recon.unverifiedEarnings > 0.000001 ? "text-red-400" : "text-emerald-400")}>
                              ${recon.unverifiedEarnings.toFixed(4)}
                            </div>
                          </div>
                        </div>
                        {recon.rejectedCompletions.length > 0 && (
                          <div className="border-t border-red-500/20 pt-2 space-y-1">
                            <p className="text-red-300/80 font-medium">Rejected Tasks ({recon.rejectedCompletions.length}):</p>
                            {recon.rejectedCompletions.slice(0, 3).map((c) => (
                              <div key={c.id} className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="text-white/60 truncate text-[11px]">{c.taskTitle}</p>
                                  {c.rejectReason && <p className="text-red-400/60 text-[10px]">Reason: {c.rejectReason}</p>}
                                </div>
                                <span className="text-red-400 shrink-0 font-mono text-[11px]">−${c.reward.toFixed(4)}</span>
                              </div>
                            ))}
                            {recon.rejectedCompletions.length > 3 && (
                              <p className="text-white/30 text-[11px]">+{recon.rejectedCompletions.length - 3} more…</p>
                            )}
                          </div>
                        )}
                        {isBlocked && (
                          <div className={cn("pt-2 border-t flex items-start gap-2", isFlagged ? "border-red-500/20" : "border-amber-500/20")}>
                            <AlertTriangle className={cn("w-3.5 h-3.5 shrink-0 mt-0.5", isFlagged ? "text-red-400" : "text-amber-400")} />
                            <p className={cn("text-xs font-medium", isFlagged ? "text-red-300" : "text-amber-300")}>
                              {isFlagged
                                ? `${recon.rejectedCompletions.length} task(s) rejected by platform. Hold payout until resolved.`
                                : `${formatCurrency(recon.unverifiedEarnings)} in unconfirmed earnings. Hold until network confirms.`}
                            </p>
                          </div>
                        )}
                      </div>
                    ) : null
                  )}

                  {/* Rejection note (for already-rejected items) */}
                  {w.status === "rejected" && w.note && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 text-xs text-red-300/80">
                      Rejection reason: {w.note}
                    </div>
                  )}

                  {/* Action buttons — pending only */}
                  {isPending && (
                    <div className="flex gap-2">
                      <Button size="sm"
                        onClick={() => setConfirmApproveId(w.id)}
                        disabled={isBlocked}
                        title={isBlocked ? (isFlagged ? "Reconciliation flagged" : "Reconciliation unverified") : "Approve and mark as paid"}
                        className={cn("flex-1 rounded-xl text-white",
                          isBlocked ? "bg-slate-700/50 border border-white/10 cursor-not-allowed opacity-60" : "bg-emerald-500 hover:bg-emerald-400"
                        )}>
                        <CheckCircle className="w-4 h-4 mr-1.5" />
                        {isBlocked ? (isFlagged ? "Blocked — Flagged" : "Blocked — Unverified") : "Approve"}
                      </Button>
                      <Button size="sm" variant="outline"
                        onClick={() => { setRejectModalId(w.id); setRejectModalNote(""); }}
                        className="flex-1 border-red-500/30 text-red-400 hover:bg-red-500/10 rounded-xl">
                        <XCircle className="w-4 h-4 mr-1.5" />Reject
                      </Button>
                      <Button size="sm" variant="outline"
                        onClick={() => banUserDevice(w.userId, w.userName)}
                        className="border-red-900/40 text-red-500/60 hover:text-red-400 hover:bg-red-500/10 rounded-xl px-3"
                        title="Permanently ban this user's device">
                        <ShieldX className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── APPROVE CONFIRMATION MODAL ── */}
          {confirmApproveId && (() => {
            const w = allWithdrawals.find((x) => x.id === confirmApproveId);
            if (!w) return null;
            const commission = w.amount * ((w.feePercent || 5) / 100);
            const gas = w.gasFee || 1;
            const netPayout = w.netAmount ?? Math.max(0, w.amount - commission - gas);
            const addr = w.walletAddress || w.trc20Address || "";
            const addrShort = addr.length > 20 ? addr.slice(0, 10) + "…" + addr.slice(-10) : addr;
            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                onClick={() => setConfirmApproveId(null)}>
                <div className="bg-slate-900 border border-white/15 rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-4"
                  onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                      <CheckCircle className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white">Confirm Approval</h3>
                      <p className="text-xs text-white/50">This action cannot be undone</p>
                    </div>
                  </div>

                  <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-white/50">Recipient</span>
                      <span className="text-white font-medium">{w.userName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/50">Wallet</span>
                      <span className="text-white font-mono text-xs">{addrShort}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/50">Requested</span>
                      <span className="text-white">${w.amount.toFixed(4)}</span>
                    </div>
                    <div className="border-t border-white/10 pt-2 flex justify-between font-bold text-base">
                      <span className="text-white">Net Payout</span>
                      <span className="text-emerald-400">${netPayout.toFixed(4)} {w.currency || "USDT"}</span>
                    </div>
                  </div>

                  <p className="text-xs text-amber-300/70 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                    After approval, send <strong>${netPayout.toFixed(4)} {w.currency || "USDT"}</strong> via {w.network || "TRC20"} to the wallet above. The user's balance will be updated automatically.
                  </p>

                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setConfirmApproveId(null)}
                      className="flex-1 border-white/15 text-white/60 hover:text-white">
                      Cancel
                    </Button>
                    <Button onClick={handleConfirmApprove} disabled={!globalRecon?.isBalanced}
                      className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-white">
                      <CheckCircle className="w-4 h-4 mr-1.5" />Confirm Approval
                    </Button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── REJECT MODAL ── */}
          {rejectModalId && (() => {
            const w = allWithdrawals.find((x) => x.id === rejectModalId);
            if (!w) return null;
            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                onClick={() => { setRejectModalId(null); setRejectModalNote(""); }}>
                <div className="bg-slate-900 border border-white/15 rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-4"
                  onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
                      <XCircle className="w-5 h-5 text-red-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white">Reject Withdrawal</h3>
                      <p className="text-xs text-white/50">{w.userName} — ${w.amount.toFixed(4)} {w.currency || "USDT"}</p>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-white/50 mb-1.5 block">Rejection reason (optional — shown to user)</label>
                    <textarea
                      value={rejectModalNote}
                      onChange={(e) => setRejectModalNote(e.target.value)}
                      placeholder="e.g. Task completion could not be verified by the network..."
                      rows={3}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-white/25 resize-none focus:outline-none focus:border-white/25"
                    />
                  </div>

                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-xs text-emerald-300/80">
                    <strong>${w.amount.toFixed(4)}</strong> will be refunded back to {w.userName}'s balance automatically.
                  </div>

                  <div className="flex gap-2">
                    <Button variant="outline"
                      onClick={() => { setRejectModalId(null); setRejectModalNote(""); }}
                      className="flex-1 border-white/15 text-white/60 hover:text-white">
                      Cancel
                    </Button>
                    <Button onClick={handleRejectModal} disabled={rejectingModal}
                      className="flex-1 bg-red-500 hover:bg-red-400 text-white">
                      {rejectingModal ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <XCircle className="w-4 h-4 mr-1.5" />}
                      Reject & Refund
                    </Button>
                  </div>
                </div>
              </div>
            );
          })()}

        </div>
      )}

      {/* === RECONCILIATION === */}
      {tab === "reconciliation" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <Scale className="w-4 h-4 text-purple-400" />Reconciliation Dashboard
            </h2>
            <Button size="sm" variant="outline" onClick={handleFetchGlobalRecon} disabled={loadingGlobalRecon}
              className="border-white/20 text-white/60 hover:text-white">
              <RefreshCw className={cn("w-4 h-4 mr-1", loadingGlobalRecon && "animate-spin")} />Refresh
            </Button>
          </div>

          {loadingGlobalRecon ? (
            <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-purple-400" /></div>
          ) : globalRecon ? (
            <>
              {/* Safety Warning Banner */}
              {!globalRecon.isBalanced && (
                <div className="bg-red-500/15 border border-red-500/40 rounded-2xl p-4 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-red-300">Platform Funds Insufficient</p>
                    <p className="text-sm text-red-300/70 mt-0.5">
                      Platform-verified funds ({formatCurrency(globalRecon.totalMatchedAmount)}) are less than total pending withdrawals ({formatCurrency(globalRecon.totalWithdrawalRequestAmount)}).
                      Do not approve withdrawals until reconciliation shows 100% match.
                    </p>
                  </div>
                </div>
              )}

              {/* Summary Cards */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs text-emerald-300/70">Matched Tasks</span>
                  </div>
                  <div className="text-3xl font-bold text-white">{globalRecon.totalMatchedCount}</div>
                  <div className="text-xs text-white/40 mt-1">{formatCurrency(globalRecon.totalMatchedAmount)} verified</div>
                </div>
                <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <XCircle className="w-4 h-4 text-red-400" />
                    <span className="text-xs text-red-300/70">Rejected Tasks</span>
                  </div>
                  <div className="text-3xl font-bold text-white">{globalRecon.totalRejectedCount}</div>
                  <div className="text-xs text-white/40 mt-1">{formatCurrency(globalRecon.totalRejectedAmount)} lost</div>
                </div>
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-4 h-4 text-amber-400" />
                    <span className="text-xs text-amber-300/70">Pending Verification</span>
                  </div>
                  <div className="text-3xl font-bold text-white">{globalRecon.totalUnverifiedCount}</div>
                  <div className="text-xs text-white/40 mt-1">{formatCurrency(globalRecon.totalUnverifiedAmount)} unconfirmed</div>
                </div>
              </div>

              {/* Rejected Tasks Detail */}
              {globalRecon.rejectedItems.length > 0 && (
                <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                  <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
                    <XCircle className="w-4 h-4 text-red-400" />
                    Platform-Rejected Tasks ({globalRecon.rejectedItems.length})
                  </h3>
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {globalRecon.rejectedItems.map((item, i) => (
                      <div key={i} className="bg-red-500/5 border border-red-500/15 rounded-xl px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-white font-medium truncate">{item.taskTitle}</p>
                            <p className="text-xs text-white/50">{item.userEmail} • {item.taskPlatform}</p>
                            {item.rejectReason && (
                              <p className="text-xs text-red-400/70 mt-0.5">Reason: {item.rejectReason}</p>
                            )}
                            <p className="text-xs text-white/25 mt-0.5">{item.completedAt.toLocaleDateString()}</p>
                          </div>
                          <span className="text-red-400 font-mono text-sm shrink-0">−{formatCurrency(item.reward)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Pending Verification Detail */}
              {globalRecon.pendingVerificationItems.length > 0 && (
                <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                  <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-400" />
                    Awaiting Platform Confirmation ({globalRecon.pendingVerificationItems.length})
                  </h3>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {globalRecon.pendingVerificationItems.map((item, i) => (
                      <div key={i} className="bg-amber-500/5 border border-amber-500/15 rounded-xl px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-white font-medium truncate">{item.taskTitle}</p>
                            <p className="text-xs text-white/50">{item.userEmail}</p>
                            <p className="text-xs text-white/25 mt-0.5">{item.completedAt.toLocaleDateString()}</p>
                          </div>
                          <span className="text-amber-300 font-mono text-sm shrink-0">{formatCurrency(item.reward)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Platform Report Comparison */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                <h3 className="font-semibold text-white mb-1 flex items-center gap-2">
                  <Download className="w-4 h-4 text-blue-400" />
                  Platform Payout Report Comparison
                </h3>
                <p className="text-xs text-white/40 mb-4">
                  Paste the JSON payout report received from the platform. Format:{" "}
                  <span className="font-mono text-emerald-400/70">
                    {"[{\"userId\":\"...\",\"taskId\":\"...\",\"amount\":0.05,\"status\":\"approved\"}]"}
                  </span>
                </p>
                <textarea
                  value={platformReportText}
                  onChange={(e) => { setPlatformReportText(e.target.value); setReportComparison(null); }}
                  rows={5}
                  placeholder='Paste JSON report here...'
                  className="w-full bg-white/10 border border-white/20 text-white rounded-lg px-3 py-2 text-xs font-mono placeholder:text-white/25 focus:outline-none focus:border-emerald-400 resize-none mb-3"
                />
                <Button onClick={handleComparePlatformReport} disabled={comparingReport || !platformReportText.trim()}
                  className="bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 rounded-xl" variant="outline">
                  {comparingReport ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Scale className="w-4 h-4 mr-2" />}
                  Compare Against Our Records
                </Button>

                {reportComparison && (
                  <div className="mt-4 space-y-3">
                    <div className={cn("rounded-xl px-4 py-3 border flex items-start gap-2",
                      reportComparison.isFullMatch
                        ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-300"
                        : "bg-red-500/10 border-red-500/25 text-red-300")}>
                      {reportComparison.isFullMatch
                        ? <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
                      <div>
                        <p className="font-medium text-sm">
                          {reportComparison.isFullMatch ? "100% Match — Safe to process payouts" : "Discrepancies Detected — Hold payouts"}
                        </p>
                        <p className="text-xs opacity-70 mt-0.5">
                          Platform approved: {formatCurrency(reportComparison.totalPlatformApproved)} •
                          Our records: {formatCurrency(reportComparison.totalOurApproved)} •
                          Matched: {reportComparison.matchedCount} tasks
                        </p>
                      </div>
                    </div>

                    {reportComparison.mismatchedItems.length > 0 && (
                      <div className="bg-red-500/5 border border-red-500/15 rounded-xl p-4">
                        <p className="text-xs font-semibold text-red-300 mb-2">Amount Mismatches ({reportComparison.mismatchedItems.length})</p>
                        <div className="space-y-1.5">
                          {reportComparison.mismatchedItems.map((item, i) => (
                            <div key={i} className="text-xs flex justify-between gap-2">
                              <span className="text-white/60 font-mono truncate">{item.taskId}</span>
                              <span className="text-red-400 shrink-0">{item.reason}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {reportComparison.missingInPlatform.length > 0 && (
                      <div className="bg-amber-500/5 border border-amber-500/15 rounded-xl p-4">
                        <p className="text-xs font-semibold text-amber-300 mb-2">In Our Records But Missing From Platform Report ({reportComparison.missingInPlatform.length})</p>
                        <div className="space-y-1.5">
                          {reportComparison.missingInPlatform.map((item, i) => (
                            <div key={i} className="text-xs flex justify-between gap-2">
                              <span className="text-white/60 font-mono truncate">{item.taskId}</span>
                              <span className="text-amber-400 shrink-0">{formatCurrency(item.ourAmount)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {reportComparison.rejectedByPlatform.length > 0 && (
                      <div className="bg-red-500/5 border border-red-500/15 rounded-xl p-4">
                        <p className="text-xs font-semibold text-red-300 mb-2">Rejected By Platform ({reportComparison.rejectedByPlatform.length})</p>
                        <div className="space-y-1.5">
                          {reportComparison.rejectedByPlatform.map((item, i) => (
                            <div key={i} className="text-xs flex gap-2 justify-between">
                              <span className="text-white/60 font-mono truncate">{item.taskId}</span>
                              <span className="text-red-400/70 truncate">{item.reason}</span>
                              <span className="text-red-400 shrink-0">−{formatCurrency(item.amount)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-16 text-white/40">
              <Scale className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Click Refresh to load reconciliation data</p>
            </div>
          )}
        </div>
      )}

      {/* === TASKS === */}
      {tab === "tasks" && (
        <div className="space-y-4">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <h2 className="font-semibold text-white mb-4 flex items-center gap-2"><Plus className="w-4 h-4 text-emerald-400" />Add New Task (Manual)</h2>
            <div className="grid gap-3">
              <Input placeholder="Task title *" value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} className="bg-white/10 border-white/20 text-white placeholder:text-white/30" />
              <Input placeholder="Description" value={newTask.description} onChange={(e) => setNewTask({ ...newTask, description: e.target.value })} className="bg-white/10 border-white/20 text-white placeholder:text-white/30" />
              <Input placeholder="Task URL *" value={newTask.url} onChange={(e) => setNewTask({ ...newTask, url: e.target.value })} className="bg-white/10 border-white/20 text-white placeholder:text-white/30" />
              <div className="grid grid-cols-3 gap-3">
                <Input placeholder="Platform *" value={newTask.platform} onChange={(e) => setNewTask({ ...newTask, platform: e.target.value })} className="bg-white/10 border-white/20 text-white placeholder:text-white/30" />
                <select value={newTask.type} onChange={(e) => setNewTask({ ...newTask, type: e.target.value as "simple" | "premium", reward: e.target.value === "premium" ? 0.05 : 0.005 })} className="bg-slate-800 border border-white/20 text-white rounded-md px-3 text-sm">
                  <option value="simple">Simple</option>
                  <option value="premium">Premium</option>
                </select>
                <Input type="number" step="0.00001" inputMode="decimal" lang="en" placeholder="Reward (e.g. 0.005)" value={newTask.reward} onChange={(e) => setNewTask({ ...newTask, reward: parseFloat(e.target.value) })} className="bg-white/10 border-white/20 text-white placeholder:text-white/30" />
              </div>
              {newTask.reward > 0 && (
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 text-xs text-emerald-300">
                  Users earn: <span className="font-bold">{formatCurrency(userReward(newTask.reward))}</span><span className="text-white/40 ml-1">(65% of {formatCurrency(newTask.reward)})</span>
                </div>
              )}
              <Button onClick={handleAddTask} disabled={addingTask} className="bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl">
                {addingTask ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}Add Task
              </Button>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <h2 className="font-semibold text-white mb-4">Task List ({tasks.length})</h2>
            {tasksLoading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>
              : tasks.length === 0 ? <p className="text-white/40 text-center py-6 text-sm">No tasks yet</p>
                : <div className="space-y-3">{tasks.map((t) => {
                  const ns = NETWORK_STATUS_CONFIG[t.networkStatus || "pending"];
                  return (
                    <div key={t.id} className="bg-white/5 border border-white/10 rounded-xl p-4">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-sm font-medium text-white truncate">{t.title}</span>
                            <Badge className={cn("text-xs shrink-0", t.type === "premium" ? "bg-amber-500/20 text-amber-300" : "bg-blue-500/20 text-blue-300")}>{t.type}</Badge>
                            <Badge className={cn("text-xs shrink-0 border", ns.cls)}>{ns.label}</Badge>
                          </div>
                          <p className="text-xs text-white/40">
                            {t.platform} • Admin: {formatCurrency(t.reward)} → User: <span className="text-emerald-400">{formatCurrency(userReward(t.reward))}</span>
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button onClick={() => handleToggleTask(t.id, t.active)}
                            className={cn("w-10 h-5 rounded-full transition-all relative", t.active ? "bg-emerald-500" : "bg-white/20")}>
                            <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all", t.active ? "right-0.5" : "left-0.5")} />
                          </button>
                          <button onClick={() => handleDeleteTask(t.id)} className="text-red-400/60 hover:text-red-400 p-1"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                      <div className="flex gap-2 pt-2 border-t border-white/5">
                        {t.networkStatus !== "approved" && (
                          <Button size="sm" onClick={() => handleSetNetworkStatus(t.id, "approved")}
                            className="flex-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs h-8" variant="outline">
                            <ThumbsUp className="w-3 h-3 mr-1" />Approve
                          </Button>
                        )}
                        {t.networkStatus !== "rejected" && (
                          <Button size="sm" onClick={() => handleSetNetworkStatus(t.id, "rejected")}
                            className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-xs h-8" variant="outline">
                            <ThumbsDown className="w-3 h-3 mr-1" />{t.networkStatus === "approved" ? "Revoke" : "Reject"}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}</div>
            }
          </div>
        </div>
      )}

      {/* === IMPORT TASKS === */}
      {tab === "import" && (
        <div className="space-y-4">

          {/* Auto-Import Status */}
          <div className={cn("rounded-2xl p-4 border flex items-start gap-3",
            autoImportStatus === "running" ? "bg-blue-500/10 border-blue-500/20"
            : autoImportStatus === "completed" ? "bg-emerald-500/10 border-emerald-500/20"
            : autoImportStatus === "error" ? "bg-red-500/10 border-red-500/20"
            : "bg-white/5 border-white/10")}>
            <div className="shrink-0 mt-0.5">
              {autoImportStatus === "running" ? <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
              : autoImportStatus === "completed" ? <CheckCircle className="w-5 h-5 text-emerald-400" />
              : autoImportStatus === "error" ? <AlertTriangle className="w-5 h-5 text-red-400" />
              : <RefreshCw className="w-5 h-5 text-white/30" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <p className={cn("font-medium text-sm",
                  autoImportStatus === "running" ? "text-blue-300"
                  : autoImportStatus === "completed" ? "text-emerald-300"
                  : autoImportStatus === "error" ? "text-red-300"
                  : "text-white/50")}>
                  {autoImportStatus === "running" ? "Auto-Import Running..."
                  : autoImportStatus === "completed" ? "Auto-Import Completed"
                  : autoImportStatus === "error" ? "Auto-Import Error"
                  : "Auto-Import: Idle (add API keys in Settings to enable)"}
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  {autoImportStatus !== "idle" && (
                    <Button size="sm" variant="outline" onClick={() => runAutoImport(networkKeys)}
                      disabled={autoImportStatus === "running"}
                      className="border-white/20 text-white/60 hover:text-white text-xs h-7">
                      Run Now
                    </Button>
                  )}
                </div>
              </div>
              {lastAutoImport && (
                <p className="text-xs text-white/30 mt-0.5">
                  Last run: {lastAutoImport.toLocaleTimeString()} •
                  Next run in: {Math.floor(nextImportCountdown / 60)}m {nextImportCountdown % 60}s
                </p>
              )}
              {autoImportLog.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {autoImportLog.map((line, i) => (
                    <p key={i} className="text-xs text-white/50 font-mono">{line}</p>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4 flex gap-3">
            <AlertCircle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-blue-300 font-medium text-sm">How it works</p>
              <p className="text-blue-400/70 text-xs mt-1">
                Enter API keys in the Settings tab, then click "Fetch Offers" for a network. Select the offers you want to import as tasks.
                Auto-import runs every 30 minutes in the background, skipping offers already in the system.
                Due to browser CORS restrictions, some networks must be integrated via their postback/webhook URL instead.
              </p>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <h2 className="font-semibold text-white mb-2 flex items-center gap-2"><Link2 className="w-4 h-4 text-emerald-400" />Your Postback URL</h2>
            <p className="text-xs text-white/40 mb-3">Use this URL in each ad network's postback settings. Replace <span className="text-emerald-400 font-mono">USER_ID</span> and <span className="text-emerald-400 font-mono">TASK_ID</span> with the network's macros.</p>
            <div className="bg-slate-900 border border-white/10 rounded-xl p-3 font-mono text-xs text-emerald-300 break-all">
              {postbackBaseUrl}?network=NETWORK_NAME&user_id=USER_ID&task_id=TASK_ID&status=approved&amount=PAYOUT&secret={postbackSecret || "YOUR_SECRET"}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-3">
              {AD_NETWORKS.map((n) => (
                <div key={n.id} className="bg-white/5 border border-white/10 rounded-lg p-2 text-xs">
                  <p className="font-medium text-white">{n.name}</p>
                  <p className="text-white/40 mt-0.5">network={n.id}</p>
                </div>
              ))}
            </div>
          </div>

          {AD_NETWORKS.map((network) => (
            <div key={network.id} className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-white flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-400" />{network.name}
                  </h3>
                  <p className="text-xs text-white/40">{network.url}</p>
                </div>
                <Button size="sm" onClick={() => fetchOffersFromNetwork(network.id)}
                  disabled={fetchingNetwork === network.id}
                  className="bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 rounded-xl" variant="outline">
                  {fetchingNetwork === network.id ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Download className="w-4 h-4 mr-1" />}
                  Fetch Offers
                </Button>
              </div>

              {importedOffers.length > 0 && fetchingNetwork !== network.id && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-white/60">{importedOffers.length} offers found — select to import</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setSelectedImportOffers(new Set(importedOffers.map((_, i) => i)))}
                        className="border-white/20 text-white/60 hover:text-white text-xs h-7">Select All</Button>
                      <Button size="sm" onClick={() => importSelectedOffers(network.id)} disabled={importingOffers || selectedImportOffers.size === 0}
                        className="bg-emerald-500 hover:bg-emerald-400 text-white text-xs h-7 rounded-lg">
                        {importingOffers ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Download className="w-3 h-3 mr-1" />}
                        Import ({selectedImportOffers.size})
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {importedOffers.map((offer, idx) => (
                      <label key={idx} className={cn("flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all", selectedImportOffers.has(idx) ? "border-emerald-500/40 bg-emerald-500/10" : "border-white/5 hover:border-white/10")}>
                        <input type="checkbox" checked={selectedImportOffers.has(idx)}
                          onChange={(e) => {
                            const s = new Set(selectedImportOffers);
                            e.target.checked ? s.add(idx) : s.delete(idx);
                            setSelectedImportOffers(s);
                          }}
                          className="w-4 h-4 accent-emerald-500" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{String(offer.name || offer.title || offer.offer_name || "Unknown")}</p>
                          <p className="text-xs text-white/40">{String(offer.description || offer.requirements || "").slice(0, 80)}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-bold text-emerald-400">{formatCurrency(parseFloat(String(offer.payout || offer.reward || "0")))}</p>
                          <p className="text-xs text-white/30">payout</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* === POSTBACKS === */}
      {tab === "postbacks" && (
        <div className="space-y-4">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-white">Pending Postback Events</h2>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={fetchPostbacks} disabled={loadingPostbacks}
                  className="border-white/20 text-white/60 hover:text-white">
                  <RefreshCw className={cn("w-4 h-4 mr-1", loadingPostbacks && "animate-spin")} />Refresh
                </Button>
                {postbacks.length > 0 && (
                  <Button size="sm" onClick={processAllPostbacks}
                    className="bg-emerald-500 hover:bg-emerald-400 text-white rounded-lg">
                    Process All ({postbacks.length})
                  </Button>
                )}
              </div>
            </div>

            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 mb-4 text-xs text-blue-300 flex gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Postback events are received from ad networks when a user completes an offer.
                Click "Process All" to auto-approve/reject task completions and update user balances.
                These events are stored in memory and will be lost if the server restarts.
              </span>
            </div>

            {loadingPostbacks ? (
              <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>
            ) : postbacks.length === 0 ? (
              <p className="text-white/40 text-center py-8 text-sm">No pending postback events</p>
            ) : (
              <div className="space-y-3">
                {postbacks.map((event) => (
                  <div key={event.id} className="bg-white/5 border border-white/10 rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className={cn("text-xs border", event.status === "approved" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : "bg-red-500/20 text-red-300 border-red-500/30")}>
                            {event.status === "approved" ? "✅ Approved" : "❌ Rejected"}
                          </Badge>
                          <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30 text-xs">{event.network}</Badge>
                        </div>
                        <p className="text-xs text-white/50">User: <span className="font-mono">{event.userId}</span></p>
                        <p className="text-xs text-white/50">Task: <span className="font-mono">{event.taskId}</span></p>
                        {event.reason && <p className="text-xs text-red-400/70">Reason: {event.reason}</p>}
                        <p className="text-xs text-white/30 mt-1">{new Date(event.receivedAt).toLocaleString()}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-lg font-bold text-emerald-400">{formatCurrency(event.amount)}</div>
                        <Button size="sm" onClick={() => processPostback(event)} disabled={processingPostback === event.id}
                          className="mt-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs h-7" variant="outline">
                          {processingPostback === event.id ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                          Process
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* === ANALYTICS === */}
      {tab === "analytics" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-white flex items-center gap-2"><BarChart3 className="w-4 h-4 text-purple-400" />Platform Analytics</h2>
            <Button size="sm" variant="outline" onClick={fetchAnalytics} disabled={loadingAnalytics}
              className="border-white/20 text-white/60 hover:text-white">
              <RefreshCw className={cn("w-4 h-4 mr-1", loadingAnalytics && "animate-spin")} />Refresh
            </Button>
          </div>

          {loadingAnalytics ? (
            <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-purple-400" /></div>
          ) : analytics ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="w-4 h-4 text-blue-400" />
                    <span className="text-xs text-blue-300/70">Total Users</span>
                  </div>
                  <div className="text-3xl font-bold text-white">{analytics.totalUsers}</div>
                </div>
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs text-emerald-300/70">Platform Revenue (35%)</span>
                  </div>
                  <div className="text-3xl font-bold text-white">{formatCurrency(analytics.totalRevenue)}</div>
                </div>
                <div className="bg-purple-500/10 border border-purple-500/20 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <ArrowDownToLine className="w-4 h-4 text-purple-400" />
                    <span className="text-xs text-purple-300/70">Total Withdrawals</span>
                  </div>
                  <div className="text-3xl font-bold text-white">{analytics.totalWithdrawalsCount}</div>
                  <div className="text-xs text-white/40 mt-1">{formatCurrency(analytics.totalWithdrawalsAmount)} total</div>
                </div>
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-4 h-4 text-amber-400" />
                    <span className="text-xs text-amber-300/70">Pending Withdrawals</span>
                  </div>
                  <div className="text-3xl font-bold text-white">{pendingWithdrawals.length}</div>
                  <div className="text-xs text-white/40 mt-1">{formatCurrency(analytics.pendingWithdrawalsAmount)} pending</div>
                </div>
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs text-emerald-300/70">Approved Withdrawals</span>
                  </div>
                  <div className="text-3xl font-bold text-white">{allWithdrawals.filter(w => w.status === "approved").length}</div>
                  <div className="text-xs text-white/40 mt-1">{formatCurrency(analytics.approvedWithdrawalsAmount)} paid out</div>
                </div>
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-4 h-4 text-blue-400" />
                    <span className="text-xs text-blue-300/70">Tasks Live</span>
                  </div>
                  <div className="text-3xl font-bold text-white">{approvedNetworkTasks}</div>
                  <div className="text-xs text-white/40 mt-1">{pendingNetworkTasks} pending review</div>
                </div>
              </div>

              {/* Withdrawal breakdown by currency */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                <h3 className="font-semibold text-white mb-4">Withdrawal Breakdown by Currency</h3>
                <div className="grid grid-cols-2 gap-4">
                  {(["USDT", "USDC"] as const).map((cur) => {
                    const curWithdrawals = allWithdrawals.filter(w => (w.currency || "USDT") === cur);
                    const total = curWithdrawals.reduce((s, w) => s + w.amount, 0);
                    return (
                      <div key={cur} className="bg-white/5 rounded-xl p-4">
                        <p className="text-sm font-medium text-white mb-2">{cur}</p>
                        <p className="text-2xl font-bold text-white">{curWithdrawals.length}</p>
                        <p className="text-xs text-white/40 mt-1">{formatCurrency(total)} total</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Reconciliation Report */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                <h3 className="font-semibold text-white mb-1 flex items-center gap-2">
                  <Scale className="w-4 h-4 text-purple-400" />Reconciliation Report
                </h3>
                <p className="text-xs text-white/40 mb-4">Platform Payout Report vs User Withdrawal Requests</p>
                {Object.keys(reconciliations).length === 0 ? (
                  <p className="text-white/30 text-sm text-center py-4">
                    Reconciliation data loads automatically when there are pending withdrawals.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {/* Summary stats */}
                    <div className="grid grid-cols-3 gap-3">
                      {(() => {
                        const vals = Object.values(reconciliations);
                        const clean = vals.filter(r => r.status === "clean").length;
                        const unverified = vals.filter(r => r.status === "unverified").length;
                        const flagged = vals.filter(r => r.status === "flagged").length;
                        return (
                          <>
                            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-center">
                              <p className="text-2xl font-bold text-white">{clean}</p>
                              <p className="text-xs text-emerald-300/70 mt-0.5">Clean</p>
                            </div>
                            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-center">
                              <p className="text-2xl font-bold text-white">{unverified}</p>
                              <p className="text-xs text-amber-300/70 mt-0.5">Unverified</p>
                            </div>
                            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-center">
                              <p className="text-2xl font-bold text-white">{flagged}</p>
                              <p className="text-xs text-red-300/70 mt-0.5">Flagged</p>
                            </div>
                          </>
                        );
                      })()}
                    </div>

                    {/* Per-user breakdown */}
                    <div className="space-y-2">
                      {pendingWithdrawals.map((w) => {
                        const recon = reconciliations[w.userId];
                        if (!recon) return null;
                        return (
                          <div key={w.id} className={cn("rounded-xl p-3 border text-xs flex items-start gap-3",
                            recon.status === "clean" ? "bg-emerald-500/5 border-emerald-500/15"
                            : recon.status === "flagged" ? "bg-red-500/10 border-red-500/25"
                            : "bg-amber-500/5 border-amber-500/15")}>
                            <div className="mt-0.5">
                              {recon.status === "clean"
                                ? <CheckCircle className="w-4 h-4 text-emerald-400" />
                                : <AlertTriangle className={cn("w-4 h-4", recon.status === "flagged" ? "text-red-400" : "text-amber-400")} />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-white">{w.userName} <span className="text-white/40 font-normal">({w.userEmail})</span></p>
                              <p className="text-white/50 mt-0.5">
                                Approved: ${recon.totalApprovedEarnings.toFixed(5)} • Verified: ${recon.platformVerifiedEarnings.toFixed(5)}
                                {recon.unverifiedEarnings > 0.000001 && <span className="text-red-400"> • Unverified: ${recon.unverifiedEarnings.toFixed(5)}</span>}
                              </p>
                              {recon.rejectedCompletions.length > 0 && (
                                <p className="text-red-400/80 mt-0.5">{recon.rejectedCompletions.length} task(s) rejected by platform</p>
                              )}
                            </div>
                            <div className="shrink-0 text-right">
                              <Badge className={cn("text-xs border",
                                recon.status === "clean" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                                : recon.status === "flagged" ? "bg-red-500/20 text-red-300 border-red-500/30"
                                : "bg-amber-500/20 text-amber-300 border-amber-500/30")}>
                                {recon.status.toUpperCase()}
                              </Badge>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-16 text-white/40">
              <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Click Refresh to load analytics data</p>
            </div>
          )}
        </div>
      )}

      {/* === USERS === */}
      {tab === "users" && (
        <div className="space-y-4">
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4 flex gap-3">
            <AlertCircle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-blue-300 font-medium text-sm">Device Override</p>
              <p className="text-blue-400/70 text-xs mt-1">
                By default, each device can only create one account. Toggle "Allow Duplicate Device" for users who legitimately need to register on a device already in use (e.g. shared household devices). This only affects new registrations — existing accounts are unaffected.
              </p>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4 gap-3">
              <h2 className="font-semibold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-400" />All Users ({allUsers.length})
              </h2>
              <div className="flex items-center gap-2">
                <Input
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search by email or name..."
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/30 text-sm h-8 w-52"
                />
                <Button size="sm" variant="outline" onClick={fetchAllUsers} disabled={loadingUsers}
                  className="border-white/20 text-white/60 hover:text-white h-8">
                  <RefreshCw className={cn("w-3.5 h-3.5", loadingUsers && "animate-spin")} />
                </Button>
              </div>
            </div>

            {loadingUsers ? (
              <div className="flex justify-center py-10">
                <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
              </div>
            ) : allUsers.length === 0 ? (
              <p className="text-center text-white/40 py-8 text-sm">No users found</p>
            ) : (
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {allUsers
                  .filter((u) =>
                    !userSearch ||
                    u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
                    u.name.toLowerCase().includes(userSearch.toLowerCase())
                  )
                  .map((u) => (
                    <div key={u.uid} className={cn(
                      "flex items-center justify-between gap-3 rounded-xl px-4 py-3 border",
                      u.allowDuplicateDevice
                        ? "bg-amber-500/5 border-amber-500/15"
                        : "bg-white/3 border-white/8"
                    )}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-white truncate">{u.name}</p>
                          <span className={cn("text-xs px-1.5 py-0.5 rounded font-medium",
                            u.role === "admin"
                              ? "bg-purple-500/20 text-purple-300"
                              : "bg-white/10 text-white/40"
                          )}>{u.role}</span>
                          {u.allowDuplicateDevice && (
                            <span className="text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded">
                              Device Override ON
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-white/40 mt-0.5">{u.email}</p>
                        <div className="flex items-center gap-3 mt-0.5">
                          <p className="text-xs text-emerald-400">${u.balance.toFixed(4)}</p>
                          <p className="text-xs text-white/25 font-mono truncate max-w-[140px]">
                            fp: {u.deviceFingerprint.slice(0, 12) || "—"}
                          </p>
                          <p className="text-xs text-white/25">{formatDate(u.registeredAt)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => toggleDuplicateDevice(u)}
                          disabled={togglingUser === u.uid}
                          title={u.allowDuplicateDevice ? "Disable device override" : "Allow duplicate device"}
                          className={cn(
                            "relative inline-flex h-5 w-9 items-center rounded-full border transition-colors disabled:opacity-50",
                            u.allowDuplicateDevice
                              ? "bg-amber-500 border-amber-400"
                              : "bg-white/10 border-white/20"
                          )}
                        >
                          {togglingUser === u.uid
                            ? <Loader2 className="w-3 h-3 animate-spin absolute left-1/2 -translate-x-1/2 text-white" />
                            : <span className={cn(
                                "inline-block h-3 w-3 rounded-full bg-white shadow transition-transform",
                                u.allowDuplicateDevice ? "translate-x-5" : "translate-x-1"
                              )} />
                          }
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* === SETTINGS === */}
      {tab === "settings" && (
        <div className="space-y-4">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-5 flex items-center gap-2"><Settings className="w-4 h-4 text-emerald-400" />Platform Settings</h2>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-white/80 block mb-1">Withdrawal Instruction Text</label>
                <p className="text-xs text-white/40 mb-2">This message appears in the blue info box on the user's Wallet page.</p>
                <textarea
                  value={withdrawalInstructionText}
                  onChange={(e) => setWithdrawalInstructionText(e.target.value)}
                  rows={3}
                  placeholder="Enter the message users will see on the Wallet page..."
                  className="w-full bg-white/10 border border-white/20 text-white rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:border-emerald-400 resize-none"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-white/80 block mb-1">Postback Secret Key</label>
                <p className="text-xs text-white/40 mb-2">Include this in your postback URL as <span className="font-mono text-emerald-400">?secret=YOUR_SECRET</span></p>
                <Input value={postbackSecret} onChange={(e) => setPostbackSecret(e.target.value)}
                  placeholder="your-secure-secret-key"
                  className="bg-white/10 border-white/20 text-white max-w-sm font-mono text-sm" />
              </div>
            </div>
          </div>

          {/* Withdrawal Settings */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-5 flex items-center gap-2"><ArrowDownToLine className="w-4 h-4 text-emerald-400" />Withdrawal Settings</h2>
            <div className="space-y-5">

              {/* Currency toggles */}
              <div>
                <p className="text-sm font-medium text-white/80 mb-3">Enabled Currencies</p>
                <div className="flex gap-4">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <button
                      type="button"
                      onClick={() => setUsdtEnabled(!usdtEnabled)}
                      className={cn("w-10 h-5 rounded-full transition-all relative shrink-0", usdtEnabled ? "bg-emerald-500" : "bg-white/20")}>
                      <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all", usdtEnabled ? "right-0.5" : "left-0.5")} />
                    </button>
                    <span className="text-sm text-white">USDT (TRC20)</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <button
                      type="button"
                      onClick={() => setUsdcEnabled(!usdcEnabled)}
                      className={cn("w-10 h-5 rounded-full transition-all relative shrink-0", usdcEnabled ? "bg-emerald-500" : "bg-white/20")}>
                      <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all", usdcEnabled ? "right-0.5" : "left-0.5")} />
                    </button>
                    <span className="text-sm text-white">USDC (TRC20 / ERC20)</span>
                  </label>
                </div>
              </div>

              {/* Minimum amounts */}
              <div>
                <p className="text-sm font-medium text-white/80 mb-3">Minimum Withdrawal Amounts ($)</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-white/50 block mb-1">USDT Minimum</label>
                    <Input type="text" inputMode="decimal" pattern="[0-9.]*" lang="en" value={usdtMin}
                      onChange={(e) => setUsdtMin(parseFloat(e.target.value.replace(/[^0-9.]/g, "")) || 0)}
                      className="bg-white/10 border-white/20 text-white" />
                  </div>
                  <div>
                    <label className="text-xs text-white/50 block mb-1">USDC Minimum</label>
                    <Input type="text" inputMode="decimal" pattern="[0-9.]*" lang="en" value={usdcMin}
                      onChange={(e) => setUsdcMin(parseFloat(e.target.value.replace(/[^0-9.]/g, "")) || 0)}
                      className="bg-white/10 border-white/20 text-white" />
                  </div>
                </div>
              </div>

              {/* Gas fees */}
              <div>
                <p className="text-sm font-medium text-white/80 mb-3">Network Gas Fees ($)</p>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs text-white/50 block mb-1">USDT Gas</label>
                    <Input type="text" inputMode="decimal" pattern="[0-9.]*" lang="en" value={usdtGas}
                      onChange={(e) => setUsdtGas(parseFloat(e.target.value.replace(/[^0-9.]/g, "")) || 0)}
                      className="bg-white/10 border-white/20 text-white" />
                  </div>
                  <div>
                    <label className="text-xs text-white/50 block mb-1">USDC TRC20 Gas</label>
                    <Input type="text" inputMode="decimal" pattern="[0-9.]*" lang="en" value={usdcTrc20Gas}
                      onChange={(e) => setUsdcTrc20Gas(parseFloat(e.target.value.replace(/[^0-9.]/g, "")) || 0)}
                      className="bg-white/10 border-white/20 text-white" />
                  </div>
                  <div>
                    <label className="text-xs text-white/50 block mb-1">USDC ERC20 Gas</label>
                    <Input type="text" inputMode="decimal" pattern="[0-9.]*" lang="en" value={usdcErc20Gas}
                      onChange={(e) => setUsdcErc20Gas(parseFloat(e.target.value.replace(/[^0-9.]/g, "")) || 0)}
                      className="bg-white/10 border-white/20 text-white" />
                  </div>
                </div>
              </div>

              {/* Commission & Schedule */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-white/50 block mb-1">Withdrawal Fee / Commission (%)</label>
                  <Input type="text" inputMode="decimal" pattern="[0-9.]*" lang="en" value={withdrawalFeePercent}
                    onChange={(e) => setWithdrawalFeePercent(parseFloat(e.target.value.replace(/[^0-9.]/g, "")) || 0)}
                    className="bg-white/10 border-white/20 text-white" />
                  <p className="text-xs text-white/30 mt-1">Platform takes this % from each withdrawal</p>
                </div>
                <div>
                  <label className="text-xs text-white/50 block mb-1">Processing Schedule</label>
                  <select
                    value={withdrawalSchedule}
                    onChange={(e) => setWithdrawalSchedule(e.target.value as "instant" | "daily" | "weekly")}
                    className="w-full bg-slate-800 border border-white/20 text-white rounded-md px-3 py-2 text-sm">
                    <option value="instant">Instant (process immediately)</option>
                    <option value="daily">Daily batch</option>
                    <option value="weekly">Weekly batch</option>
                  </select>
                </div>
              </div>

              {/* Allow Duplicate Wallets */}
              <div className="mt-4 pt-4 border-t border-white/10">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-white/80">Allow Duplicate Wallet Addresses</p>
                    <p className="text-xs text-white/30 mt-0.5">
                      By default, each wallet address can only be used by one account. Enable this to allow shared wallets (e.g. business accounts). Duplicate wallets will still trigger fraud alerts.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAllowDuplicateWallets((v) => !v)}
                    className={cn(
                      "relative shrink-0 mt-0.5 inline-flex h-6 w-11 items-center rounded-full border transition-colors",
                      allowDuplicateWallets
                        ? "bg-amber-500 border-amber-400"
                        : "bg-white/10 border-white/20"
                    )}
                  >
                    <span className={cn(
                      "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                      allowDuplicateWallets ? "translate-x-6" : "translate-x-1"
                    )} />
                  </button>
                </div>
                {allowDuplicateWallets && (
                  <div className="mt-2 bg-amber-500/10 border border-amber-500/20 rounded-xl p-2.5 flex gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-300">Duplicate wallets are allowed. Users can share wallet addresses, but fraud alerts will still fire for cross-account matches.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-5 flex items-center gap-2"><Zap className="w-4 h-4 text-amber-400" />Ad Network API Keys</h2>
            <div className="space-y-4">
              {AD_NETWORKS.map((n) => {
                const keyField = `${n.id}Key` as keyof NetworkKeys;
                return (
                  <div key={n.id}>
                    <label className="text-sm font-medium text-white/80 block mb-1">{n.name} API Key</label>
                    <Input
                      value={networkKeys[keyField] || ""}
                      onChange={(e) => setNetworkKeys({ ...networkKeys, [keyField]: e.target.value })}
                      placeholder={`${n.name} API key`}
                      className="bg-white/10 border-white/20 text-white font-mono text-sm"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <Button onClick={handleSaveSettings} disabled={savingSettings}
            className="bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl px-8">
            {savingSettings ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Save All Settings
          </Button>



          {/* Hard Ban System */}
          <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-6 space-y-5">
            <h2 className="font-semibold text-red-400 flex items-center gap-2"><ShieldX className="w-4 h-4" />Hard Ban System</h2>
            <p className="text-xs text-white/40">Banned devices are permanently blocked from accessing Green Task Orbit. Bans survive cache clears and VPN changes because they target device fingerprints stored in Firestore.</p>

            <div className="space-y-3">
              <Input value={banInput} onChange={(e) => setBanInput(e.target.value)}
                placeholder="Device fingerprint (e.g. 3h9k2j_ab12cd34)"
                className="bg-white/10 border-red-500/30 text-white placeholder:text-white/30 font-mono text-sm" />
              <Input value={banReason} onChange={(e) => setBanReason(e.target.value)}
                placeholder="Reason (optional)"
                className="bg-white/10 border-red-500/30 text-white placeholder:text-white/30" />
              <Button onClick={banDevice} disabled={banning}
                className="bg-red-500 hover:bg-red-400 text-white rounded-xl">
                {banning ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldX className="w-4 h-4 mr-2" />}
                Ban Device
              </Button>
            </div>

            {bannedDevices.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-white/70 mb-3">Banned Devices ({bannedDevices.length})</h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {bannedDevices.map((b) => (
                    <div key={b.id} className="flex items-center justify-between gap-3 bg-red-500/5 border border-red-500/10 rounded-xl p-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-mono text-red-300 truncate">{b.fingerprint}</p>
                        {b.reason && <p className="text-xs text-white/40 mt-0.5">{b.reason}</p>}
                        <p className="text-xs text-white/25 mt-0.5">{formatDate(b.bannedAt)}</p>
                      </div>
                      <button onClick={() => unbanDevice(b.id)}
                        className="shrink-0 flex items-center gap-1 text-xs text-red-400/60 hover:text-red-300 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10">
                        <ShieldOff className="w-3 h-3" />Unban
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
