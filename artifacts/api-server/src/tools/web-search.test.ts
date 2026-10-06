import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWebSearchPlan,
  extractSearchSubject,
  getRelevanceDiagnostics,
  normalizeWebSearchQuery,
  parseBingRss,
  rankRelevantSearchResults,
  requiresCurrentWebInformation,
  resolveOptionalWebSearch,
  searchWeb,
  InsufficientNewsEvidenceError,
  type WebSearchResult,
} from "./web-search.js";

const diagnosedPrompt = "What are your thoughts on today’s current events in America";
const recentDate = new Date(Date.now() - 60 * 60 * 1000).toUTCString();
const staleDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toUTCString();
const rssItem = (result: WebSearchResult) =>
  `<item><title>${result.title}</title><link>${result.url}</link><description>${result.snippet}</description>${result.publishedAt ? `<pubDate>${result.publishedAt}</pubDate>` : ""}</item>`;

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
      url: `https://www.reuters.com/world/us/senate-passes-funding-${index}/`,
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
    url: "https://www.reuters.com/world/canada/parliament-approves-budget/",
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
      url: "https://www.reuters.com/world/us/senate-passes-funding/",
      snippet: "Lawmakers approved the measure in Washington.",
      publishedAt: recentDate,
    },
    {
      title: "Canada's parliament approves a budget",
      url: "https://www.reuters.com/world/canada/parliament-approves-budget/",
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
      url: "https://www.reuters.com/world/us/old-senate-vote/",
      snippet: "Lawmakers cast their ballots on the measure in Washington.",
      publishedAt: staleDate,
    },
    {
      title: "U.S. Senate votes today",
      url: "https://www.reuters.com/world/us/undated-senate-vote/",
      snippet: "Lawmakers cast their ballots on the measure in Washington.",
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
      notDirectArticle: 1,
      nonSpecificStoryText: 0,
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
        notDirectArticle: 0,
        nonSpecificStoryText: 0,
      },
    },
  );
});

test("Bing News RSS links are unwrapped to direct article URLs without changing dates", () => {
  const original = "https://www.reuters.com/world/us/senate-passes-funding-2026-09-24/";
  const bingLink = `http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=${encodeURIComponent(original)}`;
  const xml = `<rss><channel><item><title>U.S. Senate passes funding bill</title><link>${bingLink}</link><description>Lawmakers voted on the measure in Washington.</description><pubDate>${recentDate}</pubDate></item></channel></rss>`;
  assert.deepEqual(parseBingRss(xml), [{
    title: "U.S. Senate passes funding bill",
    url: original,
    snippet: "Lawmakers voted on the measure in Washington.",
    publishedAt: recentDate,
  }]);
});

test("broad news searches news RSS only when web RSS has no usable article", async () => {
  const indexes: WebSearchResult[] = [{
    title: "U.S. News: Latest news, breaking news, today's news stories",
    url: "https://www.cbsnews.com/us/",
    snippet: "Find the latest news, videos and other information about America.",
    publishedAt: recentDate,
  }];
  const story: WebSearchResult = {
    title: "U.S. Senate passes funding bill",
    url: "https://apnews.com/article/us-senate-funding-measure",
    snippet: "Lawmakers voted on the measure in Washington after months of debate.",
    publishedAt: recentDate,
  };
  const calls: Array<{ query: string; surface: string }> = [];
  const fetchResults: NonNullable<Parameters<typeof searchWeb>[2]> =
    async (query, _subject, _traceId, surface) => {
      calls.push({ query, surface: surface ?? "web" });
      return surface === "news" && query.includes("news today") ? [story] : indexes;
    };
  const result = await searchWeb(diagnosedPrompt, undefined, fetchResults, async () => {
    assert.fail("BBC fallback must not run when Bing News found a story");
  });
  assert.deepEqual(calls, [
    { query: "United States news today", surface: "web" },
    { query: "United States headlines today", surface: "web" },
    { query: "United States news today", surface: "news" },
    { query: "United States headlines today", surface: "news" },
  ]);
  assert.deepEqual(result.results, [story]);
  assert.ok(result.results.every((item) => item.url !== indexes[0].url));
});

test("an initial direct dated story avoids the extra searches", async () => {
  const calls: string[] = [];
  const story: WebSearchResult = {
    title: "U.S. Senate passes funding bill",
    url: "https://apnews.com/article/us-senate-funding-measure",
    snippet: "Lawmakers voted on the measure in Washington after months of debate.",
    publishedAt: recentDate,
  };
  const fetchResults: NonNullable<Parameters<typeof searchWeb>[2]> =
    async (_query, _subject, _traceId, surface) => {
      calls.push(surface ?? "web");
      return [story];
    };
  const result = await searchWeb(diagnosedPrompt, undefined, fetchResults, async () => {
    assert.fail("BBC fallback must not run when the web search found a story");
  });
  assert.deepEqual(calls, ["web", "web"]);
  assert.deepEqual(result.results, [story]);
});

