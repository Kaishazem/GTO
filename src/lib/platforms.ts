// src/lib/platforms.ts
// ═══════════════════════════════════════════════════════════════════════════
// THE canonical platform registry — the single source of truth for every
// offer network supported by Green Task Orbit.
//
// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Adding a new offer network — 1-file change only                   ║
// ║                                                                      ║
// ║  1. Add ONE PlatformConfig object to PLATFORM_REGISTRY below.       ║
// ║  2. (Optional) If the network uses non-standard param names not      ║
// ║     covered by UNIVERSAL_PARAMS in api/_modules/postbackAdapters.js,║
// ║     also add an adapter entry there.                                 ║
// ║     Networks that send ?platform=<id> in the postback URL AND use    ║
// ║     standard field names (user_id, offer_id, payout …) work out of  ║
// ║     the box with zero additional changes.                            ║
// ╚══════════════════════════════════════════════════════════════════════╝
//
// This file drives:
//   • Offer URL tracking params  →  buildTrackingUrl()  (TasksPage)
//   • Postback URL display       →  AdminPage Import tab (auto-rendered)
//   • Platform form presets      →  AdminPage Platforms tab (auto-fill)
// ═══════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How a network receives user + task IDs inside the offer click URL.
 *
 * "combined"  — both IDs packed into one param separated by a delimiter.
 *               e.g. CPAGrip: tracking_id=userId|taskId
 *
 * "separate"  — two distinct params, one per ID.
 *               e.g. OGAds: aff_sub=userId & aff_sub2=taskId
 */
export type TrackingStrategy =
  | {
      type: "combined";
      /** Param name that carries userId + taskId joined by separator */
      param: string;
      /** Separator character, typically "|" */
      separator: string;
    }
  | {
      type: "separate";
      /** Param name for the user ID */
      userParam: string;
      /** Param name for the task ID */
      taskParam: string;
    };

/** Available accent colour tokens (maps to Tailwind colour scale) */
export type AccentColor = "emerald" | "blue" | "violet" | "amber" | "rose" | "cyan";

/** Complete per-network platform configuration */
export interface PlatformConfig {
  /** Internal identifier — MUST match the platformId stored on tasks in Firestore */
  id: string;
  displayName: string;

  // ── Offer URL generation ─────────────────────────────────────────────────
  /** Determines which query params are appended to the offer URL */
  trackingStrategy: TrackingStrategy;

  // ── Admin postback display ───────────────────────────────────────────────
  /**
   * Query-string portion of the postback URL shown to admins.
   * Uses {macro} notation — the full URL is postbackBaseUrl + postbackTemplate.
   * Example: "?tracking_id={tracking_id}&offer_id={offer_id}&payout={payout}&password={password}"
   */
  postbackTemplate: string;
  /** Accent colour used for this network's postback block heading */
  accentColor: AccentColor;
  /** "Network → Setting Name" text that tells admins where to paste the URL */
  postbackSetupHint: string;
  /** Optional footnote — use for non-obvious macros or fixed literals */
  postbackNote?: string;

