import assert from "node:assert/strict";
import test from "node:test";
import { resolveConversationIntent } from "./conversation-intent.js";
import { resolveConversationImageRequest } from "./conversation-image-request.js";
import { selectRenWardrobe } from "./ren-wardrobe-selector.js";

export const photoRequests = [
  "send me a picture",
  "can you send a photo?",
  "show me what you’re wearing",
  "I’d love to see your outfit",
  "are you ready to show me your outfit for today?",
  "Ok baby. Are you ready to show me your outfit for today?",
  "Could you please send me a picture?",
  "I would like to see your outfit today.",
  "Are you able to show me what you are wearing today?",
];
export const promise = [
  { role: "user", content: "I'd love to see your outfit." },
  { role: "assistant", content: "Let me find something suitable for public view. I'll send a picture so you can coordinate." },
];

for (const content of [
  "I’d like you to send me a selfie",
  "I'd like you to send me a selfie.",
  "I would like you to send me a selfie.",
  "Could you send me a photo?",
  "Would you show me a picture?",
  "Show me a picture of yourself",
]) {
  test(`image path regression: ${content}`, () => {
    for (const messages of [[], promise]) {
      const intent = resolveConversationIntent(content, { assistantCharacter: "Ren", messages });
      assert.ok(intent.imageRequest, content);
      assert.equal(intent.webSearchRequested, false);
      assert.equal(intent.imageRequest.resolvedAssistantSubject, true);
      assert.match(intent.imageRequest.prompt, /\bRen\b/);
      if (/selfie/.test(content)) assert.equal(intent.imageRequest.prompt, "selfie of Ren");
    }
  });
}

const deliveredSelfie = [
  { role: "user", content: "Show me a picture of yourself" },
  { role: "assistant", content: "Here is your selfie.", metadata: '{"generatedImage":{"prompt":"selfie of Ren","objectPath":"/objects/generated/abc-001.png"}}' },
];

for (const content of [
  "Can I have another selfie of you?",
  "Could I have one more selfie of you?",
  "Send me another selfie.",
  "One more selfie.",
  "Can I have another selfie of you from a different angle?",
  "Show me a picture of yourself",
]) {
  test(`new image request is never suppressed by a completed attachment: ${content}`, () => {
    for (const messages of [[], promise, deliveredSelfie]) {
      const intent = resolveConversationIntent(content, { assistantCharacter: "Ren", messages });
      assert.ok(intent.imageRequest, content);
      assert.equal(intent.webSearchRequested, false);
      assert.equal(intent.imageRequest.resolvedAssistantSubject, true);
      assert.match(intent.imageRequest.prompt, /\bRen\b/);
      if (/angle/i.test(content)) assert.match(intent.imageRequest.prompt, /different angle/i);
    }
  });
}

test("another/one-more/angle shorthand requests a fresh image only with recent image context", () => {
  for (const content of ["Another one.", "One more.", "A different angle.", "Send me a different angle.", "Can I have a different angle?"]) {
    const intent = resolveConversationIntent(content, { assistantCharacter: "Ren", messages: deliveredSelfie });
    assert.ok(intent.imageRequest, content);
    assert.equal(intent.webSearchRequested, false);
    assert.match(intent.imageRequest.prompt, /fresh image/);
    if (/angle/i.test(content)) assert.match(intent.imageRequest.prompt, /different camera angle/);
    assert.equal(resolveConversationImageRequest(content, { assistantCharacter: "Ren" }), null);
    for (const messages of [
      [...deliveredSelfie, { role: "user", content: "What's for lunch?" }],
      [...deliveredSelfie, { role: "user", content: "Don't send another selfie." }],
    ]) assert.equal(resolveConversationImageRequest(content, { assistantCharacter: "Ren", messages }), null);
  }
  for (const content of ["Ready?", "Send it.", "Another one. What's the weather today?", "No. A different angle."]) {
    assert.equal(resolveConversationImageRequest(content, { assistantCharacter: "Ren", messages: deliveredSelfie }), null, content);
  }
  assert.equal(resolveConversationImageRequest("Send me one more photo of a crow.", { assistantCharacter: "Ren" })?.resolvedAssistantSubject, false);
});

