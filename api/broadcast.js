// api/broadcast.js — Vercel Serverless Function: POST /api/broadcast
//
// Mirrors server/routes/broadcast.ts exactly for Vercel deployments.
// On Replit, Express handles this route via server/routes/broadcast.ts.
// On Vercel, this file is the serverless function that handles it instead.
//
// Credential env-var naming accepted (either convention works):
//   Replit:  FIREBASE_ADMIN_CLIENT_EMAIL  / FIREBASE_ADMIN_PRIVATE_KEY
//   Vercel:  FIREBASE_CLIENT_EMAIL        / FIREBASE_PRIVATE_KEY
//   Project: FIREBASE_PROJECT_ID          / VITE_FIREBASE_PROJECT_ID
//
// Identical response to Express:
//   Success → { ok: true,  msgId: "<firestoreDocId>" }
//   Error   → { ok: false, error: "<message>" }

import admin from 'firebase-admin';

// ── Credential resolution (supports both naming conventions) ──────────────────
const projectId   = process.env.FIREBASE_PROJECT_ID
                 || process.env.VITE_FIREBASE_PROJECT_ID;

const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL
                 || process.env.FIREBASE_CLIENT_EMAIL;

const rawKey      = process.env.FIREBASE_ADMIN_PRIVATE_KEY
                 || process.env.FIREBASE_PRIVATE_KEY;

// ── Private-key normalisation ─────────────────────────────────────────────────
// Vercel and Replit both store env vars as single-line strings.  PEM keys need
// real newlines to be parsed by Node's crypto layer.  Apply the same logic as
// server/firebase-admin.ts so both environments behave identically.
function normaliseKey(raw) {
  if (!raw) return null;

  let key = raw
    .replace(/^["']|["']$/g, '')   // strip surrounding quotes
    .replace(/\\\\n/g, '\n')       // double-escaped  \\n  → newline
    .replace(/\\n/g,   '\n')       // single-escaped   \n  → newline
    .replace(/\r\n/g,  '\n')       // CRLF → LF
    .trim();

  if (!key.includes('\n')) {
    // Reconstruct multi-line PEM from a key stored without real newlines
    const m = key.match(/-----BEGIN ([^-]+)-----\s*([\s\S]+?)\s*-----END \1-----/);
    if (m) {
      const body  = m[2].replace(/\s+/g, '');
      const lines = body.match(/.{1,64}/g) ?? [];
      key = `-----BEGIN ${m[1]}-----\n${lines.join('\n')}\n-----END ${m[1]}-----\n`;
      console.log('[broadcast] ℹ️  Private key reformatted from single-line PEM.');
    } else {
      console.error('[broadcast] ❌ FIREBASE_ADMIN_PRIVATE_KEY / FIREBASE_PRIVATE_KEY is not valid PEM.');
      return null;
    }
  }

  return key;
}

const privateKey = normaliseKey(rawKey);

// ── Module-level Firebase Admin initialisation ────────────────────────────────
// Runs once per cold-start container; no-ops on warm-start re-use.
// Kept at module level (not inside the handler) so the cost is paid only once.
let db = null;
let initError = null;

console.log('[broadcast] env check —'
  + ` projectId=${projectId   ? '✅' : '❌ MISSING'}`
  + ` clientEmail=${clientEmail ? '✅' : '❌ MISSING'}`
  + ` privateKey=${rawKey     ? '✅' : '❌ MISSING'}`
);

if (!projectId || !clientEmail || !privateKey) {
  // Record which variables are absent — surfaced in the 503 body later
  const missing = [
    !projectId   && 'FIREBASE_PROJECT_ID (or VITE_FIREBASE_PROJECT_ID)',
    !clientEmail && 'FIREBASE_ADMIN_CLIENT_EMAIL (or FIREBASE_CLIENT_EMAIL)',
    !privateKey  && 'FIREBASE_ADMIN_PRIVATE_KEY (or FIREBASE_PRIVATE_KEY)',
  ].filter(Boolean);
  initError = `Missing env vars: ${missing.join(', ')}`;
  console.error('[broadcast] ❌', initError);
} else if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      projectId,
    });
    db = admin.firestore();
    console.log('[broadcast] ✅ Firebase Admin initialised — project:', projectId);
  } catch (err) {
    initError = err instanceof Error ? err.message : String(err);
    console.error('[broadcast] ❌ initializeApp() failed:', initError);
  }
} else {
  // Warm-start: app already initialised in this container
  db = admin.firestore();
  console.log('[broadcast] ♻️  Reusing existing Firebase Admin app.');
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // ── Guard: credentials must be available ────────────────────────────────────
  if (!db) {
    console.error('[broadcast] 503 — db not ready:', initError);
    return res.status(503).json({
      ok: false,
      error: initError || 'Server database not configured.',
      // Checklist in response body speeds up diagnosis in the network tab
      checked: {
        FIREBASE_PROJECT_ID:          !!process.env.FIREBASE_PROJECT_ID,
        VITE_FIREBASE_PROJECT_ID:     !!process.env.VITE_FIREBASE_PROJECT_ID,
        FIREBASE_ADMIN_CLIENT_EMAIL:  !!process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        FIREBASE_CLIENT_EMAIL:        !!process.env.FIREBASE_CLIENT_EMAIL,
        FIREBASE_ADMIN_PRIVATE_KEY:   !!process.env.FIREBASE_ADMIN_PRIVATE_KEY,
        FIREBASE_PRIVATE_KEY:         !!process.env.FIREBASE_PRIVATE_KEY,
      },
    });
  }

  // ── Validate body ────────────────────────────────────────────────────────────
  const { title, message, sentBy } = req.body ?? {};

  if (!title?.trim() || !message?.trim()) {
    return res.status(400).json({ ok: false, error: 'title and message are required' });
  }

  // ── Write systemMessages document ────────────────────────────────────────────
  // ONE document written; every connected client's NotificationContext
  // onSnapshot listener picks it up and calls createNotification() locally.
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
