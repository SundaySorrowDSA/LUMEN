---
name: iPhone composer layout
description: Real-device validation and preservation rules for Lumen's mobile chat composer.
---

Preserve the mobile chat composer's positioning, safe-area handling, message-pane scrolling, and visual-viewport keyboard handling. The user subsequently requested a compact, content-growing input and a Send button aligned alongside it on narrow screens.

**Why:** The original layout was verified on a real iPhone with the iOS keyboard open. After the compact-input change, the user reported a large gap above the iPhone Safari/PWA keyboard that could be closed by manually dragging the page; the original device check no longer establishes keyboard correctness.

**How to apply:** While the software keyboard is open, align the conversation pane to the visual viewport and do not reserve hidden navigation or keyboard-obscured safe-area space. Keep the composer in the flex layout, not over message content; only keep the latest message anchored if the user was already near the bottom. The keyboard-specific change still needs a new real-iPhone visual check; a static preview cannot establish its success.