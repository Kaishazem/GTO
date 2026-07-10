---
name: OGAds API v2 endpoint and query parameters
description: OGAds API v2 (saveapp.store) has no sub-path; the base URL IS the endpoint. Requires Bearer auth and real ip/user_agent query params.
---

## Rule
- Base URL: `https://saveapp.store/api/v2` — this IS the full endpoint. No sub-path (`/offers`, `/feed`, etc.) exists; all return 404.
- Auth: `Authorization: Bearer <token>` — NOT a query-param api_key.
- Required query params: `ip` (valid IP, e.g. `8.8.8.8`) and `user_agent` (real UA string). If either is absent or a template placeholder like `{ip}`, the API returns `{"success":false,"error":{"ip":["The ip field must be a valid IP address."]},"offers":null}`.
- Response structure: `{"success":true,"error":null,"offers":[...]}` — `responsePath="offers"` is correct.

## The actual import handler
`server/routes/import-platform.ts` (Express, port 5001) — NOT `api/import-platform.js`.  
Vite proxies `/api` → `http://localhost:5001`.

## What was fixed
1. Firestore `endpoint` cleared from `"/offers"` → `""`.
2. Firestore `authenticationType` updated from `"queryParam"` → `"bearer"`.
3. Firestore `queryParameters` updated from `{"ip":"{ip}","user_agent":"{user_agent}"}` → real values.
4. Three normalization blocks in `src/pages/AdminPage.tsx` now enforce all three corrections at runtime (so stale Firestore values can never re-break the import).

**Why:** The `{ip}` and `{user_agent}` placeholders are meant for end-user passthrough in offerwall embeds, but for server-side imports a static default is required. OGAds validates the `ip` field server-side and returns `offers: null` (not an empty array) on validation failure — which causes `!Array.isArray(raw)` to trigger a 502 in the Express handler.

**How to apply:** Any future edit to OGAds platform config must keep `ip` as a real IPv4 address and `user_agent` as a non-template string. The runtime guards in AdminPage.tsx replace any value starting with `{` automatically.
