---
name: iPhone composer layout
description: Real-device validation and preservation rules for Lumen's mobile chat composer.
---

Preserve the mobile chat composer's positioning, safe-area handling, message-pane scrolling, and visual-viewport keyboard handling. The user subsequently requested a compact, content-growing input and a Send button aligned alongside it on narrow screens.

**Why:** The original layout was verified on a real iPhone with the iOS keyboard open. That device check predates the compact-input change; the newer layout has only been visually checked in the development preview.

**How to apply:** Do not alter viewport-height calculations, safe-area offsets, scroll container, or composer placement without an explicit request and new real-device validation. If investigating keyboard-specific regressions in the compact input, validate on a real iPhone rather than treating the preview check as equivalent.