// api/postback.js — Universal Postback Handler
// Processes conversion postbacks from any ad network.
// Validates identity, signature, deduplicates, settles, and logs everything.
// Returns HTTP 200 on ALL business-logic decisions — ad networks retry on non-200.

import crypto from 'crypto';

// ── Constants ──────────────────────────────────────────────────────────────────
const REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

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

  // Merge query params and body (POST body or GET query both supported)
  const params = { ...req.query, ...(typeof req.body === 'object' && req.body !== null ? req.body : {}) };

  // ── Firebase config ──────────────────────────────────────────────────────────
  const firebaseProjectId =
    process.env.VITE_FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_PROJECT_ID ||
    'green-task-orbit';
  const firebaseApiKey =
    process.env.VITE_FIREBASE_API_KEY ||
    process.env.FIREBASE_API_KEY ||
    params._fkey; // never exposed publicly — only for dev testing

  if (!firebaseApiKey) {
    console.error('[postback] FATAL: Missing VITE_FIREBASE_API_KEY env var');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const fsBase = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents`;
  const key = `?key=${firebaseApiKey}`;

  // ── 1. Extract and normalize parameters ─────────────────────────────────────
  // Support many common ad network parameter names
  const platformId   = (params.platform  || params.network   || params.pub_id    || '').trim();
  const userId       = (params.user_id   || params.uid       || params.userId    || '').trim();
  const taskId       = (params.task_id   || params.offer_id  || params.taskId    || '').trim();
  const convId       = (params.conv_id   || params.transaction_id || params.tid  || params.convId || '').trim();
  const statusParam  = (params.status    || 'approved').toLowerCase();
  const amountParam  = params.amount     || params.payout    || params.reward    || '0';
  const secretParam  = params.secret     || params.s         || '';
  const sigParam     = params.sig        || params.signature || '';
  const tsParam      = params.ts         || params.timestamp || '';
  const reasonParam  = params.reason     || params.reject_reason || '';

  const amount = Math.max(0, parseFloat(amountParam) || 0);
  const status = statusParam === 'rejected' || statusParam === 'deny' ? 'rejected' : 'approved';

  const baseContext = { platformId, userId, taskId, convId, status, amount, receivedAt };

  console.log(`[postback] ▶ Received platform=${platformId} user=${userId} task=${taskId} conv=${convId} status=${status} amount=${amount}`);

  // ── 2. Validate required parameters ─────────────────────────────────────────
  if (!platformId || !userId || !taskId) {
    const reason = `Missing required params: platform=${platformId || 'MISSING'} user_id=${userId || 'MISSING'} task_id=${taskId || 'MISSING'}`;
    await writeLog(fsBase, key, 'invalid_params', reason, baseContext);
    console.warn('[postback] ⚠ Invalid params:', reason);
    return res.status(200).json({ received: true, status: 'invalid_params', reason });
  }

  // ── 3. Load platform config from Firestore ───────────────────────────────────
  let platform;
  try {
    const platRes = await fetch(`${fsBase}/platforms/${platformId}${key}`);
    const platDoc = await platRes.json();

    if (!platDoc.fields) {
      const reason = `Platform '${platformId}' not found in Firestore`;
      await writeLog(fsBase, key, 'invalid_platform', reason, baseContext);
      console.warn('[postback] ⚠', reason);
      return res.status(200).json({ received: true, status: 'invalid_platform', reason });
    }

    const f  = platDoc.fields;
    const fv = (field) => {
      if (!field) return undefined;
      if ('stringValue'  in field) return field.stringValue;
      if ('booleanValue' in field) return field.booleanValue;
      if ('integerValue' in field) return Number(field.integerValue);
      if ('doubleValue'  in field) return Number(field.doubleValue);
      return undefined;
    };

    platform = {
      id:              platformId,
      displayName:     fv(f.displayName) || platformId,
      enabled:         fv(f.enabled) !== false,
      postbackSecret:  fv(f.postbackSecret) || '',
      signatureMethod: fv(f.signatureMethod) || 'secret', // 'secret' | 'hmac_sha256' | 'none'
    };
  } catch (e) {
    console.error('[postback] ✖ Error loading platform:', e.message);
    return res.status(500).json({ error: 'Failed to load platform configuration' });
  }

  // ── 4. Validate platform is enabled ─────────────────────────────────────────
  if (!platform.enabled) {
    const reason = `Platform '${platformId}' is disabled`;
    await writeLog(fsBase, key, 'invalid_platform', reason, baseContext);
    console.warn('[postback] ⚠', reason);
    return res.status(200).json({ received: true, status: 'platform_disabled', reason });
  }

  // ── 5. Signature / secret validation ────────────────────────────────────────
  const platformSecret  = platform.postbackSecret;
  const signatureMethod = platform.signatureMethod;

  if (platformSecret && signatureMethod !== 'none') {
    if (signatureMethod === 'hmac_sha256') {
      // HMAC-SHA256 of "platform:user_id:task_id:conv_id:amount:ts"
      const payload  = `${platformId}:${userId}:${taskId}:${convId}:${amountParam}:${tsParam}`;
      const expected = crypto.createHmac('sha256', platformSecret).update(payload).digest('hex');

      if (!sigParam || !timingSafeEqual(String(sigParam), expected)) {
        const reason = 'Invalid HMAC-SHA256 signature';
        await writeLog(fsBase, key, 'invalid_signature', reason, baseContext);
        console.warn(`[postback] ⚠ ${reason} for platform ${platformId}`);
        return res.status(200).json({ received: true, status: 'invalid_signature', reason });
      }
    } else {
      // Simple shared-secret comparison
      if (!secretParam || !timingSafeEqual(String(secretParam), platformSecret)) {
        const reason = 'Invalid postback secret';
        await writeLog(fsBase, key, 'invalid_signature', reason, baseContext);
        console.warn(`[postback] ⚠ ${reason} for platform ${platformId}`);
        return res.status(200).json({ received: true, status: 'invalid_secret', reason });
      }
    }
  }

  // ── 6. Replay attack prevention (only when timestamp is supplied) ────────────
  if (tsParam) {
    const ts   = parseInt(tsParam, 10);
    const tsMs = ts > 1_000_000_000_000 ? ts : ts * 1000; // handle seconds or ms
    const ageMs = Date.now() - tsMs;
    if (ageMs > REPLAY_WINDOW_MS) {
      const reason = `Timestamp too old (${Math.floor(ageMs / 1000)}s ago)`;
      await writeLog(fsBase, key, 'replay_attack', reason, baseContext);
      console.warn('[postback] ⚠ Replay attack prevented:', reason);
      return res.status(200).json({ received: true, status: 'replay_prevented', reason });
    }
  }

  // ── 7. Deduplication check ───────────────────────────────────────────────────
  // Primary dedup key: platformId:convId  (fallback: platformId:userId:taskId)
  const dedupKey   = convId ? `${platformId}:${convId}` : `${platformId}:${userId}:${taskId}`;
  const dedupDocId = Buffer.from(dedupKey).toString('base64').replace(/[+/=]/g, '_').slice(0, 60);

  try {
    const checkRes = await fetch(`${fsBase}/postbackConversions/${dedupDocId}${key}`);
    const checkDoc = await checkRes.json();
    if (checkDoc.fields) {
      const prevStatus = checkDoc.fields?.status?.stringValue || 'unknown';
      const reason = `Duplicate conversion '${dedupKey}' (previously: ${prevStatus})`;
      await writeLog(fsBase, key, 'duplicate', reason, baseContext);
      console.log('[postback] ↩ Duplicate blocked:', dedupKey);
      return res.status(200).json({ received: true, status: 'duplicate', reason });
    }
  } catch {
    // NOT_FOUND is expected for new conversions — continue
  }

  // ── 8. Create conversion record immediately (idempotency lock) ───────────────
  await patchDocument(fsBase, key, `postbackConversions/${dedupDocId}`, {
    platformId:            { stringValue: platformId },
    platformName:          { stringValue: platform.displayName },
    externalConversionId:  { stringValue: convId },
    dedupKey:              { stringValue: dedupKey },
    userId:                { stringValue: userId },
    taskId:                { stringValue: taskId },
    status:                { stringValue: 'processing' },
    conversionStatus:      { stringValue: status },
    amount:                { doubleValue: amount },
    rawParams:             { stringValue: JSON.stringify(params).slice(0, 2000) },
    receivedAt:            { stringValue: receivedAt },
    processedAt:           { nullValue: null },
    completionId:          { stringValue: '' },
    error:                 { stringValue: '' },
  });

  // ── 9. Find existing pending task completion ─────────────────────────────────
  let completionId   = null;
  let settledReward  = amount;

  try {
    const queryRes = await fetch(`${fsBase}:runQuery${key}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        structuredQuery: {
          from:  [{ collectionId: 'taskCompletions' }],
          where: {
            compositeFilter: {
              op: 'AND',
              filters: [
                { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: userId } } },
                { fieldFilter: { field: { fieldPath: 'taskId' }, op: 'EQUAL', value: { stringValue: taskId } } },
                { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'pending' } } },
              ],
            },
          },
          limit: 1,
        },
      }),
    });
    const queryData = await queryRes.json();
    if (Array.isArray(queryData) && queryData[0]?.document?.name) {
      const doc      = queryData[0].document;
      completionId   = doc.name.split('/').pop();
      const rewardF  = doc.fields?.reward;
      settledReward  = rewardF?.doubleValue ?? rewardF?.integerValue ?? amount;
      console.log(`[postback] ✓ Found pending completion ${completionId} reward=${settledReward}`);
    }
  } catch (e) {
    console.warn('[postback] ⚠ Could not query taskCompletions:', e.message);
  }

  // ── 10. If no pending completion exists, create one (platform push flow) ─────
  if (!completionId && status === 'approved') {
    let taskTitle   = 'Platform Task';
    let taskReward  = amount;

    // Look up the task document for title and canonical reward
    try {
      const taskRes = await fetch(`${fsBase}/tasks/${taskId}${key}`);
      const taskDoc = await taskRes.json();
      if (taskDoc.fields) {
        taskTitle  = taskDoc.fields?.title?.stringValue || 'Platform Task';
        const rf   = taskDoc.fields?.reward;
        taskReward = rf?.doubleValue ?? rf?.integerValue ?? amount;
      }
    } catch {}

    // Create pending completion
    try {
      const newCompRes = await fetch(`${fsBase}/taskCompletions${key}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          fields: {
            userId:        { stringValue: userId },
            taskId:        { stringValue: taskId },
            taskTitle:     { stringValue: taskTitle },
            taskType:      { stringValue: 'platform' },
            taskPlatform:  { stringValue: platform.displayName },
            reward:        { doubleValue: taskReward },
            status:        { stringValue: 'pending' },
            source:        { stringValue: 'postback' },
            completedAt:   { stringValue: new Date().toISOString() },
          },
        }),
      });
      if (newCompRes.ok) {
        const newComp = await newCompRes.json();
        completionId  = newComp.name?.split('/').pop() || null;
        settledReward = taskReward;
        console.log(`[postback] ✓ Created new completion ${completionId}`);

        // Add to user's pendingBalance
        await adjustUserBalance(fsBase, key, userId, 0, taskReward); // (balanceDelta, pendingDelta)
      }
    } catch (e) {
      console.error('[postback] ✖ Failed to create task completion:', e.message);
    }
  }

  // ── 11. Settle the completion ────────────────────────────────────────────────
  let settlementResult = { applied: false, message: 'No pending completion found' };

  if (completionId) {
    settlementResult = await settleCompletion(
      fsBase, key,
      completionId, userId, settledReward, status,
      platformId, platform.displayName, reasonParam
    );
  }

  // ── 12. Finalize conversion record ───────────────────────────────────────────
  const processingMs = Date.now() - startTime;
  const finalStatus  = settlementResult.applied
    ? (status === 'approved' ? 'settled' : 'rejected')
    : 'skipped';

  await patchDocument(fsBase, key, `postbackConversions/${dedupDocId}`, {
    status:          { stringValue: finalStatus },
    completionId:    { stringValue: completionId || '' },
    error:           { stringValue: settlementResult.applied ? '' : (settlementResult.message || '') },
    processedAt:     { stringValue: new Date().toISOString() },
    processingMs:    { integerValue: processingMs },
  });

  // ── 13. Write final log ──────────────────────────────────────────────────────
  const logType = settlementResult.applied
    ? (status === 'approved' ? 'settled' : 'rejected')
    : 'skipped';
  await writeLog(fsBase, key, logType, settlementResult.message || `Settled: ${status}`, {
    ...baseContext,
    completionId: completionId || '',
    processingMs,
  });

  console.log(`[postback] ✅ Done platform=${platformId} user=${userId} task=${taskId} final=${finalStatus} applied=${settlementResult.applied} ms=${processingMs}`);

  return res.status(200).json({
    received:     true,
    status:       finalStatus,
    applied:      settlementResult.applied,
    completionId: completionId || null,
    processingMs,
  });
}

// ── Settlement ────────────────────────────────────────────────────────────────
async function settleCompletion(
  fsBase, key,
  completionId, userId, reward, action,
  platformId, platformName, rejectReason
) {
  try {
    // Load current completion
    const compRes  = await fetch(`${fsBase}/taskCompletions/${completionId}${key}`);
    const compDoc  = await compRes.json();
    if (!compDoc.fields) return { applied: false, message: 'Completion document not found' };

    const currentStatus = compDoc.fields?.status?.stringValue;
    if (currentStatus !== 'pending') {
      return { applied: false, message: `Completion already settled: status=${currentStatus}` };
    }

    const rf = compDoc.fields?.reward;
    const settledReward = rf?.doubleValue ?? rf?.integerValue ?? reward;

    // Load current user
    const userRes  = await fetch(`${fsBase}/users/${userId}${key}`);
    const userDoc  = await userRes.json();
    if (!userDoc.fields) return { applied: false, message: 'User not found' };

    const balF    = userDoc.fields?.balance;
    const pendF   = userDoc.fields?.pendingBalance;
    const balance = balF?.doubleValue  ?? balF?.integerValue  ?? 0;
    const pending = pendF?.doubleValue ?? pendF?.integerValue ?? 0;

    const newPending = Math.max(0, pending - settledReward);
    const newBalance = action === 'approved' ? balance + settledReward : balance;

    const verifiedBy = `platform:${platformId}`;
    const walletTxId = generateId();
    const nowIso     = new Date().toISOString();

    // Write all three documents
    const writes = await Promise.allSettled([
      // Update taskCompletion
      patchDocument(fsBase, key, `taskCompletions/${completionId}`, {
        status:           { stringValue: action === 'approved' ? 'approved' : 'rejected' },
        settlementStatus: { stringValue: action },
        settlementDecision: { stringValue: action },
        verifiedBy:       { stringValue: action === 'approved' ? verifiedBy : null_v() },
        taskType:         { stringValue: 'platform' },
        taskPlatform:     { stringValue: platformName },
        settlementSource: { stringValue: 'postback' },
        settlementActorId:{ stringValue: platformId },
        settlementTxId:   { stringValue: walletTxId },
        settledAt:        { stringValue: nowIso },
        approvedAt:       action === 'approved' ? { stringValue: nowIso } : { nullValue: null },
        rejectedAt:       action === 'rejected' ? { stringValue: nowIso } : { nullValue: null },
        rejectedBy:       action === 'rejected' ? { stringValue: platformName } : { nullValue: null },
        rejectReason:     action === 'rejected' ? { stringValue: rejectReason || 'Rejected by platform' } : { nullValue: null },
      }),

      // Update user balance
      patchDocument(fsBase, key, `users/${userId}`, {
        balance:          { doubleValue: newBalance },
        pendingBalance:   { doubleValue: newPending },
        walletUpdatedAt:  { stringValue: nowIso },
      }),

      // Create wallet transaction
      patchDocument(fsBase, key, `walletTransactions/${walletTxId}`, {
        userId:          { stringValue: userId },
        completionId:    { stringValue: completionId },
        taskId:          { stringValue: compDoc.fields?.taskId?.stringValue || '' },
        taskTitle:       { stringValue: compDoc.fields?.taskTitle?.stringValue || '' },
        taskType:        { stringValue: 'platform' },
        amount:          { doubleValue: settledReward },
        status:          { stringValue: action === 'approved' ? 'approved' : 'rejected' },
        type:            { stringValue: action === 'approved' ? 'task_settlement_approved' : 'task_settlement_rejected' },
        source:          { stringValue: 'postback' },
        actorId:         { stringValue: platformId },
        actorName:       { stringValue: platformName },
        verifiedBy:      { stringValue: action === 'approved' ? verifiedBy : '' },
        duplicateGuard:  { stringValue: `${completionId}:${action}` },
        platformId:      { stringValue: platformId },
        platformName:    { stringValue: platformName },
        createdAt:       { stringValue: nowIso },
      }),
    ]);

    const failures = writes.filter(r => r.status === 'rejected').map(r => r.reason?.message);
    if (failures.length > 0) {
      console.warn('[postback] ⚠ Some settlement writes failed:', failures);
    }

    return { applied: true, message: `Settled as ${action}`, walletTxId };
  } catch (e) {
    console.error('[postback] ✖ Settlement error:', e.message);
    return { applied: false, message: `Settlement error: ${e.message}` };
  }
}

// ── Adjust user balance (for new completions without prior pending balance) ──
async function adjustUserBalance(fsBase, key, userId, balanceDelta, pendingDelta) {
  try {
    const userRes = await fetch(`${fsBase}/users/${userId}${key}`);
    const userDoc = await userRes.json();
    if (!userDoc.fields) return;

    const balF   = userDoc.fields?.balance;
    const pendF  = userDoc.fields?.pendingBalance;
    const bal    = balF?.doubleValue  ?? balF?.integerValue  ?? 0;
    const pend   = pendF?.doubleValue ?? pendF?.integerValue ?? 0;

    await patchDocument(fsBase, key, `users/${userId}`, {
      balance:         { doubleValue: Math.max(0, bal  + balanceDelta) },
      pendingBalance:  { doubleValue: Math.max(0, pend + pendingDelta) },
      walletUpdatedAt: { stringValue: new Date().toISOString() },
    });
  } catch (e) {
    console.warn('[postback] ⚠ adjustUserBalance failed:', e.message);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function timingSafeEqual(a, b) {
  try {
    const bufA = Buffer.from(String(a).padEnd(64));
    const bufB = Buffer.from(String(b).padEnd(64));
    return crypto.timingSafeEqual(bufA, bufB) && a.length === b.length;
  } catch {
    return false;
  }
}

function generateId() {
  return crypto.randomBytes(16).toString('hex');
}

function null_v() { return { nullValue: null }; }

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
      console.warn(`[postback] ⚠ PATCH ${path} returned ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.ok;
  } catch (e) {
    console.warn(`[postback] ⚠ PATCH ${path} error:`, e.message);
    return false;
  }
}

async function writeLog(fsBase, key, type, message, context) {
  const id = generateId();
  try {
    await fetch(`${fsBase}/postbackLogs${key}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        fields: {
          type:        { stringValue: type },
          message:     { stringValue: String(message).slice(0, 1000) },
          platformId:  { stringValue: context.platformId  || '' },
          userId:      { stringValue: context.userId      || '' },
          taskId:      { stringValue: context.taskId      || '' },
          convId:      { stringValue: context.convId      || '' },
          status:      { stringValue: context.status      || '' },
          amount:      { doubleValue: context.amount      || 0 },
          completionId:{ stringValue: context.completionId || '' },
          processingMs:{ integerValue: context.processingMs || 0 },
          receivedAt:  { stringValue: context.receivedAt  || new Date().toISOString() },
          createdAt:   { stringValue: new Date().toISOString() },
        },
      }),
    });
  } catch {
    // Log write failing must not break the postback response
  }
  return id;
}
