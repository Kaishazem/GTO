// server/postback/adapters.ts
// Network adapter registry.
//
// Each adapter is a pure config object — no code changes are needed to add a
// new network.  Simply add a new entry to ADAPTERS and deploy.
//
// Fields
// ──────
// id            Firestore / internal identifier.  Used as platformId when the
//               network is auto-detected.
// displayName   Human-readable label stored on conversion docs.
// detect        One or more heuristics that identify this network from raw
//               query params.  ALL checks in a single object must match (AND).
//               Multiple objects in the array are OR-ed together.
// trackingId    Config for the combined tracking_id field (CPAGrip style).
// params        Maps canonical field names to a priority list of raw param names.
//               The universal parser tries each name in order and uses the first
//               non-empty value.
// statusMap     Overrides for non-standard status values (e.g. "1" → "approved").

export interface DetectRule {
  /** A param that must be present (non-empty). */
  hasParam?: string;
  /** A param that must equal a specific value. */
  paramEquals?: { name: string; value: string };
  /** A param whose value matches a pattern (e.g. contains "|"). */
  paramMatches?: { name: string; pattern: RegExp };
}

export interface TrackingIdConfig {
  /** Raw param name that carries the combined value. */
  param: string;
  /** Character that separates userId from taskId inside the value. */
  separator: string;
  /** Index (0-based) of the userId part after splitting. */
  userIndex: number;
  /** Index (0-based) of the taskId part after splitting. */
  taskIndex: number;
}

