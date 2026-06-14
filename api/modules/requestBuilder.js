// modules/requestBuilder.js — HTTP request builder (v2)
// Single responsibility: construct a fully-formed URL, headers, and optional
// request body from a validated platform config.
// Supports GET, POST, PUT, PATCH, DELETE with body.

import { applyAuthentication } from './authResolver.js';

/**
 * Build the fetch-ready { url, headers, body, logUrl } from a validated config.
 * Returns { ok: true, url, headers, body, logUrl } or { ok: false, error: string }.
 */
export function buildRequest(config) {
  const {
    apiBase, endpoint, customHeaders, queryParameters,
    pagination, apiKey, requestMethod, requestBody, requestBodyRaw,
  } = config;

  // ── Construct URL ──────────────────────────────────────────────────────────
  let url;
  try {
    url = new URL(`${apiBase}${endpoint}`);
  } catch {
    return { ok: false, error: `Invalid API Base URL: ${apiBase}${endpoint}` };
  }

  // Append configured query parameters (query-param auth is added later)
  for (const [k, v] of Object.entries(queryParameters)) {
    if (v !== null && v !== undefined && v !== '') {
      url.searchParams.set(k, String(v));
    }
  }

  // Append pagination parameters
  if (pagination.enabled) {
    url.searchParams.set(pagination.limitParam, String(pagination.limit));
    if (pagination.startOffset > 0) {
      url.searchParams.set(pagination.offsetParam, String(pagination.startOffset));
    }
  }

  // ── Build headers ──────────────────────────────────────────────────────────
  const methodsWithBody = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  const hasBody = methodsWithBody.has(requestMethod) && (requestBody || requestBodyRaw);

  const headers = {
    'Accept': 'application/json, application/xml, text/xml, text/csv, text/plain, */*',
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    ...customHeaders,
  };

  // ── Apply authentication ───────────────────────────────────────────────────
  applyAuthentication(url, headers, config);

  // ── Build request body ─────────────────────────────────────────────────────
  let body = undefined;
  if (hasBody) {
    if (requestBodyRaw) {
      body = requestBodyRaw;
    } else if (requestBody) {
      try {
        body = JSON.stringify(requestBody);
      } catch {
        body = String(requestBody);
      }
    }
  }

  // ── Redacted URL for safe logging ──────────────────────────────────────────
  const logUrl = apiKey ? url.toString().replace(apiKey, '***KEY***') : url.toString();

  return { ok: true, url: url.toString(), headers, body, logUrl };
}
