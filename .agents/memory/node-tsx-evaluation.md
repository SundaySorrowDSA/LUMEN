---
name: Node tsx evaluation
description: A runtime quirk when running one-off TypeScript-aware diagnostics without editing workspace files.
---

For short read-only diagnostics that import TypeScript modules, use `node --import tsx -e` with dynamic `import()` inside an async function; do not combine `--import tsx` with `--input-type=module` on this Node 24 toolchain.

**Why:** Both stdin and `--eval` forms with `--input-type=module` failed with `ERR_INPUT_TYPE_NOT_ALLOWED` from the tsx loader, even though ordinary `-e` succeeded.

**How to apply:** Use an async IIFE around the dynamic imports. This is a command-line diagnostic convention, not an application runtime requirement.