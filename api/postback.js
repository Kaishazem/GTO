// api/postback.js — Universal Postback Handler (Vercel serverless)
//
// Accepts GET and POST from any CPA/offerwall network.
// Uses the Universal Parser to normalise params before any business logic.
// Returns HTTP 200 on ALL business-logic decisions — ad networks retry on non-200.

import crypto from 'crypto';
import { parsePostback } from './_modules/postbackParser.js';

// ── Entry point ───────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const receivedAt = new Date().toISOString();
  const startTime  = Date.now();

  // ── Merge GET query + POST body ───────────────────────────────────────────
  const rawParams = {};
  if (req.query && typeof req.query === 'object') {
    for (const [k, v] of Object.entries(req.query)) rawParams[k] = String(v ?? '');
  }
  if (req.body && typeof req.body === 'object') {
    for (const [k, v] of Object.entries(req.body)) rawParams[k] = String(v ?? '');
  }

  // ── Universal parse ───────────────────────────────────────────────────────
  const parsed = parsePostback(rawParams);
  const { platformId, displayName, userId, taskId, convId, payout, status } = parsed;

  console.log(`[postback] ▶ ${req.method} network=${platformId} user=${userId} task=${taskId} conv=${convId} status=${status} payout=${payout}`);
  console.log(`[postback]   raw params: ${JSON.stringify(rawParams).slice(0, 500)}`);

  // ── Firebase config ───────────────────────────────────────────────────────
  const firebaseProjectId =
    process.env.VITE_FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_PROJECT_ID ||
    'green-task-orbit';
  const firebaseApiKey =
    process.env.VITE_FIREBASE_API_KEY ||
    process.env.FIREBASE_API_KEY;

  if (!firebaseApiKey) {
    console.error('[postback] FATAL: Missing VITE_FIREBASE_API_KEY');
    return res.status(200).json({ received: true, status: 'db_unavailable', message: 'Server configuration error' });
  }

  const fsBase = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents`;
  const key    = `?key=${firebaseApiKey}`;

  // ── Secret validation ─────────────────────────────────────────────────────
  const secretIncoming = (rawParams.password || rawParams.secret || rawParams.sig || rawParams.pass || '').trim();
  const expectedSecret = await loadPostbackSecret(fsBase, key);
  if (expectedSecret && secretIncoming !== expectedSecret) {
    console.warn(`[postback] ❌ Invalid secret — platform=${platformId}`);
    await writeLog(fsBase, key, 'invalid_secret', 'Invalid postback secret', parsed, '', Date.now() - startTime, receivedAt);
    return res.status(200).json({ received: true, status: 'invalid_secret' });
  }

  // ── Deduplication ─────────────────────────────────────────────────────────
  const dedupKey   = convId ? `${platformId}_${convId}` : `${platformId}_${userId}_${taskId}`;
  const dedupDocId = Buffer.from(dedupKey).toString('base64').replace(/[+/=]/g, '_').slice(0, 60);

  try {
    const checkRes = await fetch(`${fsBase}/postbackConversions/${dedupDocId}${key}`);
    const checkDoc = await checkRes.json();
    if (checkDoc.fields) {
      console.log('[postback] ↩ Duplicate blocked:', dedupKey);
      await writeLog(fsBase, key, 'duplicate', 'Duplicate conversion — already processed', parsed, '', Date.now() - startTime, receivedAt);
      return res.status(200).json({ received: true, status: 'duplicate' });
    }
  } catch { /* NOT_FOUND is expected for new conversions */ }

  // ── Find pending task completion ──────────────────────────────────────────
  let completionId = null;

  if (userId && taskId) {
    try {
      const queryRes = await fetch(`${fsBase}:runQuery${key}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          structuredQuery: {
            from:  [{ collectionId: 'taskCompletions' }],
            where: {
              compositeFilter: {
                op: 'AND',
                filters: [
                  { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: userId } } },
                  { fieldFilter: { field: { fieldPath: 'taskId' }, op: 'EQUAL', value: { stringValue: taskId } } },
                  { fieldFilter: { field: { fieldPath: 'status' }, op: 'IN', value: { arrayValue: { values: [{ stringValue: 'pending' }, { stringValue: 'platform_pending' }] } } } },
                ],
              },
            },
            limit: 1,
          },
        }),
      });
      const queryData = await queryRes.json();
      if (Array.isArray(queryData) && queryData[0]?.document?.name) {
        completionId = queryData[0].document.name.split('/').pop();
        console.log(`[postback] ✓ Found pending completion ${completionId}`);
      } else {
        console.log(`[postback] ⚠ No pending completion for userId=${userId} taskId=${taskId}`);
      }
    } catch (e) {
      console.warn('[postback] ⚠ Could not query taskCompletions:', e.message);
    }
  } else {
    console.warn(`[postback] ⚠ userId or taskId empty — userId=${userId} taskId=${taskId}`);
  }

  // ── Write initial conversion record (idempotency lock) ────────────────────
  await patchDocument(fsBase, key, `postbackConversions/${dedupDocId}`, {
    platformId:           { stringValue: platformId },
    displayName:          { stringValue: displayName },
    externalConversionId: { stringValue: convId },
    dedupKey:             { stringValue: dedupKey },
    userId:               { stringValue: userId },
    taskId:               { stringValue: taskId },
    status:               { stringValue: 'processing' },
    conversionStatus:     { stringValue: status },
    amount:               { doubleValue: payout },
    rawParams:            { stringValue: JSON.stringify(rawParams).slice(0, 2000) },
    receivedAt:           { stringValue: receivedAt },
    processedAt:          { nullValue: null },
    completionId:         { stringValue: '' },
    error:                { stringValue: '' },
  });

  // ── Settle ────────────────────────────────────────────────────────────────
  let finalStatus  = 'skipped';
  let logType      = 'skipped';
  let logMessage   = 'No matching pending completion found';

  if (status === 'approved') {
    if (completionId) {
      const settled = await settleApproved(fsBase, key, completionId, platformId, displayName, convId, payout);
      if (settled) {
        finalStatus = 'settled';
        logType     = 'settled';
        logMessage  = 'Conversion settled — completion moved to platform_approved';
      }
    }
  } else {
    // rejected
    if (completionId) await settleRejected(fsBase, key, completionId, platformId, displayName, convId, userId);
    finalStatus = 'rejected';
    logType     = 'rejected';
    logMessage  = 'Conversion rejected by platform';
  }

  // ── Finalise conversion record ────────────────────────────────────────────
  const processingMs = Date.now() - startTime;
  await patchDocument(fsBase, key, `postbackConversions/${dedupDocId}`, {
    status:       { stringValue: finalStatus },
    completionId: { stringValue: completionId || '' },
    processedAt:  { stringValue: new Date().toISOString() },
    processingMs: { integerValue: processingMs },
  });

  await writeLog(fsBase, key, logType, logMessage, parsed, completionId || '', processingMs, receivedAt);

  console.log(`[postback] ✅ Done platform=${platformId} user=${userId} task=${taskId} final=${finalStatus} ms=${processingMs}`);

  return res.status(200).json({
    received:     true,
    status:       finalStatus,
    platformId,
    userId,
    taskId,
    completionId: completionId || null,
    payout,
    processingMs,
  });
}

