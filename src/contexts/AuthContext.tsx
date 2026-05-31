declare global {
  interface Window {
    userBanUnsubscribe?: () => void;
  }
}
import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  User,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendEmailVerification,
} from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  onSnapshot,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  getDeviceFingerprint,
  detectHeadlessBrowser,
  detectIncognitoMode,
  persistFingerprintToIDB,
} from "@/lib/fingerprint";
import {
  detectHeadlessBrowser as detectHeadlessBot,
  detectSuspiciousUserAgent,
} from "@/lib/botDetection";

export interface UserProfile {
  uid: string;
  email: string;
  name: string;
  role: "user" | "admin";
  balance: number;
  pendingBalance: number;
  registeredAt: Date;
  deviceFingerprint: string;
  trc20Address?: string;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  deviceBanned: boolean;
  banReason: string;
  register: (email: string, password: string, name: string, honeypot: string, timingOk: boolean) => Promise<void>;
  login: (email: string, password: string) => Promise<{ unverified?: boolean; role?: "user" | "admin" }>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  resendVerificationEmail: (email: string, password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Wraps a promise with a timeout — resolves to fallback instead of hanging forever
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      console.warn(`[withTimeout] Timed out after ${ms}ms, using fallback:`, fallback);
      resolve(fallback);
    }, ms);
    promise.then((value) => {
      window.clearTimeout(timer);
      resolve(value);
    }).catch((err) => {
      window.clearTimeout(timer);
      console.warn(`[withTimeout] Promise rejected:`, err);
      resolve(fallback);
    });
  });
}

