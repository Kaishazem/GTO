// server/postback/engine.ts
// Universal Postback Engine — core business logic.
//
// This function is the SINGLE source of truth for all postback processing.
// It is intentionally HTTP-agnostic: it receives a plain param map and returns
// a plain result object.  The Express route calls it for both GET and POST.
//
// Flow:
//   params (merged GET + POST)
//     → parsePostback()          universal normalisation
//     → secret validation        optional per-network password check
//     → deduplication            idempotency guard
//     → Firestore lookup         find pending taskCompletion
//     → settlement               update status, write conversion record + log
//     → EngineResult             returned to the caller (route)

import * as admin from "firebase-admin";
import { db } from "../firebase-admin";
import { parsePostback, type ParsedConversion } from "./parser";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface EngineResult {
  ok: boolean;
  status:
    | "settled"
    | "rejected"
    | "duplicate"
    | "skipped"
    | "invalid_secret"
    | "db_unavailable"
    | "error";
  completionId: string | null;
  platformId: string;
  userId: string;
  taskId: string;
  payout: number;
  message: string;
  processingMs: number;
  /** The fully parsed conversion — always present even on error paths. */
  parsed: ParsedConversion;
}

// ─────────────────────────────────────────────────────────────────────────────
// Secret validation
// ─────────────────────────────────────────────────────────────────────────────

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

