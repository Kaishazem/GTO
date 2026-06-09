---
name: Dev API routing via Vite plugin
description: There is no Express or backend server. /api/* routes are served in dev via a Vite configureServer middleware plugin that shims the Vercel handler interface.
---

## Rule
Do NOT add Express, a separate dev server, or a Vite proxy to a remote port.
The `apiDevPlugin()` in `vite.config.ts` intercepts `/api/*` via `server.middlewares.use()`, reads the request body, and calls the matching `api/<name>.js` Vercel-style handler directly.

## Why
The project is a pure Vite + React SPA deployed to Vercel. Vercel handles `/api/*.js` natively in production. In development, those routes 404 because Vite only serves the SPA. A Vite configureServer plugin is the correct minimal fix — no new packages, no new ports, no duplicate logic.

## How to apply
- Plugin is inline in `vite.config.ts` as `apiDevPlugin()`
- Uses `pathToFileURL(handlerPath).href` for cross-platform Node.js ESM import
- Shims `req.body`, `req.query`, `res.status().json()`, `res.setHeader()`, `res.end()` to match Vercel handler signature
- Only active during `vite dev` — has zero effect on production builds
- Handler files must export a default function: `export default async function handler(req, res) {...}`

## Key constraint
`api/*.js` files use Vercel's `(req, res)` signature, NOT Express or Node's raw `http.IncomingMessage/ServerResponse`. Always shim both sides.
