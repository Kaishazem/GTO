// api/_modules/postbackAdapters.js
// Network adapter registry — pure config, no code changes to add new networks.
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Single source of truth for postback PARSING lives in:                 ║
// ║    src/lib/platforms.ts  (TypeScript, frontend + admin UI)             ║
// ║                                                                          ║
// ║  This JS file mirrors only the fields needed by the postback parser:    ║
// ║    id, displayName, detect, trackingId, params, statusMap              ║
// ║                                                                          ║
// ║  When adding a new network:                                              ║
// ║    1. Add PlatformConfig to src/lib/platforms.ts  (always)             ║
// ║    2. Add adapter here ONLY if the network uses non-standard field      ║
// ║       names or a combined tracking param. Networks that send            ║
// ║       ?platform=<id> with standard param names work without any entry. ║
// ╚══════════════════════════════════════════════════════════════════════════╝

export const ADAPTERS = [
  // ── CPAGrip ────────────────────────────────────────────────────────────────
  // trackingStrategy: combined (tracking_id=userId|taskId)
  {
    id: 'cpagrip',
    displayName: 'CPAGrip',
    detect: [
      [{ paramMatches: { name: 'tracking_id', pattern: /\|/ } }],
      [{ hasParam: 'tracking_id' }, { hasParam: 'offer_id' }],
      [{ paramEquals: { name: 'platform', value: 'cpagrip' } }],
    ],
    trackingId: { param: 'tracking_id', separator: '|', userIndex: 0, taskIndex: 1 },
    params: {
      convId:  ['offer_id', 'transaction_id', 'txid'],
      payout:  ['payout'],
      status:  ['status'],
    },
    statusMap: { '1': 'approved', '0': 'rejected', 'complete': 'approved', 'chargeback': 'rejected' },
  },

  // ── OGAds ─────────────────────────────────────────────────────────────────
  // trackingStrategy: separate (aff_sub=userId, aff_sub2=taskId)
  // Detected via fixed platform=ogads literal in postback URL.
  {
    id: 'ogads',
    displayName: 'OGAds',
    detect: [
      [{ paramEquals: { name: 'platform', value: 'ogads' } }],
    ],
    params: {
      userId: ['aff_sub'],
      taskId: ['aff_sub2'],
      convId: ['offer_id', 'transaction_id'],
      payout: ['payout'],
      status: ['status'],
    },
    statusMap: { '1': 'approved', '0': 'rejected', 'complete': 'approved', 'chargeback': 'rejected' },
  },

  // ── OfferToro ──────────────────────────────────────────────────────────────
  {
    id: 'offertoro',
    displayName: 'OfferToro',
    detect: [
      [{ paramEquals: { name: 'platform', value: 'offertoro' } }],
      [{ hasParam: 'aff_sub' }, { hasParam: 'aff_sub2' }],
    ],
    params: {
      userId: ['aff_sub'],
      taskId: ['aff_sub2', 'offer_id', 'campaign_id'],
      convId: ['transaction_id', 'txid'],
      payout: ['payout', 'revenue'],
    },
  },

  // ── AdGem ──────────────────────────────────────────────────────────────────
  {
    id: 'adgem',
    displayName: 'AdGem',
    detect: [
      [{ paramEquals: { name: 'platform', value: 'adgem' } }],
      [{ hasParam: 'player_id' }, { hasParam: 'offer_id' }],
    ],
    params: {
      userId: ['player_id', 'user_id'],
      taskId: ['offer_id', 'campaign_id'],
      convId: ['transaction_id', 'txid'],
      payout: ['payout', 'reward'],
    },
    statusMap: { '1': 'approved', '0': 'rejected' },
  },

  // ── Ayet Studios ───────────────────────────────────────────────────────────
  {
    id: 'ayetstudios',
    displayName: 'Ayet Studios',
    detect: [
      [{ paramEquals: { name: 'platform', value: 'ayetstudios' } }],
      [{ hasParam: 'subid' }, { hasParam: 'offer_id' }],
    ],
    params: {
      userId: ['subid', 'sub_id'],
      taskId: ['offer_id', 'campaign_id'],
      convId: ['transaction_id', 'tx_id'],
      payout: ['payout', 'amount'],
    },
  },

  // ── Lootably ───────────────────────────────────────────────────────────────
  {
    id: 'lootably',
    displayName: 'Lootably',
    detect: [
      [{ paramEquals: { name: 'platform', value: 'lootably' } }],
      [{ hasParam: 'uid' }, { hasParam: 'oid' }],
    ],
    params: {
      userId: ['uid', 'user_id'],
      taskId: ['oid', 'offer_id'],
      convId: ['cid', 'conv_id'],
      payout: ['payout', 'reward'],
    },
  },

  // ── RevU ───────────────────────────────────────────────────────────────────
  {
    id: 'revu',
    displayName: 'RevU',
    detect: [[{ paramEquals: { name: 'platform', value: 'revu' } }]],
    params: {
      userId: ['subid', 'user_id'],
      taskId: ['offer_id'],
      convId: ['transaction_id'],
      payout: ['amount', 'payout'],
    },
  },

  // ── Wannads ────────────────────────────────────────────────────────────────
  {
    id: 'wannads',
    displayName: 'Wannads',
    detect: [[{ paramEquals: { name: 'platform', value: 'wannads' } }]],
    params: {
      userId: ['subid', 'user_id'],
      taskId: ['offer_id', 'campaign_id'],
      convId: ['transaction_id', 'txid'],
      payout: ['payout', 'reward'],
    },
  },

  // ── TimeWall ───────────────────────────────────────────────────────────────
  {
    id: 'timewall',
    displayName: 'TimeWall',
    detect: [[{ paramEquals: { name: 'platform', value: 'timewall' } }]],
    params: {
      userId: ['uid', 'user_id', 'subid'],
      taskId: ['offer_id', 'oid'],
      convId: ['transaction_id', 'txid'],
      payout: ['amount', 'payout'],
    },
  },

  // ── Adscend Media ──────────────────────────────────────────────────────────
  {
    id: 'adscend',
    displayName: 'Adscend Media',
    detect: [
      [{ paramEquals: { name: 'platform', value: 'adscend' } }],
      [{ hasParam: 'subid1' }, { hasParam: 'subid2' }],
    ],
    params: {
      userId: ['subid1', 'subid'],
      taskId: ['subid2', 'offer_id', 'campaign_id'],
      convId: ['transaction_id', 'txid'],
      payout: ['payout', 'amount'],
    },
  },

  // ── MyLead ─────────────────────────────────────────────────────────────────
  // Tracking: ml_sub1=userId, ml_sub2=taskId (echoed from embed injection).
  // Payout: payout_decimal (float USD) preferred; payout (integer cents) fallback.
  //   Cents-to-dollar conversion and pending status are handled post-parse in
  //   api/postback.js (rawParams inspection) because they require logic beyond
  //   static statusMap/params config.
  // Status: approved|pre_approved→PAY; pending→RECORD only; rejected→no-pay;
  //   unknown/missing→fallback approved + warn (handled in postback.js).
  // convId: transaction_id primary; program_config_id + '_' + ml_sub1 fallback
  //   (computed in postback.js when transaction_id is absent).
  {
    id: 'mylead',
    displayName: 'MyLead',
    detect: [
      [{ paramEquals: { name: 'platform', value: 'mylead' } }],
      [{ hasParam: 'ml_sub1' }],
    ],
    params: {
      userId: ['ml_sub1', 'subid1', 'subid', 'aff_sub'],
      taskId: ['ml_sub2', 'subid2', 'offer_id', 'campaign_id'],
      convId: ['transaction_id'],
      payout: ['payout_decimal', 'payout'],
      status: ['status'],
    },
    statusMap: {
      'approved':     'approved',
      'pre_approved': 'approved',
      'rejected':     'rejected',
      '1':            'approved',
      '0':            'rejected',
    },
  },
];

export const UNIVERSAL_PARAMS = {
  userId: ['user_id', 'uid', 'userId', 'subid', 'sub_id', 'subid1', 's1', 'aff_sub', 'player_id', 'clickid', 'click_id', 'cid'],
  taskId: ['task_id', 'taskId', 'offer_id', 'campaign_id', 'subid2', 's2', 'aff_sub2', 'oid'],
  convId: ['transaction_id', 'txid', 'tid', 'conv_id', 'convId', 'cid', 'offer_id'],
  payout: ['payout', 'reward', 'amount', 'commission', 'revenue'],
  status: ['status'],
};
