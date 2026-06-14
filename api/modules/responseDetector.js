// modules/responseDetector.js — Universal response type detector (v2)
// Single responsibility: identify the format of an HTTP response without
// consuming the body. Falls back to body-sniffing when Content-Type is absent
// or ambiguous.
//
// Detected formats:
//   json       — application/json, text/json, or body starts with { / [
//   xml        — application/xml, text/xml, or body starts with <
//   rss        — application/rss+xml, application/atom+xml, or <rss / <feed
//   csv        — text/csv, or consistent comma-separated lines
//   tsv        — text/tab-separated-values, or consistent tab-separated lines
//   gzip       — application/gzip, application/x-gzip
//   zip        — application/zip, application/x-zip-compressed
//   text       — text/plain fallback

/**
 * Detect the response format from headers and an optional body preview.
 *
 * @param {Response} response       - Fetch Response object (body not yet consumed)
 * @param {string}   [bodyPreview]  - First ~500 chars of the body for sniffing
 *                                    (pass only when Content-Type is missing/ambiguous)
 * @returns {{
 *   format: 'json'|'xml'|'rss'|'csv'|'tsv'|'gzip'|'zip'|'text'|'unknown',
 *   encoding: string,
 *   compressed: boolean,
 *   contentType: string,
 *   hint: string,
 * }}
 */
export function detectResponseType(response, bodyPreview) {
  const contentType = (response.headers?.get?.('content-type') || '').toLowerCase();
  const encoding    = detectEncoding(response.headers?.get?.('content-encoding') || '');
  const compressed  = encoding === 'gzip' || encoding === 'deflate' || encoding === 'br';

  // ── Content-Type based detection ──────────────────────────────────────────
  if (contentType.includes('application/json') || contentType.includes('text/json')) {
    return { format: 'json', encoding, compressed, contentType, hint: 'Content-Type header' };
  }
  if (contentType.includes('application/rss+xml') || contentType.includes('application/atom+xml')) {
    return { format: 'rss', encoding, compressed, contentType, hint: 'Content-Type header' };
  }
  if (contentType.includes('application/xml') || contentType.includes('text/xml')) {
    return { format: 'xml', encoding, compressed, contentType, hint: 'Content-Type header' };
  }
  if (contentType.includes('text/csv')) {
    return { format: 'csv', encoding, compressed, contentType, hint: 'Content-Type header' };
  }
  if (contentType.includes('text/tab-separated') || contentType.includes('text/tsv')) {
    return { format: 'tsv', encoding, compressed, contentType, hint: 'Content-Type header' };
  }
  if (contentType.includes('application/gzip') || contentType.includes('application/x-gzip')) {
    return { format: 'gzip', encoding, compressed, contentType, hint: 'Content-Type header' };
  }
  if (contentType.includes('application/zip') || contentType.includes('application/x-zip')) {
    return { format: 'zip', encoding, compressed, contentType, hint: 'Content-Type header' };
  }

  // ── Body-sniffing fallback ─────────────────────────────────────────────────
  if (bodyPreview) {
    const trimmed = bodyPreview.trimStart();

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return { format: 'json', encoding, compressed, contentType, hint: 'body-sniff: JSON brackets' };
    }
    if (trimmed.startsWith('<rss') || trimmed.startsWith('<feed') || trimmed.includes('<channel>')) {
      return { format: 'rss', encoding, compressed, contentType, hint: 'body-sniff: RSS/Atom tags' };
    }
    if (trimmed.startsWith('<') || trimmed.startsWith('<?xml')) {
      return { format: 'xml', encoding, compressed, contentType, hint: 'body-sniff: XML tag' };
    }
    // TSV: tabs more common than commas on the first line
    const firstLine = trimmed.split('\n')[0] || '';
    if ((firstLine.match(/\t/g) || []).length >= 2) {
      return { format: 'tsv', encoding, compressed, contentType, hint: 'body-sniff: tab-separated columns' };
    }
    if ((firstLine.match(/,/g) || []).length >= 2) {
      return { format: 'csv', encoding, compressed, contentType, hint: 'body-sniff: comma-separated columns' };
    }
  }

  const hint = contentType
    ? `Unrecognised Content-Type: ${contentType}`
    : 'No Content-Type header and no body preview — defaulting to JSON attempt';

  return { format: 'unknown', encoding, compressed, contentType, hint };
}

function detectEncoding(ce) {
  if (!ce) return 'identity';
  if (ce.includes('gzip'))    return 'gzip';
  if (ce.includes('deflate')) return 'deflate';
  if (ce.includes('br'))      return 'br';
  return 'identity';
}
