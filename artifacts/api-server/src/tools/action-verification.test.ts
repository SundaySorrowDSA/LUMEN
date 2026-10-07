import assert from "node:assert/strict";
import test from "node:test";
import { parseActionSpans, verifiedActionSpansFromMetadata } from "@workspace/assistant-providers/action-text";
import { collectSuccessfulActionEvidence, verifyActionSpans } from "./action-verification.js";
import type { ReminderToolResult } from "./reminders.js";
import { prepareConversationImageDelivery } from "./conversation-image-delivery.js";

const reminderRecord = { id: 1, text: "Drink water", dueAt: "2026-10-08T15:00:00Z", displayTime: "Tomorrow" };
const examples = [
  ["when-i-work-calendar", "I check your schedule"],
  ["when-i-work-calendar", "looks at the calendar"],
  ["safe-calculator", "I work out the numbers"],
  ["safe-calculator", "running the numbers"],
  ["bing-rss-web-search", "I search the web"],
  ["bing-rss-web-search", "looks it up online"],
  ["photo-analysis", "I examine the attached photo"],
  ["photo-analysis", "analyzing your photo"],
  ["consult_openai", "I ask Oracle"],
  ["consult_openai", "consulting OpenAI"],
  ["generate_image", "I send you the generated image"],
  ["generate_image", "generating the picture"],
] as const;

for (const [toolId, action] of examples) {
  test(`completed ${toolId} verifies only matching action: ${action}`, () => {
    const content = `Sure. *${action}* *I smile and lean closer.*`;
    const verified = verifyActionSpans(content, [{ toolId }]);
    assert.equal(verified.length, 1);
    assert.equal(verified[0].text, action);
    assert.equal(verified[0].toolId, toolId);
    assert.equal(content.slice(verified[0].start, verified[0].end), `*${action}*`);
    assert.deepEqual(verifiedActionSpansFromMetadata(content, JSON.stringify({ verifiedActionSpans: verified })), verified);
  });
}

test("ordinary, unrelated, compound, negated, future and hypothetical actions fail closed", () => {
  for (const action of [
    "I smile", "kisses you", "walking over", "I check your schedule and kiss you",
    "I smile while checking the calendar", "I will check your schedule",
    "I didn't check your schedule", "I pretend to check your schedule",
    "You check your schedule", "I try to check your schedule",
    "I check your schedule for next Friday", "I check your pulse",
    "I send you a kiss", "I show you a fake image",
    "I set the reminder for the wrong date", "I ask Oracle to kiss you",
  ]) {
    assert.deepEqual(verifyActionSpans(`*${action}*`, [
      { toolId: "when-i-work-calendar" }, { toolId: "generate_image" },
      { toolId: "persistent-reminders", operation: "created" }, { toolId: "consult_openai" },
    ]), [], action);
  }
});

test("tool success with no corresponding action never verifies roleplay", () => {
  assert.deepEqual(verifyActionSpans("*I sit beside you.*", [{ toolId: "safe-calculator" }]), []);
  assert.deepEqual(verifyActionSpans("*I check your schedule.*", [{ toolId: "safe-calculator" }]), []);
  assert.deepEqual(verifyActionSpans("The result is 42.", [{ toolId: "safe-calculator" }]), []);
  assert.deepEqual(verifyActionSpans("*I send you a selfie.*", [{ toolId: "generate_image" }]), []);
  assert.equal(verifyActionSpans("*I send you a selfie.*", [{ toolId: "generate_image", imageFraming: "selfie" }]).length, 1);
  assert.deepEqual(verifyActionSpans("*I list your reminders.*", [{ toolId: "persistent-reminders" }]), []);
});

