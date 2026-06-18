import { useAuth } from "@/contexts/AuthContext";
import { useTask } from "@/contexts/TaskContext";
import { formatCurrency } from "@/lib/utils";
import {
  Wallet, Clock, ListTodo, CheckCircle, XCircle, TrendingUp,
  ArrowDownToLine, AlertTriangle, Zap, Star, ChevronRight,
  Users, ShieldCheck, RefreshCw, BarChart3, Target, Activity,
} from "lucide-react";
import { Link } from "wouter";
import { useEffect, useState } from "react";
import { getSettings, AppSettings } from "@/lib/settings";
import {
  collection, getDocs, query, where, Timestamp, doc, getDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { cn } from "@/lib/utils";

// ── Lightweight chart components (pure CSS / SVG — no external deps) ────────

function BarChart({
  data,
  accent = "#10b981",
  height = 64,
}: {
  data: { label: string; value: number }[];
  accent?: string;
  height?: number;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-1" style={{ height: height + 20 }}>
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1">
          <div className="w-full flex items-end" style={{ height }}>
            <div
              className="w-full rounded-t-md transition-all"
              style={{
                height: `${Math.max(4, (d.value / max) * 100)}%`,
                backgroundColor: d.value > 0 ? accent : "rgba(255,255,255,0.06)",
                opacity: 0.75 + (d.value / max) * 0.25,
              }}
              title={String(d.value)}
            />
          </div>
          <span className="text-[9px] text-white/25 truncate w-full text-center">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

function DonutRing({
  percent,
  size = 72,
  stroke = 8,
  color = "#10b981",
}: {
  percent: number;
  size?: number;
  stroke?: number;
  color?: string;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(1, percent / 100));
  const cx = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cx} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} fill="none" />
      <circle
        cx={cx} cy={cx} r={r}
        stroke={color}
        strokeWidth={stroke}
        fill="none"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${cx} ${cx})`}
        strokeLinecap="round"
      />
    </svg>
  );
}

function HBarChart({
  data,
  accent = "#10b981",
}: {
  data: { label: string; value: number }[];
  accent?: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-2">
      {data.map((d, i) => (
        <div key={i} className="space-y-0.5">
          <div className="flex items-center justify-between text-xs text-white/50">
            <span className="truncate max-w-[120px]">{d.label}</span>
            <span className="font-medium text-white/70">{d.value}</span>
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${(d.value / max) * 100}%`, backgroundColor: accent }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Metric card ──────────────────────────────────────────────────────────────

