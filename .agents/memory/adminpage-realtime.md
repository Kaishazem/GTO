---
name: AdminPage real-time Firestore listeners
description: Pattern used for real-time data in AdminPage and when each listener was added
---

Three onSnapshot listeners were added to AdminPage in dedicated useEffects (dependency: `[profile?.role]`):

1. `tasks` collection → replaces fetchTasks() on mount; onSnapshot auto-fires on task add/delete/edit
2. `platforms` collection → replaces fetchPlatforms() on mount; mapping logic mirrors fetchPlatforms (legacy field resolution)
3. `taskCompletions` collection → replaces fetchManualCompletions() on mount; uses per-doc getDoc cache for tasks/users to avoid full collection reads on each snapshot

**Why:** One-shot getDocs meant counters and lists didn't update without page refresh.

**How to apply:** Keep fetchTasks/fetchManualCompletions/fetchPlatforms functions (they're still called after mutations in a few places and are exported-compatible). The onSnapshot listeners provide the initial data load and live updates. Return the unsub function from useEffect for cleanup.

AuthContext.tsx: The existing user-doc onSnapshot was extended to also update `profile.balance` and `profile.pendingBalance` in real-time.

TaskContext.tsx: The useEffect now uses onSnapshot for both tasks (with active+networkStatus+status filters) and taskCompletions (filtered by userId). loadMoreTasks still uses getDocs for pagination beyond the initial limit.
