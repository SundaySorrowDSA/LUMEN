---
name: Generated client typecheck
description: Workspace-specific TypeScript constraint for generated API clients.
---

Generated API client code uses `Headers.entries()`. Composite client packages must include both `dom` and `dom.iterable` in their TypeScript `lib` list or the workspace typecheck fails even when codegen succeeds.

**Why:** The generated client depends on the iterable DOM typings, while the monorepo's default composite library settings do not include them.

**How to apply:** When adding or regenerating a browser API client package, check its `tsconfig.json` includes `dom.iterable` before debugging generated-code errors.