function secretFromParams(params: Record<string, string>): string {
  return (params.password || params.secret || params.sig || params.pass || "").trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Firestore helpers
// ─────────────────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

interface ConversionDoc {
  platformId: string;
  displayName: string;
  externalConversionId: string;
  dedupKey: string;
  userId: string;
  taskId: string;
  completionId: string;
  status: string;
  conversionStatus: string;
  amount: number;
  rawParams: string;
  error: string;
  processingMs: number;
  receivedAt: string;
  processedAt: string;
}

async function writeConversion(
  dedupKey: string,
  parsed: ParsedConversion,
  completionId: string,
  status: string,
  processingMs: number,
  receivedAt: string,
  error = ""
): Promise<void> {
  if (!db) return;
  const doc: ConversionDoc = {
    platformId: parsed.platformId,
    displayName: parsed.displayName,
    externalConversionId: parsed.convId,
    dedupKey,
    userId: parsed.userId,
    taskId: parsed.taskId,
    completionId,
    status,
    conversionStatus: parsed.status,
    amount: parsed.payout,
    rawParams: JSON.stringify(parsed.rawParams).slice(0, 2000),
    error,
    processingMs,
    receivedAt,
    processedAt: now(),
  };
  try {
    await db.collection("postbackConversions").doc(dedupKey).set(doc);
  } catch (err) {
    console.error("[engine] writeConversion failed:", err);
  }
}

interface LogDoc {
  type: string;
  message: string;
  platformId: string;
  userId: string;
  taskId: string;
  convId: string;
  completionId: string;
  amount: number;
  processingMs: number;
  receivedAt: string;
  createdAt: string;
}

async function writeLog(
  type: string,
  message: string,
  parsed: ParsedConversion,
  completionId: string,
  processingMs: number,
  receivedAt: string
): Promise<void> {
  if (!db) return;
  const doc: LogDoc = {
    type,
    message,
    platformId: parsed.platformId,
    userId: parsed.userId,
    taskId: parsed.taskId,
    convId: parsed.convId,
    completionId,
    amount: parsed.payout,
    processingMs,
    receivedAt,
    createdAt: now(),
  };
  try {
    await db.collection("postbackLogs").add(doc);
  } catch (err) {
    console.error("[engine] writeLog failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Settlement helpers
// ─────────────────────────────────────────────────────────────────────────────

async function findPendingCompletion(userId: string, taskId: string): Promise<string> {
  if (!db) return "";
  try {
    const snap = await db
      .collection("taskCompletions")
      .where("taskId", "==", taskId)
      .where("userId", "==", userId)
      .where("status", "in", ["pending", "platform_pending"])
      .limit(1)
      .get();
    return snap.empty ? "" : snap.docs[0].id;
  } catch (err) {
    console.warn("[engine] findPendingCompletion error:", err);
    return "";
  }
}

async function settleApproved(
  completionId: string,
  parsed: ParsedConversion
): Promise<void> {
  if (!db || !completionId) return;
  try {
    await db.collection("taskCompletions").doc(completionId).update({
      status: "platform_approved",
      verifiedBy: parsed.platformId,
      platformVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      platformVerifiedBy: parsed.platformId,
      platformName: parsed.displayName,
      postbackConvId: parsed.convId,
      postbackAmount: parsed.payout,
    });
  } catch (err) {
    console.error("[engine] settleApproved failed:", err);
  }
}

async function settleRejected(
  completionId: string,
  parsed: ParsedConversion
): Promise<void> {
  if (!db || !completionId) return;
  try {
    await db.collection("taskCompletions").doc(completionId).update({
      status: "rejected",
      verifiedBy: parsed.platformId,
      platformVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      platformName: parsed.displayName,
      postbackConvId: parsed.convId,
      rejectReason: "Rejected by platform",
    });
  } catch (err) {
    console.error("[engine] settleRejected failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostic logging (server console only — helps debug postback issues)
// ─────────────────────────────────────────────────────────────────────────────

function logParsed(parsed: ParsedConversion, method: string, fullUrl: string): void {
  const lines = [
    "",
    "════════════════════════════════════════════════════════════════",
    `[POSTBACK] ${method} ${fullUrl}`,
    "────────────────────────────────────────────────────────────────",
    `  Detected network : ${parsed.platformId} (${parsed.displayName})`,
    `  userId           : ${parsed.userId || "(empty)"}`,
    `  taskId           : ${parsed.taskId || "(empty)"}`,
    `  convId           : ${parsed.convId || "(empty)"}`,
    `  payout           : ${parsed.payout}`,
    `  status           : ${parsed.status}`,
    "",
    "  Raw params:",
    ...Object.entries(parsed.rawParams).map(([k, v]) => `    ${k} = ${v}`),
    "════════════════════════════════════════════════════════════════",
    "",
  ];
  console.log(lines.join("\n"));
}

// ─────────────────────────────────────────────────────────────────────────────
// Main engine function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process a postback from any CPA/offerwall network.
 *
 * @param rawParams  Merged GET query + POST body (string values only).
 * @param meta       HTTP metadata for logging only (method, fullUrl).
 */
export async function processPostback(
  rawParams: Record<string, string>,
  meta: { method: string; fullUrl: string }
): Promise<EngineResult> {
  const startMs = Date.now();
  const receivedAt = now();
  const parsed = parsePostback(rawParams);

  logParsed(parsed, meta.method, meta.fullUrl);

  // ── DB availability ──────────────────────────────────────────────────────
  if (!db) {
    console.warn("[engine] Firebase Admin not initialised — cannot process postback.");
    return {
      ok: false,
      status: "db_unavailable",
      completionId: null,
      platformId: parsed.platformId,
      userId: parsed.userId,
      taskId: parsed.taskId,
      payout: parsed.payout,
      message: "Database not configured. Set FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY.",
      processingMs: Date.now() - startMs,
      parsed,
    };
  }

  // ── Secret validation (only when a secret is configured) ────────────────
  const expectedSecret = await getPostbackSecret();
  if (expectedSecret) {
    const incoming = secretFromParams(rawParams);
    if (incoming !== expectedSecret) {
      console.warn(`[engine] ❌ Invalid secret — platform=${parsed.platformId}`);
      await writeLog("invalid_secret", "Invalid postback secret", parsed, "", Date.now() - startMs, receivedAt);
      return {
        ok: false,
        status: "invalid_secret",
        completionId: null,
        platformId: parsed.platformId,
        userId: parsed.userId,
        taskId: parsed.taskId,
        payout: parsed.payout,
        message: "Invalid postback secret",
        processingMs: Date.now() - startMs,
        parsed,
      };
    }
  }

  // ── Deduplication ────────────────────────────────────────────────────────
  // Key: platformId + convId when convId is available; otherwise platformId + userId + taskId
  const dedupKey = parsed.convId
    ? `${parsed.platformId}_${parsed.convId}`
    : `${parsed.platformId}_${parsed.userId}_${parsed.taskId}`;

  const existing = await db.collection("postbackConversions").doc(dedupKey).get();
  if (existing.exists) {
    console.log(`[engine] ⚠️ Duplicate — key=${dedupKey}`);
    await writeLog("duplicate", "Duplicate conversion — already processed", parsed, "", Date.now() - startMs, receivedAt);
    return {
      ok: true,
      status: "duplicate",
      completionId: (existing.data()?.completionId as string) || null,
      platformId: parsed.platformId,
      userId: parsed.userId,
      taskId: parsed.taskId,
      payout: parsed.payout,
      message: "Already processed",
      processingMs: Date.now() - startMs,
      parsed,
    };
  }

  // ── Find pending task completion ─────────────────────────────────────────
  const completionId = parsed.userId && parsed.taskId
    ? await findPendingCompletion(parsed.userId, parsed.taskId)
    : "";

  // ── Settle ───────────────────────────────────────────────────────────────
  if (parsed.status === "approved") {
    await settleApproved(completionId, parsed);
    await writeConversion(dedupKey, parsed, completionId, completionId ? "settled" : "skipped", Date.now() - startMs, receivedAt);
    const logType = completionId ? "settled" : "skipped";
    const logMsg = completionId
      ? "Conversion settled — completion moved to platform_approved"
      : "Conversion received but no matching pending completion found";
    await writeLog(logType, logMsg, parsed, completionId, Date.now() - startMs, receivedAt);

    console.log(`[engine] ✅ approved — platform=${parsed.platformId} userId=${parsed.userId} taskId=${parsed.taskId} completion=${completionId || "(none)"}`);

    return {
      ok: true,
      status: completionId ? "settled" : "skipped",
      completionId: completionId || null,
      platformId: parsed.platformId,
      userId: parsed.userId,
      taskId: parsed.taskId,
      payout: parsed.payout,
      message: logMsg,
      processingMs: Date.now() - startMs,
      parsed,
    };
  }

  // rejected
  await settleRejected(completionId, parsed);
  await writeConversion(dedupKey, parsed, completionId, "rejected", Date.now() - startMs, receivedAt);
  await writeLog("rejected", "Conversion rejected by platform", parsed, completionId, Date.now() - startMs, receivedAt);

  console.log(`[engine] ❌ rejected — platform=${parsed.platformId} userId=${parsed.userId} taskId=${parsed.taskId}`);

  return {
    ok: true,
    status: "rejected",
    completionId: completionId || null,
    platformId: parsed.platformId,
    userId: parsed.userId,
    taskId: parsed.taskId,
    payout: parsed.payout,
    message: "Conversion rejected by platform",
    processingMs: Date.now() - startMs,
    parsed,
  };
}
