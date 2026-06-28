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
  console.log("[DBG:import-platform] ── ENTERED HANDLER ──────────────────────────────");
  console.log("[DBG:import-platform] req.method:", req.method);
  console.log("[DBG:import-platform] req.body keys:", Object.keys(req.body || {}));

  const { platformName, platformConfig } = req.body as {
    platformName?: string;
    platformConfig?: PlatformConfig;
  };

  console.log("[DBG:import-platform] platformName:", platformName);
  console.log("[DBG:import-platform] platformConfig?.apiBase:", platformConfig?.apiBase);
  console.log("[DBG:import-platform] platformConfig?.authenticationType:", platformConfig?.authenticationType);
  console.log("[DBG:import-platform] platformConfig?.requestMethod:", platformConfig?.requestMethod);
  console.log("[DBG:import-platform] platformConfig?.apiKey (len):", platformConfig?.apiKey?.length ?? "undefined");
  console.log("[DBG:import-platform] platformConfig?.apiKeyParam:", platformConfig?.apiKeyParam);
  console.log("[DBG:import-platform] platformConfig?.endpoint:", platformConfig?.endpoint);
  console.log("[DBG:import-platform] platformConfig?.responsePath:", platformConfig?.responsePath);

  if (!platformConfig?.apiBase) {
    console.log("[DBG:import-platform] → RETURNING 400: missing apiBase");
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
    console.log("[DBG:import-platform] building URL from apiBase:", apiBase, "endpoint:", endpoint);
    const url = new URL(`${apiBase.replace(/\/$/, "")}${endpoint || ""}`);
    console.log("[DBG:import-platform] base URL built:", url.toString());

    const reqHeaders: Record<string, string> = { "Accept": "application/json", ...extraHeaders };
    let basicAuthHeader = "";

    console.log("[DBG:import-platform] authenticationType:", authenticationType);
    switch (authenticationType) {
      case "queryParam":
        console.log("[DBG:import-platform] setting queryParam:", apiKeyParam, "= (", apiKey.length, "chars)");
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

    console.log("[DBG:import-platform] extraParams keys:", Object.keys(extraParams));
    for (const [k, v] of Object.entries(extraParams)) {
      if (k && v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }

    const finalUrl = url.toString();
    console.log("[DBG:import-platform] final URL (key masked):", finalUrl.replace(/(key|api_key|secret)=[^&]+/gi, "$1=***"));

    const fetchOptions: RequestInit = {
      method: requestMethod,
      headers: reqHeaders,
    };

    console.log("[DBG:import-platform] → BEFORE fetch()");
    let response: globalThis.Response;
    try {
      response = await fetch(finalUrl, fetchOptions);
    } catch (fetchErr) {
      const e = fetchErr as Error;
      console.error("[DBG:import-platform] fetch() THREW EXCEPTION");
      console.error("[DBG:import-platform] error.name   :", e?.name);
      console.error("[DBG:import-platform] error.message:", e?.message);
      console.error("[DBG:import-platform] error.code   :", (e as NodeJS.ErrnoException)?.code);
      console.error("[DBG:import-platform] error.stack  :", e?.stack);
      res.status(500).json({ success: false, error: `fetch() failed: ${e?.message}`, code: (e as NodeJS.ErrnoException)?.code });
      return;
    }
    console.log("[DBG:import-platform] ← AFTER fetch() — HTTP status:", response.status, response.statusText);

    console.log("[DBG:import-platform] → BEFORE response.text()");
    let responseText: string;
    try {
      responseText = await response.text();
    } catch (textErr) {
      const e = textErr as Error;
      console.error("[DBG:import-platform] response.text() THREW EXCEPTION");
      console.error("[DBG:import-platform] error.name   :", e?.name);
      console.error("[DBG:import-platform] error.message:", e?.message);
      console.error("[DBG:import-platform] error.stack  :", e?.stack);
      res.status(500).json({ success: false, error: `response.text() failed: ${e?.message}` });
      return;
    }
    console.log("[DBG:import-platform] ← AFTER response.text() — length:", responseText.length);
    console.log("[DBG:import-platform] responseText preview:", responseText.slice(0, 200));

    if (!response.ok) {
      console.log("[DBG:import-platform] → RETURNING 502: response not ok, status:", response.status);
      res.status(502).json({
        success: false,
        error: `Platform returned HTTP ${response.status}. Check your API key and endpoint configuration.`,
        detail: responseText.slice(0, 300),
      });
      return;
    }

    let data: unknown;
    try {
      console.log("[DBG:import-platform] → BEFORE JSON.parse()");
      data = JSON.parse(responseText);
      console.log("[DBG:import-platform] ← AFTER JSON.parse() — type:", typeof data, Array.isArray(data) ? "(array)" : "(object)");
    } catch (parseErr) {
      const e = parseErr as Error;
      console.error("[DBG:import-platform] JSON.parse() THREW EXCEPTION");
      console.error("[DBG:import-platform] error.name   :", e?.name);
      console.error("[DBG:import-platform] error.message:", e?.message);
      console.error("[DBG:import-platform] error.stack  :", e?.stack);
      console.error("[DBG:import-platform] raw text that failed:", responseText.slice(0, 300));
      res.status(502).json({
        success: false,
        error: "Platform returned a non-JSON response. Check your API base URL and endpoint path.",
        received: responseText.slice(0, 300),
      });
      return;
    }

    const raw = responsePath ? resolvePath(data, responsePath) : data;
    console.log("[DBG:import-platform] after resolvePath — isArray:", Array.isArray(raw), "type:", typeof raw);

    if (!Array.isArray(raw)) {
      console.log("[DBG:import-platform] → RETURNING 502: not an array at responsePath:", responsePath);
      res.status(502).json({
        success: false,
        error: `Could not find offer array at path "${responsePath || "(root)"}". Check responsePath configuration.`,
        received: JSON.stringify(data).slice(0, 300),
      });
      return;
    }

    console.log("[DBG:import-platform] raw offer count:", raw.length);
    const offers = (raw as Record<string, unknown>[]).map((offer) =>
      applyMapping(offer, offerMapping as Record<string, string>)
    );

    console.log("[DBG:import-platform] → RETURNING 200 with", offers.length, "offers");
    res.json({ success: true, offers, count: offers.length, platform: platformName });

  } catch (err) {
    const e = err as Error;
    console.error("[DBG:import-platform] ── UNHANDLED EXCEPTION IN OUTER try/catch ──");
    console.error("[DBG:import-platform] error.name   :", e?.name);
    console.error("[DBG:import-platform] error.message:", e?.message);
    console.error("[DBG:import-platform] error.code   :", (e as NodeJS.ErrnoException)?.code);
    console.error("[DBG:import-platform] error.stack  :", e?.stack);
    console.error("[DBG:import-platform] typeof err   :", typeof err);
    console.error("[DBG:import-platform] err (raw)    :", err);
    const message = e instanceof Error ? e.message : String(err);
    res.status(500).json({ success: false, error: message });
  }

  console.log("[DBG:import-platform] ── HANDLER EXITED ──────────────────────────────");
});

export default router;
