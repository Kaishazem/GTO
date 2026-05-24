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
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  getDeviceFingerprint,
  detectHeadlessBrowser,
  detectIncognitoMode,
  persistFingerprintToIDB,
  loadFingerprintFromIDB,
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
  allowDuplicateDevice?: boolean;
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

async function isDeviceBanned(fingerprint: string): Promise<boolean> {
  if (!fingerprint) return false;
  try {
    const q = query(collection(db, "banned_devices"), where("fingerprint", "==", fingerprint));
    const snap = await getDocs(q);
    return !snap.empty;
  } catch (err) {
    console.warn("[isDeviceBanned] Check failed (non-blocking):", err);
    return false;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [deviceBanned, setDeviceBanned] = useState(false);
  const [banReason, setBanReason] = useState("");

  // ── Registration guard ────────────────────────────────────────────────────
  // Prevents onAuthStateChanged from auto-signing-out a newly created user
  // before we finish writing their Firestore documents.
  const isRegisteringRef = useRef(false);

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
      allowDuplicateDevice: data.allowDuplicateDevice === true,
    });
    return data;
  }

  async function refreshProfile() {
    if (user) await fetchProfile(user.uid);
  }

    useEffect(() => {
    // 1. Check device ban from IndexedDB on initial load
    (async () => {
      try {
        const idbFp = await loadFingerprintFromIDB();
        if (idbFp) {
          const banned = await isDeviceBanned(idbFp);
          if (banned) setDeviceBanned(true);
        }
      } catch { /* non-blocking */ }
    })();

    // 2. Auth State Listener
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (isRegisteringRef.current) {
        console.log("[Auth] Registration in progress - skipping");
        return;
      }

      setLoading(true);

      // Handle unverified users
      if (firebaseUser && !firebaseUser.emailVerified) {
        console.log("[Auth] Unverified user - signing out");
        try { await signOut(auth); } catch {}
        setUser(null);
        setProfile(null);
        setLoading(false);
        return;
      }

      if (firebaseUser) {
        // Fetch profile data — but do NOT expose user to the app yet
        const profileData = await fetchProfile(firebaseUser.uid);

        // ── GATE 1: isBanned field on user doc (fastest check — already fetched) ──
        if (profileData?.isBanned === true) {
          console.log("[Auth] ❌ Account is BANNED (isBanned). Signing out immediately.");
          setBanReason((profileData.banReason as string) || "Your account has been permanently banned.");
          setDeviceBanned(true);
          await signOut(auth);
          return; // loading stays true until the null user event fires
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
              return; // loading stays true until the null user event fires
            }
          } catch (err) {
            // Non-blocking — if Firestore is unreachable we fail open (better than locking out everyone)
            console.warn("[Auth] Email ban check failed (non-blocking):", err);
          }
        }

        // ── ALL CHECKS PASSED — only now expose user to the app ──
        setUser(firebaseUser);
        setLoading(false);

        // ── GATE 3: Real-time listener on user doc (catches live bans mid-session) ──
        if (window.userBanUnsubscribe) {
          window.userBanUnsubscribe();
        }

        const userRef = doc(db, "users", firebaseUser.uid);
        window.userBanUnsubscribe = onSnapshot(userRef, (userDoc) => {
          if (userDoc.exists()) {
            const userData = userDoc.data();
            if (userData?.isBanned === true) {
              console.log("[Real-time Ban] 🚫 User just got banned via user doc! Signing out...");
              setBanReason((userData.banReason as string) || "Your account has been permanently banned.");
              setDeviceBanned(true);
              signOut(auth).catch(() => {});
            }
          }
        });

        // ── GATE 4: Real-time listener on banned_emails (catches live email bans mid-session) ──
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

      } else {
        // User logged out
        setProfile(null);
        setLoading(false);
        if (window.userBanUnsubscribe) {
          window.userBanUnsubscribe();
        }
      }
    });

    // Cleanup function
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

    // ── Device fingerprint (5-second max) ────────────────────────────────
    console.log("[Register] Step 4: Generating device fingerprint (5s max)...");
    const fingerprint = await withTimeout(getDeviceFingerprint(), 5000, "fingerprint-timeout");
    console.log("[Register] Step 4: Fingerprint =", fingerprint.slice(0, 16) + "...");
    try { localStorage.setItem("gto_device_fp", fingerprint); } catch { /* ignore */ }

    // ── Ban / duplicate checks ────────────────────────────────────────────
    console.log("[Register] Step 5: Checking device ban list (Firestore)...");
    try {
      const banned = await withTimeout(isDeviceBanned(fingerprint), 5000, false);
      console.log("[Register] Step 5: banned =", banned);
      if (banned) throw new Error("Fraud detected. This device is permanently banned.");
    } catch (e) {
      if (e instanceof Error && e.message.includes("permanently banned")) throw e;
      console.warn("[Register] Step 5: Ban check failed (non-blocking):", e);
    }

    console.log("[Register] Step 6: Checking duplicate device fingerprint (Firestore)...");
    try {
      const fpRef = doc(db, "device_fingerprints", fingerprint);
      console.log("[Register] Step 6: Reading device_fingerprints/" + fingerprint.slice(0, 8) + "...");
      const fpDoc = await withTimeout(getDoc(fpRef), 5000, null);
      console.log("[Register] Step 6: fpDoc exists =", fpDoc?.exists?.() ?? "timeout/null");
      if (fpDoc?.exists()) {
        const override = fpDoc.data()?.allowDuplicateDevice === true;
        if (!override) throw new Error("This device is already registered. Please login to your existing account.");
        console.warn("[Register] Step 6: Duplicate device allowed by admin override.");
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("already registered")) throw e;
      const idbFp = await loadFingerprintFromIDB();
      const lsFp = (() => { try { return localStorage.getItem("gto_device_fp"); } catch { return null; } })();
      if ((idbFp && idbFp === fingerprint) || (lsFp && lsFp === fingerprint)) {
        console.warn("[Register] Step 6: Could not verify server-side uniqueness, IDB match found.");
      } else {
        console.warn("[Register] Step 6: Duplicate check error (non-blocking):", e);
      }
    }

    // ── Create Firebase Auth account ──────────────────────────────────────
    console.log("[Register] Step 7: Creating Firebase Auth account...");
    isRegisteringRef.current = true; // 🔒 Block onAuthStateChanged auto-signout
    let cred;
    try {
      cred = await createUserWithEmailAndPassword(auth, email, password);
      console.log("[Register] Step 7: Auth account created, UID =", cred.user.uid);
    } catch (authErr) {
      isRegisteringRef.current = false;
      console.error("[Register] Step 7: FAILED to create auth account:", authErr);
      throw authErr;
    }

    try {
      // ── Write main user profile ─────────────────────────────────────────
      console.log("[Register] Step 8: Writing users/" + cred.user.uid + " to Firestore...");
      await withHardTimeout(
        setDoc(doc(db, "users", cred.user.uid), {
          email,
          name,
          role: "user",
          balance: 0,
          pendingBalance: 0,
          registeredAt: serverTimestamp(),
          deviceFingerprint: fingerprint,
          allowDuplicateDevice: false,
        }),
        8000,
        "setDoc users"
      );
      console.log("[Register] Step 8: users doc written ✓");

      // ── Write device fingerprint record ─────────────────────────────────
      console.log("[Register] Step 9: Writing device_fingerprints/" + fingerprint.slice(0, 8) + "...");
      try {
        await withHardTimeout(
          setDoc(doc(db, "device_fingerprints", fingerprint), {
            userId: cred.user.uid,
            registeredAt: serverTimestamp(),
            allowDuplicateDevice: false,
          }),
          8000,
          "setDoc device_fingerprints"
        );
        console.log("[Register] Step 9: device_fingerprints doc written ✓");
      } catch (fpErr) {
        console.error("[Register] Step 9: device_fingerprints write FAILED (non-blocking):", fpErr);
        // non-blocking — don't abort registration for this
      }

      // ── Persist fingerprint locally ─────────────────────────────────────
      console.log("[Register] Step 10: Persisting fingerprint to IndexedDB...");
      await persistFingerprintToIDB(fingerprint);
      try { localStorage.setItem("gto_device_fp", fingerprint); } catch { /* ignore */ }
      console.log("[Register] Step 10: Fingerprint persisted ✓");

      // ── Send verification email ─────────────────────────────────────────
      console.log("[Register] Step 11: Sending verification email...");
      try {
        await withHardTimeout(sendEmailVerification(cred.user), 10000, "sendEmailVerification");
        await new Promise(res => setTimeout(res, 500));
        console.log("[Register] Step 11: Verification email sent ✓");
      } catch (mailErr) {
        console.error("[Register] Step 11: Failed to send verification email:", mailErr);
        // Non-blocking — user was created and Firestore written; email can be resent
      }

      console.log("[Register] ── Registration complete ✓ ──────────────────");
    } finally {
      // ── Always release the guard and sign out ───────────────────────────
      isRegisteringRef.current = false;
      console.log("[Register] Releasing registration guard, signing out...");
      try { await signOut(auth); } catch { /* ignore */ }
    }
  }

  async function login(email: string, password: string): Promise<{ unverified?: boolean; role?: "user" | "admin" }> {
    console.log("[Login] Starting login for:", email);

    // ── Device-level ban check ────────────────────────────────────────────
    const fingerprint = await withTimeout(getDeviceFingerprint(), 5000, "fingerprint-timeout");
    const deviceBannedResult = await withTimeout(isDeviceBanned(fingerprint), 5000, false);
    if (deviceBannedResult) throw new Error("Fraud detected. This device is permanently banned.");

    // ── Email ban pre-flight check (BEFORE signing in — catches bans on login attempts) ──
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
        // Firestore rules not yet deployed — fail open and rely on isBanned check below
        console.warn("[Login] banned_emails permission-denied (rules not deployed). Falling back to isBanned check.");
      } else {
        // Re-throw: either our own ban error or an unexpected Firestore error
        throw err;
      }
    }

    const cred = await signInWithEmailAndPassword(auth, email, password);
    if (!cred.user.emailVerified) {
      await signOut(auth);
      setProfile(null);
      return { unverified: true };
    }

    // ── Account-level ban check (isBanned field on user doc — fastest, most reliable) ──
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

    // ── Stored fingerprint ban check ──────────────────────────────────────
    const storedFp = userData?.deviceFingerprint as string | undefined;
    if (storedFp) {
      const storedBanned = await withTimeout(isDeviceBanned(storedFp), 5000, false);
      if (storedBanned) {
        await signOut(auth);
        throw new Error("This account has been suspended. Contact support.");
      }
    }

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
    await signOut(auth);
    setProfile(null);
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
