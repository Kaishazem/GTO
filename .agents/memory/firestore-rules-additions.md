---
name: Firestore rules new collections
description: Security rules for notifications and systemMessages added in Phase 4
---

Both collections added to `firestore.rules` (bottom of the match block):

```
/notifications/{notifId}:
  create: isSignedIn() && request.resource.data.userId == request.auth.uid
  read, update: isSignedIn() && resource.data.userId == request.auth.uid
  read, write: isAdmin() (also covers admin access)

/systemMessages/{msgId}:
  read: isSignedIn()
  write: isAdmin()
```

**Why:** The `notifications` collection uses deterministic doc IDs (userId prefix + dedupeKey), so create is the primary write operation. `update` allows mark-read and soft-delete. The systemMessages collection is globally readable by authenticated users so the realtime listener can detect new broadcasts.

**How to apply:** Any new Firestore collection added to the client MUST have a corresponding rule in `firestore.rules` or ALL operations will be denied in production. Remember to deploy rules via Firebase CLI after changes.
