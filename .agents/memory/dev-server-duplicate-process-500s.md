---
name: Duplicate dev workflow processes cause blanket 500s after ~18s
description: All API routes (even /api/health) return an empty-body 500 after a long hang when stray duplicate dev processes are bound to the same ports.
---

## Symptom
Every request to the Express dev server (even a trivial route with no logic, e.g. `/api/health`)
hangs for ~18 seconds then returns `HTTP 500` with an empty body, `content-type: text/plain`,
and a `vary: Origin` header — not the app's own JSON error shape. This looks like an
application bug (e.g. in a specific route's Firestore query) but isn't; it reproduces on
every route because the process holding the "real" listening socket is contended by a
duplicate instance.

## Why
Multiple copies of the dev workflow (`concurrently` → `vite` + `tsx watch server/index.ts`)
were running at once, e.g. from a prior restart that didn't fully clean up. Two processes
racing for the same ports produced hung/half-broken sockets that eventually times out with a
generic 500, rather than a clean `EADDRINUSE` crash.

## How to apply
Before debugging a reported "Server returned 500" on a specific route, first hit an unrelated
trivial route (e.g. a health check) with `curl` and time it:
- Fast + 200 → the failure is real and route-specific; debug the route's logic.
- Slow (~15-20s) + empty-body 500 on *every* route → check `ps aux | grep -E "tsx|vite"` for
  duplicate processes, kill them all, and do a clean workflow restart before touching any code.
