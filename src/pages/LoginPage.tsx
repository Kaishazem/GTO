import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, LogIn, Eye, EyeOff, MailCheck, RefreshCw, ShieldAlert } from "lucide-react";

const schema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const { login, resendVerificationEmail } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState("");
  const [unverifiedPassword, setUnverifiedPassword] = useState("");
  const [resending, setResending] = useState(false);
  const [resendSent, setResendSent] = useState(false);
  const [securityError, setSecurityError] = useState("");
  const [emailBanned, setEmailBanned] = useState(false);
  const banCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const checkVerification = async () => {
      const user = auth.currentUser;
      if (user && !user.emailVerified) {
        toast({
          title: "⚠️ Email Not Verified",
          description: "Please verify your email before logging in.",
          variant: "destructive",
          duration: Infinity,
        });
      }
    };
    checkVerification();
  }, []);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  // Debounced email ban check: fires 600ms after the user stops typing
  function handleEmailChange(value: string, fieldOnChange: (v: string) => void) {
    fieldOnChange(value);
    setEmailBanned(false);
    if (banCheckTimerRef.current) clearTimeout(banCheckTimerRef.current);
    const trimmed = value.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) return;
    banCheckTimerRef.current = setTimeout(async () => {
      try {
        const snap = await getDoc(doc(db, "banned_emails", trimmed));
        if (snap.exists()) setEmailBanned(true);
      } catch { /* non-blocking */ }
    }, 600);
  }

  async function onSubmit(data: FormData) {
    // Hard-check ban immediately before submitting (in case debounce hasn't fired yet)
    try {
      const snap = await getDoc(doc(db, "banned_emails", data.email.trim().toLowerCase()));
      if (snap.exists()) {
        setEmailBanned(true);
        return;
      }
    } catch { /* non-blocking */ }

    setLoading(true);
    setSecurityError("");
    setUnverifiedEmail("");
    try {
      const result = await login(data.email, data.password);
      if (result.unverified) {
        setUnverifiedEmail(data.email);
        setUnverifiedPassword(data.password);
        setResendSent(false);
        toast({
          title: "⚠️ Email Not Verified",
          description: "Please verify your email before logging in.",
          variant: "destructive",
          duration: Infinity,
        });
        return;
      }
      setLocation(result.role === "admin" ? "/admin" : "/dashboard");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Login failed";
      if (
        msg.includes("VPN") ||
        msg.includes("Proxy") ||
        msg.includes("datacenter") ||
        msg.includes("Bot") ||
        msg.includes("automated") ||
        msg.includes("attempts") ||
        msg.includes("suspended") ||
        msg.includes("banned")
      ) {
        setSecurityError(msg);
      } else {
        toast({ title: "Login Failed", description: msg, variant: "destructive" });
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (!unverifiedEmail || !unverifiedPassword) return;
    setResending(true);
    try {
      await resendVerificationEmail(unverifiedEmail, unverifiedPassword);
      setResendSent(true);
      toast({ title: "Email Sent", description: "Verification email resent. Check your inbox." });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to resend";
      if (msg.includes("already verified")) {
        toast({ title: "Already Verified", description: "Your email is verified. Try signing in again." });
        setUnverifiedEmail("");
      } else {
        toast({ title: "Error", description: msg, variant: "destructive" });
      }
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-950 via-teal-900 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 mb-4">
            <span className="text-3xl">🎯</span>
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <h1 className="text-4xl font-bold text-red-500 tracking-widest">GTO</h1>
            <p className="text-sm font-normal text-white/70 tracking-wide">Green Task Orbit</p>
          </div>
          <p className="text-emerald-300/70 mt-1">Complete tasks. Earn crypto.</p>
        </div>

        {/* Banned email banner */}
        {emailBanned && (
          <div className="bg-red-500/15 border border-red-500/40 rounded-2xl p-4 flex gap-3">
            <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-red-300 font-semibold text-sm">🚫 Access Denied</p>
              <p className="text-red-400/80 text-xs mt-1">This email is permanently banned. Access denied.</p>
            </div>
          </div>
        )}

        {/* Security error banner */}
        {securityError && !emailBanned && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4 flex gap-3">
            <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-red-300 font-medium text-sm">Access Blocked</p>
              <p className="text-red-400/80 text-xs mt-1">{securityError}</p>
            </div>
          </div>
        )}

        {/* Email not verified banner */}
        {unverifiedEmail && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-5">
            <div className="flex gap-3 mb-4">
              <MailCheck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-amber-300 font-medium">Email Not Verified</p>
                <p className="text-amber-400/70 text-sm mt-1">
                  You must verify your email before logging in. Check your inbox at{" "}
                  <span className="font-semibold text-amber-300">{unverifiedEmail}</span>
                </p>
              </div>
            </div>
            {resendSent ? (
              <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-500/10 rounded-lg px-3 py-2">
                <MailCheck className="w-4 h-4" />
                Verification email sent! Check your inbox and spam folder.
              </div>
            ) : (
              <Button
                onClick={handleResend}
                disabled={resending}
                size="sm"
                className="w-full bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded-xl"
                variant="outline"
              >
                {resending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                Resend Verification Email
              </Button>
            )}
          </div>
        )}

        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
          <h2 className="text-xl font-semibold text-white mb-6 text-center">Sign In</h2>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-emerald-200">Email Address</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="email"
                        placeholder="you@example.com"
                        autoComplete="email"
                        data-testid="input-email"
                        className={`bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-emerald-400 ${emailBanned ? "border-red-500/60 focus:border-red-500" : ""}`}
                        onChange={(e) => handleEmailChange(e.target.value, field.onChange)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-emerald-200">Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          {...field}
                          type={showPassword ? "text" : "password"}
                          placeholder="••••••••"
                          autoComplete="current-password"
                          data-testid="input-password"
                          className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-emerald-400 pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
                          tabIndex={-1}
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                disabled={loading || emailBanned}
                data-testid="button-login"
                className="w-full bg-emerald-500 hover:bg-emerald-400 text-white font-semibold py-3 rounded-xl transition-all disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <LogIn className="w-4 h-4 mr-2" />}
                {emailBanned ? "Access Denied" : "Sign In"}
              </Button>
            </form>
          </Form>

          <p className="text-center text-white/50 mt-6 text-sm">
            Don't have an account?{" "}
            <button
              onClick={() => setLocation("/register")}
              data-testid="link-register"
              className="text-emerald-400 hover:text-emerald-300 font-medium transition-colors"
            >
              Sign up now
            </button>
          </p>
        </div>

        <p className="text-center text-white/20 text-xs">🔒 Protected by device fingerprinting & bot protection</p>
      </div>
    </div>
  );
}
