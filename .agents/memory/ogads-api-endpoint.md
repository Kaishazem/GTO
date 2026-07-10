---
name: OGAds API v2 endpoint
description: OGAds API v2 (saveapp.store) has no sub-path — the base URL is the endpoint.
---

The OGAds API v2 base URL `https://saveapp.store/api/v2` is itself the offers endpoint.
All sub-paths (`/offers`, `/feed`, `/offerwall`, etc.) return 404.

**How to apply:** When configuring OGAds, set `endpoint: ""` (empty). The base URL alone
returns 401 without auth and 200 with a valid Bearer token + `ip` + `user_agent` params.

**Why:** OGAds changed their API; the `/offers` sub-path no longer exists. Confirmed by
probing every common sub-path — all 404. Base URL + Bearer + ip + user_agent → 200 + offers array.

**Fix applied in:**
- `src/lib/platforms.ts` → `apiDefaults.endpoint: ""`
- `src/pages/AdminPage.tsx` → two spots: if `apiBase.includes("saveapp.store")`, force `endpoint = ""`
- Firestore doc updated: endpoint field cleared from "/offers" to ""

**Required query params:** `ip` (user's real IP), `user_agent` (user's UA string)
**Auth:** `Authorization: Bearer <token>`
**Response path:** `offers` array at top level (`json.offers`)
