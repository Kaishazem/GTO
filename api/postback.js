// api/postback.js — Universal Postback Handler (Vercel serverless)
//
// Accepts GET and POST from any CPA/offerwall network.
// Uses the Universal Parser to normalise params before any business logic.
// Returns HTTP 200 on ALL business-logic decisions — ad networks retry on non-200.
//
// ── ROOT-CAUSE FIX (see .agents/memory/postback-admin-sdk-required.md) ────────
// This file previously talked to Firestore over the public REST API using only
// the client API key (`?key=...`). That is an UNAUTHENTICATED request as far as
// Firestore Security Rules are concerned (request.auth == null), so every write
// to `taskCompletions` / `postbackConversions` / `postbackLogs` was silently
// rejected with PERMISSION_DENIED by firestore.rules (isAdmin()/isSignedIn()
// both require request.auth). The handler swallowed those errors in try/catch
// and still returned HTTP 200 "settled" to the ad network — so conversions
// looked successful in the logs but never actually reached Firestore.
//
// Fix: use the Firebase Admin SDK (service-account credentials), exactly like
// server/postback/engine.ts (dev) and api/broadcast.js already do. The Admin
// SDK bypasses Security Rules entirely, so writes actually persist.
//
// This also folds in the status-matching bug: the old query only looked for
// taskCompletions with status IN ['pending','platform_pending'], but the
// async start/confirm lifecycle actually produces 'started' and
// 'user_confirmed' — those were never matched, so completionId was always
// null for brand-new (non-legacy) completions.

import admin from 'firebase-admin';
import { parsePostback } from './_modules/postbackParser.js';

// ── Credential resolution (supports both naming conventions) ──────────────────
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
      console.error('[postback] ❌ FIREBASE_ADMIN_PRIVATE_KEY / FIREBASE_PRIVATE_KEY is not valid PEM.');
      return null;
    }
  }
  return key;
}

const privateKey = normaliseKey(rawKey);

let db = null;
let initError = null;

console.log('[postback] env check —'
  + ` projectId=${projectId ? '✅' : '❌ MISSING'}`
  + ` clientEmail=${clientEmail ? '✅' : '❌ MISSING'}`
  + ` privateKey=${rawKey ? '✅' : '❌ MISSING'}`);

if (!projectId || !clientEmail || !privateKey) {
  const missing = [
    !projectId && 'FIREBASE_PROJECT_ID (or VITE_FIREBASE_PROJECT_ID)',
    !clientEmail && 'FIREBASE_ADMIN_CLIENT_EMAIL (or FIREBASE_CLIENT_EMAIL)',
    !privateKey && 'FIREBASE_ADMIN_PRIVATE_KEY (or FIREBASE_PRIVATE_KEY)',
  ].filter(Boolean);
  initError = `Missing env vars: ${missing.join(', ')}`;
  console.error('[postback] ❌', initError);
} else if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      projectId,
    });
    db = admin.firestore();
    console.log('[postback] ✅ Firebase Admin initialised — project:', projectId);
  } catch (err) {
    initError = err?.message || String(err);
    console.error('[postback] ❌ Firebase Admin init failed:', initError);
  }
} else {
  db = admin.firestore();
}

// ── UNIFICATION FIX (Codex architecture review) ────────────────────────────────
// This handler previously diverged from server/postback/engine.ts (the Express /
// dev implementation) in two structural ways, even though both used the Admin
// SDK and the same parser/adapters:
//
//   1. Doc-ID scheme: this file base64-encoded the dedupKey into a sanitised
//      Firestore document ID for `postbackConversions`. engine.ts uses the raw
//      dedupKey string as the document ID. Same logical event → two different
//      document IDs depending on which implementation processed it.
//   2. Write pattern: this file wrote an early "processing" lock document and
//      then updated it after settlement (two writes). engine.ts computes the
//      final status first and writes the conversion document exactly once.
//
// Fixed below so both implementations produce byte-identical Firestore writes
// for the same input: same dedupKey-as-doc-ID, same single write-at-the-end
// pattern, same log document shape (no extra `displayName` field that
// engine.ts's LogDoc never had). Parsing (postbackParser.js/postbackAdapters.js),
// tracking-param extraction, OGAds URL generation, and the completion lifecycle
// (ACTIVE_STATUSES, settleFullyVerified/settlePostbackOnly/settleRejected*) were
// already identical and are untouched.