test("broad U.S. news falls back to the first 20 BBC items and retains only validated direct stories", async () => {
  const story: WebSearchResult = {
    title: "U.S. Senate approves a funding measure",
    url: "https://www.bbc.com/news/articles/c12345678",
    snippet: "Lawmakers voted on the measure after months of debate in Washington.",
    publishedAt: recentDate,
  };
  const rejected: WebSearchResult = {
    ...story,
    url: "https://www.bbc.com/news/world/us_and_canada",
    publishedAt: null,
  };
  const beyondLimit = { ...story, url: "https://www.bbc.com/news/articles/c99999999" };
  const xml = `<rss><channel>${rssItem(story)}${Array.from({ length: 19 }, () => rssItem(rejected)).join("")}${rssItem(beyondLimit)}</channel></rss>`;
  const calls: string[] = [];
  let bbcCalls = 0;
  const result = await searchWeb(
    diagnosedPrompt,
    undefined,
    async (_query, _subject, _traceId, surface) => {
      calls.push(surface ?? "web");
      return [];
    },
    async (url) => {
      bbcCalls++;
      assert.equal(url, "https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml");
      return new Response(xml, { status: 200 });
    },
  );
  assert.deepEqual(calls, ["web", "web", "news", "news"]);
  assert.equal(bbcCalls, 1);
  assert.deepEqual(result.results, [story]);
});

test("broad U.S. news keeps insufficient-evidence behavior when BBC has no valid stories", async () => {
  const index: WebSearchResult = {
    title: "U.S. Senate passes a funding bill",
    url: "https://www.bbc.com/news/world/us_and_canada",
    snippet: "Lawmakers voted on the measure after months of debate in Washington.",
    publishedAt: recentDate,
  };
  const undated = {
    ...index,
    url: "https://www.bbc.com/news/articles/c12345678",
    publishedAt: null,
  };
  let bbcCalls = 0;
  const outcome = await resolveOptionalWebSearch(
    diagnosedPrompt,
    (query, diagnostics) => searchWeb(
      query,
      diagnostics,
      async () => [],
      async () => {
        bbcCalls++;
        return new Response(`<rss><channel>${rssItem(index)}${rssItem(undated)}</channel></rss>`);
      },
    ),
  );
  assert.equal(bbcCalls, 1);
  assert.equal(outcome.webSearch, null);
  assert.ok(outcome.error instanceof InsufficientNewsEvidenceError);
  assert.equal(outcome.providerContent, diagnosedPrompt, "Insufficient-evidence diagnostics stay local");
});

test("an unavailable BBC feed also retains the insufficient-evidence fallback", async () => {
  await assert.rejects(
    searchWeb(
      diagnosedPrompt,
      undefined,
      async () => [],
      async () => new Response("", { status: 503 }),
    ),
    InsufficientNewsEvidenceError,
  );
});

test("BBC fallback does not run for broad non-U.S. news or topical U.S. searches", async () => {
  let bbcCalls = 0;
  for (const prompt of ["What are the latest headlines from Canada?", "latest news about US elections"]) {
    await assert.rejects(
      searchWeb(prompt, undefined, async () => [], async () => {
        bbcCalls++;
        return new Response("<rss><channel></channel></rss>");
      }),
    );
  }
  assert.equal(bbcCalls, 0);
});

test("only indexes and undated stories produce honest insufficient-evidence context", async () => {
  const index: WebSearchResult = {
    title: "U.S. Senate passes funding bill",
    url: "https://www.cbsnews.com/us/",
    snippet: "Lawmakers voted on the measure in Washington after months of debate.",
    publishedAt: recentDate,
  };
  const { subject } = buildWebSearchPlan(diagnosedPrompt);
  assert.equal(getRelevanceDiagnostics([index], subject).rejectionCategories.notDirectArticle, 1);
  const undatedStory: WebSearchResult = {
    title: "U.S. Senate passes funding bill",
    url: "https://apnews.com/article/us-senate-funding-measure",
    snippet: "Lawmakers voted on the measure in Washington after months of debate.",
    publishedAt: null,
  };
  const fetchResults: NonNullable<Parameters<typeof searchWeb>[2]> =
    async (_query, _subject, _traceId, surface) =>
      surface === "news" ? [undatedStory] : [index];
  const outcome = await resolveOptionalWebSearch(
    diagnosedPrompt,
    (query, diagnostics) => searchWeb(
      query,
      diagnostics,
      fetchResults,
      async () => new Response("<rss><channel></channel></rss>"),
    ),
  );
  assert.equal(outcome.webSearch, null);
  assert.ok(outcome.error instanceof InsufficientNewsEvidenceError);
  assert.equal(outcome.providerContent, diagnosedPrompt, "Fallback diagnostics must stay in LUMEN");
});

test("optional web-search failure falls through with provider content", async () => {
  const outcome = await resolveOptionalWebSearch(
    diagnosedPrompt,
    async () => { throw new Error("search unavailable"); },
  );

  assert.equal(outcome.webSearch, null);
  assert.equal(outcome.error?.message, "search unavailable");
  assert.equal(outcome.providerContent, diagnosedPrompt);
});

test("fallback diagnostics are never appended to the outgoing provider message", async () => {
  const outcome = await resolveOptionalWebSearch(
    diagnosedPrompt,
    async () => { throw new Error("search unavailable"); },
  );

  assert.equal(outcome.providerContent, diagnosedPrompt);
  assert.equal(outcome.error?.message, "search unavailable");
});