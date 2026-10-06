---
name: iOS test entry points
description: Why LUMEN browser tests need an accessible in-app entry point on iOS.
---

The user reported that the “API Server” Presented Output card is not interactive on iOS, so it cannot be relied on as the way to trigger a LUMEN test endpoint.

**Why:** The image-generation endpoint existed, but the user could not trigger it from that card.

**How to apply:** When providing a LUMEN test control intended for this user's iOS browser, make it reachable in the existing Workspace rather than requiring interaction with an API artifact card. Keep temporary test results separate from chat and persistence when requested.

Do not attribute errors triggered by the Replit iOS preview toolbar to LUMEN based on the overlay's name. Native preview controls cannot be exercised by a normal screenshot of the web app.

**Why:** The user reported that the native preview Share control repeatedly raises a generic runtime overlay, while the Share sheet itself still opens successfully. Replit's injected reporter normalizes non-Error values; the generic popup alone does not establish the error's owner or prove that sharing failed.

**How to apply:** Preserve the original error/rejection fields without cancelling events or disabling the overlay, and obtain an actual iOS reproduction before assigning ownership. Distinguish a missing original stack from a diagnostic observer's stack.
