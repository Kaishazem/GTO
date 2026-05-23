import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { db } from "@/lib/firebase";
import {
  collection, getDocs, doc, updateDoc, serverTimestamp, Timestamp,
} from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, ChevronDown, ChevronRight, ShieldX, ShieldAlert,
  Users, Fingerprint, DollarSign, RefreshCw, Search,
  ShieldCheck, AlertTriangle, Ban, CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type AdminUser = {
  uid: string;
  email: string;
  name: string;
  role: string;
  balance: number;
  pendingBalance: number;
  deviceFingerprint: string;
  isBanned: boolean;
  registeredAt: Date;
};

type FingerprintGroup = {
  fingerprint: string;
  accounts: AdminUser[];
  totalBalance: number;
  isDuplicate: boolean;
};

function shortFp(fp: string) {
  if (!fp) return "—";
  return fp.length > 20 ? fp.slice(0, 10) + "…" + fp.slice(-8) : fp;
}

function StatCard({
  icon, label, value, sub, color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
}) {
  return (
    <div className={cn("bg-white/5 border rounded-xl p-4 flex items-center gap-4", color)}>
      <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center shrink-0", color.replace("border-", "bg-").replace("/30", "/20"))}>
        {icon}
      </div>
      <div>
        <p className="text-white/50 text-xs">{label}</p>
        <p className="text-white font-bold text-lg leading-tight">{value}</p>
        {sub && <p className="text-white/40 text-xs">{sub}</p>}
      </div>
    </div>
  );
}

