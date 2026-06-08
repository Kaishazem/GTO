---
name: Reconciliation taskType Bug
description: comparePlatformReport had a dangerous || "platform" fallback that caused manual tasks without a taskType field to appear as platform mismatches.
---

## Rule
In `comparePlatformReport` (reconciliation.ts), always infer taskType using the same pattern as `fetchGlobalReconciliation`: explicit field wins, then fall back to `hasVerifiedBy ? "platform" : "manual"`. Never use `|| "platform"` as the default.

## Why
`|| "platform"` caused old completions without an explicit `taskType` field to be included in the platform comparison, where they'd show up as "missingInPlatform" — blocking legitimate withdrawals.

## How to apply
Use this exact pattern everywhere taskType must be inferred from a Firestore document:
```js
const explicit = d.data().taskType as string | undefined;
const hasVerifiedBy = !!d.data().verifiedBy;
const taskType = explicit === "manual" || explicit === "platform"
  ? explicit : hasVerifiedBy ? "platform" : "manual";
```