  // ── Admin form presets ───────────────────────────────────────────────────
  /**
   * Default values auto-filled when the admin clicks this network's preset
   * button in the "Add Platform" form. Only supply known/stable values.
   */
  apiDefaults?: {
    apiBase?: string;
    authType?: "bearer" | "apiKeyHeader" | "queryParam" | "basicAuth";
    apiKeyParam?: string;
    apiKeyHeaderName?: string;
    endpoint?: string;
    responsePath?: string;
    /** Field mapping in "targetField: sourceField\n" format (one per line) */
    fieldMapping?: string;
    requestMethod?: "GET" | "POST";
    queryParams?: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tailwind class lookups (full strings required for JIT purge safety)
// ─────────────────────────────────────────────────────────────────────────────

export const PLATFORM_ACCENT_ICON: Record<AccentColor, string> = {
  emerald: "text-emerald-400",
  blue:    "text-blue-400",
  violet:  "text-violet-400",
  amber:   "text-amber-400",
  rose:    "text-rose-400",
  cyan:    "text-cyan-400",
};

export const PLATFORM_ACCENT_TEXT: Record<AccentColor, string> = {
  emerald: "text-emerald-300",
  blue:    "text-blue-300",
  violet:  "text-violet-300",
  amber:   "text-amber-300",
  rose:    "text-rose-300",
  cyan:    "text-cyan-300",
};

// ─────────────────────────────────────────────────────────────────────────────
// Registry — ONE entry per network
//
// Mirror the detect/params/statusMap fields in api/_modules/postbackAdapters.js
// for networks that need custom postback parsing beyond the universal fallbacks.
// ─────────────────────────────────────────────────────────────────────────────

export const PLATFORM_REGISTRY: PlatformConfig[] = [
  // ── CPAGrip ────────────────────────────────────────────────────────────────
  // Postback parser: server uses tracking_id combined field (see postbackAdapters.js).
  {
    id: "cpagrip",
    displayName: "CPAGrip",
    trackingStrategy: {
      type: "combined",
      param: "tracking_id",
      separator: "|",
    },
    postbackTemplate:
      "?tracking_id={tracking_id}&offer_id={offer_id}&payout={payout}&password={password}",
    accentColor: "emerald",
    postbackSetupHint: "CPAGrip → Publisher Tools → Global Postback URL",
    postbackNote:
      "{tracking_id} is automatically sent by CPAGrip — it carries the userId|taskId you embedded in the offer URL.",
  },

  // ── OGAds ─────────────────────────────────────────────────────────────────
  // Postback parser: uses separate aff_sub / aff_sub2 (see postbackAdapters.js).
  {
    id: "ogads",
    displayName: "OGAds",
    trackingStrategy: {
      type: "separate",
      userParam: "aff_sub",
      taskParam: "aff_sub2",
    },
    postbackTemplate:
      "?aff_sub={aff_sub}&aff_sub2={aff_sub2}&offer_id={offer_id}&payout={payout}&password={password}&platform=ogads",
    accentColor: "blue",
    postbackSetupHint: "OGAds → Tools → Postback URL",
    postbackNote:
      "platform=ogads is a fixed literal in this URL — do not replace it with a macro.",
    apiDefaults: {
      apiBase: "https://saveapp.store/api/v2",
      // OGAds API v2: the base URL IS the endpoint — no sub-path is appended.
      // /offers, /feed, and all other sub-paths return 404.
      // Leave endpoint empty so the request goes directly to the base URL.
      endpoint: "",
      authType: "bearer",
      responsePath: "offers",
      fieldMapping:
        "id: offer_id\ntitle: name\npayout: payout\nurl: tracking_url\ndescription: description",
    },
  },

  // ── OfferToro ──────────────────────────────────────────────────────────────
  {
    id: "offertoro",
    displayName: "OfferToro",
    trackingStrategy: { type: "separate", userParam: "aff_sub", taskParam: "aff_sub2" },
    postbackTemplate:
      "?aff_sub={aff_sub}&aff_sub2={aff_sub2}&offer_id={offer_id}&payout={payout}&password={password}&platform=offertoro",
    accentColor: "violet",
    postbackSetupHint: "OfferToro → Account → Postback URL",
    postbackNote: "platform=offertoro is a fixed literal.",
  },

  // ── AdGem ──────────────────────────────────────────────────────────────────
  {
    id: "adgem",
    displayName: "AdGem",
    trackingStrategy: { type: "separate", userParam: "player_id", taskParam: "offer_id" },
    postbackTemplate:
      "?player_id={player_id}&offer_id={offer_id}&payout={payout}&password={password}&platform=adgem",
    accentColor: "amber",
    postbackSetupHint: "AdGem → Developer → Postback URL",
    postbackNote: "platform=adgem is a fixed literal.",
  },

  // ── Ayet Studios ───────────────────────────────────────────────────────────
  {
    id: "ayetstudios",
    displayName: "Ayet Studios",
    trackingStrategy: { type: "separate", userParam: "subid", taskParam: "offer_id" },
    postbackTemplate:
      "?subid={subid}&offer_id={offer_id}&payout={payout}&password={password}&platform=ayetstudios",
    accentColor: "rose",
    postbackSetupHint: "Ayet Studios → Manage → Postback URL",
    postbackNote: "platform=ayetstudios is a fixed literal.",
  },

  // ── Lootably ───────────────────────────────────────────────────────────────
  {
    id: "lootably",
    displayName: "Lootably",
    trackingStrategy: { type: "separate", userParam: "uid", taskParam: "oid" },
    postbackTemplate:
      "?uid={uid}&oid={oid}&payout={payout}&password={password}&platform=lootably",
    accentColor: "cyan",
    postbackSetupHint: "Lootably → Integration → Postback URL",
    postbackNote: "platform=lootably is a fixed literal.",
  },

  // ── RevU ───────────────────────────────────────────────────────────────────
  {
    id: "revu",
    displayName: "RevU",
    trackingStrategy: { type: "separate", userParam: "subid", taskParam: "offer_id" },
    postbackTemplate:
      "?subid={subid}&offer_id={offer_id}&amount={amount}&password={password}&platform=revu",
    accentColor: "emerald",
    postbackSetupHint: "RevU → Publisher → Postback URL",
    postbackNote: "platform=revu is a fixed literal.",
  },

  // ── Wannads ────────────────────────────────────────────────────────────────
  {
    id: "wannads",
    displayName: "Wannads",
    trackingStrategy: { type: "separate", userParam: "subid", taskParam: "offer_id" },
    postbackTemplate:
      "?subid={subid}&offer_id={offer_id}&payout={payout}&password={password}&platform=wannads",
    accentColor: "violet",
    postbackSetupHint: "Wannads → Account → Postback URL",
    postbackNote: "platform=wannads is a fixed literal.",
  },

  // ── TimeWall ───────────────────────────────────────────────────────────────
  {
    id: "timewall",
    displayName: "TimeWall",
    trackingStrategy: { type: "separate", userParam: "uid", taskParam: "offer_id" },
    postbackTemplate:
      "?uid={uid}&offer_id={offer_id}&amount={amount}&password={password}&platform=timewall",
    accentColor: "amber",
    postbackSetupHint: "TimeWall → Settings → Postback URL",
    postbackNote: "platform=timewall is a fixed literal.",
  },

  // ── Adscend Media ──────────────────────────────────────────────────────────
  {
    id: "adscend",
    displayName: "Adscend Media",
    trackingStrategy: { type: "separate", userParam: "subid1", taskParam: "subid2" },
    postbackTemplate:
      "?subid1={subid1}&subid2={subid2}&offer_id={offer_id}&payout={payout}&password={password}&platform=adscend",
    accentColor: "rose",
    postbackSetupHint: "Adscend Media → Publisher → Postback URL",
    postbackNote: "platform=adscend is a fixed literal.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Look up a platform config by id (case-insensitive). */
export function getPlatformConfig(platformId: string | undefined): PlatformConfig | undefined {
  if (!platformId) return undefined;
  return PLATFORM_REGISTRY.find((p) => p.id === platformId.toLowerCase().trim());
}

/**
 * Append the correct tracking parameters to a raw offer URL.
 *
 * Uses the platform's trackingStrategy from PLATFORM_REGISTRY.
 * Falls back to CPAGrip-style `tracking_id=userId|taskId` for unknown
 * platforms, preserving backward compatibility with legacy tasks.
 */
export function buildTrackingUrl(
  rawUrl: string,
  taskId: string,
  userId: string,
  platformId?: string,
): string {
  if (!rawUrl || !userId) return rawUrl;
  try {
    const u = new URL(rawUrl);
    const config = getPlatformConfig(platformId);
    const strategy: TrackingStrategy = config?.trackingStrategy ?? {
      type: "combined",
      param: "tracking_id",
      separator: "|",
    };
    if (strategy.type === "combined") {
      u.searchParams.set(strategy.param, `${userId}${strategy.separator}${taskId}`);
    } else {
      u.searchParams.set(strategy.userParam, userId);
      u.searchParams.set(strategy.taskParam, taskId);
    }
    return u.toString();
  } catch {
    return rawUrl;
  }
}
