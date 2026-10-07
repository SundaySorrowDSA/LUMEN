import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseActionSpans } from "@workspace/assistant-providers/action-text";
import { AssistantActionText } from "./assistant-action-text.ts";

const render = (content: string, metadata: string | null = null) =>
  renderToStaticMarkup(createElement(AssistantActionText, { content, metadata }));
const verifiedMetadata = (content: string) => JSON.stringify({
  verifiedActionSpans: [{ ...parseActionSpans(content)[0], toolId: "safe-calculator", status: "verified" }],
});

test("ordinary roleplay and historical messages render gray italic without asterisks", () => {
  assert.equal(render("Hello. *I smile.*"), 'Hello. <em class="italic text-muted-foreground" data-action-verification="ordinary">I smile.</em>');
  assert.match(render("*I smile.*", '{"tools":[{"id":"safe-calculator"}]}'), /text-muted-foreground/);
  assert.match(render("*I lean\ncloser.*"), /text-muted-foreground.*>I lean\ncloser\.<\/em>/);
});

test("verified tool action is gold and mixed roleplay remains gray", () => {
  const content = "Sure. *I calculate the total.* *I lean closer.*";
  const html = render(content, verifiedMetadata(content));
  assert.match(html, /<em class="italic text-primary" data-action-verification="verified">I calculate the total\.<\/em>/);
  assert.match(html, /<em class="italic text-muted-foreground" data-action-verification="ordinary">I lean closer\.<\/em>/);
  assert.ok(!html.includes("*"));
});

test("success alone, failed/ambiguous outcomes and missing associations are gray", () => {
  for (const metadata of [
    '{"tools":[{"id":"generate_image"}]}',
    '{"tools":[{"id":"persistent-reminders","status":"ambiguous"}]}',
    '{"consultation":{"requested":true,"status":"failed"}}',
    '{"verifiedActionSpans":[]}', null,
  ]) {
    assert.ok(!render("*I cancel the reminder.*", metadata).includes('text-primary'));
  }
});

test("malformed, unverified, unknown-tool and stale span metadata fails closed", () => {
  const content = "*I calculate the total.*";
  const span = parseActionSpans(content)[0];
  for (const entry of [
    { ...span, toolId: "safe-calculator", status: "failed" },
    { ...span, toolId: "unknown", status: "verified" },
    { ...span, start: span.start + 1, toolId: "safe-calculator", status: "verified" },
    { ...span, text: "I smile.", toolId: "safe-calculator", status: "verified" },
  ]) assert.ok(!render(content, JSON.stringify({ verifiedActionSpans: [entry] })).includes("text-primary"));
  for (const metadata of ["{", "null", "[]", '{"verifiedActionSpans":"bad"}']) {
    assert.ok(!render(content, metadata).includes("text-primary"));
  }
});

test("identical actions are distinguished by offsets, including after emoji", () => {
  const content = "🙂 *I calculate the total.* *I calculate the total.*";
  const html = render(content, verifiedMetadata(content));
  assert.equal((html.match(/text-primary/g) ?? []).length, 1);
  assert.equal((html.match(/text-muted-foreground/g) ?? []).length, 1);
});

test("unmatched, escaped, bold, code and multiplication asterisks remain literal", () => {
  for (const content of ["*unmatched", "\\*literal\\*", "**bold**", "`*code*`", "2 * 3 * 4", "a*b*c"]) {
    assert.equal(render(content), content);
  }
});

test("normal dialogue is unchanged and action text cannot inject HTML", () => {
  assert.equal(render("Hello.\nHow are you?"), "Hello.\nHow are you?");
  const html = render("*<img src=x onerror=alert(1)>*");
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("<img"));
});
