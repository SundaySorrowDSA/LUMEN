import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWebSearchPlan,
  extractSearchSubject,
  getRelevanceDiagnostics,
  normalizeWebSearchQuery,
  rankRelevantSearchResults,
  requiresCurrentWebInformation,
  resolveOptionalWebSearch,
  type WebSearchResult,
} from "./web-search.js";

const diagnosedPrompt = "What are your thoughts on today’s current events in America";
const recentDate = new Date(Date.now() - 60 * 60 * 1000).toUTCString();
const staleDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toUTCString();

test("excludes conversational framing from the search subject", () => {
  const normalized = normalizeWebSearchQuery(
    "What are your thoughts on current developments in American infrastructure?",
  );
  const subject = extractSearchSubject(normalized);

  assert.equal(normalized, "current developments in American infrastructure");
  assert.deepEqual(subject.terms, ["america", "developments", "infrastructure"]);
});

test("retains meaningful topic and location terms", () => {
  const plan = buildWebSearchPlan("Tell me about current wildfire conditions in California");

  assert.equal(plan.normalizedQuery, "current wildfire conditions in California");
  assert.deepEqual(plan.subject.terms, ["wildfire", "conditions", "california"]);
  assert.ok(plan.searchQueries.every((query) => query.includes("California")));
});

test("broad news paraphrases keep geography and freshness without duplicate terms", () => {
  for (const prompt of [
    diagnosedPrompt,
    "the current events in America today",
    "What's happening in the U.S. today?",
    "What are the latest headlines in the United States today?",
    "News in America today?",
    "Today's headlines in America",
  ]) {
    const plan = buildWebSearchPlan(prompt);
    assert.equal(plan.normalizedQuery, "United States news today", prompt);
    assert.deepEqual(plan.searchQueries, [
      "United States news today",
      "United States headlines today",
    ], prompt);
    assert.deepEqual(plan.subject.terms, ["america"], prompt);
    assert.equal(plan.subject.broadNewsFreshness, "today", prompt);
  }

  const weekly = buildWebSearchPlan("What's the latest news in the US this week?");
  assert.deepEqual(weekly.searchQueries, [
    "United States news this week",
    "United States headlines this week",
  ]);
  assert.equal(weekly.subject.broadNewsFreshness, "this_week");

  const canada = buildWebSearchPlan("What are the latest headlines from Canada?");
  assert.deepEqual(canada.searchQueries, [
    "Canada news latest",
    "Canada headlines latest",
  ]);
  assert.deepEqual(canada.subject.terms, ["canada"]);
  assert.equal(canada.subject.broadNewsFreshness, "latest");

  const worldwide = buildWebSearchPlan("What's the latest world news?");
  assert.deepEqual(worldwide.searchQueries, [
    "World news latest",
    "World headlines latest",
  ]);
  const broadWorldwide = buildWebSearchPlan("What are the current events?");
  assert.deepEqual(broadWorldwide.searchQueries, [
    "World news latest",
    "World headlines latest",
  ]);
  assert.deepEqual(broadWorldwide.subject.terms, []);
});

test("ordinary topical searches and small talk keep their previous paths", () => {
  const topical = buildWebSearchPlan("latest news about US elections");
  assert.equal(topical.subject.broadNewsFreshness, undefined);
  assert.deepEqual(topical.subject.terms, ["america", "elections"]);
  const specific = buildWebSearchPlan("latest news about climate policy in America");
  assert.equal(specific.subject.broadNewsFreshness, undefined);
  assert.deepEqual(specific.subject.terms, ["america", "climate", "policy"]);
  assert.equal(requiresCurrentWebInformation("How are you feeling today?"), true);
  assert.equal(requiresCurrentWebInformation("How are you feeling?"), false);
});

test("accepts dated U.S. headlines across location spellings without mandatory context words", () => {
  const { subject } = buildWebSearchPlan(diagnosedPrompt);
  const relevant = ["America", "American", "US", "U.S.", "United States"].map(
    (location, index): WebSearchResult => ({
      title: `${location} Senate passes funding bill`,
      url: `https://www.reuters.com/world/us/senate-vote-${index}/`,
      snippet: "Lawmakers voted on the measure in Washington.",
      publishedAt: recentDate,
    }),
  );

  assert.deepEqual(rankRelevantSearchResults(relevant, subject), relevant);
});

