import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export type SettlementAction = "approve" | "reject";

export type SettlementContext = {
  source?: "manual_admin_review" | "postback";
  actorId?: string;
  actorName?: string;
  reason?: string;
  verifiedBy?: string;
};

export type SettlementResult = {
  success: boolean;
  applied: boolean;
  completionId: string;
  transactionId?: string;
  message?: string;
};

type CompletionDoc = {
  userId: string;
  taskId: string;
  taskTitle?: string;
  taskType?: "manual" | "platform";
  reward?: number;
  status?: "pending" | "platform_pending" | "platform_approved" | "approved" | "rejected";
  settlementStatus?: SettlementAction;
  settlementDecision?: SettlementAction;
};

function clampNonNegative(value: number): number {
  return Math.max(0, value);
}

/**
 * Centralized wallet settlement for task completions.
 * Uses Firestore transaction to update completion, user wallet, and transaction log.
 */
export async function settleTaskCompletion(
  userId: string,
  completionId: string,
  reward: number,
  action: SettlementAction,
  context: SettlementContext = {}
): Promise<SettlementResult> {
  const completionRef = doc(db, "taskCompletions", completionId);

  try {
    const txResult = await runTransaction(db, async (tx) => {
      const completionSnap = await tx.get(completionRef);
      if (!completionSnap.exists()) {
        throw new Error("Task completion not found");
      }

      const completion = completionSnap.data() as CompletionDoc;
      if (completion.userId !== userId) {
        throw new Error("Completion does not belong to this user");
      }

      const currentStatus = completion.status ?? "pending";
      const currentSettlement = completion.settlementStatus ?? completion.settlementDecision;

      if (currentStatus !== "pending" && currentStatus !== "platform_approved") {
        return {
          success: true,
          applied: false,
          completionId,
          message: "Completion is not in a settleable state",
        } satisfies SettlementResult;
      }

      if (currentSettlement) {
        return {
          success: true,
          applied: false,
          completionId,
          message: "Completion already settled",
        } satisfies SettlementResult;
      }

      const settledReward = Number(completion.reward ?? reward);
      const userRef = doc(db, "users", userId);
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists()) {
        throw new Error("User not found");
      }

      const userData = userSnap.data() as { balance?: number; pendingBalance?: number };
      const currentPending = Number(userData.pendingBalance || 0);
      const currentBalance = Number(userData.balance || 0);
      const nextPending = clampNonNegative(currentPending - settledReward);
      const nextBalance = action === "approve" ? currentBalance + settledReward : currentBalance;

      const walletTxRef = doc(collection(db, "walletTransactions"));

      tx.update(completionRef, {
        status: action === "approve" ? "approved" : "rejected",
        settlementStatus: action,
        settlementDecision: action,
        settledAt: serverTimestamp(),
        approvedAt: action === "approve" ? serverTimestamp() : null,
        rejectedAt: action === "reject" ? serverTimestamp() : null,
        verifiedBy: action === "approve" ? context.verifiedBy || context.actorName || "admin" : null,
        rejectedBy: action === "reject" ? context.actorName || "admin" : null,
        rejectReason: action === "reject" ? context.reason || "Rejected by admin" : null,
        settlementSource: context.source || "manual_admin_review",
        settlementActorId: context.actorId || null,
        settlementTxId: walletTxRef.id,
      });

      tx.update(userRef, {
        pendingBalance: nextPending,
        balance: nextBalance,
        walletUpdatedAt: serverTimestamp(),
      });

      tx.set(walletTxRef, {
        userId,
        completionId,
        taskId: completion.taskId || "",
        taskTitle: completion.taskTitle || "",
        taskType: completion.taskType || "manual",
        amount: settledReward,
        status: action === "approve" ? "approved" : "rejected",
        type: action === "approve" ? "task_settlement_approved" : "task_settlement_rejected",
        source: context.source || "manual_admin_review",
        actorId: context.actorId || null,
        actorName: context.actorName || null,
        reason: context.reason || null,
        verifiedBy: context.verifiedBy || null,
        duplicateGuard: `${completionId}:${action}`,
        createdAt: serverTimestamp(),
      });

      return {
        success: true,
        applied: true,
        completionId,
        transactionId: walletTxRef.id,
      } satisfies SettlementResult;
    });

    return txResult;
  } catch (error) {
    return {
      success: false,
      applied: false,
      completionId,
      message: error instanceof Error ? error.message : "Settlement failed",
    };
  }
}
