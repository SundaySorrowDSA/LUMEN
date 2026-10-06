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

Ren must only describe an image as rendering when a real generation is underway; completed images must be attached, and failures must be explicit.

**Why:** The user reproduced text-only promises and rendering claims even though no image capability had been invoked. Kindroid's conversational prose is not evidence of tool execution.

**How to apply:** Ground image-status language in dispatcher state. Recognize explicit requests expressed as polite questions or later sentences without treating ordinary image discussion as generation intent. Keep public failure reporting independent of development-only provider diagnostics.

The user says Ren already sends generated images through Kindroid Native (KN) reliably. Preserve that working path when correcting LUMEN's image intent routing; do not replace the provider or character configuration to solve a routing miss.

**Why:** The user explicitly identified conversational image requests and follow-ups to promised pictures being misrouted to web search, not a broken generation/delivery pipeline. They also require explicit repeat requests to produce a fresh tool call and attachment, not be treated as duplicate deliveries.

**How to apply:** Resolve direct and conversational photo intent before temporal web-search signals. Completed images clear ambiguous pending follow-ups, but explicit "another"/"one more"/context-backed "a different angle" requests authorize fresh generation, even after delivery. Do not revive cancelled/stale requests. A personal outfit question is not web research merely because it says "today."

The user requires shared semantic intent recognition, not more one-off sentence rules. Supplied examples are labeled positive tests; independent paraphrases and ordinary-conversation/inspection/other-subject negatives must also be verified.

**Why:** Repeated surface-wording fixes kept missing equivalent requests. The requested change is to recognize receiving an image of Ren or her outfit across different wording, not to whitelist the supplied sentences.

**How to apply:** Compose request, visual-target, subject, and conversation-state evidence. Preserve the existing generic-image capability separately from Ren's intent. Do not add a paid classification provider or change the established generation/KN pipeline. Verify actual tool calls and PNG attachments, never narration alone.

Internal tool errors and fallback diagnostics must stay in LUMEN's UI or logs, never in a message sent to KN.

**Why:** The user explicitly required this boundary.

**How to apply:** Augment outgoing KN messages only with successful tool results. Keep failed-tool status and reasons local; do not turn error handlers into provider-message content.
