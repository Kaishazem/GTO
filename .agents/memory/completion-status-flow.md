---
name: Completion status flow
description: Async lifecycle for task completions — both event orderings supported, how pendingBalance is managed, what each status means.
---

## Status Machine (redesigned for async CPA postbacks)

### Platform tasks (CPA/offerwall)
```
started
  ├── postback arrives first → postback_verified → (user confirms) → platform_approved
  └── user confirms first   → user_confirmed    → (postback arrives) → platform_approved
                                                                             ↓
                                                                        approved (admin settles)
                                                                        rejected
```

### Manual tasks (unchanged)
```
pending → approved | rejected
```

### Legacy status
`platform_pending` = pre-redesign combined start+confirm. Engine treats it as `user_confirmed`.

## Key Rules

- `startTask()` creates a `started` record immediately when user opens the offer URL. No pendingBalance change.
- `completeTask()` advances the status and increments pendingBalance (only once, at user confirmation).
- Engine on approved postback: if `user_confirmed` → `platform_approved` (both done); if `started`/`platform_pending` → `postback_verified`.
- Engine on rejected postback when user already confirmed: reverses pendingBalance via Admin SDK transaction.
- `platform_approved` is the only status admin can settle.

## "In Progress" UI filter covers
`started`, `user_confirmed`, `postback_verified`, `pending`, `platform_pending`, `platform_approved`

## Duplicate Reward Prevention
1. `postbackConversions` dedupKey prevents double postback processing.
2. `walletSettlement.ts` `settlementStatus` guard prevents double settlement.
3. `pendingBalance` incremented only once at user confirmation.

**Why:** CPA networks are async — postback may arrive before or after user clicks "Completed Task". The old design skipped conversions when no pending completion existed at postback time.
