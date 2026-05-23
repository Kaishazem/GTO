import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTask } from "@/contexts/TaskContext";
import { formatDate, formatCurrency } from "@/lib/utils";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  deleteUser,
} from "firebase/auth";
import { updateDoc, doc, deleteDoc, getDocs, query, collection, where } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  Loader2, User, Lock, Trash2, ShieldAlert, CheckCircle,
  Calendar, ListTodo, DollarSign, TrendingUp
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";

const nameSchema = z.object({ name: z.string().min(2, "Name must be at least 2 characters") });
const passwordSchema = z.object({
  currentPassword: z.string().min(6, "Enter your current password"),
  newPassword: z.string().min(6, "New password must be at least 6 characters"),
  confirmPassword: z.string(),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: "Passwords do not match", path: ["confirmPassword"],
});
const deleteSchema = z.object({
  password: z.string().min(1, "Enter your password to confirm"),
});

type NameForm = z.infer<typeof nameSchema>;
type PasswordForm = z.infer<typeof passwordSchema>;
type DeleteForm = z.infer<typeof deleteSchema>;

export default function ProfilePage() {
  const { user, profile, logout, refreshProfile } = useAuth();
  const { completions } = useTask();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<"stats" | "name" | "password" | "delete">("stats");
  const [saving, setSaving] = useState(false);
  const [totalEarned, setTotalEarned] = useState(0);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const q = query(collection(db, "taskCompletions"), where("userId", "==", user.uid));
      const snap = await getDocs(q);
      const earned = snap.docs.reduce((sum, d) => sum + ((d.data().reward as number) || 0), 0);
      setTotalEarned(earned);
    })();
  }, [user]);

  const nameForm = useForm<NameForm>({
    resolver: zodResolver(nameSchema),
    defaultValues: { name: profile?.name || "" },
  });
  const passwordForm = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });
  const deleteForm = useForm<DeleteForm>({
    resolver: zodResolver(deleteSchema),
    defaultValues: { password: "" },
  });

  async function handleNameChange(data: NameForm) {
    if (!user || !profile) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "users", user.uid), { name: data.name });
      await refreshProfile();
      toast({ title: "✅ Name updated" });
    } catch {
      toast({ title: "Error", description: "Failed to update name", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handlePasswordChange(data: PasswordForm) {
    if (!user || !user.email) return;
    setSaving(true);
    try {
      const cred = EmailAuthProvider.credential(user.email, data.currentPassword);
      await reauthenticateWithCredential(user, cred);
      await updatePassword(user, data.newPassword);
      toast({ title: "✅ Password changed" });
      passwordForm.reset();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed";
      toast({ title: "Error", description: msg.includes("wrong-password") ? "Current password is incorrect" : msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAccount(data: DeleteForm) {
    if (!user || !user.email) return;
    setSaving(true);
    try {
      const cred = EmailAuthProvider.credential(user.email, data.password);
      await reauthenticateWithCredential(user, cred);
      if (profile?.deviceFingerprint) {
        try {
          await deleteDoc(doc(db, "device_fingerprints", profile.deviceFingerprint));
        } catch {
          // non-blocking cleanup failure
        }
      }
      await deleteDoc(doc(db, "users", user.uid));
      await deleteUser(user);
      await logout();
      setLocation("/login");
      toast({ title: "Account deleted" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed";
      toast({ title: "Error", description: msg.includes("wrong-password") ? "Incorrect password" : msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const tabs = [
    { id: "stats", label: "Account Stats", icon: <TrendingUp className="w-4 h-4" /> },
    { id: "name", label: "Change Name", icon: <User className="w-4 h-4" /> },
    { id: "password", label: "Change Password", icon: <Lock className="w-4 h-4" /> },
    { id: "delete", label: "Delete Account", icon: <Trash2 className="w-4 h-4" /> },
  ] as const;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-white">Profile & Settings</h1>
        <p className="text-white/40 text-sm mt-1">{profile?.email}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all",
              tab === t.id
                ? t.id === "delete" ? "bg-red-500 text-white" : "bg-emerald-500 text-white"
                : "bg-white/5 text-white/60 hover:bg-white/10"
            )}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* Stats */}
      {tab === "stats" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {profile?.role !== 'admin' && (
            <div className="contents">
            <StatCard icon={<DollarSign className="w-5 h-5 text-emerald-400" />} label="Total Earned" value={formatCurrency(totalEarned)} color="emerald" />
            <StatCard icon={<DollarSign className="w-5 h-5 text-amber-400" />} label="Available Balance" value={formatCurrency(profile?.balance || 0)} color="amber" />
            <StatCard icon={<ListTodo className="w-5 h-5 text-blue-400" />} label="Tasks Completed" value={String(completions.length)} color="blue" />
            </div>
            )}
            <StatCard icon={<Calendar className="w-5 h-5 text-purple-400" />} label="Member Since" value={profile?.registeredAt ? formatDate(profile.registeredAt) : "—"} color="purple" />
          </div>
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <h3 className="font-medium text-white mb-3">Account Details</h3>
            <div className="space-y-2 text-sm">
              <Row label="Name" value={profile?.name || "—"} />
              <Row label="Email" value={profile?.email || "—"} />
              <Row label="Role" value={profile?.role === "admin" ? "Admin" : "Member"} />
              <Row label="Email Verified" value={user?.emailVerified ? "✅ Verified" : "❌ Not verified"} />
              <Row label="Pending Balance" value={formatCurrency(profile?.pendingBalance || 0)} />
            </div>
          </div>
        </div>
      )}

      {/* Change Name */}
      {tab === "name" && (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <h2 className="font-semibold text-white mb-5 flex items-center gap-2">
            <User className="w-4 h-4 text-emerald-400" /> Update Display Name
          </h2>
          <Form {...nameForm}>
            <form onSubmit={nameForm.handleSubmit(handleNameChange)} className="space-y-4">
              <FormField control={nameForm.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/80">Display Name</FormLabel>
                  <FormControl>
                    <Input {...field} className="bg-white/10 border-white/20 text-white focus:border-emerald-400" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <Button type="submit" disabled={saving} className="bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl">
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                Save Name
              </Button>
            </form>
          </Form>
        </div>
      )}

      {/* Change Password */}
      {tab === "password" && (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <h2 className="font-semibold text-white mb-5 flex items-center gap-2">
            <Lock className="w-4 h-4 text-emerald-400" /> Change Password
          </h2>
          <Form {...passwordForm}>
            <form onSubmit={passwordForm.handleSubmit(handlePasswordChange)} className="space-y-4">
              {(["currentPassword", "newPassword", "confirmPassword"] as const).map((f) => (
                <FormField key={f} control={passwordForm.control} name={f} render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/80">
                      {f === "currentPassword" ? "Current Password" : f === "newPassword" ? "New Password" : "Confirm New Password"}
                    </FormLabel>
                    <FormControl>
                      <Input {...field} type="password" autoComplete="new-password"
                        className="bg-white/10 border-white/20 text-white focus:border-emerald-400" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              ))}
              <Button type="submit" disabled={saving} className="bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl">
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Lock className="w-4 h-4 mr-2" />}
                Change Password
              </Button>
            </form>
          </Form>
        </div>
      )}

      {/* Delete Account */}
      {tab === "delete" && (
        <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-6">
          <h2 className="font-semibold text-red-400 mb-2 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4" /> Delete Account
          </h2>
          <p className="text-white/50 text-sm mb-5">
            This action is permanent and cannot be undone. All your data, earnings, and history will be deleted forever.
          </p>
          <div className="mb-4">
            <p className="text-xs text-white/40 mb-1">Account to be deleted</p>
            <p className="text-sm text-white/70 bg-white/5 border border-white/10 rounded-lg px-3 py-2 font-mono">{profile?.email}</p>
          </div>
          <Form {...deleteForm}>
            <form onSubmit={deleteForm.handleSubmit(handleDeleteAccount)} className="space-y-4">
              <FormField control={deleteForm.control} name="password" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/80">Enter your password to confirm</FormLabel>
                  <FormControl>
                    <Input {...field} type="password" placeholder="Your password"
                      className="bg-white/10 border-red-500/30 text-white focus:border-red-400" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <Button type="submit" disabled={saving || !deleteForm.watch("password")}
                className="bg-red-500 hover:bg-red-400 text-white rounded-xl w-full disabled:opacity-40">
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
                Permanently Delete My Account
              </Button>
            </form>
          </Form>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    emerald: "border-emerald-500/20 bg-emerald-500/10",
    amber: "border-amber-500/20 bg-amber-500/10",
    blue: "border-blue-500/20 bg-blue-500/10",
    purple: "border-purple-500/20 bg-purple-500/10",
  };
  return (
    <div className={`border rounded-2xl p-4 ${colors[color]}`}>
      <div className="mb-2">{icon}</div>
      <p className="text-xs text-white/50 mb-1">{label}</p>
      <p className="text-base font-bold text-white leading-tight break-words">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-white/5 last:border-0">
      <span className="text-white/50">{label}</span>
      <span className="text-white font-medium">{value}</span>
    </div>
  );
}
