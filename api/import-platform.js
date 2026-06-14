// api/import-platform.js — Universal Platform Engine (v4)
//
// Orchestrates the modular import pipeline. Each stage is handled by a
// dedicated module — no platform-specific logic lives here.
//
// Request body:
//   platformName   — Firestore document ID (used for logging & normalisation)
//   platformConfig — Full platform config object (from Firestore / Admin UI)
//
// Response (always HTTP 200):
//   { success: true,  offers, totalOffers, duration }
//   { success: false, error: "..." }

import { createLogger }          from './modules/logger.js';
import { validatePlatformConfig } from './modules/validationEngine.js';
import { buildRequest }           from './modules/requestBuilder.js';
import { executeRequest }         from './modules/httpClient.js';
import { detectResponseType }     from './modules/responseDetector.js';
import { parseResponseBody, extractOffersArray } from './modules/responseParser.js';
import { normalizeOffers }        from './modules/normalizer.js';

export default async function handler(req, res) {
  // ── CORS: reflect Origin so null-origin iframes (Replit preview) are allowed
  const requestOrigin = req.headers?.origin;
  res.setHeader('Access-Control-Allow-Origin', requestOrigin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(200).json({ success: false, error: 'Method not allowed — use POST' });
  }

  const startTime = Date.now();
  const log = createLogger('import-platform');

  log.stage('0', 'START', `handler invoked at ${new Date().toISOString()}`);

  try {
    const { platformName, platformConfig } = req.body;

    // ── STAGE 1: Validate ────────────────────────────────────────────────────
    const validation = validatePlatformConfig(platformConfig);
    if (!validation.valid) {
      log.stage('1', 'FAILED', validation.error);
      return res.status(200).json({ success: false, error: validation.error });
    }

    const config = validation.config;
    config.displayName = config.displayName || platformName || 'Platform';

    log.stage('1', 'REQUEST', JSON.stringify({
      platformName:       platformName || '(unnamed)',
      hasApiBase:         !!config.apiBase,
      hasApiKey:          !!config.apiKey,
      authenticationType: config.authenticationType,
      requestMethod:      config.requestMethod,
      responsePath:       config.responsePath,
    }));

    // ── STAGE 2: Build request ───────────────────────────────────────────────
    const built = buildRequest(config);
    if (!built.ok) {
      log.stage('2', 'FAILED', built.error);
      return res.status(200).json({ success: false, error: built.error });
    }

    log.stage('2', 'API_REQUEST', `${config.requestMethod} ${built.logUrl} auth=${config.authenticationType}`);

    // ── STAGE 3: Execute HTTP request ────────────────────────────────────────
    const fetched = await executeRequest(built.url, config.requestMethod, built.headers);
    if (!fetched.ok) {
      log.stage('3', 'NETWORK_ERROR', fetched.error);
      return res.status(200).json({ success: false, error: fetched.error });
    }

    const { response } = fetched;
    log.stage('3', 'API_RESPONSE', `HTTP ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const body = await response.text();
      const msg  = `Platform API returned ${response.status}: ${body.slice(0, 300)}`;
      log.stage('3', 'FAILED', msg);
      return res.status(200).json({ success: false, error: msg });
    }

    // ── STAGE 4: Detect response type ────────────────────────────────────────
    const detection = detectResponseType(response);
    if (!detection.isJson) {
      log.stage('4', 'WARN', `Non-JSON Content-Type detected — attempting parse anyway. ${detection.hint}`);
    }

    // ── STAGE 5: Parse response body ─────────────────────────────────────────
    const parsed = await parseResponseBody(response);
    if (!parsed.ok) {
      log.stage('5', 'FAILED', parsed.error);
      return res.status(200).json({ success: false, error: parsed.error });
    }

    log.stage('5', 'SUCCESS', `Received JSON. Top-level keys: ${Object.keys(parsed.rawData).join(', ')}`);

    // ── STAGE 6: Extract offers array ────────────────────────────────────────
    const { offers: rawOffers, usedFallback } = extractOffersArray(parsed.rawData, config.responsePath);

    if (usedFallback) {
      log.stage('6', 'FALLBACK', `responsePath="${config.responsePath}" did not yield an array — used envelope fallback`);
    }

    log.stage('6', 'OFFERS', `Found ${rawOffers.length} raw offers`);

    // ── STAGE 7: Normalise offers ────────────────────────────────────────────
    const normalised = normalizeOffers(
      rawOffers,
      config.offerMapping,
      platformName || config.displayName,
      config.displayName,
    );

    const duration = Date.now() - startTime;
    log.stage('7', 'DONE', `Normalised ${normalised.length} offers in ${duration}ms`);

    return res.status(200).json({
      success:     true,
      offers:      normalised,
      totalOffers: normalised.length,
      duration,
    });

  } catch (error) {
    log.error('UNHANDLED ERROR', error);
    return res.status(200).json({ success: false, error: String(error.message || error) });
  }
}