test("all direct/conversational requests select images, not web, standalone and following a promise", () => {
  for (const messages of [[], promise]) for (const content of photoRequests) {
    const intent = resolveConversationIntent(content, { assistantCharacter: "Ren", messages });
    assert.ok(intent.imageRequest, content);
    assert.equal(intent.webSearchRequested, false, content);
    assert.equal(intent.imageRequest.resolvedAssistantSubject, true);
    assert.match(intent.imageRequest.prompt, /\bRen\b.*current outfit/);
  }
});

test("short follow-ups use a nearby pending picture, including a promise without an explicit initial request", () => {
  for (const messages of [promise, [{ role: "assistant", content: "I'll send you a picture." }]]) {
    for (const content of ["Ready?", "Are you ready now?", "Ok baby. Ready?", "Send it please.", "Can I see it?", "I'd love to see it.", "Yes.", "Go ahead.", "What about that picture?"]) {
      const intent = resolveConversationIntent(content, { assistantCharacter: "Ren", messages });
      assert.ok(intent.imageRequest, content);
      assert.equal(intent.webSearchRequested, false);
    }
  }
  for (const content of ["Ready?", "Yes.", "Send it please.", "Can I see it?"]) {
    assert.equal(resolveConversationImageRequest(content, { assistantCharacter: "Ren" }), null);
  }
});

test("context carries the requested subject, but never repeats delivered, cancelled, or stale requests", () => {
  const named = [{ role: "user", content: "Generate an image of a crow." }, { role: "assistant", content: "I'll send you a picture." }];
  assert.equal(resolveConversationImageRequest("Send it.", { assistantCharacter: "Ren", messages: named })?.prompt, "a crow.");
  const completed = [...promise, { role: "assistant", content: "Here it is.", metadata: '{"generatedImage":{"objectPath":"/objects/test.png"}}' }];
  for (const messages of [
    completed,
    [...promise, { role: "user", content: "Never mind, don't send it." }],
    [...promise, { role: "assistant", content: "I can't send that picture." }],
    [...promise, { role: "user", content: "What is the weather today?" }, { role: "assistant", content: "Sunny." }],
    [...promise, ...Array.from({ length: 8 }, () => ({ role: "assistant", content: "Different topic." }))],
  ]) assert.equal(resolveConversationImageRequest("Ready?", { assistantCharacter: "Ren", messages }), null);
});

test("negations, discussions, temporal words, and changed topics are not paid image intent", () => {
  for (const content of [
    "Do not send me a picture.", "Can you explain image generation?",
    "She said she would send me a photo.", "I sent you a picture.",
    "I don't want to see your outfit.", "What are you wearing today?",
    "Show me your schedule today.", "Today.", "Yes. What's the weather today?",
    "No. Are you ready?", "I'm ready for lunch today.",
    "I wouldn't like you to send me a selfie.",
    "I would like you not to send me a selfie.",
    "She said, I’d like you to send me a selfie.",
    "I’d like you to explain how selfies work.",
  ]) assert.equal(resolveConversationIntent(content, { assistantCharacter: "Ren", messages: promise }).imageRequest, null, content);
  assert.equal(resolveConversationIntent("What is the weather today?", { assistantCharacter: "Ren", messages: promise }).webSearchRequested, true);
  assert.equal(resolveConversationIntent("Search the web for outfit ideas today.", { assistantCharacter: "Ren" }).imageRequest, null);
  for (const content of ["What are you wearing today?", "What's your outfit for today?"]) {
    const intent = resolveConversationIntent(content, { assistantCharacter: "Ren", messages: promise });
    assert.equal(intent.imageRequest, null, "A text-only wardrobe question is not a paid photo request");
    assert.equal(intent.webSearchRequested, false, "Personal wardrobe questions aren't current web information");
  }
  assert.equal(resolveConversationIntent("Search the web for ideas for your outfit today.", { assistantCharacter: "Ren" }).webSearchRequested, true);
});

test("new outfit wording and promised-picture follow-ups preserve the current wardrobe", () => {
  const now = new Date("2026-10-06T14:00:00Z");
  const current = selectRenWardrobe({ prompt: "Ren relaxing at home in a black hoodie and lounge pants.", now }, null);
  for (const content of [...photoRequests, "Ready?"]) {
    const resolved = resolveConversationImageRequest(content, { assistantCharacter: "Ren", messages: promise })!;
    assert.deepEqual(selectRenWardrobe({ prompt: resolved.prompt, now }, current), current, content);
  }
});
