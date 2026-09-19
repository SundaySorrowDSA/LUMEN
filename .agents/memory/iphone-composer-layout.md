---
name: iPhone composer layout
description: Real-device validation and preservation rules for Lumen's mobile chat composer.
---

Preserve the mobile chat composer's positioning, sizing behavior, safe-area handling, message-pane scrolling, Send button placement, and visual-viewport keyboard handling.

**Why:** This layout was verified on a real iPhone with the iOS keyboard open. The composer remained accessible while the conversation resized and scrolled.

**How to apply:** Treat future visual work as theme-only around this structure. Do not alter the viewport-height calculations, safe-area offsets, flex sizing, scroll container, or composer placement without an explicit request and new real-device validation.