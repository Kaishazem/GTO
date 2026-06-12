import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL, pathToFileURL } from 'node:url';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Dev-only plugin: intercepts /api/* requests and routes them to the
 * matching api/<name>.js Vercel-style handler.
 * Has no effect on production builds — Vercel handles /api/* natively.
 */
function apiDevPlugin(): Plugin {
  return {
    name: 'api-dev-server',
    configureServer(server) {
      server.middlewares.use(async (
        req: IncomingMessage,
        res: ServerResponse,
        next: () => void
      ) => {
        const url = req.url || '';
        if (!url.startsWith('/api/')) return next();

        // Set CORS headers immediately — before the handler runs — so that
        // even error responses (import failure, 500) carry correct CORS headers.
        // Reflect the incoming Origin so null-origin callers (Replit preview iframe) are allowed.
        const reqOrigin = (req.headers as Record<string, string | string[] | undefined>)['origin'];
        const originValue = Array.isArray(reqOrigin) ? reqOrigin[0] : (reqOrigin || '*');
        res.setHeader('Access-Control-Allow-Origin', originValue);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Vary', 'Origin');

        const parsed = new URL(url, 'http://localhost');
        const handlerName = parsed.pathname.slice('/api/'.length);
        if (!handlerName) return next();

        const handlerPath = path.join(__dirname, 'api', `${handlerName}.js`);

        // Parse query string into a plain object
        const query: Record<string, string> = {};
        parsed.searchParams.forEach((v, k) => { query[k] = v; });

        // Read and parse request body for POST / PUT
        let body: Record<string, unknown> = {};
        const method = req.method || 'GET';
        if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
          const chunks: Buffer[] = [];
          for await (const chunk of req as AsyncIterable<Buffer>) {
            chunks.push(chunk);
          }
          const raw = Buffer.concat(chunks).toString('utf8');
          if (raw) {
            try { body = JSON.parse(raw); } catch { /* non-JSON body — leave as {} */ }
          }
        }

        // Vercel-compatible req shim
        const fakeReq = {
          method,
          url,
          query,
          body,
          headers: req.headers,
        };

        // Vercel-compatible res shim (supports chaining: res.status(n).json(...))
        let statusCode = 200;
        const responseHeaders: Record<string, string | string[]> = {};
        let settled = false;

        const settle = (code: number, headers: Record<string, string | string[]>, payload: string | null) => {
          if (settled) return;
          settled = true;
          const allHeaders: Record<string, string | string[]> = { ...responseHeaders, ...headers };
          if (payload !== null) {
            allHeaders['Content-Length'] = String(Buffer.byteLength(payload));
          }
          res.writeHead(code, allHeaders);
          payload !== null ? res.end(payload) : res.end();
        };

        const fakeRes = {
          statusCode,
          status(code: number) { statusCode = code; return fakeRes; },
          setHeader(k: string, v: string | string[]) { responseHeaders[k] = v; return fakeRes; },
          json(data: unknown) {
            settle(statusCode, { 'Content-Type': 'application/json' }, JSON.stringify(data));
            return fakeRes;
          },
          send(data: unknown) {
            settle(statusCode, { 'Content-Type': 'text/plain' }, String(data));
            return fakeRes;
          },
          end() {
            settle(statusCode, {}, null);
            return fakeRes;
          },
        };

        try {
          // Bypass the Node.js ESM module cache by appending a timestamp query param.
          // Without this, any code change to an api/*.js file is silently ignored
          // for the lifetime of the dev server process (modules are cached by URL).
          const handlerUrl = `${pathToFileURL(handlerPath).href}?t=${Date.now()}`;
          const mod = await import(handlerUrl);
          const handler = mod.default ?? mod;
          if (typeof handler !== 'function') {
            throw new Error(`api/${handlerName}.js does not export a default function`);
          }
          await handler(fakeReq, fakeRes);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[api-dev] ✖ /api/${handlerName}:`, e);
          if (!settled) {
            settle(500, { 'Content-Type': 'application/json' }, JSON.stringify({ error: msg }));
          }
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), apiDevPlugin()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5000,
    allowedHosts: true,
  },
  build: {
    chunkSizeWarningLimit: 1600,
  },
});
