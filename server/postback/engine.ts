// server/postback/engine.ts
// Universal Postback Engine — core business logic.
//
// This function is the SINGLE source of truth for all postback processing.
// It is intentionally HTTP-agnostic: it receives a plain param map and returns
// a plain result object.  The Express route calls it for both GET and POST.
//
// Async lifecycle (as of redesign):
//   1. User clicks "Start Task"  → TaskCompletion created with status `started`
//   2a. Postback arrives FIRST   → status → `postback_verified`   (stored, awaits user)
//   2b. User confirms FIRST      → status → `user_confirmed`       (awaits postback)
//   3.  Second event arrives     → status → `platform_approved`    (ready for admin)
//
// Both orderings are fully supported and produce the same final result.

import * as admin from "firebase-admin";
import { db } from "../firebase-admin";
import { parsePostback, type ParsedConversion } from "./parser";
import { userReward, normalizePlatformUserSharePercent } from "../../src/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface EngineResult {
  ok: boolean;
  status:
    | "settled"
    | "postback_stored"
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

async function getSharePercent(): Promise<number> {
  if (!db) return 65;
  try {
    const snap = await db.collection("settings").doc("general").get();
    if (!snap.exists) return 65;
    const pct = (snap.data() as Record<string, unknown>)?.platformTaskUserSharePercent;
    return normalizePlatformUserSharePercent(typeof pct === "number" ? pct : undefined);
  } catch {
    return 65;
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
// Completion lookup
// ─────────────────────────────────────────────────────────────────────────────

interface CompletionInfo {
  id: string;
  status: string;
  reward: number;
}

/**
 * Deterministic document ID — must match the client-side completionDocId() helper.
 * Format: `${userId}_${taskId}`
 */
function completionDocId(userId: string, taskId: string): string {
  return `${userId}_${taskId}`;
}

const ACTIVE_STATUSES = [
  "started",          // user opened the offer URL
  "user_confirmed",   // user clicked "Completed Task", awaiting postback
  "postback_verified",// postback arrived, awaiting user confirmation
  "platform_pending", // legacy: pre-redesign combined start+confirm record
];

/**
 * Find any TaskCompletion that is still awaiting resolution for the given
 * user+task pair.
 *
 * Strategy:
 *   1. Try the deterministic ID (userId_taskId) first — O(1) getDoc.
 *      New completions always use this ID format.
 *   2. Fall back to a collection query for legacy documents that were created
 *      with Firestore auto-generated IDs before the deterministic ID migration.
 */
async function findActiveCompletion(
  userId: string,
  taskId: string
): Promise<CompletionInfo | null> {
  if (!db) return null;
  try {
    // ── 1. Try deterministic ID (fast path) ──────────────────────────────
    const docId = completionDocId(userId, taskId);
    const snap = await db.collection("taskCompletions").doc(docId).get();
    if (snap.exists) {
      const status = snap.data()?.status as string;
      if (ACTIVE_STATUSES.includes(status)) {
        return {
          id: snap.id,
          status,
          reward: Number(snap.data()?.reward || 0),
        };
      }
      // Document exists but is in a terminal status — no action needed
      return null;
    }

    // ── 2. Legacy query fallback for auto-ID documents ───────────────────
    const legacySnap = await db
      .collection("taskCompletions")
      .where("taskId", "==", taskId)
      .where("userId", "==", userId)
      .where("status", "in", ACTIVE_STATUSES)
      .limit(1)
      .get();

    if (legacySnap.empty) return null;
    const d = legacySnap.docs[0];
    return {
      id: d.id,
      status: d.data().status as string,
      reward: Number(d.data().reward || 0),
    };
  } catch (err) {
    console.warn("[engine] findActiveCompletion error:", err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Settlement helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Postback arrived and user has already confirmed → both sides done.
 * Advance directly to `platform_approved` (ready for admin settlement).
 */
async function settleFullyVerified(
  completionId: string,
  parsed: ParsedConversion
): Promise<void> {
  if (!db || !completionId) return;
  try {
    const sharePercent = await getSharePercent();
    const total = (typeof parsed.payout === "number" && Number.isFinite(parsed.payout) && parsed.payout > 0) ? parsed.payout : 0;
    const userEarned = userReward(total, "platform", { platformUserSharePercent: sharePercent });
    const siteMargin = total - userEarned;
    console.log(`[engine] 💰 settleFullyVerified reward: total=${total} share=${sharePercent}% userEarned=${userEarned} siteMargin=${siteMargin}`);
    await db.collection("taskCompletions").doc(completionId).update({
      status: "platform_approved",
      verifiedBy: parsed.platformId,
      platformVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      platformVerifiedBy: parsed.platformId,
      platformName: parsed.displayName,
      postbackConvId: parsed.convId,
      postbackAmount: parsed.payout,
      reward: userEarned,
      adminReward: siteMargin,
    });
    console.log(`[engine] ✅ fully verified → platform_approved | completion=${completionId}`);
  } catch (err) {
    console.error("[engine] settleFullyVerified failed:", err);
  }
}

/**
 * Postback arrived but user has NOT yet confirmed.
 * Store the verification on the record and wait for user confirmation.
 */
async function settlePostbackOnly(
  completionId: string,
  parsed: ParsedConversion
): Promise<void> {
  if (!db || !completionId) return;
  try {
    const sharePercent = await getSharePercent();
    const total = (typeof parsed.payout === "number" && Number.isFinite(parsed.payout) && parsed.payout > 0) ? parsed.payout : 0;
    const userEarned = userReward(total, "platform", { platformUserSharePercent: sharePercent });
    const siteMargin = total - userEarned;
    console.log(`[engine] 💰 settlePostbackOnly reward: total=${total} share=${sharePercent}% userEarned=${userEarned} siteMargin=${siteMargin}`);
    await db.collection("taskCompletions").doc(completionId).update({
      status: "postback_verified",
      verifiedBy: parsed.platformId,
      platformVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      platformVerifiedBy: parsed.platformId,
      platformName: parsed.displayName,
      postbackConvId: parsed.convId,
      postbackAmount: parsed.payout,
      reward: userEarned,
      adminReward: siteMargin,
    });
    console.log(`[engine] 📦 postback stored → postback_verified | completion=${completionId} (awaiting user confirmation)`);
  } catch (err) {
    console.error("[engine] settlePostbackOnly failed:", err);
  }
}

/**
 * Platform rejected — if user had already confirmed we must reverse the
 * pending balance increment that happened at confirmation time.
 */
async function settleRejectedWithReversal(
  completionId: string,
  parsed: ParsedConversion,
  reward: number
): Promise<void> {
  if (!db || !completionId) return;
  try {
    const completionRef = db.collection("taskCompletions").doc(completionId);
    const completionSnap = await completionRef.get();
    if (!completionSnap.exists) return;

    const userId = completionSnap.data()?.userId as string;
    if (!userId) return;

    await db.runTransaction(async (tx) => {
      tx.update(completionRef, {
        status: "rejected",
        verifiedBy: parsed.platformId,
        platformVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        platformName: parsed.displayName,
        postbackConvId: parsed.convId,
        rejectReason: "Rejected by platform",
      });

      // Reverse the pendingBalance that was added when the user confirmed
      if (reward > 0) {
        const userRef = db!.collection("users").doc(userId);
        tx.update(userRef, {
          pendingBalance: admin.firestore.FieldValue.increment(-reward),
        });
      }
    });
    console.log(`[engine] ❌ rejected + pendingBalance reversed | completion=${completionId} reward=${reward}`);
  } catch (err) {
    console.error("[engine] settleRejectedWithReversal failed:", err);
  }
}

/**
 * Platform rejected but user had not yet confirmed — no balance to reverse.
 */
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
 * Supports both ordering of events:
 *   Sequence A: Start → Completed Task → Postback → Reward (platform_approved)
 *   Sequence B: Start → Postback → Completed Task → Reward (platform_approved)
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
  // OGAds does not support a custom password macro in its postback URL, so
  // the password check is skipped entirely for OGAds postbacks.  All other
  // networks still require a matching password when one is configured.
  const expectedSecret = await getPostbackSecret();
  const skipSecretCheck = parsed.platformId === "ogads";
  if (expectedSecret && !skipSecretCheck) {
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

  // ── Find active task completion ──────────────────────────────────────────
  const completion = parsed.userId && parsed.taskId
    ? await findActiveCompletion(parsed.userId, parsed.taskId)
    : null;

  // ── Approved postback ─────────────────────────────────────────────────────
  if (parsed.status === "approved") {
    if (!completion) {
      // No completion record found — user may not have started yet (edge case).
      // Log it so admins can investigate, but do not fail the postback response.
      console.warn(
        `[engine] ⚠️ approved postback but no active completion found` +
        ` | platform=${parsed.platformId} userId=${parsed.userId} taskId=${parsed.taskId}`
      );
      await writeConversion(dedupKey, parsed, "", "skipped_no_completion", Date.now() - startMs, receivedAt);
      await writeLog("skipped", "Approved postback received but no matching active completion found", parsed, "", Date.now() - startMs, receivedAt);
      return {
        ok: true,
        status: "skipped",
        completionId: null,
        platformId: parsed.platformId,
        userId: parsed.userId,
        taskId: parsed.taskId,
        payout: parsed.payout,
        message: "No active completion found — postback logged for admin review",
        processingMs: Date.now() - startMs,
        parsed,
      };
    }

    if (completion.status === "user_confirmed" || completion.status === "platform_pending") {
      // User already confirmed → both sides done → platform_approved
      await settleFullyVerified(completion.id, parsed);
      await writeConversion(dedupKey, parsed, completion.id, "settled", Date.now() - startMs, receivedAt);
      await writeLog("settled", "Both postback and user confirmed — moved to platform_approved", parsed, completion.id, Date.now() - startMs, receivedAt);
      console.log(`[engine] ✅ approved + user_confirmed → platform_approved | userId=${parsed.userId} taskId=${parsed.taskId}`);
      return {
        ok: true,
        status: "settled",
        completionId: completion.id,
        platformId: parsed.platformId,
        userId: parsed.userId,
        taskId: parsed.taskId,
        payout: parsed.payout,
        message: "Postback approved — completion moved to platform_approved (both sides verified)",
        processingMs: Date.now() - startMs,
        parsed,
      };
    }

    // started or postback_verified — store postback, wait for user confirmation
    await settlePostbackOnly(completion.id, parsed);
    await writeConversion(dedupKey, parsed, completion.id, "postback_stored", Date.now() - startMs, receivedAt);
    await writeLog("postback_stored", "Postback stored — awaiting user confirmation", parsed, completion.id, Date.now() - startMs, receivedAt);
    console.log(`[engine] 📦 approved postback stored → postback_verified | userId=${parsed.userId} taskId=${parsed.taskId}`);
    return {
      ok: true,
      status: "postback_stored",
      completionId: completion.id,
      platformId: parsed.platformId,
      userId: parsed.userId,
      taskId: parsed.taskId,
      payout: parsed.payout,
      message: "Postback verified and stored — awaiting user to click Completed Task",
      processingMs: Date.now() - startMs,
      parsed,
    };
  }

  // ── Rejected postback ─────────────────────────────────────────────────────
  if (!completion) {
    console.log(`[engine] ❌ rejected postback with no active completion | platform=${parsed.platformId} userId=${parsed.userId}`);
    await writeConversion(dedupKey, parsed, "", "rejected_no_completion", Date.now() - startMs, receivedAt);
    await writeLog("rejected", "Rejected postback — no matching active completion", parsed, "", Date.now() - startMs, receivedAt);
    return {
      ok: true,
      status: "rejected",
      completionId: null,
      platformId: parsed.platformId,
      userId: parsed.userId,
      taskId: parsed.taskId,
      payout: parsed.payout,
      message: "Conversion rejected by platform (no active completion)",
      processingMs: Date.now() - startMs,
      parsed,
    };
  }

  if (completion.status === "user_confirmed" || completion.status === "platform_pending") {
    // User already confirmed — reverse the pendingBalance that was added on confirmation
    await settleRejectedWithReversal(completion.id, parsed, completion.reward);
  } else {
    // started or postback_verified — no balance to reverse
    await settleRejected(completion.id, parsed);
  }

  await writeConversion(dedupKey, parsed, completion.id, "rejected", Date.now() - startMs, receivedAt);
  await writeLog("rejected", "Conversion rejected by platform", parsed, completion.id, Date.now() - startMs, receivedAt);
  console.log(`[engine] ❌ rejected — platform=${parsed.platformId} userId=${parsed.userId} taskId=${parsed.taskId}`);

  return {
    ok: true,
    status: "rejected",
    completionId: completion.id,
    platformId: parsed.platformId,
    userId: parsed.userId,
    taskId: parsed.taskId,
    payout: parsed.payout,
    message: "Conversion rejected by platform",
    processingMs: Date.now() - startMs,
    parsed,
  };
}
