// server/routes/postback.ts
// Thin HTTP adapter — the only responsibility of this file is to:
//   1. Accept GET and POST requests (CPAGrip uses GET; other networks may POST).
//   2. Merge query-string params + body into one flat map.
//   3. Call processPostback() from the engine.
//   4. Return HTTP 200 on ALL outcomes (ad networks retry on non-200).
//
// Zero business logic lives here.

import { Router, Request, Response } from "express";
import { processPostback } from "../postback/engine";

const router = Router();

// ── Shared handler (GET and POST both use this) ──────────────────────────────

async function handle(req: Request, res: Response): Promise<void> {
  // ── TEMPORARY DIAGNOSTIC LOGGING — remove after postback is confirmed working ──
  console.log("\n[POSTBACK:RAW] ══════════════════════════════════════════════════");
  console.log("[POSTBACK:RAW] timestamp  :", new Date().toISOString());
  console.log("[POSTBACK:RAW] method     :", req.method);
  console.log("[POSTBACK:RAW] full URL   :", `${req.protocol}://${req.get("host")}${req.originalUrl}`);
  console.log("[POSTBACK:RAW] query      :", JSON.stringify(req.query));
  console.log("[POSTBACK:RAW] body       :", typeof req.body === "object" ? JSON.stringify(req.body) : String(req.body ?? "(empty)"));
  console.log("[POSTBACK:RAW] headers    :", JSON.stringify({
    "user-agent"   : req.get("user-agent"),
    "content-type" : req.get("content-type"),
    "x-forwarded-for": req.get("x-forwarded-for"),
    "x-real-ip"    : req.get("x-real-ip"),
    "referer"      : req.get("referer"),
    "accept"       : req.get("accept"),
    "host"         : req.get("host"),
  }));
  console.log("[POSTBACK:RAW] ══════════════════════════════════════════════════\n");
  // ── END TEMPORARY DIAGNOSTIC LOGGING ─────────────────────────────────────

  // Merge query string + body into a single string-value map.
  // Body values win over query values on name collisions.
  const rawParams: Record<string, string> = {};

  for (const [k, v] of Object.entries(req.query)) {
    rawParams[k] = Array.isArray(v) ? String(v[0]) : String(v ?? "");
  }
  if (req.body && typeof req.body === "object") {
    for (const [k, v] of Object.entries(req.body)) {
      rawParams[k] = String(v ?? "");
    }
  }

  const meta = {
    method: req.method,
    fullUrl: `${req.protocol}://${req.get("host")}${req.originalUrl}`,
  };

  try {
    const result = await processPostback(rawParams, meta);

    // Always return 200 — CPAGrip (and most networks) retry on any non-200
    // response, which would create duplicate conversion attempts.
    res.status(200).json({
      received: true,
      status: result.status,
      ok: result.ok,
      platformId: result.platformId,
      userId: result.userId,
      taskId: result.taskId,
      completionId: result.completionId,
      payout: result.payout,
      message: result.message,
      processingMs: result.processingMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[postback] Unhandled engine error:", message);
    // Still return 200 to prevent network retries on unexpected errors.
    res.status(200).json({
      received: true,
      status: "error",
      ok: false,
      message,
    });
  }
}

// ── Route registrations ──────────────────────────────────────────────────────

// CPAGrip and most simple networks use GET.
router.get("/", handle);

// Some networks (OfferToro, AdGem, others) use POST.
router.post("/", handle);

export default router;
