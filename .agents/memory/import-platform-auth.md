---
name: import-platform handler authentication
description: How the universal platform importer authenticates with Firestore REST API
---

## Rule
The `api/import-platform.js` handler must receive a `firebaseIdToken` in the request body from the frontend. It attaches this as `Authorization: Bearer <token>` to all Firestore REST API calls (reads and writes).

## Why
Firestore security rules require `request.auth != null` (isSignedIn) for platforms reads and `isAdmin()` for task writes. The serverless handler has no service account and uses only the web API key — without an ID token, all Firestore calls are rejected with 403 PERMISSION_DENIED. The handler silently treated 403 as "not found", producing misleading errors.

## How to apply
- Frontend: call `auth.currentUser?.getIdToken()` and pass as `firebaseIdToken` in every POST to `/api/import-platform`
- Handler: destructure `firebaseIdToken` from `req.body`; build `authHeaders = firebaseIdToken ? { Authorization: "Bearer ..." } : {}`; spread `authHeaders` into every `fetch()` targeting Firestore
- `updatePlatformStatus(fsBase, id, key, authHeaders, fields)` — authHeaders is the 4th argument
- All other serverless handlers that write to protected Firestore collections need the same pattern
