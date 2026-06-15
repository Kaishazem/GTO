// modules/validationEngine.js — Config and request validation (v2)
// Single responsibility: validate inputs and return structured errors.

const VALID_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Strip surrounding quote characters that users sometimes accidentally include
 * when entering values in the Admin UI (e.g. "key" → key, 'value' → value).
 * Only removes ONE pair of matching outer quotes.
 */
function stripQuotes(str) {
  if (!str || str.length < 2) return str;
  if ((str[0] === '"'  && str[str.length - 1] === '"')  ||
      (str[0] === "'"  && str[str.length - 1] === "'")) {
    return str.slice(1, -1);
  }
  return str;
}

const VALID_AUTH_TYPES = new Set([
  'bearer', 'jwt', 'apiKeyHeader', 'queryParam', 'basicAuth', 'customHeaders', 'none',
]);

/**
 * Validate and extract a typed platform config from a raw request body object.
 * Returns { valid: true, config } or { valid: false, error: string }.
 */
export function validatePlatformConfig(raw) {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'Missing platformConfig. The frontend must pass the platform configuration in the request body.' };
  }

  const apiBase = String(raw.apiBase || '').trim();
  if (!apiBase) {
    return { valid: false, error: 'Missing API Base URL in platform configuration. Edit the platform and set the API Base URL.' };
  }

  const enabled = raw.enabled !== false;
  if (!enabled) {
    return { valid: false, error: 'Platform is disabled' };
  }

  const rawMethod = String(raw.requestMethod || 'GET').toUpperCase();
  const requestMethod = VALID_METHODS.has(rawMethod) ? rawMethod : 'GET';

  const rawAuthType = String(raw.authenticationType || 'queryParam');
  const authenticationType = VALID_AUTH_TYPES.has(rawAuthType) ? rawAuthType : 'queryParam';

  const config = {
    enabled,
    apiBase,
    endpoint:           String(raw.endpoint           || '').trim(),
    apiKey:             stripQuotes(String(raw.apiKey             || '').trim()),
    authenticationType,
    apiKeyParam:        stripQuotes(String(raw.apiKeyParam        || 'api_key').trim()),
    apiKeyHeaderName:   stripQuotes(String(raw.apiKeyHeaderName   || 'X-API-Key').trim()),
    basicAuthUser:      stripQuotes(String(raw.basicAuthUser      || '').trim()),
    extraAuthHeaders:   (typeof raw.extraAuthHeaders === 'object' && raw.extraAuthHeaders) ? raw.extraAuthHeaders : {},
    requestMethod,
    customHeaders:      (typeof raw.headers === 'object' && raw.headers)                           ? raw.headers           : {},
    queryParameters:    (typeof raw.queryParameters === 'object' && raw.queryParameters)           ? raw.queryParameters   : {},
    requestBody:        (typeof raw.requestBody === 'object' && raw.requestBody)                   ? raw.requestBody       : null,
    requestBodyRaw:     (typeof raw.requestBodyRaw === 'string' && raw.requestBodyRaw)             ? raw.requestBodyRaw    : null,
    // Response extraction paths — checked in order, first match wins
    responsePaths: (() => {
      const paths = [];
      if (raw.responsePath)  paths.push(String(raw.responsePath));
      if (raw.itemsPath)     paths.push(String(raw.itemsPath));
      if (raw.offerPath)     paths.push(String(raw.offerPath));
      if (raw.dataPath)      paths.push(String(raw.dataPath));
      if (paths.length === 0) paths.push('offers');
      return paths;
    })(),
    offerMapping:  (typeof raw.offerMapping  === 'object' && raw.offerMapping)  ? raw.offerMapping  : {},
    displayName:   String(raw.displayName    || ''),
    pagination: (() => {
      const p = (typeof raw.pagination === 'object' && raw.pagination) ? raw.pagination : {};
      return {
        enabled:      !!p.enabled,
        limitParam:   String(p.limitParam   || 'limit'),
        offsetParam:  String(p.offsetParam  || 'offset'),
        limit:        Number(p.limit        || 50) || 50,
        startOffset:  Number(p.startOffset  || 0),
      };
    })(),
  };

  return { valid: true, config };
}
