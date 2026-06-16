// modules/httpClient.js — HTTP client (v2)
// Single responsibility: execute a network request and return the raw response.
// Supports all HTTP methods including body-bearing ones.

/**
 * @param {string}      url
 * @param {string}      method  - HTTP verb (GET, POST, PUT, PATCH, DELETE)
 * @param {Object}      headers
 * @param {string|null} [body]  - Serialised request body for POST/PUT/PATCH/DELETE
 * @returns {{ ok: true, response } | { ok: false, error: string }}
 */
export async function executeRequest(url, method, headers, body) {
  let response;
  try {
    const init = { method, headers };
    if (body !== undefined && body !== null) {
      init.body = body;
    }
    response = await fetch(url, init);
  } catch (networkErr) {
    return { ok: false, error: `Network error reaching ${url}: ${networkErr.message}` };
  }

  return { ok: true, response };
}
