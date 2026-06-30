// api/_modules/postbackParser.js
// Universal Postback Parser — JavaScript mirror of server/postback/parser.ts
// Pure data transformation, no HTTP, no Firestore.

import { ADAPTERS, UNIVERSAL_PARAMS } from './postbackAdapters.js';

// ─────────────────────────────────────────────────────────────────────────────
// Detection
// ─────────────────────────────────────────────────────────────────────────────

function matchRule(rule, params) {
  if (rule.hasParam !== undefined) {
    const v = params[rule.hasParam];
    if (!v || v.trim() === '') return false;
  }
  if (rule.paramEquals !== undefined) {
    if ((params[rule.paramEquals.name] || '').toLowerCase() !== rule.paramEquals.value.toLowerCase()) {
      return false;
    }
  }
  if (rule.paramMatches !== undefined) {
    const v = params[rule.paramMatches.name] || '';
    if (!rule.paramMatches.pattern.test(v)) return false;
  }
  return true;
}

export function detectAdapter(params) {
  // Explicit platform param short-circuits heuristics
  const explicit = (params.platform || params.network || '').toLowerCase().trim();
  if (explicit) {
    const byId = ADAPTERS.find(a => a.id === explicit);
    if (byId) return byId;
  }

  for (const adapter of ADAPTERS) {
    if (!adapter.detect) continue;
    for (const andGroup of adapter.detect) {
      if (andGroup.every(rule => matchRule(rule, params))) return adapter;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Field extraction
// ─────────────────────────────────────────────────────────────────────────────

function first(params, names) {
  for (const name of names) {
    const v = params[name];
    if (v && v.trim() !== '') return v.trim();
  }
  return '';
}

function normaliseStatus(raw, statusMap) {
  const lower = (raw || '').toLowerCase().trim();
  if (statusMap) {
    const mapped = statusMap[lower] ?? statusMap[raw];
    if (mapped) return mapped;
  }
  if (['approved', 'complete', 'completed', 'success', '1'].includes(lower)) return 'approved';
  if (['rejected', 'reject', 'chargeback', 'deny', '0'].includes(lower)) return 'rejected';
  return 'approved'; // default: treat unknown as approved
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse raw postback params into a canonical conversion object.
 * @param {Record<string, string>} rawParams  Merged GET query + POST body.
 * @returns {{ platformId, displayName, userId, taskId, convId, payout, status, rawParams, adapter }}
 */
export function parsePostback(rawParams) {
  const adapter = detectAdapter(rawParams);

  // ── userId + taskId ────────────────────────────────────────────────────────
  let userId = '';
  let taskId = '';

  const tidConfig = adapter?.trackingId;
  if (tidConfig) {
    const raw = rawParams[tidConfig.param] || '';
    const parts = raw.split(tidConfig.separator);
    userId = (parts[tidConfig.userIndex] || '').trim();
    taskId = (parts[tidConfig.taskIndex] || '').trim();
  }

  const userPriority = [...(adapter?.params?.userId ?? []), ...UNIVERSAL_PARAMS.userId];
  const taskPriority = [...(adapter?.params?.taskId ?? []), ...UNIVERSAL_PARAMS.taskId];

  if (!userId) userId = first(rawParams, userPriority);
  if (!taskId) taskId = first(rawParams, taskPriority);

  // Backward compatibility: s1/s2 without combined tracking_id
  if (!userId && rawParams.s1) userId = rawParams.s1.trim();
  if (!taskId && rawParams.s2) taskId = rawParams.s2.trim();

  // ── convId ─────────────────────────────────────────────────────────────────
  const convPriority = [...(adapter?.params?.convId ?? []), ...UNIVERSAL_PARAMS.convId];
  const convId = first(rawParams, convPriority);

  // ── payout ─────────────────────────────────────────────────────────────────
  const payoutPriority = [...(adapter?.params?.payout ?? []), ...UNIVERSAL_PARAMS.payout];
  const payoutRaw = first(rawParams, payoutPriority);
  const payout = Math.max(0, parseFloat(payoutRaw) || 0);

  // ── status ─────────────────────────────────────────────────────────────────
  const statusPriority = [...(adapter?.params?.status ?? []), ...UNIVERSAL_PARAMS.status];
  const statusRaw = first(rawParams, statusPriority) || 'approved';
  const status = normaliseStatus(statusRaw, adapter?.statusMap);

  // ── platformId / displayName ───────────────────────────────────────────────
  const platformId = adapter?.id
    ?? (rawParams.platform || rawParams.network || 'unknown').toLowerCase().trim();
  const displayName = adapter?.displayName
    ?? (rawParams.platform || rawParams.network || 'Unknown Network');

  return { platformId, displayName, userId, taskId, convId, payout, status, rawParams, adapter: adapter ?? null };
}