test("reminder evidence distinguishes created/cancelled/listed from ambiguous/not-found", () => {
  for (const status of ["created", "cancelled", "listed", "ambiguous", "not-found"] as const) {
    const reminder: ReminderToolResult = {
      tool: "persistent-reminders", action: status === "created" ? "create" : status === "listed" ? "list" : "cancel",
      status, reminders: status === "not-found" ? [] : [reminderRecord],
    };
    const evidence = collectSuccessfulActionEvidence({ reminder });
    const spans = verifyActionSpans("*I set the reminder.* *I cancel the reminder.* *I list your reminders.*", evidence);
    assert.equal(spans.length, ["created", "cancelled", "listed"].includes(status) ? 1 : 0);
    if (spans.length) assert.equal(spans[0].text,
      status === "created" ? "I set the reminder." : status === "cancelled" ? "I cancel the reminder." : "I list your reminders.");
  }
  assert.deepEqual(collectSuccessfulActionEvidence({
    reminder: { tool: "persistent-reminders", action: "create", status: "created", reminders: [] },
  }), []);
});

test("failed/skipped tools cannot supply success evidence; completed results can", () => {
  const failed = collectSuccessfulActionEvidence({
    webSearch: null, workSchedule: null, calculation: null,
    photoAnalyzed: false, consultation: { requested: true, status: "failed" },
  });
  assert.deepEqual(failed, []);
  assert.deepEqual(verifyActionSpans("*I ask OpenAI.* *I examine your photo.* *I search the web.*", failed), []);
  const evidence = collectSuccessfulActionEvidence({
    webSearch: { tool: "bing-rss-web-search", query: "weather", retrievedAt: "now", results: [{ title: "Weather", url: "https://example.com", snippet: "Sunny", publishedAt: null }] },
    workSchedule: { tool: "when-i-work-calendar", requestType: "today", retrievedAt: "now", timeZone: "UTC", events: [], daysOff: [] },
    calculation: { tool: "safe-calculator", kind: "arithmetic", expression: "2+2", result: 4, resultText: "4" },
    photoAnalyzed: true, consultation: { requested: true, status: "completed" },
  });
  const content = "*I search the web.* *I check your calendar.* *I calculate the total.* *I examine the attached photo.* *I consult Oracle.* *I kiss you.*";
  assert.equal(verifyActionSpans(content, evidence).length, 5);
});

test("parsing keeps literals/code safe and uses UTF-16 offsets for repeated spans", () => {
  const content = "🙂 *smiles* and *smiles*";
  assert.deepEqual(parseActionSpans(content), [
    { start: 3, end: 11, text: "smiles" }, { start: 16, end: 24, text: "smiles" },
  ]);
  assert.equal(parseActionSpans("*I lean\ncloser.*")[0].text, "I lean\ncloser.");
  for (const text of ["*unmatched", "**bold**", "2 * 3 * 4", "a*b*c", "\\*literal\\*", "`*code*`", "```\n*code*\n```"]) {
    assert.deepEqual(parseActionSpans(text), [], text);
  }
});

test("image finalization verifies stored delivery only after content correction and provider confirmation", async () => {
  const input = {
    content: "Send a picture.", prompt: "a crow", messages: [],
    image: { tool: "generate_image" as const, model: "image-model", prompt: "a crow", objectPath: "/objects/generated/abc-123.png", mimeType: "image/png" as const },
  };
  const delivery = await prepareConversationImageDelivery({
    ...input, complete: async () => ({
      providerId: "kindroid", model: "kindroid", content: "*I send you the picture.* *I smile.*",
      metadata: { mode: "provider", routedBy: "provider-router" },
    }),
  });
  const metadata = JSON.parse(delivery.metadata);
  assert.equal(metadata.verifiedActionSpans.length, 1);
  assert.equal(metadata.verifiedActionSpans[0].text, "I send you the picture.");
  const corrected = await prepareConversationImageDelivery({
    ...input, complete: async () => ({
      providerId: "kindroid", model: "kindroid", content: "*I will send you the picture.*",
      metadata: { mode: "provider", routedBy: "provider-router" },
    }),
  });
  assert.deepEqual(JSON.parse(corrected.metadata).verifiedActionSpans, []);
  assert.deepEqual(parseActionSpans(corrected.content), []);
  await assert.rejects(prepareConversationImageDelivery({
    ...input, complete: async () => ({
      providerId: "local-preview", model: "preview", content: "*I send you the picture.*",
      metadata: { mode: "preview", routedBy: "provider-router" },
    }),
  }));
});
