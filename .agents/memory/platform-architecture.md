---
name: Dynamic Platform Architecture
description: How the platform management and import system works — fully dynamic, no hardcoded platform names.
---

## Rule
The `api/import-platform.js` must remain platform-agnostic — no `if(platform==="adgem")` or switch blocks. All config (auth type, API URL, field mapping, response path) is read from Firestore `platforms/{platformId}`.

## Why
Refactored per explicit requirement: admin must be able to add any future ad network from the Admin Panel without touching source code.

## How to apply
- New platforms → add via Admin Panel → Platforms tab → Add Platform form
- Firestore document fields: `apiBase`, `endpoint`, `authenticationType`, `apiKey`, `apiKeyParam`, `apiKeyHeaderName`, `basicAuthUser`, `requestMethod`, `headers` (map), `queryParameters` (map), `responsePath`, `offerMapping` (map), `autoImport`, `importInterval`
- Import API writes back: `importStatus`, `lastImportAt`, `lastImportCount`, `totalOffersFound`, `lastImportDurationMs`, `lastError`
- `runAutoImport()` filters Firestore platforms where `enabled=true AND autoImport=true AND apiBase` is set — no network keys from settings needed
- The old `AD_NETWORKS` constant and settings-tab API key section have been removed; secrets live only in platform documents, never in task documents

## Safety
Withdrawals, reconciliation, wallet settlement, and revenue systems were NOT modified.
