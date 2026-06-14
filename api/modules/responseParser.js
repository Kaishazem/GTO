// modules/responseParser.js — Response body parser and offer-array extractor
// Single responsibility: parse the JSON body and extract the offers array
// using the configured responsePath, with common-envelope fallbacks.

/**
 * Parse the response body as JSON.
 * Returns { ok: true, rawData } or { ok: false, error: string }.
 */
export async function parseResponseBody(response) {
  try {
    const rawData = await response.json();
    return { ok: true, rawData };
  } catch {
    return { ok: false, error: 'Platform API returned non-JSON response' };
  }
}

/**
 * Extract the offers array from the parsed JSON using the configured responsePath.
 * Falls back to common envelope keys if the path does not yield an array.
 *
 * @param {*} rawData
 * @param {string} responsePath - Dot-separated path, e.g. "offers" or "data.items"
 * @returns {{ offers: Array, usedFallback: boolean }}
 */
export function extractOffersArray(rawData, responsePath) {
  let offers = rawData;

  for (const part of responsePath.split('.')) {
    if (offers && typeof offers === 'object' && part in offers) {
      offers = offers[part];
    } else {
      offers = null;
      break;
    }
  }

  if (Array.isArray(offers)) {
    return { offers, usedFallback: false };
  }

  // Common envelope fallbacks
  const fallback =
    rawData?.offers    ??
    rawData?.data      ??
    rawData?.results   ??
    rawData?.campaigns ??
    rawData?.items     ??
    (Array.isArray(rawData) ? rawData : []);

  return { offers: Array.isArray(fallback) ? fallback : [], usedFallback: true };
}
