// server/routes/import-locker.ts
// Express mirror of api/import-locker.js — byte-identical business logic.
// Fetches OGAds locker offers and returns them in the same normalized shape
// as the regular platform import pipeline. No Firestore writes here.

import { Router, Request, Response } from "express";

const router = Router();

router.post("/", async (req: Request, res: Response): Promise<void> => {
  const { apiKey } = req.body as { apiKey?: string };

  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    res.status(200).json({ success: false, error: "OGAds API key is required." });
    return;
  }

  // OGAds API v2 — the base URL IS the full endpoint.
  // No sub-path (/offers, /feed, /locker, etc.) exists — all return 404.
  const url = new URL("https://saveapp.store/api/v2");
  url.searchParams.set("ip", "8.8.8.8");
  url.searchParams.set(
    "user_agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  );

  try {
    const resp = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey.trim()}`,
      },
    });

    const text = await resp.text().catch(() => "");

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text);
    } catch {
      res.status(200).json({
        success: false,
        error: "OGAds returned a non-JSON response. Verify your API key is correct.",
      });
      return;
    }

    if (!resp.ok || !data?.success) {
      const errDetail = data?.error
        ? typeof data.error === "string"
          ? data.error
          : JSON.stringify(data.error)
        : `HTTP ${resp.status}`;
      res.status(200).json({
        success: false,
        error: `OGAds API error: ${errDetail}`,
      });
      return;
    }

    const raw = data.offers as Record<string, unknown>[];
    if (!Array.isArray(raw)) {
      res.status(200).json({
        success: false,
        error: "OGAds returned no offers. Verify your API key has active offers.",
      });
      return;
    }

    const offers = raw
      .map((o) => ({
        externalId:     String(o.offerid ?? o.offer_id ?? o.id ?? ""),
        title:          String(o.name   ?? o.title       ?? "Untitled Offer"),
        description:    String(o.description ?? o.requirements ?? ""),
        payout:         Math.max(0, parseFloat(String(o.payout ?? 0)) || 0),
        url:            String(o.url  ?? o.tracking_url  ?? o.link ?? ""),
        image:          String(o.picture ?? o.image ?? o.icon ?? ""),
        category:       String(o.category ?? ""),
        countries:      Array.isArray(o.countries) ? (o.countries as unknown[]).map(String) : [],
        devices:        Array.isArray(o.devices)   ? (o.devices   as unknown[]).map(String) : [],
        requirements:   String(o.requirements ?? o.description ?? ""),
        conversionType: String(o.ctype ?? o.conversion_type ?? ""),
        platform:       "OGAds",
        platformId:     "ogads",
        sourceType:     "locker",
        importedFrom:   "ogads_locker",
        taskType:       "platform",
      }))
      .filter((o) => o.externalId !== "");

    console.log(`[import-locker] ✅ Returning ${offers.length} OGAds locker offers`);
    res.json({ success: true, offers, count: offers.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[import-locker] Error:", message);
    res.status(200).json({
      success: false,
      error: `Network error reaching OGAds: ${message}`,
    });
  }
});

export default router;
