import { Router, Request, Response } from "express";

const router = Router();

interface PlatformConfig {
  enabled: boolean;
  apiBase: string;
  endpoint: string;
  apiKey?: string;
  authenticationType: "bearer" | "apiKeyHeader" | "queryParam" | "basicAuth";
  apiKeyParam?: string;
  apiKeyHeaderName?: string;
  basicAuthUser?: string;
  requestMethod: "GET" | "POST";
  headers?: Record<string, string>;
  queryParameters?: Record<string, string>;
  responsePath?: string;
  offerMapping?: Record<string, string>;
  displayName?: string;
}

function resolvePath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  return path.split(".").reduce<unknown>((cur, key) => {
    if (cur && typeof cur === "object") {
      return (cur as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function applyMapping(
  offer: Record<string, unknown>,
  mapping: Record<string, string>
): Record<string, unknown> {
  if (!mapping || Object.keys(mapping).length === 0) return offer;
  const result: Record<string, unknown> = { ...offer };
  for (const [target, source] of Object.entries(mapping)) {
    if (source && offer[source] !== undefined) {
      result[target] = offer[source];
    }
  }
  return result;
}

router.post("/", async (req: Request, res: Response): Promise<void> => {
  const { platformName, platformConfig } = req.body as {
    platformName?: string;
    platformConfig?: PlatformConfig;
  };

  if (!platformConfig?.apiBase) {
    res.status(400).json({ success: false, error: "Missing platformConfig.apiBase" });
    return;
  }

  const {
    apiBase,
    endpoint = "",
    apiKey = "",
    authenticationType = "queryParam",
    apiKeyParam = "api_key",
    apiKeyHeaderName = "X-API-Key",
    basicAuthUser = "",
    requestMethod = "GET",
    headers: extraHeaders = {},
    queryParameters: extraParams = {},
    responsePath = "",
    offerMapping = {},
  } = platformConfig;

  try {
    const url = new URL(`${apiBase.replace(/\/$/, "")}${endpoint || ""}`);

    // ── Auth ──────────────────────────────────────────────────────────
    const reqHeaders: Record<string, string> = { "Accept": "application/json", ...extraHeaders };
    let basicAuthHeader = "";

    switch (authenticationType) {
      case "queryParam":
        if (apiKey && apiKeyParam) url.searchParams.set(apiKeyParam, apiKey);
        break;
      case "bearer":
        if (apiKey) reqHeaders["Authorization"] = `Bearer ${apiKey}`;
        break;
      case "apiKeyHeader":
        if (apiKey && apiKeyHeaderName) reqHeaders[apiKeyHeaderName] = apiKey;
        break;
      case "basicAuth":
        if (apiKey) {
          basicAuthHeader = Buffer.from(`${basicAuthUser}:${apiKey}`).toString("base64");
          reqHeaders["Authorization"] = `Basic ${basicAuthHeader}`;
        }
        break;
    }

    // ── Extra query params ─────────────────────────────────────────────
    for (const [k, v] of Object.entries(extraParams)) {
      if (k && v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }

    const fetchOptions: RequestInit = {
      method: requestMethod,
      headers: reqHeaders,
    };

    console.log(`[import-platform] Fetching ${requestMethod} ${url.toString().replace(/(key|api_key|secret)=[^&]+/gi, "$1=***")}`);

    const response = await fetch(url.toString(), fetchOptions);

    const responseText = await response.text().catch(() => "");

    if (!response.ok) {
      console.error(`[import-platform] HTTP ${response.status}:`, responseText.slice(0, 300));
      res.status(502).json({
        success: false,
        error: `Platform returned HTTP ${response.status}. Check your API key and endpoint configuration.`,
        detail: responseText.slice(0, 300),
      });
      return;
    }

    // Parse JSON — give a descriptive 502 instead of an unhandled 500 when the
    // platform returns HTML (e.g. a Cloudflare error page or login redirect).
    let data: unknown;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error("[import-platform] Non-JSON response:", responseText.slice(0, 300));
      res.status(502).json({
        success: false,
        error: "Platform returned a non-JSON response. Check your API base URL and endpoint path.",
        received: responseText.slice(0, 300),
      });
      return;
    }

    // ── Extract offer array from response path ─────────────────────────
    const raw = responsePath ? resolvePath(data, responsePath) : data;

    if (!Array.isArray(raw)) {
      console.warn("[import-platform] Response is not an array. Got:", JSON.stringify(data).slice(0, 300));
      res.status(502).json({
        success: false,
        error: `Could not find offer array at path "${responsePath || "(root)"}". Check responsePath configuration.`,
        received: JSON.stringify(data).slice(0, 300),
      });
      return;
    }

    const offers = (raw as Record<string, unknown>[]).map((offer) =>
      applyMapping(offer, offerMapping as Record<string, string>)
    );

    console.log(`[import-platform] ✅ platform=${platformName} found ${offers.length} offers`);

    res.json({ success: true, offers, count: offers.length, platform: platformName });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[import-platform] Error:", message);
    res.status(500).json({ success: false, error: message });
  }
});

export default router;
