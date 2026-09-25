---
name: iPhone photo retention diagnosis
description: Real-device evidence and interpretation limits for intermittent Lumen photo thumbnails.
---

Do not treat a passing synthetic clipboard-paste or mocked-send browser test as proof that iPhone Safari consistently retains sent photo thumbnails. When a sent message falls back to its photo marker, distinguish whether it lacked a thumbnail immediately or lost one after refresh; compare the returned IDs, on-device save outcome, and subsequent lookup on that same device. A message sent before diagnostics existed cannot retroactively reveal its photo source or storage outcome.

**Why:** On the same iPhone conversation, one sent image showed a thumbnail and a later image showed only the marker despite receiving an assistant reply. The user later confirmed that taking a photo or selecting one from Photos works through sending and thumbnail rendering, while the failure appears isolated to paste. Simulated clipboard events succeeded in a separate browser context and do not reproduce native Safari behavior.

**How to apply:** Use the picker path as a working baseline; inspect the local metadata-only diagnostic for a pasted image on the affected iPhone before and after refresh. An unrecognized paste representation, failed conversion, failed save, successful save followed by a missing lookup, and an immediate marker before post-send lookup point to different investigations. Never log or store image bytes or URLs for diagnosis.