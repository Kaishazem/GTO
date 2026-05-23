import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, UserPlus, Shield, Eye, EyeOff, MailCheck, ShieldAlert } from "lucide-react";
import { createTimingChecker } from "@/lib/botDetection";

const schema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type FormData = z.infer<typeof schema>;

export default function RegisterPage() {
  const { register } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [verifyEmail, setVerifyEmail] = useState("");
  const [securityError, setSecurityError] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [emailBanned, setEmailBanned] = useState(false);
  const timingRef = useRef(createTimingChecker());
  const banCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timingRef.current = createTimingChecker();
  }, []);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });

  // Debounced email ban check
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
    setLoading(true);
    setSecurityError("");
    setEmailBanned(false);
    try {
      // Check banned_emails before doing anything else
      const emailSnap = await getDoc(doc(db, "banned_emails", data.email.trim().toLowerCase()));
      if (emailSnap.exists()) {
        setEmailBanned(true);
        setSecurityError("This email address is not allowed to register.");
        return;
      }

      await register(data.email, data.password, data.name, honeypot, timingRef.current.check(3000));
      toast({ title: "✅ Check your email", description: "Verification link sent. Please verify to log in.", duration: 10000 });
      setVerifyEmail(data.email);
      setTimeout(() => setLocation("/login"), 3000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Registration failed";
      if (msg.includes("already registered") || msg.includes("This device is already registered")) {
        setSecurityError(msg);
        toast({ title: "Registration Blocked", description: msg, variant: "destructive", duration: Infinity });
      } else {
        toast({ title: "Error", description: msg, variant: "destructive" });
      }
    } finally {
      setLoading(false);
    }
  }

  if (verifyEmail) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-950 via-teal-900 to-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 mb-6">
            <MailCheck className="w-10 h-10 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Check your email</h1>
          <p className="text-white/60 mb-2">We sent a verification link to</p>
          <p className="text-emerald-400 font-semibold mb-6">{verifyEmail}</p>
          <p className="text-white/40 text-sm mb-8">Click the link in the email to verify your account, then come back here to sign in. If you don't see it, check your spam folder.</p>
          <Button onClick={() => setLocation("/login")} className="w-full bg-emerald-500 hover:bg-emerald-400 text-white font-semibold py-3 rounded-xl">Go to Sign In</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-950 via-teal-900 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 mb-4">
            <span className="text-3xl">🎯</span>
          </div>
          <h1 className="text-3xl font-bold text-white">Green Task Orbit</h1>
          <p className="text-emerald-300/70 mt-1">Complete tasks. Earn crypto.</p>
        </div>

        {(securityError || emailBanned) && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4 flex gap-3">
            <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-red-300 font-medium text-sm">Registration Blocked</p>
              <p className="text-red-400/80 text-xs mt-1">
                {emailBanned ? "This email address is not allowed to register." : securityError}
              </p>
            </div>
          </div>
        )}

        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
          <h2 className="text-xl font-semibold text-white mb-2 text-center">Create Account</h2>
          <div className="flex items-center justify-center gap-2 mb-6 text-xs text-emerald-400/80 bg-emerald-500/10 rounded-lg py-2 px-3">
            <Shield className="w-3 h-3" />
            <span>One account per device • Email verification required</span>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <input type="text" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} style={{ display: "none" }} tabIndex={-1} autoComplete="off" aria-hidden="true" />

              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-emerald-200">Full Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="John Doe" autoComplete="name" data-testid="input-name" className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-emerald-400" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-emerald-200">Email Address</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="email"
                      placeholder="you@example.com"
                      autoComplete="email"
                      data-testid="input-email"
                      className={`bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-emerald-400 ${emailBanned ? "border-red-500/60" : ""}`}
                      onChange={(e) => handleEmailChange(e.target.value, field.onChange)}
                    />
                  </FormControl>
                  <FormMessage />
                  {emailBanned && (
                    <p className="text-xs text-red-400 mt-1">This email address is not allowed to register.</p>
                  )}
                </FormItem>
              )} />

              <FormField control={form.control} name="password" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-emerald-200">Password</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input {...field} type={showPassword ? "text" : "password"} placeholder="••••••••" autoComplete="new-password" data-testid="input-password" className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-emerald-400 pr-10" />
                      <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors" tabIndex={-1}>{showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="confirmPassword" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-emerald-200">Confirm Password</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input {...field} type={showConfirm ? "text" : "password"} placeholder="••••••••" autoComplete="new-password" data-testid="input-confirm-password" className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-emerald-400 pr-10" />
                      <button type="button" onClick={() => setShowConfirm((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors" tabIndex={-1}>{showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <Button
                type="submit"
                disabled={loading || emailBanned}
                data-testid="button-register"
                className="w-full bg-emerald-500 hover:bg-emerald-400 text-white font-semibold py-3 rounded-xl transition-all mt-2 disabled:opacity-50"
              >
                {loading
                  ? <span className="inline-flex items-center"><Loader2 className="w-4 h-4 animate-spin mr-2" />Running security checks...</span>
                  : <span className="inline-flex items-center"><UserPlus className="w-4 h-4 mr-2" />Create Account</span>
                }
              </Button>
            </form>
          </Form>

          <p className="text-center text-white/50 mt-6 text-sm">Already have an account? <button onClick={() => setLocation("/login")} data-testid="link-login" className="text-emerald-400 hover:text-emerald-300 font-medium transition-colors">Sign in</button></p>
        </div>

        <p className="text-center text-white/20 text-xs">🔒 Protected by device fingerprinting & bot protection</p>
      </div>
    </div>
  );
}
