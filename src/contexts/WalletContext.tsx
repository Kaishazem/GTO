import { createContext, useContext, useState, useEffect } from "react";
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  Timestamp,
  updateDoc,
  doc,
  increment,
  getDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "./AuthContext";
import { fetchUserReconciliation } from "@/lib/reconciliation";

export interface Withdrawal {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  amount: number;
  netAmount: number;
  gasFee: number;
  feePercent: number;
  currency: "USDT" | "USDC";
  network: "TRC20" | "ERC20";
  walletAddress: string;
  trc20Address: string;
  status: "pending" | "approved" | "rejected";
  createdAt: Date;
  processedAt?: Date;
  note?: string;
}

interface WalletContextType {
  withdrawals: Withdrawal[];
  allWithdrawals: Withdrawal[];
  loading: boolean;
  requestWithdrawal: (
    amount: number,
    walletAddress: string,
    currency: "USDT" | "USDC",
    network: "TRC20" | "ERC20",
    gasFee: number,
    netAmount: number,
    feePercent: number
  ) => Promise<void>;
  fetchWithdrawals: () => Promise<void>;
  fetchAllWithdrawals: () => Promise<void>;
  approveWithdrawal: (id: string) => Promise<void>;
  rejectWithdrawal: (id: string, note?: string) => Promise<void>;
}

const WalletContext = createContext<WalletContextType | null>(null);