// Wraps a promise with a timeout that REJECTS on timeout (for critical ops)
function withHardTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`[${label}] Timed out after ${ms}ms`));
    }, ms);
    promise.then((value) => {
      window.clearTimeout(timer);
      resolve(value);
    }).catch((err) => {
      window.clearTimeout(timer);
      reject(err);
    });
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [deviceBanned, setDeviceBanned] = useState(false);
  const [banReason, setBanReason] = useState("");

  // Guard: prevents onAuthStateChanged from interfering during registration
  const isRegisteringRef = useRef(false);
  // Guard: prevents ban checks from running during a deliberate sign-out
  const isSigningOutRef = useRef(false);

  async function fetchProfile(uid: string): Promise<Record<string, unknown> | null> {
    const ref = doc(db, "users", uid);
    const snap = await withTimeout(getDoc(ref), 5000, null as never);
    if (!snap || !snap.exists()) return null;
    const data = snap.data();
    setProfile({
      uid,
      email: data.email,
      name: data.name,
      role: data.role || "user",
      balance: data.balance || 0,
      pendingBalance: data.pendingBalance || 0,
      registeredAt: data.registeredAt?.toDate() || new Date(),
      deviceFingerprint: data.deviceFingerprint || "",
      trc20Address: data.trc20Address,
    });
    return data;
  }

  async function refreshProfile() {
    if (user) await fetchProfile(user.uid);
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (isRegisteringRef.current) {
        console.log("[Auth] Registration in progress — skipping auth state change");
        return;
      }

      // ── Sign-out path: clear everything immediately, no ban checks ──────
      if (isSigningOutRef.current || !firebaseUser) {
        isSigningOutRef.current = false;
        setUser(null);
        setProfile(null);
        setLoading(false);
        if (window.userBanUnsubscribe) {
          window.userBanUnsubscribe();
          window.userBanUnsubscribe = undefined;
        }
        return;
      }

      setLoading(true);

      // Handle unverified users
      if (!firebaseUser.emailVerified) {
        console.log("[Auth] Unverified user — signing out");
        try { await signOut(auth); } catch {}
        setUser(null);
        setProfile(null);
        setLoading(false);
        return;
      }

      // Fetch profile data — do NOT expose user to the app yet
      const profileData = await fetchProfile(firebaseUser.uid);

      // ── GATE 1: isBanned on user doc (covers all ban types, fastest path) ──
      if (profileData?.isBanned === true) {
        console.log("[Auth] ❌ Account is BANNED (isBanned). Signing out immediately.");
        setBanReason((profileData.banReason as string) || "Your account has been permanently banned.");
        setDeviceBanned(true);
        await signOut(auth);
        return;
      }

      // ── GATE 2: banned_emails Firestore check (hard gate, every session/tab) ──
      if (firebaseUser.email) {
        try {
          const emailBanSnap = await getDoc(doc(db, "banned_emails", firebaseUser.email.toLowerCase()));
          if (emailBanSnap.exists()) {
            const reason = (emailBanSnap.data()?.reason as string) || "Your email has been permanently banned.";
            console.log("[Auth] ❌ Email is BANNED. Signing out immediately. Reason:", reason);
            setBanReason(reason);
            setDeviceBanned(true);
            await signOut(auth);
            return;
          }
        } catch (err) {
          // Non-blocking — if rules not deployed yet, GATE 1 (isBanned) covers this
          console.warn("[Auth] Email ban check failed (non-blocking):", err);
        }
      }

      // ── ALL CHECKS PASSED — expose user to the app ──────────────────────
      setUser(firebaseUser);
      setLoading(false);

      // ── Real-time listener: user doc (catches live isBanned changes) ──────
      if (window.userBanUnsubscribe) {
        window.userBanUnsubscribe();
      }
      const userRef = doc(db, "users", firebaseUser.uid);
      window.userBanUnsubscribe = onSnapshot(userRef, (userDoc) => {
        if (userDoc.exists()) {
          const userData = userDoc.data();
          if (userData?.isBanned === true) {
            console.log("[Real-time Ban] 🚫 User just got banned! Signing out...");
            setBanReason((userData.banReason as string) || "Your account has been permanently banned.");
            setDeviceBanned(true);
            signOut(auth).catch(() => {});
          }
        }
      });

      // ── Real-time listener: banned_emails (catches live email bans mid-session) ──
      if (firebaseUser.email) {
        const emailBanRef = doc(db, "banned_emails", firebaseUser.email.toLowerCase());
        const emailBanUnsub = onSnapshot(emailBanRef, (snap) => {
          if (snap.exists()) {
            const reason = (snap.data()?.reason as string) || "Your email has been permanently banned.";
            console.log("[Real-time Ban] 🚫 Email just got banned! Signing out...");
            setBanReason(reason);
            setDeviceBanned(true);
            signOut(auth).catch(() => {});
          }
        });
        const prevUnsub = window.userBanUnsubscribe;
        window.userBanUnsubscribe = () => { prevUnsub?.(); emailBanUnsub(); };
      }
    });

    return () => {
      unsub();
      if (window.userBanUnsubscribe) {
        window.userBanUnsubscribe();
      }
    };
  }, []);

  async function register(
    email: string,
    password: string,
    name: string,
    honeypot: string,
    timingOk: boolean
  ) {
    console.log("[Register] ── Starting registration ──────────────────────");

    // ── Bot / security checks ─────────────────────────────────────────────
    console.log("[Register] Step 1: Bot detection checks...");
    if (honeypot.length > 0) throw new Error("Bot detected. Registration blocked.");
    if (!timingOk) throw new Error("Form submitted too quickly. Please try again.");
    if (detectHeadlessBot() || detectSuspiciousUserAgent()) {
      throw new Error("Automated browser detected. Registration blocked.");
    }
    console.log("[Register] Step 1: PASSED ✓");

    console.log("[Register] Step 2: Incognito/private mode check...");
    const incognito = await detectIncognitoMode();
    if (incognito) throw new Error("Private/Incognito browsing is not allowed. Please use a normal browser window.");
    console.log("[Register] Step 2: PASSED ✓");

    console.log("[Register] Step 3: Headless browser check...");
    const isHeadless = await detectHeadlessBrowser();
    if (isHeadless) throw new Error("Automated browser detected. Registration blocked.");
    console.log("[Register] Step 3: PASSED ✓");

    // ── Device fingerprint (monitoring only — not used for blocking) ───────
    console.log("[Register] Step 4: Generating device fingerprint...");
    const fingerprint = await withTimeout(getDeviceFingerprint(), 5000, "fingerprint-timeout");
    console.log("[Register] Step 4: Fingerprint =", fingerprint.slice(0, 16) + "...");

    // ── Email ban check before creating account ───────────────────────────
    console.log("[Register] Step 5: Checking email ban list...");
    try {
      const emailBanSnap = await getDoc(doc(db, "banned_emails", email.trim().toLowerCase()));
      if (emailBanSnap.exists()) {
        const reason = (emailBanSnap.data()?.reason as string) || "This email address is not allowed to register.";
        throw new Error(reason);
      }
    } catch (e) {
      if ((e as { code?: string })?.code === "permission-denied") {
        console.warn("[Register] Step 5: Email ban check permission-denied (non-blocking)");
      } else if (e instanceof Error) {
        throw e;
      }
    }
    console.log("[Register] Step 5: PASSED ✓");

    // ── Create Firebase Auth account ──────────────────────────────────────
    console.log("[Register] Step 6: Creating Firebase Auth account...");
    isRegisteringRef.current = true;
    let cred;
    try {
      cred = await createUserWithEmailAndPassword(auth, email, password);
      console.log("[Register] Step 6: Auth account created, UID =", cred.user.uid);
    } catch (authErr) {
      isRegisteringRef.current = false;
      console.error("[Register] Step 6: FAILED to create auth account:", authErr);
      throw authErr;
    }

    try {
      // ── Write main user profile ─────────────────────────────────────────
      console.log("[Register] Step 7: Writing users/" + cred.user.uid + " to Firestore...");
      await withHardTimeout(
        setDoc(doc(db, "users", cred.user.uid), {
          email,
          name,
          role: "user",
          balance: 0,
          pendingBalance: 0,
          registeredAt: serverTimestamp(),
          deviceFingerprint: fingerprint,
        }),
        8000,
        "setDoc users"
      );
      console.log("[Register] Step 7: users doc written ✓");

      // ── Write device fingerprint record (monitoring only) ────────────────
      console.log("[Register] Step 8: Writing device_fingerprints record...");
      try {
        await withHardTimeout(
          setDoc(doc(db, "device_fingerprints", fingerprint), {
            userId: cred.user.uid,
            userEmail: email,
            registeredAt: serverTimestamp(),
          }),
          8000,
          "setDoc device_fingerprints"
        );
        console.log("[Register] Step 8: device_fingerprints doc written ✓");
      } catch (fpErr) {
        console.error("[Register] Step 8: device_fingerprints write FAILED (non-blocking):", fpErr);
      }

      // ── Persist fingerprint locally ─────────────────────────────────────
      await persistFingerprintToIDB(fingerprint);

      // ── Send verification email ─────────────────────────────────────────
      console.log("[Register] Step 9: Sending verification email...");
      try {
        await withHardTimeout(sendEmailVerification(cred.user), 10000, "sendEmailVerification");
        console.log("[Register] Step 9: Verification email sent ✓");
      } catch (mailErr) {
        console.error("[Register] Step 9: Failed to send verification email:", mailErr);
      }

      console.log("[Register] ── Registration complete ✓ ──────────────────");
    } finally {
      isRegisteringRef.current = false;
      console.log("[Register] Releasing registration guard, signing out...");
      try { await signOut(auth); } catch { /* ignore */ }
    }
  }

  async function login(email: string, password: string): Promise<{ unverified?: boolean; role?: "user" | "admin" }> {
    console.log("[Login] Starting login for:", email);

    // ── Email ban pre-flight (BEFORE signing in — no Firebase session created) ──
    try {
      const emailBanSnap = await getDoc(doc(db, "banned_emails", email.trim().toLowerCase()));
      if (emailBanSnap.exists()) {
        const reason = (emailBanSnap.data()?.reason as string) || "This account has been permanently banned.";
        console.warn("[Login] Email is banned — blocking login. Reason:", reason);
        setBanReason(reason);
        setDeviceBanned(true);
        throw new Error(reason);
      }
    } catch (err) {
      if ((err as { code?: string })?.code === "permission-denied") {
        console.warn("[Login] banned_emails permission-denied (rules not deployed). Falling back to isBanned check.");
      } else {
        throw err;
      }
    }

    const cred = await signInWithEmailAndPassword(auth, email, password);
    if (!cred.user.emailVerified) {
      await signOut(auth);
      setProfile(null);
      return { unverified: true };
    }

    // ── Account-level ban check (isBanned field on user doc) ──────────────
    const userSnap = await getDoc(doc(db, "users", cred.user.uid));
    const userData = userSnap.data();

    if (userData?.isBanned === true) {
      const reason = (userData.banReason as string) || "This account has been suspended for a policy violation.";
      await signOut(auth);
      console.warn("[Login] Account is banned — blocking login.");
      setBanReason(reason);
      setDeviceBanned(true);
      throw new Error(reason);
    }

    // ── Save fingerprint for monitoring (not for banning) ─────────────────
    const fingerprint = await withTimeout(getDeviceFingerprint(), 5000, "fingerprint-timeout");
    await persistFingerprintToIDB(fingerprint);

    await fetchProfile(cred.user.uid);
    const role = (userData?.role as "user" | "admin") || "user";
    console.log("[Login] Login successful ✓ role:", role);
    return { role };
  }

  async function resendVerificationEmail(email: string, password: string) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    if (cred.user.emailVerified) {
      await signOut(auth);
      throw new Error("This email is already verified. You can sign in.");
    }
    await sendEmailVerification(cred.user);
    await signOut(auth);
  }

  async function logout() {
    // Set the sign-out flag BEFORE calling signOut so onAuthStateChanged
    // skips all ban checks and immediately clears state → instant redirect to /login
    isSigningOutRef.current = true;
    setUser(null);
    setProfile(null);
    setDeviceBanned(false);
    setBanReason("");
    if (window.userBanUnsubscribe) {
      window.userBanUnsubscribe();
      window.userBanUnsubscribe = undefined;
    }
    try { await signOut(auth); } catch { /* ignore */ }
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, deviceBanned, banReason, register, login, logout, refreshProfile, resendVerificationEmail }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
