const INDEX_HOSTS = ["news.google.com", "bing.com", "www.bing.com"];
const INDEX_SEGMENTS = new Set([
  "home", "latest", "headlines", "topics", "topic", "category", "categories",
  "section", "sections", "tag", "tags", "search", "rss", "feed", "feeds",
  "us", "usa", "world", "news", "politics", "national", "business",
]);
const GENERIC_HEADLINE =
  /\b(?:latest news|breaking news|today'?s news|news headlines|top stories|news stories|news and|news from|news home|news hub)\b/i;
const GENERIC_SNIPPET =
  /\b(?:read full articles|browse thousands of titles|view the latest news|delivers current national|stay up to date with|photos and videos through)\b/i;
const DATED_ARTICLE_PATH = /\/20\d{2}\/(?:0?[1-9]|1[0-2]|[a-z]{3})\/(?:0?[1-9]|[12]\d|3[01])\//i;
const ARTICLE_SECTION = /\/(?:article|articles|story|stories)\//i;

export function unwrapBingNewsLink(link: string): string | null {
  try {
    const url = new URL(link);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!INDEX_HOSTS.includes(url.hostname.toLowerCase())) return url.toString();
    if (!/^\/news\/apiclick\.aspx$/i.test(url.pathname)) return url.toString();

    const target = new URL(url.searchParams.get("url") ?? "");
    if (
      (target.protocol !== "https:" && target.protocol !== "http:") ||
      target.username || target.password ||
      INDEX_HOSTS.includes(target.hostname.toLowerCase())
    ) return null;
    return target.toString();
  } catch {
    return null;
  }
}

export function isDirectArticleUrl(link: string): boolean {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return false;
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    INDEX_HOSTS.includes(url.hostname.toLowerCase())
  ) return false;

  const path = url.pathname.toLowerCase();
  const segments = path.split("/").filter(Boolean);
  if (segments.length < 2 || segments.some((segment) =>
    ["topics", "topic", "category", "categories", "tag", "tags", "search", "rss", "feed"].includes(segment)
  )) return false;
  const last = segments.at(-1)!;
  if (DATED_ARTICLE_PATH.test(path) && segments.length >= 5) {
    if (last === "index.html") {
      return segments.length >= 6 && !INDEX_SEGMENTS.has(segments.at(-2)!);
    }
    return !INDEX_SEGMENTS.has(last) && !/^(?:index|home)(?:\.html?)?$/.test(last);
  }
  if (INDEX_SEGMENTS.has(last) || /^(?:index|home)(?:\.html?)?$/.test(last)) return false;
  if (ARTICLE_SECTION.test(path)) return last.length >= 8;
  const words = last.replace(/\.(?:html?|aspx?)$/, "").split(/[-_]/).filter((part) =>
    /[a-z]{3}/.test(part),
  );
  return words.length >= 3;
}

export function hasStorySpecificText(result: { title: string; snippet: string }): boolean {
  const title = result.title.trim();
  const snippet = result.snippet.trim();
  return title.split(/\s+/).length >= 4 &&
    snippet.length >= 35 &&
    !GENERIC_HEADLINE.test(title) &&
    !GENERIC_SNIPPET.test(snippet);
}