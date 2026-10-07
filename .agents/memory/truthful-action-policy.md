---
name: Truthful action policy
description: The user's meaning of gold action text and preference for conservative verification.
---

Every assistant action span is ordinary/unverified by default. Gold is allowed only when Lumen has concrete evidence that the described external/tool action actually occurred successfully. When uncertain, use gray.

**Why:** The user explicitly prefers false negatives over false positives; gold must communicate a real successful operation, not roleplay or a mere promise.

**How to apply:** Do not let tool evidence verify unrelated touching, kissing, leaning, smiling, walking, sitting, or other embodied roleplay. A successful tool somewhere in a response is not sufficient evidence for its other actions.
