---
name: Settlement Architecture
description: There is exactly one valid settlement path for wallet operations. Two imports existed in AdminPage — one was dead code.
---

## Rule
Only `settleTaskCompletion` from `@/lib/walletSettlement` should be used to settle completions in client-side code. Import it as `settleWalletCompletion` to avoid naming confusion with the postback adapter in taskSettlement.ts.

## Why
AdminPage previously imported BOTH `settleTaskCompletion` from `taskSettlement` AND from `walletSettlement`. The taskSettlement import was dead code (never called). Leaving it created risk of accidentally routing settlements through the wrong path.

## How to apply
```ts
import { settleTaskCompletion as settleWalletCompletion } from "@/lib/walletSettlement";
```
`taskSettlement.ts` exists only as a DocumentRef-based adapter — do not use it for direct admin decisions.
