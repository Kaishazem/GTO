// modules/authResolver.js — Authentication resolver
// Single responsibility: apply the correct auth scheme to headers and URL.
// Never contains platform-specific logic — everything comes from config.

/**
 * @param {URL} url - The URL object (may be mutated for queryParam auth)
 * @param {Object} headers - Mutable headers object
 * @param {Object} config - Validated platform config
 */
export function applyAuthentication(url, headers, config) {
  const { authenticationType, apiKey, apiKeyParam, apiKeyHeaderName, basicAuthUser } = config;

  switch (authenticationType) {
    case 'bearer':
      headers['Authorization'] = `Bearer ${apiKey}`;
      break;

    case 'apiKeyHeader':
      headers[apiKeyHeaderName] = apiKey;
      break;

    case 'basicAuth': {
      const encoded = Buffer.from(`${basicAuthUser}:${apiKey}`).toString('base64');
      headers['Authorization'] = `Basic ${encoded}`;
      break;
    }

    case 'queryParam':
    default:
      if (apiKey) url.searchParams.set(apiKeyParam, apiKey);
      break;
  }
}
