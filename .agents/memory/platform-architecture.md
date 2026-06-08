---
name: Dynamic Platform Architecture
description: How the platform management and postback/import system works — fully dynamic, no hardcoded platform names.
---

## Rule
`api/import-platform.js` and `api/postback.js` must remain platform-agnostic — no `if(platform==="adgem")` or switch blocks. All config (auth type, API URL, field mapping, postbackSecret, signatureMethod) is read from Firestore `platforms/{platformId}`.

## Why
Refactored per explicit requirement: admin must be able to add any future ad network from the Admin Panel without touching source code.

## How to apply — Import
- New platforms → Admin Panel → Platforms tab → Add Platform form
- Firestore fields: `apiBase`, `endpoint`, `authenticationType`, `apiKey`, `apiKeyParam`, `apiKeyHeaderName`, `basicAuthUser`, `requestMethod`, `headers` (map), `queryParameters` (map), `responsePath`, `offerMapping` (map), `autoImport`, `importInterval`
- Import API writes back: `importStatus`, `lastImportAt`, `lastImportCount`, `totalOffersFound`, `lastImportDurationMs`, `lastError`

## How to apply — Postback
- Postback URL format: `/api/postback?platform=PLATFORM_ID&user_id=USER_ID&task_id=TASK_ID&conv_id=CONV_ID&status=approved&amount=PAYOUT&secret=SECRET`
- Firestore fields per platform: `postbackSecret`, `signatureMethod` ('secret' | 'hmac_sha256' | 'none')
- Deduplication: `postbackConversions/{base64(platformId:convId)}` — document created immediately as lock
- Logs: every event (received/settled/duplicate/invalid) written to `postbackLogs`
- Settlement: updates taskCompletion (status, verifiedBy=platform:platformId, taskType=platform) + user balance + walletTransaction
- `verifiedBy = platform:{platformId}` makes it visible to reconciliation as a platform-verified completion
- Duplicate + replay (5min window) prevention built in
- Always returns HTTP 200 to ad networks (retries won't re-settle — idempotent)

## Admin monitoring
- `/api/postbacks-admin?secret=SECRET&status=settled&platform=ID` → JSON with conversions, logs, stats
- AdminPage Postbacks tab: stat cards, filterable conversion history, per-platform breakdown, audit log, postback URL reference

## Safety
Withdrawals, reconciliation, wallet settlement, and revenue systems were NOT modified.
Reconciliation works correctly because settled postbacks set `verifiedBy` and `taskType=platform`.
