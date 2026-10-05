---
name: iOS test entry points
description: Why LUMEN browser tests need an accessible in-app entry point on iOS.
---

The user reported that the “API Server” Presented Output card is not interactive on iOS, so it cannot be relied on as the way to trigger a LUMEN test endpoint.

**Why:** The image-generation endpoint existed, but the user could not trigger it from that card.

**How to apply:** When providing a LUMEN test control intended for this user's iOS browser, make it reachable in the existing Workspace rather than requiring interaction with an API artifact card. Keep temporary test results separate from chat and persistence when requested.
