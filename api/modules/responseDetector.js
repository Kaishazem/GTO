// modules/responseDetector.js — Response content-type detector
// Single responsibility: decide whether the HTTP response can be parsed as JSON.

/**
 * Returns { isJson: true } or { isJson: false, hint: string }.
 * Does NOT consume the response body.
 */
export function detectResponseType(response) {
  const contentType = response.headers?.get?.('content-type') || '';
  const isJson =
    contentType.includes('application/json') ||
    contentType.includes('text/json');

  if (!isJson) {
    return {
      isJson: false,
      hint: contentType
        ? `Server returned Content-Type: ${contentType}`
        : 'Server returned no Content-Type header',
    };
  }

  return { isJson: true };
}
