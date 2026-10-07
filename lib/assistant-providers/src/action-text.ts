/** Pure message-text contract, shared by server verification and rendering.
 * Offsets are UTF-16, start-inclusive/end-exclusive, including the delimiters.
 */
export type ActionSpan = { text: string; start: number; end: number };
export const ACTION_TOOL_IDS = [
  "when-i-work-calendar", "safe-calculator", "persistent-reminders",
  "bing-rss-web-search", "photo-analysis", "consult_openai", "generate_image",
] as const;
export type ActionToolId = typeof ACTION_TOOL_IDS[number];
export type VerifiedActionSpan = ActionSpan & {
  toolId: ActionToolId;
  status: "verified";
};

function escaped(content: string, index: number): boolean {
  let slashes = 0;
  while (index > 0 && content[--index] === "\\") slashes++;
  return slashes % 2 === 1;
}

/** Single, balanced action delimiters only. Code, bold, escaped stars,
 * multiplication-style spaced stars and intra-word stars stay literal.
 */
export function parseActionSpans(content: string): ActionSpan[] {
  const code = [...content.matchAll(/```[\s\S]*?(?:```|$)|`[^`\n]*(?:`|$)/g)]
    .map(match => ({ start: match.index!, end: match.index! + match[0].length }));
  const spans: ActionSpan[] = [];
  const literal = (index: number) => escaped(content, index) ||
    content[index - 1] === "*" || content[index + 1] === "*" ||
    code.some(range => index >= range.start && index < range.end);
  for (let start = 0; start < content.length; start++) {
    if (content[start] !== "*" || literal(start) ||
        /[\w*]/.test(content[start - 1] ?? "") ||
        !content[start + 1] || /\s/.test(content[start + 1])) continue;
    for (let close = start + 1; close < content.length; close++) {
      if (content[close] === "`") break;
      if (content[close] !== "*") continue;
      if (escaped(content, close)) continue;
      if (literal(close) || /\s/.test(content[close - 1]) ||
          /[\w*]/.test(content[close + 1] ?? "")) break;
      spans.push({ start, end: close + 1, text: content.slice(start + 1, close) });
      start = close;
      break;
    }
  }
  return spans;
}

/** Never apply stale or malformed metadata to a different span. Missing
 * metadata (including history) intentionally means ordinary/unverified.
 */
export function verifiedActionSpansFromMetadata(content: string, metadata: string | null): VerifiedActionSpan[] {
  try {
    const value: unknown = JSON.parse(metadata ?? "{}");
    if (!value || typeof value !== "object" || !("verifiedActionSpans" in value)) return [];
    const entries = value.verifiedActionSpans;
    if (!Array.isArray(entries)) return [];
    const spans = parseActionSpans(content);
    return entries.filter((entry): entry is VerifiedActionSpan =>
      entry && typeof entry === "object" && entry.status === "verified" &&
      ACTION_TOOL_IDS.includes(entry.toolId) &&
      spans.some(span => span.start === entry.start && span.end === entry.end && span.text === entry.text));
  } catch { return []; }
}
