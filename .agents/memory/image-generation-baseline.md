---
name: Image generation baseline
description: User-confirmed successful image configuration and how to diagnose later prompt failures.
---

The user confirmed that the original crow prompt generated an image successfully with the existing OpenAI image configuration. A later custom prompt returned OpenAI HTTP 400.

**Why:** A prompt-specific 400 after a successful generation is not, by itself, evidence that the model or credentials are wrong. The user explicitly requested preserving the working model, API key, and image settings during diagnosis.

**How to apply:** Inspect the actual upstream error before recommending image configuration changes. Use the successful crow test as the baseline; do not substitute a model or credentials merely to work around a custom-prompt failure.

The custom portrait retry returned `moderation_blocked` / `image_generation_user_error`. The complete provider body identified the moderation stage as `output`, with category `sexual`.

**Why:** The structured HTTP 400 was a generated-output safety rejection, not a model-access or credential failure. The visible prompt alone did not reveal that distinction.

**How to apply:** Check `moderation_details.moderation_stage` in development logs before attributing a moderation block to the submitted prompt. Do not infer the contents of an image that the provider withheld.

Keep image generation explicitly requested: the Image Sandbox is temporary experimentation, while conversation capability output is persistent.

**Why:** Sharing the working OpenAI transport must not silently turn sandbox experiments into conversation history or charge for ordinary discussion of images. The user required keeping normal conversation and Kindroid integration unchanged.

**How to apply:** Reuse generation and bounded retries across both paths, but leave persistence with the conversation caller. Dispatch paid generation from explicit image requests or structured capability calls, not arbitrary mentions.
