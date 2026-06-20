import { Router, Request, Response } from "express";
import { db } from "../firebase-admin";

const router = Router();

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

router.get("/", async (req: Request, res: Response): Promise<void> => {
  if (!db) {
    res.status(503).json({ error: "Server database not configured. Set FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY." });
    return;
  }

  const { secret, status, platform, limit: limitStr } = req.query as Record<string, string>;
  const limit = Math.min(parseInt(limitStr || "100", 10), 500);

  // ── Validate secret ──────────────────────────────────────────────────
  const expectedSecret = await getPostbackSecret();
  if (expectedSecret && secret !== expectedSecret) {
    res.status(403).json({ error: "Invalid secret" });
    return;
  }

  try {
    // ── Query conversions ────────────────────────────────────────────────
    let convQuery = db.collection("postbackConversions").orderBy("receivedAt", "desc").limit(limit);
    // Firestore doesn't support multiple inequality filters in one query easily,
    // so we filter status and platform client-side after fetching.
    const convSnap = await convQuery.get();

    let conversions = convSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));

    if (status && status !== "all") {
      conversions = conversions.filter((c) => c.status === status);
    }
    if (platform) {
      conversions = conversions.filter((c) => c.platformId === platform);
    }

    // ── Query logs ───────────────────────────────────────────────────────
    const logsSnap = await db.collection("postbackLogs").orderBy("createdAt", "desc").limit(limit).get();
    const logs = logsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));

    // ── Compute stats ────────────────────────────────────────────────────
    const allConvs = conversions as Array<Record<string, unknown>>;
    const settled = allConvs.filter((c) => c.status === "settled").length;
    const rejected = allConvs.filter((c) => c.status === "rejected").length;
    const skipped = allConvs.filter((c) => c.status === "skipped").length;
    const duplicates = allConvs.filter((c) => c.status === "duplicate").length;
    const failed = allConvs.filter((c) => ["invalid_params", "invalid_platform", "invalid_signature", "invalid_secret"].includes(c.status as string)).length;

    const totalSettledAmount = allConvs
      .filter((c) => c.status === "settled")
      .reduce((sum, c) => sum + (Number(c.amount) || 0), 0);

    const processingTimes = allConvs.map((c) => Number(c.processingMs) || 0).filter((v) => v > 0);
    const avgProcessingMs = processingTimes.length
      ? Math.round(processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length)
      : 0;

    const byPlatform: Record<string, { total: number; settled: number; amount: number }> = {};
    for (const c of allConvs) {
      const pid = String(c.platformId || "unknown");
      if (!byPlatform[pid]) byPlatform[pid] = { total: 0, settled: 0, amount: 0 };
      byPlatform[pid].total++;
      if (c.status === "settled") {
        byPlatform[pid].settled++;
        byPlatform[pid].amount += Number(c.amount) || 0;
      }
    }

    const stats = {
      total: allConvs.length,
      settled,
      rejected,
      skipped,
      duplicates,
      processing: 0,
      failed,
      totalSettledAmount,
      byPlatform,
      avgProcessingMs,
    };

    res.json({ conversions, logs, stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[postbacks-admin] Error:", message);
    res.status(500).json({ error: message });
  }
});

export default router;
