// modules/validationEngine.js — Config and request validation
// Single responsibility: validate inputs and return structured errors.

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

  const config = {
    enabled,
    apiBase,
    endpoint:           String(raw.endpoint           || '').trim(),
    apiKey:             String(raw.apiKey             || '').trim(),
    authenticationType: String(raw.authenticationType || 'queryParam'),
    apiKeyParam:        String(raw.apiKeyParam        || 'api_key'),
    apiKeyHeaderName:   String(raw.apiKeyHeaderName   || 'X-API-Key'),
    basicAuthUser:      String(raw.basicAuthUser      || ''),
    requestMethod:      String(raw.requestMethod      || 'GET').toUpperCase(),
    customHeaders:      (typeof raw.headers === 'object' && raw.headers)            ? raw.headers        : {},
    queryParameters:    (typeof raw.queryParameters === 'object' && raw.queryParameters) ? raw.queryParameters : {},
    responsePath:       String(raw.responsePath       || 'offers'),
    offerMapping:       (typeof raw.offerMapping === 'object' && raw.offerMapping)  ? raw.offerMapping   : {},
    displayName:        String(raw.displayName        || ''),
    pagination: (() => {
      const p = (typeof raw.pagination === 'object' && raw.pagination) ? raw.pagination : {};
      return {
        enabled:    !!p.enabled,
        limitParam: String(p.limitParam || 'limit'),
        limit:      Number(p.limit || 50) || 50,
      };
    })(),
  };

  return { valid: true, config };
}