export interface NetworkAdapter {
  id: string;
  displayName: string;
  /** Auto-detection heuristics (OR of AND-groups). */
  detect?: DetectRule[][];
  /** Combined-field config for networks that pack user+task into one param. */
  trackingId?: TrackingIdConfig;
  /** Per-field param-name priority lists.  Merged with universal fallbacks. */
  params?: {
    userId?: string[];
    taskId?: string[];
    convId?: string[];
    payout?: string[];
    status?: string[];
  };
  /** Map raw status values to canonical "approved" | "rejected". */
  statusMap?: Record<string, "approved" | "rejected">;
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

export const ADAPTERS: NetworkAdapter[] = [
  // ── CPAGrip ────────────────────────────────────────────────────────────────
  {
    id: "cpagrip",
    displayName: "CPAGrip",
    detect: [
      // Primary: tracking_id contains a "|" separator (userId|taskId)
      [{ paramMatches: { name: "tracking_id", pattern: /\|/ } }],
      // Secondary: tracking_id present + offer_id present (no separator yet)
      [{ hasParam: "tracking_id" }, { hasParam: "offer_id" }],
      // Tertiary: platform param explicitly set to "cpagrip"
      [{ paramEquals: { name: "platform", value: "cpagrip" } }],
    ],
    trackingId: {
      param: "tracking_id",
      separator: "|",
      userIndex: 0,
      taskIndex: 1,
    },
    params: {
      convId:  ["offer_id", "transaction_id", "txid"],
      payout:  ["payout"],
      status:  ["status"],
    },
    statusMap: {
      "1": "approved",
      "0": "rejected",
      "complete": "approved",
      "chargeback": "rejected",
    },
  },

  // ── OfferToro ──────────────────────────────────────────────────────────────
  {
    id: "offertoro",
    displayName: "OfferToro",
    detect: [
      [{ paramEquals: { name: "platform", value: "offertoro" } }],
      [{ hasParam: "aff_sub" }, { hasParam: "aff_sub2" }],
    ],
    params: {
      userId: ["aff_sub"],
      taskId: ["aff_sub2", "offer_id", "campaign_id"],
      convId: ["transaction_id", "txid"],
      payout: ["payout", "revenue"],
    },
  },

  // ── AdGem ──────────────────────────────────────────────────────────────────
  {
    id: "adgem",
    displayName: "AdGem",
    detect: [
      [{ paramEquals: { name: "platform", value: "adgem" } }],
      [{ hasParam: "player_id" }, { hasParam: "offer_id" }],
    ],
    params: {
      userId: ["player_id", "user_id"],
      taskId: ["offer_id", "campaign_id"],
      convId: ["transaction_id", "txid"],
      payout: ["payout", "reward"],
    },
    statusMap: {
      "1": "approved",
      "0": "rejected",
    },
  },

  // ── Ayet Studios ───────────────────────────────────────────────────────────
  {
    id: "ayetstudios",
    displayName: "Ayet Studios",
    detect: [
      [{ paramEquals: { name: "platform", value: "ayetstudios" } }],
      [{ hasParam: "subid" }, { hasParam: "offer_id" }],
    ],
    params: {
      userId: ["subid", "sub_id"],
      taskId: ["offer_id", "campaign_id"],
      convId: ["transaction_id", "tx_id"],
      payout: ["payout", "amount"],
    },
  },

  // ── Lootably ───────────────────────────────────────────────────────────────
  {
    id: "lootably",
    displayName: "Lootably",
    detect: [
      [{ paramEquals: { name: "platform", value: "lootably" } }],
      [{ hasParam: "uid" }, { hasParam: "oid" }],
    ],
    params: {
      userId: ["uid", "user_id"],
      taskId: ["oid", "offer_id"],
      convId: ["cid", "conv_id"],
      payout: ["payout", "reward"],
    },
  },

  // ── RevU ───────────────────────────────────────────────────────────────────
  {
    id: "revu",
    displayName: "RevU",
    detect: [
      [{ paramEquals: { name: "platform", value: "revu" } }],
    ],
    params: {
      userId: ["subid", "user_id"],
      taskId: ["offer_id"],
      convId: ["transaction_id"],
      payout: ["amount", "payout"],
    },
  },

  // ── Wannads ────────────────────────────────────────────────────────────────
  {
    id: "wannads",
    displayName: "Wannads",
    detect: [
      [{ paramEquals: { name: "platform", value: "wannads" } }],
    ],
    params: {
      userId: ["subid", "user_id"],
      taskId: ["offer_id", "campaign_id"],
      convId: ["transaction_id", "txid"],
      payout: ["payout", "reward"],
    },
  },

  // ── TimeWall ───────────────────────────────────────────────────────────────
  {
    id: "timewall",
    displayName: "TimeWall",
    detect: [
      [{ paramEquals: { name: "platform", value: "timewall" } }],
    ],
    params: {
      userId: ["uid", "user_id", "subid"],
      taskId: ["offer_id", "oid"],
      convId: ["transaction_id", "txid"],
      payout: ["amount", "payout"],
    },
  },

  // ── Adscend Media ──────────────────────────────────────────────────────────
  {
    id: "adscend",
    displayName: "Adscend Media",
    detect: [
      [{ paramEquals: { name: "platform", value: "adscend" } }],
      [{ hasParam: "subid1" }, { hasParam: "subid2" }],
    ],
    params: {
      userId: ["subid1", "subid"],
      taskId: ["subid2", "offer_id", "campaign_id"],
      convId: ["transaction_id", "txid"],
      payout: ["payout", "amount"],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Universal fallback chains — used when no network-specific override exists
// ─────────────────────────────────────────────────────────────────────────────

export const UNIVERSAL_PARAMS = {
  userId: [
    "user_id", "uid", "userId",
    "subid", "sub_id", "subid1",
    "s1", "aff_sub", "player_id",
    "clickid", "click_id", "cid",
  ],
  taskId: [
    "task_id", "taskId",
    "offer_id", "campaign_id",
    "subid2", "s2", "aff_sub2",
    "oid",
  ],
  convId: [
    "transaction_id", "txid", "tid",
    "conv_id", "convId", "cid",
    "offer_id",
  ],
  payout: [
    "payout", "reward", "amount",
    "commission", "revenue",
  ],
  status: [
    "status",
  ],
};