test("rejects unrelated America pages and stale or undated material presented as today", () => {
  const { subject } = buildWebSearchPlan(diagnosedPrompt);
  const relevantNews: WebSearchResult = {
    title: "U.S. Congress advances a major bill",
    url: "https://apnews.com/article/congress-vote",
    snippet: "Lawmakers approved the measure in Washington.",
    publishedAt: recentDate,
  };
  const unrelatedAmericanPage: WebSearchResult = {
    title: "A guide to American historic landmarks",
    url: "https://guide.example.com/landmarks",
    snippet: "Visitor information for parks and monuments.",
    publishedAt: recentDate,
  };
  const datedNewsSiteGuide: WebSearchResult = {
    title: "A guide to America's historic landmarks",
    url: "https://apnews.com/article/travel-landmarks",
    snippet: "Visitor information for parks and monuments.",
    publishedAt: recentDate,
  };
  const unrelatedForeignNews: WebSearchResult = {
    title: "Canada's parliament votes on a budget",
    url: "https://www.reuters.com/world/canada/budget-vote/",
    snippet: "Lawmakers approved a national spending measure.",
    publishedAt: recentDate,
  };
  const lowercasePronounNews: WebSearchResult = {
    title: "World leaders tell us what they think",
    url: "https://www.reuters.com/world/global-summit/",
    snippet: "Representatives gathered at an international summit.",
    publishedAt: recentDate,
  };
  const staleTodayHeadline: WebSearchResult = {
    title: "U.S. Senate acts today on a funding bill",
    url: "https://www.reuters.com/world/us/old-senate-vote/",
    snippet: "Lawmakers approved a measure in Washington.",
    publishedAt: staleDate,
  };
  const undatedTodayHeadline: WebSearchResult = {
    title: "U.S. Senate acts today on a funding bill",
    url: "https://www.reuters.com/world/us/undated-senate-vote/",
    snippet: "Lawmakers approved a measure in Washington.",
    publishedAt: null,
  };

  assert.deepEqual(
    rankRelevantSearchResults(
      [
        unrelatedAmericanPage,
        datedNewsSiteGuide,
        unrelatedForeignNews,
        lowercasePronounNews,
        staleTodayHeadline,
        undatedTodayHeadline,
        relevantNews,
      ],
      subject,
    ),
    [relevantNews],
  );
});

test("reports parsed candidate counts and rejection categories without result text", () => {
  const { subject } = buildWebSearchPlan(diagnosedPrompt);
  const results: WebSearchResult[] = [
    {
      title: "U.S. Senate passes funding bill",
      url: "https://www.reuters.com/world/us/senate-vote/",
      snippet: "Lawmakers approved the measure in Washington.",
      publishedAt: recentDate,
    },
    {
      title: "Canada's parliament approves a budget",
      url: "https://www.reuters.com/world/canada/budget-vote/",
      snippet: "Lawmakers voted on a spending measure.",
      publishedAt: recentDate,
    },
    {
      title: "A visit to American landmarks",
      url: "https://guide.example.com/landmarks",
      snippet: "Visitor information for parks and monuments.",
      publishedAt: recentDate,
    },
    {
      title: "A guide to America's historic landmarks",
      url: "https://apnews.com/article/travel-landmarks",
      snippet: "Visitor information for parks and monuments.",
      publishedAt: recentDate,
    },
    {
      title: "U.S. Senate votes today",
      url: "https://www.reuters.com/world/us/old-vote/",
      snippet: "Lawmakers cast their ballots.",
      publishedAt: staleDate,
    },
    {
      title: "U.S. Senate votes today",
      url: "https://www.reuters.com/world/us/undated-vote/",
      snippet: "Lawmakers cast their ballots.",
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
    candidatesEnteringRelevanceScoring: 7,
    acceptedAfterRelevance: 1,
    rejectionCategories: {
      invalidUrl: 1,
      missingSubjectTerms: 1,
      missingContextTerms: 0,
      missingNewsSourceContext: 1,
      missingPublicationDate: 1,
      outsideFreshnessWindow: 1,
      evergreenContent: 1,
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
        missingNewsSourceContext: 0,
        missingPublicationDate: 0,
        outsideFreshnessWindow: 0,
        evergreenContent: 0,
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