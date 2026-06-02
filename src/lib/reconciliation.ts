import { collection, getDocs, query, where, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface CompletionRecord {
  id: string;
  taskId: string;
  taskTitle: string;
  taskPlatform: string;
  taskType: "manual" | "platform";
  reward: number;
  status: "pending" | "approved" | "rejected";
  verifiedBy?: string;
  rejectReason?: string;
  completedAt: Date;
}

export interface UserReconciliation {
  userId: string;
  completions: CompletionRecord[];
  totalApprovedEarnings: number;
  platformVerifiedEarnings: number;
  unverifiedEarnings: number;
  rejectedCompletions: CompletionRecord[];
  status: "clean" | "unverified" | "flagged";
}

export async function fetchUserReconciliation(userId: string): Promise<UserReconciliation> {
  const q = query(collection(db, "taskCompletions"), where("userId", "==", userId));
  const snap = await getDocs(q);

  const completions: CompletionRecord[] = snap.docs.map((d) => {
    const explicitType = d.data().taskType as string | undefined;
    const hasVerifiedBy = !!d.data().verifiedBy;
    // If taskType field is missing, infer from verifiedBy:
    // verifiedBy set → came from a platform postback → "platform"
    // no verifiedBy → approved by admin, no platform report → "manual"
    const taskType: "manual" | "platform" =
      explicitType === "manual" || explicitType === "platform"
        ? (explicitType as "manual" | "platform")
        : hasVerifiedBy
        ? "platform"
        : "manual";
    return {
      id: d.id,
      taskId: d.data().taskId as string,
      taskTitle: (d.data().taskTitle as string) || "Unknown Task",
      taskPlatform: (d.data().taskPlatform as string) || "",
      taskType,
      reward: (d.data().reward as number) || 0,
      status: (d.data().status as CompletionRecord["status"]) || "pending",
      verifiedBy: d.data().verifiedBy as string | undefined,
      rejectReason: (d.data().rejectReason as string) || (d.data().note as string) || undefined,
      completedAt: (d.data().completedAt as Timestamp)?.toDate() || new Date(),
    };
  });

  const approvedCompletions = completions.filter((c) => c.status === "approved");
  const rejectedCompletions = completions.filter((c) => c.status === "rejected");

  // Total approved earnings across all task types (manual + platform) — informational.
  const totalApprovedEarnings = approvedCompletions.reduce((s, c) => s + c.reward, 0);

  // Platform reconciliation only considers approved PLATFORM tasks.
  // Manual tasks are valid earnings but have no platform report and must not
  // reduce the reconciliation percentage or block withdrawal approval.
  const approvedPlatformCompletions = approvedCompletions.filter(
    (c) => c.taskType === "platform"
  );
  const totalPlatformApprovedEarnings = approvedPlatformCompletions.reduce(
    (s, c) => s + c.reward,
    0
  );
  const platformVerifiedEarnings = approvedPlatformCompletions
    .filter((c) => !!c.verifiedBy)
    .reduce((s, c) => s + c.reward, 0);
  const unverifiedEarnings = Math.max(
    0,
    totalPlatformApprovedEarnings - platformVerifiedEarnings
  );

  // Status reflects only platform verification coverage.
  // Rejected tasks are correctly handled by wallet balance adjustments and do NOT
  // block withdrawals — they are excluded from status here.
  // Pending tasks are not withdrawable and do not participate in reconciliation.
  let status: UserReconciliation["status"] = "clean";
  if (unverifiedEarnings > 0.000001) status = "unverified";

  return {
    userId,
    completions,
    totalApprovedEarnings,
    platformVerifiedEarnings,
    unverifiedEarnings,
    rejectedCompletions,
    status,
  };
}

export interface RejectedItem {
  userId: string;
  userEmail: string;
  userName: string;
  taskId: string;
  taskTitle: string;
  taskPlatform: string;
  reward: number;
  rejectReason: string;
  completedAt: Date;
}

export interface PendingVerificationItem {
  userId: string;
  userEmail: string;
  userName: string;
  taskId: string;
  taskTitle: string;
  reward: number;
  completedAt: Date;
}

export interface GlobalReconciliation {
  totalMatchedAmount: number;
  totalMatchedCount: number;
  totalRejectedAmount: number;
  totalRejectedCount: number;
  totalUnverifiedAmount: number;
  totalUnverifiedCount: number;
  totalApprovedAmount: number;
  totalWithdrawalRequestAmount: number;
  isBalanced: boolean;
  rejectedItems: RejectedItem[];
  pendingVerificationItems: PendingVerificationItem[];
}

export async function fetchGlobalReconciliation(
  withdrawalAmount: number,
  knownUserIds?: string[]
): Promise<GlobalReconciliation> {
  type RawCompletion = {
    id: string; userId: string; taskId: string; taskTitle: string;
    taskPlatform: string; taskType: "manual" | "platform"; reward: number;
    status: "pending" | "approved" | "rejected";
    verifiedBy?: string; rejectReason: string; completedAt: Date;
  };

  let allCompletions: RawCompletion[] = [];
  const userMap: Record<string, { email: string; name: string }> = {};

  try {
    const [completionsSnap, usersSnap] = await Promise.all([
      getDocs(collection(db, "taskCompletions")),
      getDocs(collection(db, "users")),
    ]);
    usersSnap.docs.forEach((d) => {
      userMap[d.id] = {
        email: (d.data().email as string) || "",
        name: (d.data().name as string) || "Unknown",
      };
    });
    allCompletions = completionsSnap.docs.map((d) => {
      const explicitType = d.data().taskType as string | undefined;
      const hasVerifiedBy = !!d.data().verifiedBy;
      const taskType: "manual" | "platform" =
        explicitType === "manual" || explicitType === "platform"
          ? (explicitType as "manual" | "platform")
          : hasVerifiedBy ? "platform" : "manual";
      return {
        id: d.id,
        userId: d.data().userId as string,
        taskId: d.data().taskId as string,
        taskTitle: (d.data().taskTitle as string) || "Unknown Task",
        taskPlatform: (d.data().taskPlatform as string) || "",
        taskType,
        reward: (d.data().reward as number) || 0,
        status: d.data().status as "pending" | "approved" | "rejected",
        verifiedBy: d.data().verifiedBy as string | undefined,
        rejectReason: (d.data().rejectReason as string) || (d.data().note as string) || "",
        completedAt: (d.data().completedAt as Timestamp)?.toDate() || new Date(),
      };
    });
  } catch (e: unknown) {
    const isPermissionError =
      e instanceof Error && (e.message.includes("permission") || e.message.includes("insufficient"));
    if (!isPermissionError) throw e;

    const uids = knownUserIds ?? [];
    const perUserResults = await Promise.all(
      uids.map((uid) =>
        getDocs(query(collection(db, "taskCompletions"), where("userId", "==", uid)))
      )
    );
    perUserResults.forEach((snap) => {
      snap.docs.forEach((d) => {
        const uid = d.data().userId as string;
        if (!userMap[uid]) {
          userMap[uid] = { email: d.data().userEmail as string || "", name: d.data().userName as string || "Unknown" };
        }
        const explicitType2 = d.data().taskType as string | undefined;
        const hasVerifiedBy2 = !!d.data().verifiedBy;
        const taskType2: "manual" | "platform" =
          explicitType2 === "manual" || explicitType2 === "platform"
            ? (explicitType2 as "manual" | "platform")
            : hasVerifiedBy2 ? "platform" : "manual";
        allCompletions.push({
          id: d.id,
          userId: uid,
          taskId: d.data().taskId as string,
          taskTitle: (d.data().taskTitle as string) || "Unknown Task",
          taskPlatform: (d.data().taskPlatform as string) || "",
          taskType: taskType2,
          reward: (d.data().reward as number) || 0,
          status: d.data().status as "pending" | "approved" | "rejected",
          verifiedBy: d.data().verifiedBy as string | undefined,
          rejectReason: (d.data().rejectReason as string) || (d.data().note as string) || "",
          completedAt: (d.data().completedAt as Timestamp)?.toDate() || new Date(),
        });
      });
    });
  }

  const approved = allCompletions.filter((c) => c.status === "approved");
  const rejected = allCompletions.filter((c) => c.status === "rejected");

  // Platform reconciliation only counts approved PLATFORM tasks.
  // Approved manual tasks are excluded: they have no platform report requirement.
  const platformApproved = approved.filter((c) => c.taskType === "platform");
  const verified = platformApproved.filter((c) => !!c.verifiedBy);
  const unverified = platformApproved.filter((c) => !c.verifiedBy);

  const totalMatchedAmount = verified.reduce((s, c) => s + c.reward, 0);
  const totalRejectedAmount = rejected.reduce((s, c) => s + c.reward, 0);
  const totalUnverifiedAmount = unverified.reduce((s, c) => s + c.reward, 0);
  const totalApprovedAmount = approved.reduce((s, c) => s + c.reward, 0);

  // Manual approved earnings are valid withdrawable funds — no platform report needed.
  const manualApprovedAmount = approved
    .filter((c) => c.taskType === "manual")
    .reduce((s, c) => s + c.reward, 0);

  const rejectedItems: RejectedItem[] = rejected.map((c) => ({
    userId: c.userId,
    userEmail: userMap[c.userId]?.email || "",
    userName: userMap[c.userId]?.name || "Unknown",
    taskId: c.taskId,
    taskTitle: c.taskTitle,
    taskPlatform: c.taskPlatform,
    reward: c.reward,
    rejectReason: c.rejectReason || "Rejected by network",
    completedAt: c.completedAt,
  }));

  // Pending verification: only approved PLATFORM tasks without a platform report.
  // Pending-status tasks and manual tasks are intentionally excluded.
  const pendingVerificationItems: PendingVerificationItem[] = unverified.map((c) => ({
    userId: c.userId,
    userEmail: userMap[c.userId]?.email || "",
    userName: userMap[c.userId]?.name || "Unknown",
    taskId: c.taskId,
    taskTitle: c.taskTitle,
    reward: c.reward,
    completedAt: c.completedAt,
  }));

  return {
    totalMatchedAmount,
    totalMatchedCount: verified.length,
    totalRejectedAmount,
    totalRejectedCount: rejected.length,
    totalUnverifiedAmount,
    totalUnverifiedCount: unverified.length,
    totalApprovedAmount,
    totalWithdrawalRequestAmount: withdrawalAmount,
    isBalanced: (totalMatchedAmount + manualApprovedAmount) >= withdrawalAmount - 0.000001,
    rejectedItems,
    pendingVerificationItems,
  };
}

export interface PlatformReportEntry {
  userId: string;
  taskId: string;
  amount: number;
  status: "approved" | "rejected";
  reason?: string;
}

export interface ReportComparisonResult {
  matchedCount: number;
  matchedAmount: number;
  mismatchedItems: {
    userId: string;
    taskId: string;
    ourAmount: number;
    platformAmount: number;
    reason: string;
  }[];
  missingInPlatform: { userId: string; taskId: string; ourAmount: number }[];
  rejectedByPlatform: { userId: string; taskId: string; amount: number; reason: string }[];
  totalPlatformApproved: number;
  totalOurApproved: number;
  isFullMatch: boolean;
}

export async function comparePlatformReport(
  entries: PlatformReportEntry[]
): Promise<ReportComparisonResult> {
  const completionsSnap = await getDocs(collection(db, "taskCompletions"));

  // Only approved PLATFORM tasks are compared against platform reports.
  // Manual tasks do not appear in platform reports and must not be treated as missing.
  const ourApproved: Record<string, { userId: string; taskId: string; reward: number }> = {};
  completionsSnap.docs.forEach((d) => {
    const taskType = (d.data().taskType as string) || "platform";
    if (d.data().status === "approved" && taskType === "platform") {
      const key = `${d.data().userId as string}:${d.data().taskId as string}`;
      ourApproved[key] = {
        userId: d.data().userId as string,
        taskId: d.data().taskId as string,
        reward: (d.data().reward as number) || 0,
      };
    }
  });

  const platformApproved = entries.filter((e) => e.status === "approved");
  const platformRejected = entries.filter((e) => e.status === "rejected");

  const platformMap: Record<string, PlatformReportEntry> = {};
  platformApproved.forEach((e) => { platformMap[`${e.userId}:${e.taskId}`] = e; });

  let matchedCount = 0;
  let matchedAmount = 0;
  const mismatchedItems: ReportComparisonResult["mismatchedItems"] = [];
  const missingInPlatform: ReportComparisonResult["missingInPlatform"] = [];

  Object.entries(ourApproved).forEach(([key, ours]) => {
    const platform = platformMap[key];
    if (!platform) {
      missingInPlatform.push({ userId: ours.userId, taskId: ours.taskId, ourAmount: ours.reward });
    } else if (Math.abs(platform.amount - ours.reward) > 0.0001) {
      mismatchedItems.push({
        userId: ours.userId,
        taskId: ours.taskId,
        ourAmount: ours.reward,
        platformAmount: platform.amount,
        reason: `Amount mismatch: we expected $${ours.reward.toFixed(5)}, platform paid $${platform.amount.toFixed(5)}`,
      });
    } else {
      matchedCount++;
      matchedAmount += ours.reward;
    }
  });

  const totalPlatformApproved = platformApproved.reduce((s, e) => s + e.amount, 0);
  const totalOurApproved = Object.values(ourApproved).reduce((s, e) => s + e.reward, 0);

  return {
    matchedCount,
    matchedAmount,
    mismatchedItems,
    missingInPlatform,
    rejectedByPlatform: platformRejected.map((e) => ({
      userId: e.userId,
      taskId: e.taskId,
      amount: e.amount,
      reason: e.reason || "Rejected by platform",
    })),
    totalPlatformApproved,
    totalOurApproved,
    isFullMatch:
      mismatchedItems.length === 0 &&
      missingInPlatform.length === 0 &&
      Math.abs(totalPlatformApproved - totalOurApproved) < 0.001,
  };
}
