---
name: Vercel function count fix
description: How api/modules/ was renamed to avoid Vercel counting shared modules as serverless functions
---

Vercel auto-discovers all JS files in api/ (including subdirectories) as serverless functions unless the directory name starts with underscore.

**Rule:** Shared utility modules in api/ must live in api/_modules/ (underscore prefix) to be excluded from Vercel's function discovery.

**Why:** With 4 handler files + 9 module files = 13 total, which exceeds Vercel Hobby plan's 12-function limit.

**How to apply:** Any new shared modules added under api/ must go into api/_modules/. Import paths use `./_modules/filename.js`. Only api/import-platform.js currently uses these modules.
