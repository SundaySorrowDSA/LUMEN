import assert from "node:assert/strict";
import test from "node:test";
import {
  hasStorySpecificText,
  isDirectArticleUrl,
  unwrapBingNewsLink,
} from "./news-articles.js";

test("distinguishes direct story URLs from dated news indexes and topic pages", () => {
  for (const url of [
    "https://www.cbsnews.com/us/",
    "https://www.usatoday.com/",
    "https://www.cnn.com/",
    "https://www.reuters.com/world/us/",
    "https://news.google.com/topics/CAAqIggK",
    "https://www.cbsnews.com/news/",
    "https://www.cnn.com/2026/09/24/politics/index.html",
    "https://www.cbsnews.com/news/latest-news/",
  ]) {
    assert.equal(isDirectArticleUrl(url), false, url);
  }

  for (const url of [
    "https://apnews.com/article/us-senate-funding-measure",
    "https://www.reuters.com/world/us/senate-passes-funding-2026-09-24/",
    "https://www.cbsnews.com/news/senate-passes-funding-bill/",
    "https://www.cnn.com/2026/09/24/politics/senate-bill/index.html",
    "https://www.usatoday.com/story/news/politics/2026/09/24/senate-passes-bill/123456789/",
  ]) {
    assert.equal(isDirectArticleUrl(url), true, url);
  }
});

test("requires story-specific title and snippet instead of publisher boilerplate", () => {
  assert.equal(hasStorySpecificText({
    title: "U.S. News: Latest news, breaking news, today's news stories",
    snippet: "View the latest news and breaking news today for U.S. readers.",
  }), false);
  assert.equal(hasStorySpecificText({
    title: "U.S. Senate passes funding bill",
    snippet: "Lawmakers voted on the measure in Washington after months of debate.",
  }), true);
});

test("unwraps Bing News article links but rejects unsafe or missing targets", () => {
  const article = "https://apnews.com/article/us-senate-funding-measure";
  assert.equal(unwrapBingNewsLink(
    `http://www.bing.com/news/apiclick.aspx?ref=FexRss&url=${encodeURIComponent(article)}`,
  ), article);
  assert.equal(unwrapBingNewsLink(
    "http://www.bing.com/news/apiclick.aspx?url=javascript%3Aalert(1)",
  ), null);
  assert.equal(unwrapBingNewsLink("http://www.bing.com/news/apiclick.aspx"), null);
});