---
name: Image generation baseline
description: User-confirmed successful image configuration and how to diagnose later prompt failures.
---

The user confirmed that the original crow prompt generated an image successfully with the existing OpenAI image configuration. A later custom prompt returned OpenAI HTTP 400.

**Why:** A prompt-specific 400 after a successful generation is not, by itself, evidence that the model or credentials are wrong. The user explicitly requested preserving the working model, API key, and image settings during diagnosis.

**How to apply:** Inspect the actual upstream error before recommending image configuration changes. Use the successful crow test as the baseline; do not substitute a model or credentials merely to work around a custom-prompt failure.
