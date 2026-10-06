---
name: Home Screen artwork preservation
description: Why LUMEN installation icons preserve the full supplied artwork rather than using adaptive crops.
---

Preserve the full user-supplied Home Screen artwork without cropping or distorting it.

**Why:** The user explicitly required full-image preservation. Declaring an edge-to-edge image as maskable permits platform crops that conflict with that requirement.

**How to apply:** Resize proportionally, pad only when needed for square dimensions, and use ordinary manifest icons rather than claiming maskable-safe artwork. Leave unrelated app behavior and UI unchanged during icon work.
