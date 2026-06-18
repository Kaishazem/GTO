---
name: Task interface platform fields
description: Optional fields added to Task interface that come from the Universal Platform Engine importer
---

The `Task` interface in `src/contexts/TaskContext.tsx` has these optional fields added for platform-imported tasks:
- `category`, `countries` (string[]), `devices` (string[]), `requirements`, `image`, `conversionType`, `externalId`

The `mapTask()` function reads them from Firestore with `toStringArray()` helper for arrays.

**Why:** The firestoreWriter.js in the import engine writes these canonical fields to every imported task document. The frontend interface was originally created before the import engine existed.

**How to apply:** When displaying task details, always guard with `?? trim()` or length checks before rendering — older manual tasks won't have these fields.
