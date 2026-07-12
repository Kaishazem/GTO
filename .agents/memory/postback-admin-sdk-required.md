---
name: Vercel postback endpoints must use Firebase Admin SDK, not REST+API-key
description: Why OGAds/CPA conversions silently failed to appear in the app despite HTTP 200 responses.
---

## Rule
Any `api/*.js` Vercel serverless function that writes to Firestore collections guarded by
`isAdmin()` or `isSignedIn()` security rules (e.g. `taskCompletions`, `postbackConversions`,
`postbackLogs`) MUST use the Firebase Admin SDK (service-account credentials), not the public
REST API with only `?key=<client API key>`.

## Why
The Firestore REST API with just an API key is an **unauthenticated** request as far as
Security Rules are concerned — `request.auth` is null. Rules like
`allow read, write: if isAdmin();` or the `taskCompletions` update rule (which requires
`resource.data.userId == request.auth.uid`) reject it with PERMISSION_DENIED. `api/postback.js`
and `api/postbacks-admin.js` were written this way and every write/read silently failed —
caught in try/catch, logged as a warning, and the postback endpoint still returned HTTP 200
"settled" to the ad network. Conversions never reached Firestore even though the network's
dashboard showed the postback fired successfully.
`server/postback/engine.ts` (the dev/Express implementation) already used the Admin SDK and
worked correctly — the two implementations had drifted.

## How to apply
- Mirror the Admin SDK init pattern already used in `api/broadcast.js` (env vars
  `FIREBASE_ADMIN_CLIENT_EMAIL`/`FIREBASE_ADMIN_PRIVATE_KEY`/`FIREBASE_PROJECT_ID`, with PEM
  single-line reformatting).
- When adding a new server-side write path under `api/`, check whether the target collection's
  Firestore rule requires `request.auth` — if so, use the Admin SDK, never REST+API-key.
- Confirm the Vercel project's environment variables include the Admin SDK credentials
  (not just the `VITE_FIREBASE_*` client keys) — they are a separate set of secrets.
