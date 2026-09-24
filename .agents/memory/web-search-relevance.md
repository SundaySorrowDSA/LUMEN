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

Broad-news RSS results need direct story links, story-specific text, and an item-specific date; a dated homepage or topic index cannot establish any article's publication date. If ordinary search returns only indexes, a bounded news-focused retrieval may find direct stories, but do not pass the indexes through when it fails.

**Why:** A live manual search accepted four apparently fresh U.S. news results, all homepages or topic listings. The conversational provider received no article-level citations even though the search reported success.

**How to apply:** Distinguish publisher story URLs from navigation pages before ranking, unwrap news-aggregator redirect links to the actual story target, and report insufficient evidence when no dated direct articles survive. Keep any client-abort investigation separate from search quality.

The user confirmed that a real broad U.S. current-events manual test succeeded after the bounded BBC U.S. & Canada RSS fallback was added. This is a point-in-time confirmation, not a guarantee that the feed will always supply sufficient stories.

**Why:** Earlier Bing queries had returned only indexes or no usable items; the publisher feed supplied dated direct stories without weakening the existing validation gates.

**How to apply:** Keep the publisher fallback bounded and behind the unchanged relevance checks. Do not expand sources or loosen rules solely on the strength of this one successful manual test.