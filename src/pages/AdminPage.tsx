import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useWallet } from "@/contexts/WalletContext";
import { useLocation } from "wouter";
import { adminRevenueRate, formatCurrency, formatDate, userReward } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Loader2, CheckCircle, XCircle, Plus, Trash2, ShieldCheck,
  Clock, Settings, ThumbsUp, ThumbsDown, Download, Link2,
  RefreshCw, Zap, AlertCircle, ShieldX, ShieldOff,
  BarChart3, Copy, Users, DollarSign, TrendingUp, ArrowDownToLine,
  AlertTriangle, Scale, Filter, Search, ChevronLeft, ChevronRight, Pencil,
  FileDown, Check, Eye, ChevronDown, ChevronUp, Lock, ExternalLink, Code
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  collection, addDoc, getDocs, updateDoc, doc, deleteDoc, setDoc,
  serverTimestamp, Timestamp, increment, getDoc, query, where, onSnapshot
} from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { Task } from "@/contexts/TaskContext";
import { getSettings, saveSettings, NetworkKeys } from "@/lib/settings";
import { settleTaskCompletion as settleWalletCompletion } from "@/lib/walletSettlement";
import { isManualCompletion } from "@/lib/taskType";
import {
  fetchUserReconciliation,
  UserReconciliation,
  fetchGlobalReconciliation,
  GlobalReconciliation,
  comparePlatformReport,
  PlatformReportEntry,
  ReportComparisonResult,
} from "@/lib/reconciliation";
import {
  PLATFORM_REGISTRY,
  PLATFORM_ACCENT_ICON,
  PLATFORM_ACCENT_TEXT,
} from "@/lib/platforms";

type TabType = "withdrawals" | "tasks" | "manualReviews" | "platforms" | "import" | "postbacks" | "settings" | "analytics" | "reconciliation" | "users" | "messages";

type AdminUser = {
  uid: string; email: string; name: string; role: string;
  balance: number; deviceFingerprint: string;
  registeredAt: Date;
};