function mapWithdrawal(d: { id: string; data: () => Record<string, unknown> }): Withdrawal {
  const data = d.data();
  const walletAddress = (data.walletAddress as string) || (data.trc20Address as string) || "";
  return {
    id: d.id,
    userId: data.userId as string,
    userEmail: data.userEmail as string,
    userName: data.userName as string,
    amount: data.amount as number,
    netAmount: (data.netAmount as number) ?? (data.amount as number),
    gasFee: (data.gasFee as number) ?? 1,
    feePercent: (data.feePercent as number) ?? 5,
    currency: (data.currency as "USDT" | "USDC") || "USDT",
    network: (data.network as "TRC20" | "ERC20") || "TRC20",
    walletAddress,
    trc20Address: walletAddress,
    status: data.status as "pending" | "approved" | "rejected",
    createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
    processedAt: data.processedAt ? (data.processedAt as Timestamp).toDate() : undefined,
    note: data.note as string | undefined,
  };
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { user, profile, refreshProfile } = useAuth();
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [allWithdrawals, setAllWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(false);

  async function fetchWithdrawals() {
    if (!user) return;
    setLoading(true);
    const q = query(collection(db, "withdrawals"), where("userId", "==", user.uid));
    const snap = await getDocs(q);
    const fetched = snap.docs.map((d) => mapWithdrawal(d as Parameters<typeof mapWithdrawal>[0]));
    fetched.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    setWithdrawals(fetched);
    setLoading(false);
  }

  async function fetchAllWithdrawals() {
    setLoading(true);
    const snap = await getDocs(collection(db, "withdrawals"));
    const fetched = snap.docs.map((d) => mapWithdrawal(d as Parameters<typeof mapWithdrawal>[0]));
    fetched.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    setAllWithdrawals(fetched);
    setLoading(false);
  }

  async function checkWalletUniqueness(
    walletAddress: string,
    currentUserId: string
  ): Promise<{ isDuplicate: boolean; allowedByAdmin: boolean }> {
    const { getSettings } = await import("@/lib/settings");
    const settings = await getSettings();
    const allowedByAdmin = settings.allowDuplicateWallets === true;

    const addrLower = walletAddress.toLowerCase();

    // Check withdrawals collection (exact + lowercase)
    const [exactSnap, lowerSnap, usersSnap] = await Promise.all([
      getDocs(query(collection(db, "withdrawals"), where("walletAddress", "==", walletAddress))),
      getDocs(query(collection(db, "withdrawals"), where("walletAddressLower", "==", addrLower))),
      getDocs(query(collection(db, "users"), where("trc20Address", "==", walletAddress))),
    ]);

    const allDocs = [
      ...exactSnap.docs,
      ...lowerSnap.docs,
      ...usersSnap.docs,
    ];

    const isDuplicate = allDocs.some((d) => {
      const uid = (d.data().userId as string) || d.id;
      return uid !== currentUserId;
    });

    return { isDuplicate, allowedByAdmin };
  }

  async function requestWithdrawal(
    amount: number,
    walletAddress: string,
    currency: "USDT" | "USDC",
    network: "TRC20" | "ERC20",
    gasFee: number,
    netAmount: number,
    feePercent: number
  ) {
    if (!user || !profile) throw new Error("You must be logged in");
    if (profile.balance < amount) throw new Error("Insufficient balance");

    const pendingQ = query(
      collection(db, "withdrawals"),
      where("userId", "==", user.uid),
      where("status", "==", "pending")
    );
    const pendingSnap = await getDocs(pendingQ);
    if (!pendingSnap.empty) throw new Error("You already have a pending withdrawal request");

    // Wallet uniqueness check — runs BEFORE saving
    const { isDuplicate, allowedByAdmin } = await checkWalletUniqueness(walletAddress, user.uid);
    if (isDuplicate && !allowedByAdmin) {
      throw new Error(
        "This wallet address is already in use by another account. Please use a unique wallet address."
      );
    }

    const withdrawalRef = await addDoc(collection(db, "withdrawals"), {
      userId: user.uid,
      userEmail: profile.email,
      userName: profile.name,
      amount,
      netAmount,
      gasFee,
      feePercent,
      currency,
      network,
      walletAddress,
      walletAddressLower: walletAddress.toLowerCase(),
      trc20Address: walletAddress,
      status: "pending",
      createdAt: serverTimestamp(),
    });

    await updateDoc(doc(db, "users", user.uid), {
      balance: increment(-amount),
      pendingBalance: increment(amount),
    });

    // Async fraud-detection alert — non-blocking, fires after withdrawal is saved
    Promise.all([
      fetchUserReconciliation(user.uid),
      getDocs(query(collection(db, "withdrawals"), where("walletAddress", "==", walletAddress))),
    ]).then(async ([recon, sameWalletSnap]) => {
      const fraudReasons: string[] = [];

      if (recon.status === "flagged") {
        fraudReasons.push(`${recon.rejectedCompletions.length} task(s) rejected by platform`);
      }

      const sameWalletOtherUsers = sameWalletSnap.docs.filter(
        (d) => d.data().userId !== user.uid
      );
      if (sameWalletOtherUsers.length > 0) {
        fraudReasons.push(`Wallet address shared with ${sameWalletOtherUsers.length} other account(s)`);
      }

      if (fraudReasons.length > 0) {
        await addDoc(collection(db, "adminAlerts"), {
          type: "fraud_flag",
          userId: user.uid,
          userEmail: profile.email,
          userName: profile.name,
          withdrawalId: withdrawalRef.id,
          withdrawalAmount: amount,
          walletAddress,
          reconciliationStatus: recon.status,
          flaggedTaskCount: recon.rejectedCompletions.length,
          flaggedTasks: recon.rejectedCompletions.slice(0, 5).map((c) => ({
            taskTitle: c.taskTitle,
            reward: c.reward,
            rejectReason: c.rejectReason || "",
          })),
          sameWalletUserCount: sameWalletOtherUsers.length,
          fraudReasons,
          read: false,
          createdAt: serverTimestamp(),
        });
      }
    }).catch(() => { /* non-blocking — never fail the withdrawal itself */ });

    await fetchWithdrawals();
    await refreshProfile();
  }

  async function approveWithdrawal(id: string) {
    const wRef = doc(db, "withdrawals", id);
    const wSnap = await getDoc(wRef);
    const wData = wSnap.data() as Withdrawal | undefined;
    if (!wData) throw new Error("Withdrawal not found");
    if (wData.status !== "pending") {
      throw new Error(`Withdrawal already processed (${wData.status})`);
    }

    await updateDoc(wRef, { status: "approved", processedAt: serverTimestamp() });

    await updateDoc(doc(db, "users", wData.userId), {
      pendingBalance: increment(-wData.amount),
    });
    await fetchAllWithdrawals();
  }

  async function rejectWithdrawal(id: string, note?: string) {
    const wRef = doc(db, "withdrawals", id);
    const wSnap = await getDoc(wRef);
    const wData = wSnap.data() as Withdrawal | undefined;
    if (!wData) throw new Error("Withdrawal not found");
    if (wData.status !== "pending") {
      throw new Error(`Withdrawal already processed (${wData.status})`);
    }

    await updateDoc(wRef, { status: "rejected", processedAt: serverTimestamp(), note: note || "" });

    await updateDoc(doc(db, "users", wData.userId), {
      balance: increment(wData.amount),
      pendingBalance: increment(-wData.amount),
    });
    await fetchAllWithdrawals();
  }

  useEffect(() => {
    if (user) fetchWithdrawals();
  }, [user]);

  return (
    <WalletContext.Provider
      value={{ withdrawals, allWithdrawals, loading, requestWithdrawal, fetchWithdrawals, fetchAllWithdrawals, approveWithdrawal, rejectWithdrawal }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
