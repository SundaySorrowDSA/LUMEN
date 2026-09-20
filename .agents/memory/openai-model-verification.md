---
name: OpenAI model verification
description: Current OpenAI API model and endpoint references for future provider work.
---

Use OpenAI's current developer documentation to validate model names and request formats before wiring a provider. The current model catalog lists `gpt-5.6-terra`, and the text guide documents the Responses API at `/v1/responses`.

**Why:** The provider catalog previously contained a model label without a live adapter, so trusting local metadata alone could create a configured-looking but nonfunctional integration.

**How to apply:** Recheck the official model catalog and Responses API guide before changing the default model or request schema.