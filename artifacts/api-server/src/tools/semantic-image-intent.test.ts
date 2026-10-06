import assert from "node:assert/strict";
import test from "node:test";
import { classifySemanticImageIntent, isAssistantImageOffer } from "./semantic-image-intent.js";
import { resolveConversationIntent } from "./conversation-intent.js";
import { resolveConversationImageRequest } from "./conversation-image-request.js";
import {
  suppliedDirectRequests, suppliedOutfitRequests, holdoutRenRequests,
  ordinaryImageMentions, uploadedPhotoInspection, otherSubjectRequests,
} from "./semantic-image-fixtures.js";

test("all supplied sentences share the assistant-image intent, independent of their exact wording", () => {
  for (const content of [...suppliedDirectRequests, ...suppliedOutfitRequests]) {
    const semantic = classifySemanticImageIntent(content);
    assert.equal(semantic.target, "assistant", content);
    assert.equal(semantic.blocked, false, content);
    const intent = resolveConversationIntent(content, { assistantCharacter: "Ren" });
    assert.ok(intent.imageRequest?.resolvedAssistantSubject, content);
    assert.equal(intent.webSearchRequested, false, content);
  }
  for (const content of suppliedOutfitRequests) {
    assert.equal(classifySemanticImageIntent(content).kind, "outfit", content);
    assert.match(resolveConversationImageRequest(content, { assistantCharacter: "Ren" })!.prompt, /current outfit/);
  }
});

test("unlisted holdout paraphrases use the same semantic features", () => {
  for (const content of holdoutRenRequests) {
    assert.equal(classifySemanticImageIntent(content).target, "assistant", content);
    const resolved = resolveConversationIntent(content, { assistantCharacter: "Ren" });
    assert.ok(resolved.imageRequest?.resolvedAssistantSubject, content);
    assert.equal(resolved.webSearchRequested, false, content);
  }
  const detailed = resolveConversationImageRequest(holdoutRenRequests[17], { assistantCharacter: "Ren" })!;
  assert.match(detailed.prompt, /smiling in the kitchen/);
});

test("ordinary mentions, instructions, negations, quoted requests and photo inspection do not dispatch an image", () => {
  const messages = [{ role: "assistant", content: "I'll send a photo of myself." }];
  for (const content of [...ordinaryImageMentions, ...uploadedPhotoInspection]) {
    assert.notEqual(classifySemanticImageIntent(content).target, "assistant", content);
    assert.equal(resolveConversationIntent(content, { assistantCharacter: "Ren", messages }).imageRequest, null, content);
  }
});

test("primary other subjects and prenominal subjects never become Ren", () => {
  for (const content of otherSubjectRequests) {
    assert.equal(classifySemanticImageIntent(content).target, "other", content);
    const request = resolveConversationImageRequest(content, { assistantCharacter: "Ren" });
    assert.notEqual(request?.resolvedAssistantSubject, true, content);
  }
  assert.equal(resolveConversationImageRequest("Generate an image of a crow.", { assistantCharacter: "Ren" })?.prompt, "a crow.");
});

test("context resolves varied readiness/consent requests only while an actual picture is pending", () => {
  for (const offer of [
    "I'll send a picture.",
    "Let me share a selfie.",
    "Would you like me to take a portrait for you?",
    "I can share a snapshot.",
  ]) {
    assert.equal(isAssistantImageOffer(offer), true, offer);
    for (const content of ["Ready?", "Let me see", "Could I see it now?", "Please show", "I'd appreciate seeing it.", "Share that photo", "Is it ready now?"]) {
      const messages = [{ role: "assistant", content: offer }];
      assert.ok(resolveConversationImageRequest(content, { assistantCharacter: "Ren", messages }), `${offer} / ${content}`);
      assert.equal(resolveConversationImageRequest(content, { assistantCharacter: "Ren" }), null, content);
      assert.equal(resolveConversationImageRequest(content, { assistantCharacter: "Ren", messages: [
        ...messages, { role: "user", content: "What should we have for lunch?" },
      ] }), null, content);
    }
  }
  for (const content of ["I can explain how to take a photo.", "I cannot send a selfie.", "I sent a photo yesterday.", "I can send a photo of a crow."]) {
    assert.equal(isAssistantImageOffer(content), false, content);
  }
});

test("image acknowledgements preserve context without themselves authorizing a paid call", () => {
  const messages = [
    { role: "user", content: "Please share a selfie of you." },
    { role: "assistant", content: "I'll send a picture." },
    { role: "user", content: "Thanks." },
  ];
  assert.equal(resolveConversationImageRequest("Lovely photo.", { assistantCharacter: "Ren", messages }), null);
  assert.ok(resolveConversationImageRequest("Let me see", { assistantCharacter: "Ren", messages }));
  const delivered = [...messages, {
    role: "assistant", content: "Done.",
    metadata: '{"generatedImage":{"prompt":"selfie of Ren","objectPath":"/objects/generated/abc-123.png"}}',
  }, { role: "user", content: "Beautiful picture." }];
  assert.equal(resolveConversationImageRequest("Ready?", { assistantCharacter: "Ren", messages: delivered }), null);
  assert.ok(resolveConversationImageRequest("One more.", { assistantCharacter: "Ren", messages: delivered }));
});

test("compositional modal/action/noun variations share intent without a sentence whitelist", () => {
  for (const modal of ["Can", "Could", "Would"]) for (const action of ["send", "share", "capture"]) {
    for (const noun of ["selfie", "snapshot", "photograph", "portrait"]) {
      const content = `${modal} you please ${action} another ${noun} of yourself for me?`;
      assert.equal(classifySemanticImageIntent(content).target, "assistant", content);
      assert.ok(resolveConversationImageRequest(content, { assistantCharacter: "Ren" })?.resolvedAssistantSubject, content);
    }
  }
});

test("attachment state, not assistant narration, separates ambiguous follow-ups from fresh capture requests", () => {
  const promised = [
    { role: "user", content: suppliedDirectRequests[0] },
    { role: "assistant", content: "Here is a selfie for you." },
  ];
  assert.ok(resolveConversationImageRequest("Let me see", { assistantCharacter: "Ren", messages: promised }));
  const delivered = [...promised, {
    role: "assistant", content: "I pose for the photo.",
    metadata: '{"generatedImage":{"prompt":"image of Ren","objectPath":"/objects/generated/abc-123.png"}}',
  }];
  for (const content of ["Ready?", "Let me see", "Send it please."]) {
    assert.equal(resolveConversationImageRequest(content, { assistantCharacter: "Ren", messages: delivered }), null, content);
  }
  for (const content of ["Could I get another?", "Would you mind a different angle?", "Give me one more, please."]) {
    const request = resolveConversationImageRequest(content, { assistantCharacter: "Ren", messages: delivered });
    assert.ok(request, content);
    assert.match(request.prompt, /fresh image/);
  }
  for (const content of [...suppliedDirectRequests, ...holdoutRenRequests]) {
    assert.ok(resolveConversationImageRequest(content, { assistantCharacter: "Ren", messages: delivered }), content);
  }
});
