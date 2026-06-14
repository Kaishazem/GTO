// modules/responseParser.js — Universal response parser (v2)
// Single responsibility: parse the response body in any supported format and
// extract the offers array using a prioritised list of configured paths.
//
// Supported formats: json, xml, rss, csv, tsv, text, unknown (JSON attempt)

// ── Main entry points ─────────────────────────────────────────────────────────

/**
 * Read the response body as text, then parse according to the detected format.
 * Returns { ok: true, rawData, format, bodyText } or { ok: false, error }.
 *
 * @param {Response} response
 * @param {string}   format  - from responseDetector.detectResponseType()
 */
export async function parseResponseBody(response, format) {
  let text;
  try {
    text = await response.text();
  } catch (e) {
    return { ok: false, error: `Failed to read response body: ${e.message}` };
  }
  return parseBodyText(text, format);
}

/**
 * Parse an already-read body string according to the detected format.
 * Returns { ok: true, rawData, format } or { ok: false, error }.
 * Use this when you have already consumed the response body (e.g. for sniffing).
 *
 * @param {string} text
 * @param {string} format
 */
export function parseBodyText(text, format) {
  switch (format) {
    case 'json':
    case 'unknown':
      return parseJson(text);

    case 'xml':
    case 'rss':
      return parseXml(text, format);

    case 'csv':
      return parseCsv(text, ',');

    case 'tsv':
      return parseCsv(text, '\t');

    case 'text':
      return { ok: true, rawData: { _text: text }, format: 'text' };

    default:
      return parseJson(text);
  }
}

// ── JSON ──────────────────────────────────────────────────────────────────────

function parseJson(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, error: 'Platform API returned an empty response body' };
  }
  try {
    const rawData = JSON.parse(trimmed);
    return { ok: true, rawData, format: 'json' };
  } catch {
    return { ok: false, error: `Platform API returned non-JSON response. Body starts with: ${trimmed.slice(0, 120)}` };
  }
}

// ── XML / RSS ─────────────────────────────────────────────────────────────────

function parseXml(text, format) {
  try {
    const rawData = xmlToObject(text);
    return { ok: true, rawData, format };
  } catch (e) {
    return { ok: false, error: `Failed to parse XML response: ${e.message}` };
  }
}

/**
 * Minimal recursive XML→JS object converter.
 * Handles: elements, attributes, text content, CDATA, repeated sibling → array.
 */
function xmlToObject(xml) {
  // Strip XML declaration and comments
  const clean = xml
    .replace(/<\?xml[^>]*\?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();

  function parseNode(str) {
    const result = {};

    // Match tags: <tagName attrs...>content</tagName> or <tagName attrs... />
    const tagRe = /<([a-zA-Z_][\w:.-]*)([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
    let match;

    while ((match = tagRe.exec(str)) !== null) {
      const [, tagName, attrsStr, inner] = match;
      const node = {};

      // Parse attributes
      const attrRe = /([a-zA-Z_][\w:-]*)=["']([^"']*)["']/g;
      let attrMatch;
      while ((attrMatch = attrRe.exec(attrsStr)) !== null) {
        node[`@${attrMatch[1]}`] = attrMatch[2];
      }

      if (inner !== undefined) {
        // CDATA
        const cdata = inner.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
        // Recurse if inner contains child elements
        if (/<[a-zA-Z_]/.test(cdata)) {
          const children = parseNode(cdata);
          Object.assign(node, children);
          // Also keep text if present outside child tags
          const textContent = cdata.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '').trim();
          if (textContent) node['#text'] = textContent;
        } else {
          node['#text'] = cdata;
        }
      }

      // Collapse single-value nodes to their text value
      const nodeKeys = Object.keys(node);
      const finalNode = (nodeKeys.length === 1 && nodeKeys[0] === '#text') ? node['#text'] : node;

      // Repeated siblings → array
      if (tagName in result) {
        if (!Array.isArray(result[tagName])) result[tagName] = [result[tagName]];
        result[tagName].push(finalNode);
      } else {
        result[tagName] = finalNode;
      }
    }

    return result;
  }

  return parseNode(clean);
}

// ── CSV / TSV ─────────────────────────────────────────────────────────────────

function parseCsv(text, delimiter) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    return { ok: true, rawData: { items: [] }, format: delimiter === '\t' ? 'tsv' : 'csv' };
  }

  const headers = splitLine(lines[0], delimiter);
  const items = [];

  for (let i = 1; i < lines.length; i++) {
    const values = splitLine(lines[i], delimiter);
    const row = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (values[idx] || '').trim();
    });
    items.push(row);
  }

  return {
    ok: true,
    rawData: { items },
    format: delimiter === '\t' ? 'tsv' : 'csv',
  };
}

function splitLine(line, delimiter) {
  if (delimiter === ',') {
    // Honour quoted fields for CSV
    const result = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === ',' && !inQuote) { result.push(cur); cur = ''; continue; }
      cur += ch;
    }
    result.push(cur);
    return result;
  }
  return line.split(delimiter);
}

// ── Offers array extractor ────────────────────────────────────────────────────

/**
 * Extract the offers array from parsed data using a list of candidate paths.
 * First path that resolves to an array wins. Falls back to common envelopes.
 *
 * @param {*}        rawData
 * @param {string[]} responsePaths - Ordered list of dot-separated paths to try
 * @param {object}   [logger]      - Optional logger from logger.js
 * @returns {{ offers: Array, resolvedPath: string, usedFallback: boolean }}
 */
export function extractOffersArray(rawData, responsePaths, logger) {
  const paths = Array.isArray(responsePaths) && responsePaths.length > 0
    ? responsePaths
    : ['offers'];

  for (const path of paths) {
    const result = resolveByPath(rawData, path);
    if (Array.isArray(result)) {
      return { offers: result, resolvedPath: path, usedFallback: false };
    }
    logger?.warn(`Path "${path}" did not resolve to an array`);
  }

  // Common envelope fallbacks
  const FALLBACK_KEYS = ['offers', 'data', 'results', 'campaigns', 'items', 'records', 'feed', 'item'];
  for (const key of FALLBACK_KEYS) {
    if (Array.isArray(rawData?.[key])) {
      return { offers: rawData[key], resolvedPath: key, usedFallback: true };
    }
    // One level deep: data.offers, response.items, etc.
    if (rawData && typeof rawData === 'object') {
      for (const topKey of Object.keys(rawData)) {
        if (rawData[topKey] && typeof rawData[topKey] === 'object' && Array.isArray(rawData[topKey][key])) {
          return { offers: rawData[topKey][key], resolvedPath: `${topKey}.${key}`, usedFallback: true };
        }
      }
    }
  }

  if (Array.isArray(rawData)) {
    return { offers: rawData, resolvedPath: '(root)', usedFallback: true };
  }

  return { offers: [], resolvedPath: '(none)', usedFallback: true };
}

function resolveByPath(obj, path) {
  let cur = obj;
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = cur[part];
  }
  return cur;
}
