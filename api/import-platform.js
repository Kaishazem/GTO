// api/import-platform.js — Universal Platform-Agnostic Importer
//
// Architecture (v2):
//   The frontend passes the full platform configuration in the request body.
//   This handler is a pure external-API proxy: it fetches offers from the
//   configured platform endpoint and returns them. It does NOT read from or
//   write to Firestore — that is handled by the frontend using the Firebase
//   SDK (which carries proper user auth and respects security rules).
//
// Request body:
//   platformName       — Firestore document ID (used for logging only)
//   platformConfig     — Full platform config object (see shape below)
//   [legacy fields kept for backward-compat but ignored when platformConfig present]
//
// platformConfig shape:
//   { enabled, apiBase, endpoint, apiKey, authenticationType,
//     apiKeyParam, apiKeyHeaderName, basicAuthUser, requestMethod,
//     headers, queryParameters, responsePath, offerMapping, displayName,
//     pagination: { enabled, limitParam, limit } }
//
// Response:
//   { success, offers, totalOffers, duration }
//   OR { error }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const startTime = Date.now();
  const DIAG = (stage, status, detail) =>
    console.log(`[import-platform] STAGE ${stage} ${status} | ${detail}`);

  DIAG('0', 'START', `handler invoked at ${new Date().toISOString()}`);

  try {
    const { platformName, platformConfig } = req.body;

    // ── STAGE 1: Validate request ─────────────────────────────────────────────
    if (!platformConfig) {
      DIAG('1', 'FAILED', 'Missing platformConfig in request body');
      return res.status(400).json({ error: 'Missing platformConfig. The frontend must pass the platform configuration in the request body.' });
    }

    DIAG('1', 'REQUEST', JSON.stringify({
      platformName: platformName || '(unnamed)',
      hasApiBase: !!platformConfig.apiBase,
      hasApiKey: !!platformConfig.apiKey,
      authenticationType: platformConfig.authenticationType,
      requestMethod: platformConfig.requestMethod,
      responsePath: platformConfig.responsePath,
    }));

    // ── STAGE 2: Extract config from request body ─────────────────────────────
    const enabled            = platformConfig.enabled !== false;
    const apiBase            = String(platformConfig.apiBase            || '').trim();
    const endpoint           = String(platformConfig.endpoint           || '').trim();
    const apiKey             = String(platformConfig.apiKey             || '').trim();
    const authenticationType = String(platformConfig.authenticationType || 'queryParam');
    const apiKeyParam        = String(platformConfig.apiKeyParam        || 'api_key');
    const apiKeyHeaderName   = String(platformConfig.apiKeyHeaderName   || 'X-API-Key');
    const basicAuthUser      = String(platformConfig.basicAuthUser      || '');
    const requestMethod      = String(platformConfig.requestMethod      || 'GET').toUpperCase();
    const customHeaders      = (typeof platformConfig.headers === 'object' && platformConfig.headers) ? platformConfig.headers : {};
    const queryParameters    = (typeof platformConfig.queryParameters === 'object' && platformConfig.queryParameters) ? platformConfig.queryParameters : {};
    const responsePath       = String(platformConfig.responsePath       || 'offers');
    const offerMapping       = (typeof platformConfig.offerMapping === 'object' && platformConfig.offerMapping) ? platformConfig.offerMapping : {};
    const displayName        = String(platformConfig.displayName        || platformName || 'Platform');

    // Pagination sub-config
    const pag             = (typeof platformConfig.pagination === 'object' && platformConfig.pagination) ? platformConfig.pagination : {};
    const pagEnabled      = !!pag.enabled;
    const pagLimitParam   = String(pag.limitParam || 'limit');
    const pagLimit        = Number(pag.limit || 50) || 50;

    DIAG('2', 'CONFIG', JSON.stringify({
      enabled, apiBase: apiBase || '(empty)', endpoint: endpoint || '(empty)',
      hasApiKey: !!apiKey, authenticationType, requestMethod, responsePath, displayName,
    }));

    if (!enabled) {
      DIAG('2', 'DISABLED', 'Platform is disabled');
      return res.status(400).json({ error: 'Platform is disabled' });
    }

    if (!apiBase) {
      DIAG('2', 'FAILED', 'apiBase is empty — platform not fully configured');
      return res.status(400).json({ error: 'Missing API Base URL in platform configuration. Edit the platform and set the API Base URL.' });
    }

    // ── STAGE 3: Build external API URL ───────────────────────────────────────
    let fullUrl;
    try {
      fullUrl = new URL(`${apiBase}${endpoint}`);
    } catch {
      DIAG('3', 'FAILED', `Invalid URL: ${apiBase}${endpoint}`);
      return res.status(400).json({ error: `Invalid API Base URL: ${apiBase}${endpoint}` });
    }

    // Append configured query parameters
    for (const [k, v] of Object.entries(queryParameters)) {
      if (v !== null && v !== undefined && v !== '') {
        fullUrl.searchParams.set(k, String(v));
      }
    }

    // Append pagination param
    if (pagEnabled) {
      fullUrl.searchParams.set(pagLimitParam, String(pagLimit));
    }

    // Build headers
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...customHeaders,
    };

    // Apply authentication
    switch (authenticationType) {
      case 'bearer':
        headers['Authorization'] = `Bearer ${apiKey}`;
        break;
      case 'apiKeyHeader':
        headers[apiKeyHeaderName] = apiKey;
        break;
      case 'basicAuth': {
        const encoded = Buffer.from(`${basicAuthUser}:${apiKey}`).toString('base64');
        headers['Authorization'] = `Basic ${encoded}`;
        break;
      }
      case 'queryParam':
      default:
        if (apiKey) fullUrl.searchParams.set(apiKeyParam, apiKey);
        break;
    }

    const logUrl = apiKey ? fullUrl.toString().replace(apiKey, '***KEY***') : fullUrl.toString();
    DIAG('3', 'API_REQUEST', `${requestMethod} ${logUrl} auth=${authenticationType}`);

    // ── STAGE 4: Call external platform API ───────────────────────────────────
    let apiResponse;
    try {
      apiResponse = await fetch(fullUrl.toString(), { method: requestMethod, headers });
    } catch (networkErr) {
      const msg = `Network error reaching ${apiBase}: ${networkErr.message}`;
      DIAG('4', 'NETWORK_ERROR', msg);
      return res.status(502).json({ error: msg });
    }

    DIAG('4', 'API_RESPONSE', `HTTP ${apiResponse.status} ${apiResponse.statusText}`);

    if (!apiResponse.ok) {
      const body = await apiResponse.text();
      const msg = `Platform API returned ${apiResponse.status}: ${body.slice(0, 300)}`;
      DIAG('4', 'FAILED', msg);
      return res.status(502).json({ error: msg });
    }

    let rawData;
    try {
      rawData = await apiResponse.json();
    } catch {
      const msg = 'Platform API returned non-JSON response';
      DIAG('4', 'FAILED', msg);
      return res.status(502).json({ error: msg });
    }

    DIAG('4', 'SUCCESS', `Received JSON. Top-level keys: ${Object.keys(rawData).join(', ')}`);

    // ── STAGE 5: Extract offers array via responsePath ─────────────────────────
    let offers = rawData;
    for (const part of responsePath.split('.')) {
      if (offers && typeof offers === 'object' && part in offers) {
        offers = offers[part];
      } else {
        offers = null;
        break;
      }
    }

    if (!Array.isArray(offers)) {
      DIAG('5', 'FALLBACK', `responsePath="${responsePath}" did not yield an array — trying common envelope keys`);
      offers =
        rawData.offers    ??
        rawData.data      ??
        rawData.results   ??
        rawData.campaigns ??
        rawData.items     ??
        (Array.isArray(rawData) ? rawData : []);
    }

    DIAG('5', 'OFFERS', `Found ${Array.isArray(offers) ? offers.length : 'NON-ARRAY'} offers via responsePath="${responsePath}"`);

    // ── STAGE 6: Map offers to normalised shape ────────────────────────────────
    const defaultMapping = {
      id: 'id', title: 'name', description: 'description',
      payout: 'payout', url: 'url', image: 'image',
      category: 'category', countries: 'countries', devices: 'devices',
    };
    const mapping = { ...defaultMapping, ...offerMapping };

    const getField = (obj, path) => {
      if (!path) return undefined;
      let cur = obj;
      for (const p of String(path).split('.')) {
        if (cur == null) return undefined;
        cur = cur[p];
      }
      return cur;
    };

    const normalised = [];
    for (const offer of (Array.isArray(offers) ? offers : [])) {
      const rawId      = getField(offer, mapping.id) ?? offer.id ?? offer.offer_id;
      const externalId = rawId !== undefined && rawId !== null ? String(rawId) : '';
      if (!externalId) continue;

      const title       = String(getField(offer, mapping.title)       ?? offer.name  ?? offer.title  ?? offer.offer_name ?? 'Untitled Offer');
      const description = String(getField(offer, mapping.description) ?? offer.description ?? offer.requirements ?? '');
      const payoutRaw   = getField(offer, mapping.payout) ?? offer.payout ?? offer.reward ?? offer.amount ?? 0;
      const payout      = Math.max(0, parseFloat(String(payoutRaw)) || 0);
      const taskUrl     = String(getField(offer, mapping.url) ?? offer.url ?? offer.link ?? offer.offer_url ?? '');

      normalised.push({
        externalId,
        title,
        description,
        payout,
        url: taskUrl,
        platform: displayName,
        platformId: platformName || displayName,
        // Pass raw offer data so the frontend can access any field it needs
        _raw: offer,
      });
    }

    const duration = Date.now() - startTime;
    DIAG('6', 'DONE', `Normalised ${normalised.length} offers in ${duration}ms`);

    // Return offers to the frontend — the frontend handles dedup and Firestore writes
    return res.status(200).json({
      success: true,
      offers: normalised,
      totalOffers: normalised.length,
      duration,
    });

  } catch (error) {
    console.error('[import-platform] UNHANDLED ERROR:', error);
    return res.status(500).json({ error: String(error.message || error) });
  }
}
