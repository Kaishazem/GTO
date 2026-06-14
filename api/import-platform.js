// api/import-platform.js — Universal Platform Engine (v5 / Phase 2)
//
// Orchestrates the full modular import pipeline.
// Supports: GET/POST/PUT/PATCH/DELETE, all auth types, JSON/XML/RSS/CSV/TSV,
// configurable response paths, universal field mapping, canonical Task model.
//
// Request body:
//   platformName   — Firestore document ID (used for logging & normalisation)
//   platformConfig — Full platform config object (from Firestore / Admin UI)
//
// Response (always HTTP 200):
//   { success: true,  offers, totalOffers, duration, format, warnings }
//   { success: false, error: "..." }

import { createLogger }           from './modules/logger.js';
import { validatePlatformConfig }  from './modules/validationEngine.js';
import { buildRequest }            from './modules/requestBuilder.js';
import { executeRequest }          from './modules/httpClient.js';
import { detectResponseType }      from './modules/responseDetector.js';
import { parseBodyText, extractOffersArray } from './modules/responseParser.js';
import { normalizeOffers }         from './modules/normalizer.js';

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

    // ── STAGE 1: Validate & extract typed config ─────────────────────────────
    const validation = validatePlatformConfig(platformConfig);
    if (!validation.valid) {
      log.stage('1', 'FAILED', validation.error);
      return res.status(200).json({ success: false, error: validation.error });
    }

    const config = validation.config;
    config.displayName = config.displayName || platformName || 'Platform';

    log.stage('1', 'CONFIG', JSON.stringify({
      platformName:       platformName || '(unnamed)',
      hasApiBase:         !!config.apiBase,
      hasApiKey:          !!config.apiKey,
      authenticationType: config.authenticationType,
      requestMethod:      config.requestMethod,
      responsePaths:      config.responsePaths,
    }));

    // ── STAGE 2: Build request (URL + headers + optional body) ───────────────
    const built = buildRequest(config);
    if (!built.ok) {
      log.stage('2', 'FAILED', built.error);
      return res.status(200).json({ success: false, error: built.error });
    }

    log.stage('2', 'API_REQUEST',
      `${config.requestMethod} ${built.logUrl} auth=${config.authenticationType}` +
      (built.body ? ' [with body]' : '')
    );

    // ── STAGE 3: Execute HTTP request ────────────────────────────────────────
    const fetched = await executeRequest(built.url, config.requestMethod, built.headers, built.body);
    if (!fetched.ok) {
      log.stage('3', 'NETWORK_ERROR', fetched.error);
      return res.status(200).json({ success: false, error: fetched.error });
    }

    const { response } = fetched;
    log.stage('3', 'API_RESPONSE', `HTTP ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errBody = await response.text();
      const msg = `Platform API returned ${response.status}: ${errBody.slice(0, 300)}`;
      log.stage('3', 'FAILED', msg);
      return res.status(200).json({ success: false, error: msg });
    }

    // ── STAGE 4: Read body text (single consumption) ─────────────────────────
    let bodyText;
    try {
      bodyText = await response.text();
    } catch (e) {
      const msg = `Failed to read response body: ${e.message}`;
      log.stage('4', 'FAILED', msg);
      return res.status(200).json({ success: false, error: msg });
    }

    // ── STAGE 5: Detect format from headers + body preview ───────────────────
    const detection = detectResponseType(response, bodyText.slice(0, 500));
    log.stage('5', 'FORMAT', `format=${detection.format} encoding=${detection.encoding} compressed=${detection.compressed} hint="${detection.hint}"`);

    if (detection.format === 'gzip' || detection.format === 'zip') {
      const msg = `Compressed response (${detection.format}) is not yet supported. Configure the platform API to return uncompressed data.`;
      log.stage('5', 'FAILED', msg);
      return res.status(200).json({ success: false, error: msg });
    }

    // ── STAGE 6: Parse body ───────────────────────────────────────────────────
    const parsed = parseBodyText(bodyText, detection.format);
    if (!parsed.ok) {
      log.stage('6', 'FAILED', parsed.error);
      return res.status(200).json({ success: false, error: parsed.error });
    }

    const topKeys = Array.isArray(parsed.rawData)
      ? `[array of ${parsed.rawData.length}]`
      : Object.keys(parsed.rawData).join(', ');
    log.stage('6', 'PARSED', `format=${parsed.format} top-level keys: ${topKeys}`);

    // ── STAGE 7: Extract offers array ─────────────────────────────────────────
    const { offers: rawOffers, resolvedPath, usedFallback } =
      extractOffersArray(parsed.rawData, config.responsePaths, log);

    log.stage('7', 'OFFERS',
      `${rawOffers.length} raw offers via path="${resolvedPath}"` +
      (usedFallback ? ' [fallback]' : '')
    );

    if (rawOffers.length === 0) {
      const msg = `No offers found. Response paths tried: ${config.responsePaths.join(', ')}. Top-level keys: ${topKeys}`;
      log.stage('7', 'EMPTY', msg);
      return res.status(200).json({
        success: true, offers: [], totalOffers: 0,
        duration: Date.now() - startTime, format: detection.format, warnings: [],
      });
    }

    // ── STAGE 8: Normalise to canonical Task model ────────────────────────────
    const { tasks, warnings } = normalizeOffers(
      rawOffers,
      config.offerMapping,
      platformName || config.displayName,
      config.displayName,
      log,
    );

    const duration = Date.now() - startTime;
    log.stage('8', 'DONE',
      `${tasks.length} tasks normalised in ${duration}ms` +
      (warnings.length > 0 ? ` (${warnings.length} warnings)` : '')
    );

    return res.status(200).json({
      success:     true,
      offers:      tasks,
      totalOffers: tasks.length,
      duration,
      format:      detection.format,
      warnings,
    });

  } catch (error) {
    log.error('UNHANDLED ERROR', error);
    return res.status(200).json({ success: false, error: String(error.message || error) });
  }
}
