import { Router, Request, Response } from "express";
import { db } from "../firebase-admin";
import * as admin from "firebase-admin";

const router = Router();

function now() {
  return new Date().toISOString();
}

async function getPostbackSecret(): Promise<string> {
  if (!db) return "";
  try {
    const snap = await db.collection("settings").doc("general").get();
    if (snap.exists) {
      const data = snap.data() as Record<string, unknown>;
      return (
        (data?.networkKeys as Record<string, string>)?.postbackSecret ||
        (data?.postbackSecret as string) ||
        ""
      );
    }
    return "";
  } catch {
    return "";
  }
}

router.post("/", async (req: Request, res: Response): Promise<void> => {
  const startMs = Date.now();
  const receivedAt = now();

  // ── Parse params (support both query and body) ──────────────────────
  const params = { ...req.query, ...req.body } as Record<string, string>;

  const platformId = params.platform || params.network || "";
  const userId = params.user_id || params.userId || "";
  const taskId = params.task_id || params.taskId || "";
  const convId = params.conv_id || params.convId || params.transaction_id || params.tid || "";
  const status = (params.status || "approved").toLowerCase();
  const amountStr = params.amount || params.payout || "0";
  const secret = params.secret || params.sig || "";

  const amount = parseFloat(amountStr) || 0;

  // ── Validate required fields ─────────────────────────────────────────
  if (!platformId || !userId || !taskId || !convId) {
    const missing = [!platformId && "platform", !userId && "user_id", !taskId && "task_id", !convId && "conv_id"].filter(Boolean);
    res.status(400).json({ ok: false, error: `Missing required params: ${missing.join(", ")}` });
    return;
  }

  // ── Firebase Admin gate ─────────────────────────────────────────────
  if (!db) {
    console.warn("[postback] Firebase Admin not initialized — cannot process postback.");
    res.status(503).json({ ok: false, error: "Server database not configured. Set FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY." });
    return;
  }

  // ── Validate secret ──────────────────────────────────────────────────
  const expectedSecret = await getPostbackSecret();
  if (expectedSecret && secret !== expectedSecret) {
    console.warn(`[postback] ❌ Invalid secret — platform=${platformId} conv=${convId}`);
    await writeLog({ type: "invalid_secret", platformId, userId, taskId, convId, amount, message: "Invalid postback secret", processingMs: Date.now() - startMs, receivedAt });
    res.status(403).json({ ok: false, error: "Invalid secret" });
    return;
  }

  // ── Deduplication ────────────────────────────────────────────────────
  const dedupKey = `${platformId}_${convId}`;
  const existingConv = await db.collection("postbackConversions").doc(dedupKey).get();
  if (existingConv.exists) {
    console.log(`[postback] ⚠️ Duplicate — conv=${convId} already processed`);
    await writeLog({ type: "duplicate", platformId, userId, taskId, convId, amount, message: "Duplicate conversion — already processed", processingMs: Date.now() - startMs, receivedAt });
    res.json({ ok: true, status: "duplicate", message: "Already processed" });
    return;
  }

  // ── Find the task completion ──────────────────────────────────────────
  let completionId = "";
  try {
    const completionsSnap = await db.collection("taskCompletions")
      .where("taskId", "==", taskId)
      .where("userId", "==", userId)
      .where("status", "==", "platform_pending")
      .limit(1)
      .get();

    if (!completionsSnap.empty) {
      completionId = completionsSnap.docs[0].id;
    }
  } catch (err) {
    console.error("[postback] Error querying taskCompletions:", err);
  }

  // ── Process based on status ───────────────────────────────────────────
  if (status === "approved" || status === "1" || status === "complete") {
    // Move to platform_approved — ready for admin review
    if (completionId) {
      try {
        await db.collection("taskCompletions").doc(completionId).update({
          status: "platform_approved",
          verifiedBy: platformId,
          platformVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
          postbackConvId: convId,
          postbackAmount: amount,
        });
        console.log(`[postback] ✅ Approved — completion=${completionId} platform=${platformId}`);
      } catch (err) {
        console.error("[postback] Failed to update taskCompletion:", err);
      }
    }

    await writeConversion({
      dedupKey,
      platformId,
      userId,
      taskId,
      completionId,
      convId,
      status: "settled",
      conversionStatus: "approved",
      amount,
      processingMs: Date.now() - startMs,
      receivedAt,
    });

    await writeLog({
      type: completionId ? "settled" : "skipped",
      platformId,
      userId,
      taskId,
      convId,
      amount,
      completionId,
      message: completionId ? "Conversion settled — completion moved to platform_approved" : "Conversion received but no matching platform_pending completion found",
      processingMs: Date.now() - startMs,
      receivedAt,
    });

    res.json({ ok: true, status: "settled", completionId: completionId || null });
  } else if (status === "rejected" || status === "chargeback" || status === "0") {
    // Platform rejected the conversion — leave as platform_pending or mark rejected
    if (completionId) {
      try {
        await db.collection("taskCompletions").doc(completionId).update({
          status: "rejected",
          verifiedBy: platformId,
          platformVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
          postbackConvId: convId,
          rejectReason: "Rejected by platform",
        });
      } catch (err) {
        console.error("[postback] Failed to update rejected completion:", err);
      }
    }

    await writeConversion({
      dedupKey, platformId, userId, taskId, completionId, convId,
      status: "rejected", conversionStatus: "rejected",
      amount, processingMs: Date.now() - startMs, receivedAt,
    });
    await writeLog({
      type: "rejected", platformId, userId, taskId, convId, amount, completionId,
      message: "Conversion rejected by platform",
      processingMs: Date.now() - startMs, receivedAt,
    });

    res.json({ ok: true, status: "rejected", completionId: completionId || null });
  } else {
    await writeLog({
      type: "skipped", platformId, userId, taskId, convId, amount,
      message: `Unknown status value: ${status}`,
      processingMs: Date.now() - startMs, receivedAt,
    });
    res.status(400).json({ ok: false, error: `Unrecognised status: ${status}. Use 'approved' or 'rejected'.` });
  }
});