// Statuses that represent a taskCompletion still awaiting resolution.
// Must mirror server/postback/engine.ts ACTIVE_STATUSES exactly.
const ACTIVE_STATUSES = ['started', 'user_confirmed', 'postback_verified', 'platform_pending'];

function completionDocId(userId, taskId) {
  return `${userId}_${taskId}`;
}

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
  const startTime = Date.now();

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

  const fullUrl = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host || ''}${req.url || ''}`;

  // ── TEMPORARY DETAILED LOGGING (server-side only) ──────────────────────────
  console.log('\n[postback] ══════════════════════════════════════════════════');
  console.log('[postback] timestamp        :', receivedAt);
  console.log('[postback] method           :', req.method);
  console.log('[postback] full URL         :', fullUrl);
  console.log('[postback] query params     :', JSON.stringify(rawParams));
  console.log('[postback] aff_sub          :', rawParams.aff_sub ?? '(absent)');
  console.log('[postback] aff_sub2         :', rawParams.aff_sub2 ?? '(absent)');
  console.log('[postback] offer_id         :', rawParams.offer_id ?? '(absent)');
  console.log('[postback] payout (parsed)  :', payout);
  console.log('[postback] platform         :', platformId, `(${displayName})`);
  console.log('[postback] userId (parsed)  :', userId || '(empty)');
  console.log('[postback] taskId (parsed)  :', taskId || '(empty)');
  console.log('[postback] convId           :', convId || '(empty)');
  console.log('[postback] status (parsed)  :', status);
  console.log('[postback] ══════════════════════════════════════════════════\n');

  if (!db) {
    console.error('[postback] ❌ REJECTED — Firebase Admin unavailable:', initError || 'unknown init error');
    return res.status(200).json({ received: true, status: 'db_unavailable', message: initError || 'Server configuration error' });
  }

  // ── Secret validation ─────────────────────────────────────────────────────
  // OGAds does not support a custom password macro — skip the check for it.
  const secretIncoming = (rawParams.password || rawParams.secret || rawParams.sig || rawParams.pass || '').trim();
  const expectedSecret = await loadPostbackSecret(db);
  const skipSecretCheck = platformId === 'ogads';
  if (expectedSecret && !skipSecretCheck && secretIncoming !== expectedSecret) {
    console.warn(`[postback] ❌ REJECTED — invalid secret — platform=${platformId}`);
    await writeLog(db, 'invalid_secret', 'Invalid postback secret', parsed, '', Date.now() - startTime, receivedAt);
    return res.status(200).json({ received: true, status: 'invalid_secret' });
  }

  // ── Deduplication ─────────────────────────────────────────────────────────
  // Doc ID = raw dedupKey, matching engine.ts exactly (no base64 encoding).
  // This ensures the same logical event maps to the same postbackConversions
  // document regardless of which implementation (Express or Vercel) handles it.
  const dedupKey = convId ? `${platformId}_${convId}` : `${platformId}_${userId}_${taskId}`;

  let existing;
  try {
    existing = await db.collection('postbackConversions').doc(dedupKey).get();
  } catch (e) {
    console.error('[postback] ⚠ dedup check failed (continuing):', e.message);
    existing = null;
  }
  if (existing && existing.exists) {
    console.log('[postback] ↩ REJECTED — duplicate:', dedupKey);
    await writeLog(db, 'duplicate', 'Duplicate conversion — already processed', parsed, existing.data()?.completionId || '', Date.now() - startTime, receivedAt);
    return res.status(200).json({
      received: true,
      status: 'duplicate',
      platformId,
      userId,
      taskId,
      completionId: existing.data()?.completionId || null,
      payout,
      processingMs: Date.now() - startTime,
    });
  }

  // ── Find active task completion ───────────────────────────────────────────
  const completion = (userId && taskId) ? await findActiveCompletion(db, userId, taskId) : null;
  if (completion) {
    console.log(`[postback] ✓ Found active completion docId=${completion.id} status=${completion.status}`);
  } else if (userId && taskId) {
    console.log(`[postback] ⚠ No active completion for userId=${userId} taskId=${taskId} (docId tried: ${completionDocId(userId, taskId)})`);
  } else {
    console.warn(`[postback] ⚠ ACCEPTED BUT INCOMPLETE — userId or taskId empty — userId=${userId} taskId=${taskId}`);
  }

  const processingMs = () => Date.now() - startTime;

  // ── Approved postback ──────────────────────────────────────────────────────
  if (status === 'approved') {
    if (!completion) {
      console.warn(`[postback] ⚠ approved postback but no active completion found | platform=${platformId} userId=${userId} taskId=${taskId}`);
      await writeConversion(db, dedupKey, parsed, '', 'skipped_no_completion', processingMs(), receivedAt);
      await writeLog(db, 'skipped', 'Approved postback received but no matching active completion found', parsed, '', processingMs(), receivedAt);
      return res.status(200).json({
        received: true, status: 'skipped', platformId, userId, taskId,
        completionId: null, payout, processingMs: processingMs(),
      });
    }

    if (completion.status === 'user_confirmed' || completion.status === 'platform_pending') {
      // User already confirmed → both sides done → platform_approved
      await settleFullyVerified(db, completion.id, platformId, displayName, convId, payout);
      await writeConversion(db, dedupKey, parsed, completion.id, 'settled', processingMs(), receivedAt);
      await writeLog(db, 'settled', 'Both postback and user confirmed — moved to platform_approved', parsed, completion.id, processingMs(), receivedAt);
      console.log(`[postback] ✅ approved + user_confirmed → platform_approved | userId=${userId} taskId=${taskId}`);
      return res.status(200).json({
        received: true, status: 'settled', platformId, userId, taskId,
        completionId: completion.id, payout, processingMs: processingMs(),
      });
    }

    // started or postback_verified — store postback, wait for user confirmation
    await settlePostbackOnly(db, completion.id, platformId, displayName, convId, payout);
    await writeConversion(db, dedupKey, parsed, completion.id, 'postback_stored', processingMs(), receivedAt);
    await writeLog(db, 'postback_stored', 'Postback stored — awaiting user confirmation', parsed, completion.id, processingMs(), receivedAt);
    console.log(`[postback] 📦 approved postback stored → postback_verified | userId=${userId} taskId=${taskId}`);
    return res.status(200).json({
      received: true, status: 'postback_stored', platformId, userId, taskId,
      completionId: completion.id, payout, processingMs: processingMs(),
    });
  }

  // ── Rejected postback ──────────────────────────────────────────────────────
  if (!completion) {
    console.log(`[postback] ❌ rejected postback with no active completion | platform=${platformId} userId=${userId}`);
    await writeConversion(db, dedupKey, parsed, '', 'rejected_no_completion', processingMs(), receivedAt);
    await writeLog(db, 'rejected', 'Rejected postback — no matching active completion', parsed, '', processingMs(), receivedAt);
    return res.status(200).json({
      received: true, status: 'rejected', platformId, userId, taskId,
      completionId: null, payout, processingMs: processingMs(),
    });
  }

  if (completion.status === 'user_confirmed' || completion.status === 'platform_pending') {
    await settleRejectedWithReversal(db, completion.id, platformId, displayName, convId, completion.reward);
  } else {
    await settleRejected(db, completion.id, platformId, displayName, convId);
  }

  await writeConversion(db, dedupKey, parsed, completion.id, 'rejected', processingMs(), receivedAt);
  await writeLog(db, 'rejected', 'Conversion rejected by platform', parsed, completion.id, processingMs(), receivedAt);
  console.log(`[postback] ❌ rejected — platform=${platformId} userId=${userId} taskId=${taskId}`);

  return res.status(200).json({
    received: true, status: 'rejected', platformId, userId, taskId,
    completionId: completion.id, payout, processingMs: processingMs(),
  });
}

// ── Completion lookup ──────────────────────────────────────────────────────────

async function findActiveCompletion(db, userId, taskId) {
  try {
    // 1. Deterministic ID fast path — matches client-side completionDocId().
    const docId = completionDocId(userId, taskId);
    const snap = await db.collection('taskCompletions').doc(docId).get();
    if (snap.exists) {
      const data = snap.data();
      const s = data?.status;
      if (ACTIVE_STATUSES.includes(s)) {
        return { id: snap.id, status: s, reward: Number(data?.reward || 0) };
      }
      return null; // exists but terminal status — nothing to do
    }

    // 2. Legacy fallback — auto-ID documents created before the deterministic-ID migration.
    const legacySnap = await db.collection('taskCompletions')
      .where('taskId', '==', taskId)
      .where('userId', '==', userId)
      .where('status', 'in', ACTIVE_STATUSES)
      .limit(1)
      .get();
    if (legacySnap.empty) return null;
    const d = legacySnap.docs[0];
    return { id: d.id, status: d.data().status, reward: Number(d.data().reward || 0) };
  } catch (e) {
    console.warn('[postback] ⚠ findActiveCompletion error:', e.message);
    return null;
  }
}

// ── Settlement helpers ────────────────────────────────────────────────────────

async function settleFullyVerified(db, completionId, platformId, displayName, convId, payout) {
  try {
    await db.collection('taskCompletions').doc(completionId).update({
      status: 'platform_approved',
      verifiedBy: platformId,
      platformVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      platformVerifiedBy: platformId,
      platformName: displayName,
      postbackConvId: convId,
      postbackAmount: payout,
    });
  } catch (e) {
    console.error('[postback] ❌ settleFullyVerified failed:', e.message);
  }
}

async function settlePostbackOnly(db, completionId, platformId, displayName, convId, payout) {
  try {
    await db.collection('taskCompletions').doc(completionId).update({
      status: 'postback_verified',
      verifiedBy: platformId,
      platformVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      platformVerifiedBy: platformId,
      platformName: displayName,
      postbackConvId: convId,
      postbackAmount: payout,
    });
  } catch (e) {
    console.error('[postback] ❌ settlePostbackOnly failed:', e.message);
  }
}

async function settleRejectedWithReversal(db, completionId, platformId, displayName, convId, reward) {
  try {
    const ref = db.collection('taskCompletions').doc(completionId);
    const snap = await ref.get();
    if (!snap.exists) return;
    const userId = snap.data()?.userId;
    await db.runTransaction(async (tx) => {
      tx.update(ref, {
        status: 'rejected',
        verifiedBy: platformId,
        platformVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        platformName: displayName,
        postbackConvId: convId,
        rejectReason: 'Rejected by platform',
      });
      if (userId && reward > 0) {
        tx.update(db.collection('users').doc(userId), {
          pendingBalance: admin.firestore.FieldValue.increment(-reward),
        });
      }
    });
  } catch (e) {
    console.error('[postback] ❌ settleRejectedWithReversal failed:', e.message);
  }
}

async function settleRejected(db, completionId, platformId, displayName, convId) {
  try {
    await db.collection('taskCompletions').doc(completionId).update({
      status: 'rejected',
      verifiedBy: platformId,
      platformVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      platformName: displayName,
      postbackConvId: convId,
      rejectReason: 'Rejected by platform',
    });
  } catch (e) {
    console.error('[postback] ❌ settleRejected failed:', e.message);
  }
}

// ── Misc Firestore helpers ─────────────────────────────────────────────────────

async function loadPostbackSecret(db) {
  try {
    const snap = await db.collection('settings').doc('general').get();
    if (!snap.exists) return '';
    const data = snap.data();
    return data?.networkKeys?.postbackSecret || data?.postbackSecret || '';
  } catch {
    return '';
  }
}

// Field shape must mirror engine.ts's LogDoc exactly — no extra fields
// (a previous version of this file added `displayName`, which engine.ts's
// LogDoc never had and api/postbacks-admin.js's parseLogDoc never reads).
async function writeLog(db, type, message, parsed, completionId, processingMs, receivedAt) {
  try {
    await db.collection('postbackLogs').add({
      type,
      message,
      platformId: parsed.platformId,
      userId: parsed.userId,
      taskId: parsed.taskId,
      convId: parsed.convId,
      completionId,
      amount: parsed.payout,
      processingMs,
      receivedAt,
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[postback] ⚠ writeLog failed:', e.message);
  }
}

// Field shape must mirror engine.ts's ConversionDoc exactly, and — like
// engine.ts — this writes the conversion document exactly ONCE, after the
// final status is known, using the raw dedupKey as the document ID.
async function writeConversion(db, dedupKey, parsed, completionId, status, processingMs, receivedAt, error = '') {
  try {
    await db.collection('postbackConversions').doc(dedupKey).set({
      platformId: parsed.platformId,
      displayName: parsed.displayName,
      externalConversionId: parsed.convId,
      dedupKey,
      userId: parsed.userId,
      taskId: parsed.taskId,
      completionId,
      status,
      conversionStatus: parsed.status,
      amount: parsed.payout,
      rawParams: JSON.stringify(parsed.rawParams).slice(0, 2000),
      error,
      processingMs,
      receivedAt,
      processedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[postback] ❌ writeConversion failed:', e.message);
  }
}
