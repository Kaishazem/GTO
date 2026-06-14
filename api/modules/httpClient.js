// modules/httpClient.js — HTTP client
// Single responsibility: execute a network request and return the raw response.
// Centralises fetch so timeouts or retry logic can be added here later.

/**
 * @param {string} url
 * @param {string} method - HTTP verb
 * @param {Object} headers
 * @returns {{ ok: true, response } | { ok: false, error: string }}
 */
export async function executeRequest(url, method, headers) {
  let response;
  try {
    response = await fetch(url, { method, headers });
  } catch (networkErr) {
    return { ok: false, error: `Network error: ${networkErr.message}` };
  }

  return { ok: true, response };
}
