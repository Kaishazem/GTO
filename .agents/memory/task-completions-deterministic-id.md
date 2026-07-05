---
name: taskCompletions deterministic ID
description: One-doc-per-user-task guarantee via deterministic IDs; why React state must never be the source of truth for completion lookup.
---

## The Rule

Every `taskCompletions` document uses a **deterministic ID**: `${userId}_${taskId}`.

Both client (`TaskContext.tsx`) and engine (`server/postback/engine.ts`) share the same ID formula. This guarantees:
- At most ONE document per (userId, taskId) pair — structurally, not just by convention
- `setDoc()` is idempotent for creation (no duplicate on concurrent calls)
- `getDoc(completionRef)` replaces `completions.find()` — O(1) lookup, always fresh from Firestore

## The Bug This Fixes

`completions.find(c => c.taskId === taskId)` uses React state, which is asynchronously updated. Between a `startTask()` write and the `onSnapshot` listener propagating back, the state still reads empty. A rapid `completeTask()` call would miss the existing document, fall through to the `addDoc()` fallback, and create a **second document** — the root of the duplicate bug.

**Why:** React state is for rendering, not for authoritative business logic decisions. Any write path that decides "does this document exist?" must ask Firestore directly.

## How to Apply

- `startTask()`: use `runTransaction` → `tx.get(completionRef)` → if not exists, `tx.set()`
- `completeTask()`: use `getDoc(completionRef)` first, then `runTransaction` for atomic update + `pendingBalance` increment
- Engine's `findActiveCompletion()`: `getDoc(completionDocId(userId, taskId))` first; fall back to collection query for legacy auto-ID docs
- Never use `addDoc()` for task completions

## Legacy Compatibility

Older documents created before this migration have Firestore auto-generated IDs. The engine still falls back to a collection query (`where taskId == X && userId == Y && status in [...]`) to find them. The client's `completeTask()` also runs a legacy query before giving up on finding an existing document. Once a legacy document is touched, the canonical deterministic-ID document is written and becomes authoritative going forward.

## Firestore Rules Changes (same PR)

- `allow read`: added `resource == null ||` guard (null-resource bug — without it, `tx.get()` on a non-existent doc throws permission-denied)
- `allow update`: users can now update their OWN completion, restricted to valid status transitions only:
  - `started` / `platform_pending` → `user_confirmed`
  - `postback_verified` → `platform_approved`
  - `reward`, `userId`, `taskId` are immutable by users
