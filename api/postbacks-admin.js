// api/postbacks-admin.js — Admin monitoring endpoint for postback conversions
// Returns paginated conversion history, logs, and aggregate stats.
// Protected by postback secret stored in Firestore settings.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const firebaseProjectId =
    process.env.VITE_FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_PROJECT_ID ||
    'green-task-orbit';
  const firebaseApiKey =
    process.env.VITE_FIREBASE_API_KEY ||
    process.env.FIREBASE_API_KEY;

  if (!firebaseApiKey) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const fsBase = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents`;
  const key    = `?key=${firebaseApiKey}`;

  // ── 1. Auth: validate admin secret from Firestore settings ──────────────────
  const suppliedSecret = req.query.secret || req.headers['x-admin-secret'] || '';

  try {
    const settingsRes = await fetch(`${fsBase}/settings/general${key}`);
    const settingsDoc = await settingsRes.json();
    const storedSecret =
      settingsDoc.fields?.networkKeys?.mapValue?.fields?.postbackSecret?.stringValue ||
      settingsDoc.fields?.postbackSecret?.stringValue ||
      '';

    // Require a non-empty secret; "change-me-in-admin-settings" is treated as unset
    if (storedSecret && storedSecret !== 'change-me-in-admin-settings') {
      if (!suppliedSecret || suppliedSecret !== storedSecret) {
        return res.status(401).json({ error: 'Unauthorized: invalid admin secret' });
      }
    }
  } catch (e) {
    console.warn('[postbacks-admin] Could not verify secret from Firestore:', e.message);
    // Proceed in dev mode (no stored secret)
  }

  // ── 2. Parse query options ───────────────────────────────────────────────────
  const filterStatus   = req.query.status   || 'all';  // all | settled | rejected | skipped | duplicate | invalid_*
  const filterPlatform = req.query.platform || '';
  const pageSize       = Math.min(parseInt(req.query.limit || '50', 10), 200);

  // ── 3. Fetch postbackConversions ─────────────────────────────────────────────
  let conversions = [];
  try {
    const queryBody = buildConversionsQuery(filterStatus, filterPlatform, pageSize);
    const qRes = await fetch(`${fsBase}:runQuery${key}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(queryBody),
    });
    const qData = await qRes.json();

    if (Array.isArray(qData)) {
      conversions = qData
        .filter(r => r.document?.fields)
        .map(r => parseConversionDoc(r.document));
    }
  } catch (e) {
    console.error('[postbacks-admin] Error fetching conversions:', e.message);
  }

  // ── 4. Fetch recent postbackLogs (last 100) ───────────────────────────────────
  let logs = [];
  try {
    const logsRes = await fetch(`${fsBase}/postbackLogs${key}&pageSize=100&orderBy=createdAt+desc`);
    const logsData = await logsRes.json();
    if (Array.isArray(logsData.documents)) {
      logs = logsData.documents.map(d => parseLogDoc(d));
    }
  } catch (e) {
    console.warn('[postbacks-admin] Error fetching logs:', e.message);
  }

  // ── 5. Build aggregate stats ─────────────────────────────────────────────────
  // Fetch all conversions for stats (up to 500)
  let allForStats = conversions;
  if (filterStatus !== 'all' || filterPlatform) {
    try {
      const allQuery = buildConversionsQuery('all', '', 500);
      const allRes = await fetch(`${fsBase}:runQuery${key}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(allQuery),
      });
      const allData = await allRes.json();
      if (Array.isArray(allData)) {
        allForStats = allData
          .filter(r => r.document?.fields)
          .map(r => parseConversionDoc(r.document));
      }
    } catch {}
  }

  const stats = buildStats(allForStats, logs);

  return res.status(200).json({
    conversions,
    logs: logs.slice(0, 50),
    stats,
    total: conversions.length,
  });
}

// ── Query builder ─────────────────────────────────────────────────────────────
function buildConversionsQuery(filterStatus, filterPlatform, pageSize) {
  const filters = [];

  if (filterStatus && filterStatus !== 'all') {
    filters.push({
      fieldFilter: {
        field: { fieldPath: 'status' },
        op:    'EQUAL',
        value: { stringValue: filterStatus },
      },
    });
  }

  if (filterPlatform) {
    filters.push({
      fieldFilter: {
        field: { fieldPath: 'platformId' },
        op:    'EQUAL',
        value: { stringValue: filterPlatform },
      },
    });
  }

  const structuredQuery = {
    from:    [{ collectionId: 'postbackConversions' }],
    orderBy: [{ field: { fieldPath: 'receivedAt' }, direction: 'DESCENDING' }],
    limit:   pageSize,
  };

  if (filters.length === 1) {
    structuredQuery.where = { fieldFilter: filters[0].fieldFilter };
  } else if (filters.length > 1) {
    structuredQuery.where = { compositeFilter: { op: 'AND', filters } };
  }

  return { structuredQuery };
}

// ── Document parsers ──────────────────────────────────────────────────────────
function fv(field) {
  if (!field) return undefined;
  if ('stringValue'  in field) return field.stringValue;
  if ('booleanValue' in field) return field.booleanValue;
  if ('integerValue' in field) return Number(field.integerValue);
  if ('doubleValue'  in field) return Number(field.doubleValue);
  if ('nullValue'    in field) return null;
  return undefined;
}

function parseConversionDoc(doc) {
  const f  = doc.fields || {};
  const id = doc.name?.split('/').pop() || '';
  return {
    id,
    platformId:           fv(f.platformId)           || '',
    platformName:         fv(f.platformName)          || fv(f.platformId) || '',
    externalConversionId: fv(f.externalConversionId) || '',
    dedupKey:             fv(f.dedupKey)              || '',
    userId:               fv(f.userId)               || '',
    taskId:               fv(f.taskId)               || '',
    completionId:         fv(f.completionId)         || '',
    status:               fv(f.status)               || 'unknown',
    conversionStatus:     fv(f.conversionStatus)     || 'approved',
    amount:               Number(fv(f.amount)        || 0),
    error:                fv(f.error)                || '',
    processingMs:         Number(fv(f.processingMs)  || 0),
    receivedAt:           fv(f.receivedAt)           || '',
    processedAt:          fv(f.processedAt)          || '',
  };
}

function parseLogDoc(doc) {
  const f  = doc.fields || {};
  const id = doc.name?.split('/').pop() || '';
  return {
    id,
    type:        fv(f.type)       || '',
    message:     fv(f.message)    || '',
    platformId:  fv(f.platformId) || '',
    userId:      fv(f.userId)     || '',
    taskId:      fv(f.taskId)     || '',
    convId:      fv(f.convId)     || '',
    status:      fv(f.status)     || '',
    amount:      Number(fv(f.amount) || 0),
    completionId:fv(f.completionId) || '',
    processingMs:Number(fv(f.processingMs) || 0),
    receivedAt:  fv(f.receivedAt) || '',
    createdAt:   fv(f.createdAt)  || '',
  };
}

// ── Stats aggregation ─────────────────────────────────────────────────────────
function buildStats(conversions, logs) {
  const total      = conversions.length;
  const settled    = conversions.filter(c => c.status === 'settled').length;
  const rejected   = conversions.filter(c => c.status === 'rejected').length;
  const skipped    = conversions.filter(c => c.status === 'skipped').length;
  const duplicates = conversions.filter(c => c.status === 'duplicate').length;
  const processing = conversions.filter(c => c.status === 'processing').length;
  const failed     = conversions.filter(c => ['invalid_params', 'invalid_platform', 'invalid_signature', 'invalid_secret', 'replay_prevented'].includes(c.status)).length;

  const totalSettledAmount = conversions
    .filter(c => c.status === 'settled')
    .reduce((s, c) => s + c.amount, 0);

  // Platform breakdown
  const byPlatform = {};
  conversions.forEach(c => {
    const p = c.platformName || c.platformId || 'unknown';
    if (!byPlatform[p]) byPlatform[p] = { total: 0, settled: 0, amount: 0 };
    byPlatform[p].total++;
    if (c.status === 'settled') { byPlatform[p].settled++; byPlatform[p].amount += c.amount; }
  });

  // Log type breakdown
  const logsByType = {};
  logs.forEach(l => {
    logsByType[l.type] = (logsByType[l.type] || 0) + 1;
  });

  return {
    total, settled, rejected, skipped, duplicates, processing, failed,
    totalSettledAmount,
    byPlatform,
    logsByType,
    avgProcessingMs: total > 0
      ? Math.round(conversions.reduce((s, c) => s + c.processingMs, 0) / total)
      : 0,
  };
}
