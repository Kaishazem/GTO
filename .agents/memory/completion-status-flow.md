---
name: Completion status flow
description: The 5 TaskCompletion statuses and how they map to UI filters/badges
---

TaskCompletion.status has 5 values:
1. `pending` — manual task, awaiting admin review
2. `platform_pending` — platform task, awaiting platform postback
3. `platform_approved` — platform approved, awaiting admin wallet settlement
4. `approved` — admin settled, reward credited to wallet
5. `rejected` — rejected by platform OR admin (full settle reverses any hold)

UI filter mapping in TasksPage:
- "In Progress" filter covers: pending, platform_pending, platform_approved
- "Approved" filter: approved only
- "Rejected" filter: rejected only

**Why:** Users don't need to understand the internal two-step; they just care if the task is in flight, approved, or rejected.

**How to apply:** `matchesActivityFilter()` in TasksPage.tsx handles this mapping. Don't split pending/platform_pending/platform_approved into separate user-facing filters.
