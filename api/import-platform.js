// api/import-platform.js — Universal Platform-Agnostic Importer
// All platform configuration is read dynamically from Firestore.
// No platform-specific if/else or switch blocks.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const startTime = Date.now();

  try {
    const { platformName, firebaseProjectId, firebaseApiKey } = req.body;

    if (!platformName || !firebaseProjectId || !firebaseApiKey) {
      return res.status(400).json({ error: 'Missing required parameters: platformName, firebaseProjectId, firebaseApiKey' });
    }

    const fsBase = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents`;
    const key = `?key=${firebaseApiKey}`;

    // ── 1. Load platform document from Firestore ──────────────────────────────
    const platformRes = await fetch(`${fsBase}/platforms/${platformName}${key}`);
    const platformDoc = await platformRes.json();

    if (!platformDoc.fields) {
      return res.status(404).json({ error: `Platform '${platformName}' not found in Firestore` });
    }

    const f = platformDoc.fields;

    // Helper: extract a scalar Firestore field value
    const fv = (field) => {
      if (!field) return undefined;
      if ('stringValue'  in field) return field.stringValue;
      if ('booleanValue' in field) return field.booleanValue;
      if ('integerValue' in field) return Number(field.integerValue);
      if ('doubleValue'  in field) return Number(field.doubleValue);
      if ('nullValue'    in field) return null;
      return undefined;
    };

    // Helper: extract a Firestore map as a plain JS object
    const fvMap = (field) => {
      if (!field?.mapValue?.fields) return {};
      const result = {};
      for (const [k, v] of Object.entries(field.mapValue.fields)) {
        result[k] = fv(v) ?? '';
      }
      return result;
    };

    // ── 2. Read generic config ────────────────────────────────────────────────
    const enabled = fv(f.enabled) !== false;
    if (!enabled) {
      return res.status(400).json({ error: 'Platform is disabled' });
    }

    const apiBase            = fv(f.apiBase)          || '';
    const endpoint           = fv(f.endpoint)         || '';
    const apiKey             = fv(f.apiKey)            || '';
    const authenticationType = fv(f.authenticationType) || 'queryParam';
    const apiKeyParam        = fv(f.apiKeyParam)       || 'api_key';
    const apiKeyHeaderName   = fv(f.apiKeyHeaderName)  || 'X-API-Key';
    const basicAuthUser      = fv(f.basicAuthUser)     || '';
    const requestMethod      = (fv(f.requestMethod)    || 'GET').toUpperCase();
    const customHeaders      = fvMap(f.headers);
    const queryParameters    = fvMap(f.queryParameters);
    const responsePath       = fv(f.responsePath)      || 'offers';
    const offerMapping       = fvMap(f.offerMapping);
    const displayName        = fv(f.displayName)       || platformName;

    // Pagination sub-config
    const pag              = f.pagination?.mapValue?.fields || {};
    const pagEnabled       = fv(pag.enabled)    || false;
    const pagLimitParam    = fv(pag.limitParam)  || 'limit';
    const pagLimit         = Number(fv(pag.limit) || 50) || 50;

    if (!apiBase) {
      return res.status(400).json({ error: 'Missing apiBase in platform configuration' });
    }

    // ── 3. Build request URL ──────────────────────────────────────────────────
    let fullUrl;
    try {
      fullUrl = new URL(`${apiBase}${endpoint}`);
    } catch {
      return res.status(400).json({ error: `Invalid apiBase URL: ${apiBase}${endpoint}` });
    }

    // Static query parameters from config
    for (const [k, v] of Object.entries(queryParameters)) {
      if (v !== null && v !== undefined && v !== '') {
        fullUrl.searchParams.set(k, String(v));
      }
    }

    // Pagination
    if (pagEnabled) {
      fullUrl.searchParams.set(pagLimitParam, String(pagLimit));
    }

    // ── 4. Build request headers and apply authentication ─────────────────────
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...customHeaders,
    };

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
        fullUrl.searchParams.set(apiKeyParam, apiKey);
        break;
    }

    // ── 5. Fetch offers from the platform API ─────────────────────────────────
    let apiResponse;
    try {
      apiResponse = await fetch(fullUrl.toString(), { method: requestMethod, headers });
    } catch (networkErr) {
      const msg = `Network error reaching ${apiBase}: ${networkErr.message}`;
      await updatePlatformStatus(fsBase, platformName, key, { importStatus: 'error', lastError: msg, lastImportAt: new Date().toISOString() });
      return res.status(502).json({ error: msg });
    }

    if (!apiResponse.ok) {
      const body = await apiResponse.text();
      const msg  = `Platform API returned ${apiResponse.status}: ${body.slice(0, 300)}`;
      await updatePlatformStatus(fsBase, platformName, key, { importStatus: 'error', lastError: msg, lastImportAt: new Date().toISOString() });
      return res.status(502).json({ error: msg });
    }

    let rawData;
    try {
      rawData = await apiResponse.json();
    } catch {
      const msg = 'Platform API returned non-JSON response';
      await updatePlatformStatus(fsBase, platformName, key, { importStatus: 'error', lastError: msg, lastImportAt: new Date().toISOString() });
      return res.status(502).json({ error: msg });
    }

    // ── 6. Extract offers using configurable responsePath ─────────────────────
    // Supports dot-notation: e.g. "data.offers"
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
      // Fallback: try common envelope keys
      offers =
        rawData.offers   ??
        rawData.data     ??
        rawData.results  ??
        rawData.campaigns ??
        rawData.items    ??
        (Array.isArray(rawData) ? rawData : []);
    }

    // ── 7. Fetch existing externalIds to detect duplicates ────────────────────
    const existingSnap = await fetch(`${fsBase}/tasks${key}&pageSize=2000`).then(r => r.json());
    const existingIds  = new Set();
    if (Array.isArray(existingSnap.documents)) {
      for (const d of existingSnap.documents) {
        const eid = d.fields?.externalId?.stringValue || d.fields?.offerId?.stringValue;
        if (eid) existingIds.add(eid);
      }
    }

    // ── 8. Map raw offers to task documents ───────────────────────────────────
    // offerMapping is a key→fieldPath dictionary e.g. { id: "offer_id", title: "name", payout: "payout" }
    const defaultMapping = {
      id:          'id',
      title:       'name',
      description: 'description',
      payout:      'payout',
      url:         'url',
      image:       'image',
      category:    'category',
      countries:   'countries',
      devices:     'devices',
    };
    const mapping = { ...defaultMapping, ...offerMapping };

    // Resolve a dotted path like "data.offer_id" from a raw offer object
    const getField = (obj, path) => {
      if (!path) return undefined;
      let cur = obj;
      for (const p of String(path).split('.')) {
        if (cur == null) return undefined;
        cur = cur[p];
      }
      return cur;
    };

    const toImport = [];

    for (const offer of offers) {
      const rawId     = getField(offer, mapping.id) ?? offer.id ?? offer.offer_id;
      const externalId = rawId !== undefined && rawId !== null ? String(rawId) : '';
      if (!externalId || existingIds.has(externalId)) continue;

      const title       = String(getField(offer, mapping.title)       ?? offer.name  ?? offer.title  ?? offer.offer_name ?? 'Untitled Offer');
      const description = String(getField(offer, mapping.description) ?? offer.description ?? offer.requirements ?? '');
      const payoutRaw   = getField(offer, mapping.payout) ?? offer.payout ?? offer.reward ?? offer.amount ?? 0;
      const payout      = Math.max(0, parseFloat(String(payoutRaw)) || 0);
      const taskUrl     = String(getField(offer, mapping.url) ?? offer.url ?? offer.link ?? offer.offer_url ?? '');

      toImport.push({ externalId, title, description, payout, url: taskUrl });
    }

    // ── 9. Write new tasks to Firestore in parallel batches ───────────────────
    const BATCH = 20;
    let imported = 0;

    for (let i = 0; i < toImport.length; i += BATCH) {
      const chunk = toImport.slice(i, i + BATCH);
      const results = await Promise.all(
        chunk.map(item => fetch(`${fsBase}/tasks${key}`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            fields: {
              platform:       { stringValue: displayName },
              platformId:     { stringValue: platformName },
              title:          { stringValue: item.title },
              description:    { stringValue: item.description },
              reward:         { doubleValue: item.payout },
              payout:         { doubleValue: item.payout },
              url:            { stringValue: item.url },
              externalId:     { stringValue: item.externalId },
              offerId:        { stringValue: item.externalId },
              network:        { stringValue: platformName },
              status:         { stringValue: 'published' },
              taskType:       { stringValue: 'platform' },
              type:           { stringValue: item.payout >= 0.05 ? 'premium' : 'simple' },
              active:         { booleanValue: true },
              networkStatus:  { stringValue: 'pending' },
              manualAdminRate:{ doubleValue: 0.35 },
              importedFrom:   { stringValue: platformName },
              createdAt:      { stringValue: new Date().toISOString() },
            }
          }),
        }))
      );
      imported += results.filter(r => r.ok).length;
    }

    const duration = Date.now() - startTime;
    const skipped  = offers.length - toImport.length;

    // ── 10. Update platform import status in Firestore ────────────────────────
    await updatePlatformStatus(fsBase, platformName, key, {
      importStatus:         'success',
      lastError:            null,
      lastImportAt:         new Date().toISOString(),
      lastImportCount:      imported,
      totalOffersFound:     offers.length,
      lastImportDurationMs: duration,
    });

    return res.status(200).json({
      success:     true,
      imported,
      skipped,
      totalOffers: offers.length,
      offers:      offers.slice(0, 200),
      duration,
    });

  } catch (error) {
    console.error('[import-platform] Unhandled error:', error);
    return res.status(500).json({ error: String(error.message || error) });
  }
}

// ── Firestore PATCH helper (field-level update, no full document overwrite) ──
async function updatePlatformStatus(fsBase, platformName, key, statusFields) {
  try {
    const fieldPaths = Object.keys(statusFields)
      .map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
      .join('&');

    const fields = {};
    for (const [k, v] of Object.entries(statusFields)) {
      if (v === null || v === undefined) {
        fields[k] = { nullValue: null };
      } else if (typeof v === 'boolean') {
        fields[k] = { booleanValue: v };
      } else if (typeof v === 'number') {
        Number.isInteger(v)
          ? (fields[k] = { integerValue: v })
          : (fields[k] = { doubleValue: v });
      } else {
        fields[k] = { stringValue: String(v) };
      }
    }

    await fetch(`${fsBase}/platforms/${platformName}${key}&${fieldPaths}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ fields }),
    });
  } catch (e) {
    console.warn('[import-platform] Could not update platform status:', e.message);
  }
}
