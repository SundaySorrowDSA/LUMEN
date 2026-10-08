---
name: Schema drift safety
description: An existing unrelated database table is absent from the released Drizzle definitions.
---

Preserve the existing `assistant_submissions` database table unless the user explicitly authorizes its removal. Its presence in development and production does not mean it is declared in the current Drizzle source.

**Why:** Earlier publication retained that table, but the reminder-focused branch does not define it. A blanket Drizzle schema push could therefore remove unrelated data, contrary to the user's reminder-only migration requirement.

**How to apply:** Compare the actual database schema with source definitions before a broad schema push. Apply only the required development changes when unrelated drift exists, and inspect the development-to-production Publish diff separately. Do not treat an empty Publish diff as proof that Drizzle source matches the database.
