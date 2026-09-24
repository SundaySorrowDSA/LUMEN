---
name: Bing RSS relevance
description: Why Lumen must validate entity relevance before passing Bing RSS results to its conversational provider.
---

Treat Bing RSS results as candidates, not trusted search context. Instruction-heavy queries can ignore the intended entity and return pages that do not mention it.

**Why:** A Kindroid news query returned unrelated Autofac and NuGet pages even when the entity was quoted. Subject-constrained queries produced relevant results.

**How to apply:** Extract the intended subject, prefer known authoritative domains, require subject and disambiguating context matches, and pass no candidate that fails the relevance gate.

For broad current-events requests, do not rely on a tiny mandatory vocabulary list in result text. Require the requested geography when present, news-source context, and an actual recent publication date; reject undated and stale items rather than inferring recency from the query.

**Why:** Bing RSS returned parseable results for a U.S. current-events request, but a four-word news-context gate rejected every candidate. The rejected contents were not retained, so removing the gate without independent checks would have risked admitting unrelated pages.

**How to apply:** Keep generic topic searches on their existing subject logic. For broad headlines, combine independent relevance and freshness signals; continue to describe source/date heuristics as imperfect, not proof that an article is true or complete.