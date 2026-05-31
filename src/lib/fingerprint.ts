import FingerprintJS from "@fingerprintjs/fingerprintjs";

let cachedFingerprint: string | null = null;

// ─── IndexedDB persistence (survives cache/localStorage clear) ───────────────
const IDB_NAME = "gto_secure_v1";
const IDB_STORE = "device_data";
const IDB_KEY = "device_fp";

export async function persistFingerprintToIDB(fp: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onerror = () => resolve();
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction(IDB_STORE, "readwrite");
          tx.objectStore(IDB_STORE).put(fp, IDB_KEY);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch { resolve(); }
      };
    } catch { resolve(); }
  });
}

export async function loadFingerprintFromIDB(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction(IDB_STORE, "readonly");
          const getReq = tx.objectStore(IDB_STORE).get(IDB_KEY);
          getReq.onsuccess = () => resolve((getReq.result as string) || null);
          getReq.onerror = () => resolve(null);
        } catch { resolve(null); }
      };
    } catch { resolve(null); }
  });
}

// ─── Incognito / Private browsing detection ──────────────────────────────────
export async function detectIncognitoMode(): Promise<boolean> {
  // Method 1: Storage quota — incognito Chrome caps at ~120 MB
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      if ((est.quota || Infinity) < 150 * 1024 * 1024) {
        return true;
      }
    }
  } catch { /* ignore */ }

  // Method 2: FileSystem API blocked in incognito (legacy Chrome/Firefox)
  try {
    const w = window as { webkitRequestFileSystem?: (type: number, size: number, success: () => void, error: () => void) => void };
    if (w.webkitRequestFileSystem) {
      return await new Promise<boolean>((resolve) => {
        w.webkitRequestFileSystem!(0, 1, () => resolve(false), () => resolve(true));
      });
    }
  } catch { /* ignore */ }

  // Method 3: Safari private mode — localStorage throws or is limited
  try {
    const key = "__gto_incognito_test__";
    localStorage.setItem(key, "1");
    localStorage.removeItem(key);
  } catch {
    return true;
  }

  return false;
}

// ─── Fingerprint sub-components ───────────────────────────────────────────────
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash.toString(36);
}

async function timeoutWithFallback<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), ms);
    promise.then((value) => {
      window.clearTimeout(timer);
      resolve(value);
    }).catch(() => {
      window.clearTimeout(timer);
      resolve(fallback);
    });
  });
}

function getCanvasFingerprint(): string {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "nocanvas";
    ctx.textBaseline = "top";
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = "#f60";
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = "#069";
    ctx.fillText("GreenTaskOrbit🎯", 2, 15);
    ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
    ctx.fillText("GreenTaskOrbit🎯", 4, 17);
    return simpleHash(canvas.toDataURL());
  } catch {
    return "canvas-error";
  }
}

function getWebGLFingerprint(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") as WebGLRenderingContext | null ||
               canvas.getContext("experimental-webgl") as WebGLRenderingContext | null;
    if (!gl) return "nowebgl";
    const renderer = gl.getParameter(gl.RENDERER) as string || "";
    const vendor = gl.getParameter(gl.VENDOR) as string || "";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const unmaskedRenderer = ext ? (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string || "") : "";
    const unmaskedVendor = ext ? (gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) as string || "") : "";
    return simpleHash([renderer, vendor, unmaskedRenderer, unmaskedVendor].join("|"));
  } catch {
    return "webgl-error";
  }
}

async function getAudioFingerprint(): Promise<string> {
  try {
    const AudioContextClass = window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return "noaudio";
    const ctx = new AudioContextClass();
    const oscillator = ctx.createOscillator();
    const analyser = ctx.createAnalyser();
    const gain = ctx.createGain();
    const scriptProcessor = (ctx.createScriptProcessor?.(4096, 1, 1) as ScriptProcessorNode) ||
      (ctx.createScriptProcessor?.(4096, 1, 1) as ScriptProcessorNode);
    if (!scriptProcessor) {
      await ctx.close().catch(() => {});
      return "noaudio";
    }

    let resolved = false;
    const cleanup = () => {
      try { oscillator.stop(); } catch {}
      try { oscillator.disconnect(); } catch {}
      try { analyser.disconnect(); } catch {}
      try { scriptProcessor.disconnect(); } catch {}
      try { gain.disconnect(); } catch {}
      try { ctx.close().catch(() => {}); } catch {}
    };

    gain.gain.value = 0;
    oscillator.type = "triangle";
    oscillator.frequency.value = 10000;
    oscillator.connect(analyser);
    analyser.connect(scriptProcessor);
    scriptProcessor.connect(gain);
    gain.connect(ctx.destination);

    const result = await new Promise<string>((resolve) => {
      const done = (value: string) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(value);
      };

      const timeoutId = window.setTimeout(() => done("audio-timeout"), 300);

      scriptProcessor.onaudioprocess = (event) => {
        try {
          const data = event.inputBuffer.getChannelData(0);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += Math.abs(data[i]);
          done(simpleHash(sum.toString()));
        } catch {
          done("audio-error");
        } finally {
          window.clearTimeout(timeoutId);
        }
      };

      try {
        oscillator.start(0);
      } catch {
        done("audio-error");
      }
    });

    return result;
  } catch {
    return "audio-error";
  }
}

