// api/broadcast.js — Vercel Serverless Function: POST /api/broadcast
//
// Mirrors server/routes/broadcast.ts exactly for Vercel deployments.
// On Replit, Express handles this route via server/routes/broadcast.ts.
// On Vercel, this file is the serverless function that handles it instead.
//
// Identical behaviour, identical JSON response:
//   Success → { ok: true, msgId: "<firestoreDocId>" }
//   Error   → { ok: false, error: "<message>" }

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// ── Firebase Admin initialisation (lazy, idempotent) ──────────────────────────
// Uses the same three env vars as server/firebase-admin.ts and applies the
// same private-key normalisation so the function works with keys pasted as
// a single line (common when storing PEM keys in Vercel environment variables).
function getDb() {
  const projectId    = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
  const clientEmail  = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const rawKey       = process.env.FIREBASE_ADMIN_PRIVATE_KEY;

  if (!projectId || !clientEmail || !rawKey) {
    console.error('[broadcast] Missing Firebase Admin env vars — database unavailable.');
    return null;
  }

  // Normalise the private key: strip surrounding quotes, unescape \\n / \n,
  // and reformat single-line PEM keys into proper multi-line PEM format.
  let privateKey = rawKey
    .replace(/^["']|["']$/g, '')   // strip surrounding quotes if present
    .replace(/\\\\n/g, '\n')       // double-escaped \\n → real newline
    .replace(/\\n/g,   '\n')       // single-escaped \n  → real newline
    .replace(/\r\n/g,  '\n')       // CRLF → LF
    .trim();

  if (!privateKey.includes('\n')) {
    // Key was stored without real newlines — reconstruct proper PEM block
    const match = privateKey.match(/-----BEGIN ([^-]+)-----\s*([\s\S]+?)\s*-----END \1-----/);
    if (match) {
      const keyType = match[1];
      const base64  = match[2].replace(/\s+/g, '');
      const lines   = base64.match(/.{1,64}/g) ?? [];
      privateKey = `-----BEGIN ${keyType}-----\n${lines.join('\n')}\n-----END ${keyType}-----\n`;
      console.log('[broadcast] ℹ️  Private key reformatted from single-line PEM.');
    }
  }

  // initializeApp is idempotent across warm-start invocations of the same process
  if (!getApps().length) {
    try {
      initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId });
      console.log('[broadcast] ✅ Firebase Admin initialised — project:', projectId);
    } catch (err) {
      console.error('[broadcast] ❌ Firebase Admin init failed:', err.message);
      return null;
    }
  }

  return getFirestore();
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS — mirror the headers already set in vercel.json for /api/* routes
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // ── Initialise Firestore ───────────────────────────────────────────────────
  const db = getDb();
  if (!db) {
    return res.status(503).json({ ok: false, error: 'Server database not configured.' });
  }

  // ── Validate body ──────────────────────────────────────────────────────────
  const { title, message, sentBy } = req.body ?? {};

  if (!title?.trim() || !message?.trim()) {
    return res.status(400).json({ ok: false, error: 'title and message are required' });
  }

  // ── Write systemMessages document ──────────────────────────────────────────
  // Identical to the Express implementation in server/routes/broadcast.ts:
  // ONE doc is written; each connected client's NotificationContext onSnapshot
  // listener picks it up and calls createNotification() for that user locally.
  try {
    const msgRef = await db.collection('systemMessages').add({
      title:     title.trim(),
      message:   message.trim(),
      active:    true,
      createdAt: FieldValue.serverTimestamp(),
      sentBy:    sentBy || 'admin',
    });

    console.log(`[broadcast] ✅ systemMessages doc created — msgId=${msgRef.id}`);
    return res.status(200).json({ ok: true, msgId: msgRef.id });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[broadcast] ❌ Error writing systemMessages:', errMsg);
    return res.status(500).json({ ok: false, error: errMsg });
  }
}