const NETWORK_STATUS_CONFIG = {
  pending: { label: "Pending", cls: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
  approved: { label: "Approved", cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
  rejected: { label: "Rejected", cls: "bg-red-500/20 text-red-300 border-red-500/30" },
};

// Platform form type used by both the Add form and the inline Edit form
type PlatformFormState = {
  name: string;
  displayName: string;
  enabled: boolean;
  apiBase: string;
  endpoint: string;
  authenticationType: "bearer" | "apiKeyHeader" | "queryParam" | "basicAuth";
  apiKey: string;
  apiKeyParam: string;
  apiKeyHeaderName: string;
  basicAuthUser: string;
  requestMethod: "GET" | "POST";
  headersRaw: string;
  queryParamsRaw: string;
  responsePath: string;
  offerMappingRaw: string;
  postbackUrl: string;
  autoImport: boolean;
  importInterval: number;
  rateLimit: number;
};

function PlatformEditForm({
  initialForm,
  saving,
  onSave,
  onCancel,
}: {
  initialForm: PlatformFormState;
  saving: boolean;
  onSave: (form: PlatformFormState) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<PlatformFormState>(initialForm);
  const set = (patch: Partial<PlatformFormState>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div className="mt-3 pt-3 border-t border-white/10 space-y-4">
      <p className="text-xs font-semibold text-white/50 uppercase tracking-wide">Edit Configuration</p>
      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-white/40 mb-1 block">Display Name</label>
          <input value={form.displayName} onChange={(e) => set({ displayName: e.target.value })}
            placeholder="e.g. AdGem"
            className="w-full bg-white/10 border border-white/20 text-white text-sm rounded-lg px-3 py-2" />
        </div>
        <div>
          <label className="text-xs text-white/40 mb-1 block">API Base URL</label>
          <input value={form.apiBase} onChange={(e) => set({ apiBase: e.target.value })}
            placeholder="https://api.example.com/v1"
            className="w-full bg-white/10 border border-white/20 text-white text-sm rounded-lg px-3 py-2" />
        </div>
        <div>
          <label className="text-xs text-white/40 mb-1 block">Endpoint Path</label>
          <input value={form.endpoint} onChange={(e) => set({ endpoint: e.target.value })}
            placeholder="/offers"
            className="w-full bg-white/10 border border-white/20 text-white text-sm rounded-lg px-3 py-2" />
        </div>
        <div>
          <label className="text-xs text-white/40 mb-1 block">Authentication Type</label>
          <select value={form.authenticationType} onChange={(e) => set({ authenticationType: e.target.value as PlatformFormState["authenticationType"] })}
            className="w-full bg-white/10 border border-white/20 text-white text-sm rounded-lg px-3 py-2">
            <option value="queryParam">Query Parameter</option>
            <option value="bearer">Bearer Token</option>
            <option value="apiKeyHeader">API Key Header</option>
            <option value="basicAuth">Basic Auth</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-white/40 mb-1 block">API Key / Secret</label>
          <input value={form.apiKey} onChange={(e) => set({ apiKey: e.target.value })}
            placeholder="Your API key or bearer token"
            className="w-full bg-white/10 border border-white/20 text-white text-sm font-mono rounded-lg px-3 py-2" />
        </div>
        {form.authenticationType === "queryParam" && (
          <div>
            <label className="text-xs text-white/40 mb-1 block">Query Param Name</label>
            <input value={form.apiKeyParam} onChange={(e) => set({ apiKeyParam: e.target.value })}
              placeholder="api_key"
              className="w-full bg-white/10 border border-white/20 text-white text-sm rounded-lg px-3 py-2" />
          </div>
        )}
        {form.authenticationType === "apiKeyHeader" && (
          <div>
            <label className="text-xs text-white/40 mb-1 block">Header Name</label>
            <input value={form.apiKeyHeaderName} onChange={(e) => set({ apiKeyHeaderName: e.target.value })}
              placeholder="X-API-Key"
              className="w-full bg-white/10 border border-white/20 text-white text-sm rounded-lg px-3 py-2" />
          </div>
        )}
        {form.authenticationType === "basicAuth" && (
          <div>
            <label className="text-xs text-white/40 mb-1 block">Basic Auth Username</label>
            <input value={form.basicAuthUser} onChange={(e) => set({ basicAuthUser: e.target.value })}
              placeholder="username"
              className="w-full bg-white/10 border border-white/20 text-white text-sm rounded-lg px-3 py-2" />
          </div>
        )}
        <div>
          <label className="text-xs text-white/40 mb-1 block">Response Path</label>
          <input value={form.responsePath} onChange={(e) => set({ responsePath: e.target.value })}
            placeholder="offers"
            className="w-full bg-white/10 border border-white/20 text-white text-sm rounded-lg px-3 py-2" />
        </div>
        <div>
          <label className="text-xs text-white/40 mb-1 block">Request Method</label>
          <select value={form.requestMethod} onChange={(e) => set({ requestMethod: e.target.value as "GET" | "POST" })}
            className="w-full bg-white/10 border border-white/20 text-white text-sm rounded-lg px-3 py-2">
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-white/40 mb-1 block">Extra Query Params (key: value)</label>
          <textarea rows={3} value={form.queryParamsRaw} onChange={(e) => set({ queryParamsRaw: e.target.value })}
            placeholder={"limit: 50\ntype: 1"}
            className="w-full bg-white/10 border border-white/20 text-white text-xs rounded-lg px-3 py-2 font-mono resize-none" />
        </div>
        <div>
          <label className="text-xs text-white/40 mb-1 block">Custom Headers (key: value)</label>
          <textarea rows={3} value={form.headersRaw} onChange={(e) => set({ headersRaw: e.target.value })}
            placeholder={"X-App-ID: yourappid"}
            className="w-full bg-white/10 border border-white/20 text-white text-xs rounded-lg px-3 py-2 font-mono resize-none" />
        </div>
        <div>
          <label className="text-xs text-white/40 mb-1 block">Field Mapping (target: source)</label>
          <textarea rows={3} value={form.offerMappingRaw} onChange={(e) => set({ offerMappingRaw: e.target.value })}
            placeholder={"id: offer_id\ntitle: name\npayout: reward"}
            className="w-full bg-white/10 border border-white/20 text-white text-xs rounded-lg px-3 py-2 font-mono resize-none" />
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-3 items-center">
        <div>
          <label className="text-xs text-white/40 mb-1 block">Postback URL</label>
          <input value={form.postbackUrl} onChange={(e) => set({ postbackUrl: e.target.value })}
            placeholder="https://..."
            className="w-full bg-white/10 border border-white/20 text-white text-sm rounded-lg px-3 py-2" />
        </div>
        <div>
          <label className="text-xs text-white/40 mb-1 block">Auto-Import Interval (min)</label>
          <input type="number" value={form.importInterval} onChange={(e) => set({ importInterval: parseInt(e.target.value) || 30 })}
            className="w-full bg-white/10 border border-white/20 text-white text-sm rounded-lg px-3 py-2" />
        </div>
        <div className="flex items-center gap-4 pt-5">
          <button onClick={() => set({ enabled: !form.enabled })}
            className={`w-10 h-5 rounded-full transition-all relative shrink-0 ${form.enabled ? "bg-emerald-500" : "bg-white/20"}`}>
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${form.enabled ? "right-0.5" : "left-0.5"}`} />
          </button>
          <span className="text-xs text-white/50">Enabled</span>
          <button onClick={() => set({ autoImport: !form.autoImport })}
            className={`w-10 h-5 rounded-full transition-all relative shrink-0 ${form.autoImport ? "bg-blue-500" : "bg-white/20"}`}>
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${form.autoImport ? "right-0.5" : "left-0.5"}`} />
          </button>
          <span className="text-xs text-white/50">Auto-Import</span>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button onClick={() => onSave(form)} disabled={saving}
          className="flex items-center gap-1 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors">
          {saving ? "Saving..." : "Save Changes"}
        </button>
        <button onClick={onCancel}
          className="text-xs text-white/50 hover:text-white px-4 py-2 rounded-lg transition-colors border border-white/10 hover:border-white/20">
          Cancel
        </button>
      </div>
    </div>
  );
}

interface PostbackConversion {
  id: string;
  platformId: string;
  platformName: string;
  externalConversionId: string;
  dedupKey: string;
  userId: string;
  taskId: string;
  completionId: string;
  status: "settled" | "rejected" | "skipped" | "duplicate" | "processing" | "invalid_params" | "invalid_platform" | "invalid_signature" | "invalid_secret" | "replay_prevented" | string;
  conversionStatus: "approved" | "rejected";
  amount: number;
  error: string;
  processingMs: number;
  receivedAt: string;
  processedAt: string;
}

interface PostbackLog {
  id: string;
  type: "settled" | "rejected" | "duplicate" | "invalid_params" | "invalid_platform" | "invalid_signature" | "replay_attack" | "skipped" | string;
  message: string;
  platformId: string;
  userId: string;
  taskId: string;
  convId: string;
  amount: number;
  completionId: string;
  processingMs: number;
  receivedAt: string;
  createdAt: string;
}

interface PostbackStats {
  total: number;
  settled: number;
  rejected: number;
  skipped: number;
  duplicates: number;
  processing: number;
  failed: number;
  totalSettledAmount: number;
  byPlatform: Record<string, { total: number; settled: number; amount: number }>;
  avgProcessingMs: number;
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

type ManualTaskCompletion = {
  id: string;
  taskId: string;
  taskTitle: string;
  taskDescription: string;
  userId: string;
  userName: string;
  userEmail: string;
  reward: number;
  adminReward: number;
  manualUserSharePercent: number;
  status: "pending" | "approved" | "rejected";
  submittedAt: Date;
};

type PlatformTaskCompletion = {
  id: string;
  taskId: string;
  taskTitle: string;
  userId: string;
  userName: string;
  userEmail: string;
  reward: number;
  platformName: string;
  verifiedBy: string;
  platformVerifiedAt: Date;
  submittedAt: Date;
};

type ManagedPlatform = {
  id: string;
  name: string;
  displayName: string;
  enabled: boolean;
  apiBase: string;
  endpoint: string;
  authenticationType: "bearer" | "apiKeyHeader" | "queryParam" | "basicAuth";
  apiKey: string;
  apiKeyParam: string;
  apiKeyHeaderName: string;
  basicAuthUser: string;
  requestMethod: "GET" | "POST";
  headers: Record<string, string>;
  queryParameters: Record<string, string>;
  responsePath: string;
  offerMapping: Record<string, string>;
  postbackUrl: string;
  autoImport: boolean;
  importInterval: number;
  rateLimit: number;
  // Status fields (written by import API)
  importStatus?: "success" | "error" | "idle";
  lastImportAt?: string;
  lastImportCount?: number;
  totalOffersFound?: number;
  lastImportDurationMs?: number;
  lastError?: string;
  createdAt: Date;
};

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

  const [newTask, setNewTask] = useState({
    title: "",
    description: "",
    type: "simple" as "simple" | "premium",
    reward: "0.005",
    url: "",
    platform: "",
    taskType: "manual" as "manual" | "platform",
    manualUserSharePercent: "100",
  });
  const [addingTask, setAddingTask] = useState(false);
  const [publishingTaskId, setPublishingTaskId] = useState<string | null>(null);
  const [reviewingCompletionId, setReviewingCompletionId] = useState<string | null>(null);
  const [manualCompletions, setManualCompletions] = useState<ManualTaskCompletion[]>([]);
  const [loadingManualCompletions, setLoadingManualCompletions] = useState(false);
  const [platforms, setPlatforms] = useState<ManagedPlatform[]>([]);
  const [loadingPlatforms, setLoadingPlatforms] = useState(false);
  const [savingPlatformId, setSavingPlatformId] = useState<string | null>(null);
  const [testingPlatformId, setTestingPlatformId] = useState<string | null>(null);
  const [importingPlatformId, setImportingPlatformId] = useState<string | null>(null);
  const [deletingPlatformId, setDeletingPlatformId] = useState<string | null>(null);
  const [showPlatformForm, setShowPlatformForm] = useState(false);
  const [editingPlatformId, setEditingPlatformId] = useState<string | null>(null);
  const emptyPlatformForm = {
    name: "",
    displayName: "",
    enabled: true,
    apiBase: "",
    endpoint: "",
    authenticationType: "queryParam" as ManagedPlatform["authenticationType"],
    apiKey: "",
    apiKeyParam: "api_key",
    apiKeyHeaderName: "X-API-Key",
    basicAuthUser: "",
    requestMethod: "GET" as ManagedPlatform["requestMethod"],
    headersRaw: "",
    queryParamsRaw: "",
    responsePath: "offers",
    offerMappingRaw: "",
    postbackUrl: "",
    autoImport: false,
    importInterval: 30,
    rateLimit: 60,
  };
  const [newPlatform, setNewPlatform] = useState(emptyPlatformForm);

  const [fetchingNetwork, setFetchingNetwork] = useState<string | null>(null);
  const [importedOffersByPlatform, setImportedOffersByPlatform] = useState<Record<string, Record<string, unknown>[]>>({});
  const [selectedImportOffersByPlatform, setSelectedImportOffersByPlatform] = useState<Record<string, Set<number>>>({});
  const [importingOffers, setImportingOffers] = useState(false);

  // ── Locker Config Manager ───────────────────────────────────────────────────
  const [importMode, setImportMode] = useState<"api" | "locker">("api");

  type LockerConfig = {
    id: string;
    name: string;
    type: "content" | "url";
    lockerId: string;
    directUrl: string;
    embedCode: string;
    notes: string;
    active: boolean;
    createdAt?: Timestamp;
  };

  const BLANK_LOCKER_FORM = {
    name: "",
    type: "content" as "content" | "url",
    lockerId: "",
    directUrl: "",
    embedCode: "",
    notes: "",
  };

  const [lockers, setLockers] = useState<LockerConfig[]>([]);
  const [loadingLockers, setLoadingLockers] = useState(false);
  const [showLockerForm, setShowLockerForm] = useState(false);
  const [editingLockerId, setEditingLockerId] = useState<string | null>(null);
  const [lockerForm, setLockerForm] = useState(BLANK_LOCKER_FORM);
  const [savingLocker, setSavingLocker] = useState(false);
  const [deletingLockerId, setDeletingLockerId] = useState<string | null>(null);
  const [copiedLockerId, setCopiedLockerId] = useState<string | null>(null);

  const [conversions, setConversions] = useState<PostbackConversion[]>([]);
  const [conversionLogs, setConversionLogs] = useState<PostbackLog[]>([]);
  const [conversionStats, setConversionStats] = useState<PostbackStats | null>(null);
  const [loadingPostbacks, setLoadingPostbacks] = useState(false);
  const [postbackFilter, setPostbackFilter] = useState<string>("all");
  const [postbackPlatformFilter, setPostbackPlatformFilter] = useState<string>("");

  // Email Ban System
  const [bannedEmails, setBannedEmails] = useState<{ email: string; reason: string; bannedAt: Date; bannedBy: string }[]>([]);
  const [banEmailInput, setBanEmailInput] = useState("");
  const [banEmailReason, setBanEmailReason] = useState("");
  const [banningEmail, setBanningEmail] = useState(false);
  const [loadingBannedEmails, setLoadingBannedEmails] = useState(false);
  const [sysMessages, setSysMessages] = useState<{ id: string; title: string; message: string; createdAt: Date; active: boolean }[]>([]);
  const [archivedMessages, setArchivedMessages] = useState<{ id: string; title: string; message: string; createdAt: Date; active: boolean }[]>([]);
  const [loadingSysMsg, setLoadingSysMsg] = useState(false);
  const [loadingArchivedMsg, setLoadingArchivedMsg] = useState(false);
  const [showArchivedMsg, setShowArchivedMsg] = useState(false);
  const [newSysMsgTitle, setNewSysMsgTitle] = useState("");
  const [newSysMsgBody, setNewSysMsgBody] = useState("");
  const [sendingSysMsg, setSendingSysMsg] = useState(false);

  // Users management
  const [allUsers, setAllUsers] = useState<AdminUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userSearch, setUserSearch] = useState("");

  // Withdrawal settings
  const [usdtEnabled, setUsdtEnabled] = useState(true);
  const [usdcEnabled, setUsdcEnabled] = useState(true);
  const [usdtMin, setUsdtMin] = useState("10");
  const [usdcMin, setUsdcMin] = useState("10");
  const [usdtGas, setUsdtGas] = useState("1.0");
  const [usdcTrc20Gas, setUsdcTrc20Gas] = useState("1.0");
  const [usdcErc20Gas, setUsdcErc20Gas] = useState("5.0");
  const [withdrawalFeePercent, setWithdrawalFeePercent] = useState("5");
  const [withdrawalSchedule, setWithdrawalSchedule] = useState<"instant" | "daily" | "weekly">("instant");
  const [allowDuplicateWallets, setAllowDuplicateWallets] = useState(false);
  const [platformTaskUserSharePercent, setPlatformTaskUserSharePercent] = useState("65");

  // Analytics
  const [analytics, setAnalytics] = useState<{
    totalUsers: number;
    totalWithdrawalsAmount: number;
    totalWithdrawalsCount: number;
    pendingWithdrawalsAmount: number;
    approvedWithdrawalsAmount: number;
    manualTasksApprovedTotal: number;
    platformTasksRevenue: number;
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

  // Data reset
  const [resetting, setResetting] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const [taskSubTab, setTaskSubTab] = useState<"add" | "list" | "reviews" | "platformReviews" | "financial">("list");
  const [debugTaskId, setDebugTaskId] = useState<string | null>(null);
  const [rawJsonExpanded, setRawJsonExpanded] = useState(false);
  const [platformReviews, setPlatformReviews] = useState<PlatformTaskCompletion[]>([]);
  const [loadingPlatformReviews, setLoadingPlatformReviews] = useState(false);
  const [reviewingPlatformCompletionId, setReviewingPlatformCompletionId] = useState<string | null>(null);
  const platformReviewUsersCache = useRef<Map<string, Record<string, unknown>>>(new Map());

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

  // Load lockers whenever the user switches to the Lockers tab
  useEffect(() => {
    if (importMode === "locker") fetchLockers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importMode]);

  useEffect(() => {
    // Wait until auth is fully resolved — prevents redirect when profile is
    // momentarily null during onAuthStateChanged re-initialization after login.
    if (authLoading || !profile) return;
    if (profile.role !== "admin") { setLocation("/dashboard"); return; }
    fetchAllWithdrawals();
    fetchAdminAlerts();
    getSettings().then((s) => {
      setWithdrawalInstructionText(s.withdrawalInstructionText || "");
      setNetworkKeys(s.networkKeys || {});
      setPostbackSecret(s.networkKeys?.postbackSecret || "");
      setUsdtEnabled(s.usdtEnabled !== false);
      setUsdcEnabled(s.usdcEnabled !== false);
      setUsdtMin(String(s.usdtMin ?? 10));
      setUsdcMin(String(s.usdcMin ?? 10));
      setUsdtGas(String(s.usdtGas ?? 1.0));
      setUsdcTrc20Gas(String(s.usdcTrc20Gas ?? 1.0));
      setUsdcErc20Gas(String(s.usdcErc20Gas ?? 5.0));
      setWithdrawalFeePercent(String(s.withdrawalFeePercent ?? 5));
      setWithdrawalSchedule(s.withdrawalSchedule ?? "instant");
      setAllowDuplicateWallets(s.allowDuplicateWallets ?? false);
      setPlatformTaskUserSharePercent(String(s.platformTaskUserSharePercent ?? 65));
    });

    (async () => {
      // load raw settings doc for dashboard warning
      try {
        const snap = await getDoc(doc(db, "settings", "general"));
        if (snap.exists()) {
          const d = snap.data() as { dashboardWarningEnabled?: boolean; dashboardWarningMessage?: string };
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
          const data = ud.data() as { registeredAt?: Timestamp | string; lastActive?: Timestamp | string; lastLogin?: Timestamp | string };
          const registeredAt = data.registeredAt instanceof Timestamp ? data.registeredAt.toDate() : data.registeredAt ? new Date(data.registeredAt) : null;
          const lastActiveRaw = data.lastActive ?? data.lastLogin;
          const lastActive = lastActiveRaw instanceof Timestamp ? lastActiveRaw.toDate() : lastActiveRaw ? new Date(lastActiveRaw) : null;
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

  // Real-time: tasks
  useEffect(() => {
    if (!profile || profile.role !== "admin") return;
    setTasksLoading(true);
    const unsub = onSnapshot(collection(db, "tasks"), (snap) => {
      const fetched: Task[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Task, "id" | "createdAt">),
        networkStatus: (d.data().networkStatus as Task["networkStatus"]) || "pending",
        createdAt: (d.data().createdAt as Timestamp)?.toDate() || new Date(),
      }));
      fetched.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setTasks(fetched);
      setTasksLoading(false);
    });
    return () => unsub();
  }, [profile?.role]);

  // Real-time: platforms
  useEffect(() => {
    if (!profile || profile.role !== "admin") return;
    setLoadingPlatforms(true);
    const unsub = onSnapshot(collection(db, "platforms"), (snap) => {
      const fetched: ManagedPlatform[] = snap.docs.map((d) => {
        const data = d.data();
        const sv = (k: string) => String(data[k] || "");
        const nv = (k: string, def = 0) => Number(data[k] || def);
        const bv = (k: string, def = true) => data[k] !== false && data[k] !== undefined ? (data[k] === false ? false : def) : def;
        let resolvedApiBase  = sv("apiBase");
        let resolvedEndpoint = sv("endpoint");
        let resolvedAuthType = sv("authenticationType") || "queryParam";
        let resolvedApiKey   = sv("apiKey") || sv("adgemApiKey") || sv("lootablyApiKey") || sv("cpabuildApiKey") || sv("monetizerApiKey") || sv("cpagripApiKey");
        let resolvedQueryParams: Record<string, string> = (data.queryParameters as Record<string, string>) || {};
        let resolvedResponsePath = sv("responsePath") || "offers";
        if (!resolvedApiBase) {
          const adgemKey   = sv("adgemApiKey");
          const adgemAppId = sv("adgemAppId");
          if (adgemKey && adgemAppId) {
            resolvedApiBase   = "https://api.adgem.com/v1";
            resolvedEndpoint  = "/offers";
            resolvedAuthType  = "bearer";
            resolvedResponsePath = "offers";
            resolvedQueryParams  = { ...resolvedQueryParams, app_id: adgemAppId };
          }
          const lootablyKey = sv("lootablyApiKey");
          if (!resolvedApiBase && lootablyKey) {
            resolvedApiBase  = "https://lootably.com/api";
            resolvedEndpoint = "/placements/poll";
            resolvedAuthType = "apiKeyHeader";
            resolvedResponsePath = "offers";
          }
        }
        // ── OGAds fix: API v2 base URL IS the endpoint — no sub-path exists.
        // /offers, /feed, and all other sub-paths return 404.
        // Also enforce Bearer auth — OGAds requires Authorization: Bearer <token>,
        // not a query-param api_key. Correct both stale values from Firestore.
        const _isOGAds = sv("name").toLowerCase() === "ogads" || resolvedApiBase.includes("saveapp.store");
        if (_isOGAds) {
          resolvedEndpoint = "";
          resolvedAuthType = "bearer";
          // Replace any un-substituted template placeholders with safe defaults.
          // OGAds rejects requests where ip is literally "{ip}".
          const qp = { ...resolvedQueryParams };
          if (!qp.ip || qp.ip.startsWith("{"))
            qp.ip = "8.8.8.8";
          if (!qp.user_agent || qp.user_agent.startsWith("{"))
            qp.user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
          resolvedQueryParams = qp;
        }
        return {
          id: d.id,
          name: sv("name"),
          displayName: sv("displayName") || sv("name"),
          enabled: data.enabled !== false,
          apiBase: resolvedApiBase,
          endpoint: resolvedEndpoint,
          authenticationType: resolvedAuthType as ManagedPlatform["authenticationType"],
          apiKey: resolvedApiKey,
          apiKeyParam: sv("apiKeyParam") || "api_key",
          apiKeyHeaderName: sv("apiKeyHeaderName") || "X-API-Key",
          basicAuthUser: sv("basicAuthUser"),
          requestMethod: (sv("requestMethod") || "GET") as ManagedPlatform["requestMethod"],
          headers: (data.headers as Record<string, string>) || {},
          queryParameters: resolvedQueryParams,
          responsePath: resolvedResponsePath,
          offerMapping: (data.offerMapping as Record<string, string>) || {},
          postbackUrl: sv("postbackUrl"),
          autoImport: bv("autoImport", false),
          importInterval: nv("importInterval", 30),
          rateLimit: nv("rateLimit", 60),
          importStatus: data.importStatus as ManagedPlatform["importStatus"],
          lastImportAt: sv("lastImportAt") || undefined,
          lastImportCount: data.lastImportCount !== undefined ? Number(data.lastImportCount) : undefined,
          totalOffersFound: data.totalOffersFound !== undefined ? Number(data.totalOffersFound) : undefined,
          lastImportDurationMs: data.lastImportDurationMs !== undefined ? Number(data.lastImportDurationMs) : undefined,
          lastError: sv("lastError") || undefined,
          createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
        };
      });
      fetched.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setPlatforms(fetched);
      setLoadingPlatforms(false);
    });
    return () => unsub();
  }, [profile?.role]);

  // Real-time: platform task reviews (platform_approved → awaiting admin decision)
  useEffect(() => {
    if (!profile || profile.role !== "admin") return;
    setLoadingPlatformReviews(true);
    const cache = platformReviewUsersCache.current;

    const q = query(collection(db, "taskCompletions"), where("status", "==", "platform_approved"));
    const unsub = onSnapshot(q, async (snap) => {
      const missingUserIds = [...new Set(snap.docs.map((d) => String(d.data().userId || "")))]
        .filter((id) => id && !cache.has(id));

      if (missingUserIds.length > 0) {
        await Promise.all(
          missingUserIds.map(async (id) => {
            const ud = await getDoc(doc(db, "users", id));
            if (ud.exists()) cache.set(id, ud.data() as Record<string, unknown>);
          })
        );
      }

      const fetched: PlatformTaskCompletion[] = snap.docs.map((d) => {
        const raw = d.data() as Record<string, unknown>;
        const userData = cache.get(String(raw.userId || "")) || {};
        return {
          id: d.id,
          taskId: String(raw.taskId || ""),
          taskTitle: String(raw.taskTitle || "Untitled Task"),
          userId: String(raw.userId || ""),
          userName: String(raw.userName || userData.name || "Unknown"),
          userEmail: String(raw.userEmail || userData.email || ""),
          reward: Number(raw.reward || 0),
          platformName: String(raw.taskPlatform || raw.platformName || "Unknown Platform"),
          verifiedBy: String(raw.verifiedBy || ""),
          platformVerifiedAt: (raw.platformVerifiedAt as Timestamp)?.toDate() || new Date(),
          submittedAt: (raw.completedAt as Timestamp)?.toDate() || new Date(),
        };
      });
      fetched.sort((a, b) => b.platformVerifiedAt.getTime() - a.platformVerifiedAt.getTime());
      setPlatformReviews(fetched);
      setLoadingPlatformReviews(false);
    });

    return () => unsub();
  }, [profile?.role]);

  // Real-time: manual task completions
  useEffect(() => {
    if (!profile || profile.role !== "admin") return;
    setLoadingManualCompletions(true);
    const tasksCache = new Map<string, Record<string, unknown>>();
    const usersCache = new Map<string, Record<string, unknown>>();

    const unsubCompletions = onSnapshot(collection(db, "taskCompletions"), async (snap) => {
      const newTaskIds = new Set<string>();
      const newUserIds = new Set<string>();
      snap.docs.forEach((d) => {
        const raw = d.data() as Record<string, unknown>;
        if (raw.taskId) newTaskIds.add(String(raw.taskId));
        if (raw.userId) newUserIds.add(String(raw.userId));
      });

      const missingTasks = [...newTaskIds].filter((id) => !tasksCache.has(id));
      const missingUsers = [...newUserIds].filter((id) => !usersCache.has(id));
      await Promise.all([
        ...missingTasks.map(async (id) => {
          const d = await getDoc(doc(db, "tasks", id));
          if (d.exists()) tasksCache.set(id, d.data() as Record<string, unknown>);
        }),
        ...missingUsers.map(async (id) => {
          const d = await getDoc(doc(db, "users", id));
          if (d.exists()) usersCache.set(id, d.data() as Record<string, unknown>);
        }),
      ]);

      const fetched: ManualTaskCompletion[] = snap.docs
        .filter((d) => {
          const raw = d.data() as Record<string, unknown>;
          const taskData = tasksCache.get(String(raw.taskId || ""));
          return isManualCompletion(raw, taskData);
        })
        .map((d) => {
          const raw = d.data() as Record<string, unknown>;
          const userData = usersCache.get(String(raw.userId || ""));
          const taskData = tasksCache.get(String(raw.taskId || ""));
          const shareFromTask =
            typeof taskData?.manualUserSharePercent === "number"
              ? (taskData.manualUserSharePercent as number)
              : typeof raw.manualUserSharePercent === "number"
              ? (raw.manualUserSharePercent as number)
              : 100;
          return {
            id: d.id,
            taskId: String(raw.taskId || ""),
            taskTitle: String(raw.taskTitle || taskData?.title || "Untitled Task"),
            taskDescription: String(raw.taskDescription || taskData?.description || ""),
            userId: String(raw.userId || ""),
            userName: String(raw.userName || userData?.name || "Unknown"),
            userEmail: String(raw.userEmail || userData?.email || ""),
            reward: Number(raw.reward || 0),
            adminReward: Number(raw.adminReward ?? raw.reward ?? 0),
            manualUserSharePercent: shareFromTask,
            status: (raw.status as ManualTaskCompletion["status"]) || "pending",
            submittedAt: (raw.completedAt as Timestamp)?.toDate() || new Date(),
          };
        });

      fetched.sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
      setManualCompletions(fetched);
      setLoadingManualCompletions(false);
    });

    return () => unsubCompletions();
  }, [profile?.role]);

  async function fetchManualCompletions() {
    setLoadingManualCompletions(true);
    try {
      const [allCompletionsSnap, usersSnap, tasksSnap] = await Promise.all([
        getDocs(collection(db, "taskCompletions")),
        getDocs(collection(db, "users")),
        getDocs(collection(db, "tasks")),
      ]);

      const usersById = new Map(usersSnap.docs.map((d) => [d.id, d.data() as Record<string, unknown>]));
      const tasksById = new Map(tasksSnap.docs.map((d) => [d.id, d.data() as Record<string, unknown>]));

      const fetched: ManualTaskCompletion[] = allCompletionsSnap.docs
        .filter((d) => {
          const raw = d.data() as Record<string, unknown>;
          const taskData = tasksById.get(String(raw.taskId || ""));
          return isManualCompletion(raw, taskData);
        })
        .map((d) => {
          const raw = d.data() as Record<string, unknown>;
          const userData = usersById.get(String(raw.userId || ""));
          const taskData = tasksById.get(String(raw.taskId || ""));
          const shareFromTask = typeof taskData?.manualUserSharePercent === "number"
            ? (taskData.manualUserSharePercent as number)
            : typeof raw.manualUserSharePercent === "number"
              ? (raw.manualUserSharePercent as number)
              : 100;
          return {
            id: d.id,
            taskId: String(raw.taskId || ""),
            taskTitle: String(raw.taskTitle || taskData?.title || "Untitled Task"),
            taskDescription: String(raw.taskDescription || taskData?.description || ""),
            userId: String(raw.userId || ""),
            userName: String(raw.userName || userData?.name || "Unknown"),
            userEmail: String(raw.userEmail || userData?.email || ""),
            reward: Number(raw.reward || 0),
            adminReward: Number(raw.adminReward ?? raw.reward ?? 0),
            manualUserSharePercent: shareFromTask,
            status: (raw.status as ManualTaskCompletion["status"]) || "pending",
            submittedAt: (raw.completedAt as Timestamp)?.toDate() || new Date(),
          };
        });

      fetched.sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
      setManualCompletions(fetched);
    } finally {
      setLoadingManualCompletions(false);
    }
  }

  async function fetchPlatforms() {
    setLoadingPlatforms(true);
    try {
      const snap = await getDocs(collection(db, "platforms"));
      const fetched: ManagedPlatform[] = snap.docs.map((d) => {
        const data = d.data();
        const sv = (k: string) => String(data[k] || "");
        const nv = (k: string, def = 0) => Number(data[k] || def);
        const bv = (k: string, def = true) => data[k] !== false && data[k] !== undefined ? (data[k] === false ? false : def) : def;
        // ── Legacy field resolution ──────────────────────────────────────────
        // Platforms created before the generic API config system used per-network
        // field names (adgemApiKey, adgemAppId, lootablyApiKey, etc.).
        // Auto-populate the generic fields so the import handler works immediately.
        let resolvedApiBase  = sv("apiBase");
        let resolvedEndpoint = sv("endpoint");
        let resolvedAuthType = sv("authenticationType") || "queryParam";
        let resolvedApiKey   = sv("apiKey") || sv("adgemApiKey") || sv("lootablyApiKey") || sv("cpabuildApiKey") || sv("monetizerApiKey") || sv("cpagripApiKey");
        let resolvedQueryParams: Record<string, string> = (data.queryParameters as Record<string, string>) || {};
        let resolvedResponsePath = sv("responsePath") || "offers";

        if (!resolvedApiBase) {
          const adgemKey   = sv("adgemApiKey");
          const adgemAppId = sv("adgemAppId");
          if (adgemKey && adgemAppId) {
            resolvedApiBase   = "https://api.adgem.com/v1";
            resolvedEndpoint  = "/offers";
            resolvedAuthType  = "bearer";
            resolvedResponsePath = "offers";
            resolvedQueryParams  = { ...resolvedQueryParams, app_id: adgemAppId };
          }

          const lootablyKey = sv("lootablyApiKey");
          if (!resolvedApiBase && lootablyKey) {
            resolvedApiBase  = "https://lootably.com/api";
            resolvedEndpoint = "/placements/poll";
            resolvedAuthType = "apiKeyHeader";
            resolvedResponsePath = "offers";
          }
        }
        // ── OGAds fix: API v2 base URL IS the endpoint — no sub-path exists.
        // /offers, /feed, and all other sub-paths return 404.
        // Correct any stale stored endpoint (e.g. "/offers") back to "".
        // Also enforce Bearer auth — OGAds requires Authorization: Bearer <token>.
        const _isOGAds2 = sv("name").toLowerCase() === "ogads" || resolvedApiBase.includes("saveapp.store");
        if (_isOGAds2) {
          resolvedEndpoint = "";
          resolvedAuthType = "bearer";
          // Replace any un-substituted template placeholders with safe defaults.
          const qp2 = { ...resolvedQueryParams };
          if (!qp2.ip || qp2.ip.startsWith("{"))
            qp2.ip = "8.8.8.8";
          if (!qp2.user_agent || qp2.user_agent.startsWith("{"))
            qp2.user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
          resolvedQueryParams = qp2;
        }
        // ─────────────────────────────────────────────────────────────────────

        return {
          id: d.id,
          name: sv("name"),
          displayName: sv("displayName") || sv("name"),
          enabled: data.enabled !== false,
          apiBase: resolvedApiBase,
          endpoint: resolvedEndpoint,
          authenticationType: resolvedAuthType as ManagedPlatform["authenticationType"],
          apiKey: resolvedApiKey,
          apiKeyParam: sv("apiKeyParam") || "api_key",
          apiKeyHeaderName: sv("apiKeyHeaderName") || "X-API-Key",
          basicAuthUser: sv("basicAuthUser"),
          requestMethod: (sv("requestMethod") || "GET") as ManagedPlatform["requestMethod"],
          headers: (data.headers as Record<string, string>) || {},
          queryParameters: resolvedQueryParams,
          responsePath: resolvedResponsePath,
          offerMapping: (data.offerMapping as Record<string, string>) || {},
          postbackUrl: sv("postbackUrl"),
          autoImport: bv("autoImport", false),
          importInterval: nv("importInterval", 30),
          rateLimit: nv("rateLimit", 60),
          importStatus: data.importStatus as ManagedPlatform["importStatus"],
          lastImportAt: sv("lastImportAt") || undefined,
          lastImportCount: data.lastImportCount !== undefined ? Number(data.lastImportCount) : undefined,
          totalOffersFound: data.totalOffersFound !== undefined ? Number(data.totalOffersFound) : undefined,
          lastImportDurationMs: data.lastImportDurationMs !== undefined ? Number(data.lastImportDurationMs) : undefined,
          lastError: sv("lastError") || undefined,
          createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
        };
      });
      fetched.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setPlatforms(fetched);
    } finally {
      setLoadingPlatforms(false);
    }
  }

  function parsePlatformForm(form: typeof emptyPlatformForm) {
    const parseKV = (raw: string): Record<string, string> => {
      const result: Record<string, string> = {};
      for (const line of raw.split("\n")) {
        const colonIdx = line.indexOf(":");
        if (colonIdx < 1) continue;
        const k = line.slice(0, colonIdx).trim();
        const v = line.slice(colonIdx + 1).trim();
        if (k) result[k] = v;
      }
      return result;
    };
    return {
      name: form.name.trim(),
      displayName: form.displayName.trim() || form.name.trim(),
      enabled: form.enabled,
      apiBase: form.apiBase.trim(),
      endpoint: form.endpoint.trim(),
      authenticationType: form.authenticationType,
      apiKey: form.apiKey.trim(),
      apiKeyParam: form.apiKeyParam.trim() || "api_key",
      apiKeyHeaderName: form.apiKeyHeaderName.trim() || "X-API-Key",
      basicAuthUser: form.basicAuthUser.trim(),
      requestMethod: form.requestMethod,
      headers: parseKV(form.headersRaw),
      queryParameters: parseKV(form.queryParamsRaw),
      responsePath: form.responsePath.trim() || "offers",
      offerMapping: parseKV(form.offerMappingRaw),
      postbackUrl: form.postbackUrl.trim(),
      autoImport: form.autoImport,
      importInterval: Number(form.importInterval) || 30,
      rateLimit: Number(form.rateLimit) || 60,
    };
  }

  // Auto-import: run on mount and every 30 minutes using dynamic platforms from Firestore
  useEffect(() => {
    if (authLoading || !profile) return;
    if (profile.role !== "admin") return;
    runAutoImport();
    const interval = setInterval(() => runAutoImport(), 30 * 60 * 1000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, authLoading]);

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
          registeredAt: (data.registeredAt as Timestamp)?.toDate() || new Date(),
        };
      });
      list.sort((a, b) => b.registeredAt.getTime() - a.registeredAt.getTime());
      setAllUsers(list);
    } finally {
      setLoadingUsers(false);
    }
  }

  async function fetchBannedEmails() {
    setLoadingBannedEmails(true);
    try {
      const snap = await getDocs(collection(db, "banned_emails"));
      const list = snap.docs.map((d) => ({
        email: d.id,
        reason: d.data().reason || "",
        bannedAt: (d.data().bannedAt as Timestamp)?.toDate() || new Date(),
        bannedBy: d.data().bannedBy || "",
      }));
      list.sort((a, b) => b.bannedAt.getTime() - a.bannedAt.getTime());
      setBannedEmails(list);
    } finally {
      setLoadingBannedEmails(false);
    }
  }

  async function banEmailAddress() {
    const email = banEmailInput.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      toast({ title: "Error", description: "Enter a valid email address", variant: "destructive" });
      return;
    }
    setBanningEmail(true);
    const reason = banEmailReason.trim() || "Banned by admin";
    try {
      // 1. Write to banned_emails collection (checked by Login/Register and AuthContext)
      await setDoc(doc(db, "banned_emails", email), {
        email,
        reason,
        bannedAt: serverTimestamp(),
        bannedBy: profile?.email || "admin",
      });

      // 2. Also stamp isBanned + banReason on the user doc (GATE 1 — fastest check on session restore)
      try {
        const usersSnap = await getDocs(collection(db, "users"));
        const matchingUser = usersSnap.docs.find(
          (d) => (d.data().email as string)?.toLowerCase() === email
        );
        if (matchingUser) {
          await updateDoc(doc(db, "users", matchingUser.id), {
            isBanned: true,
            banReason: reason,
          });
        }
      } catch (userUpdateErr) {
        console.warn("[Admin] Could not stamp user doc with isBanned:", userUpdateErr);
      }

      await fetchBannedEmails();
      setBanEmailInput("");
      setBanEmailReason("");
      toast({ title: `✅ ${email} permanently banned` });
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    } finally {
      setBanningEmail(false);
    }
  }

  async function unbanEmailAddress(email: string) {
    await deleteDoc(doc(db, "banned_emails", email));
    // Also clear isBanned on the user doc so GATE 1 doesn't block them on session restore
    try {
      const usersSnap = await getDocs(collection(db, "users"));
      const matchingUser = usersSnap.docs.find(
        (d) => (d.data().email as string)?.toLowerCase() === email.toLowerCase()
      );
      if (matchingUser) {
        await updateDoc(doc(db, "users", matchingUser.id), {
          isBanned: false,
          banReason: "",
        });
      }
    } catch (err) {
      console.warn("[Admin] Could not clear isBanned on user doc:", err);
    }
    await fetchBannedEmails();
    toast({ title: `✅ ${email} unbanned` });
  }

  async function fetchSysMessages() {
    setLoadingSysMsg(true);
    try {
      const snap = await getDocs(query(collection(db, "systemMessages"), where("active", "==", true)));
      const msgs = snap.docs.map((d) => ({
        id: d.id,
        title: d.data().title as string,
        message: d.data().message as string,
        createdAt: (d.data().createdAt as Timestamp)?.toDate() || new Date(),
        active: d.data().active as boolean,
      }));
      msgs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setSysMessages(msgs);
    } finally {
      setLoadingSysMsg(false);
    }
  }

  async function sendSystemMessage() {
    if (!newSysMsgTitle.trim() || !newSysMsgBody.trim()) {
      toast({ title: "Missing fields", description: "Title and message are required", variant: "destructive" });
      return;
    }
    setSendingSysMsg(true);
    const sentTitle = newSysMsgTitle.trim();
    const sentBody = newSysMsgBody.trim();
    try {
      const res = await fetch("/api/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: sentTitle,
          message: sentBody,
          sentBy: profile?.email || "admin",
        }),
      });
      const data = await res.json() as { ok?: boolean; msgId?: string; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to send broadcast");
      setNewSysMsgTitle("");
      setNewSysMsgBody("");
      toast({
        title: "📢 Message broadcast!",
        description: "Broadcast sent successfully.",
      });
      // Optimistically prepend the new message to the local list — avoids
      // calling fetchSysMessages() which triggers setLoadingSysMsg(true/false)
      // and causes a visible loading flash on the admin page.
      setSysMessages(prev => [{
        id: data.msgId ?? Date.now().toString(),
        title: sentTitle,
        message: sentBody,
        createdAt: new Date(),
        active: true,
      }, ...prev]);
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to send message", variant: "destructive" });
    } finally {
      setSendingSysMsg(false);
    }
  }

  async function archiveSysMessage(id: string) {
    await updateDoc(doc(db, "systemMessages", id), { active: false });
    await fetchSysMessages();
    // Refresh archive list if currently visible
    if (showArchivedMsg) await fetchArchivedMessages();
    toast({ title: "Message archived" });
  }

  async function fetchArchivedMessages() {
    setLoadingArchivedMsg(true);
    try {
      const snap = await getDocs(query(collection(db, "systemMessages"), where("active", "==", false)));
      const msgs = snap.docs.map((d) => ({
        id: d.id,
        title: d.data().title as string,
        message: d.data().message as string,
        createdAt: (d.data().createdAt as Timestamp)?.toDate() || new Date(),
        active: false,
      }));
      msgs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setArchivedMessages(msgs);
    } finally {
      setLoadingArchivedMsg(false);
    }
  }

  async function reactivateSysMessage(id: string) {
    await updateDoc(doc(db, "systemMessages", id), { active: true });
    await Promise.all([fetchSysMessages(), fetchArchivedMessages()]);
    toast({ title: "Message reactivated", description: "Message is now live again." });
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

  async function fetchConversions(statusFilter = postbackFilter, platformFilter = postbackPlatformFilter) {
    setLoadingPostbacks(true);
    try {
      const secret = postbackSecret || networkKeys.postbackSecret || "";
      const params = new URLSearchParams({ secret });
      if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
      if (platformFilter) params.set("platform", platformFilter);
      params.set("limit", "100");
      const res = await fetch(`/api/postbacks-admin?${params}`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json() as {
        conversions: PostbackConversion[];
        logs: PostbackLog[];
        stats: PostbackStats;
      };
      setConversions(data.conversions || []);
      setConversionLogs(data.logs || []);
      setConversionStats(data.stats || null);
    } catch (e) {
      toast({ title: "Error loading conversions", description: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    } finally {
      setLoadingPostbacks(false);
    }
  }

  // Keep as alias for legacy tab-switch wiring
  const fetchPostbacks = fetchConversions;

  // Get the current admin's Firebase ID token so server-side handlers can make
  // authenticated Firestore REST calls (respecting isSignedIn / isAdmin rules).
  async function getAdminIdToken(): Promise<string> {
    console.log("[DIAG][1] getAdminIdToken called. auth.currentUser=", auth.currentUser?.uid ?? "null");
    try {
      const token = (await auth.currentUser?.getIdToken()) ?? "";
      console.log("[DIAG][1] getIdToken result: length=", token.length, "first40=", token.slice(0, 40));
      return token;
    } catch (e) {
      console.error("[DIAG][1] getIdToken FAILED:", e);
      return "";
    }
  }

  function buildPlatformConfig(p: ManagedPlatform) {
    return {
      enabled: p.enabled,
      apiBase: p.apiBase,
      endpoint: p.endpoint,
      apiKey: p.apiKey,
      authenticationType: p.authenticationType,
      apiKeyParam: p.apiKeyParam,
      apiKeyHeaderName: p.apiKeyHeaderName,
      basicAuthUser: p.basicAuthUser,
      requestMethod: p.requestMethod,
      headers: p.headers,
      queryParameters: p.queryParameters,
      responsePath: p.responsePath,
      offerMapping: p.offerMapping,
      displayName: p.displayName,
    };
  }

  async function fetchOffersFromNetwork(platformId: string) {
    setFetchingNetwork(platformId);
    setImportedOffersByPlatform((prev) => ({ ...prev, [platformId]: [] }));
    setSelectedImportOffersByPlatform((prev) => ({ ...prev, [platformId]: new Set() }));
    try {
      const platform = platforms.find((p) => p.id === platformId);
      if (!platform) throw new Error("Platform not found — please refresh the page.");
      const r = await fetch("/api/import-platform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platformName: platformId,
          platformConfig: buildPlatformConfig(platform),
        }),
      });
      const d = await r.json() as { success?: boolean; offers?: Record<string, unknown>[]; error?: string };
      if (!d.success) throw new Error(d.error || "No offers returned");
      const offers = d.offers || [];
      if (offers.length === 0) throw new Error("No offers returned. Check platform configuration.");
      setImportedOffersByPlatform((prev) => ({ ...prev, [platformId]: offers }));
      toast({ title: `✅ Found ${offers.length} offers` });
      await fetchPlatforms();
    } catch (e: unknown) {
      toast({ title: "Fetch Failed", description: e instanceof Error ? e.message : "Network error", variant: "destructive" });
    } finally {
      setFetchingNetwork(null);
    }
  }

  async function importSelectedOffers(platformId: string) {
    const selected = selectedImportOffersByPlatform[platformId] ?? new Set<number>();
    const offers   = importedOffersByPlatform[platformId] ?? [];
    if (selected.size === 0) {
      toast({ title: "None selected", description: "Select at least one offer to import", variant: "destructive" });
      return;
    }
    setImportingOffers(true);
    const platform = platforms.find((p) => p.id === platformId);
    const platformName = platform?.displayName || platformId;
    try {
      let imported = 0;
      const writes = Array.from(selected).map(async (idx) => {
        const offer = offers[idx];
        if (!offer) return;
        // Use normalised fields the API already resolved; fall back to raw variants only if needed
        const title       = String(offer.title       || offer.name        || offer.offer_name  || "Untitled Offer");
        const payout      = parseFloat(String(offer.payout      || offer.reward       || offer.amount      || "0.005"));
        const url         = String(offer.url         || offer.link        || offer.offer_url   || "");
        const description = String(offer.description || offer.requirements || "");
        const offerId     = String(offer.externalId  || offer.id          || offer.offer_id    || "");
        // Additional normalised fields — captured from platform but previously discarded
        const trackingUrl    = String(offer.trackingUrl    || offer.tracking_url    || "");
        const previewUrl     = String(offer.previewUrl     || offer.preview_url     || "");
        const image          = String(offer.image          || offer.icon            || offer.thumbnail || "");
        const category       = String(offer.category       || offer.vertical        || "");
        const conversionType = String(offer.conversionType || offer.conversion_type || "");
        const requirements   = String(offer.requirements   || "");
        const countries      = Array.isArray(offer.countries)
          ? offer.countries
          : offer.countries ? String(offer.countries).split(/[,;|]/).map((s: string) => s.trim()).filter(Boolean) : [];
        const devices        = Array.isArray(offer.devices)
          ? offer.devices
          : offer.devices   ? String(offer.devices).split(/[,;|]/).map((s: string) => s.trim()).filter(Boolean)   : [];
        // PART 1 — store the complete raw platform response (normalizer attaches _raw = original offer object)
        const rawPlatformResponse = JSON.stringify(offer._raw ?? offer);
        await addDoc(collection(db, "tasks"), {
          title, description, url,
          platform: platformName,
          // Store the registry id (e.g. "ogads", "cpagrip") so buildTrackingUrl can
          // look up the correct tracking strategy.  The Firestore document id is
          // preserved separately in importedFrom for any back-reference.
          platformId: platform?.name?.toLowerCase() || platformId,
          payout,
          reward: payout,
          type: payout >= 0.05 ? "premium" : "simple",
          taskType: "platform",
          status: "published",
          manualAdminRate: 0.35,
          active: true,
          networkStatus: "pending",
          importedFrom: platformId,
          offerId,
          externalId: offerId,
          // Additional fields
          trackingUrl,
          previewUrl,
          image,
          category,
          conversionType,
          requirements,
          countries,
          devices,
          // Full raw response — no truncation
          rawPlatformResponse,
          createdAt: serverTimestamp(),
        });
        imported++;
      });
      await Promise.all(writes);
      await fetchTasks();
      setImportedOffersByPlatform((prev) => ({ ...prev, [platformId]: [] }));
      setSelectedImportOffersByPlatform((prev) => ({ ...prev, [platformId]: new Set() }));
      toast({ title: `✅ Imported ${imported} tasks`, description: "Imported as platform tasks." });
    } finally {
      setImportingOffers(false);
    }
  }

  // ── Locker Config Manager: load ────────────────────────────────────────────
  async function fetchLockers() {
    setLoadingLockers(true);
    try {
      const snap = await getDocs(collection(db, "lockers"));
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as LockerConfig));
      list.sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() ?? 0;
        const tb = b.createdAt?.toMillis?.() ?? 0;
        return tb - ta;
      });
      setLockers(list);
    } catch (e) {
      toast({ title: "Failed to load lockers", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setLoadingLockers(false);
    }
  }

  // ── Locker Config Manager: save (add or update) ─────────────────────────────
  async function saveLocker() {
    if (!lockerForm.name.trim()) {
      toast({ title: "Name required", description: "Give this locker a display name.", variant: "destructive" });
      return;
    }
    if (!lockerForm.directUrl.trim() && !lockerForm.lockerId.trim()) {
      toast({ title: "URL or ID required", description: "Enter at least a Direct URL or Locker ID.", variant: "destructive" });
      return;
    }
    setSavingLocker(true);
    try {
      const payload = {
        name:      lockerForm.name.trim(),
        type:      lockerForm.type,
        lockerId:  lockerForm.lockerId.trim(),
        directUrl: lockerForm.directUrl.trim(),
        embedCode: lockerForm.embedCode.trim(),
        notes:     lockerForm.notes.trim(),
        active:    true,
      };
      if (editingLockerId) {
        await updateDoc(doc(db, "lockers", editingLockerId), payload);
        toast({ title: "✅ Locker updated" });
      } else {
        await addDoc(collection(db, "lockers"), { ...payload, createdAt: serverTimestamp() });
        toast({ title: "✅ Locker added" });
      }
      setShowLockerForm(false);
      setEditingLockerId(null);
      setLockerForm(BLANK_LOCKER_FORM);
      await fetchLockers();
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setSavingLocker(false);
    }
  }

  // ── Locker Config Manager: delete ───────────────────────────────────────────
  async function deleteLocker(id: string) {
    setDeletingLockerId(id);
    try {
      await deleteDoc(doc(db, "lockers", id));
      toast({ title: "Locker deleted" });
      await fetchLockers();
    } catch (e) {
      toast({ title: "Delete failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setDeletingLockerId(null);
    }
  }

  // ── Locker Config Manager: toggle active ────────────────────────────────────
  async function toggleLockerActive(lk: LockerConfig) {
    try {
      await updateDoc(doc(db, "lockers", lk.id), { active: !lk.active });
      await fetchLockers();
    } catch (e) {
      toast({ title: "Update failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    }
  }

  // ── Locker Config Manager: copy URL ─────────────────────────────────────────
  function copyLockerUrl(lk: LockerConfig) {
    const text = lk.directUrl || lk.lockerId;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedLockerId(lk.id);
      setTimeout(() => setCopiedLockerId(null), 1800);
    });
  }

  async function handleAddTask() {
    if (!newTask.title || !newTask.url || !newTask.platform) {
      toast({ title: "Error", description: "Please fill all required fields", variant: "destructive" });
      return;
    }
    setAddingTask(true);
    try {
      const parsedUserShare = Math.max(0, Math.min(100, parseFloat(newTask.manualUserSharePercent) || 100));
      await addDoc(collection(db, "tasks"), {
        title: newTask.title,
        description: newTask.description,
        type: newTask.type,
        reward: parseFloat(newTask.reward) || 0,
        url: newTask.url,
        platform: newTask.platform,
        taskType: "manual",
        manualUserSharePercent: parsedUserShare,
        manualAdminRate: 1 - parsedUserShare / 100,
        status: "draft",
        active: true,
        networkStatus: "approved",
        createdAt: serverTimestamp(),
      });
      setNewTask({
        title: "",
        description: "",
        type: "simple",
        reward: "0.005",
        url: "",
        platform: "",
        taskType: "manual",
        manualUserSharePercent: "100",
      });
      await fetchTasks();
      toast({ title: "✅ Task created as draft", description: "Use Confirm Publish when ready." });
    } finally { setAddingTask(false); }
  }

  async function handleConfirmPublishTask(id: string) {
    setPublishingTaskId(id);
    try {
      await updateDoc(doc(db, "tasks", id), {
        status: "published",
        publishedAt: serverTimestamp(),
      });
      await fetchTasks();
      toast({ title: "✅ Task published" });
    } finally {
      setPublishingTaskId(null);
    }
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
        usdtMin: parseFloat(usdtMin) || 0,
        usdcMin: parseFloat(usdcMin) || 0,
        usdtGas: parseFloat(usdtGas) || 0,
        usdcTrc20Gas: parseFloat(usdcTrc20Gas) || 0,
        usdcErc20Gas: parseFloat(usdcErc20Gas) || 0,
        withdrawalFeePercent: parseFloat(withdrawalFeePercent) || 0,
        withdrawalSchedule,
        allowDuplicateWallets,
        platformTaskUserSharePercent: Math.max(0, Math.min(100, parseFloat(platformTaskUserSharePercent) || 65)),
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

      const settings = await getSettings();
      const platformUserShare = settings.platformTaskUserSharePercent ?? 65;

      const [completionsSnap, tasksSnap] = await Promise.all([
        getDocs(collection(db, "taskCompletions")),
        getDocs(collection(db, "tasks")),
      ]);
      const tasksById = new Map(tasksSnap.docs.map((d) => [d.id, d.data() as Record<string, unknown>]));

      let manualTasksSiteProfit = 0;
      let platformTasksRevenue = 0;
      completionsSnap.docs.forEach((d) => {
        if (d.data().status !== "approved") return;

        const raw = d.data() as Record<string, unknown>;
        const taskData = tasksById.get(String(raw.taskId || ""));
        const isManual = isManualCompletion(raw, taskData);

        if (isManual) {
          const reward = Number(raw.reward || 0);
          const adminReward = typeof raw.adminReward === "number"
            ? (raw.adminReward as number)
            : reward;
          // site profit = full task value minus the user's already-split earned amount
          manualTasksSiteProfit += Math.max(0, adminReward - reward);
          return;
        }

        const adminPrice =
          typeof raw.adminReward === "number"
            ? (raw.adminReward as number)
            : Number(taskData?.reward || 0);

        platformTasksRevenue += adminPrice * adminRevenueRate("platform", undefined, platformUserShare);
      });

      setAnalytics({
        totalUsers,
        totalWithdrawalsAmount,
        totalWithdrawalsCount: wSnap.size,
        pendingWithdrawalsAmount,
        approvedWithdrawalsAmount,
        manualTasksApprovedTotal: manualTasksSiteProfit,
        platformTasksRevenue,
        totalRevenue: manualTasksSiteProfit + platformTasksRevenue,
      });
    } finally {
      setLoadingAnalytics(false);
    }
  }

  async function handleApproveWithdrawal(id: string) {
    try {
      const w = allWithdrawals.find((x) => x.id === id);
      if (!w) throw new Error("Withdrawal not found");
      const recon = reconciliations[w.userId];
      if (!recon || recon.status !== "clean") {
        throw new Error("Approval blocked until reconciliation is 100% clean.");
      }
      if (recon.totalApprovedEarnings < w.amount - 0.000001) {
        throw new Error("Approval blocked: approved earnings do not cover the withdrawal amount.");
      }
      await approveWithdrawal(id);
      toast({ title: "✅ Approved" });
    }
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

  async function runAutoImport() {
    // Use already-loaded platforms state; fall back to Firestore fetch if empty
    let activePlatforms = platforms.filter((p) => p.enabled !== false && p.autoImport && p.apiBase);

    if (activePlatforms.length === 0) {
      // Platforms may not be loaded yet — fetch them directly
      try {
        const snap = await getDocs(collection(db, "platforms"));
        activePlatforms = snap.docs
          .filter((d) => {
            const data = d.data();
            return data.enabled !== false && data.autoImport === true && data.apiBase;
          })
          .map((d) => {
            const data = d.data();
            const sv = (k: string) => String(data[k] || "");
            const resolvedApiBase = sv("apiBase");
            const resolvedName    = sv("name").toLowerCase();
            // ── OGAds fix: base URL is the endpoint — no sub-path.
            // Also enforce Bearer auth (OGAds requires Authorization: Bearer <token>).
            const isOGAds = resolvedName === "ogads" || resolvedApiBase.includes("saveapp.store");
            const resolvedEndpoint   = isOGAds ? "" : sv("endpoint");
            const resolvedAutoAuth   = isOGAds ? "bearer" : (sv("authenticationType") || "queryParam");
            // Replace any un-substituted OGAds template placeholders with safe defaults.
            const rawQp3 = (data.queryParameters as Record<string, string>) || {};
            const resolvedQp3 = isOGAds ? (() => {
              const qp = { ...rawQp3 };
              if (!qp.ip || qp.ip.startsWith("{"))
                qp.ip = "8.8.8.8";
              if (!qp.user_agent || qp.user_agent.startsWith("{"))
                qp.user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
              return qp;
            })() : rawQp3;
            return {
              id: d.id,
              name: sv("name"),
              displayName: sv("displayName") || sv("name"),
              enabled: data.enabled !== false,
              apiBase: resolvedApiBase,
              endpoint: resolvedEndpoint,
              authenticationType: resolvedAutoAuth as ManagedPlatform["authenticationType"],
              apiKey: sv("apiKey") || sv("adgemApiKey") || sv("lootablyApiKey"),
              apiKeyParam: sv("apiKeyParam") || "api_key",
              apiKeyHeaderName: sv("apiKeyHeaderName") || "X-API-Key",
              basicAuthUser: sv("basicAuthUser"),
              requestMethod: (sv("requestMethod") || "GET") as ManagedPlatform["requestMethod"],
              headers: (data.headers as Record<string, string>) || {},
              queryParameters: resolvedQp3,
              responsePath: sv("responsePath") || "offers",
              offerMapping: (data.offerMapping as Record<string, string>) || {},
              postbackUrl: sv("postbackUrl"),
              autoImport: !!data.autoImport,
              importInterval: Number(data.importInterval || 30),
              rateLimit: Number(data.rateLimit || 60),
              importStatus: data.importStatus as ManagedPlatform["importStatus"],
              createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
            } as ManagedPlatform;
          });
      } catch {
        setAutoImportStatus("error");
        setAutoImportLog(["❌ Could not load platforms from Firestore."]);
        return;
      }
    }

    if (activePlatforms.length === 0) {
      setAutoImportStatus("idle");
      return;
    }

    setAutoImportStatus("running");
    const log: string[] = [];
    let totalImported = 0;

    // Fetch existing task externalIds once for dedup across all platforms
    let existingIds = new Set<string>();
    try {
      const existingSnap = await getDocs(collection(db, "tasks"));
      existingSnap.docs.forEach((d) => {
        const eid = d.data().externalId || d.data().offerId;
        if (eid) existingIds.add(String(eid));
      });
    } catch { /* continue without dedup */ }

    for (const plat of activePlatforms) {
      const displayName = plat.displayName || plat.name || plat.id;
      try {
        const r = await fetch("/api/import-platform", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            platformName: plat.id,
            platformConfig: buildPlatformConfig(plat),
          }),
        });
        const d = await r.json() as { success?: boolean; offers?: Array<{ externalId: string; title: string; description: string; payout: number; url: string; platform: string; platformId: string }>; error?: string };
        if (!d.success) {
          log.push(`⚠ ${displayName}: ${d.error || "fetch failed"}`);
          continue;
        }

        const toImport = (d.offers || []).filter((o) => o.externalId && !existingIds.has(o.externalId));
        let imported = 0;
        const BATCH = 20;
        for (let i = 0; i < toImport.length; i += BATCH) {
          const chunk = toImport.slice(i, i + BATCH);
          // Registry id for this platform (e.g. "ogads", "cpagrip") — used by
          // buildTrackingUrl to pick the correct tracking strategy.
          const registryId = plat.name?.toLowerCase() || plat.id;
          await Promise.all(chunk.map((item) =>
            addDoc(collection(db, "tasks"), {
              platform: plat.displayName || plat.name || plat.id,
              // platformId must be the registry id so getPlatformConfig() resolves
              // the correct tracking strategy (aff_sub/aff_sub2 for OGAds, etc.).
              // The Firestore platform document id is kept in importedFrom.
              platformId: registryId,
              title: item.title,
              description: item.description,
              reward: item.payout,
              payout: item.payout,
              url: item.url,
              externalId: item.externalId,
              offerId: item.externalId,
              network: registryId,
              status: "published",
              taskType: "platform",
              type: item.payout >= 0.05 ? "premium" : "simple",
              active: true,
              networkStatus: "pending",
              manualAdminRate: 0.35,
              importedFrom: plat.id,
              createdAt: serverTimestamp(),
            })
          ));
          imported += chunk.length;
          // Add newly imported IDs to the set so subsequent platforms don't duplicate
          chunk.forEach((item) => existingIds.add(item.externalId));
        }

        // Update platform status
        try {
          await updateDoc(doc(db, "platforms", plat.id), {
            importStatus: "success",
            lastError: null,
            lastImportAt: new Date().toISOString(),
            lastImportCount: imported,
            totalOffersFound: (d.offers || []).length,
          });
        } catch { /* non-critical */ }

        log.push(`✅ ${displayName}: ${imported} new offer(s) imported`);
        totalImported += imported;
      } catch (e) {
        log.push(`⚠ ${displayName}: ${e instanceof Error ? e.message : "network error"}`);
      }
    }

    if (totalImported > 0) await fetchTasks();
    log.push(`Total: ${totalImported} new task(s) added at ${new Date().toLocaleTimeString("en-US")}`);
    setAutoImportLog(log);
    setLastAutoImport(new Date());
    setNextImportCountdown(30 * 60);
    setAutoImportStatus(totalImported > 0 || log.every(l => l.startsWith("✅")) ? "completed" : "error");
    await fetchPlatforms();
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

  async function handleManualCompletionDecision(completionId: string, decision: "approved" | "rejected") {
    const item = manualCompletions.find((c) => c.id === completionId);
    if (!item) {
      toast({ title: "Error", description: "Completion not found in list.", variant: "destructive" });
      return;
    }
    if (item.status === decision) return;

    setReviewingCompletionId(completionId);
    try {
      if (item.status === "pending") {
        const action = decision === "approved" ? "approve" : "reject";
        const result = await settleWalletCompletion(
          item.userId,
          completionId,
          item.reward,
          action,
          {
            source: "manual_admin_review",
            actorId: profile?.uid,
            actorName: profile?.name || "admin",
            reason: decision === "rejected" ? "Rejected during manual task review" : undefined,
          }
        );
        if (!result.success) throw new Error(result.message || "Settlement failed");
        toast({
          title: decision === "approved" ? "✅ Approved" : "Rejected",
          description: decision === "approved"
            ? "Wallet credited and transaction recorded."
            : "Pending reward removed from user wallet.",
        });
      } else {
        // Re-decision: update status and adjust wallet balance
        const userRef = doc(db, "users", item.userId);
        const completionRef = doc(db, "taskCompletions", completionId);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) throw new Error("User not found");
        const userData = userSnap.data() as { balance?: number; pendingBalance?: number };
        const currentBalance = Number(userData.balance || 0);

        const batch: Promise<void>[] = [];

        if (item.status === "approved" && decision === "rejected") {
          // Reverse: deduct credited reward from balance
          batch.push(
            updateDoc(userRef, { balance: Math.max(0, currentBalance - item.reward), walletUpdatedAt: serverTimestamp() }),
            updateDoc(completionRef, { status: "rejected", overriddenAt: serverTimestamp(), overriddenBy: profile?.name || "admin" })
          );
        } else if (item.status === "rejected" && decision === "approved") {
          // Re-approve: credit the reward back to balance
          batch.push(
            updateDoc(userRef, { balance: currentBalance + item.reward, walletUpdatedAt: serverTimestamp() }),
            updateDoc(completionRef, { status: "approved", overriddenAt: serverTimestamp(), overriddenBy: profile?.name || "admin" })
          );
        }

        await Promise.all(batch);
        toast({
          title: decision === "approved" ? "✅ Re-approved" : "Re-rejected",
          description: decision === "approved"
            ? "Status overridden → approved. Wallet re-credited."
            : "Status overridden → rejected. Balance adjusted.",
        });
      }

      setManualCompletions(prev =>
        prev.map(c => c.id === completionId ? { ...c, status: decision } : c)
      );
      if (analytics) await fetchAnalytics();
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    } finally {
      setReviewingCompletionId(null);
    }
  }

  async function fetchPlatformReviews() {
    setLoadingPlatformReviews(true);
    try {
      const [completionsSnap, usersSnap] = await Promise.all([
        getDocs(query(collection(db, "taskCompletions"), where("status", "==", "platform_approved"))),
        getDocs(collection(db, "users")),
      ]);
      const usersById = new Map(usersSnap.docs.map((d) => [d.id, d.data() as Record<string, unknown>]));
      const fetched: PlatformTaskCompletion[] = completionsSnap.docs.map((d) => {
        const raw = d.data() as Record<string, unknown>;
        const userData = usersById.get(String(raw.userId || ""));
        return {
          id: d.id,
          taskId: String(raw.taskId || ""),
          taskTitle: String(raw.taskTitle || "Untitled Task"),
          userId: String(raw.userId || ""),
          userName: String(raw.userName || userData?.name || "Unknown"),
          userEmail: String(raw.userEmail || userData?.email || ""),
          reward: Number(raw.reward || 0),
          platformName: String(raw.taskPlatform || raw.platformName || "Unknown Platform"),
          verifiedBy: String(raw.verifiedBy || ""),
          platformVerifiedAt: (raw.platformVerifiedAt as Timestamp)?.toDate() || new Date(),
          submittedAt: (raw.completedAt as Timestamp)?.toDate() || new Date(),
        };
      });
      fetched.sort((a, b) => b.platformVerifiedAt.getTime() - a.platformVerifiedAt.getTime());
      setPlatformReviews(fetched);
    } finally {
      setLoadingPlatformReviews(false);
    }
  }

  async function handlePlatformReviewDecision(completionId: string, decision: "approved" | "rejected") {
    const item = platformReviews.find((c) => c.id === completionId);
    if (!item) {
      toast({ title: "Error", description: "Completion not found.", variant: "destructive" });
      return;
    }
    setReviewingPlatformCompletionId(completionId);
    try {
      const result = await settleWalletCompletion(
        item.userId,
        completionId,
        item.reward,
        decision === "approved" ? "approve" : "reject",
        {
          source: "manual_admin_review",
          actorId: profile?.uid,
          actorName: profile?.name || "admin",
          reason: decision === "rejected" ? "Rejected during platform task review" : undefined,
        }
      );
      if (!result.success) throw new Error(result.message || "Settlement failed");
      toast({
        title: decision === "approved" ? "✅ Approved" : "Rejected",
        description: decision === "approved"
          ? "Platform task approved — wallet credited."
          : "Platform task rejected — pending reward removed.",
      });
      setPlatformReviews((prev) => prev.filter((c) => c.id !== completionId));
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    } finally {
      setReviewingPlatformCompletionId(null);
    }
  }

  async function handleAddPlatform() {
    if (!newPlatform.name.trim()) {
      toast({ title: "Missing name", description: "Platform name is required.", variant: "destructive" });
      return;
    }
    if (!newPlatform.apiBase.trim()) {
      toast({ title: "Missing API Base", description: "API Base URL is required.", variant: "destructive" });
      return;
    }
    setSavingPlatformId("new");
    try {
      const data = parsePlatformForm(newPlatform);
      await addDoc(collection(db, "platforms"), {
        ...data,
        importStatus: "idle",
        createdAt: serverTimestamp(),
      });
      setNewPlatform(emptyPlatformForm);
      setShowPlatformForm(false);
      await fetchPlatforms();
      toast({ title: "✅ Platform added" });
    } finally {
      setSavingPlatformId(null);
    }
  }

  async function handleSavePlatform(platformId: string, form: typeof emptyPlatformForm) {
    setSavingPlatformId(platformId);
    try {
      const data = parsePlatformForm(form);
      await updateDoc(doc(db, "platforms", platformId), {
        ...data,
        updatedAt: serverTimestamp(),
      });
      await fetchPlatforms();
      setEditingPlatformId(null);
      toast({ title: "✅ Platform updated" });
    } finally {
      setSavingPlatformId(null);
    }
  }

  async function handleDeletePlatform(platformId: string) {
    setDeletingPlatformId(null);
    setSavingPlatformId(platformId);
    try {
      await deleteDoc(doc(db, "platforms", platformId));
      await fetchPlatforms();
      toast({ title: "Platform deleted", description: "Imported tasks and history preserved." });
    } finally {
      setSavingPlatformId(null);
    }
  }

  async function handleTogglePlatform(platform: ManagedPlatform) {
    setSavingPlatformId(platform.id);
    try {
      await updateDoc(doc(db, "platforms", platform.id), {
        enabled: !platform.enabled,
        updatedAt: serverTimestamp(),
      });
      await fetchPlatforms();
      toast({ title: platform.enabled ? "Platform disabled" : "✅ Platform enabled" });
    } finally {
      setSavingPlatformId(null);
    }
  }

  async function handleTestConnection(platform: ManagedPlatform) {
    console.log("[GTO:TEST] ── ENTERED handleTestConnection ──────────────────");
    console.log("[GTO:TEST] Platform object received:", JSON.parse(JSON.stringify(platform)));
    setTestingPlatformId(platform.id);
    try {
      console.log("[GTO:TEST] window.location.origin =", window.location.origin);
      console.log("[GTO:TEST] window.location.href   =", window.location.href);
      console.log("[GTO:TEST] document.baseURI       =", document.baseURI);

      console.log("[GTO:TEST] ID token retrieval started");
      let idToken: string | null = null;
      try {
        idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null;
        console.log("[GTO:TEST] ID token retrieved:", idToken ? `yes (len=${idToken.length})` : "null — no currentUser");
      } catch (tokenErr) {
        console.warn("[GTO:TEST] getIdToken() threw — continuing without token:", tokenErr);
      }

      const targetUrl = "/api/import-platform";
      console.log("[GTO:TEST] Final fetch URL:", targetUrl, "→ resolves to:", new URL(targetUrl, document.baseURI).href);

      const bodyObj = {
        platformName: platform.id,
        platformConfig: buildPlatformConfig(platform),
      };
      const body = JSON.stringify(bodyObj);
      console.log("[GTO:TEST] Request body created:", bodyObj);

      console.log("[GTO:TEST] ► calling fetch() NOW");
      const r = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      console.log("[GTO:TEST] ◄ fetch() returned. status:", r.status, r.statusText);

      const data = await r.json() as { success?: boolean; error?: string; totalOffers?: number };
      console.log("[GTO:TEST] Parsed response:", data);

      if (data.success) {
        toast({ title: `✅ Connection OK — ${data.totalOffers ?? 0} offers found` });
      } else {
        toast({ title: "Connection Failed", description: data.error || "Unknown error", variant: "destructive" });
      }
    } catch (e) {
      console.error("[GTO:TEST] ✖ CAUGHT ERROR ──────────────────────────────");
      console.error("[GTO:TEST] Error object:", e);
      if (e instanceof Error) {
        console.error("[GTO:TEST] message:", e.message);
        console.error("[GTO:TEST] stack:", e.stack);
      }
      toast({ title: "Test Failed", description: e instanceof Error ? e.message : "Network error", variant: "destructive" });
    } finally {
      setTestingPlatformId(null);
      console.log("[GTO:TEST] ── handleTestConnection DONE ──────────────────");
    }
  }

  async function handleRunImport(platform: ManagedPlatform) {
    console.log("[GTO:IMPORT] ── ENTERED handleRunImport ──────────────────");
    console.log("[GTO:IMPORT] Platform object received:", JSON.parse(JSON.stringify(platform)));
    setImportingPlatformId(platform.id);
    try {
      console.log("[GTO:IMPORT] window.location.origin =", window.location.origin);
      console.log("[GTO:IMPORT] window.location.href   =", window.location.href);

      console.log("[GTO:IMPORT] ID token retrieval started");
      let idToken: string | null = null;
      try {
        idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null;
        console.log("[GTO:IMPORT] ID token retrieved:", idToken ? `yes (len=${idToken.length})` : "null — no currentUser");
      } catch (tokenErr) {
        console.warn("[GTO:IMPORT] getIdToken() threw — continuing without token:", tokenErr);
      }

      const targetUrl = `${window.location.origin}/api/import-platform`;
      console.log("[GTO:IMPORT] Final fetch URL:", targetUrl);

      const bodyObj = {
        platformName: platform.id,
        platformConfig: buildPlatformConfig(platform),
      };
      const body = JSON.stringify(bodyObj);
      console.log("[GTO:IMPORT] Request body created:", bodyObj);

      console.log("[GTO:IMPORT] ► calling fetch() NOW");
      const r = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      console.log("[GTO:IMPORT] ◄ fetch() returned. status:", r.status, r.statusText);

      const data = await r.json() as { success?: boolean; error?: string; offers?: Array<{ externalId: string; title: string; description: string; payout: number; url: string; platform: string; platformId: string }> };
      console.log("[GTO:IMPORT] Parsed response: success=", data.success, "offers=", (data.offers || []).length, "error=", data.error);
      if (!data.success) {
        toast({ title: "Import Failed", description: data.error || "Unknown error", variant: "destructive" });
        return;
      }

      // Dedup: collect existing externalIds from Firestore
      const existingSnap = await getDocs(collection(db, "tasks"));
      const existingIds = new Set<string>();
      existingSnap.docs.forEach((d) => {
        const eid = d.data().externalId || d.data().offerId;
        if (eid) existingIds.add(String(eid));
      });

      const toImport = (data.offers || []).filter((o) => o.externalId && !existingIds.has(o.externalId));

      let imported = 0;
      const BATCH = 20;
      for (let i = 0; i < toImport.length; i += BATCH) {
        const chunk = toImport.slice(i, i + BATCH);
        await Promise.all(chunk.map((item) =>
          addDoc(collection(db, "tasks"), {
            platform: item.platform,
            platformId: platform.name?.toLowerCase() || platform.id,
            title: item.title,
            description: item.description,
            reward: item.payout,
            payout: item.payout,
            url: item.url,
            externalId: item.externalId,
            offerId: item.externalId,
            network: item.platformId,
            status: "published",
            taskType: "platform",
            type: item.payout >= 0.05 ? "premium" : "simple",
            active: true,
            networkStatus: "pending",
            manualAdminRate: 0.35,
            importedFrom: item.platformId,
            createdAt: serverTimestamp(),
          })
        ));
        imported += chunk.length;
      }

      const skipped = (data.offers || []).length - toImport.length;

      // Update platform status in Firestore via Firebase SDK
      await updateDoc(doc(db, "platforms", platform.id), {
        importStatus: "success",
        lastError: null,
        lastImportAt: new Date().toISOString(),
        lastImportCount: imported,
        totalOffersFound: (data.offers || []).length,
      });

      toast({
        title: `✅ Imported ${imported} new task(s)`,
        description: `${skipped} duplicates skipped out of ${(data.offers || []).length} total offers.`,
      });
      await fetchTasks();
      await fetchPlatforms();
    } catch (e) {
      console.error("[GTO:IMPORT] ✖ CAUGHT ERROR ──────────────────────────────");
      console.error("[GTO:IMPORT] Error object:", e);
      if (e instanceof Error) {
        console.error("[GTO:IMPORT] message:", e.message);
        console.error("[GTO:IMPORT] stack:", e.stack);
      }
      // Record error status
      try {
        await updateDoc(doc(db, "platforms", platform.id), {
          importStatus: "error",
          lastError: e instanceof Error ? e.message : String(e),
          lastImportAt: new Date().toISOString(),
        });
      } catch { /* ignore secondary error */ }
      toast({ title: "Import Error", description: e instanceof Error ? e.message : "Network error", variant: "destructive" });
      await fetchPlatforms();
    } finally {
      setImportingPlatformId(null);
      console.log("[GTO:IMPORT] ── handleRunImport DONE ──────────────────");
    }
  }

  async function handleResetTestData() {
    setResetting(true);
    try {
      const [completionsSnap, manualTasksSnap, usersSnap] = await Promise.all([
        getDocs(query(collection(db, "taskCompletions"), where("taskType", "==", "manual"))),
        getDocs(query(collection(db, "tasks"), where("taskType", "==", "manual"))),
        getDocs(collection(db, "users")),
      ]);
      await Promise.all([
        ...completionsSnap.docs.map((d) => deleteDoc(doc(db, "taskCompletions", d.id))),
        ...manualTasksSnap.docs.map((d) => deleteDoc(doc(db, "tasks", d.id))),
        ...usersSnap.docs.map((d) => updateDoc(doc(db, "users", d.id), { balance: 0, pendingBalance: 0 })),
      ]);
      await fetchTasks();
      await fetchManualCompletions();
      setResetConfirmOpen(false);
      toast({ title: "✅ Reset complete", description: `Deleted ${completionsSnap.size} completions, ${manualTasksSnap.size} tasks. All user balances zeroed.` });
    } catch (e) {
      toast({ title: "Reset failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setResetting(false);
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

  // Auto-load reconciliation for all pending withdrawals whenever the list changes.
  // Always re-fetch (no stale-cache guard) so rule/logic fixes take effect immediately.
  // Also auto-loads globalRecon so the Confirm Approval modal never starts in a null state.
  useEffect(() => {
    if (pendingWithdrawals.length === 0) return;
    pendingWithdrawals.forEach((w) => {
      if (loadingRecon.has(w.userId)) return;
      setLoadingRecon((prev) => new Set([...prev, w.userId]));
      fetchUserReconciliation(w.userId)
        .then((recon) => setReconciliations((prev) => ({ ...prev, [w.userId]: recon })))
        .finally(() => setLoadingRecon((prev) => { const s = new Set(prev); s.delete(w.userId); return s; }));
    });
    if (!globalRecon && !loadingGlobalRecon) {
      handleFetchGlobalRecon();
    }
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
    if (!globalRecon?.isBalanced) {
      toast({ title: "Blocked", description: "Bulk approval requires a 100% reconciliation match.", variant: "destructive" });
      return;
    }
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
    { id: "platforms", label: "Platforms" },
    { id: "import", label: "Import Tasks" },
    { id: "postbacks", label: `Postbacks${conversionStats ? ` (${conversionStats.total})` : ""}` },
    { id: "analytics", label: "Analytics" },
    { id: "users", label: "Users" },
    { id: "messages", label: "Broadcast" },
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
            if (t.id === "tasks") fetchManualCompletions();
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
                    {paidMonthDate.toLocaleString("en-US", { month: "short", year: "numeric" })}
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
                          <span className="text-white/30">{alert.createdAt.toLocaleString("en-US")}</span>
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
            // Per-user check: approved earnings (manual + platform) must cover withdrawal amount
            const modalRecon = reconciliations[w.userId];
            const confirmDisabled = modalRecon != null && modalRecon.totalApprovedEarnings < w.amount - 0.000001;
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
                    <Button onClick={handleConfirmApprove} disabled={confirmDisabled}
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
                            <p className="text-xs text-white/25 mt-0.5">{item.completedAt.toLocaleDateString("en-US")}</p>
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
                            <p className="text-xs text-white/25 mt-0.5">{item.completedAt.toLocaleDateString("en-US")}</p>
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
          <div className="flex gap-2 flex-wrap">
            {(["add", "list", "reviews", "platformReviews", "financial"] as const).map((s) => (
              <button key={s} onClick={() => {
                setTaskSubTab(s);
              }}
                className={cn("px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                  taskSubTab === s ? "bg-white/15 text-white" : "bg-white/5 text-white/50 hover:bg-white/10")}>
                {s === "add" ? "Add New Task" : s === "list" ? `Task List (${tasks.length})` : s === "reviews" ? `Manual Reviews (${manualCompletions.length})` : s === "platformReviews" ? `Platform Reviews (${platformReviews.length})` : "Financial"}
              </button>
            ))}
          </div>

          {taskSubTab === "add" && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <h2 className="font-semibold text-white mb-4 flex items-center gap-2"><Plus className="w-4 h-4 text-emerald-400" />Add New Task (Manual)</h2>
            <div className="grid gap-3">
              <Input placeholder="Task title *" value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} className="bg-white/10 border-white/20 text-white placeholder:text-white/30" />
              <Input placeholder="Description" value={newTask.description} onChange={(e) => setNewTask({ ...newTask, description: e.target.value })} className="bg-white/10 border-white/20 text-white placeholder:text-white/30" />
              <Input placeholder="Task URL *" value={newTask.url} onChange={(e) => setNewTask({ ...newTask, url: e.target.value })} className="bg-white/10 border-white/20 text-white placeholder:text-white/30" />
              <div className="grid grid-cols-3 gap-3">
                <Input placeholder="Platform *" value={newTask.platform} onChange={(e) => setNewTask({ ...newTask, platform: e.target.value })} className="bg-white/10 border-white/20 text-white placeholder:text-white/30" />
                <select value={newTask.type} onChange={(e) => setNewTask({ ...newTask, type: e.target.value as "simple" | "premium", reward: e.target.value === "premium" ? "0.05" : "0.005" })} className="bg-slate-800 border border-white/20 text-white rounded-md px-3 text-sm">
                  <option value="simple">Simple</option>
                  <option value="premium">Premium</option>
                </select>
                <Input type="text" inputMode="decimal" step="any" lang="en" placeholder="Reward (e.g. 0.005)" value={newTask.reward} onChange={(e) => setNewTask({ ...newTask, reward: e.target.value })} className="bg-white/10 border-white/20 text-white placeholder:text-white/30" />
              </div>
              <Input
                type="text"
                inputMode="decimal"
                step="0.01"
                lang="en"
                placeholder="User Share % (0-100, default 100)"
                value={newTask.manualUserSharePercent}
                onChange={(e) => {
                  const pct = Math.max(0, Math.min(100, parseFloat(e.target.value) || 0));
                  setNewTask({ ...newTask, manualUserSharePercent: String(pct) });
                }}
                className="bg-white/10 border-white/20 text-white placeholder:text-white/30"
              />
              {parseFloat(newTask.reward) > 0 && (
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 text-xs text-emerald-300">
                  Users earn: <span className="font-bold">{formatCurrency(userReward(parseFloat(newTask.reward) || 0, "manual", { manualUserSharePercent: parseFloat(newTask.manualUserSharePercent) || 100 }))}</span>
                  <span className="text-white/40 ml-1">({parseFloat(newTask.manualUserSharePercent) || 100}% user share — ignores platform settings)</span>
                </div>
              )}
              <Button onClick={handleAddTask} disabled={addingTask} className="bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl">
                {addingTask ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}Add Task
              </Button>
            </div>
          </div>
          )}

          {taskSubTab === "list" && (
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
                            <Badge className={cn("text-xs shrink-0 border", t.taskType === "manual" ? "bg-purple-500/20 text-purple-300 border-purple-500/30" : "bg-cyan-500/20 text-cyan-300 border-cyan-500/30")}>
                              {t.taskType || "platform"}
                            </Badge>
                            <Badge className={cn("text-xs shrink-0 border", t.status === "published" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : "bg-slate-500/20 text-slate-300 border-slate-500/30")}>
                              {t.status || "published"}
                            </Badge>
                            </div>
                          <p className="text-xs text-white/40">
                            {t.platform} • Task value: {formatCurrency(t.reward)} → User: <span className="text-emerald-400">{formatCurrency(
                              (t.taskType || "platform") === "manual"
                                ? userReward(t.reward, "manual", { manualUserSharePercent: t.manualUserSharePercent, manualAdminRate: t.manualAdminRate })
                                : userReward(t.reward, "platform", { platformUserSharePercent: parseFloat(platformTaskUserSharePercent) || 65 })
                            )}</span>
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => { setDebugTaskId(debugTaskId === t.id ? null : t.id); setRawJsonExpanded(false); }}
                            title="Debug: view all fields & URL trace"
                            className={cn("p-1 transition-colors", debugTaskId === t.id ? "text-amber-400" : "text-white/30 hover:text-amber-400")}
                          ><Eye className="w-4 h-4" /></button>
                          <button onClick={() => handleToggleTask(t.id, t.active)}
                            className={cn("w-10 h-5 rounded-full transition-all relative", t.active ? "bg-emerald-500" : "bg-white/20")}>
                            <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all", t.active ? "right-0.5" : "left-0.5")} />
                          </button>
                          <button onClick={() => handleDeleteTask(t.id)} className="text-red-400/60 hover:text-red-400 p-1"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                      <div className="flex gap-2 pt-2 border-t border-white/5">
                        {t.status !== "published" && (
                          <Button
                            size="sm"
                            onClick={() => handleConfirmPublishTask(t.id)}
                            disabled={publishingTaskId === t.id}
                            className="flex-1 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 rounded-lg text-xs h-8"
                            variant="outline"
                          >
                            {publishingTaskId === t.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Check className="w-3 h-3 mr-1" />}
                            Confirm Publish
                          </Button>
                        )}
                        {t.networkStatus !== "approved" && (
                          <Button size="sm" onClick={() => handleSetNetworkStatus(t.id, "approved")}
                            className="flex-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs h-8" variant="outline">
                            <ThumbsUp className="w-3 h-3 mr-1" />Approve
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}</div>
            }

          {/* ── TASK DEBUG PANEL ──────────────────────────────────────────── */}
          {debugTaskId && (() => {
            const dt = tasks.find(t => t.id === debugTaskId);
            if (!dt) return null;

            let urlWithTracking = '';
            try {
              const u = new URL(dt.url || '');
              u.searchParams.set('tracking_id', `[USER_UID]|${dt.id}`);
              urlWithTracking = u.toString();
            } catch { /* invalid url */ }

            const idMismatch = dt.id !== (dt.externalId || dt.id);

            return (
              <div className="mt-4 bg-amber-950/30 border border-amber-500/30 rounded-2xl p-5 space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4 text-amber-400" />
                    <span className="font-mono text-amber-300 text-sm font-bold">TASK DEBUG — {dt.title}</span>
                  </div>
                  <button onClick={() => setDebugTaskId(null)} className="text-white/30 hover:text-white text-xs">✕ Close</button>
                </div>

                {/* PART 2 — ALL FIRESTORE FIELDS */}
                <div>
                  <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2">Part 2 — All Firestore Fields</p>
                  <div className="grid grid-cols-1 gap-0.5 font-mono text-xs bg-black/20 rounded-xl p-3">
                    {([
                      ['Firestore Document ID', dt.id],
                      ['externalId', dt.externalId || '(not set)'],
                      ['title', dt.title],
                      ['description', dt.description || '(empty)'],
                      ['url', dt.url || '(empty)'],
                      ['trackingUrl', dt.trackingUrl || '(not set — missing from Firestore)'],
                      ['previewUrl', dt.previewUrl || '(not set — missing from Firestore)'],
                      ['image', dt.image || '(not set)'],
                      ['requirements', dt.requirements || '(not set)'],
                      ['countries', dt.countries?.join(', ') || '(not set)'],
                      ['devices', dt.devices?.join(', ') || '(not set)'],
                      ['conversionType', dt.conversionType || '(not set)'],
                      ['platform', dt.platform || '(not set)'],
                      ['platformId', dt.platformId || '(not set)'],
                      ['reward', String(dt.reward ?? '(not set)')],
                      ['payout (platform cost)', dt.payout !== undefined ? String(dt.payout) : '(not set — missing from Firestore)'],
                      ['status', dt.status],
                      ['networkStatus', dt.networkStatus],
                      ['active', String(dt.active)],
                      ['taskType', dt.taskType || '(not set)'],
                      ['createdAt', dt.createdAt?.toISOString() || '(not set)'],
                      ['rawPlatformResponse', dt.rawPlatformResponse ? `✓ present (${dt.rawPlatformResponse.length} chars)` : '(not set — re-import task to capture)'],
                    ] as [string, string][]).map(([k, v]) => (
                      <div key={k} className="flex gap-2 py-0.5 border-b border-white/5">
                        <span className="text-white/35 shrink-0 w-44">{k}</span>
                        <span className={cn("break-all", v.startsWith('(not set') ? 'text-red-400/70' : 'text-amber-200')}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* PART 3 — URL TRACE */}
                <div>
                  <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2">Part 3 — URL Trace</p>
                  <div className="space-y-1.5">
                    {([
                      ['Original Platform URL (url field stored in Firestore)', dt.url || '(empty)'],
                      ['Tracking URL (trackingUrl field)', dt.trackingUrl || '(not set — field empty or missing)'],
                      ['Preview URL (previewUrl field)', dt.previewUrl || '(not set — field empty or missing)'],
                      ['Current URL stored in Firestore', dt.url || '(empty)'],
                      ['Final base URL sent to Start Task', dt.url || '(empty)'],
                      ['After appending tracking_id=[USER_UID]|' + dt.id, urlWithTracking || '(cannot parse — invalid URL)'],
                    ] as [string, string][]).map(([label, val]) => (
                      <div key={label} className="bg-black/20 rounded-lg p-2 font-mono text-xs">
                        <div className="text-white/35 text-[10px] mb-0.5">{label}</div>
                        <div className={cn("break-all", val.startsWith('(') ? 'text-red-400/70' : 'text-cyan-300')}>{val}</div>
                      </div>
                    ))}
                  </div>
                  {dt.trackingUrl && dt.url && dt.trackingUrl !== dt.url && (
                    <div className="mt-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-2 text-xs text-yellow-300">
                      ⚠ <strong>trackingUrl ≠ url</strong> — The platform provided a separate tracking URL but Start Task uses only the <code>url</code> field. <code>trackingUrl</code> is stored in Firestore but never read by the frontend.
                    </div>
                  )}
                  {!dt.trackingUrl && (
                    <div className="mt-2 bg-slate-500/10 border border-slate-500/20 rounded-lg p-2 text-xs text-slate-400">
                      ℹ trackingUrl is empty — either the platform did not supply one, or this task was imported before the field was captured.
                    </div>
                  )}
                </div>

                {/* PART 5 — ID INVESTIGATION */}
                <div>
                  <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2">Part 5 — ID Investigation</p>
                  <div className="space-y-2 font-mono text-xs">
                    <div className="bg-black/20 rounded-lg p-3">
                      <div className="text-white/35 text-[10px] mb-1">Firestore Document ID (Firebase auto-generated key)</div>
                      <div className="text-emerald-300 break-all">{dt.id}</div>
                      <div className="text-white/35 text-[10px] mt-1.5">→ Used for: Start Task button, tracking_id taskId segment, postback matching in api/postback</div>
                    </div>
                    <div className="bg-black/20 rounded-lg p-3">
                      <div className="text-white/35 text-[10px] mb-1">externalId (Platform's own offer ID — what the platform knows)</div>
                      <div className="text-amber-300 break-all">{dt.externalId || '(not set)'}</div>
                      <div className="text-white/35 text-[10px] mt-1.5">→ Used for: deduplication only (firestoreWriter.js). NOT used in tracking_id or postback.</div>
                    </div>
                    <div className={cn("rounded-lg p-2 text-xs", idMismatch
                      ? 'bg-red-500/10 border border-red-500/25 text-red-300'
                      : 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-300'
                    )}>
                      {idMismatch
                        ? `⚠ MISMATCH CONFIRMED — tracking_id sends Firestore ID "${dt.id}" but platform knows externalId "${dt.externalId || 'N/A'}". If the platform echoes its own offer ID in the postback, it will not match.`
                        : '✓ Firestore ID and externalId are the same for this task.'}
                    </div>
                  </div>
                </div>

                {/* PART 6 — IMPORT MAPPING */}
                <div>
                  <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2">Part 6 — Import Mapping</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px] font-mono border-collapse">
                      <thead>
                        <tr className="text-white/35 text-left">
                          <th className="pb-1 pr-2">Raw Platform Field</th>
                          <th className="pb-1 pr-2">→ Normalized</th>
                          <th className="pb-1 pr-2">→ Firestore</th>
                          <th className="pb-1 pr-2">→ Task Interface</th>
                          <th className="pb-1">Current Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {([
                          ['id/offer_id/campaign_id', 'externalId', 'externalId', 'externalId?', dt.externalId || '(empty)'],
                          ['name/title/offer_name', 'title', 'title', 'title', dt.title],
                          ['description/desc', 'description', 'description', 'description', (dt.description || '').slice(0, 50) || '(empty)'],
                          ['payout/amount/cpa', 'payout', 'payout', '❌ NOT IN INTERFACE (was)', dt.payout !== undefined ? String(dt.payout) : '(missing — see investigation)'],
                          ['url/click_url/link', 'url', 'url', 'url', (dt.url || '').slice(0, 60) || '(empty)'],
                          ['image/icon/thumbnail', 'image', 'image', 'image?', dt.image ? dt.image.slice(0, 50) : '(not set)'],
                          ['category/vertical', 'category', 'category', 'category?', dt.category || '(not set)'],
                          ['countries/geo/geos', 'countries', 'countries', 'countries?', dt.countries?.join(', ') || '(not set)'],
                          ['devices/os', 'devices', 'devices', 'devices?', dt.devices?.join(', ') || '(not set)'],
                          ['requirements/instructions', 'requirements', 'requirements', 'requirements?', dt.requirements ? dt.requirements.slice(0, 50) : '(not set)'],
                          ['tracking_url/postback_url', 'trackingUrl', 'trackingUrl', '⚠ just added', dt.trackingUrl || '(not set — was never mapped)'],
                          ['preview_url', 'previewUrl', 'previewUrl', '⚠ just added', dt.previewUrl || '(not set — was never mapped)'],
                          ['conversion_type', 'conversionType', 'conversionType', 'conversionType?', dt.conversionType || '(not set)'],
                          ['(any other field)', '❌ DROPPED', '❌ NOT STORED', '❌ NEVER REACHED', 'Silently discarded by normalizer'],
                        ] as string[][]).map((row) => (
                          <tr key={row[0]} className="border-t border-white/5 align-top">
                            <td className="py-1 pr-2 text-cyan-400/70">{row[0]}</td>
                            <td className="py-1 pr-2 text-white/60">{row[1]}</td>
                            <td className="py-1 pr-2 text-white/60">{row[2]}</td>
                            <td className={cn("py-1 pr-2", row[3].startsWith('❌') ? 'text-red-400' : row[3].startsWith('⚠') ? 'text-yellow-400' : 'text-white/60')}>{row[3]}</td>
                            <td className="py-1 text-white/40 break-all">{row[4]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* RAW PLATFORM RESPONSE */}
                <div>
                  <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2">Raw Platform Response (rawPlatformResponse)</p>
                  {dt.rawPlatformResponse ? (
                    <div>
                      <button
                        onClick={() => setRawJsonExpanded(!rawJsonExpanded)}
                        className="flex items-center gap-1.5 text-xs text-amber-300 hover:text-amber-200 mb-2"
                      >
                        {rawJsonExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        {rawJsonExpanded ? 'Collapse' : 'Expand'} Raw JSON ({dt.rawPlatformResponse.length.toLocaleString()} chars)
                      </button>
                      {rawJsonExpanded && (
                        <pre className="bg-black/50 border border-white/10 rounded-xl p-4 text-xs text-green-300 overflow-auto max-h-[500px] whitespace-pre-wrap break-all font-mono">
                          {(() => { try { return JSON.stringify(JSON.parse(dt.rawPlatformResponse!), null, 2); } catch { return dt.rawPlatformResponse; } })()}
                        </pre>
                      )}
                    </div>
                  ) : (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-300">
                      rawPlatformResponse is empty — this task was imported before Part 1 was added. Re-import this task (it will be deduplicated, so first delete it from Firestore, then import again) to capture the raw response.
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
          {/* ── END TASK DEBUG PANEL ─────────────────────────────────────── */}
          </div>)}

          {taskSubTab === "reviews" && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4 gap-3">
              <h2 className="font-semibold text-white flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-400" />
                Manual Task Reviews ({manualCompletions.length})
              </h2>
              <Button size="sm" variant="outline" onClick={fetchManualCompletions} disabled={loadingManualCompletions}
                className="border-white/20 text-white/60 hover:text-white h-8">
                <RefreshCw className={cn("w-3.5 h-3.5", loadingManualCompletions && "animate-spin")} />
              </Button>
            </div>
            {loadingManualCompletions ? (
              <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>
            ) : manualCompletions.length === 0 ? (
              <p className="text-white/40 text-center py-8 text-sm">No manual task submissions yet.</p>
            ) : (
              <div className="space-y-3">
                {manualCompletions.map((c) => (
                  <div key={c.id} className={cn(
                    "bg-white/5 border rounded-xl p-4",
                    c.status === "approved" ? "border-emerald-500/25" :
                    c.status === "rejected" ? "border-red-500/20 opacity-80" :
                    "border-white/10"
                  )}>
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-sm font-medium text-white">{c.userName}</span>
                          <span className="text-xs text-white/40">{c.userEmail}</span>
                          <Badge className={cn("text-xs border",
                            c.status === "approved" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" :
                            c.status === "rejected" ? "bg-red-500/20 text-red-300 border-red-500/30" :
                            "bg-amber-500/20 text-amber-300 border-amber-500/30"
                          )}>{c.status}</Badge>
                        </div>
                        <p className="text-sm text-white/80">{c.taskTitle}</p>
                        {c.taskDescription && <p className="text-xs text-white/40 mt-0.5 line-clamp-2">{c.taskDescription}</p>}
                        <div className="flex items-center gap-3 mt-1 text-xs text-white/40 flex-wrap">
                          <span className="text-white/50">Task total: <span className="text-white/70 font-medium">{formatCurrency(c.adminReward)}</span></span>
                          <span className="text-emerald-400 font-medium">
                            User: {c.manualUserSharePercent}% = {formatCurrency(c.reward)}
                          </span>
                          {c.manualUserSharePercent < 100 && (
                            <span className="text-amber-400/80">
                              Site: {formatCurrency(c.adminReward - c.reward)}
                            </span>
                          )}
                          <span>{formatDate(c.submittedAt)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 pt-2 border-t border-white/5">
                      <Button size="sm"
                        onClick={() => handleManualCompletionDecision(c.id, "approved")}
                        disabled={reviewingCompletionId === c.id || c.status === "approved"}
                        className={cn(
                          "flex-1 rounded-lg text-xs h-8 border",
                          c.status === "approved"
                            ? "bg-white/5 text-white/30 border-white/10 cursor-default"
                            : "bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/30"
                        )}
                        variant="outline">
                        {reviewingCompletionId === c.id && c.status !== "approved"
                          ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          : <ThumbsUp className="w-3 h-3 mr-1" />}
                        Approve
                      </Button>
                      <Button size="sm"
                        onClick={() => handleManualCompletionDecision(c.id, "rejected")}
                        disabled={reviewingCompletionId === c.id || c.status === "rejected"}
                        className={cn(
                          "rounded-lg text-xs h-8 border",
                          c.status === "rejected"
                            ? "bg-white/5 text-white/30 border-white/10 cursor-default"
                            : "bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/30"
                        )}
                        variant="outline">
                        {reviewingCompletionId === c.id && c.status !== "rejected"
                          ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          : <ThumbsDown className="w-3 h-3 mr-1" />}
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          )}

          {taskSubTab === "platformReviews" && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4 gap-3">
              <h2 className="font-semibold text-white flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-blue-400" />
                Platform Task Reviews ({platformReviews.length})
              </h2>
              <Button size="sm" variant="outline" onClick={fetchPlatformReviews} disabled={loadingPlatformReviews}
                className="border-white/20 text-white/60 hover:text-white h-8">
                <RefreshCw className={cn("w-3.5 h-3.5", loadingPlatformReviews && "animate-spin")} />
              </Button>
            </div>
            <p className="text-xs text-white/40 mb-4">
              These platform tasks have been verified by the ad network and are awaiting your final approval before funds are released to users.
            </p>
            {loadingPlatformReviews ? (
              <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-blue-400" /></div>
            ) : platformReviews.length === 0 ? (
              <p className="text-white/40 text-center py-8 text-sm">No platform tasks awaiting review.</p>
            ) : (
              <div className="space-y-3">
                {platformReviews.map((c) => (
                  <div key={c.id} className="bg-white/5 border border-blue-500/20 rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-sm font-medium text-white">{c.userName}</span>
                          <span className="text-xs text-white/40">{c.userEmail}</span>
                          <Badge className="text-xs border bg-blue-500/20 text-blue-300 border-blue-500/30">
                            Platform Verified
                          </Badge>
                        </div>
                        <p className="text-sm text-white/80">{c.taskTitle}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-white/40 flex-wrap">
                          <span className="text-white/50">Platform: <span className="text-blue-300">{c.platformName}</span></span>
                          <span className="text-emerald-400 font-medium">Reward: {formatCurrency(c.reward)}</span>
                          <span>Submitted: {formatDate(c.submittedAt)}</span>
                          <span>Verified: {formatDate(c.platformVerifiedAt)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 pt-2 border-t border-white/5">
                      <Button size="sm"
                        onClick={() => handlePlatformReviewDecision(c.id, "approved")}
                        disabled={reviewingPlatformCompletionId === c.id}
                        className="flex-1 rounded-lg text-xs h-8 border bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/30"
                        variant="outline">
                        {reviewingPlatformCompletionId === c.id
                          ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          : <ThumbsUp className="w-3 h-3 mr-1" />}
                        Approve &amp; Credit
                      </Button>
                      <Button size="sm"
                        onClick={() => handlePlatformReviewDecision(c.id, "rejected")}
                        disabled={reviewingPlatformCompletionId === c.id}
                        className="rounded-lg text-xs h-8 border bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/30"
                        variant="outline">
                        {reviewingPlatformCompletionId === c.id
                          ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          : <ThumbsDown className="w-3 h-3 mr-1" />}
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          )}

          {taskSubTab === "financial" && (
          <>{(() => {
            const approvedManual = manualCompletions.filter(c => c.status === "approved");
            const blockA = approvedManual.filter(c => c.manualUserSharePercent >= 100);
            const blockB = approvedManual.filter(c => c.manualUserSharePercent < 100);
            // c.reward is already the user's earned share; c.adminReward is the full task value
            const blockATotalToPayUsers = blockA.reduce((s, c) => s + c.reward, 0);
            const blockBTotalToPayUsers = blockB.reduce((s, c) => s + c.reward, 0);
            const blockBSiteProfit = blockB.reduce((s, c) => s + Math.max(0, c.adminReward - c.reward), 0);
            return (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
                <h2 className="font-semibold text-white flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                  Financial Dashboard — Manual Tasks
                </h2>

                {/* Block A: 100% user share */}
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4">
                  <p className="text-xs text-emerald-300/70 uppercase tracking-wider font-medium mb-3">
                    Block A — External Payment Tasks (100% User Share)
                  </p>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-white/50">{blockA.length} approved completion(s)</p>
                      <p className="text-xs text-white/30 mt-0.5">You pay the user directly — no platform cut</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-white/50 mb-0.5">Total Amount to Pay Users</p>
                      <p className="text-2xl font-bold text-emerald-400">{formatCurrency(blockATotalToPayUsers)}</p>
                    </div>
                  </div>
                </div>

                {/* Block B: Split tasks (<100%) */}
                <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-4">
                  <p className="text-xs text-purple-300/70 uppercase tracking-wider font-medium mb-3">
                    Block B — Split Tasks (Custom % per task)
                  </p>
                  <p className="text-xs text-white/30 mb-3">{blockB.length} approved completion(s) with revenue sharing</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-black/20 rounded-xl p-3 text-center">
                      <p className="text-xs text-white/50 mb-1">Total to Pay Users</p>
                      <p className="text-xl font-bold text-emerald-400">{formatCurrency(blockBTotalToPayUsers)}</p>
                      <p className="text-xs text-white/30 mt-0.5">user share portions</p>
                    </div>
                    <div className="bg-black/20 rounded-xl p-3 text-center">
                      <p className="text-xs text-white/50 mb-1">Site Profit</p>
                      <p className="text-xl font-bold text-amber-400">{formatCurrency(blockBSiteProfit)}</p>
                      <p className="text-xs text-white/30 mt-0.5">platform's cut</p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}</>
          )}
        </div>
      )}


      {/* === PLATFORMS === */}
      {tab === "platforms" && (
        <div className="space-y-4">

          {/* Delete confirmation dialog */}
          {deletingPlatformId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="bg-slate-900 border border-red-500/30 rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-2xl">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-6 h-6 text-red-400 shrink-0" />
                  <div>
                    <p className="font-semibold text-white">Delete Platform?</p>
                    <p className="text-xs text-white/50 mt-1">All imported tasks will be preserved. This only removes the platform configuration and stops future imports.</p>
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button onClick={() => handleDeletePlatform(deletingPlatformId)} disabled={!!savingPlatformId}
                    className="flex-1 bg-red-500 hover:bg-red-400 text-white rounded-xl">
                    {savingPlatformId ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}
                    Yes, Delete
                  </Button>
                  <Button variant="outline" onClick={() => setDeletingPlatformId(null)}
                    className="flex-1 border-white/20 text-white/60 hover:text-white rounded-xl">Cancel</Button>
                </div>
              </div>
            </div>
          )}

          {/* Header + Add Button */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-white">Ad Network Platforms</h2>
              <p className="text-xs text-white/40 mt-0.5">Manage any advertising network without changing source code</p>
            </div>
            <Button onClick={() => { setShowPlatformForm(true); setEditingPlatformId(null); setNewPlatform(emptyPlatformForm); }}
              className="bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl">
              <Plus className="w-4 h-4 mr-1" />Add Platform
            </Button>
          </div>

          {/* Add / Edit Platform Form */}
          {showPlatformForm && (
            <div className="bg-white/5 border border-emerald-500/20 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-white text-sm">New Platform Configuration</h3>
                <button onClick={() => setShowPlatformForm(false)} className="text-white/40 hover:text-white text-xs">✕ Cancel</button>
              </div>

              {/* Quick-fill preset selector — driven by PLATFORM_REGISTRY */}
              {PLATFORM_REGISTRY.filter((p) => p.apiDefaults).length > 0 && (
                <div className="bg-emerald-500/8 border border-emerald-500/15 rounded-xl p-3">
                  <p className="text-xs text-white/40 mb-2">Quick setup — click a network to auto-fill known defaults:</p>
                  <div className="flex flex-wrap gap-2 items-center">
                    {PLATFORM_REGISTRY.filter((p) => p.apiDefaults).map((p) => (
                      <button key={p.id} type="button"
                        onClick={() => {
                          const d = p.apiDefaults!;
                          setNewPlatform((prev) => ({
                            ...prev,
                            name: p.id,
                            displayName: prev.displayName || p.displayName,
                            apiBase: d.apiBase ?? prev.apiBase,
                            authenticationType: (d.authType ?? prev.authenticationType) as ManagedPlatform["authenticationType"],
                            apiKeyParam: d.apiKeyParam ?? prev.apiKeyParam,
                            apiKeyHeaderName: d.apiKeyHeaderName ?? prev.apiKeyHeaderName,
                            endpoint: d.endpoint ?? prev.endpoint,
                            responsePath: d.responsePath ?? prev.responsePath,
                            offerMappingRaw: d.fieldMapping ?? prev.offerMappingRaw,
                            requestMethod: (d.requestMethod ?? prev.requestMethod) as "GET" | "POST",
                            queryParamsRaw: d.queryParams ?? prev.queryParamsRaw,
                          }));
                          toast({ title: `✅ ${p.displayName} preset loaded`, description: "Enter your API key, then save." });
                        }}
                        className="text-xs bg-white/10 hover:bg-white/15 border border-white/15 text-white/70 hover:text-white px-3 py-1.5 rounded-lg transition-colors">
                        {p.displayName}
                      </button>
                    ))}
                    <span className="text-xs text-white/25 ml-1">← auto-fills form</span>
                  </div>
                </div>
              )}

              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-white/50 mb-1 block">Platform ID (unique, no spaces) *</label>
                  <Input placeholder="e.g. adgem, lootably, myadnetwork" value={newPlatform.name}
                    onChange={(e) => setNewPlatform({ ...newPlatform, name: e.target.value.toLowerCase().replace(/\s+/g, "_") })}
                    className="bg-white/10 border-white/20 text-white" />
                </div>
                <div>
                  <label className="text-xs text-white/50 mb-1 block">Display Name</label>
                  <Input placeholder="e.g. AdGem, Lootably" value={newPlatform.displayName}
                    onChange={(e) => setNewPlatform({ ...newPlatform, displayName: e.target.value })}
                    className="bg-white/10 border-white/20 text-white" />
                </div>
                <div>
                  <label className="text-xs text-white/50 mb-1 block">API Base URL *</label>
                  <Input placeholder="https://api.example.com/v1" value={newPlatform.apiBase}
                    onChange={(e) => setNewPlatform({ ...newPlatform, apiBase: e.target.value })}
                    className="bg-white/10 border-white/20 text-white" />
                </div>
                <div>
                  <label className="text-xs text-white/50 mb-1 block">Endpoint Path</label>
                  <Input placeholder="/offers (appended to API Base)" value={newPlatform.endpoint}
                    onChange={(e) => setNewPlatform({ ...newPlatform, endpoint: e.target.value })}
                    className="bg-white/10 border-white/20 text-white" />
                </div>
                <div>
                  <label className="text-xs text-white/50 mb-1 block">Authentication Type</label>
                  <select value={newPlatform.authenticationType}
                    onChange={(e) => setNewPlatform({ ...newPlatform, authenticationType: e.target.value as ManagedPlatform["authenticationType"] })}
                    className="w-full bg-white/10 border border-white/20 text-white text-sm rounded-lg px-3 py-2">
                    <option value="queryParam">Query Parameter</option>
                    <option value="bearer">Bearer Token</option>
                    <option value="apiKeyHeader">API Key Header</option>
                    <option value="basicAuth">Basic Auth</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-white/50 mb-1 block">API Key / Secret</label>
                  <Input placeholder="Your API key or bearer token" value={newPlatform.apiKey}
                    onChange={(e) => setNewPlatform({ ...newPlatform, apiKey: e.target.value })}
                    className="bg-white/10 border-white/20 text-white font-mono text-sm" />
                </div>
                {newPlatform.authenticationType === "queryParam" && (
                  <div>
                    <label className="text-xs text-white/50 mb-1 block">Query Param Name for API Key</label>
                    <Input placeholder="api_key" value={newPlatform.apiKeyParam}
                      onChange={(e) => setNewPlatform({ ...newPlatform, apiKeyParam: e.target.value })}
                      className="bg-white/10 border-white/20 text-white" />
                  </div>
                )}
                {newPlatform.authenticationType === "apiKeyHeader" && (
                  <div>
                    <label className="text-xs text-white/50 mb-1 block">Header Name for API Key</label>
                    <Input placeholder="X-API-Key" value={newPlatform.apiKeyHeaderName}
                      onChange={(e) => setNewPlatform({ ...newPlatform, apiKeyHeaderName: e.target.value })}
                      className="bg-white/10 border-white/20 text-white" />
                  </div>
                )}
                {newPlatform.authenticationType === "basicAuth" && (
                  <div>
                    <label className="text-xs text-white/50 mb-1 block">Basic Auth Username</label>
                    <Input placeholder="username" value={newPlatform.basicAuthUser}
                      onChange={(e) => setNewPlatform({ ...newPlatform, basicAuthUser: e.target.value })}
                      className="bg-white/10 border-white/20 text-white" />
                  </div>
                )}
                <div>
                  <label className="text-xs text-white/50 mb-1 block">Response Path (where offers array lives)</label>
                  <Input placeholder="offers  or  data  or  results.items" value={newPlatform.responsePath}
                    onChange={(e) => setNewPlatform({ ...newPlatform, responsePath: e.target.value })}
                    className="bg-white/10 border-white/20 text-white" />
                </div>
                <div>
                  <label className="text-xs text-white/50 mb-1 block">Request Method</label>
                  <select value={newPlatform.requestMethod}
                    onChange={(e) => setNewPlatform({ ...newPlatform, requestMethod: e.target.value as "GET" | "POST" })}
                    className="w-full bg-white/10 border border-white/20 text-white text-sm rounded-lg px-3 py-2">
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                  </select>
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-white/50 mb-1 block">Extra Query Params (key: value, one per line)</label>
                  <textarea rows={3} placeholder={"limit: 50\ntype: 1\noutput: json"}
                    value={newPlatform.queryParamsRaw}
                    onChange={(e) => setNewPlatform({ ...newPlatform, queryParamsRaw: e.target.value })}
                    className="w-full bg-white/10 border border-white/20 text-white text-xs rounded-lg px-3 py-2 font-mono resize-none" />
                </div>
                <div>
                  <label className="text-xs text-white/50 mb-1 block">Custom Headers (key: value, one per line)</label>
                  <textarea rows={3} placeholder={"X-App-ID: yourappid\nAccept: application/json"}
                    value={newPlatform.headersRaw}
                    onChange={(e) => setNewPlatform({ ...newPlatform, headersRaw: e.target.value })}
                    className="w-full bg-white/10 border border-white/20 text-white text-xs rounded-lg px-3 py-2 font-mono resize-none" />
                </div>
                <div>
                  <label className="text-xs text-white/50 mb-1 block">Field Mapping (targetField: sourceField)</label>
                  <textarea rows={3} placeholder={"id: offer_id\ntitle: name\npayout: reward\nurl: link"}
                    value={newPlatform.offerMappingRaw}
                    onChange={(e) => setNewPlatform({ ...newPlatform, offerMappingRaw: e.target.value })}
                    className="w-full bg-white/10 border border-white/20 text-white text-xs rounded-lg px-3 py-2 font-mono resize-none" />
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-white/50 mb-1 block">Postback URL</label>
                  <Input placeholder="https://..." value={newPlatform.postbackUrl}
                    onChange={(e) => setNewPlatform({ ...newPlatform, postbackUrl: e.target.value })}
                    className="bg-white/10 border-white/20 text-white text-sm" />
                </div>
                <div>
                  <label className="text-xs text-white/50 mb-1 block">Auto-Import Interval (min)</label>
                  <Input type="number" value={newPlatform.importInterval}
                    onChange={(e) => setNewPlatform({ ...newPlatform, importInterval: parseInt(e.target.value) || 30 })}
                    className="bg-white/10 border-white/20 text-white" />
                </div>
                <div className="flex items-center gap-3 pt-5">
                  <button onClick={() => setNewPlatform({ ...newPlatform, enabled: !newPlatform.enabled })}
                    className={cn("w-10 h-5 rounded-full transition-all relative shrink-0", newPlatform.enabled ? "bg-emerald-500" : "bg-white/20")}>
                    <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all", newPlatform.enabled ? "right-0.5" : "left-0.5")} />
                  </button>
                  <span className="text-xs text-white/60">Enabled</span>
                  <button onClick={() => setNewPlatform({ ...newPlatform, autoImport: !newPlatform.autoImport })}
                    className={cn("w-10 h-5 rounded-full transition-all relative shrink-0 ml-3", newPlatform.autoImport ? "bg-blue-500" : "bg-white/20")}>
                    <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all", newPlatform.autoImport ? "right-0.5" : "left-0.5")} />
                  </button>
                  <span className="text-xs text-white/60">Auto-Import</span>
                </div>
              </div>

              <div className="flex gap-2 pt-2 border-t border-white/10">
                <Button onClick={handleAddPlatform} disabled={savingPlatformId === "new"}
                  className="bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl">
                  {savingPlatformId === "new" ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
                  Save Platform
                </Button>
                <Button variant="outline" onClick={() => setShowPlatformForm(false)}
                  className="border-white/20 text-white/60 hover:text-white rounded-xl">Cancel</Button>
              </div>
            </div>
          )}

          {/* Platform List */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white">Platforms ({platforms.length})</h3>
              <Button size="sm" variant="outline" onClick={fetchPlatforms} disabled={loadingPlatforms}
                className="border-white/20 text-white/60 hover:text-white h-8">
                <RefreshCw className={cn("w-3.5 h-3.5", loadingPlatforms && "animate-spin")} />
              </Button>
            </div>
            {loadingPlatforms ? (
              <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>
            ) : platforms.length === 0 ? (
              <div className="text-center py-10 space-y-3">
                <Zap className="w-8 h-8 text-white/15 mx-auto" />
                <p className="text-white/40 text-sm">No platforms configured yet</p>
                <Button size="sm" onClick={() => setShowPlatformForm(true)} className="bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl">
                  <Plus className="w-3.5 h-3.5 mr-1" />Add your first platform
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {platforms.map((p) => {
                  const isEditing = editingPlatformId === p.id;
                  const isSaving  = savingPlatformId  === p.id;
                  const isTesting  = testingPlatformId  === p.id;
                  const isImporting = importingPlatformId === p.id;
                  const statusCls = p.importStatus === "success" ? "text-emerald-400" : p.importStatus === "error" ? "text-red-400" : "text-white/30";
                  const statusIcon = p.importStatus === "success" ? <CheckCircle className="w-3 h-3" /> : p.importStatus === "error" ? <AlertCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />;

                  return (
                    <div key={p.id} className={cn("rounded-xl border bg-white/5 p-4 space-y-3 transition-colors",
                      p.enabled ? "border-white/10" : "border-white/5 opacity-60")}>

                      {/* Platform header row */}
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-white text-sm">{p.displayName || p.name}</span>
                            <span className="text-xs font-mono text-white/30 bg-white/5 px-1.5 py-0.5 rounded">{p.id}</span>
                            <Badge className={cn("text-xs border", p.enabled ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : "bg-white/10 text-white/40 border-white/10")}>
                              {p.enabled ? "Enabled" : "Disabled"}
                            </Badge>
                            {p.autoImport && (
                              <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30 text-xs border">Auto-Import</Badge>
                            )}
                          </div>
                          <p className="text-xs text-white/40 mt-0.5 truncate">{p.apiBase}{p.endpoint}</p>
                        </div>
                        <div className="shrink-0 text-right space-y-0.5">
                          <div className={cn("flex items-center justify-end gap-1 text-xs", statusCls)}>
                            {statusIcon}
                            <span className="capitalize">{p.importStatus || "Never imported"}</span>
                          </div>
                          {p.lastImportAt && (
                            <p className="text-xs text-white/25">Last: {new Date(p.lastImportAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                          )}
                        </div>
                      </div>

                      {/* Stats row */}
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="bg-white/5 rounded-lg px-2.5 py-1.5">
                          <p className="text-white/30">Auth</p>
                          <p className="text-white/70 font-medium capitalize">{p.authenticationType || "—"}</p>
                        </div>
                        <div className="bg-white/5 rounded-lg px-2.5 py-1.5">
                          <p className="text-white/30">Last Imported</p>
                          <p className="text-emerald-400 font-medium">{p.lastImportCount !== undefined ? `${p.lastImportCount} offers` : "—"}</p>
                        </div>
                        <div className="bg-white/5 rounded-lg px-2.5 py-1.5">
                          <p className="text-white/30">Duration</p>
                          <p className="text-white/70 font-medium">{p.lastImportDurationMs !== undefined ? `${(p.lastImportDurationMs / 1000).toFixed(1)}s` : "—"}</p>
                        </div>
                      </div>

                      {/* Error display */}
                      {p.lastError && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 flex items-start gap-2">
                          <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                          <p className="text-xs text-red-400/80 break-all">{p.lastError}</p>
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="flex gap-1.5 pt-1 border-t border-white/5 flex-wrap">
                        <Button size="sm" onClick={() => handleTestConnection(p)} disabled={isTesting || isImporting || isSaving}
                          variant="outline" className="border-blue-500/30 text-blue-300 hover:bg-blue-500/10 h-7 text-xs rounded-lg">
                          {isTesting ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Zap className="w-3 h-3 mr-1" />}
                          Test Connection
                        </Button>
                        <Button size="sm" onClick={() => handleRunImport(p)} disabled={isTesting || isImporting || isSaving || !p.enabled}
                          variant="outline" className="border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 h-7 text-xs rounded-lg">
                          {isImporting ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Download className="w-3 h-3 mr-1" />}
                          Import Now
                        </Button>
                        <Button size="sm" onClick={() => handleTogglePlatform(p)} disabled={isSaving}
                          variant="outline" className={cn("h-7 text-xs rounded-lg border", p.enabled ? "border-amber-500/30 text-amber-300 hover:bg-amber-500/10" : "border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10")}>
                          {isSaving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                          {p.enabled ? "Disable" : "Enable"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingPlatformId(isEditing ? null : p.id)}
                          className="border-white/20 text-white/60 hover:text-white h-7 text-xs rounded-lg">
                          <Pencil className="w-3 h-3 mr-1" />{isEditing ? "Cancel Edit" : "Edit"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setDeletingPlatformId(p.id)}
                          className="border-red-500/20 text-red-400/70 hover:text-red-300 hover:bg-red-500/10 h-7 text-xs rounded-lg ml-auto">
                          <Trash2 className="w-3 h-3 mr-1" />Delete
                        </Button>
                      </div>

                      {/* Inline edit form */}
                      {isEditing && (() => {
                        const editForm = {
                          name: p.name,
                          displayName: p.displayName,
                          enabled: p.enabled,
                          apiBase: p.apiBase,
                          endpoint: p.endpoint,
                          authenticationType: p.authenticationType,
                          apiKey: p.apiKey,
                          apiKeyParam: p.apiKeyParam,
                          apiKeyHeaderName: p.apiKeyHeaderName,
                          basicAuthUser: p.basicAuthUser,
                          requestMethod: p.requestMethod,
                          headersRaw: Object.entries(p.headers || {}).map(([k, v]) => `${k}: ${v}`).join("\n"),
                          queryParamsRaw: Object.entries(p.queryParameters || {}).map(([k, v]) => `${k}: ${v}`).join("\n"),
                          responsePath: p.responsePath,
                          offerMappingRaw: Object.entries(p.offerMapping || {}).map(([k, v]) => `${k}: ${v}`).join("\n"),
                          postbackUrl: p.postbackUrl,
                          autoImport: p.autoImport,
                          importInterval: p.importInterval,
                          rateLimit: p.rateLimit,
                        };
                        return (
                          <PlatformEditForm
                            key={p.id}
                            initialForm={editForm}
                            saving={isSaving}
                            onSave={(form) => handleSavePlatform(p.id, form)}
                            onCancel={() => setEditingPlatformId(null)}
                          />
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* === IMPORT TASKS === */}
      {tab === "import" && (
        <div className="space-y-4">

          {/* ── Import mode selector ───────────────────────────────────────── */}
          <div className="flex rounded-xl overflow-hidden border border-white/10 w-fit">
            <button
              onClick={() => setImportMode("api")}
              className={cn(
                "px-5 py-2 text-sm font-medium transition-colors",
                importMode === "api"
                  ? "bg-emerald-500 text-white"
                  : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white",
              )}
            >
              API Offers
            </button>
            <button
              onClick={() => setImportMode("locker")}
              className={cn(
                "px-5 py-2 text-sm font-medium transition-colors border-l border-white/10",
                importMode === "locker"
                  ? "bg-blue-500 text-white"
                  : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white",
              )}
            >
              Lockers
            </button>
          </div>

          {/* ══════════════════════════════════════════════════════════════════
              LOCKERS — Manual OGAds locker configuration manager
              Completely separate from the standard API offer pipeline.
              OGAds has no public REST API for listing locker configs;
              admins enter them manually from their OGAds dashboard.
          ══════════════════════════════════════════════════════════════════ */}
          {importMode === "locker" && (
            <div className="space-y-4">

              {/* Info banner */}
              <div className="bg-violet-500/10 border border-violet-500/20 rounded-2xl p-4 flex gap-3">
                <Lock className="w-5 h-5 text-violet-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-violet-300 font-medium text-sm">OGAds Locker Configurations</p>
                  <p className="text-violet-400/70 text-xs mt-1">
                    Manage your Content Lockers and URL Lockers created in the OGAds dashboard
                    (<span className="font-mono">members.ogads.com → Tools → Content Lockers</span>).
                    OGAds does not expose a public API to list these — add them here manually.
                    This section is completely separate from the standard API offer pipeline.
                  </p>
                </div>
              </div>

              {/* Header row: title + Add button */}
              <div className="flex items-center justify-between">
                <p className="text-white/50 text-sm">
                  {loadingLockers ? "Loading…" : `${lockers.length} locker${lockers.length !== 1 ? "s" : ""} configured`}
                </p>
                <Button
                  size="sm"
                  onClick={() => {
                    setEditingLockerId(null);
                    setLockerForm(BLANK_LOCKER_FORM);
                    setShowLockerForm(true);
                  }}
                  className="bg-violet-500 hover:bg-violet-400 text-white rounded-xl text-xs h-8"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Add Locker
                </Button>
              </div>

              {/* Add / Edit form */}
              {showLockerForm && (
                <div className="bg-white/5 border border-violet-500/30 rounded-2xl p-5 space-y-4">
                  <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                    <Lock className="w-4 h-4 text-violet-400" />
                    {editingLockerId ? "Edit Locker" : "Add New Locker"}
                  </h3>

                  {/* Name + Type row */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs text-white/50">Display Name *</label>
                      <Input
                        placeholder="e.g. My Content Locker"
                        value={lockerForm.name}
                        onChange={(e) => setLockerForm((f) => ({ ...f, name: e.target.value }))}
                        className="bg-white/5 border-white/15 text-white placeholder:text-white/30 text-xs h-9"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-white/50">Locker Type *</label>
                      <div className="flex rounded-lg overflow-hidden border border-white/15 h-9">
                        {(["content", "url"] as const).map((t) => (
                          <button
                            key={t}
                            onClick={() => setLockerForm((f) => ({ ...f, type: t }))}
                            className={cn(
                              "flex-1 text-xs font-medium transition-colors",
                              lockerForm.type === t
                                ? "bg-violet-500 text-white"
                                : "bg-white/5 text-white/40 hover:bg-white/10 hover:text-white",
                              t === "url" && "border-l border-white/15",
                            )}
                          >
                            {t === "content" ? "Content Locker" : "URL Locker"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Locker ID + Direct URL row */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs text-white/50">Locker ID</label>
                      <Input
                        placeholder="e.g. qkpro3"
                        value={lockerForm.lockerId}
                        onChange={(e) => setLockerForm((f) => ({ ...f, lockerId: e.target.value }))}
                        className="bg-white/5 border-white/15 text-white placeholder:text-white/30 font-mono text-xs h-9"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-white/50">Direct URL</label>
                      <Input
                        placeholder="https://lockedapp.org/cl/i/qkpro3"
                        value={lockerForm.directUrl}
                        onChange={(e) => setLockerForm((f) => ({ ...f, directUrl: e.target.value }))}
                        className="bg-white/5 border-white/15 text-white placeholder:text-white/30 text-xs h-9"
                      />
                    </div>
                  </div>

                  {/* Embed code */}
                  <div className="space-y-1.5">
                    <label className="text-xs text-white/50 flex items-center gap-1.5">
                      <Code className="w-3 h-3" /> Embed Code (JavaScript snippet)
                    </label>
                    <textarea
                      rows={4}
                      placeholder={"<script src=\"...\"></script>"}
                      value={lockerForm.embedCode}
                      onChange={(e) => setLockerForm((f) => ({ ...f, embedCode: e.target.value }))}
                      className="w-full bg-white/5 border border-white/15 rounded-lg text-white placeholder:text-white/20 font-mono text-xs p-3 resize-none focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                    />
                  </div>

                  {/* Notes */}
                  <div className="space-y-1.5">
                    <label className="text-xs text-white/50">Notes (optional)</label>
                    <Input
                      placeholder="e.g. Used on homepage, targets US traffic"
                      value={lockerForm.notes}
                      onChange={(e) => setLockerForm((f) => ({ ...f, notes: e.target.value }))}
                      className="bg-white/5 border-white/15 text-white placeholder:text-white/30 text-xs h-9"
                    />
                  </div>

                  {/* Form actions */}
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      onClick={saveLocker}
                      disabled={savingLocker}
                      className="bg-violet-500 hover:bg-violet-400 text-white rounded-xl text-xs h-8"
                    >
                      {savingLocker ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Check className="w-3.5 h-3.5 mr-1" />}
                      {editingLockerId ? "Save Changes" : "Add Locker"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { setShowLockerForm(false); setEditingLockerId(null); setLockerForm(BLANK_LOCKER_FORM); }}
                      className="border-white/20 text-white/50 hover:text-white rounded-xl text-xs h-8"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {/* Locker list */}
              {loadingLockers ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
                </div>
              ) : lockers.length === 0 && !showLockerForm ? (
                <div className="bg-white/3 border border-white/8 rounded-2xl p-10 flex flex-col items-center gap-3 text-center">
                  <Lock className="w-10 h-10 text-white/15" />
                  <p className="text-white/40 text-sm font-medium">No lockers configured yet</p>
                  <p className="text-white/25 text-xs max-w-xs">
                    Go to your OGAds dashboard → Tools → Content Lockers, then click
                    "Add Locker" above to record your locker details here.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {lockers.map((lk) => (
                    <div
                      key={lk.id}
                      className={cn(
                        "bg-white/5 border rounded-2xl p-4 flex items-start gap-4 transition-opacity",
                        lk.active ? "border-white/10" : "border-white/5 opacity-60",
                      )}
                    >
                      {/* Icon */}
                      <div className={cn(
                        "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                        lk.type === "content" ? "bg-violet-500/20" : "bg-blue-500/20",
                      )}>
                        <Lock className={cn("w-4 h-4", lk.type === "content" ? "text-violet-400" : "text-blue-400")} />
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-white truncate">{lk.name}</p>
                          <span className={cn(
                            "text-[10px] font-medium px-2 py-0.5 rounded-full border",
                            lk.type === "content"
                              ? "bg-violet-500/15 text-violet-300 border-violet-500/25"
                              : "bg-blue-500/15 text-blue-300 border-blue-500/25",
                          )}>
                            {lk.type === "content" ? "Content Locker" : "URL Locker"}
                          </span>
                          {!lk.active && (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/10 text-white/40 border border-white/10">
                              Inactive
                            </span>
                          )}
                        </div>

                        {lk.lockerId && (
                          <p className="text-xs text-white/40 font-mono">ID: {lk.lockerId}</p>
                        )}

                        {lk.directUrl && (
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs text-white/30 font-mono truncate max-w-xs">{lk.directUrl}</p>
                            <button
                              onClick={() => copyLockerUrl(lk)}
                              className="shrink-0 text-white/30 hover:text-white/70 transition-colors"
                              title="Copy URL"
                            >
                              {copiedLockerId === lk.id
                                ? <Check className="w-3 h-3 text-emerald-400" />
                                : <Copy className="w-3 h-3" />}
                            </button>
                            {lk.directUrl.startsWith("http") && (
                              <a
                                href={lk.directUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 text-white/30 hover:text-white/70 transition-colors"
                                title="Open URL"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        )}

                        {lk.embedCode && (
                          <div className="flex items-center gap-1.5">
                            <Code className="w-3 h-3 text-white/20 shrink-0" />
                            <p className="text-xs text-white/25 font-mono truncate max-w-xs">
                              {lk.embedCode.slice(0, 60)}{lk.embedCode.length > 60 ? "…" : ""}
                            </p>
                          </div>
                        )}

                        {lk.notes && (
                          <p className="text-xs text-white/30 italic">{lk.notes}</p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => toggleLockerActive(lk)}
                          title={lk.active ? "Deactivate" : "Activate"}
                          className={cn(
                            "text-xs px-2.5 py-1 rounded-lg border transition-colors",
                            lk.active
                              ? "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                              : "border-white/15 text-white/30 hover:bg-white/5",
                          )}
                        >
                          {lk.active ? "Active" : "Off"}
                        </button>
                        <button
                          onClick={() => {
                            setEditingLockerId(lk.id);
                            setLockerForm({
                              name:      lk.name,
                              type:      lk.type,
                              lockerId:  lk.lockerId,
                              directUrl: lk.directUrl,
                              embedCode: lk.embedCode,
                              notes:     lk.notes,
                            });
                            setShowLockerForm(true);
                          }}
                          className="p-1.5 text-white/30 hover:text-white transition-colors rounded-lg hover:bg-white/5"
                          title="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => deleteLocker(lk.id)}
                          disabled={deletingLockerId === lk.id}
                          className="p-1.5 text-white/30 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/10"
                          title="Delete"
                        >
                          {deletingLockerId === lk.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              API OFFERS — existing platform import (unchanged)
          ══════════════════════════════════════════════════════════════════ */}
          {importMode === "api" && (<div className="space-y-4">

          {/* Auto-Import Status */}
          <div className={cn("rounded-2xl p-4 border flex items-start gap-3",
            autoImportStatus === "running"   ? "bg-blue-500/10 border-blue-500/20"
            : autoImportStatus === "completed" ? "bg-emerald-500/10 border-emerald-500/20"
            : autoImportStatus === "error"     ? "bg-red-500/10 border-red-500/20"
            : "bg-white/5 border-white/10")}>
            <div className="shrink-0 mt-0.5">
              {autoImportStatus === "running"   ? <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
              : autoImportStatus === "completed" ? <CheckCircle className="w-5 h-5 text-emerald-400" />
              : autoImportStatus === "error"     ? <AlertTriangle className="w-5 h-5 text-red-400" />
              : <RefreshCw className="w-5 h-5 text-white/30" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <p className={cn("font-medium text-sm",
                  autoImportStatus === "running"   ? "text-blue-300"
                  : autoImportStatus === "completed" ? "text-emerald-300"
                  : autoImportStatus === "error"     ? "text-red-300"
                  : "text-white/50")}>
                  {autoImportStatus === "running"   ? "Auto-Import Running..."
                  : autoImportStatus === "completed" ? "Auto-Import Completed"
                  : autoImportStatus === "error"     ? "Auto-Import Error"
                  : "Auto-Import: Idle (enable Auto-Import on platforms to activate)"}
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => runAutoImport()}
                    disabled={autoImportStatus === "running"}
                    className="border-white/20 text-white/60 hover:text-white text-xs h-7">
                    <RefreshCw className="w-3 h-3 mr-1" />Run Now
                  </Button>
                </div>
              </div>
              {lastAutoImport && (
                <p className="text-xs text-white/30 mt-0.5">
                  Last run: {lastAutoImport.toLocaleTimeString("en-US")} •
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
                Add platforms in the Platforms tab with your API configuration. Click "Fetch Offers" to preview offers and select which ones to import as tasks.
                Enable "Auto-Import" on a platform to have it import automatically every 30 minutes. Duplicate detection uses externalId — already-imported offers are skipped.
              </p>
            </div>
          </div>

          {/* ── Postback URL blocks — auto-rendered from PLATFORM_REGISTRY ──────
               To add a new network: add ONE entry to src/lib/platforms.ts.
               No AdminPage edits needed.
          ─────────────────────────────────────────────────────────────────── */}
          {PLATFORM_REGISTRY.map((config) => {
            const fullUrl = postbackBaseUrl + config.postbackTemplate;
            return (
              <div key={config.id} className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-3">
                <h2 className="font-semibold text-white flex items-center gap-2">
                  <Link2 className={cn("w-4 h-4", PLATFORM_ACCENT_ICON[config.accentColor])} />
                  {config.displayName} — Postback URL
                </h2>
                <p className="text-xs text-white/40">
                  Paste into: <span className="text-white/70 font-medium">{config.postbackSetupHint}</span>
                  {config.postbackNote && (
                    <><br /><span className="text-white/30">{config.postbackNote}</span></>
                  )}
                </p>
                <div className="flex items-center gap-2">
                  <div className={cn("flex-1 bg-slate-900 border border-white/10 rounded-xl p-3 font-mono text-xs break-all", PLATFORM_ACCENT_TEXT[config.accentColor])}>
                    {fullUrl}
                  </div>
                  <Button size="sm" variant="outline"
                    onClick={() => { navigator.clipboard.writeText(fullUrl); toast({ title: "Copied!" }); }}
                    className="border-white/20 text-white/60 hover:text-white hover:bg-white/10 rounded-xl shrink-0">
                    <Copy className="w-3.5 h-3.5 mr-1" />Copy
                  </Button>
                </div>
              </div>
            );
          })}

          {/* Platform offer fetch cards — dynamic from Firestore */}
          {platforms.length === 0 ? (
            <div className="bg-white/3 border border-white/8 rounded-2xl py-12 text-center space-y-3">
              <Zap className="w-8 h-8 text-white/15 mx-auto" />
              <p className="text-white/40 text-sm">No platforms configured</p>
              <p className="text-white/25 text-xs">Add a platform in the Platforms tab to start importing offers</p>
              <Button size="sm" onClick={() => setTab("platforms")} variant="outline"
                className="border-white/20 text-white/60 hover:text-white rounded-xl">
                Go to Platforms
              </Button>
            </div>
          ) : (
            platforms.filter(p => p.enabled && p.apiBase).map((platform) => (
              <div key={platform.id} className="bg-white/5 border border-white/10 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-white flex items-center gap-2">
                      <Zap className="w-4 h-4 text-amber-400" />
                      {platform.displayName || platform.name}
                    </h3>
                    <p className="text-xs text-white/40 font-mono mt-0.5">{platform.apiBase}</p>
                  </div>
                  <Button size="sm" onClick={() => fetchOffersFromNetwork(platform.id)}
                    disabled={fetchingNetwork === platform.id}
                    className="bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 rounded-xl" variant="outline">
                    {fetchingNetwork === platform.id ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Download className="w-4 h-4 mr-1" />}
                    Fetch Offers
                  </Button>
                </div>

                {(importedOffersByPlatform[platform.id]?.length ?? 0) > 0 && fetchingNetwork !== platform.id && (() => {
                  const platformOffers   = importedOffersByPlatform[platform.id] ?? [];
                  const platformSelected = selectedImportOffersByPlatform[platform.id] ?? new Set<number>();
                  return (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-white/60">{platformOffers.length} offers found — select to import</p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline"
                          onClick={() => setSelectedImportOffersByPlatform((prev) => ({ ...prev, [platform.id]: new Set(platformOffers.map((_, i) => i)) }))}
                          className="border-white/20 text-white/60 hover:text-white text-xs h-7">Select All</Button>
                        <Button size="sm" variant="outline"
                          onClick={() => setSelectedImportOffersByPlatform((prev) => ({ ...prev, [platform.id]: new Set() }))}
                          className="border-white/20 text-white/60 hover:text-white text-xs h-7">Deselect All</Button>
                        <Button size="sm" onClick={() => importSelectedOffers(platform.id)} disabled={importingOffers || platformSelected.size === 0}
                          className="bg-emerald-500 hover:bg-emerald-400 text-white text-xs h-7 rounded-lg">
                          {importingOffers ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Download className="w-3 h-3 mr-1" />}
                          Import ({platformSelected.size})
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                      {platformOffers.map((offer, idx) => (
                        <label key={idx} className={cn("flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all",
                          platformSelected.has(idx) ? "border-emerald-500/40 bg-emerald-500/10" : "border-white/5 hover:border-white/10")}>
                          <input type="checkbox" checked={platformSelected.has(idx)}
                            onChange={(e) => {
                              const s = new Set(platformSelected);
                              e.target.checked ? s.add(idx) : s.delete(idx);
                              setSelectedImportOffersByPlatform((prev) => ({ ...prev, [platform.id]: s }));
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
                  );
                })()}
              </div>
            ))
          )}
          </div>)}

        </div>
      )}

      {/* === POSTBACKS === */}
      {tab === "postbacks" && (
        <div className="space-y-4">

          {/* ── Stats cards ─────────────────────────────────────────────── */}
          {conversionStats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4">
                <p className="text-xs text-emerald-300/70 mb-1">Settled</p>
                <p className="text-2xl font-bold text-white">{conversionStats.settled}</p>
                <p className="text-xs text-emerald-400 mt-1">{formatCurrency(conversionStats.totalSettledAmount)} total</p>
              </div>
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4">
                <p className="text-xs text-red-300/70 mb-1">Rejected / Failed</p>
                <p className="text-2xl font-bold text-white">{conversionStats.rejected + conversionStats.failed}</p>
                <p className="text-xs text-white/30 mt-1">{conversionStats.failed} validation failures</p>
              </div>
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-2xl p-4">
                <p className="text-xs text-yellow-300/70 mb-1">Duplicates Blocked</p>
                <p className="text-2xl font-bold text-white">{conversionStats.duplicates}</p>
                <p className="text-xs text-white/30 mt-1">replay-safe</p>
              </div>
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4">
                <p className="text-xs text-blue-300/70 mb-1">Total Received</p>
                <p className="text-2xl font-bold text-white">{conversionStats.total}</p>
                <p className="text-xs text-white/30 mt-1">avg {conversionStats.avgProcessingMs}ms</p>
              </div>
            </div>
          )}

          {/* ── Controls ────────────────────────────────────────────────── */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="font-semibold text-white flex items-center gap-2">
                <Link2 className="w-4 h-4 text-emerald-400" />Conversion History
              </h2>
              <Button size="sm" variant="outline" onClick={() => fetchConversions(postbackFilter, postbackPlatformFilter)} disabled={loadingPostbacks}
                className="border-white/20 text-white/60 hover:text-white">
                <RefreshCw className={cn("w-4 h-4 mr-1", loadingPostbacks && "animate-spin")} />Refresh
              </Button>
            </div>

            {/* Filter pills */}
            <div className="flex gap-2 flex-wrap mb-4">
              {(["all","settled","rejected","duplicate","invalid_signature","invalid_platform","replay_prevented"] as const).map((f) => (
                <button key={f} onClick={() => { setPostbackFilter(f); fetchConversions(f, postbackPlatformFilter); }}
                  className={cn("px-3 py-1 rounded-full text-xs font-medium transition-all border",
                    postbackFilter === f
                      ? "bg-emerald-500 text-white border-emerald-500"
                      : "bg-white/5 text-white/50 border-white/10 hover:border-white/20")}>
                  {f === "all" ? "All" : f === "settled" ? "✅ Settled" : f === "rejected" ? "❌ Rejected" : f === "duplicate" ? "↩ Duplicates" : f === "invalid_signature" ? "🔑 Bad Sig" : f === "invalid_platform" ? "⛔ Bad Platform" : "⏱ Replay"}
                </button>
              ))}
              {conversionStats && Object.keys(conversionStats.byPlatform).length > 0 && (
                <select value={postbackPlatformFilter}
                  onChange={(e) => { setPostbackPlatformFilter(e.target.value); fetchConversions(postbackFilter, e.target.value); }}
                  className="px-3 py-1 rounded-full text-xs bg-white/5 border border-white/10 text-white/60">
                  <option value="">All Platforms</option>
                  {Object.keys(conversionStats.byPlatform).map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              )}
            </div>

            {loadingPostbacks ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>
            ) : conversions.length === 0 ? (
              <div className="text-center py-12">
                <Link2 className="w-8 h-8 text-white/15 mx-auto mb-3" />
                <p className="text-white/40 text-sm">No conversions found</p>
                <p className="text-white/20 text-xs mt-1">Postbacks are processed automatically when ad networks send them</p>
              </div>
            ) : (
              <div className="space-y-2">
                {conversions.map((cv) => {
                  const isSettled  = cv.status === "settled";
                  const isRejected = cv.status === "rejected";
                  const isDupe     = cv.status === "duplicate";
                  const isFailed   = ["invalid_params","invalid_platform","invalid_signature","invalid_secret","replay_prevented"].includes(cv.status);
                  return (
                    <div key={cv.id} className={cn("border rounded-xl p-4", isSettled ? "bg-emerald-500/5 border-emerald-500/20" : isFailed ? "bg-red-500/5 border-red-500/20" : isDupe ? "bg-yellow-500/5 border-yellow-500/15" : "bg-white/5 border-white/10")}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <Badge className={cn("text-xs border shrink-0",
                              isSettled ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                              : isRejected ? "bg-orange-500/20 text-orange-300 border-orange-500/30"
                              : isDupe ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
                              : isFailed ? "bg-red-500/20 text-red-300 border-red-500/30"
                              : "bg-white/10 text-white/50 border-white/20")}>
                              {isSettled ? "✅ Settled" : isRejected ? "❌ Rejected" : isDupe ? "↩ Duplicate" : isFailed ? "⛔ " + cv.status.replace(/_/g," ") : cv.status}
                            </Badge>
                            <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30 text-xs shrink-0">
                              {cv.platformName || cv.platformId}
                            </Badge>
                            {cv.conversionStatus === "rejected" && cv.status !== "rejected" && (
                              <Badge className="bg-orange-500/15 text-orange-300/70 border-orange-500/20 text-xs shrink-0">platform: rejected</Badge>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-white/40">
                            <span>User: <span className="font-mono text-white/60 truncate">{cv.userId}</span></span>
                            <span>Task: <span className="font-mono text-white/60 truncate">{cv.taskId}</span></span>
                            {cv.externalConversionId && <span className="col-span-2">Conv ID: <span className="font-mono text-white/50">{cv.externalConversionId}</span></span>}
                            {cv.completionId && <span className="col-span-2">Completion: <span className="font-mono text-white/50">{cv.completionId}</span></span>}
                          </div>
                          {cv.error && (
                            <p className="text-xs text-red-400/80 mt-1.5 bg-red-500/10 rounded px-2 py-1">{cv.error}</p>
                          )}
                          <p className="text-xs text-white/20 mt-1.5">
                            {cv.receivedAt ? new Date(cv.receivedAt).toLocaleString("en-US") : "—"}
                            {cv.processingMs > 0 && <span className="ml-2">· {cv.processingMs}ms</span>}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className={cn("text-lg font-bold", isSettled ? "text-emerald-400" : "text-white/30")}>
                            {formatCurrency(cv.amount)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Platform breakdown ──────────────────────────────────────── */}
          {conversionStats && Object.keys(conversionStats.byPlatform).length > 0 && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <h3 className="font-semibold text-white text-sm mb-3">Per-Platform Summary</h3>
              <div className="grid md:grid-cols-2 gap-2">
                {Object.entries(conversionStats.byPlatform).map(([platform, data]) => (
                  <div key={platform} className="bg-white/3 border border-white/8 rounded-xl p-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-white">{platform}</p>
                      <p className="text-xs text-white/40">{data.total} total · {data.settled} settled</p>
                    </div>
                    <div className="text-right">
                      <p className="text-emerald-400 font-semibold text-sm">{formatCurrency(data.amount)}</p>
                      <p className="text-xs text-white/30">{data.total > 0 ? Math.round((data.settled / data.total) * 100) : 0}% success</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Recent log entries ──────────────────────────────────────── */}
          {conversionLogs.length > 0 && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <h3 className="font-semibold text-white text-sm mb-3">Recent Audit Log</h3>
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {conversionLogs.map((log) => (
                  <div key={log.id} className={cn("flex items-start gap-2 text-xs px-2 py-1.5 rounded-lg",
                    log.type === "settled" ? "text-emerald-400/80 bg-emerald-500/5"
                    : log.type === "duplicate" ? "text-yellow-400/70 bg-yellow-500/5"
                    : ["invalid_signature","replay_attack","invalid_platform","invalid_params","invalid_secret"].includes(log.type) ? "text-red-400/70 bg-red-500/5"
                    : "text-white/40 bg-white/3")}>
                    <span className="shrink-0 font-mono text-white/20 w-4">
                      {log.type === "settled" ? "✓" : log.type === "duplicate" ? "↩" : ["invalid_signature","replay_attack","invalid_platform","invalid_params","invalid_secret"].includes(log.type) ? "⛔" : "·"}
                    </span>
                    <span className="flex-1 truncate">
                      <span className="font-medium">[{log.platformId || "?"}]</span> {log.message}
                    </span>
                    <span className="shrink-0 text-white/20">{log.createdAt ? new Date(log.createdAt).toLocaleTimeString() : ""}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Postback URL reference ──────────────────────────────────── */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <h3 className="font-semibold text-white text-sm mb-2 flex items-center gap-2"><Link2 className="w-4 h-4 text-blue-400" />Your Postback URL</h3>
            <p className="text-xs text-white/40 mb-2">Use this URL in CPAGrip's Global Postback settings. CPAGrip macros: <code className="text-emerald-400">{"{tracking_id}"}</code> = combined user|task ID, <code className="text-emerald-400">{"{offer_id}"}</code> = offer ID, <code className="text-emerald-400">{"{payout}"}</code> = amount, <code className="text-emerald-400">{"{password}"}</code> = your postback secret.</p>
            <div className="bg-slate-900 border border-white/10 rounded-xl p-3 font-mono text-xs text-emerald-300 break-all mb-3">
              {postbackBaseUrl}?tracking_id={"{tracking_id}"}&offer_id={"{offer_id}"}&payout={"{payout}"}&password={"{password}"}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-white/50">
              {[
                ["tracking_id", "userId|taskId combined (pipe-separated)"],
                ["offer_id", "Ad network's offer / campaign ID"],
                ["payout", "Payout amount in USD"],
                ["password", "Postback secret from Settings tab"],
                ["sig", "Optional: HMAC-SHA256 signature"],
                ["ts", "Optional: Unix timestamp (replay guard)"],
              ].map(([param, desc]) => (
                <div key={param} className="flex gap-2">
                  <span className="font-mono text-blue-400/70 shrink-0">{param}</span>
                  <span className="text-white/30">{desc}</span>
                </div>
              ))}
            </div>
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
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
                    <span className="text-xs text-emerald-300/70">Total Revenue</span>
                  </div>
                  <div className="text-3xl font-bold text-white">{formatCurrency(analytics.totalRevenue)}</div>
                </div>
                <div className="bg-purple-500/10 border border-purple-500/20 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4 text-purple-400" />
                    <span className="text-xs text-purple-300/70">Manual Tasks Site Profit</span>
                  </div>
                  <div className="text-3xl font-bold text-white">{formatCurrency(analytics.manualTasksApprovedTotal)}</div>
                  <p className="text-xs text-white/40 mt-1">Platform cut from split tasks (Block B)</p>
                </div>
                <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4 text-cyan-400" />
                    <span className="text-xs text-cyan-300/70">Platform Tasks Revenue</span>
                  </div>
                  <div className="text-3xl font-bold text-white">{formatCurrency(analytics.platformTasksRevenue)}</div>
                  <p className="text-xs text-white/40 mt-1">Admin share ({100 - (parseFloat(platformTaskUserSharePercent) || 65)}%)</p>
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
                    <div key={u.uid} className="flex items-center justify-between gap-3 rounded-xl px-4 py-3 border bg-white/3 border-white/8">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-white truncate">{u.name}</p>
                          <span className={cn("text-xs px-1.5 py-0.5 rounded font-medium",
                            u.role === "admin"
                              ? "bg-purple-500/20 text-purple-300"
                              : "bg-white/10 text-white/40"
                          )}>{u.role}</span>
                        </div>
                        <p className="text-xs text-white/40 mt-0.5">{u.email}</p>
                        <div className="flex items-center gap-3 mt-0.5">
                          <p className="text-xs text-emerald-400">${u.balance.toFixed(4)}</p>
                          <p className="text-xs text-white/25 font-mono truncate max-w-[160px]" title={u.deviceFingerprint}>
                            fp: {u.deviceFingerprint.slice(0, 16) || "—"}
                          </p>
                          <p className="text-xs text-white/25">{formatDate(u.registeredAt)}</p>
                        </div>
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
                <p className="text-xs text-white/40 mb-2">Include this in your postback URL as <span className="font-mono text-emerald-400">?password=YOUR_SECRET</span></p>
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
                      onChange={(e) => setUsdtMin(e.target.value)}
                      className="bg-white/10 border-white/20 text-white" />
                  </div>
                  <div>
                    <label className="text-xs text-white/50 block mb-1">USDC Minimum</label>
                    <Input type="text" inputMode="decimal" pattern="[0-9.]*" lang="en" value={usdcMin}
                      onChange={(e) => setUsdcMin(e.target.value)}
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
                      onChange={(e) => setUsdtGas(e.target.value)}
                      className="bg-white/10 border-white/20 text-white" />
                  </div>
                  <div>
                    <label className="text-xs text-white/50 block mb-1">USDC TRC20 Gas</label>
                    <Input type="text" inputMode="decimal" pattern="[0-9.]*" lang="en" value={usdcTrc20Gas}
                      onChange={(e) => setUsdcTrc20Gas(e.target.value)}
                      className="bg-white/10 border-white/20 text-white" />
                  </div>
                  <div>
                    <label className="text-xs text-white/50 block mb-1">USDC ERC20 Gas</label>
                    <Input type="text" inputMode="decimal" pattern="[0-9.]*" lang="en" value={usdcErc20Gas}
                      onChange={(e) => setUsdcErc20Gas(e.target.value)}
                      className="bg-white/10 border-white/20 text-white" />
                  </div>
                </div>
              </div>

              {/* Platform task revenue split */}
              <div className="mb-4 pb-4 border-b border-white/10">
                <label className="text-xs text-white/50 block mb-1">Platform Task User Share %</label>
                <Input
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9.]*"
                  lang="en"
                  value={platformTaskUserSharePercent}
                  onChange={(e) => setPlatformTaskUserSharePercent(e.target.value)}
                  className="bg-white/10 border-white/20 text-white max-w-xs"
                />
                <p className="text-xs text-white/30 mt-1">
                  Default 65 (user) / 35 (admin). Applies to platform tasks only — manual tasks use the share set when creating each task.
                </p>
              </div>

              {/* Commission & Schedule */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-white/50 block mb-1">Withdrawal Fee / Commission (%)</label>
                  <Input type="text" inputMode="decimal" pattern="[0-9.]*" lang="en" value={withdrawalFeePercent}
                    onChange={(e) => setWithdrawalFeePercent(e.target.value)}
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

          <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4 flex gap-3">
            <AlertCircle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-blue-300 font-medium text-sm">Platform API Keys</p>
              <p className="text-blue-400/70 text-xs mt-1">
                API keys are now managed per-platform in the <strong>Platforms</strong> tab. Each platform has its own API key stored securely in Firestore — no more hardcoded keys in Settings. Go to the Platforms tab to add or edit platform configurations.
              </p>
            </div>
          </div>

          <Button onClick={handleSaveSettings} disabled={savingSettings}
            className="bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl px-8">
            {savingSettings ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Save All Settings
          </Button>



          {/* ── DATA RESET ── */}
          <div className="bg-red-500/5 border border-red-500/25 rounded-2xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="font-semibold text-red-400">Test Data Reset</h2>
                <p className="text-xs text-white/40 mt-1">
                  Permanently deletes ALL manual tasks, ALL manual task completions, and resets ALL user balances to zero. Use only for clean testing environments.
                </p>
              </div>
            </div>
            {resetConfirmOpen ? (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 space-y-3">
                <p className="text-sm font-medium text-red-300">Are you absolutely sure? This cannot be undone.</p>
                <div className="flex gap-2">
                  <Button onClick={handleResetTestData} disabled={resetting}
                    className="bg-red-500 hover:bg-red-400 text-white rounded-xl">
                    {resetting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
                    Yes, Reset Everything
                  </Button>
                  <Button variant="outline" onClick={() => setResetConfirmOpen(false)} disabled={resetting}
                    className="border-white/20 text-white/60 hover:text-white rounded-xl">
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button onClick={() => setResetConfirmOpen(true)}
                variant="outline"
                className="border-red-500/40 text-red-400 hover:bg-red-500/10 rounded-xl">
                <Trash2 className="w-4 h-4 mr-2" />Reset All Test Data
              </Button>
            )}
          </div>

          {/* Email Ban System */}
          <div className="bg-orange-500/5 border border-orange-500/20 rounded-2xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-orange-400 flex items-center gap-2"><ShieldX className="w-4 h-4" />Email Ban System</h2>
              <button onClick={fetchBannedEmails} disabled={loadingBannedEmails} className="text-xs text-white/40 hover:text-white/70 transition-colors">
                {loadingBannedEmails ? "Loading..." : `Refresh (${bannedEmails.length})`}
              </button>
            </div>
            <p className="text-xs text-white/40">Banned emails are blocked from logging in and registering. The check runs in real-time — a logged-in user is kicked out immediately when their email is banned.</p>

            <div className="space-y-3">
              <Input
                value={banEmailInput}
                onChange={(e) => setBanEmailInput(e.target.value)}
                type="email"
                placeholder="Email address to ban (e.g. badactor@gmail.com)"
                className="bg-white/10 border-orange-500/30 text-white placeholder:text-white/30"
              />
              <Input
                value={banEmailReason}
                onChange={(e) => setBanEmailReason(e.target.value)}
                placeholder="Reason (shown to user in the error banner)"
                className="bg-white/10 border-orange-500/30 text-white placeholder:text-white/30"
              />
              <Button
                onClick={banEmailAddress}
                disabled={banningEmail}
                className="bg-orange-500 hover:bg-orange-400 text-white rounded-xl"
              >
                {banningEmail ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldX className="w-4 h-4 mr-2" />}
                Ban Email Address
              </Button>
            </div>

            {bannedEmails.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-white/70 mb-3">Banned Emails ({bannedEmails.length})</h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {bannedEmails.map((b) => (
                    <div key={b.email} className="flex items-center justify-between gap-3 bg-orange-500/5 border border-orange-500/10 rounded-xl p-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-orange-300 truncate font-medium">{b.email}</p>
                        {b.reason && <p className="text-xs text-white/40 mt-0.5">{b.reason}</p>}
                        <p className="text-xs text-white/25 mt-0.5">{formatDate(b.bannedAt)} · by {b.bannedBy}</p>
                      </div>
                      <button
                        onClick={() => unbanEmailAddress(b.email)}
                        className="shrink-0 flex items-center gap-1 text-xs text-orange-400/60 hover:text-orange-300 transition-colors px-2 py-1 rounded-lg hover:bg-orange-500/10"
                      >
                        <ShieldOff className="w-3 h-3" />Unban
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {bannedEmails.length === 0 && (
              <button onClick={fetchBannedEmails} disabled={loadingBannedEmails} className="w-full text-xs text-white/30 hover:text-white/50 py-2 transition-colors">
                {loadingBannedEmails ? "Loading..." : "Click to load banned emails"}
              </button>
            )}
          </div>

        </div>
      )}

      {/* ── System Messages / Broadcast ── */}
      {tab === "messages" && (
        <div className="space-y-4">
          {/* Compose new message */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-1 flex items-center gap-2">
              📢 Broadcast System Message
            </h2>
            <p className="text-xs text-white/40 mb-5">
              Broadcast a notification to all users in real time. Messages appear immediately in every user's Notification Center.
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-white/60 block mb-1">Title</label>
                <Input
                  value={newSysMsgTitle}
                  onChange={(e) => setNewSysMsgTitle(e.target.value)}
                  placeholder="e.g. Scheduled Maintenance Tonight"
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/30"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-white/60 block mb-1">Message</label>
                <textarea
                  value={newSysMsgBody}
                  onChange={(e) => setNewSysMsgBody(e.target.value)}
                  rows={3}
                  placeholder="Enter the message body..."
                  className="w-full bg-white/10 border border-white/20 text-white rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:border-emerald-400 resize-none"
                />
              </div>
              <Button
                onClick={sendSystemMessage}
                disabled={sendingSysMsg || !newSysMsgTitle.trim() || !newSysMsgBody.trim()}
                className="bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl"
              >
                {sendingSysMsg ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                📢 Send to All Users
              </Button>
            </div>
          </div>

          {/* Active system messages list */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white text-sm">Active Broadcasts</h3>
              <Button
                size="sm"
                variant="outline"
                onClick={fetchSysMessages}
                disabled={loadingSysMsg}
                className="border-white/20 text-white/60 hover:text-white text-xs h-7"
              >
                {loadingSysMsg ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                Refresh
              </Button>
            </div>
            {sysMessages.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-white/30 text-sm">No active broadcasts</p>
                <button
                  onClick={fetchSysMessages}
                  className="text-xs text-white/20 hover:text-white/40 mt-2 transition-colors"
                >
                  {loadingSysMsg ? "Loading..." : "Click Refresh to load"}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {sysMessages.map((m) => (
                  <div key={m.id} className="flex items-start justify-between gap-3 bg-white/5 border border-white/10 rounded-xl p-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white">{m.title}</p>
                      <p className="text-xs text-white/50 mt-0.5 leading-relaxed">{m.message}</p>
                      <p className="text-xs text-white/25 mt-1.5">{formatDate(m.createdAt)}</p>
                    </div>
                    <button
                      onClick={() => archiveSysMessage(m.id)}
                      className="shrink-0 text-xs text-red-400/60 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10"
                    >
                      Archive
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Archived broadcasts */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white text-sm">Archived Broadcasts</h3>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  if (!showArchivedMsg) await fetchArchivedMessages();
                  setShowArchivedMsg((v) => !v);
                }}
                disabled={loadingArchivedMsg}
                className="border-white/20 text-white/60 hover:text-white text-xs h-7"
              >
                {loadingArchivedMsg ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                {showArchivedMsg ? "Hide" : "Show Archive"}
              </Button>
            </div>
            {showArchivedMsg && (
              archivedMessages.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-white/30 text-sm">No archived broadcasts</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {archivedMessages.map((m) => (
                    <div key={m.id} className="flex items-start justify-between gap-3 bg-white/3 border border-white/5 rounded-xl p-4 opacity-70">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white/70">{m.title}</p>
                        <p className="text-xs text-white/40 mt-0.5 leading-relaxed">{m.message}</p>
                        <p className="text-xs text-white/20 mt-1.5">{formatDate(m.createdAt)} · archived</p>
                      </div>
                      <button
                        onClick={() => reactivateSysMessage(m.id)}
                        className="shrink-0 text-xs text-emerald-400/60 hover:text-emerald-400 transition-colors px-2 py-1 rounded-lg hover:bg-emerald-500/10 whitespace-nowrap"
                      >
                        Reactivate
                      </button>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
