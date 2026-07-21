// api/import-locker.js
// Fetches offers from OGAds that appear in the content locker dashboard.
//
// OGAds content lockers serve offers via the same API v2 endpoint as the regular
// offer feed (https://saveapp.store/api/v2). There is no separate documented
// locker-specific endpoint — the distinction is the import path (simplified,
// OGAds-only form) and how offers are tagged in Firestore (sourceType: "locker").
//
// Requires only the publisher's Bearer API key.

export default async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────────────────────
  const origin = req.headers?.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(200).json({ success: false, error: 'POST required' });
  }

  const { apiKey } = req.body || {};

  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(200).json({ success: false, error: 'OGAds API key is required.' });
  }

  // OGAds API v2 — the base URL IS the full endpoint.
  // No sub-path (/offers, /feed, /locker, etc.) exists — all return 404.
  const url = new URL('https://saveapp.store/api/v2');
  // OGAds validates ip and user_agent server-side.
  // Use fixed values for server-side imports (no real visitor context).
  url.searchParams.set('ip', '8.8.8.8');
  url.searchParams.set('user_agent',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  let data;
  try {
    const resp = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`,
      },
    });

    const text = await resp.text().catch(() => '');

    try {
      data = JSON.parse(text);
    } catch {
      return res.status(200).json({
        success: false,
        error: 'OGAds returned a non-JSON response. Verify your API key is correct.',
      });
    }

    if (!resp.ok || !data?.success) {
      const errDetail = data?.error
        ? (typeof data.error === 'string' ? data.error : JSON.stringify(data.error))
        : `HTTP ${resp.status}`;
      return res.status(200).json({
        success: false,
        error: `OGAds API error: ${errDetail}`,
      });
    }
  } catch (err) {
    return res.status(200).json({
      success: false,
      error: `Network error reaching OGAds: ${err.message}`,
    });
  }

  const raw = data.offers;
  if (!Array.isArray(raw)) {
    return res.status(200).json({
      success: false,
      error: 'OGAds returned no offers. Verify your API key has active offers.',
    });
  }

  // Normalize to the same shape the AdminPage import pipeline expects.
  // Field names mirror the OGAds response schema (offerid, picture, ctype, etc.)
  // and the fallback chains in normalizer.js.
  const offers = raw
    .map((o) => ({
      externalId:     String(o.offerid ?? o.offer_id ?? o.id ?? ''),
      title:          String(o.name   ?? o.title       ?? 'Untitled Offer'),
      description:    String(o.description ?? o.requirements ?? ''),
      payout:         Math.max(0, parseFloat(String(o.payout ?? 0)) || 0),
      url:            String(o.url  ?? o.tracking_url  ?? o.link ?? ''),
      image:          String(o.picture ?? o.image ?? o.icon ?? ''),
      category:       String(o.category ?? ''),
      countries:      Array.isArray(o.countries) ? o.countries.map(String) : [],
      devices:        Array.isArray(o.devices)   ? o.devices.map(String)   : [],
      requirements:   String(o.requirements ?? o.description ?? ''),
      conversionType: String(o.ctype ?? o.conversion_type ?? ''),
      platform:       'OGAds',
      platformId:     'ogads',
      sourceType:     'locker',
      importedFrom:   'ogads_locker',
      taskType:       'platform',
    }))
    .filter((o) => o.externalId !== '');

  console.log(`[import-locker] ✅ Returning ${offers.length} OGAds locker offers`);
  return res.status(200).json({ success: true, offers, count: offers.length });
}