// ── Settlement helpers ────────────────────────────────────────────────────────

async function settleApproved(fsBase, key, completionId, platformId, displayName, convId, payout) {
  try {
    const now = new Date().toISOString();
    await patchDocument(fsBase, key, `taskCompletions/${completionId}`, {
      status:             { stringValue: 'platform_approved' },
      verifiedBy:         { stringValue: platformId },
      platformVerifiedAt: { stringValue: now },
      platformVerifiedBy: { stringValue: platformId },
      platformName:       { stringValue: displayName },
      postbackConvId:     { stringValue: convId },
      postbackAmount:     { doubleValue: payout },
    });
    return true;
  } catch (e) {
    console.error('[postback] settleApproved failed:', e.message);
    return false;
  }
}

async function settleRejected(fsBase, key, completionId, platformId, displayName, convId, userId) {
  try {
    await patchDocument(fsBase, key, `taskCompletions/${completionId}`, {
      status:             { stringValue: 'rejected' },
      verifiedBy:         { stringValue: platformId },
      platformVerifiedAt: { stringValue: new Date().toISOString() },
      platformName:       { stringValue: displayName },
      postbackConvId:     { stringValue: convId },
      rejectReason:       { stringValue: 'Rejected by platform' },
    });
  } catch (e) {
    console.error('[postback] settleRejected failed:', e.message);
  }
}

// ── Firestore helpers ─────────────────────────────────────────────────────────

async function loadPostbackSecret(fsBase, key) {
  try {
    const res  = await fetch(`${fsBase}/settings/general${key}`);
    const doc  = await res.json();
    if (!doc.fields) return '';
    const nk = doc.fields?.networkKeys?.mapValue?.fields;
    return nk?.postbackSecret?.stringValue
      || doc.fields?.postbackSecret?.stringValue
      || '';
  } catch {
    return '';
  }
}

async function patchDocument(fsBase, key, path, fields) {
  const fieldPaths = Object.keys(fields)
    .map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join('&');
  try {
    const res = await fetch(`${fsBase}/${path}${key}&${fieldPaths}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ fields }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn(`[postback] PATCH ${path} → ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.ok;
  } catch (e) {
    console.warn(`[postback] PATCH ${path} error:`, e.message);
    return false;
  }
}

async function writeLog(fsBase, key, type, message, parsed, completionId, processingMs, receivedAt) {
  const id = crypto.randomBytes(16).toString('hex');
  try {
    await fetch(`${fsBase}/postbackLogs${key}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          type:         { stringValue: type },
          message:      { stringValue: message },
          platformId:   { stringValue: parsed.platformId },
          displayName:  { stringValue: parsed.displayName },
          userId:       { stringValue: parsed.userId },
          taskId:       { stringValue: parsed.taskId },
          convId:       { stringValue: parsed.convId },
          completionId: { stringValue: completionId },
          amount:       { doubleValue: parsed.payout },
          processingMs: { integerValue: processingMs },
          receivedAt:   { stringValue: receivedAt },
          createdAt:    { stringValue: new Date().toISOString() },
        },
      }),
    });
  } catch (e) {
    console.warn('[postback] writeLog failed:', e.message);
  }
}
