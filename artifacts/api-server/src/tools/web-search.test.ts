import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWebSearchPlan,
  extractSearchSubject,
  normalizeWebSearchQuery,
  rankRelevantSearchResults,
  resolveOptionalWebSearch,
  type WebSearchResult,
} from "./web-search.js";

const diagnosedPrompt = "What are your thoughts on today’s current events in America";

test("excludes conversational framing from the search subject", () => {
  const normalized = normalizeWebSearchQuery(
    "What are your thoughts on current developments in American infrastructure?",
  );
  const subject = extractSearchSubject(normalized);

  assert.equal(normalized, "current developments in American infrastructure");
  assert.deepEqual(subject.terms, ["developments", "american", "infrastructure"]);
});

test("retains meaningful topic and location terms", () => {
  const plan = buildWebSearchPlan("Tell me about current wildfire conditions in California");

  assert.equal(plan.normalizedQuery, "current wildfire conditions in California");
  assert.deepEqual(plan.subject.terms, ["wildfire", "conditions", "california"]);
  assert.ok(plan.searchQueries.every((query) => query.includes("California")));
});

test("builds the diagnosed query around current events in America", () => {
  const plan = buildWebSearchPlan(diagnosedPrompt);

  assert.equal(plan.normalizedQuery, "current events in America");
  assert.deepEqual(plan.subject.terms, ["events", "america"]);
  assert.equal(plan.subject.searchPhrase, "events america");
  assert.ok(plan.searchQueries.includes("current events in America"));
});

test("accepts search results relevant to current events in America", () => {
  const { subject } = buildWebSearchPlan(diagnosedPrompt);
  const relevant: WebSearchResult = {
    title: "Current events across America today",
    url: "https://example.com/america-current-events",
    snippet: "A roundup of major events affecting people across America.",
    publishedAt: "Thu, 24 Sep 2026 12:00:00 GMT",
  };
  const unrelated: WebSearchResult = {
    title: "A guide to thoughtful conversation",
    url: "https://example.org/conversation",
    snippet: "How to share your thoughts with others.",
    publishedAt: null,
  };

  assert.deepEqual(rankRelevantSearchResults([unrelated, relevant], subject), [relevant]);
});

test("optional web-search failure falls through with provider content", async () => {
  const outcome = await resolveOptionalWebSearch(
    diagnosedPrompt,
    async () => { throw new Error("search unavailable"); },
  );

  assert.equal(outcome.webSearch, null);
  assert.equal(outcome.error?.message, "search unavailable");
  assert.match(outcome.providerContent, /\[User request\][\s\S]*current events in America/);
});

test("fallback context says current information could not be retrieved or verified", async () => {
  const outcome = await resolveOptionalWebSearch(
    diagnosedPrompt,
    async () => { throw new Error("search unavailable"); },
  );

  assert.match(outcome.providerContent, /Current information could not be retrieved or verified/);
  assert.match(outcome.providerContent, /Do not present stored knowledge or assumptions as current/);
});