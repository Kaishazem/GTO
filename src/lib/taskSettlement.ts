import { doc, DocumentData, DocumentReference, getDoc } from "firebase/firestore";
import { settleTaskCompletion as settleWallet } from "@/lib/walletSettlement";

type SettlementDecision = "approved" | "rejected";

type SettlementContext = {
  source: "postback" | "manual_admin_review";
  actorId?: string;
  actorName?: string;
  reason?: string;
  verifiedBy?: string;
};

type SettlementResult =
  | { ok: true; applied: true; completionId: string; transactionId: string; decision: SettlementDecision }
  | { ok: true; applied: false; completionId: string; reason: "already_processed" | "invalid_status" | "already_settled" };

/** Adapter for postback flow — delegates to centralized wallet settlement. */
export async function settleTaskCompletion(
  completionRef: DocumentReference<DocumentData>,
  decision: SettlementDecision,
  context: SettlementContext
): Promise<SettlementResult> {
  const completionId = completionRef.id;
  const completionSnap = await getDoc(completionRef);
  if (!completionSnap.exists()) {
    throw new Error("Task completion not found");
  }

  const data = completionSnap.data();
  const userId = String(data.userId || "");
  const reward = Number(data.reward || 0);
  const action = decision === "approved" ? "approve" : "reject";

  const result = await settleWallet(userId, completionId, reward, action, {
    source: context.source,
    actorId: context.actorId,
    actorName: context.actorName,
    reason: context.reason,
    verifiedBy: context.verifiedBy,
  });

  if (!result.success) {
    throw new Error(result.message || "Settlement failed");
  }

  if (!result.applied) {
    const reason = result.message?.toLowerCase().includes("pending")
      ? "invalid_status"
      : "already_settled";
    return { ok: true, applied: false, completionId, reason };
  }

  return {
    ok: true,
    applied: true,
    completionId,
    transactionId: result.transactionId || "",
    decision,
  };
}
