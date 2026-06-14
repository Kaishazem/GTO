// modules/normalizer.js — Offer normalizer
// Single responsibility: map raw platform offer objects to the canonical shape
// used by Firestore and the frontend. Everything comes from offerMapping config.

const DEFAULT_MAPPING = {
  id:          'id',
  title:       'name',
  description: 'description',
  payout:      'payout',
  url:         'url',
  image:       'image',
  category:    'category',
  countries:   'countries',
  devices:     'devices',
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
 * Normalise an array of raw offer objects into the canonical shape.
 *
 * @param {Array}  rawOffers
 * @param {Object} offerMapping   - Field mapping overrides from platform config
 * @param {string} platformId     - Firestore document ID of the platform
 * @param {string} displayName    - Human-readable platform name
 * @returns {Array} normalised offer objects
 */
export function normalizeOffers(rawOffers, offerMapping, platformId, displayName) {
  const mapping = { ...DEFAULT_MAPPING, ...offerMapping };
  const normalised = [];

  for (const offer of rawOffers) {
    const rawId      = getField(offer, mapping.id) ?? offer.id ?? offer.offer_id;
    const externalId = rawId !== undefined && rawId !== null ? String(rawId) : '';
    if (!externalId) continue;

    const title = String(
      getField(offer, mapping.title) ??
      offer.name ?? offer.title ?? offer.offer_name ??
      'Untitled Offer'
    );

    const description = String(
      getField(offer, mapping.description) ??
      offer.description ?? offer.requirements ?? ''
    );

    const payoutRaw = getField(offer, mapping.payout) ?? offer.payout ?? offer.reward ?? offer.amount ?? 0;
    const payout    = Math.max(0, parseFloat(String(payoutRaw)) || 0);

    const taskUrl = String(
      getField(offer, mapping.url) ??
      offer.url ?? offer.link ?? offer.offer_url ?? ''
    );

    normalised.push({
      externalId,
      title,
      description,
      payout,
      url:        taskUrl,
      platform:   displayName,
      platformId: platformId || displayName,
      _raw:       offer,
    });
  }

  return normalised;
}
