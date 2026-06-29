import { Router, Request, Response, NextFunction } from "express";
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

// ── RAW REQUEST LOGGER — fires for EVERY method before any handler ──────────
router.use("/", (req: Request, _res: Response, next: NextFunction): void => {
  const allParams = { ...req.query, ...req.body } as Record<string, string>;

  const lines: string[] = [];
  lines.push("");
  lines.push("════════════════════════════════════════════════════════════════");
  lines.push("[POSTBACK] RAW REQUEST RECEIVED");
  lines.push("────────────────────────────────────────────────────────────────");
  lines.push(`Timestamp        : ${now()}`);
  lines.push(`Method           : ${req.method}`);
  lines.push(`Full URL         : ${req.protocol}://${req.get("host")}${req.originalUrl}`);
  lines.push(`Client IP        : ${req.ip || req.socket?.remoteAddress || "(unknown)"}`);

  lines.push("");
  lines.push("── Headers ─────────────────────────────────────────────────────");
  Object.entries(req.headers).forEach(([k, v]) => {
    lines.push(`  ${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
  });

  lines.push("");
  lines.push("── Query Parameters ─────────────────────────────────────────────");
  const queryEntries = Object.entries(req.query);
  if (queryEntries.length === 0) {
    lines.push("  (none)");
  } else {
    queryEntries.forEach(([k, v]) => lines.push(`  ${k} = ${JSON.stringify(v)}`));
  }

  lines.push("");
  lines.push("── Request Body ─────────────────────────────────────────────────");
  const bodyEntries = Object.entries(req.body || {});
  if (bodyEntries.length === 0) {
    lines.push("  (empty)");
  } else {
    bodyEntries.forEach(([k, v]) => lines.push(`  ${k} = ${JSON.stringify(v)}`));
  }

  lines.push("");
  lines.push("── All Merged Params (query + body) ─────────────────────────────");
  const allEntries = Object.entries(allParams);
  if (allEntries.length === 0) {
    lines.push("  (none)");
  } else {
    allEntries.forEach(([k, v]) => lines.push(`  ${k} = ${JSON.stringify(v)}`));
  }

  lines.push("");
  lines.push("── Parsed Known Fields ──────────────────────────────────────────");
  lines.push(`  offer_id       : ${allParams.offer_id       ?? "(not present)"}`);
  lines.push(`  subid          : ${allParams.subid          ?? "(not present)"}`);
  lines.push(`  subid1         : ${allParams.subid1         ?? "(not present)"}`);
  lines.push(`  subid2         : ${allParams.subid2         ?? "(not present)"}`);
  lines.push(`  s1             : ${allParams.s1             ?? "(not present)"}`);
  lines.push(`  s2             : ${allParams.s2             ?? "(not present)"}`);
  lines.push(`  transaction_id : ${allParams.transaction_id ?? "(not present)"}`);
  lines.push(`  status         : ${allParams.status         ?? "(not present)"}`);
  lines.push(`  reward         : ${allParams.reward         ?? "(not present)"}`);
  lines.push(`  payout         : ${allParams.payout         ?? "(not present)"}`);
  lines.push(`  commission     : ${allParams.commission     ?? "(not present)"}`);
  lines.push(`  event          : ${allParams.event          ?? "(not present)"}`);
  lines.push(`  platform       : ${allParams.platform       ?? "(not present)"}`);
  lines.push(`  network        : ${allParams.network        ?? "(not present)"}`);
  lines.push(`  user_id        : ${allParams.user_id        ?? "(not present)"}`);
  lines.push(`  task_id        : ${allParams.task_id        ?? "(not present)"}`);
  lines.push(`  conv_id        : ${allParams.conv_id        ?? "(not present)"}`);
  lines.push(`  tid            : ${allParams.tid            ?? "(not present)"}`);
  lines.push(`  amount         : ${allParams.amount         ?? "(not present)"}`);
  lines.push(`  secret         : ${allParams.secret         ?? "(not present)"}`);
  lines.push(`  sig            : ${allParams.sig            ?? "(not present)"}`);

  lines.push("");
  lines.push("── Any OTHER parameters not in the known list above ─────────────");
  const knownKeys = new Set([
    "offer_id","subid","subid1","subid2","s1","s2","transaction_id",
    "status","reward","payout","commission","event","platform","network",
    "user_id","task_id","conv_id","tid","amount","secret","sig",
  ]);
  const otherEntries = allEntries.filter(([k]) => !knownKeys.has(k));
  if (otherEntries.length === 0) {
    lines.push("  (none — all params matched known keys)");
  } else {
    otherEntries.forEach(([k, v]) => lines.push(`  ${k} = ${JSON.stringify(v)}`));
  }

  lines.push("════════════════════════════════════════════════════════════════");
  lines.push("");

  console.log(lines.join("\n"));
  next();
});

// ── GET handler — log only (middleware above already printed everything) ─────
router.get("/", (_req: Request, res: Response): void => {
  console.log("[POSTBACK] GET request — no GET business logic, returning 200 OK");
  res.status(200).send("OK");
});

router.post("/", async (req: Request, res: Response): Promise<void> => {
  const startMs = Date.now();
  const receivedAt = now();

  // ── Parse params (support both query and body) ──────────────────────
  const params = { ...req.query, ...req.body } as Record<string, string>;

  const platformId = params.platform || params.network || "";
  const userId = params.user_id || params.userId || params.s1 || "";
  const taskId = params.task_id || params.taskId || params.s2 || "";
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
    // ── FIRESTORE LOOKUP LOG (before query) ───────────────────────────
    const lookupLines: string[] = [];
    lookupLines.push("");
    lookupLines.push("────────────────────────────────────────────────────────────────");
    lookupLines.push("[POSTBACK] FIRESTORE LOOKUP");
    lookupLines.push("────────────────────────────────────────────────────────────────");
    lookupLines.push(`  Collection      : taskCompletions`);
    lookupLines.push(`  Filter 1        : taskId == "${taskId}"`);
    lookupLines.push(`    └─ resolved from: task_id="${params.task_id ?? "(absent)"}" | taskId="${params.taskId ?? "(absent)"}" | s2="${params.s2 ?? "(absent)"}" | s2 raw="${params.s2 ?? "(absent)"}"`);
    lookupLines.push(`  Filter 2        : userId == "${userId}"`);
    lookupLines.push(`    └─ resolved from: user_id="${params.user_id ?? "(absent)"}" | userId="${params.userId ?? "(absent)"}" | s1="${params.s1 ?? "(absent)"}"`);
    lookupLines.push(`  Filter 3        : status == "platform_pending"`);
    lookupLines.push(`  Limit           : 1`);
    lookupLines.push("────────────────────────────────────────────────────────────────");
    console.log(lookupLines.join("\n"));

    const completionsSnap = await db.collection("taskCompletions")
      .where("taskId", "==", taskId)
      .where("userId", "==", userId)
      .where("status", "==", "platform_pending")
      .limit(1)
      .get();

    // ── FIRESTORE RESULT LOG (after query) ────────────────────────────
    const resultLines: string[] = [];
    if (!completionsSnap.empty) {
      completionId = completionsSnap.docs[0].id;
      const docData = completionsSnap.docs[0].data();
      resultLines.push(`  Result          : ✅ MATCH FOUND`);
      resultLines.push(`  Matched doc ID  : ${completionId}`);
      resultLines.push(`  Doc taskId      : ${docData.taskId ?? "(not in doc)"}`);
      resultLines.push(`  Doc userId      : ${docData.userId ?? "(not in doc)"}`);
      resultLines.push(`  Doc status      : ${docData.status ?? "(not in doc)"}`);
      resultLines.push(`  Doc taskTitle   : ${docData.taskTitle ?? "(not in doc)"}`);
    } else {
      resultLines.push(`  Result          : ❌ NO MATCH FOUND`);
      resultLines.push(`  `);
      resultLines.push(`  Diagnosis — checking each filter independently:`);

      // Check 1: any completion for this taskId?
      try {
        const byTask = await db.collection("taskCompletions")
          .where("taskId", "==", taskId)
          .limit(5)
          .get();
        resultLines.push(`    taskId="${taskId}" alone → ${byTask.size} doc(s) in taskCompletions`);
        byTask.docs.slice(0, 3).forEach((d, i) => {
          const dd = d.data();
          resultLines.push(`      [${i}] docId=${d.id} | userId=${dd.userId} | status=${dd.status}`);
        });
      } catch (e) { resultLines.push(`    taskId check failed: ${e}`); }

      // Check 2: any completion for this userId?
      try {
        const byUser = await db.collection("taskCompletions")
          .where("userId", "==", userId)
          .limit(5)
          .get();
        resultLines.push(`    userId="${userId}" alone → ${byUser.size} doc(s) in taskCompletions`);
        byUser.docs.slice(0, 3).forEach((d, i) => {
          const dd = d.data();
          resultLines.push(`      [${i}] docId=${d.id} | taskId=${dd.taskId} | status=${dd.status}`);
        });
      } catch (e) { resultLines.push(`    userId check failed: ${e}`); }

      // Check 3: platform_pending completions for this taskId with any userId?
      try {
        const byTaskPending = await db.collection("taskCompletions")
          .where("taskId", "==", taskId)
          .where("status", "==", "platform_pending")
          .limit(5)
          .get();
        resultLines.push(`    taskId="${taskId}" + status="platform_pending" → ${byTaskPending.size} doc(s)`);
        byTaskPending.docs.slice(0, 3).forEach((d, i) => {
          const dd = d.data();
          resultLines.push(`      [${i}] docId=${d.id} | stored userId="${dd.userId}" vs postback userId="${userId}"`);
        });
      } catch (e) { resultLines.push(`    pending check failed: ${e}`); }

      resultLines.push(``);
      resultLines.push(`  Likely root cause:`);
      resultLines.push(`    • If taskId had 0 matches: s2 sent in the URL does not match any Firestore doc ID.`);
      resultLines.push(`      CPAGrip may have sent a different value for s2 than what was appended at click time.`);
      resultLines.push(`    • If taskId matched but userId did not: s1 value differs between click and postback.`);
      resultLines.push(`    • If platform_pending had 0 matches: completion exists but was already settled/rejected.`);
    }
    resultLines.push("────────────────────────────────────────────────────────────────");
    resultLines.push("");
    console.log(resultLines.join("\n"));

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