function getScreenFingerprint(): string {
  const parts = [
    screen.width,
    screen.height,
    screen.colorDepth,
    screen.pixelDepth,
    window.devicePixelRatio || 1,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.language,
    navigator.languages?.join(",") || "",
    navigator.platform,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || 0,
    (navigator as { deviceMemory?: number }).deviceMemory || 0,
  ];
  return simpleHash(parts.join("|"));
}

function getFontFingerprint(): string {
  const baseFonts = ["monospace", "sans-serif", "serif"];
  const testFonts = [
    "Arial", "Helvetica", "Times New Roman", "Georgia", "Courier New",
    "Verdana", "Impact", "Comic Sans MS", "Trebuchet MS", "Tahoma",
    "Palatino", "Garamond", "Bookman", "Arial Black", "Avant Garde",
  ];
  const testString = "mmmmmmmmmmlli";
  const testSize = "72px";
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return "nofont";

  const baseWidths: Record<string, number> = {};
  for (const base of baseFonts) {
    ctx.font = `${testSize} ${base}`;
    baseWidths[base] = ctx.measureText(testString).width;
  }

  const detected: string[] = [];
  for (const font of testFonts) {
    for (const base of baseFonts) {
      ctx.font = `${testSize} '${font}', ${base}`;
      if (ctx.measureText(testString).width !== baseWidths[base]) {
        detected.push(font);
        break;
      }
    }
  }
  return simpleHash(detected.join(","));
}

function getPluginsFingerprint(): string {
  const plugins: string[] = [];
  for (let i = 0; i < navigator.plugins.length; i++) {
    plugins.push(navigator.plugins[i].name);
  }
  return simpleHash(plugins.sort().join("|") + "|count:" + navigator.plugins.length);
}

export async function detectHeadlessBrowser(): Promise<boolean> {
  const signals: boolean[] = [
    navigator.webdriver === true,
    !(window as { chrome?: unknown }).chrome && navigator.userAgent.includes("Chrome"),
    navigator.plugins.length === 0 && !(/mobile/i.test(navigator.userAgent)),
    navigator.languages.length === 0,
    !!((window as { callPhantom?: unknown }).callPhantom || (window as { _phantom?: unknown })._phantom),
    !!((window as { __nightmare?: unknown }).__nightmare),
    document.documentElement.getAttribute("webdriver") !== null,
  ];
  const headlessCount = signals.filter(Boolean).length;
  return headlessCount >= 2;
}

export async function getDeviceFingerprint(): Promise<string> {
  if (cachedFingerprint) return cachedFingerprint;

  let fpJs = "fpjs-error";
  let audioFp = "audio-error";

  try {
    const results = await Promise.allSettled([
      timeoutWithFallback(
        FingerprintJS.load().then((fp) => fp.get()).then((r) => r.visitorId),
        5000,
        "fpjs-error"
      ),
      timeoutWithFallback(getAudioFingerprint(), 5000, "audio-timeout"),
    ]);

    if (results[0].status === "fulfilled") {
      fpJs = results[0].value;
    }
    if (results[1].status === "fulfilled") {
      audioFp = results[1].value;
    }
  } catch {
    // If loading FingerprintJS or audio generation fails, continue with safe fallback values.
  }

  const canvas = getCanvasFingerprint();
  const webgl = getWebGLFingerprint();
  const screenFp = getScreenFingerprint();
  const fonts = getFontFingerprint();
  const plugins = getPluginsFingerprint();

  const combined = [fpJs, canvas, webgl, audioFp, screenFp, fonts, plugins].join("::");
  const fpJsSuffix = fpJs.slice(0, 8);
  cachedFingerprint = simpleHash(combined) + "_" + fpJsSuffix;
  return cachedFingerprint;
}
