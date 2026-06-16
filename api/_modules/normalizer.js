// modules/normalizer.js — Universal offer normalizer (v2)
// Single responsibility: map raw platform offer objects to the canonical Task
// model used by Firestore and the frontend.
// All field names come from offerMapping config. Missing fields produce warnings,
// never errors. Every platform produces identical Task objects.
//
// Canonical Task fields:
//   externalId, title, description, payout, url, image,
//   category, countries, devices, platform, platformId,
//   requirements, trackingUrl, previewUrl, conversionType,
//   status, createdAt, _raw

// Default mapping: canonical field → raw field path (dot-separated)
const DEFAULT_MAPPING = {
  id:             'id',
  title:          'name',
  description:    'description',
  payout:         'payout',
  url:            'url',
  image:          'image',
  category:       'category',
  countries:      'countries',
  devices:        'devices',
  requirements:   'requirements',
  trackingUrl:    'tracking_url',
  previewUrl:     'preview_url',
  conversionType: 'conversion_type',
};

// Fallback chains: if the mapped path is missing, try these alternatives
const FALLBACK_CHAINS = {
  id:             ['id', 'offer_id', 'offerId', 'campaign_id'],
  title:          ['name', 'title', 'offer_name', 'campaign_name', 'label'],
  description:    ['description', 'desc', 'requirements', 'details', 'short_description'],
  payout:         ['payout', 'reward', 'amount', 'cpa', 'commission', 'price'],
  url:            ['url', 'link', 'offer_url', 'offerlink', 'tracking_link', 'click_url'],
  image:          ['image', 'icon', 'thumbnail', 'img', 'offerphoto', 'logo', 'creative_url'],
  category:       ['category', 'vertical', 'niche', 'type'],
  countries:      ['countries', 'country', 'geo', 'allowed_countries', 'geos'],
  devices:        ['devices', 'device', 'platform', 'os', 'operating_system'],
  requirements:   ['requirements', 'instructions', 'steps', 'conversion_instructions'],
  trackingUrl:    ['tracking_url', 'trackingUrl', 'postback_url'],
  previewUrl:     ['preview_url', 'previewUrl', 'preview', 'sample_url'],
  conversionType: ['conversion_type', 'conversionType', 'event_type', 'goal_type'],
};

/**
 * Safely read a dot-separated field path from an object.
 */
function getField(obj, path) {
  if (!path) return undefined;
  let cur = obj;
  for (const p of String(path).split('.')) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * Try a list of paths on the object, return first defined value.
 */
function tryChain(obj, paths) {
  for (const p of paths) {
    const v = getField(obj, p);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/**
 * Resolve a canonical field using: configured mapping path first, then
 * fallback chain, then undefined.
 */
function resolve(offer, canonicalKey, mapping) {
  const mappedPath = mapping[canonicalKey];

  // Try the explicitly configured path
  if (mappedPath) {
    const v = getField(offer, mappedPath);
    if (v !== undefined && v !== null && v !== '') return v;
  }

  // Try fallback chain
  const chain = FALLBACK_CHAINS[canonicalKey];
  if (chain) {
    const v = tryChain(offer, chain);
    if (v !== undefined) return v;
  }

  return undefined;
}

/**
 * Normalise a raw value to an array.
 * Accepts: comma-separated string, JSON array string, or actual array.
 */
function toArray(value) {
  if (Array.isArray(value)) return value.map(String);
  if (!value) return [];
  const s = String(value).trim();
  if (s.startsWith('[')) {
    try { return JSON.parse(s).map(String); } catch {}
  }
  return s.split(/[,;|]/).map(v => v.trim()).filter(Boolean);
}

/**
 * Normalise an array of raw offer objects into canonical Task objects.
 *
 * @param {Array}    rawOffers
 * @param {Object}   offerMapping  - Field mapping overrides from platform config
 * @param {string}   platformId    - Firestore document ID of the platform
 * @param {string}   displayName   - Human-readable platform name
 * @param {Object}   [logger]      - Optional logger from logger.js
 * @returns {{ tasks: Array, warnings: string[] }}
 */
export function normalizeOffers(rawOffers, offerMapping, platformId, displayName, logger) {
  const mapping  = { ...DEFAULT_MAPPING, ...offerMapping };
  const tasks    = [];
  const warnings = [];

  for (const offer of rawOffers) {
    // ── Required: external ID ──────────────────────────────────────────────
    const rawId      = resolve(offer, 'id', mapping);
    const externalId = rawId !== undefined && rawId !== null ? String(rawId).trim() : '';

    if (!externalId) {
      warnings.push(`Skipped offer — could not resolve an ID field. Raw keys: ${Object.keys(offer).join(', ')}`);
      continue;
    }

    // ── Required: title ────────────────────────────────────────────────────
    const titleRaw = resolve(offer, 'title', mapping);
    if (titleRaw === undefined) {
      warnings.push(`Offer ${externalId} — missing title field`);
    }
    const title = String(titleRaw ?? 'Untitled Offer');

    // ── Optional fields (missing → default, not error) ─────────────────────
    const description    = String(resolve(offer, 'description',    mapping) ?? '');
    const payoutRaw      = resolve(offer, 'payout',         mapping);
    const payout         = Math.max(0, parseFloat(String(payoutRaw ?? 0)) || 0);
    const url            = String(resolve(offer, 'url',           mapping) ?? '');
    const image          = String(resolve(offer, 'image',         mapping) ?? '');
    const category       = String(resolve(offer, 'category',      mapping) ?? '');
    const countries      = toArray(resolve(offer, 'countries',    mapping));
    const devices        = toArray(resolve(offer, 'devices',      mapping));
    const requirements   = String(resolve(offer, 'requirements',  mapping) ?? '');
    const trackingUrl    = String(resolve(offer, 'trackingUrl',   mapping) ?? '');
    const previewUrl     = String(resolve(offer, 'previewUrl',    mapping) ?? '');
    const conversionType = String(resolve(offer, 'conversionType',mapping) ?? '');

    tasks.push({
      externalId,
      title,
      description,
      payout,
      url,
      image,
      category,
      countries,
      devices,
      requirements,
      trackingUrl,
      previewUrl,
      conversionType,
      platform:   displayName,
      platformId: platformId || displayName,
      status:     'active',
      createdAt:  new Date().toISOString(),
      _raw:       offer,
    });
  }

  if (warnings.length > 0) {
    logger?.warn(`Normalizer produced ${warnings.length} warning(s)`);
    warnings.forEach(w => logger?.warn(`  • ${w}`));
  }

  return { tasks, warnings };
}
