// api/import-platform.js — Universal Platform Engine (v5 / Phase 2)
//
// ── Dev-server cache busting ───────────────────────────────────────────────
// The Vite apiDevPlugin loads this file with a ?t=<timestamp> query param to
// bypass Node.js's ESM module cache on every request.  Static sub-module
// imports would always resolve to the non-timestamped URL and therefore USE
// the cached (stale) version of each module.
//
// Fix: extract the timestamp from this module's own URL and re-apply it to
// every sub-module import, so they are ALSO loaded fresh on each request.
// In production (Vercel) import.meta.url has no ?t=, so _suffix = '' and
// all imports fall back to plain paths — identical to static imports.
// ──────────────────────────────────────────────────────────────────────────

const _buster = new URL(import.meta.url).searchParams.get('t') || '';
const _s      = _buster ? `?t=${_buster}` : '';   // suffix, e.g. "?t=1718000000000"

const { createLogger }                    = await import(`./modules/logger.js${_s}`);
const { validatePlatformConfig }           = await import(`./modules/validationEngine.js${_s}`);
const { buildRequest }                     = await import(`./modules/requestBuilder.js${_s}`);
const { executeRequest }                   = await import(`./modules/httpClient.js${_s}`);
const { detectResponseType }               = await import(`./modules/responseDetector.js${_s}`);
const { parseBodyText, extractOffersArray }= await import(`./modules/responseParser.js${_s}`);
const { normalizeOffers }                  = await import(`./modules/normalizer.js${_s}`);

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS: reflect Origin so null-origin iframes (Replit preview) are allowed
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

    // ── STAGE 1: Validate & extract typed config ───────────────────────────
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
      apiKeyParam:        config.apiKeyParam,
      requestMethod:      config.requestMethod,
      responsePaths:      config.responsePaths,
      queryParameterKeys: Object.keys(config.queryParameters),
    }));

    // ── STAGE 2: Build request (URL + headers + optional body) ─────────────
    const built = buildRequest(config);
    if (!built.ok) {
      log.stage('2', 'FAILED', built.error);
      return res.status(200).json({ success: false, error: built.error });
    }

    // ── DIAGNOSTIC: print every query parameter individually ───────────────
    const builtUrl    = new URL(built.url);
    const allParams   = {};
    builtUrl.searchParams.forEach((v, k) => { allParams[k] = v; });

    log.stage('2', 'FINAL_URL',   built.logUrl);
    log.stage('2', 'ALL_PARAMS',  JSON.stringify(allParams));
    log.stage('2', 'AUTH_TYPE',   config.authenticationType);
    log.stage('2', 'HEADERS',     JSON.stringify(
      Object.fromEntries(
        Object.entries(built.headers).map(([k, v]) =>
          k.toLowerCase() === 'authorization'
            ? [k, v.replace(/(?<=^.{10}).+/, '***')]
            : [k, v]
        )
      )
    ));
    if (built.body) log.stage('2', 'REQUEST_BODY', built.body.slice(0, 200));

    // ── STAGE 3: Execute HTTP request ──────────────────────────────────────
    log.stage('3', 'SENDING', `${config.requestMethod} ${built.logUrl}`);
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

    // ── STAGE 4: Read body text (single consumption) ───────────────────────
    let bodyText;
    try {
      bodyText = await response.text();
    } catch (e) {
      const msg = `Failed to read response body: ${e.message}`;
      log.stage('4', 'FAILED', msg);
      return res.status(200).json({ success: false, error: msg });
    }

    // ── STAGE 5: Detect format from headers + body preview ─────────────────
    const detection = detectResponseType(response, bodyText.slice(0, 500));
    log.stage('5', 'FORMAT', `format=${detection.format} encoding=${detection.encoding} hint="${detection.hint}"`);

    if (detection.format === 'gzip' || detection.format === 'zip') {
      const msg = `Compressed response (${detection.format}) is not supported. Configure the platform API to return uncompressed data.`;
      log.stage('5', 'FAILED', msg);
      return res.status(200).json({ success: false, error: msg });
    }

    // ── STAGE 6: Parse body ────────────────────────────────────────────────
    const parsed = parseBodyText(bodyText, detection.format);
    if (!parsed.ok) {
      log.stage('6', 'FAILED', parsed.error);
      return res.status(200).json({ success: false, error: parsed.error });
    }

    const topKeys = Array.isArray(parsed.rawData)
      ? `[array of ${parsed.rawData.length}]`
      : Object.keys(parsed.rawData).join(', ');
    log.stage('6', 'PARSED', `format=${parsed.format} top-level keys: ${topKeys}`);

    // ── STAGE 7: Extract offers array ──────────────────────────────────────
    const { offers: rawOffers, resolvedPath, usedFallback } =
      extractOffersArray(parsed.rawData, config.responsePaths, log);

    log.stage('7', 'OFFERS',
      `${rawOffers.length} raw offers via path="${resolvedPath}"` +
      (usedFallback ? ' [fallback]' : '')
    );

    if (rawOffers.length === 0) {
      const msg = `No offers found. Paths tried: ${config.responsePaths.join(', ')}. Top-level keys: ${topKeys}`;
      log.stage('7', 'EMPTY', msg);
      return res.status(200).json({
        success: true, offers: [], totalOffers: 0,
        duration: Date.now() - startTime, format: detection.format, warnings: [],
      });
    }

    // ── STAGE 8: Normalise to canonical Task model ─────────────────────────
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
