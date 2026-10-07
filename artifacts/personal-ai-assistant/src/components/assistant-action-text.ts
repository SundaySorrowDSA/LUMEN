import { createElement, Fragment } from "react";
import { parseActionSpans, verifiedActionSpansFromMetadata } from "@workspace/assistant-providers/action-text";

/** Assistant-only content. React escapes all text; no HTML or Markdown
 * injection. The surrounding message typography/layout remains unchanged.
 */
export function AssistantActionText({ content, metadata }: { content: string; metadata: string | null }) {
  const verified = verifiedActionSpansFromMetadata(content, metadata);
  const children = [];
  let cursor = 0;
  for (const span of parseActionSpans(content)) {
    children.push(content.slice(cursor, span.start));
    const gold = verified.some(entry => entry.start === span.start && entry.end === span.end && entry.text === span.text);
    children.push(createElement("em", {
      key: span.start,
      className: gold ? "italic text-primary" : "italic text-muted-foreground",
      "data-action-verification": gold ? "verified" : "ordinary",
    }, span.text));
    cursor = span.end;
  }
  children.push(content.slice(cursor));
  return createElement(Fragment, null, ...children);
}
