---
name: Postback dual-implementation must stay byte-identical, not just functionally similar
description: Express (server/postback/engine.ts) and Vercel (api/postback.js) postback handlers process the same real-world events and must produce identical Firestore writes.
---

## Rule
`server/postback/engine.ts` (Express/dev) and `api/postback.js` (Vercel/production) are two
runtimes for the *same* logic. Parsing/adapters were already correctly mirrored
(`server/postback/parser.ts`+`adapters.ts` vs `api/_modules/postbackParser.js`+`postbackAdapters.js`).
But "same outcome" isn't enough — they must produce byte-identical Firestore writes for the
same input, specifically:
- `postbackConversions` document ID = the raw `dedupKey` string (`${platformId}_${convId}` or
  `${platformId}_${userId}_${taskId}`), never a re-encoded/hashed version of it.
- Exactly one write to `postbackConversions` per event, after the final status is known —
  not an early "lock" write followed by an update.
- `postbackLogs` documents contain only `{type, message, platformId, userId, taskId, convId,
  completionId, amount, processingMs, receivedAt, createdAt}` — no extra fields one
  implementation invented that the other (or the admin reader) doesn't expect.

## Why
One version had silently re-encoded the doc ID (base64) and split the write into two steps.
Functionally each endpoint returned the right HTTP status on its own, but the same real
conversion event would land in a *different* Firestore document depending on which endpoint
processed it, defeating dedup consistency between environments and making the two
implementations impossible to verify against each other.

## How to apply
Any time either `server/postback/engine.ts` or `api/postback.js` changes, diff the other file's
equivalent section and check: same doc-ID formula, same write count/order, same field set on
every collection they touch. Do not "improve" one side without porting the exact same change
to the other, or the byte-identical guarantee breaks again.
