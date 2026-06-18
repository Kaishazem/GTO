---
name: Notification system architecture
description: How notifications are created, deduped, and displayed in GTO
---

## Collections
- `/notifications/{docId}` — per-user notifications. DocID = `{userId[0:12]}_{dedupeKey}` (deterministic).
- `/systemMessages/{msgId}` — admin broadcast messages (active: true/false toggle).

## Deduplication
`createNotification()` in `src/lib/notifications.ts` does a `getDoc()` before `setDoc()`. If the doc already exists, it returns early — no overwrite, no duplicate. The dedupeKey is embedded in the doc ID.

## Trigger architecture (NotificationContext.tsx)
Five separate `onSnapshot` listeners per user:
1. `/notifications` filtered by `userId` — the display listener
2. `/taskCompletions` filtered by `userId` — completion status changes
3. `/tasks` (active==true, ordered by createdAt) — new task published events
4. `/systemMessages` (active==true) — admin broadcasts
5. `/withdrawals` filtered by `userId` — withdrawal status changes

**Initial-load guard:** Each listener tracks `initialized` ref. On first snapshot, `added` change type events are recorded to `processedRef` (Set) without creating notifications — only subsequent `added` or `modified` events fire notifications.

**Why:** Prevents firing notifications for all existing completions/tasks on every app load.

## Status → notification mapping
completion status changes:
- `platform_pending` → "Task Submitted" (⏳)
- `platform_approved` → "Platform Approved ✅" (🔄)
- `approved` → "Reward Approved 🎉" (💰)
- `rejected` → "Task Rejected" (❌)

## User controls
- `markRead(id)` — update `read: true`
- `markAllRead()` — writeBatch for all unread
- `deleteNotif(id)` — update `deletedForUser: true` (soft delete, Firestore record preserved)