export default function AdminUsersPage() {
  const { profile } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [banningId, setBanningId] = useState<string | null>(null);
  const [expandedFp, setExpandedFp] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showAllFingerprints, setShowAllFingerprints] = useState(false);

  useEffect(() => {
    if (profile?.role !== "admin") { setLocation("/dashboard"); return; }
    fetchUsers();
  }, [profile]);

  async function fetchUsers() {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, "users"));
      const list: AdminUser[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          uid: d.id,
          email: (data.email as string) || "",
          name: (data.name as string) || "",
          role: (data.role as string) || "user",
          balance: (data.balance as number) || 0,
          pendingBalance: (data.pendingBalance as number) || 0,
          deviceFingerprint: (data.deviceFingerprint as string) || "",
          isBanned: data.isBanned === true,
          registeredAt: (data.registeredAt as Timestamp)?.toDate() || new Date(),
        };
      });
      list.sort((a, b) => b.registeredAt.getTime() - a.registeredAt.getTime());
      setUsers(list);
    } catch (err) {
      toast({ title: "Failed to load users", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function banAccount(user: AdminUser) {
    setBanningId(user.uid);
    try {
      await updateDoc(doc(db, "users", user.uid), {
        isBanned: true,
        bannedAt: serverTimestamp(),
        bannedBy: profile?.email || "admin",
      });
      setUsers((prev) =>
        prev.map((u) => u.uid === user.uid ? { ...u, isBanned: true } : u)
      );
      toast({
        title: `🚫 ${user.name || user.email} banned`,
        description: "Account blocked from logging in.",
      });
    } catch (err) {
      toast({ title: "Ban failed", description: String(err), variant: "destructive" });
    } finally {
      setBanningId(null);
    }
  }

  async function unbanAccount(user: AdminUser) {
    setBanningId(user.uid);
    try {
      await updateDoc(doc(db, "users", user.uid), {
        isBanned: false,
        unbannedAt: serverTimestamp(),
        unbannedBy: profile?.email || "admin",
      });
      setUsers((prev) =>
        prev.map((u) => u.uid === user.uid ? { ...u, isBanned: false } : u)
      );
      toast({ title: `✅ ${user.name || user.email} unbanned` });
    } catch (err) {
      toast({ title: "Unban failed", description: String(err), variant: "destructive" });
    } finally {
      setBanningId(null);
    }
  }

  // ── Group users by fingerprint ───────────────────────────────────────────
  const groups = useMemo<FingerprintGroup[]>(() => {
    const map = new Map<string, AdminUser[]>();
    for (const u of users) {
      const fp = u.deviceFingerprint || "(no fingerprint)";
      if (!map.has(fp)) map.set(fp, []);
      map.get(fp)!.push(u);
    }
    return Array.from(map.entries())
      .map(([fp, accounts]) => ({
        fingerprint: fp,
        accounts,
        totalBalance: accounts.reduce((s, a) => s + a.balance + a.pendingBalance, 0),
        isDuplicate: accounts.length > 1,
      }))
      .sort((a, b) => b.accounts.length - a.accounts.length || b.totalBalance - a.totalBalance);
  }, [users]);

  const duplicateGroups = useMemo(() => groups.filter((g) => g.isDuplicate), [groups]);

  const filteredDuplicates = useMemo(() => {
    if (!search.trim()) return duplicateGroups;
    const q = search.toLowerCase();
    return duplicateGroups.filter((g) =>
      g.fingerprint.toLowerCase().includes(q) ||
      g.accounts.some((a) => a.email.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))
    );
  }, [duplicateGroups, search]);

  const allFpFiltered = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    return groups.filter((g) =>
      g.fingerprint.toLowerCase().includes(q) ||
      g.accounts.some((a) => a.email.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))
    );
  }, [groups, search]);

  const displayedAllFp = showAllFingerprints ? allFpFiltered : allFpFiltered.slice(0, 10);

  const totalBanned = users.filter((u) => u.isBanned).length;

  if (loading && users.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Fingerprint className="w-6 h-6 text-amber-400" />
            Device Manager
          </h1>
          <p className="text-white/50 text-sm mt-1">
            Manage duplicate accounts by device fingerprint
          </p>
        </div>
        <Button
          onClick={fetchUsers}
          disabled={loading}
          variant="ghost"
          className="border border-white/10 text-white/70 hover:text-white hover:bg-white/5"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Refresh
        </Button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<Users className="w-5 h-5 text-emerald-400" />}
          label="Total Accounts"
          value={users.length}
          color="border-emerald-500/30"
        />
        <StatCard
          icon={<Fingerprint className="w-5 h-5 text-sky-400" />}
          label="Unique Devices"
          value={groups.length}
          color="border-sky-500/30"
        />
        <StatCard
          icon={<ShieldAlert className="w-5 h-5 text-amber-400" />}
          label="Duplicate Devices"
          value={duplicateGroups.length}
          sub={`${duplicateGroups.reduce((s, g) => s + g.accounts.length, 0)} accounts at risk`}
          color="border-amber-500/30"
        />
        <StatCard
          icon={<ShieldX className="w-5 h-5 text-red-400" />}
          label="Banned Accounts"
          value={totalBanned}
          color="border-red-500/30"
        />
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by fingerprint, email or name…"
          className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-amber-400/50"
        />
      </div>

      {/* ─── SECTION B: Duplicate Devices ─────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <ShieldAlert className="w-5 h-5 text-amber-400" />
          <h2 className="text-lg font-semibold text-white">
            Duplicate Devices
            <span className="ml-2 text-xs font-normal text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-0.5">
              Risk Zone
            </span>
          </h2>
          <span className="text-white/30 text-sm">{filteredDuplicates.length} device{filteredDuplicates.length !== 1 ? "s" : ""}</span>
        </div>

        {filteredDuplicates.length === 0 ? (
          <div className="bg-white/3 border border-white/10 rounded-xl p-8 text-center">
            <ShieldCheck className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
            <p className="text-white/60">No duplicate devices found</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredDuplicates.map((group) => {
              const isExpanded = expandedFp === group.fingerprint;
              const bannedCount = group.accounts.filter((a) => a.isBanned).length;
              return (
                <div
                  key={group.fingerprint}
                  className="bg-white/5 border border-amber-500/20 rounded-xl overflow-hidden"
                >
                  {/* Fingerprint row */}
                  <button
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left"
                    onClick={() => setExpandedFp(isExpanded ? null : group.fingerprint)}
                  >
                    {isExpanded
                      ? <ChevronDown className="w-4 h-4 text-amber-400 shrink-0" />
                      : <ChevronRight className="w-4 h-4 text-white/40 shrink-0" />
                    }
                    <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-4">
                      <div className="flex items-center gap-2 min-w-0">
                        <Fingerprint className="w-4 h-4 text-amber-400 shrink-0" />
                        <span className="text-amber-200 font-mono text-xs truncate">
                          {shortFp(group.fingerprint)}
                        </span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-white/70 text-sm">
                          <span className="text-amber-300 font-semibold">{group.accounts.length}</span> accounts
                        </span>
                        {bannedCount > 0 && (
                          <span className="text-red-400 text-xs">
                            {bannedCount} banned
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-emerald-300 text-sm">
                        <DollarSign className="w-3.5 h-3.5" />
                        <span className="font-medium">{group.totalBalance.toFixed(4)}</span>
                        <span className="text-white/30 text-xs">total balance</span>
                      </div>
                    </div>
                    <span className="text-xs text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-0.5 shrink-0">
                      ×{group.accounts.length}
                    </span>
                  </button>

                  {/* ─── SECTION C: Expanded Accounts Table ─────────────────── */}
                  {isExpanded && (
                    <div className="border-t border-amber-500/20">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-white/5 bg-white/3">
                              <th className="text-left text-white/40 font-medium px-4 py-2.5">Email</th>
                              <th className="text-left text-white/40 font-medium px-4 py-2.5 hidden sm:table-cell">Name</th>
                              <th className="text-right text-white/40 font-medium px-4 py-2.5">Balance</th>
                              <th className="text-center text-white/40 font-medium px-4 py-2.5">Status</th>
                              <th className="text-center text-white/40 font-medium px-4 py-2.5">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.accounts.map((account) => (
                              <tr
                                key={account.uid}
                                className={cn(
                                  "border-b border-white/5 last:border-0 transition-colors",
                                  account.isBanned ? "bg-red-500/5" : "hover:bg-white/3"
                                )}
                              >
                                <td className="px-4 py-3">
                                  <div>
                                    <p className="text-white font-medium truncate max-w-[180px]">{account.email}</p>
                                    <p className="text-white/30 text-xs font-mono">{account.uid.slice(0, 8)}…</p>
                                  </div>
                                </td>
                                <td className="px-4 py-3 hidden sm:table-cell">
                                  <span className="text-white/70">{account.name || "—"}</span>
                                  {account.role === "admin" && (
                                    <span className="ml-2 text-xs text-sky-400 bg-sky-500/10 border border-sky-500/30 rounded-full px-1.5 py-0.5">
                                      admin
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <div>
                                    <p className="text-emerald-300 font-medium">${account.balance.toFixed(4)}</p>
                                    {account.pendingBalance > 0 && (
                                      <p className="text-amber-400/70 text-xs">${account.pendingBalance.toFixed(4)} pending</p>
                                    )}
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-center">
                                  {account.isBanned ? (
                                    <span className="inline-flex items-center gap-1 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-full px-2 py-0.5">
                                      <ShieldX className="w-3 h-3" /> Banned
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2 py-0.5">
                                      <CheckCircle2 className="w-3 h-3" /> Active
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  {account.isBanned ? (
                                    <Button
                                      size="sm"
                                      disabled={banningId === account.uid || account.role === "admin"}
                                      onClick={() => unbanAccount(account)}
                                      className="h-7 px-3 text-xs bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 border border-emerald-500/30"
                                    >
                                      {banningId === account.uid
                                        ? <Loader2 className="w-3 h-3 animate-spin" />
                                        : "Unban"
                                      }
                                    </Button>
                                  ) : (
                                    <Button
                                      size="sm"
                                      disabled={banningId === account.uid || account.role === "admin"}
                                      onClick={() => banAccount(account)}
                                      className={cn(
                                        "h-7 px-3 text-xs border",
                                        account.role === "admin"
                                          ? "opacity-30 cursor-not-allowed bg-white/5 border-white/10 text-white/30"
                                          : "bg-red-600/20 hover:bg-red-600/40 text-red-400 border-red-500/30"
                                      )}
                                    >
                                      {banningId === account.uid
                                        ? <Loader2 className="w-3 h-3 animate-spin" />
                                        : <><Ban className="w-3 h-3 mr-1" />Ban</>
                                      }
                                    </Button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ─── SECTION A: All Fingerprints ──────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Fingerprint className="w-5 h-5 text-sky-400" />
          <h2 className="text-lg font-semibold text-white">All Device Fingerprints</h2>
          <span className="text-white/30 text-sm">{allFpFiltered.length} unique device{allFpFiltered.length !== 1 ? "s" : ""}</span>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/3">
                  <th className="text-left text-white/40 font-medium px-4 py-3">Fingerprint ID</th>
                  <th className="text-center text-white/40 font-medium px-4 py-3">Accounts</th>
                  <th className="text-right text-white/40 font-medium px-4 py-3">Total Balance</th>
                  <th className="text-center text-white/40 font-medium px-4 py-3">Risk</th>
                </tr>
              </thead>
              <tbody>
                {displayedAllFp.map((group) => (
                  <tr
                    key={group.fingerprint}
                    className={cn(
                      "border-b border-white/5 last:border-0 hover:bg-white/3 cursor-pointer transition-colors",
                      group.isDuplicate && "bg-amber-500/3"
                    )}
                    onClick={() => {
                      if (group.isDuplicate) {
                        setExpandedFp(expandedFp === group.fingerprint ? null : group.fingerprint);
                        setTimeout(() => {
                          document.getElementById(`fp-${group.fingerprint}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                        }, 50);
                      }
                    }}
                  >
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-white/70">{shortFp(group.fingerprint)}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={cn(
                        "font-semibold",
                        group.isDuplicate ? "text-amber-300" : "text-white/70"
                      )}>
                        {group.accounts.length}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-emerald-300 font-medium">${group.totalBalance.toFixed(4)}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {group.isDuplicate ? (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-0.5">
                          <AlertTriangle className="w-3 h-3" /> Duplicate
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-white/30 bg-white/5 rounded-full px-2 py-0.5">
                          <ShieldCheck className="w-3 h-3" /> Clean
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Show more / less */}
          {allFpFiltered.length > 10 && (
            <div className="border-t border-white/10 px-4 py-3 text-center">
              <button
                onClick={() => setShowAllFingerprints((v) => !v)}
                className="text-sm text-sky-400 hover:text-sky-300 transition-colors"
              >
                {showAllFingerprints
                  ? "Show less"
                  : `Show all ${allFpFiltered.length} fingerprints`
                }
              </button>
            </div>
          )}

          {allFpFiltered.length === 0 && (
            <div className="px-4 py-10 text-center text-white/40">
              No fingerprints match your search.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
