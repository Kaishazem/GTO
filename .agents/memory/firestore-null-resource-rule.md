---
name: Firestore null-resource rule bug
description: Why getDoc on non-existent docs fails for regular users and how to fix it
---

## The Rule

In Firestore security rules, when a document does NOT exist:
- `resource` is `null`
- Accessing `resource.data.anything` throws in the rule evaluator
- The rule returns `false` → **permission-denied** is returned to the client

## Affected Pattern

```js
match /notifications/{notifId} {
  allow read, update: if isSignedIn() && resource.data.userId == request.auth.uid;
}
```

When a regular user calls `getDoc(ref)` on a notification that doesn't exist yet:
- Firestore evaluates `resource.data.userId` → `null.data.userId` → throws
- Client receives `FirebaseError: permission-denied`
- Any `catch {}` block silently swallows it
- The intended `setDoc` to create the doc **never runs**

Admins are unaffected because `allow read, write: if isAdmin()` never touches `resource.data`.

## The Fix (two parts)

### 1. firestore.rules — add `resource == null` guard
```js
match /notifications/{notifId} {
  allow create: if isSignedIn() && request.resource.data.userId == request.auth.uid;
  allow read: if isSignedIn() && (resource == null || resource.data.userId == request.auth.uid);
  allow update: if isSignedIn() && resource.data.userId == request.auth.uid;
  allow read, write: if isAdmin();
}
```

### 2. notifications.ts — fallback setDoc on permission-denied
```js
try {
  const existing = await getDoc(ref);
  if (existing.exists()) return;
  await setDoc(ref, data);
} catch {
  // getDoc threw permission-denied (doc doesn't exist, resource==null in rule)
  // Fall through to direct create — CREATE rule uses request.resource.data (always defined)
  try {
    await setDoc(ref, data);
  } catch {}
}
```

**Why**: The `create` rule uses `request.resource.data` (the incoming data being written), which is always defined. So `setDoc` for a new doc is allowed for authenticated users where `request.resource.data.userId == request.auth.uid`.

## Key Insight
- `resource.data` = existing document's data (null if doc doesn't exist)
- `request.resource.data` = data being written (always defined for write ops)
- Rules with `resource.data` on read ops MUST guard with `resource == null ||`
