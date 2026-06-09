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
  const DIAG = (stage, status, detail) =>
    console.log(`[import-platform] STAGE ${stage} ${status} | ${detail}`);

  DIAG('0', 'START', `handler invoked at ${new Date().toISOString()}`);

  try {
    const { platformName, firebaseProjectId, firebaseApiKey, firebaseIdToken } = req.body;

    // ── STAGE 1: Request body ─────────────────────────────────────────────────
    DIAG('1', 'REQUEST_BODY', JSON.stringify({
      platformName,
      firebaseProjectId,
      hasApiKey: !!firebaseApiKey,
      hasIdToken: !!firebaseIdToken,
      idTokenLength: firebaseIdToken ? firebaseIdToken.length : 0,
    }));

    if (!platformName || !firebaseProjectId || !firebaseApiKey) {
      DIAG('1', 'FAILED', 'Missing required parameters');
      return res.status(400).json({ error: 'Missing required parameters: platformName, firebaseProjectId, firebaseApiKey' });
    }

    const fsBase = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents`;
    const key = `?key=${firebaseApiKey}`;

    const authHeaders = firebaseIdToken
      ? { Authorization: `Bearer ${firebaseIdToken}` }
      : {};

    DIAG('1', 'AUTH', `Firestore auth mode: ${firebaseIdToken ? 'ID_TOKEN (authenticated)' : 'UNAUTHENTICATED (no token)'}`);

    // ── STAGE 2: Firestore platform lookup ────────────────────────────────────
    DIAG('2', 'START', `Looking up platform. Will try: ["${platformName}", "${platformName.toUpperCase()}", "${platformName.toLowerCase()}"]`);

    let platformDoc;
    let resolvedId = platformName;

    for (const attempt of [platformName, platformName.toUpperCase(), platformName.toLowerCase()]) {
      const lookupUrl = `${fsBase}/platforms/${attempt}${key}`;
      DIAG('2', 'ATTEMPT', `GET ${lookupUrl.replace(firebaseApiKey, '***')}`);

      let res2, rawText, doc;
      try {
        res2 = await fetch(lookupUrl, { headers: authHeaders });
        rawText = await res2.text();
        DIAG('2', 'HTTP', `Status=${res2.status} attempt="${attempt}" body_prefix=${rawText.slice(0, 200)}`);
        doc = JSON.parse(rawText);
      } catch (e) {
        DIAG('2', 'NETWORK_ERROR', `attempt="${attempt}" error=${e.message}`);
        continue;
      }

      if (doc.fields) {
        platformDoc = doc;
        resolvedId = attempt;
        DIAG('2', 'FOUND', `Document found at ID="${attempt}". Fields: ${Object.keys(doc.fields).join(', ')}`);
        break;
      } else {
        DIAG('2', 'NOT_FOUND', `attempt="${attempt}" — no .fields in response. error=${doc.error?.message || 'none'} code=${doc.error?.code || 'n/a'}`);
      }
    }

    if (!platformDoc || !platformDoc.fields) {
      DIAG('2', 'FAILED', `Platform '${platformName}' not found after all attempts`);
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

    // ── STAGE 3: Read generic config ──────────────────────────────────────────
    const enabled = fv(f.enabled) !== false;
    if (!enabled) {
      DIAG('3', 'FAILED', 'Platform is disabled (enabled=false)');
      return res.status(400).json({ error: 'Platform is disabled' });
    }

    let apiBase            = fv(f.apiBase)          || '';
    let endpoint           = fv(f.endpoint)         || '';
    let apiKey             = fv(f.apiKey)            || '';
    let authenticationType = fv(f.authenticationType) || 'queryParam';
    const apiKeyParam      = fv(f.apiKeyParam)       || 'api_key';
    const apiKeyHeaderName = fv(f.apiKeyHeaderName)  || 'X-API-Key';
    const basicAuthUser    = fv(f.basicAuthUser)     || '';
    const requestMethod    = (fv(f.requestMethod)    || 'GET').toUpperCase();
    const customHeaders    = fvMap(f.headers);
    const queryParameters  = fvMap(f.queryParameters);
    let responsePath       = fv(f.responsePath)      || 'offers';
    const offerMapping     = fvMap(f.offerMapping);
    const displayName      = fv(f.displayName)       || platformName;

    DIAG('3', 'CONFIG_RAW', JSON.stringify({
      enabled,
      apiBase: apiBase || '(empty)',
      endpoint: endpoint || '(empty)',
      hasApiKey: !!apiKey,
      authenticationType,
      requestMethod,
      responsePath,
      displayName,
      queryParameterKeys: Object.keys(queryParameters),
      allDocFields: Object.keys(f),
    }));

    // Pagination sub-config
    const pag              = f.pagination?.mapValue?.fields || {};
    const pagEnabled       = fv(pag.enabled)    || false;
    const pagLimitParam    = fv(pag.limitParam)  || 'limit';
    const pagLimit         = Number(fv(pag.limit) || 50) || 50;

    // ── STAGE 4: Legacy field fallback ────────────────────────────────────────
    let legacyAutoMigrate = null;

    if (!apiBase) {
      DIAG('4', 'LEGACY_CHECK', `apiBase empty — checking legacy fields. adgemApiKey present=${!!fv(f.adgemApiKey)}, adgemAppId present=${!!fv(f.adgemAppId)}`);

      const adgemKey   = fv(f.adgemApiKey);
      const adgemAppId = fv(f.adgemAppId);
      if (adgemKey && adgemAppId) {
        apiBase            = 'https://api.adgem.com/v1';
        endpoint           = '/offers';
        apiKey             = adgemKey;
        authenticationType = 'bearer';
        responsePath       = 'offers';
        queryParameters['app_id'] = String(adgemAppId);
        legacyAutoMigrate = {
          apiBase: 'https://api.adgem.com/v1',
          endpoint: '/offers',
          authenticationType: 'bearer',
          responsePath: 'offers',
          apiKey: adgemKey,
          displayName: fv(f.displayName) || 'AdGem',
          name: fv(f.name) || 'AdGem',
        };
        DIAG('4', 'LEGACY_ADGEM', `AdGem legacy config applied. appId=${adgemAppId} keyLength=${adgemKey.length}`);
      } else {
        DIAG('4', 'LEGACY_NONE', 'No recognised legacy fields found');
      }
    } else {
      DIAG('4', 'SKIP', 'apiBase already set — no legacy fallback needed');
    }

    if (!apiBase) {
      DIAG('4', 'FAILED', 'apiBase is still empty after legacy check');
      return res.status(400).json({ error: 'Missing apiBase in platform configuration. Open the platform editor and set API Base URL.' });
    }

    // ── STAGE 5: Build and execute external API request ───────────────────────
    let fullUrl;
    try {
      fullUrl = new URL(`${apiBase}${endpoint}`);
    } catch {
      DIAG('5', 'FAILED', `Invalid URL: ${apiBase}${endpoint}`);
      return res.status(400).json({ error: `Invalid apiBase URL: ${apiBase}${endpoint}` });
    }

    for (const [k, v] of Object.entries(queryParameters)) {
      if (v !== null && v !== undefined && v !== '') {
        fullUrl.searchParams.set(k, String(v));
      }
    }

    if (pagEnabled) {
      fullUrl.searchParams.set(pagLimitParam, String(pagLimit));
    }

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

    // Log URL with key masked
    const logUrl = fullUrl.toString().replace(apiKey, '***KEY***');
    DIAG('5', 'API_REQUEST', `${requestMethod} ${logUrl} auth=${authenticationType}`);

    let apiResponse;
    try {
      apiResponse = await fetch(fullUrl.toString(), { method: requestMethod, headers });
    } catch (networkErr) {
      const msg = `Network error reaching ${apiBase}: ${networkErr.message}`;
      DIAG('5', 'NETWORK_ERROR', msg);
      await updatePlatformStatus(fsBase, resolvedId, key, authHeaders, { importStatus: 'error', lastError: msg, lastImportAt: new Date().toISOString() });
      return res.status(502).json({ error: msg });
    }

    DIAG('5', 'API_RESPONSE', `HTTP ${apiResponse.status} ${apiResponse.statusText}`);

    if (!apiResponse.ok) {
      const body = await apiResponse.text();
      const msg  = `Platform API returned ${apiResponse.status}: ${body.slice(0, 300)}`;
      DIAG('5', 'FAILED', msg);
      await updatePlatformStatus(fsBase, resolvedId, key, authHeaders, { importStatus: 'error', lastError: msg, lastImportAt: new Date().toISOString() });
      return res.status(502).json({ error: msg });
    }

    let rawData;
    try {
      rawData = await apiResponse.json();
    } catch {
      const msg = 'Platform API returned non-JSON response';
      DIAG('5', 'FAILED', msg);
      await updatePlatformStatus(fsBase, resolvedId, key, authHeaders, { importStatus: 'error', lastError: msg, lastImportAt: new Date().toISOString() });
      return res.status(502).json({ error: msg });
    }

    DIAG('5', 'SUCCESS', `Received JSON. Top-level keys: ${Object.keys(rawData).join(', ')}`);

    // ── STAGE 6: Extract offers using responsePath ────────────────────────────
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
      DIAG('6', 'FALLBACK', `responsePath="${responsePath}" did not yield an array — trying common envelope keys`);
      offers =
        rawData.offers   ??
        rawData.data     ??
        rawData.results  ??
        rawData.campaigns ??
        rawData.items    ??
        (Array.isArray(rawData) ? rawData : []);
    }

    DIAG('6', 'OFFERS', `Found ${Array.isArray(offers) ? offers.length : 'NON-ARRAY'} offers via responsePath="${responsePath}"`);

    // ── STAGE 7: Fetch existing externalIds ───────────────────────────────────
    DIAG('7', 'START', 'Fetching existing tasks to detect duplicates');
    let existingSnap;
    try {
      const r = await fetch(`${fsBase}/tasks${key}&pageSize=2000`, { headers: authHeaders });
      DIAG('7', 'TASKS_HTTP', `Status=${r.status}`);
      existingSnap = await r.json();
    } catch (e) {
      DIAG('7', 'ERROR', `Failed to fetch existing tasks: ${e.message} — continuing without dedup`);
      existingSnap = {};
    }

    const existingIds = new Set();
    if (Array.isArray(existingSnap.documents)) {
      for (const d of existingSnap.documents) {
        const eid = d.fields?.externalId?.stringValue || d.fields?.offerId?.stringValue;
        if (eid) existingIds.add(eid);
      }
    }
    DIAG('7', 'EXISTING', `Found ${existingIds.size} existing task IDs`);

    // ── STAGE 8: Map and filter offers ────────────────────────────────────────
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

    const toImport = [];
    for (const offer of (Array.isArray(offers) ? offers : [])) {
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
    DIAG('8', 'TO_IMPORT', `${toImport.length} new tasks to create (${(Array.isArray(offers) ? offers.length : 0) - toImport.length} skipped as duplicates)`);

    // ── STAGE 9: Write new tasks to Firestore ─────────────────────────────────
    const BATCH = 20;
    let imported = 0;

    for (let i = 0; i < toImport.length; i += BATCH) {
      const chunk = toImport.slice(i, i + BATCH);
      const results = await Promise.all(
        chunk.map(item => fetch(`${fsBase}/tasks${key}`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body:    JSON.stringify({
            fields: {
              platform:       { stringValue: displayName },
              platformId:     { stringValue: resolvedId },
              title:          { stringValue: item.title },
              description:    { stringValue: item.description },
              reward:         { doubleValue: item.payout },
              payout:         { doubleValue: item.payout },
              url:            { stringValue: item.url },
              externalId:     { stringValue: item.externalId },
              offerId:        { stringValue: item.externalId },
              network:        { stringValue: resolvedId },
              status:         { stringValue: 'published' },
              taskType:       { stringValue: 'platform' },
              type:           { stringValue: item.payout >= 0.05 ? 'premium' : 'simple' },
              active:         { booleanValue: true },
              networkStatus:  { stringValue: 'pending' },
              manualAdminRate:{ doubleValue: 0.35 },
              importedFrom:   { stringValue: resolvedId },
              createdAt:      { stringValue: new Date().toISOString() },
            }
          }),
        }))
      );
      const batchOk  = results.filter(r => r.ok).length;
      const batchFail = results.filter(r => !r.ok).length;
      imported += batchOk;
      if (batchFail > 0) {
        // Sample first failure for diagnosis
        const failIdx = results.findIndex(r => !r.ok);
        const failBody = await results[failIdx].text().catch(() => 'n/a');
        DIAG('9', 'BATCH_PARTIAL', `chunk[${i}..${i+chunk.length}] ok=${batchOk} fail=${batchFail} first_fail_status=${results[failIdx].status} body=${failBody.slice(0,200)}`);
      } else {
        DIAG('9', 'BATCH_OK', `chunk[${i}..${i+chunk.length}] all ${batchOk} written`);
      }
    }

    DIAG('9', 'DONE', `Total imported=${imported}`);

    const duration = Date.now() - startTime;
    const skipped  = (Array.isArray(offers) ? offers.length : 0) - toImport.length;

    // ── STAGE 10: Update platform status ──────────────────────────────────────
    DIAG('10', 'STATUS_UPDATE', `Patching platform status for resolvedId="${resolvedId}"`);
    await updatePlatformStatus(fsBase, resolvedId, key, authHeaders, {
      importStatus:         'success',
      lastError:            null,
      lastImportAt:         new Date().toISOString(),
      lastImportCount:      imported,
      totalOffersFound:     Array.isArray(offers) ? offers.length : 0,
      lastImportDurationMs: duration,
      ...(legacyAutoMigrate || {}),
    });

    DIAG('10', 'DONE', `duration=${duration}ms imported=${imported} skipped=${skipped}`);

    return res.status(200).json({
      success:     true,
      imported,
      skipped,
      totalOffers: Array.isArray(offers) ? offers.length : 0,
      offers:      Array.isArray(offers) ? offers.slice(0, 200) : [],
      duration,
    });

  } catch (error) {
    console.error('[import-platform] UNHANDLED ERROR:', error);
    return res.status(500).json({ error: String(error.message || error) });
  }
}

// ── Firestore PATCH helper (field-level update, no full document overwrite) ──
async function updatePlatformStatus(fsBase, platformName, key, authHeaders, statusFields) {
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

    const patchRes = await fetch(`${fsBase}/platforms/${platformName}${key}&${fieldPaths}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body:    JSON.stringify({ fields }),
    });
    console.log(`[import-platform] updatePlatformStatus: HTTP ${patchRes.status} for "${platformName}"`);
  } catch (e) {
    console.warn('[import-platform] Could not update platform status:', e.message);
  }
}