// ── Helpers ─────────────────────────────────────────────────────────────

interface ConversionPayload {
  dedupKey: string;
  platformId: string;
  userId: string;
  taskId: string;
  completionId: string;
  convId: string;
  status: string;
  conversionStatus: "approved" | "rejected";
  amount: number;
  processingMs: number;
  receivedAt: string;
}

async function writeConversion(p: ConversionPayload) {
  if (!db) return;
  try {
    await db.collection("postbackConversions").doc(p.dedupKey).set({
      platformId: p.platformId,
      platformName: p.platformId,
      externalConversionId: p.convId,
      dedupKey: p.dedupKey,
      userId: p.userId,
      taskId: p.taskId,
      completionId: p.completionId,
      status: p.status,
      conversionStatus: p.conversionStatus,
      amount: p.amount,
      error: "",
      processingMs: p.processingMs,
      receivedAt: p.receivedAt,
      processedAt: now(),
    });
  } catch (err) {
    console.error("[postback] writeConversion failed:", err);
  }
}

interface LogPayload {
  type: string;
  platformId: string;
  userId: string;
  taskId: string;
  convId: string;
  amount: number;
  message: string;
  processingMs: number;
  receivedAt: string;
  completionId?: string;
}

async function writeLog(p: LogPayload) {
  if (!db) return;
  try {
    await db.collection("postbackLogs").add({
      type: p.type,
      message: p.message,
      platformId: p.platformId,
      userId: p.userId,
      taskId: p.taskId,
      convId: p.convId,
      completionId: p.completionId || "",
      amount: p.amount,
      processingMs: p.processingMs,
      receivedAt: p.receivedAt,
      createdAt: now(),
    });
  } catch (err) {
    console.error("[postback] writeLog failed:", err);
  }
}

export default router;
