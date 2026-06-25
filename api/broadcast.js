// api/broadcast.js — Vercel Serverless Function: POST /api/broadcast
//
// Mirrors server/routes/broadcast.ts exactly for Vercel deployments.
// On Replit, Express handles this route via server/routes/broadcast.ts.
// On Vercel, this file is the serverless function that handles it instead.
//
// Identical behaviour, identical JSON response:
//   Success → { ok: true, msgId: "<firestoreDocId>" }
//   Error   → { ok: false, error: "<message>" }

import admin from 'firebase-admin';

// ── Firebase Admin initialisation (lazy, idempotent) ──────────────────────────
// Called on every request; safe across warm-start invocations because
// admin.apps.length check prevents double-initialisation.
// Each missing/failing credential is logged individually so Vercel function
// logs show the EXACT failure point rather than a generic "not configured" line.
function getDb() {
  // ── 1. Read credentials ──────────────────────────────────────────────────
  const projectId   = process.env.FIREBASE_PROJECT_ID
                   || process.env.VITE_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const rawKey      = process.env.FIREBASE_ADMIN_PRIVATE_KEY;

  // Log exactly which vars are present so Vercel logs give actionable info
  console.log('[broadcast] env check —'
    + ` projectId=${projectId ? '✅' : '❌ MISSING'}`
    + ` clientEmail=${clientEmail ? '✅' : '❌ MISSING'}`
    + ` privateKey=${rawKey ? '✅' : '❌ MISSING'}`
  );

  if (!projectId)   return { db: null, missing: 'FIREBASE_PROJECT_ID (or VITE_FIREBASE_PROJECT_ID)' };
  if (!clientEmail) return { db: null, missing: 'FIREBASE_ADMIN_CLIENT_EMAIL' };
  if (!rawKey)      return { db: null, missing: 'FIREBASE_ADMIN_PRIVATE_KEY' };

  // ── 2. Normalise the private key ─────────────────────────────────────────
  // Vercel stores env vars as single-line strings. The PEM key must have real
  // newlines to be parsed by the crypto library. Apply the same normalisation
  // logic as server/firebase-admin.ts so both environments behave identically.
  let privateKey = rawKey
    .replace(/^["']|["']$/g, '')   // strip surrounding quotes if any
    .replace(/\\\\n/g, '\n')       // double-escaped  \\n  → real newline
    .replace(/\\n/g,   '\n')       // single-escaped   \n  → real newline
    .replace(/\r\n/g,  '\n')       // CRLF → LF
    .trim();

  if (!privateKey.includes('\n')) {
    // Key arrived as a single line — reconstruct proper PEM block
    const m = privateKey.match(/-----BEGIN ([^-]+)-----\s*([\s\S]+?)\s*-----END \1-----/);
    if (m) {
      const keyType = m[1];
      const b64     = m[2].replace(/\s+/g, '');
      const lines   = b64.match(/.{1,64}/g) ?? [];
      privateKey = `-----BEGIN ${keyType}-----\n${lines.join('\n')}\n-----END ${keyType}-----\n`;
      console.log('[broadcast] ℹ️  Private key reformatted from single-line PEM.');
    } else {
      console.error('[broadcast] ❌ Private key could not be parsed — check FIREBASE_ADMIN_PRIVATE_KEY format.');
      return { db: null, missing: 'FIREBASE_ADMIN_PRIVATE_KEY (invalid PEM format)' };
    }
  }

  // ── 3. Initialise Firebase Admin (once per container) ───────────────────
  if (!admin.apps.length) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
        projectId,
      });
      console.log('[broadcast] ✅ Firebase Admin initialised — project:', projectId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[broadcast] ❌ Firebase Admin initializeApp() threw:', msg);
      return { db: null, missing: null, initError: msg };
    }
  }

  // ── 4. Return Firestore instance ─────────────────────────────────────────
  try {
    return { db: admin.firestore(), missing: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[broadcast] ❌ admin.firestore() threw:', msg);
    return { db: null, missing: null, initError: msg };
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS headers — mirrors vercel.json /api/* headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // ── Initialise Firestore ───────────────────────────────────────────────────
  const { db, missing, initError } = getDb();

  if (!db) {
    // Return a specific error so the client / Vercel logs show what to fix
    if (missing) {
      const msg = `Server database not configured — missing env var: ${missing}`;
      console.error(`[broadcast] 503 →`, msg);
      return res.status(503).json({ ok: false, error: msg });
    }
    const msg = `Server database not configured — init error: ${initError}`;
    console.error(`[broadcast] 503 →`, msg);
    return res.status(503).json({ ok: false, error: msg });
  }

  // ── Validate body ──────────────────────────────────────────────────────────
  const { title, message, sentBy } = req.body ?? {};

  if (!title?.trim() || !message?.trim()) {
    return res.status(400).json({ ok: false, error: 'title and message are required' });
  }

  // ── Write systemMessages document ──────────────────────────────────────────
  // Identical to the Express implementation in server/routes/broadcast.ts.
  // ONE document is written; every connected client's NotificationContext
  // onSnapshot listener picks it up and calls createNotification() for that user.
  try {
    const msgRef = await db.collection('systemMessages').add({
      title:     title.trim(),
      message:   message.trim(),
      active:    true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      sentBy:    sentBy || 'admin',
    });

    console.log(`[broadcast] ✅ systemMessages doc created — msgId=${msgRef.id}`);
    return res.status(200).json({ ok: true, msgId: msgRef.id });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[broadcast] ❌ Firestore write failed:', errMsg);
    return res.status(500).json({ ok: false, error: errMsg });
  }
}
