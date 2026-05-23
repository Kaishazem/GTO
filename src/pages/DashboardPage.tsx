import { useAuth } from "@/contexts/AuthContext";
import { useTask } from "@/contexts/TaskContext";
import { formatCurrency } from "@/lib/utils";
import { TrendingUp, ListTodo, Wallet, Clock, CheckCircle, ChevronRight, ArrowDownToLine, AlertTriangle } from "lucide-react";
import { Link } from "wouter";
import { useEffect, useState } from "react";
import { getSettings, AppSettings } from "@/lib/settings";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export default function DashboardPage() {
  const { profile } = useAuth();
  const { tasks, completions } = useTask();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [warningMessage, setWarningMessage] = useState("");
  const defaultWarning = "Do not use VPN or automation bots while completing tasks. Platforms may reject tasks completed with VPN or bots, and you will NOT receive payment.";

  useEffect(() => {
    getSettings().then(setSettings);
    (async () => {
      try {
        const snap = await getDoc(doc(db, "settings", "general"));
        if (snap.exists()) {
          const data = snap.data() as Record<string, unknown>;
          if (data?.dashboardWarningEnabled) {
            setWarningMessage(String(data?.dashboardWarningMessage || defaultWarning));
          }
        } else {
          setWarningMessage(defaultWarning);
        }
      } catch {
        setWarningMessage(defaultWarning);
      }
    })();
  }, []);

  const recentCompletions = completions.slice(0, 5);
  const simpleTasks = tasks.filter((t) => t.type === "simple");
  const premiumTasks = tasks.filter((t) => t.type === "premium");
  const totalCompleted = completions.length;
  const pendingCount = completions.filter((c) => c.status === "pending").length;

  const balance = profile?.balance || 0;
  const minWithdrawal = settings?.usdtMin ?? 10;
  const needMore = Math.max(0, minWithdrawal - balance);
  const progressPct = Math.min(100, (balance / minWithdrawal) * 100);
  const canWithdraw = balance >= minWithdrawal;

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div className="bg-gradient-to-r from-emerald-600/20 to-teal-600/10 border border-emerald-500/20 rounded-2xl p-6">
        <h1 className="text-2xl font-bold text-white">Welcome back, {profile?.name} 👋</h1>
        <p className="text-emerald-300/70 mt-1 text-sm">Keep completing tasks to grow your earnings</p>
      </div>

      {/* Dashboard warning (editable by admin) */}
      {warningMessage && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5" />
            <div>
              <h3 className="font-semibold text-yellow-500 mb-1">⚠️ Important Warning</h3>
              <p className="text-sm text-yellow-500/90 leading-relaxed">{warningMessage}</p>
            </div>
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={<Wallet className="w-5 h-5 text-emerald-400" />}
          label="Available Balance"
          value={formatCurrency(profile?.balance || 0)}
          sub="ready to withdraw"
          color="emerald"
          testId="stat-balance"
        />
        <StatCard
          icon={<Clock className="w-5 h-5 text-amber-400" />}
          label="Pending Balance"
          value={formatCurrency(profile?.pendingBalance || 0)}
          sub="awaiting approval"
          color="amber"
          testId="stat-pending"
        />
        <StatCard
          icon={<ListTodo className="w-5 h-5 text-blue-400" />}
          label="Tasks Completed"
          value={String(totalCompleted)}
          sub="all time"
          color="blue"
          testId="stat-completed"
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5 text-purple-400" />}
          label="Pending Tasks"
          value={String(pendingCount)}
          sub="awaiting approval"
          color="purple"
          testId="stat-pending-tasks"
        />
      </div>

      {/* Withdrawal progress */}
      {settings && (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ArrowDownToLine className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-medium text-white">Withdrawal Progress</span>
            </div>
            {canWithdraw ? (
              <Link href="/wallet">
                <span className="text-xs text-emerald-400 hover:text-emerald-300 cursor-pointer font-medium">
                  Withdraw now →
                </span>
              </Link>
            ) : (
              <span className="text-xs text-white/40">
                {needMore.toFixed(5)} USDT more needed
              </span>
            )}
          </div>
          <div className="h-2.5 bg-white/10 rounded-full overflow-hidden mb-2">
            <div
              className={`h-full rounded-full transition-all ${canWithdraw ? "bg-emerald-400" : "bg-emerald-500/60"}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-white/40">
            <span>{formatCurrency(balance)}</span>
            <span>Min: {formatCurrency(minWithdrawal)}</span>
          </div>
          {canWithdraw && (
            <p className="text-xs text-emerald-400 mt-2 font-medium">
              ✅ You have enough to withdraw!
            </p>
          )}
        </div>
      )}

      {/* Available tasks summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TaskTypeCard
          icon="⚡"
          label="Simple Tasks"
          count={simpleTasks.length}
          desc="Likes, follows & shares"
          href="/tasks"
          color="blue"
        />
        <TaskTypeCard
          icon="⭐"
          label="Premium Tasks"
          count={premiumTasks.length}
          desc="Sign-ups & registrations"
          href="/tasks"
          color="amber"
        />
      </div>

      {/* Balance breakdown — hidden for admin */}
      {profile?.role !== "admin" && (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <h2 className="font-semibold text-white mb-4">Earnings Breakdown</h2>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-xs text-white/40 mb-1">Total Pending</div>
              <div className="text-lg font-bold text-amber-400">{formatCurrency(profile?.pendingBalance || 0)}</div>
            </div>
            <div className="border-x border-white/10">
              <div className="text-xs text-white/40 mb-1">Available</div>
              <div className="text-lg font-bold text-emerald-400">{formatCurrency(profile?.balance || 0)}</div>
            </div>
            <div>
              <div className="text-xs text-white/40 mb-1">Tasks Done</div>
              <div className="text-lg font-bold text-blue-400">{totalCompleted}</div>
            </div>
          </div>
        </div>
      )}

      {/* Recent activity */}
      {recentCompletions.length > 0 && (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white">Recent Activity</h2>
            <Link href="/tasks">
              <span className="text-xs text-emerald-400 hover:text-emerald-300 cursor-pointer flex items-center gap-1">
                View tasks <ChevronRight className="w-3 h-3" />
              </span>
            </Link>
          </div>
          <div className="space-y-3">
            {recentCompletions.map((c) => (
              <div key={c.id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${c.status === "approved" ? "bg-emerald-400" : c.status === "rejected" ? "bg-red-400" : "bg-amber-400"}`} />
                  <div>
                    <span className="text-sm text-white/80 capitalize">{c.status}</span>
                    {c.verifiedBy && <span className="text-xs text-emerald-400/60 ml-2">via {c.verifiedBy}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {c.status === "approved" && <CheckCircle className="w-3 h-3 text-emerald-400" />}
                  <span className="text-sm font-medium text-emerald-400">+{formatCurrency(c.reward)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, sub, color, testId }: {
  icon: React.ReactNode; label: string; value: string; sub: string; color: string; testId: string;
}) {
  const colors: Record<string, string> = {
    emerald: "border-emerald-500/20 bg-emerald-500/10",
    amber: "border-amber-500/20 bg-amber-500/10",
    blue: "border-blue-500/20 bg-blue-500/10",
    purple: "border-purple-500/20 bg-purple-500/10",
  };
  return (
    <div className={`border rounded-2xl p-4 ${colors[color]}`} data-testid={testId}>
      <div className="mb-2">{icon}</div>
      <p className="text-xs text-white/50 mb-1">{label}</p>
      <p className="text-lg font-bold text-white leading-tight break-words">{value}</p>
      <p className="text-xs text-white/40">{sub}</p>
    </div>
  );
}

function TaskTypeCard({ icon, label, count, desc, href, color }: {
  icon: string; label: string; count: number; desc: string; href: string; color: string;
}) {
  const colors: Record<string, string> = {
    blue: "border-blue-500/20 bg-blue-500/5 hover:bg-blue-500/10",
    amber: "border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10",
  };
  return (
    <Link href={href}>
      <div className={`border rounded-2xl p-5 cursor-pointer transition-all ${colors[color]}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{icon}</span>
            <div>
              <p className="font-semibold text-white">{label}</p>
              <p className="text-xs text-white/50">{desc}</p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-white/30" />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-white/60">{count} available</span>
          <span className="text-xs text-white/30">tap to view →</span>
        </div>
      </div>
    </Link>
  );
}
