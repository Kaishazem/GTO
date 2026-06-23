---
name: Firestore composite index pitfall
description: Compound queries silently crash onSnapshot listeners without error handlers
---

## The Problem

Firestore requires a composite index for any query with:
- Two or more `where()` clauses on different fields
- One `where()` + `orderBy()` on a different field

Without the index, `onSnapshot()` silently fails if no error callback is provided.

```js
// BROKEN — needs composite index (userId, deletedForUser, createdAt)
const q = query(
  collection(db, "notifications"),
  where("userId", "==", user.uid),
  where("deletedForUser", "==", false),
  orderBy("createdAt", "desc"),
  limit(100)
);
onSnapshot(q, (snap) => { ... }); // silently does nothing if index missing
```

## The Fix — Simplify to Single-Field Queries

Single equality filter uses the auto-created single-field index. `orderBy` alone uses the auto-created single-field index on the ordered field. Filter/sort client-side.

```js
// WORKS — single-field index only (auto-created by Firestore)
const q = query(
  collection(db, "notifications"),
  where("userId", "==", user.uid),
  limit(200)
);
onSnapshot(q, (snap) => {
  const notifs = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(n => !n.deletedForUser)         // client-side filter
    .sort((a, b) => b.createdAt - a.createdAt); // client-side sort
});
```

For `orderBy` alone (no `where`):
```js
query(collection(db, "systemMessages"), orderBy("createdAt", "desc"), limit(20))
// filter active:true client-side
```

## Always Add Error Handlers

```js
onSnapshot(q,
  (snap) => { /* handle data */ },
  (err) => { console.error("Listener failed:", err.code, err.message); }
);
```

## Indexes in This Project
- Missing composite indexes were for: notifications, systemMessages, tasks
- Added to firestore.indexes.json but must be deployed via Firebase Console links
- Code fix (simplify queries) is more reliable than relying on index deployment
