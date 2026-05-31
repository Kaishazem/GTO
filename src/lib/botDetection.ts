const RATE_LIMIT_KEY = "gto_reg_attempts";
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60 * 60 * 1000;

interface RateLimitStore {
  attempts: number[];
}

export function checkRateLimit(): { allowed: boolean; remaining: number; resetIn: number } {
  const raw = localStorage.getItem(RATE_LIMIT_KEY);
  const now = Date.now();
  const store: RateLimitStore = raw ? (JSON.parse(raw) as RateLimitStore) : { attempts: [] };
  const recent = store.attempts.filter((t) => now - t < WINDOW_MS);
  const remaining = Math.max(0, MAX_ATTEMPTS - recent.length);
  const oldest = recent[0] || now;
  const resetIn = Math.max(0, WINDOW_MS - (now - oldest));
  return { allowed: recent.length < MAX_ATTEMPTS, remaining, resetIn };
}

export function recordAttempt(): void {
  const raw = localStorage.getItem(RATE_LIMIT_KEY);
  const now = Date.now();
  const store: RateLimitStore = raw ? (JSON.parse(raw) as RateLimitStore) : { attempts: [] };
  store.attempts = store.attempts.filter((t) => now - t < WINDOW_MS);
  store.attempts.push(now);
  localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(store));
}

export function detectHeadlessBrowser(): boolean {
  const signals = [
    navigator.webdriver === true,
    !(window as { chrome?: unknown }).chrome && navigator.userAgent.includes("Chrome") && !(/mobile/i.test(navigator.userAgent)),
    navigator.plugins.length === 0 && !(/Android|iPhone|iPad/i.test(navigator.userAgent)),
    navigator.languages.length === 0,
    !!(window as { callPhantom?: unknown }).callPhantom,
    !!(window as { _phantom?: unknown })._phantom,
    !!(window as { __nightmare?: unknown }).__nightmare,
    document.documentElement.getAttribute("webdriver") !== null,
    !!(window as { domAutomation?: unknown }).domAutomation,
    !!(window as { domAutomationController?: unknown }).domAutomationController,
  ];
  return signals.filter(Boolean).length >= 2;
}

export function detectSuspiciousUserAgent(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  const suspicious = [
    "headlesschrome", "phantomjs", "nightmare", "selenium",
    "webdriver", "puppeteer", "playwright", "zombie", "slimerjs",
    "htmlunit", "python-requests", "curl/", "wget/", "scrapy",
  ];
  return suspicious.some((s) => ua.includes(s));
}

export function createTimingChecker(): { check: (minMs?: number) => boolean } {
  const startTime = Date.now();
  return {
    check(minMs = 3000) {
      return Date.now() - startTime >= minMs;
    },
  };
}

export function checkHoneypot(value: string): boolean {
  return value.length > 0;
}
