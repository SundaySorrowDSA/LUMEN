---
name: Truthful action policy
description: The user's meaning of gold action text and preference for conservative verification.
---

Every assistant action span is ordinary/unverified by default. Gold is allowed only when Lumen has concrete evidence that the described external/tool action actually occurred successfully. When uncertain, use gray.

**Why:** The user explicitly prefers false negatives over false positives; gold must communicate a real successful operation, not roleplay or a mere promise.

**How to apply:** Do not let tool evidence verify unrelated touching, kissing, leaning, smiling, walking, sitting, or other embodied roleplay. A successful tool somewhere in a response is not sufficient evidence for its other actions.

Reminder acknowledgements must be grounded in saved tool results, not conversational provider text. Creating a reminder record does not prove that a later push notification was delivered.

**Why:** A direct-address reminder request bypassed routing, and Kindroid claimed a timer was set without any reminder record. The user explicitly required protection against false action acknowledgements, not merely different text coloring.

**How to apply:** Keep reminder confirmations tied to verified tool outcomes. Do not replace missing or failed execution with a provider acknowledgement, and do not promise notification delivery using reminder-creation evidence alone.
