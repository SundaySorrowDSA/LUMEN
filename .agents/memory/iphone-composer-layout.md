---
name: iPhone composer layout
description: Real-device validation and preservation rules for Lumen's mobile chat composer.
---

Preserve the mobile chat composer's positioning, safe-area handling, message-pane scrolling, and visual-viewport keyboard handling. The user subsequently requested a compact, content-growing input and a Send button aligned alongside it on narrow screens.

**Why:** The original layout was verified on a real iPhone with the iOS keyboard open. After the compact-input change, the user reported a large gap above the iPhone Safari/PWA keyboard that could be closed by manually dragging the page; the original device check no longer establishes keyboard correctness.

**How to apply:** While the software keyboard is open, align the conversation pane to the visual viewport and do not reserve hidden navigation or keyboard-obscured safe-area space. Keep the composer in the flex layout, not over message content; only keep the latest message anchored if the user was already near the bottom. The keyboard-specific change still needs a new real-iPhone visual check; a static preview cannot establish its success.

On thread opening/reload, initial scrolling must account for persisted history, browser photo restoration, and rendered media readiness, including cached and asynchronously loaded generated images. Stop automatic following when the user reads older history; only an explicit jump or returning near the bottom resumes following.

**Why:** The user reported that mobile chat restored partway through history near a generated image instead of at the latest message. Message-count changes alone precede late image layout shifts and cannot establish restoration completion.

**How to apply:** Use the actual message scroll container and browser layout/media signals, not long fixed delays. Keep one owner of scroll behavior so photo restoration, new messages, and keyboard resizing cannot independently override the reader's position. Bound the workspace height on desktop too: letting history expand the page prevents the inner message container from owning scrolling. Physical iOS keyboard behavior still requires real-device evidence; desktop emulation is not that evidence.