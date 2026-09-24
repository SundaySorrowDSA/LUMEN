import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWebSearchPlan,
  extractSearchSubject,
  getRelevanceDiagnostics,
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

test("reports parsed candidate counts and rejection categories without result text", () => {
  const { subject } = buildWebSearchPlan(diagnosedPrompt);
  const results: WebSearchResult[] = [
    {
      title: "Events in America",
      url: "https://example.com/events",
      snippet: "Relevant event coverage in America.",
      publishedAt: null,
    },
    {
      title: "Events abroad",
      url: "https://example.org/events",
      snippet: "Events outside the requested location.",
      publishedAt: null,
    },
    {
      title: "America updates",
      url: "https://example.net/america",
      snippet: "A current update.",
      publishedAt: null,
    },
    {
      title: "Unusable URL",
      url: "not a URL",
      snippet: "A malformed candidate.",
      publishedAt: null,
    },
  ];

  assert.deepEqual(getRelevanceDiagnostics(results, subject), {
    candidatesEnteringRelevanceScoring: 4,
    acceptedAfterRelevance: 1,
    rejectionCategories: {
      invalidUrl: 1,
      missingSubjectTerms: 2,
      missingContextTerms: 0,
    },
  });
});

test("reports missing context terms independently from missing subject terms", () => {
  const subject = {
    terms: ["kindroid"],
    searchPhrase: "Kindroid AI companion",
    authoritativeHosts: [],
    contextTerms: ["companion", "chat"],
  };

  assert.deepEqual(
    getRelevanceDiagnostics(
      [{
        title: "Kindroid news",
        url: "https://example.com/kindroid",
        snippet: "An update about the product.",
        publishedAt: null,
      }],
      subject,
    ),
    {
      candidatesEnteringRelevanceScoring: 1,
      acceptedAfterRelevance: 0,
      rejectionCategories: {
        invalidUrl: 0,
        missingSubjectTerms: 0,
        missingContextTerms: 1,
      },
    },
  );
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