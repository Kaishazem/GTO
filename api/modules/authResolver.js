// modules/authResolver.js — Authentication resolver (v2)
// Single responsibility: apply the correct auth scheme to headers and URL.
// Never contains platform-specific logic — everything comes from config.
//
// Supported types:
//   bearer       — Authorization: Bearer <token>
//   jwt          — Authorization: Bearer <jwt>  (alias for bearer, semantically a JWT)
//   apiKeyHeader — Custom header name: <key>
//   queryParam   — URL query parameter
//   basicAuth    — Authorization: Basic base64(user:key)
//   customHeaders— Merge extra headers object from config.extraAuthHeaders
//   none         — No authentication applied

/**
 * @param {URL}    url     - URL object (may be mutated for queryParam auth)
 * @param {Object} headers - Mutable headers object
 * @param {Object} config  - Validated platform config
 */
export function applyAuthentication(url, headers, config) {
  const {
    authenticationType,
    apiKey,
    apiKeyParam,
    apiKeyHeaderName,
    basicAuthUser,
    extraAuthHeaders,
  } = config;

  switch (authenticationType) {
    case 'bearer':
    case 'jwt':
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      break;

    case 'apiKeyHeader':
      if (apiKey && apiKeyHeaderName) headers[apiKeyHeaderName] = apiKey;
      break;

    case 'basicAuth': {
      const encoded = Buffer.from(`${basicAuthUser}:${apiKey}`).toString('base64');
      headers['Authorization'] = `Basic ${encoded}`;
      break;
    }

    case 'customHeaders':
      if (extraAuthHeaders && typeof extraAuthHeaders === 'object') {
        for (const [k, v] of Object.entries(extraAuthHeaders)) {
          if (k && v !== undefined && v !== null) headers[k] = String(v);
        }
      }
      break;

    case 'none':
      break;

    case 'queryParam':
    default:
      // Only set the auth param if it is NOT already present in the URL
      // (queryParameters in config may already supply it under the same key,
      //  and we must not overwrite a manually configured private-key param).
      if (apiKey && apiKeyParam && !url.searchParams.has(apiKeyParam)) {
        url.searchParams.set(apiKeyParam, apiKey);
      }
      break;
  }
}
