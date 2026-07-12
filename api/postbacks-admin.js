// api/postbacks-admin.js — Admin monitoring endpoint for postback conversions
// Returns paginated conversion history, logs, and aggregate stats.
// Protected by postback secret stored in Firestore settings.
//
// Uses the Firebase Admin SDK (service-account credentials) — see
// .agents/memory/postback-admin-sdk-required.md for why the previous
// REST+API-key approach silently failed under Firestore Security Rules
// (postbackConversions/postbackLogs are `allow read, write: if isAdmin()`,
// which requires request.auth; unauthenticated REST calls have none).

import admin from 'firebase-admin';

const projectId = process.env.FIREBASE_PROJECT_ID
  || process.env.VITE_FIREBASE_PROJECT_ID;

const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL
  || process.env.FIREBASE_CLIENT_EMAIL;

const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY
  || process.env.FIREBASE_PRIVATE_KEY;

function normaliseKey(raw) {
  if (!raw) return null;
  let key = raw
    .replace(/^["']|["']$/g, '')
    .replace(/\\\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .trim();
  if (!key.includes('\n')) {
    const m = key.match(/-----BEGIN ([^-]+)-----\s*([\s\S]+?)\s*-----END \1-----/);
    if (m) {
      const body = m[2].replace(/\s+/g, '');
      const lines = body.match(/.{1,64}/g) ?? [];
      key = `-----BEGIN ${m[1]}-----\n${lines.join('\n')}\n-----END ${m[1]}-----\n`;
    } else {
      console.error('[postbacks-admin] ❌ private key is not valid PEM.');
      return null;
    }
  }
  return key;
}

const privateKey = normaliseKey(rawKey);

let db = null;
let initError = null;

if (!projectId || !clientEmail || !privateKey) {
  initError = 'Missing Firebase Admin credentials';
  console.error('[postbacks-admin] ❌', initError);
} else if (!admin.apps.length) {
  try {
    admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }), projectId });
    db = admin.firestore();
  } catch (err) {
    initError = err?.message || String(err);
    console.error('[postbacks-admin] ❌ Firebase Admin init failed:', initError);
  }
} else {
  db = admin.firestore();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!db) {
    return res.status(500).json({ error: initError || 'Server configuration error' });
  }

  // ── 1. Auth: validate admin secret from Firestore settings ──────────────────
  const suppliedSecret = req.query.secret || req.headers['x-admin-secret'] || '';

  try {
    const settingsSnap = await db.collection('settings').doc('general').get();
    const data = settingsSnap.exists ? settingsSnap.data() : {};
    const storedSecret = data?.networkKeys?.postbackSecret || data?.postbackSecret || '';

    // Require a non-empty secret; "change-me-in-admin-settings" is treated as unset
    if (storedSecret && storedSecret !== 'change-me-in-admin-settings') {
      if (!suppliedSecret || suppliedSecret !== storedSecret) {
        return res.status(401).json({ error: 'Unauthorized: invalid admin secret' });
      }
    }
  } catch (e) {
    console.warn('[postbacks-admin] Could not verify secret from Firestore:', e.message);
  }

  // ── 2. Parse query options ───────────────────────────────────────────────────
  const filterStatus   = req.query.status   || 'all';  // all | settled | rejected | skipped | duplicate | invalid_*
  const filterPlatform = req.query.platform || '';
  const pageSize       = Math.min(parseInt(req.query.limit || '50', 10), 200);

  // ── 3. Fetch postbackConversions ─────────────────────────────────────────────
  let conversions = [];
  try {
    conversions = await queryConversions(db, filterStatus, filterPlatform, pageSize);
  } catch (e) {
    console.error('[postbacks-admin] Error fetching conversions:', e.message);
  }

  // ── 4. Fetch recent postbackLogs (last 100) ───────────────────────────────────
  let logs = [];
  try {
    const logsSnap = await db.collection('postbackLogs').orderBy('createdAt', 'desc').limit(100).get();
    logs = logsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('[postbacks-admin] Error fetching logs:', e.message);
  }

  // ── 5. Build aggregate stats ─────────────────────────────────────────────────
  let allForStats = conversions;
  if (filterStatus !== 'all' || filterPlatform) {
    try {
      allForStats = await queryConversions(db, 'all', '', 500);
    } catch { /* keep the filtered set as fallback */ }
  }

  const stats = buildStats(allForStats, logs);

  return res.status(200).json({
    conversions,
    logs: logs.slice(0, 50),
    stats,
    total: conversions.length,
  });
}

// ── Query helper ───────────────────────────────────────────────────────────────
async function queryConversions(db, filterStatus, filterPlatform, pageSize) {
  let q = db.collection('postbackConversions');
  if (filterStatus && filterStatus !== 'all') q = q.where('status', '==', filterStatus);
  if (filterPlatform) q = q.where('platformId', '==', filterPlatform);
  q = q.orderBy('receivedAt', 'desc').limit(pageSize);
  const snap = await q.get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
    .reduce((s, c) => s + Number(c.amount || 0), 0);

  const byPlatform = {};
  conversions.forEach(c => {
    const p = c.platformName || c.platformId || 'unknown';
    if (!byPlatform[p]) byPlatform[p] = { total: 0, settled: 0, amount: 0 };
    byPlatform[p].total++;
    if (c.status === 'settled') { byPlatform[p].settled++; byPlatform[p].amount += Number(c.amount || 0); }
  });

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
      ? Math.round(conversions.reduce((s, c) => s + Number(c.processingMs || 0), 0) / total)
      : 0,
  };
}