function MetricCard({
  icon,
  label,
  value,
  sub,
  accent,
  testId,
  large = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent: string;
  testId?: string;
  large?: boolean;
}) {
  const bg: Record<string, string> = {
    emerald: "border-emerald-500/20 bg-emerald-500/8",
    amber: "border-amber-500/20 bg-amber-500/8",
    blue: "border-blue-500/20 bg-blue-500/8",
    purple: "border-purple-500/20 bg-purple-500/8",
    red: "border-red-500/20 bg-red-500/8",
    cyan: "border-cyan-500/20 bg-cyan-500/8",
    indigo: "border-indigo-500/20 bg-indigo-500/8",
    rose: "border-rose-500/20 bg-rose-500/8",
  };
  return (
    <div
      data-testid={testId}
      className={cn("border rounded-2xl p-4 flex flex-col gap-2", bg[accent] || bg.emerald)}
    >
      <div className="flex items-center justify-between">
        <div>{icon}</div>
      </div>
      <p className={cn("font-bold text-white leading-tight break-all", large ? "text-2xl" : "text-lg")}>
        {value}
      </p>
      <div>
        <p className="text-xs text-white/50 font-medium">{label}</p>
        {sub && <p className="text-[11px] text-white/30 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── Admin stats type ─────────────────────────────────────────────────────────

interface AdminStats {
  imported: number;
  published: number;
  hidden: number;
  draft: number;
  platformPending: number;
  platformApproved: number;
  manualPending: number;
  approvedToday: number;
  rejectedToday: number;
  totalUsers: number;
  totalBalance: number;
  totalPendingBalance: number;
  platformDistribution: { label: string; value: number }[];
  loading: boolean;
}

// ── Admin Dashboard ──────────────────────────────────────────────────────────

function AdminDashboard() {
  const { profile } = useAuth();
  const [stats, setStats] = useState<AdminStats>({
    imported: 0, published: 0, hidden: 0, draft: 0,
    platformPending: 0, platformApproved: 0, manualPending: 0,
    approvedToday: 0, rejectedToday: 0,
    totalUsers: 0, totalBalance: 0, totalPendingBalance: 0,
    platformDistribution: [], loading: true,
  });

  useEffect(() => {
    async function fetchAdminStats() {
      try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayTs = Timestamp.fromDate(todayStart);

        const [tasksSnap, usersSnap, pendingSnap, todaySnap] = await Promise.all([
          getDocs(collection(db, "tasks")),
          getDocs(collection(db, "users")),
          getDocs(query(
            collection(db, "taskCompletions"),
            where("status", "in", ["pending", "platform_pending", "platform_approved"])
          )),
          getDocs(query(
            collection(db, "taskCompletions"),
            where("settledAt", ">=", todayTs)
          )),
        ]);

        // Task breakdown
        const allTasks = tasksSnap.docs.map((d) => d.data());
        const imported = allTasks.filter((t) => t.taskType === "platform").length;
        const published = allTasks.filter((t) => t.status === "published" && t.active !== false).length;
        const hidden = allTasks.filter((t) => t.active === false).length;
        const draft = allTasks.filter((t) => t.status === "draft").length;

        // Platform distribution (top 6)
        const platCounts: Record<string, number> = {};
        allTasks.forEach((t) => {
          const name = (t.platform as string) || "Unknown";
          platCounts[name] = (platCounts[name] || 0) + 1;
        });
        const platformDistribution = Object.entries(platCounts)
          .map(([label, value]) => ({ label, value }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 6);

        // User stats
        let totalBalance = 0;
        let totalPendingBalance = 0;
        usersSnap.docs.forEach((d) => {
          totalBalance += Number(d.data().balance || 0);
          totalPendingBalance += Number(d.data().pendingBalance || 0);
        });

        // Pending review breakdown
        const pendingData = pendingSnap.docs.map((d) => d.data());
        const platformPending = pendingData.filter((c) => c.status === "platform_pending").length;
        const platformApproved = pendingData.filter((c) => c.status === "platform_approved").length;
        const manualPending = pendingData.filter((c) => c.status === "pending").length;

        // Today's settled
        const todayData = todaySnap.docs.map((d) => d.data());
        const approvedToday = todayData.filter((c) => c.status === "approved").length;
        const rejectedToday = todayData.filter((c) => c.status === "rejected").length;

        setStats({
          imported, published, hidden, draft,
          platformPending, platformApproved, manualPending,
          approvedToday, rejectedToday,
          totalUsers: usersSnap.size,
          totalBalance, totalPendingBalance,
          platformDistribution,
          loading: false,
        });
      } catch {
        setStats((s) => ({ ...s, loading: false }));
      }
    }

    fetchAdminStats();
  }, []);

  const totalPendingReviews = stats.platformPending + stats.platformApproved + stats.manualPending;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600/20 to-indigo-600/10 border border-purple-500/20 rounded-2xl p-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Admin Dashboard</h1>
            <p className="text-purple-300/60 text-sm mt-0.5">
              Welcome back, {profile?.name} · Platform overview
            </p>
          </div>
        </div>
      </div>

      {/* Task breakdown */}
      <div>
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <ListTodo className="w-3.5 h-3.5" />Tasks
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard icon={<BarChart3 className="w-4 h-4 text-cyan-400" />}   label="Imported Tasks"   value={String(stats.imported)}  accent="cyan"    testId="admin-stat-imported" />
          <MetricCard icon={<CheckCircle className="w-4 h-4 text-emerald-400"/>} label="Published Tasks"  value={String(stats.published)} accent="emerald" testId="admin-stat-published" />
          <MetricCard icon={<XCircle className="w-4 h-4 text-red-400" />}       label="Hidden Tasks"     value={String(stats.hidden)}    accent="red"     testId="admin-stat-hidden" />
          <MetricCard icon={<Target className="w-4 h-4 text-amber-400" />}      label="Draft Tasks"      value={String(stats.draft)}     accent="amber"   testId="admin-stat-draft" />
        </div>
      </div>

      {/* Review queue */}
      <div>
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5" />Review Queue
          {totalPendingReviews > 0 && (
            <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded-full text-[10px] font-bold">
              {totalPendingReviews} pending
            </span>
          )}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            icon={<Clock className="w-4 h-4 text-amber-400" />}
            label="Platform Pending"
            value={String(stats.platformPending)}
            sub="awaiting postback"
            accent="amber"
            testId="admin-stat-plat-pending"
          />
          <MetricCard
            icon={<RefreshCw className="w-4 h-4 text-blue-400" />}
            label="Platform Reviews"
            value={String(stats.platformApproved)}
            sub="waiting admin action"
            accent="blue"
            testId="admin-stat-plat-approved"
          />
          <MetricCard
            icon={<CheckCircle className="w-4 h-4 text-emerald-400" />}
            label="Approved Today"
            value={String(stats.approvedToday)}
            sub="settled today"
            accent="emerald"
            testId="admin-stat-approved-today"
          />
          <MetricCard
            icon={<XCircle className="w-4 h-4 text-red-400" />}
            label="Rejected Today"
            value={String(stats.rejectedToday)}
            sub="settled today"
            accent="red"
            testId="admin-stat-rejected-today"
          />
        </div>
        {stats.manualPending > 0 && (
          <div className="mt-3 flex items-center gap-3 bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-sm text-amber-300">
              <strong>{stats.manualPending}</strong> manual task{stats.manualPending !== 1 ? "s" : ""} pending admin review
            </span>
            <Link href="/admin">
              <span className="ml-auto text-xs text-amber-400/70 hover:text-amber-300 cursor-pointer font-medium whitespace-nowrap">
                Review →
              </span>
            </Link>
          </div>
        )}
      </div>

      {/* Platform stats + distribution */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* User & balance stats */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
          <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" />Platform Stats
          </h3>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-2xl font-bold text-white">{stats.totalUsers}</p>
              <p className="text-[11px] text-white/40 mt-0.5">Total Users</p>
            </div>
            <div className="border-x border-white/5">
              <p className="text-xl font-bold text-emerald-400">{formatCurrency(stats.totalBalance)}</p>
              <p className="text-[11px] text-white/40 mt-0.5">Available</p>
            </div>
            <div>
              <p className="text-xl font-bold text-amber-400">{formatCurrency(stats.totalPendingBalance)}</p>
              <p className="text-[11px] text-white/40 mt-0.5">Pending</p>
            </div>
          </div>
          <div className="pt-3 border-t border-white/5">
            <p className="text-xs text-white/30 text-center">
              Total rewards on platform: {formatCurrency(stats.totalBalance + stats.totalPendingBalance)}
            </p>
          </div>
        </div>

        {/* Platform distribution */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-3">
          <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider flex items-center gap-1.5">
            <BarChart3 className="w-3.5 h-3.5" />Platform Distribution
          </h3>
          {stats.loading ? (
            <div className="flex items-center justify-center h-20 text-white/20 text-xs">Loading…</div>
          ) : stats.platformDistribution.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-white/20 text-xs">No platform data</div>
          ) : (
            <HBarChart data={stats.platformDistribution} accent="#10b981" />
          )}
        </div>
      </div>

      {/* Quick links */}
      <div className="flex gap-3 flex-wrap">
        <Link href="/admin">
          <button className="flex items-center gap-2 px-4 py-2 bg-purple-500/10 border border-purple-500/20 rounded-xl text-sm text-purple-300 hover:bg-purple-500/20 transition-all">
            <ShieldCheck className="w-4 h-4" />Open Admin Panel
          </button>
        </Link>
        <Link href="/admin/users">
          <button className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white/60 hover:bg-white/10 transition-all">
            <Users className="w-4 h-4" />Manage Devices
          </button>
        </Link>
      </div>
    </div>
  );
}

// ── User Dashboard ───────────────────────────────────────────────────────────

function UserDashboard() {
  const { profile } = useAuth();
  const { tasks, completions } = useTask();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [warningMessage, setWarningMessage] = useState("");

  useEffect(() => {
    getSettings().then(setSettings);
    (async () => {
      try {
        const snap = await getDoc(doc(db, "settings", "general"));
        if (snap.exists()) {
          const data = snap.data() as Record<string, unknown>;
          if (data?.dashboardWarningEnabled) {
            setWarningMessage(String(data?.dashboardWarningMessage || ""));
          }
        }
      } catch {
        /* non-critical */
      }
    })();
  }, []);

  // ── Computed metrics from existing realtime data ──
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const platformPending  = completions.filter((c) => c.status === "platform_pending").length;
  const platformApproved = completions.filter((c) => c.status === "platform_approved").length;
  const manualPending    = completions.filter((c) => c.status === "pending").length;
  const approvedCount    = completions.filter((c) => c.status === "approved").length;
  const rejectedCount    = completions.filter((c) => c.status === "rejected").length;
  const totalPending     = platformPending + platformApproved + manualPending;

  const todayEarnings = completions
    .filter((c) => c.status === "approved" && c.completedAt >= todayStart)
    .reduce((sum, c) => sum + c.reward, 0);

  const totalEarnings = completions
    .filter((c) => c.status === "approved")
    .reduce((sum, c) => sum + c.reward, 0);

  const settledCount  = approvedCount + rejectedCount;
  const successRate   = settledCount > 0 ? Math.round((approvedCount / settledCount) * 100) : 0;

  const balance       = profile?.balance ?? 0;
  const pendingBal    = profile?.pendingBalance ?? 0;
  const minWithdrawal = settings?.usdtMin ?? 10;
  const progressPct   = Math.min(100, (balance / minWithdrawal) * 100);
  const canWithdraw   = balance >= minWithdrawal;

  // ── Last 7-day activity chart (from completions in memory) ──
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d;
  });
  const dailyActivity = last7.map((day) => ({
    label: day.toLocaleDateString("en", { weekday: "short" }),
    value: completions.filter((c) => c.completedAt.toDateString() === day.toDateString()).length,
  }));

  const simpleTasks  = tasks.filter((t) => t.type === "simple");
  const premiumTasks = tasks.filter((t) => t.type === "premium");

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div className="bg-gradient-to-r from-emerald-600/20 to-teal-600/10 border border-emerald-500/20 rounded-2xl p-6">
        <h1 className="text-2xl font-bold text-white">Welcome back, {profile?.name} 👋</h1>
        <p className="text-emerald-300/60 mt-1 text-sm">
          {totalEarnings > 0
            ? `You've earned ${formatCurrency(totalEarnings)} so far — keep going!`
            : "Complete tasks to start earning USDT"}
        </p>
      </div>

      {/* Warning */}
      {warningMessage && (
        <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-300/80 leading-relaxed">{warningMessage}</p>
          </div>
        </div>
      )}

      {/* Row 1 — balances & success rate */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          icon={<Wallet className="w-4 h-4 text-emerald-400" />}
          label="Available Balance"
          value={formatCurrency(balance)}
          sub="ready to withdraw"
          accent="emerald"
          testId="stat-balance"
          large
        />
        <MetricCard
          icon={<Clock className="w-4 h-4 text-amber-400" />}
          label="Pending Balance"
          value={formatCurrency(pendingBal)}
          sub="awaiting approval"
          accent="amber"
          testId="stat-pending"
          large
        />
        <MetricCard
          icon={<ListTodo className="w-4 h-4 text-blue-400" />}
          label="Available Tasks"
          value={String(tasks.length)}
          sub={`${simpleTasks.length} simple · ${premiumTasks.length} premium`}
          accent="blue"
          testId="stat-available-tasks"
        />
        <div className="border border-white/10 bg-white/5 rounded-2xl p-4 flex flex-col items-center justify-center gap-1"
          data-testid="stat-success-rate">
          <div className="relative">
            <DonutRing
              percent={successRate}
              size={68}
              stroke={7}
              color={successRate >= 70 ? "#10b981" : successRate >= 40 ? "#f59e0b" : "#ef4444"}
            />
            <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white">
              {successRate}%
            </span>
          </div>
          <p className="text-xs text-white/50 text-center font-medium">Success Rate</p>
          <p className="text-[10px] text-white/25 text-center">{settledCount} settled tasks</p>
        </div>
      </div>

      {/* Row 2 — completion statuses */}
      <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
        <MetricCard
          icon={<Clock className="w-4 h-4 text-amber-400" />}
          label="Platform Pending"
          value={String(platformPending)}
          sub="awaiting postback"
          accent="amber"
          testId="stat-platform-pending"
        />
        <MetricCard
          icon={<RefreshCw className="w-4 h-4 text-blue-400" />}
          label="Admin Review"
          value={String(platformApproved + manualPending)}
          sub="waiting admin"
          accent="blue"
          testId="stat-admin-review"
        />
        <MetricCard
          icon={<CheckCircle className="w-4 h-4 text-emerald-400" />}
          label="Approved Tasks"
          value={String(approvedCount)}
          accent="emerald"
          testId="stat-approved"
        />
        <MetricCard
          icon={<XCircle className="w-4 h-4 text-red-400" />}
          label="Rejected Tasks"
          value={String(rejectedCount)}
          accent="red"
          testId="stat-rejected"
        />
        <MetricCard
          icon={<TrendingUp className="w-4 h-4 text-purple-400" />}
          label="Today's Earnings"
          value={formatCurrency(todayEarnings)}
          sub="approved today"
          accent="purple"
          testId="stat-today-earnings"
        />
      </div>

      {/* Charts row */}
      {completions.length > 0 && (
        <div className="grid md:grid-cols-2 gap-4">
          {/* 7-day activity */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">7-Day Activity</h3>
              <span className="text-xs text-white/30">{completions.length} total tasks</span>
            </div>
            <BarChart data={dailyActivity} accent="#10b981" height={72} />
          </div>

          {/* Approval breakdown */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-white mb-4">Completion Breakdown</h3>
            <div className="space-y-3">
              {[
                { label: "Approved", value: approvedCount, color: "#10b981", bg: "bg-emerald-500/20 text-emerald-300" },
                { label: "Pending Review", value: totalPending, color: "#f59e0b", bg: "bg-amber-500/20 text-amber-300" },
                { label: "Rejected", value: rejectedCount, color: "#ef4444", bg: "bg-red-500/20 text-red-300" },
              ].map((row) => {
                const pct = completions.length > 0 ? Math.round((row.value / completions.length) * 100) : 0;
                return (
                  <div key={row.label} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white/50">{row.label}</span>
                      <span className={cn("px-1.5 py-0.5 rounded-full font-medium", row.bg)}>
                        {row.value} ({pct}%)
                      </span>
                    </div>
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: row.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 pt-3 border-t border-white/5 flex justify-between text-xs text-white/30">
              <span>Total earnings</span>
              <span className="text-emerald-400 font-semibold">{formatCurrency(totalEarnings)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Withdrawal progress */}
      {settings && (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ArrowDownToLine className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-semibold text-white">Withdrawal Progress</span>
            </div>
            {canWithdraw ? (
              <Link href="/wallet">
                <span className="text-xs text-emerald-400 hover:text-emerald-300 cursor-pointer font-medium">
                  Withdraw now →
                </span>
              </Link>
            ) : (
              <span className="text-xs text-white/30">
                {formatCurrency(Math.max(0, minWithdrawal - balance))} more needed
              </span>
            )}
          </div>
          <div className="h-2.5 bg-white/8 rounded-full overflow-hidden mb-2">
            <div
              className={cn("h-full rounded-full transition-all duration-500", canWithdraw ? "bg-emerald-400" : "bg-emerald-500/50")}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-white/30">
            <span>{formatCurrency(balance)}</span>
            <span>Min: {formatCurrency(minWithdrawal)}</span>
          </div>
          {canWithdraw && (
            <p className="text-xs text-emerald-400 mt-2 font-medium">✅ You have enough to withdraw!</p>
          )}
        </div>
      )}

      {/* Task navigation cards */}
      <div>
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Available Tasks</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link href="/tasks?type=simple">
            <div className="border border-blue-500/20 bg-blue-500/5 hover:bg-blue-500/10 rounded-2xl p-5 cursor-pointer transition-all">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                    <Zap className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-white">Simple Tasks</p>
                    <p className="text-xs text-white/40">Likes, follows & shares</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-white/20" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-blue-400 font-medium">{simpleTasks.length} available</span>
                <span className="text-xs text-white/20">tap to view →</span>
              </div>
            </div>
          </Link>
          <Link href="/tasks?type=premium">
            <div className="border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 rounded-2xl p-5 cursor-pointer transition-all">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
                    <Star className="w-5 h-5 text-amber-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-white">Premium Tasks</p>
                    <p className="text-xs text-white/40">Sign-ups & registrations</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-white/20" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-amber-400 font-medium">{premiumTasks.length} available</span>
                <span className="text-xs text-white/20">tap to view →</span>
              </div>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Main export ──────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { profile } = useAuth();

  if (profile?.role === "admin") {
    return <AdminDashboard />;
  }

  return <UserDashboard />;
}
