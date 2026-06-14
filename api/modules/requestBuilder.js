// modules/requestBuilder.js — HTTP request builder
// Single responsibility: construct a fully-formed URL and headers object
// from a validated platform config. Does NOT perform the network call.

import { applyAuthentication } from './authResolver.js';

/**
 * Build the fetch-ready { url, headers } from a validated platform config.
 * Returns { ok: true, url, headers, logUrl } or { ok: false, error: string }.
 */
export function buildRequest(config) {
  const { apiBase, endpoint, customHeaders, queryParameters, pagination, apiKey } = config;

  // Construct URL
  let url;
  try {
    url = new URL(`${apiBase}${endpoint}`);
  } catch {
    return { ok: false, error: `Invalid API Base URL: ${apiBase}${endpoint}` };
  }

  // Append configured query parameters
  for (const [k, v] of Object.entries(queryParameters)) {
    if (v !== null && v !== undefined && v !== '') {
      url.searchParams.set(k, String(v));
    }
  }

  // Append pagination parameter
  if (pagination.enabled) {
    url.searchParams.set(pagination.limitParam, String(pagination.limit));
  }

  // Build headers
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...customHeaders,
  };

  // Apply auth (may mutate url.searchParams or headers)
  applyAuthentication(url, headers, config);

  // Redacted URL for safe logging
  const logUrl = apiKey ? url.toString().replace(apiKey, '***KEY***') : url.toString();

  return { ok: true, url: url.toString(), headers, logUrl };
}
