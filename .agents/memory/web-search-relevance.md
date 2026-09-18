---
name: Bing RSS relevance
description: Why Lumen must validate entity relevance before passing Bing RSS results to its conversational provider.
---

Treat Bing RSS results as candidates, not trusted search context. Instruction-heavy queries can ignore the intended entity and return pages that do not mention it.

**Why:** A Kindroid news query returned unrelated Autofac and NuGet pages even when the entity was quoted. Subject-constrained queries produced relevant results.

**How to apply:** Extract the intended subject, prefer known authoritative domains, require subject and disambiguating context matches, and pass no candidate that fails the relevance gate.