// server/postback/parser.ts
// Universal Postback Parser
//
// Responsibility: turn a raw key→value param map (from GET query string or
// POST body) into a single, fully-normalised ParsedConversion object.
//
// Flow:
//   raw params
//     → detectAdapter()   — which network sent this?
//     → extractFields()   — pull userId, taskId, convId, payout, status
//     → ParsedConversion  — canonical internal object
//
// No Firestore access.  No HTTP.  Pure data transformation.

import {
  ADAPTERS,
  UNIVERSAL_PARAMS,
  type NetworkAdapter,
  type DetectRule,
} from "./adapters";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedConversion {
  /** e.g. "cpagrip", "offertoro", "adgem", "unknown" */
  platformId: string;
  displayName: string;
  userId: string;
  taskId: string;
  /** External conversion / transaction identifier from the network. */
  convId: string;
  payout: number;
  /** Always "approved" or "rejected". */
  status: "approved" | "rejected";
  /** Original merged params kept for logging / debugging. */
  rawParams: Record<string, string>;
  /** The adapter that was matched, or null if none. */
  adapter: NetworkAdapter | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Detection
// ─────────────────────────────────────────────────────────────────────────────

function matchRule(rule: DetectRule, params: Record<string, string>): boolean {
  if (rule.hasParam !== undefined) {
    const v = params[rule.hasParam];
    if (!v || v.trim() === "") return false;
  }
  if (rule.paramEquals !== undefined) {
    if ((params[rule.paramEquals.name] || "").toLowerCase() !== rule.paramEquals.value.toLowerCase()) {
      return false;
    }
  }
  if (rule.paramMatches !== undefined) {
    const v = params[rule.paramMatches.name] || "";
    if (!rule.paramMatches.pattern.test(v)) return false;
  }
  return true;
}

/**
 * Return the first adapter whose detection heuristics match the params.
 * Returns null when no adapter matches (falls back to universal logic).
 */
export function detectAdapter(params: Record<string, string>): NetworkAdapter | null {
  // 1. Explicit platform param short-circuits the heuristics
  const explicitPlatform = (params.platform || params.network || "").toLowerCase().trim();
  if (explicitPlatform) {
    const byId = ADAPTERS.find((a) => a.id === explicitPlatform);
    if (byId) return byId;
  }

  // 2. Heuristic detection
  for (const adapter of ADAPTERS) {
    if (!adapter.detect) continue;
    // OR across groups
    for (const andGroup of adapter.detect) {
      // AND within group
      if (andGroup.every((rule) => matchRule(rule, params))) {
        return adapter;
      }
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Field extraction helpers
// ─────────────────────────────────────────────────────────────────────────────

function first(params: Record<string, string>, names: string[]): string {
  for (const name of names) {
    const v = params[name];
    if (v && v.trim() !== "") return v.trim();
  }
  return "";
}

function normaliseStatus(
  raw: string,
  statusMap?: Record<string, "approved" | "rejected">
): "approved" | "rejected" {
  const lower = raw.toLowerCase().trim();
  if (statusMap) {
    const mapped = statusMap[lower] ?? statusMap[raw];
    if (mapped) return mapped;
  }
  if (
    lower === "approved" ||
    lower === "complete" ||
    lower === "completed" ||
    lower === "success" ||
    lower === "1"
  ) {
    return "approved";
  }
  if (
    lower === "rejected" ||
    lower === "reject" ||
    lower === "chargeback" ||
    lower === "deny" ||
    lower === "0"
  ) {
    return "rejected";
  }
  // Default: treat unknown status as approved so we don't silently drop
  // conversions from networks whose status format we haven't mapped yet.
  return "approved";
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse raw postback params into a canonical ParsedConversion.
 *
 * Accepts both GET query-string params and POST body params (already merged
 * by the caller before this function is invoked).
 */
export function parsePostback(rawParams: Record<string, string>): ParsedConversion {
  const adapter = detectAdapter(rawParams);

  // ── userId + taskId ────────────────────────────────────────────────────────

  let userId = "";
  let taskId = "";

  // 1. Try the combined tracking_id field (CPAGrip style, or any adapter
  //    that packs both IDs into one param).
  const tidConfig = adapter?.trackingId;
  if (tidConfig) {
    const raw = rawParams[tidConfig.param] || "";
    const parts = raw.split(tidConfig.separator);
    userId = (parts[tidConfig.userIndex] || "").trim();
    taskId = (parts[tidConfig.taskIndex] || "").trim();
  }

  // 2. If the combined field didn't yield both values, fall back to individual
  //    param names — adapter-specific list first, then universal fallbacks.
  const userPriority = [...(adapter?.params?.userId ?? []), ...UNIVERSAL_PARAMS.userId];
  const taskPriority = [...(adapter?.params?.taskId ?? []), ...UNIVERSAL_PARAMS.taskId];

  if (!userId) userId = first(rawParams, userPriority);
  if (!taskId) taskId = first(rawParams, taskPriority);

  // 3. Backward-compatibility: s1 / s2 without a combined tracking_id
  //    (previous implementation used these directly)
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
  const statusRaw = first(rawParams, statusPriority) || "approved";
  const status = normaliseStatus(statusRaw, adapter?.statusMap);

  // ── platformId / displayName ───────────────────────────────────────────────
  const platformId = adapter?.id
    ?? (rawParams.platform || rawParams.network || "unknown").toLowerCase().trim();
  const displayName = adapter?.displayName
    ?? (rawParams.platform || rawParams.network || "Unknown Network");

  return {
    platformId,
    displayName,
    userId,
    taskId,
    convId,
    payout,
    status,
    rawParams,
    adapter: adapter ?? null,
  };
}
